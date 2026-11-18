import { QB, WR_START_X, BODY_RADIUS, USER_ASSIST, CONTACT, TIP, JUMP, BALANCE, HANDS, FIELD, RUN, TACKLE, DIVE, TOE } from '../config.js';
import { clamp, lerp, dist2, distToVerticalSegment } from '../core/vec.js';
import { Athlete, NO_INTENT } from './athlete.js';
import { Ball } from './ball.js';
import { Quarterback } from './qb.js';
import {
  reachInfo,
  isAttempt,
  planBallPlay,
  classifyCatch,
  catchProbability,
  breakupProbability,
  holdOnProbability,
  groundHoldProbability,
  tipChance,
  feetOut,
  spotInBounds,
  inEndZone,
  tackleOdds,
  breakFreeOdds,
  diveTackleOdds,
} from './catching.js';
import { classifyBreak } from './aiCommon.js';

/** Scale a man's velocity down to `limit` if he is going faster than that. */
function limitSpeed(a, limit) {
  const speed = a.speed;
  if (speed <= limit || speed < 1e-6) return;
  a.vel.x *= limit / speed;
  a.vel.z *= limit / speed;
}

/** Yards from the goal line (0 or less is in the end zone). */
export const yardLine = (z) => z - FIELD.goalZ;

/**
 * One rep of 1-on-1s: receiver vs. defender with the AI QB throwing.
 *
 *   presnap -> live -> flight -> run -> done
 *
 * Controllers (keyboard or AI) are asked for an intent every tick. The rep
 * is pure simulation: it knows nothing about rendering or who the human is.
 *
 * The catch is physical. A ball that comes off hands can pop up and stay
 * alive; a receiver who gets it still has to hold on through a hit, or
 * through the ground if he dove for it, and a man who caught it in the air
 * has to come down with both feet in bounds (or his body, if he dove).
 *
 * A finished catch short of the goal line is not the end of it: he is a
 * ball carrier ('run') until he gets into the end zone or the defender
 * brings him down, and the defender has to tackle him to stop him.
 *
 * So is everything before it. Within arm's reach the two men fight with
 * their hands: the defender jams, the receiver pushes off and works past,
 * a defender who is beaten or trailing rides him, and the stronger man gets
 * the better of it. Contact only ever costs speed: nobody is flung past a
 * man or bounced off him. It takes balance away rather than knocking
 * anybody straight over: a man stumbles, catches himself if he can, and
 * goes down only when his balance is gone.
 */
export class Rep {
  constructor({ wr, db, rng, side = 1 }) {
    this.rng = rng;
    this.side = side;
    this.dt = 0;
    this.wr = new Athlete({ ratings: wr.ratings, x: side * WR_START_X, z: 0, stamina: wr.stamina ?? 1, facing: Math.PI });
    this.db = new Athlete({ ratings: db.ratings, x: side * WR_START_X, z: -5, stamina: db.stamina ?? 1, facing: 0 });
    this.db.faceTarget = this.wr.pos;
    this.wrCtl = wr.controller;
    this.dbCtl = db.controller;
    // Human players get slightly more forgiving hands than the AI.
    this.wr.reachAssist = this.wrCtl.isAI ? 0 : USER_ASSIST.reach;
    this.db.reachAssist = this.dbCtl.isAI ? 0 : USER_ASSIST.reach;
    this.qb = new Quarterback();
    const hand = this.qb.hand;
    this.ball = new Ball(hand.x, hand.y - 0.9, hand.z);
    this.phase = 'presnap';
    this.tPre = 0;
    this.t = 0; // seconds since the snap
    this.tDone = 0;
    this.called = false;
    this.callTime = null;
    this.throw = null;
    this.result = null;
    this.events = [];
    this.dbReadyAt = null;
    this.prevReach = null;
    this.wrTried = false;
    this.dbTried = false;
    this.approach = { wr: false, db: false }; // has the ball come toward him yet?
    this.securing = null; // { until, needGround, needFeet, threat, hitDone, info } while a catch is being finished
    this.pick = null; // { info } an interception made in the air, until he comes down
    this.run = null; // the play after the catch: { t, info, startZ, broken, rest, wrap, diveTried, tackledBy }
    this.tipReason = null; // what the incompletion is if a tipped ball falls
    this.tipInfo = null;
    this.touching = false;
    // The hand fight: what the defender's hands are doing ('jam' | 'check' |
    // 'ride'), how long they have been on, time until a shed defender can get
    // them back on, which shoulder the receiver is going past, whether the
    // punch has landed, whether the defender has hold of him (and so can
    // ride him), and whether his jam has been beaten.
    this.fight = { on: false, mode: null, time: 0, rest: 0, side: 0, punched: false, latched: false, spent: false };
    this.carry = null; // momentum carried through the whistle
    this.wrCtl.setup?.(this, 'wr');
    this.dbCtl.setup?.(this, 'db');
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  /** Seconds left on the 4-second throw clock. */
  get clock() {
    return clamp(QB.deadline - this.t, 0, QB.deadline);
  }

  snap() {
    if (this.phase !== 'presnap') return;
    this.phase = 'live';
    this.t = 0;
    this.qb.snap();
    this.emit('snap');
  }

  step(dt) {
    this.dt = dt;
    switch (this.phase) {
      case 'presnap':
        return this.stepPresnap(dt);
      case 'live':
        return this.stepLive(dt);
      case 'flight':
        return this.stepFlight(dt);
      case 'run':
        return this.stepRun(dt);
      default:
        return this.stepDone(dt);
    }
  }

  stepPresnap(dt) {
    this.tPre += dt;
    const wrI = this.wrCtl.update(this, 'wr', dt);
    const dbI = this.dbCtl.update(this, 'db', dt);

    // The defender may adjust his alignment; the receiver is set.
    const db = this.db;
    db.step({ x: dbI.x, z: dbI.z, sprint: false, jump: false, juke: 0 }, dt);
    db.pos.x = clamp(db.pos.x, this.wr.pos.x - 4, this.wr.pos.x + 4);
    db.pos.z = clamp(db.pos.z, -9, -1.2);

    if (this.wrCtl.isAI) {
      // Rival is on offense: he snaps on his own cadence. The defender can
      // signal "ready" to hurry it up, but never controls the exact moment.
      if (dbI.snap && this.dbReadyAt === null && this.tPre > 0.4) {
        this.dbReadyAt = this.tPre + this.rng.range(0.35, 0.8);
      }
      if (wrI.snap || (this.dbReadyAt !== null && this.tPre >= this.dbReadyAt)) this.snap();
    } else if (wrI.snap && this.tPre > 0.4) {
      this.snap();
    }
  }

  /** Move both athletes one tick. Returns the body contact between them, if any. */
  stepAthletes(dt, wrI = null, dbI = null) {
    wrI = wrI || this.wrCtl.update(this, 'wr', dt);
    dbI = dbI || this.dbCtl.update(this, 'db', dt);
    if (wrI.call && !this.called && this.phase === 'live') {
      this.called = true;
      this.callTime = this.t;
      this.wr.callTimer = 0.9;
      this.emit('call');
    }
    // With the ball in the air, leaving your feet means playing it: a jump,
    // or a dive if that is the only way to get there. After the catch it
    // means a dive: the ball carrier's for the goal line, the defender's at
    // his legs (and nothing at all if he is too far away for that).
    const live = this.phase === 'flight' && this.ball.state === 'flight';
    const running = this.phase === 'run';
    this.watchBall(live);
    this.handFight(dt);
    if (running) this.holdOn();
    let wrPlay = null;
    let dbPlay = null;
    if (live) {
      if (wrI.jump) wrPlay = planBallPlay(this.wr, this.ball, null, { role: 'wr', foe: this.db, safe: Boolean(wrI.safe) });
      if (dbI.jump) dbPlay = planBallPlay(this.db, this.ball, null, { role: 'db', foe: this.wr, safe: Boolean(dbI.safe) });
    } else if (running) {
      if (wrI.jump) wrPlay = this.carrierDive();
      if (dbI.jump && !(dbPlay = this.tackleDive())) dbI.jump = false;
    }
    // Ball in his hands and the play not his to run yet: no jumping with it.
    if (this.wr.hasBall && !running) wrI.jump = false;
    if (this.db.hasBall) dbI.jump = false;
    this.wr.step(wrI, dt, wrPlay);
    this.db.step(dbI, dt, dbPlay);
    this.report();
    const contact = this.collide();
    this.jostle(contact);
    return contact;
  }

  /** Tell the game what each athlete just did. Each thing is reported once. */
  report() {
    for (const who of ['wr', 'db']) {
      const a = this[who];
      if (a.jukedThisTick) this.emit('juke', { who });
      if (a.jumpedThisTick) this.emit('jump', { who });
      if (a.divedThisTick) this.emit('dive', { who });
      if (a.stumbledThisTick) this.emit('stumble', { who });
      if (a.fellThisTick) this.emit('fall', { who, impact: Math.hypot(a.fall?.vx || 0, a.fall?.vy || 0, a.fall?.vz || 0) });
      a.jukedThisTick = 0;
      a.jumpedThisTick = a.divedThisTick = a.stumbledThisTick = a.fellThisTick = false;
    }
  }

  /**
   * Eyes on the ball. A man going up for it turns his whole body to it; a
   * man on his feet squares up as it arrives, unless it is dropping in over
   * his shoulder while he runs away from it.
   */
  watchBall(live) {
    const ball = this.ball;
    for (const who of ['wr', 'db']) {
      const a = this[who];
      a.track = live ? ball.pos : null;
      a.squareUp = false;
      if (!live || a.hasBall || ball.eta > JUMP.squareUp) continue;
      // Only the man it is coming to.
      if (Math.hypot(ball.target.x - a.pos.x, ball.target.z - a.pos.z) > 3) continue;
      const dx = ball.pos.x - a.pos.x;
      const dz = ball.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const speed = a.speed;
      const away = speed > 5.5 && d > 1e-3 && (a.vel.x * dx + a.vel.z * dz) / (speed * d) < -0.35;
      a.squareUp = ball.tips > 0 || !away;
    }
  }

  /**
   * Hands. Inside arm's reach the defender gets his on the receiver.
   *
   * Squared up in front of him it is a jam: the hands land with a punch that
   * takes speed off him and rocks his balance, then stay on his chest, taking
   * away what he brings and riding him off his line. The receiver fights
   * back: he knocks the hands down, moves the defender off the spot and works
   * past his shoulder. The jam is at full strength within a few yards of the
   * line and a hand-check after that.
   *
   * Once the receiver is by him, or when the defender has caught him from
   * behind, the hands stay on: he rides him. That takes the receiver's top
   * speed and his footwork, and when the receiver tries to pull away the
   * defender hangs on and is towed along. It works anywhere on the field.
   *
   * How much each man gets done is strength against strength, nobody keeps
   * his hands on for ever, and a sidestep is the quickest way out of them.
   * None of it makes anybody faster: hands move a man, they do not fling him.
   */
  handFight(dt) {
    const wr = this.wr;
    const db = this.db;
    const f = this.fight;
    wr.hands = null;
    db.hands = null;
    wr.held = 0;
    db.held = 0;
    f.rest = Math.max(0, f.rest - dt);
    const free = (a) => !a.down && !a.airborne && a.gather <= 0 && !a.attempting && !a.hasBall;
    const dx = db.pos.x - wr.pos.x;
    const dz = db.pos.z - wr.pos.z;
    const d = Math.hypot(dx, dz);
    if (this.phase !== 'live' || !free(wr) || !free(db) || d > HANDS.show || d < 1e-4) {
      f.on = false;
      f.mode = null;
      f.time = 0;
      f.punched = false;
      f.latched = false;
      if (d > HANDS.show) {
        f.side = 0;
        f.spent = false;
      }
      return;
    }
    const nx = dx / d; // receiver -> defender
    const nz = dz / d;

    // The defender can only put his hands on a man who is in front of him.
    const facing = -(nx * Math.sin(db.facing) + nz * Math.cos(db.facing));
    const dbFront = clamp((facing - 0.1) / 0.5, 0, 1);
    // Where is the receiver trying to go? At the defender, and he is in the
    // way; anywhere else, and he is past him, with the defender on his hip
    // or on his back.
    let gx = wr.want.x;
    let gz = wr.want.z;
    if (Math.hypot(gx, gz) < 0.5) {
      gx = wr.vel.x;
      gz = wr.vel.z;
    }
    const going = Math.hypot(gx, gz);
    const ahead = going > 0.5 ? (gx * nx + gz * nz) / going : 0;
    const inWay = clamp((ahead - 0.05) / 0.45, 0, 1);
    const past = going > 0.5 ? clamp((0.3 - ahead) / 0.4, 0, 1) * (1 - inWay) : 0;

    // Which shoulder he is going past: the way he is already heading, else the outside one.
    const lateral = going > 0.5 ? (gz * nx - gx * nz) / going : 0; // + toward (-nz, nx)
    if (Math.abs(lateral) > 0.2) f.side = Math.sign(lateral);
    else if (!f.side) f.side = -nz * this.side >= 0 ? 1 : -1;
    const tx = -nz * f.side;
    const tz = nx * f.side;

    const grip = clamp((HANDS.reach - d) / (HANDS.reach - HANDS.full), 0, 1); // leverage
    const show = clamp((HANDS.show - d) / (HANDS.show - HANDS.reach), 0, 1); // arms coming up
    const zone = -wr.pos.z <= HANDS.zone ? 1 : HANDS.check;
    const sw = wr.params.strength;
    const sd = db.params.strength;
    const wrEdge = ((2 * sw) / (sw + sd)) ** HANDS.power;
    const dbEdge = ((2 * sd) / (sw + sd)) ** HANDS.power;

    // What the defender's hands can do, before leverage: nothing while he
    // gets them back after being shed, and little through a sidestep.
    const able = f.rest > 0 ? 0 : dbFront * dbEdge * (wr.jukeLock > 0 ? HANDS.juke : 1);
    // A receiver who has shed the jam has beaten it: the defender gets no
    // second one until there is daylight between them again.
    const jam = f.spent ? 0 : able * grip * inWay * zone;
    // He can only ride a man he has got hold of: one he has already jammed,
    // or one he has run into. Until then his hands are only reaching.
    if (grip <= 0 || dbFront <= 0) f.latched = false;
    else if (this.touching && able > 0) f.latched = true;
    const ride = f.latched ? able * grip * past * HANDS.ride : 0;
    // The receiver's push-off. Once he has the hands beaten it is the
    // defender who is being handled, however strong he is.
    const push = grip * inWay * (f.spent ? Math.max(wrEdge, HANDS.beaten) : wrEdge);
    const wrWas = wr.speed;
    const dbWas = db.speed;

    // With hands on his chest the receiver can only close on the defender
    // so fast: at a walk if they are evenly matched, quicker if he is the
    // stronger man, and backwards if he is much the weaker. It is the speed
    // between them that the hands work on, not the speed they share.
    const drive = clamp(HANDS.drive * (1.5 * wrEdge - dbEdge), -0.5, 2 * HANDS.drive);
    const into = (wr.vel.x - db.vel.x) * nx + (wr.vel.z - db.vel.z) * nz;

    if (!f.punched && !f.spent && f.rest <= 0 && grip >= 0.5 && dbFront * inWay > 0.5) {
      // The hands land: a punch to the chest plate. It takes a bite out of
      // what he is bringing, and it rocks him. A much stronger man's punch
      // knocks him off his stride.
      f.punched = true;
      f.latched = true;
      const power = able * inWay * zone;
      const bite = Math.min(HANDS.punch * power, Math.max(0, into - drive));
      wr.vel.x -= nx * bite;
      wr.vel.z -= nz * bite;
      this.emit('punch', { power });
      if (wr.hit(BALANCE.absorb + HANDS.jolt * power, -nx, -nz, BALANCE.floor) === 'stumble') {
        this.emit('stumble', { who: 'wr' }); // his own step would forget it before it is reported
      }
    }

    if (jam > 0) {
      // Hands on his chest: what he is bringing into the defender comes off,
      // down to what he can drive through them.
      const closing = (wr.vel.x - db.vel.x) * nx + (wr.vel.z - db.vel.z) * nz;
      if (closing > drive) {
        const take = Math.min(closing - drive, HANDS.jam * jam * dt);
        wr.vel.x -= nx * take;
        wr.vel.z -= nz * take;
        // The defender feels it too: the more man he is trying to stop, the more he gives.
        const recoil = (take / dbEdge) * wrEdge * 0.2;
        db.vel.x += nx * recoil;
        db.vel.z += nz * recoil;
      }
    }

    if (push > 0) {
      // The push-off moves the defender back and off to the other side, and
      // turns the receiver past his shoulder.
      const shove = HANDS.push * push * dt;
      db.vel.x += (nx * 0.55 - tx * 0.83) * shove;
      db.vel.z += (nz * 0.55 - tz * 0.83) * shove;
      wr.vel.x += tx * shove * HANDS.carry;
      wr.vel.z += tz * shove * HANDS.carry;
      db.held = Math.min(1, push);
    }

    if (ride > 0) {
      // Hands on his hip and his back. When he pulls away the defender hangs
      // on: it drags at the receiver, and it tows the defender along.
      const opening = -((wr.vel.x - db.vel.x) * nx + (wr.vel.z - db.vel.z) * nz);
      if (opening > 0) {
        const pull = Math.min(opening / 2, HANDS.tether * Math.min(1, ride) * dt);
        wr.vel.x += nx * pull;
        wr.vel.z += nz * pull;
        db.vel.x -= nx * pull;
        db.vel.z -= nz * pull;
      }
    }

    // Hands on a man take his footwork and his top speed (see Athlete.step).
    const hold = Math.max(jam, ride);
    wr.held = Math.min(1, hold);
    if (hold > 0) {
      // The stronger the receiver, the sooner he sheds them.
      f.time += dt * (wr.jukeLock > 0 ? HANDS.shake : 1);
      if (f.time > HANDS.maxTime * clamp((dbEdge / wrEdge) ** 0.6, 0.55, 1.3)) {
        f.time = 0;
        f.rest = HANDS.rest;
        f.punched = false;
        f.latched = false;
        f.spent = jam >= ride;
        this.emit('shed');
      }
    } else if (grip <= 0) {
      f.time = 0;
    }

    // Nobody comes out of it faster than he went in. Hands can get a slow
    // man moving, and a defender who is hanging on can be towed up to his
    // own top speed, but that is all.
    limitSpeed(wr, Math.max(wrWas, HANDS.work));
    limitSpeed(db, Math.max(dbWas, ride > 0 ? db.params.topSpeed : HANDS.work));

    // Arms come up as they close. In front of him the receiver fights the
    // hands; once he is by, he runs with them on him.
    const coming = show * Math.min(1, inWay * 2);
    const trailing = show * past;
    const riding = trailing >= coming;
    const k = Math.max(coming, trailing);
    if (k > 0 && (!riding || dbFront > 0)) {
      wr.hands = { kind: riding ? 'ridden' : 'release', k: riding ? k * dbFront : k, on: riding ? ride > 0 : grip > 0, side: f.side };
    }
    if (k > 0 && dbFront > 0) {
      const kind = riding ? 'ride' : zone === 1 ? 'jam' : 'check';
      db.hands = { kind, k: k * dbFront, on: riding ? ride > 0 : jam > 0, side: -f.side };
    }
    const on = grip > 0 && (jam > 0 || push > 0 || ride > 0);
    f.mode = !on ? null : ride > jam ? 'ride' : zone === 1 ? 'jam' : 'check';
    if (on && !f.on) this.emit('hands', { power: Math.max(jam, push, ride), kind: f.mode });
    f.on = on;
  }

  /**
   * Bodies can't overlap; the stronger athlete gives less ground.
   * Returns { closing, nx, nz, fresh } when they are touching: how fast they
   * came together along the line from receiver to defender.
   *
   * What a man loses is speed he was closing with, never speed the two of
   * them share: a defender who runs into the back of a receiver going the
   * same way slows to the receiver's pace and stays on him, rather than
   * stopping dead and bouncing off.
   */
  collide() {
    const a = this.wr;
    const b = this.db;
    let dx = b.pos.x - a.pos.x;
    let dz = b.pos.z - a.pos.z;
    let d = Math.hypot(dx, dz);
    const min = BODY_RADIUS * 2;
    if (d >= min) {
      this.touching = false;
      return null;
    }
    if (d < 1e-4) {
      dx = 0;
      dz = -1;
      d = 1;
    }
    const nx = dx / d;
    const nz = dz / d;
    const overlap = min - d;
    const sa = a.params.strength;
    const sb = b.params.strength;
    const aShare = sb / (sa + sb);
    a.pos.x -= nx * overlap * aShare;
    a.pos.z -= nz * overlap * aShare;
    b.pos.x += nx * overlap * (1 - aShare);
    b.pos.z += nz * overlap * (1 - aShare);
    const va = a.vel.x * nx + a.vel.z * nz; // the receiver's speed toward the defender
    const vb = -(b.vel.x * nx + b.vel.z * nz); // ...and the defender's toward him
    const closing = va + vb;
    if (closing > 0 && va > 0 && !a.airborne) {
      const was = a.speed;
      const lost = Math.min(va, closing) * Math.min(1, 0.7 * aShare * 2);
      a.vel.x -= nx * lost;
      a.vel.z -= nz * lost;
      // A receiver running his route does not stop on a man's chest: he
      // slides off his shoulder and keeps going. A stronger one keeps more.
      // Part of what he lost is turned sideways. That is a change of
      // direction, never a gain: leaning on a man he keeps the speed his
      // legs give him, and running into one he comes off slower.
      if (this.phase !== 'done' && !a.down && !a.hasBall) {
        let tx = -nz;
        let tz = nx;
        const lateral = a.vel.x * tx + a.vel.z * tz;
        const side = Math.abs(lateral) > 0.3 ? Math.sign(lateral) : this.fight.side || (tx * this.side >= 0 ? 1 : -1);
        tx *= side;
        tz *= side;
        const keep = Math.min(0.9, HANDS.slip * clamp(2 * (1 - aShare), 0.5, 1.3));
        a.vel.x += tx * lost * keep;
        a.vel.z += tz * lost * keep;
        limitSpeed(a, this.touching ? was : was - lost * (1 - keep));
      }
    }
    if (closing > 0 && vb > 0 && !b.airborne) {
      const lost = Math.min(vb, closing) * Math.min(1, 0.7 * (1 - aShare) * 2);
      b.vel.x += nx * lost;
      b.vel.z += nz * lost;
    }
    const fresh = !this.touching;
    this.touching = true;
    return { closing, va, vb, nx, nz, aShare, fresh };
  }

  /** The shove one athlete takes from a collision, as a fall for the renderer. */
  shove(contact, who, scale = 1) {
    // The normal runs receiver -> defender, so the receiver is pushed along -n.
    const sign = who === 'wr' ? -1 : 1;
    const share = who === 'wr' ? contact.aShare : 1 - contact.aShare;
    const push = contact.closing * (0.35 + 0.5 * share) * scale;
    const victim = this[who];
    return {
      vx: sign * contact.nx * push,
      vy: 1.2 + 0.25 * contact.closing,
      vz: sign * contact.nz * push,
      // Hit while his feet are off the ground, his legs go out from under him.
      high: !victim.airborne,
    };
  }

  /**
   * Land a collision on one athlete's balance. The weaker man takes more of
   * it, and the man who brought the speed is braced for it. He stumbles if
   * he can and goes down if he cannot; a man in the air who loses it comes
   * down in a heap, unless `outOfAir` knocks him straight out of it.
   *   scale   how much of the collision lands at all
   *   floor   the least balance it can leave a man who is on his feet
   */
  strike(contact, who, { scale = 1, floor = 0, outOfAir = false } = {}) {
    const me = this[who];
    if (me.down) return null;
    const share = who === 'wr' ? contact.aShare : 1 - contact.aShare;
    const mine = Math.max(0, who === 'wr' ? contact.va : contact.vb);
    const braced = 1 - BALANCE.brace * clamp(mine / Math.max(contact.closing, 1e-3), 0, 1);
    const sign = who === 'wr' ? -1 : 1;
    const outcome = me.hit(contact.closing * 2 * share * braced * scale, sign * contact.nx, sign * contact.nz, me.airborne ? 0 : floor);
    if (outcome === 'fall') {
      const fall = this.shove(contact, who);
      if (me.airborne && !outOfAir) me.fall = fall; // he finds out when he lands
      else me.knockdown(fall, CONTACT.downTime);
    } else if (outcome === 'stumble' && !me.airborne) {
      // The hit moves him: his feet have to catch up. It can turn him and it
      // can get him going, but it does not send him off faster than he was.
      const push = contact.closing * (0.35 + 0.5 * share) * 0.6;
      const was = me.speed;
      me.vel.x += sign * contact.nx * push;
      me.vel.z += sign * contact.nz * push;
      limitSpeed(me, Math.max(was, push));
    }
    return outcome;
  }

  /**
   * What a collision does to balance. Before the whistle both men see it
   * coming, so on their feet they only ever stumble; in the air, or once
   * the play is over, a big enough hit puts a man down.
   */
  jostle(contact) {
    // After the catch, contact is a tackle (see tackling).
    if (!contact || !contact.fresh || contact.closing < CONTACT.minHit || this.securing || this.phase === 'run') return;
    this.emit('contact', { power: contact.closing });
    const done = this.phase === 'done';
    for (const who of ['wr', 'db']) this.strike(contact, who, done ? {} : { scale: BALANCE.jostle, floor: BALANCE.floor });
    this.report();
  }

  stepLive(dt) {
    this.t += dt;
    this.stepAthletes(dt);
    const before = this.qb.state;
    const thrown = this.qb.step(this.t, dt, {
      called: this.called,
      receiver: this.wr,
      defender: this.db,
      rng: this.rng,
    });
    if (before === 'drop' && this.qb.state === 'windup') this.emit('windup', { forced: this.qb.forced });
    if (thrown) {
      // Some throws are put up high: go get it.
      // Deep balls and tight windows become jump balls.
      const sep = dist2(this.wr.pos, this.db.pos);
      const lift =
        this.rng.range(0, 0.4) +
        (thrown.distance > 22 ? this.rng.range(0.1, 0.7) : 0) +
        (sep < 1.6 ? this.rng.range(0.3, 0.8) : 0);
      thrown.target.y += lift;
      thrown.category = classifyBreak(this.wr.vel, this.side);
      this.ball.throwTo(thrown.from, thrown.target, thrown.flightTime);
      this.throw = thrown;
      this.phase = 'flight';
      this.emit('throw', { forced: thrown.forced });
    } else {
      const hand = this.qb.hand;
      this.ball.pos.x = hand.x;
      this.ball.pos.z = hand.z;
      this.ball.pos.y = this.qb.state === 'windup' ? hand.y : hand.y - 0.9;
    }
  }

  stepFlight(dt) {
    this.t += dt;
    // A human defender gets a small closing burst once the ball is in the air.
    if (!this.dbCtl.isAI) this.db.speedCap = USER_ASSIST.closingBurst;
    const contact = this.stepAthletes(dt);
    const hitGround = this.ball.step(dt);
    if (this.pick) return this.stepPick();
    if (this.securing) return this.stepSecuring(contact);
    if (this.ball.state === 'flight' && this.ball.tFlight > 0.1) this.checkCatch();
    if (!this.result && hitGround) this.finish(false, this.tipReason || 'ground', this.tipInfo || {});
    return undefined;
  }

  stepDone(dt) {
    this.tDone += dt;
    const carry = this.tDone < 0.28 ? this.carry : null;
    this.watchBall(false);
    this.handFight(dt); // the whistle has gone: this only takes the hands off
    for (const who of ['wr', 'db']) {
      const a = this[who];
      a.speedCap = 1;
      a.coast = true;
      a.step(carry ? carry[who] : NO_INTENT, dt);
    }
    this.report();
    this.jostle(this.collide());
    this.ball.step(dt);
  }

  /**
   * Each athlete gets one play on the ball per flight, at the moment it is
   * closest to his hands. Whoever the ball reaches first plays it first. A
   * tip starts a new flight and gives both another play.
   */
  checkCatch() {
    const ball = this.ball;
    const ballPos = ball.pos;
    const tipped = ball.tips > 0;
    const wrNow = reachInfo(this.wr, 'wr', ballPos, tipped);
    const dbNow = reachInfo(this.db, 'db', ballPos, tipped);
    const prev = this.prevReach;
    this.prevReach = { wr: wrNow, db: dbNow };
    if (!prev) return undefined;

    // The ball has to come to him first: no grabbing it on its way out.
    if (wrNow.dist < prev.wr.dist) this.approach.wr = true;
    if (dbNow.dist < prev.db.dist) this.approach.db = true;
    // A tipped ball dropping straight down is played when it reaches his chest.
    const falling = tipped && ball.vel.y < 0;
    const atChest = (who, now) => falling && now.inReach && ballPos.y <= this[who].y + 1.35;

    const wrPlay =
      !this.wrTried && this.approach.wr && prev.wr.inReach && (wrNow.dist > prev.wr.dist || atChest('wr', wrNow));
    const dbPlay =
      !this.dbTried && this.approach.db && prev.db.inReach && (dbNow.dist > prev.db.dist || atChest('db', dbNow));

    if (wrPlay) {
      this.wrTried = true;
      const contested = !this.dbTried && prev.db.inReach && isAttempt(prev.db.kind);
      const separation = dist2(this.wr.pos, this.db.pos);
      const catchType = classifyCatch({ athlete: this.wr, reach: prev.wr, ballPos, ballVel: ball.vel, tips: ball.tips });
      const p = catchProbability({
        wr: this.wr,
        db: this.db,
        quality: prev.wr.quality,
        attempting: isAttempt(prev.wr.kind),
        separation,
        dbAttempting: this.db.attempting,
        dbInReach: contested,
        catchType,
      });
      const info = { p, separation, contested, catchType, tips: ball.tips, aggressive: this.wr.aggressive || undefined };
      if (this.rng.chance(p)) {
        ball.attachTo(this.wr);
        this.wr.hasBall = true;
        this.wr.catchInfo = { type: catchType, toeTap: false };
        this.emit('catch', { catchType });
        return this.secure(info, separation);
      }
      const reason = contested || separation < 1.3 ? 'breakup' : 'drop';
      if (ball.tips < TIP.max && this.rng.chance(tipChance(prev.wr))) return this.tipBall('wr', reason, info);
      ball.deflect(this.rng);
      return this.finish(false, reason, info);
    }

    if (dbPlay) {
      this.dbTried = true;
      if (this.rng.chance(breakupProbability(prev.db, this.db))) {
        const quality = prev.db.quality;
        // A ball already tipped is slow and hanging: easier to pick.
        const odds = tipped && prev.db.kind !== 'block' ? this.db.params.intChance * (0.7 + quality) : this.db.params.intChance * quality;
        const pick = (isAttempt(prev.db.kind) || (tipped && prev.db.kind === 'body')) && this.rng.chance(odds);
        if (pick) {
          const db = this.db;
          ball.attachTo(db);
          db.hasBall = true;
          db.catchInfo = { type: tipped ? 'juggle' : prev.db.kind === 'dive' ? 'dive' : 'leap', toeTap: false };
          this.emit('pick');
          this.pick = { info: { tips: ball.tips, aggressive: db.aggressive || undefined } };
          // In the air he still has to come down in bounds with it.
          if (db.airborne) return undefined;
          this.settle(db);
          return this.stepPick();
        }
        if (ball.tips < TIP.max && this.rng.chance(TIP.swat)) return this.tipBall('db', 'swat', {});
        ball.deflect(this.rng);
        return this.finish(false, 'swat', { tips: ball.tips });
      }
    }
    return undefined;
  }

  /** The ball comes off his hands and stays alive: everybody gets another play. */
  tipBall(who, reason, info) {
    this.ball.tip(this.rng);
    this.tipReason = reason;
    this.tipInfo = { ...info, tips: this.ball.tips };
    this.wrTried = false;
    this.dbTried = false;
    this.approach.wr = false;
    this.approach.db = false;
    this.prevReach = null;
    this.emit('tip', { who });
    return undefined;
  }

  /** Caught it with his feet still on the turf (legs loading for a jump): he stays down there. */
  settle(a) {
    if (a.gather > 0) {
      a.gather = 0;
      a.jumpPlan = null;
      a.attempting = false;
    }
  }

  /**
   * Where a man who caught it on his feet put them, and whether that was in
   * bounds: the foot he is standing on, and the next one down. Near a line
   * he drags that one in if he can.
   */
  groundRuling(a) {
    const ff = a.footfall(true);
    if (ff.dragged) {
      a.feetDown = ff.feet;
      a.feetDownThisTick = true;
      a.dragged = true;
      a.toeDrag = TOE.drag;
    }
    return this.feetRuling(ff.feet, ff.dragged);
  }

  /** Where a man who caught it in the air came down: both feet, or his body if he went down. */
  landingRuling(a) {
    if (a.down || !a.feetDown) {
      const spot = a.bodyDown ? { ...a.bodyDown } : { x: a.pos.x, z: a.pos.z };
      return { out: spotInBounds(spot) ? 0 : 1, spot, kind: 'body', toeTap: false };
    }
    return this.feetRuling(a.feetDown, a.dragged);
  }

  feetRuling(feet, dragged) {
    const out = feetOut(feet);
    const spot = { x: (feet[0].x + feet[1].x) / 2, z: (feet[0].z + feet[1].z) / 2 };
    // A toe-tap: he had to drag them in to get them down by the line.
    const byLine = (f) => FIELD.halfWidth - Math.abs(f.x) < 0.6 || f.z - FIELD.endZ < 0.6;
    return { out, spot, kind: 'feet', toeTap: !out && dragged && feet.some(byLine) };
  }

  /** Has a man who caught it in the air come back to earth? */
  cameDown(a) {
    return !a.airborne && (!a.down || a.y <= 0);
  }

  /**
   * He has it in his hands. Usually that is the catch; but he has to have
   * come down with it in bounds, and if the defender is about to arrive, or
   * he dove and still has to land, he has to finish it.
   */
  secure(info, separation) {
    const wr = this.wr;
    const db = this.db;
    this.settle(wr);
    // Is the defender near enough, and coming, to get there before it is tucked away?
    let closing = 0;
    if (separation > 1e-3) {
      closing = ((db.vel.x - wr.vel.x) * (wr.pos.x - db.pos.x) + (db.vel.z - wr.vel.z) * (wr.pos.z - db.pos.z)) / separation;
    }
    const threat = !db.down && separation < CONTACT.threat && closing > CONTACT.closing;
    if (!wr.airborne) {
      // Feet on the turf: they have to be in bounds, and so does the next one down.
      const ruling = this.groundRuling(wr);
      if (ruling.out) return this.noCatch(info, ruling);
      info.toeTap = ruling.toeTap;
      info.spot = ruling.spot;
      if (!threat) return this.completeCatch(info);
    }
    wr.securing = true;
    this.securing = { until: this.t + CONTACT.window, needGround: wr.diving, needFeet: wr.airborne && !wr.diving, threat, hitDone: false, info };
    return undefined;
  }

  stepSecuring(contact) {
    const s = this.securing;
    const wr = this.wr;
    if (contact && contact.closing >= CONTACT.minHit && !s.hitDone) return this.resolveHit(contact);
    if (s.needGround || s.needFeet) {
      if (!this.cameDown(wr)) return undefined; // still in the air
      const ruling = this.landingRuling(wr);
      if (ruling.out) return this.noCatch(s.info, ruling);
      s.info.toeTap = ruling.toeTap;
      s.info.spot = ruling.spot;
      // The ground is the last defender (unless he has already held on through a hit).
      if (s.needGround && !s.hitDone && !this.rng.chance(groundHoldProbability(wr))) {
        wr.hasBall = false;
        this.ball.deflect(this.rng, 0.5);
        return this.finish(false, 'drop', { ...s.info, lostToGround: true });
      }
      s.needGround = false;
      s.needFeet = false;
      if (wr.down || !s.threat || s.hitDone || this.t >= s.until) return this.completeCatch(s.info);
      return undefined;
    }
    if (this.t >= s.until) return this.completeCatch(s.info);
    return undefined;
  }

  /** He had it, but he did not come down in bounds with it. */
  noCatch(info, ruling) {
    const wr = this.wr;
    wr.hasBall = false;
    this.ball.deflect(this.rng, 0.3);
    return this.finish(false, 'oob', { ...info, feetOut: ruling.kind === 'feet' ? ruling.out : 0, bodyOut: ruling.kind === 'body' });
  }

  /**
   * The defender arrives with the ball in the receiver's hands. Whether the
   * ball stays there is one question; whether either man stays on his feet
   * is another, and that one is settled by balance. A man who holds on in
   * the air still has to come down in bounds.
   */
  resolveHit(contact) {
    const s = this.securing;
    const wr = this.wr;
    const db = this.db;
    const p = holdOnProbability({ wr, db, closing: contact.closing, catchType: s.info.catchType, airborne: wr.airborne || wr.diving });
    const held = this.rng.chance(p);
    const info = { ...s.info, hit: contact.closing };
    const down = this.strike(contact, 'wr', { outOfAir: true }) === 'fall';
    this.strike(contact, 'db');
    this.report();
    this.emit('hit', { power: contact.closing, held, down });
    if (held) {
      s.info = { ...info, throughContact: true, knockedDown: down };
      s.hitDone = true;
      if (s.needGround || s.needFeet) return undefined;
      return this.completeCatch(s.info);
    }
    wr.hasBall = false;
    this.ball.deflect(this.rng, 0.8);
    return this.finish(false, 'hit', { ...info, knockedDown: down });
  }

  /** An interception made in the air: it is his once he comes down in bounds with it. */
  stepPick() {
    const db = this.db;
    if (!this.cameDown(db)) return undefined;
    const info = this.pick.info;
    const ruling = db.feetDownThisTick || db.down ? this.landingRuling(db) : this.groundRuling(db);
    if (ruling.out) {
      db.hasBall = false;
      this.ball.deflect(this.rng, 0.3);
      return this.finish(false, 'oob', { ...info, pickOob: true, feetOut: ruling.kind === 'feet' ? ruling.out : 0, bodyOut: ruling.kind === 'body' });
    }
    return this.finish(false, 'int', { ...info, pickYard: yardLine(ruling.spot.z) });
  }

  /** Is the ball in his hands across the goal line, in bounds? */
  brokePlane() {
    const b = this.ball;
    const wr = this.wr;
    return b.holder === wr && b.state === 'caught' && b.pos.z <= FIELD.goalZ && Math.abs(b.pos.x) < FIELD.halfWidth && Math.abs(wr.pos.x) < FIELD.halfWidth;
  }

  /**
   * The catch is made. In the end zone it is a touchdown; on the turf he is
   * down where he is; otherwise he is a ball carrier now.
   */
  completeCatch(info) {
    const wr = this.wr;
    this.securing = null;
    wr.securing = false;
    const spot = info.spot || { x: wr.pos.x, z: wr.pos.z };
    info = { ...info, toeTap: Boolean(info.toeTap), catchYard: yardLine(spot.z) };
    delete info.spot;
    wr.catchInfo = { type: info.catchType, toeTap: info.toeTap };
    if (inEndZone(spot) || this.brokePlane()) {
      return this.finish(true, 'touchdown', { ...info, touchdown: true, endedBy: 'endzone', endYard: 0, yac: 0, brokenTackles: 0 });
    }
    if (wr.down) {
      return this.finish(true, 'catch', { ...info, touchdown: false, endedBy: info.knockedDown ? 'hit' : 'down', endYard: info.catchYard, yac: 0, brokenTackles: 0 });
    }
    this.phase = 'run';
    this.run = { t: 0, info, startZ: spot.z, broken: 0, rest: 0, wrap: null, diveTried: false, tackledBy: null };
    this.emit('caught', { catchType: info.catchType, toeTap: info.toeTap });
    return undefined;
  }

  // ------------------------------------------------------- after the catch

  stepRun(dt) {
    this.t += dt;
    const run = this.run;
    run.t += dt;
    run.rest = Math.max(0, run.rest - dt);
    // A human defender keeps his closing burst while he chases.
    if (!this.dbCtl.isAI) this.db.speedCap = USER_ASSIST.closingBurst;
    const contact = this.stepAthletes(dt);
    this.tackling(dt, contact);
    this.ball.step(dt);
    if (this.result) return undefined;
    const wr = this.wr;
    if (this.brokePlane()) return this.endRun(true, 'endzone');
    if (!spotInBounds(wr.pos)) return this.endRun(false, wr.sinceContact < 0.5 ? 'pushed' : 'oob');
    if (wr.down) return this.endRun(false, run.tackledBy || (wr.diveKind === 'carry' ? 'stretch' : 'down'));
    if (run.t >= RUN.maxTime) return this.endRun(false, 'whistle');
    return undefined;
  }

  /** The play after the catch is over: in the end zone, or stopped short of it. */
  endRun(touchdown, endedBy) {
    const run = this.run;
    run.wrap = null;
    const spotZ = touchdown ? FIELD.goalZ : this.ball.state === 'caught' ? this.ball.pos.z : this.wr.pos.z;
    const info = {
      ...run.info,
      touchdown,
      endedBy,
      stretched: this.wr.diving && this.wr.diveKind === 'carry', // dove for it
      endYard: touchdown ? 0 : yardLine(spotZ),
      yac: Math.max(0, run.startZ - spotZ),
      brokenTackles: run.broken,
    };
    return this.finish(true, touchdown ? 'touchdown' : 'catch', info);
  }

  /** The ball carrier presses to leave his feet: he dives ahead, stretching the ball out. */
  carrierDive() {
    const wr = this.wr;
    if (wr.airborne || wr.down || wr.gather > 0 || wr.toeDrag > 0) return null;
    let dx = wr.vel.x;
    let dz = wr.vel.z;
    const speed = Math.hypot(dx, dz);
    if (speed < 2) {
      dx = Math.sin(wr.facing);
      dz = Math.cos(wr.facing);
    }
    const n = Math.hypot(dx, dz) || 1;
    // Wrapped up, it is a lunge: whatever he has left, and a push.
    const lunge = Boolean(this.run?.wrap);
    const go = lunge ? clamp(speed + 2.2, 3.5, 5.5) : clamp(speed + 1.2, DIVE.minSpeed, 8.5);
    return { dive: true, x: dx / n, z: dz / n, speed: go, air: lunge ? 0.34 : 0.42, kind: 'carry' };
  }

  /**
   * The defender presses to leave his feet after the catch: he lays out at
   * the ball carrier's legs, leading him. Too close for that, or too far,
   * and it does nothing (null).
   */
  tackleDive() {
    const wr = this.wr;
    const db = this.db;
    if (db.airborne || db.down || db.gather > 0 || wr.down || this.run?.wrap) return null;
    const d = Math.hypot(wr.pos.x - db.pos.x, wr.pos.z - db.pos.z);
    if (d < TACKLE.diveMin || d > TACKLE.diveRange) return null;
    const lead = clamp(d / 8, 0.12, 0.45);
    const tx = wr.pos.x + wr.vel.x * lead - db.pos.x;
    const tz = wr.pos.z + wr.vel.z * lead - db.pos.z;
    const td = Math.hypot(tx, tz) || 1;
    const air = clamp(lead + 0.12, DIVE.minAir, 0.52);
    const speed = clamp((td - DIVE.reach * 0.6) / Math.max(lead, 0.15), DIVE.minSpeed, TACKLE.diveSpeed);
    return { dive: true, x: tx / td, z: tz / td, speed, air, kind: 'tackle' };
  }

  /** A wrapped-up runner has the tackler on him: hands for the picture, and his legs are not free. */
  holdOn() {
    const w = this.run?.wrap;
    if (!w) return;
    this.wr.held = 1;
    this.wr.hands = { kind: 'wrapped', k: 1, on: true, side: w.side };
    this.db.hands = { kind: 'wrap', k: 1, on: true, side: -w.side };
  }

  /**
   * After the catch the defender has to bring him down. With his arms on
   * him and in front of him enough to get them round him, he tries to: a
   * made tackle that arrives with real speed knocks him off his feet; any
   * other wraps him up, and he churns forward until he goes down, or breaks
   * it. A miss leaves the runner stumbling on and the tackler off balance.
   * A defender who lays out at his legs takes them out or trips him up.
   */
  tackling(dt, contact) {
    const run = this.run;
    const wr = this.wr;
    const db = this.db;
    if (run.wrap) return this.stepWrap(dt);
    if (!db.diving) run.diveTried = false;
    if (wr.down || db.down || this.result) return undefined;
    if (db.diving) {
      // Laid out at his legs, or still in the air from going for the ball or the man.
      if (!run.diveTried) this.checkDiveTackle();
      return undefined;
    }
    if (wr.diving || db.airborne || db.gather > 0 || run.rest > 0) return undefined;
    const dx = wr.pos.x - db.pos.x;
    const dz = wr.pos.z - db.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > TACKLE.reach || d < 1e-4) return undefined;
    // He has to be facing him to get his arms round him.
    const facing = (dx * Math.sin(db.facing) + dz * Math.cos(db.facing)) / d;
    if (facing < 0.2 && !contact) return undefined;
    return this.attemptTackle(dx / d, dz / d, clamp(facing, 0, 1));
  }

  /** The tackler gets his arms on him. (nx, nz) points from tackler to runner. */
  attemptTackle(nx, nz, facing) {
    const run = this.run;
    const wr = this.wr;
    const db = this.db;
    const va = -(wr.vel.x * nx + wr.vel.z * nz); // the runner's speed into the tackler
    const vb = db.vel.x * nx + db.vel.z * nz; // ...and the tackler's into him
    const closing = Math.max(0, va + vb);
    const runSpeed = wr.speed;
    // Head on (1) to from behind (0): is the runner coming at him?
    const front = (runSpeed > 1 ? clamp(0.5 + (0.5 * va) / runSpeed, 0, 1) : 1) * (0.6 + 0.4 * facing);
    const sw = wr.params.strength;
    const sd = db.params.strength;
    // In the form strike() uses: normal from receiver to defender.
    const contact = { closing, va, vb, nx: -nx, nz: -nz, aShare: sd / (sw + sd), fresh: true };
    const juking = wr.jukeLock > 0;
    if (this.rng.chance(tackleOdds({ tackler: db, runner: wr, front, juking }))) {
      if (closing >= TACKLE.hitAt) {
        // He arrives with everything he has: a hit that can take him straight off his feet.
        this.strike(contact, 'wr', { scale: 1.4 });
        this.strike(contact, 'db', { scale: 0.4 });
        this.emit('tackle', { kind: 'hit', power: closing });
        this.report();
        if (wr.down) {
          run.tackledBy = 'hit';
          return undefined;
        }
      }
      // Arms round him: he churns, the tackler hangs on and is towed.
      const edge = clamp(0.5 + (sw - sd) / (sw + sd), 0, 1);
      const until = lerp(TACKLE.wrap[0], TACKLE.wrap[1], edge) * (1.15 - 0.3 * front);
      const breaks = this.rng.chance(breakFreeOdds({ tackler: db, runner: wr, front }));
      const lateral = -nz * wr.vel.x + nx * wr.vel.z;
      run.wrap = {
        t: 0,
        until,
        breakAt: breaks ? until * this.rng.range(0.3, 0.85) : null,
        ox: -nx,
        oz: -nz,
        side: lateral >= 0 ? 1 : -1,
      };
      this.emit('wrap', { power: closing });
      return undefined;
    }
    // Missed him: the runner is jolted but slips it; the tackler lunged at air.
    run.broken += 1;
    run.rest = TACKLE.rest;
    this.strike(contact, 'wr', { scale: BALANCE.jostle, floor: BALANCE.floor });
    if (this.strike(contact, 'db', { scale: 0.8 }) === null) db.startStumble(0.55);
    this.emit('broken', { kind: juking ? 'juke' : 'miss' });
    this.report();
    return undefined;
  }

  /** A runner wrapped up: he drives on, dragging the tackler, until he goes down or breaks it. */
  stepWrap(dt) {
    const run = this.run;
    const w = run.wrap;
    const wr = this.wr;
    const db = this.db;
    w.t += dt;
    if (wr.diving) {
      // He lunges out of it with the ball out in front: he is going down either way, and so is the tackler.
      run.wrap = null;
      run.tackledBy = 'wrap';
      db.knockdown({ vx: wr.vel.x * 0.4, vy: 0.6, vz: wr.vel.z * 0.4, high: true }, CONTACT.downTime);
      this.report();
      return undefined;
    }
    // Every step costs him: the more man on him, the more.
    const speed = wr.speed;
    if (speed > 1e-6) {
      const lose = TACKLE.drag * dt * clamp(db.params.strength / wr.params.strength, 0.6, 1.6);
      const k = Math.max(0, speed - lose) / speed;
      wr.vel.x *= k;
      wr.vel.z *= k;
    }
    wr.sinceContact = 0;
    // The tackler goes where he goes.
    db.pos.x = wr.pos.x + w.ox * TACKLE.hold;
    db.pos.z = wr.pos.z + w.oz * TACKLE.hold;
    db.vel.x = wr.vel.x;
    db.vel.z = wr.vel.z;
    db.facing = Math.atan2(-w.ox, -w.oz);
    if (w.breakAt !== null && w.t >= w.breakAt) {
      // He tears out of it, and the man who had him ends up on the turf.
      run.wrap = null;
      run.broken += 1;
      run.rest = TACKLE.rest + 0.3;
      db.knockdown({ vx: w.ox * 1.4, vy: 0.8, vz: w.oz * 1.4, high: false }, CONTACT.downTime);
      wr.startStumble(0.45);
      this.emit('broken', { kind: 'shed' });
      this.report();
      return undefined;
    }
    if (w.t >= w.until) {
      // Down he goes, falling forward the way he was driving, with the tackler on him.
      run.wrap = null;
      run.tackledBy = 'wrap';
      const push = 1.2;
      const n = Math.hypot(wr.vel.x, wr.vel.z);
      const fx = n > 0.3 ? wr.vel.x / n : -w.ox;
      const fz = n > 0.3 ? wr.vel.z / n : -w.oz;
      wr.knockdown({ vx: fx * push, vy: 1, vz: fz * push, high: false }, CONTACT.downTime);
      db.knockdown({ vx: fx * push * 0.8, vy: 0.8, vz: fz * push * 0.8, high: true }, CONTACT.downTime * 0.8);
      this.emit('tackle', { kind: 'wrap' });
      this.report();
    }
    return undefined;
  }

  /** A defender laid out at the runner: do his hands get to the legs? */
  checkDiveTackle() {
    const run = this.run;
    const wr = this.wr;
    const db = this.db;
    const d = db.diveDir;
    let best = Infinity;
    for (const k of [0.45, 0.75, 1]) {
      const pt = { x: db.pos.x + d.x * DIVE.reach * k, y: db.y + 0.45, z: db.pos.z + d.z * DIVE.reach * k };
      best = Math.min(best, distToVerticalSegment(pt, wr.pos.x, wr.pos.z, 0, 1.0));
    }
    if (best > TACKLE.diveRadius) return;
    run.diveTried = true;
    const quality = 1 - best / TACKLE.diveRadius;
    const juking = wr.jukeLock > 0;
    if (this.rng.chance(diveTackleOdds({ quality, tackler: db, runner: wr, juking }))) {
      // Legs taken out from under him: he goes over, forward.
      wr.knockdown({ vx: d.x * 1.2, vy: 0.7, vz: d.z * 1.2, high: false }, CONTACT.downTime);
      run.tackledBy = 'dive';
      this.emit('tackle', { kind: 'dive' });
    } else {
      // A hand on an ankle: he stumbles, and keeps going.
      wr.hit(BALANCE.absorb + 2.4, d.x, d.z, BALANCE.floor);
      run.broken += 1;
      this.emit('broken', { kind: 'trip' });
    }
    this.report();
  }

  finish(complete, reason, info = {}) {
    if (this.result) return;
    this.securing = null;
    this.pick = null;
    this.wr.securing = false;
    if (this.run) this.run.wrap = null;
    this.result = {
      complete,
      reason,
      forced: Boolean(this.throw?.forced),
      called: this.called,
      time: this.t,
      depth: -this.wr.pos.z, // yards downfield at the end of the play
      airYards: this.throw ? this.throw.distance : 0,
      category: this.throw ? this.throw.category : null,
      ...info,
    };
    this.phase = 'done';
    this.tDone = 0;
    this.wr.mood = complete ? 'celebrate' : 'dejected';
    this.db.mood = complete ? 'dejected' : 'celebrate';
    this.wr.faceTarget = null;
    this.db.faceTarget = null;
    // Nobody stops dead at the whistle: they carry their momentum a few steps.
    const carried = (a) => {
      const top = a.params.topSpeed * a.params.jogFactor;
      return { x: a.vel.x / top, z: a.vel.z / top, sprint: false, jump: false, juke: 0 };
    };
    this.carry = { wr: carried(this.wr), db: carried(this.db) };
    this.emit('result', { complete, reason });
  }
}
