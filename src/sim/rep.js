import { QB, WR_START_X, BODY_RADIUS, USER_ASSIST, CONTACT, TIP } from '../config.js';
import { clamp, dist2 } from '../core/vec.js';
import { Athlete, NO_INTENT } from './athlete.js';
import { Ball } from './ball.js';
import { Quarterback } from './qb.js';
import {
  reachInfo,
  isAttempt,
  planBallPlay,
  classifyCatch,
  isToeTap,
  catchProbability,
  breakupProbability,
  holdOnProbability,
  groundHoldProbability,
  tipChance,
} from './catching.js';
import { classifyBreak } from './aiCommon.js';

/**
 * One rep of 1-on-1s: receiver vs. defender with the AI QB throwing.
 *
 *   presnap -> live -> flight -> done
 *
 * Controllers (keyboard or AI) are asked for an intent every tick. The rep
 * is pure simulation: it knows nothing about rendering or who the human is.
 *
 * The catch is physical. A ball that comes off hands can pop up and stay
 * alive; a receiver who gets it still has to hold on through a hit, or
 * through the ground if he dove for it, before the rep is his.
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
    this.securing = null; // { until, needGround, info } while a catch is being finished
    this.tipReason = null; // what the incompletion is if a tipped ball falls
    this.tipInfo = null;
    this.touching = false;
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
    // or a dive if that is the only way to get there.
    const live = this.phase === 'flight' && this.ball.state === 'flight';
    this.wr.step(wrI, dt, live && wrI.jump ? planBallPlay(this.wr, this.ball) : null);
    this.db.step(dbI, dt, live && dbI.jump ? planBallPlay(this.db, this.ball) : null);
    for (const who of ['wr', 'db']) {
      const a = this[who];
      if (a.jukedThisTick) this.emit('juke', { who });
      if (a.jumpedThisTick) this.emit('jump', { who });
      if (a.divedThisTick) this.emit('dive', { who });
      if (a.fellThisTick) this.emit('fall', { who, impact: Math.hypot(a.fall?.vx || 0, a.fall?.vy || 0, a.fall?.vz || 0) });
    }
    const contact = this.collide();
    this.jostle(contact);
    return contact;
  }

  /**
   * Bodies can't overlap; the stronger athlete gives less ground.
   * Returns { closing, nx, nz, fresh } when they are touching: how fast they
   * came together along the line from receiver to defender.
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
    // Kill most of the speed each has into the other.
    const va = a.vel.x * nx + a.vel.z * nz;
    const vb = -(b.vel.x * nx + b.vel.z * nz);
    if (va > 0 && !a.airborne) {
      a.vel.x -= nx * va * 0.7 * aShare * 2;
      a.vel.z -= nz * va * 0.7 * aShare * 2;
    }
    if (vb > 0 && !b.airborne) {
      b.vel.x += nx * vb * 0.7 * (1 - aShare) * 2;
      b.vel.z += nz * vb * 0.7 * (1 - aShare) * 2;
    }
    const fresh = !this.touching;
    this.touching = true;
    return { closing: va + vb, va, vb, nx, nz, aShare, fresh };
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
   * What a collision does to balance. Before the whistle only a man who has
   * left his feet can be knocked off them: bumping on the ground stays a bump.
   */
  jostle(contact) {
    if (!contact || contact.closing < CONTACT.minHit || this.securing) return;
    const done = this.phase === 'done';
    if (contact.fresh) this.emit('contact', { power: contact.closing });
    for (const who of ['wr', 'db']) {
      const me = this[who];
      if (me.down) continue;
      if (me.airborne) {
        if (!me.offBalance) {
          me.offBalance = true;
          me.fall = this.shove(contact, who);
        }
      } else if (done && contact.fresh && contact.closing >= CONTACT.lateHit) {
        // After the whistle: the man carrying less into the collision goes down.
        const mine = who === 'wr' ? contact.va : contact.vb;
        const his = who === 'wr' ? contact.vb : contact.va;
        const share = who === 'wr' ? contact.aShare : 1 - contact.aShare;
        if (mine * (1 - share) <= his * share || contact.closing >= CONTACT.lateHit * 1.6) {
          me.knockdown(this.shove(contact, who), CONTACT.downTime);
        }
      }
    }
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
    if (this.securing) return this.stepSecuring(contact);
    if (this.ball.state === 'flight' && this.ball.tFlight > 0.1) this.checkCatch();
    if (!this.result && hitGround) this.finish(false, this.tipReason || 'ground', this.tipInfo || {});
    return undefined;
  }

  stepDone(dt) {
    this.tDone += dt;
    const carry = this.tDone < 0.28 ? this.carry : null;
    for (const who of ['wr', 'db']) {
      const a = this[who];
      a.speedCap = 1;
      a.coast = true;
      a.step(carry ? carry[who] : NO_INTENT, dt);
      if (a.fellThisTick) this.emit('fall', { who, impact: Math.hypot(a.fall?.vx || 0, a.fall?.vy || 0, a.fall?.vz || 0) });
    }
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
      const info = { p, separation, contested, catchType, tips: ball.tips };
      if (this.rng.chance(p)) {
        if (!this.wr.inBounds) {
          ball.deflect(this.rng, 0.4);
          return this.finish(false, 'oob', info);
        }
        info.toeTap = isToeTap(this.wr);
        ball.attachTo(this.wr);
        this.wr.hasBall = true;
        this.wr.catchInfo = { type: catchType, toeTap: info.toeTap };
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
          ball.attachTo(this.db);
          this.db.hasBall = true;
          this.db.catchInfo = { type: tipped ? 'juggle' : prev.db.kind === 'dive' ? 'dive' : 'leap', toeTap: false };
          return this.finish(false, 'int', { tips: ball.tips });
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

  /**
   * He has it in his hands. Usually that is the catch; but if the defender
   * is about to arrive, or he dove and still has to land, he has to finish it.
   */
  secure(info, separation) {
    const wr = this.wr;
    const db = this.db;
    // Is the defender near enough, and coming, to get there before it is tucked away?
    let closing = 0;
    if (separation > 1e-3) {
      closing = ((db.vel.x - wr.vel.x) * (wr.pos.x - db.pos.x) + (db.vel.z - wr.vel.z) * (wr.pos.z - db.pos.z)) / separation;
    }
    const threat = !db.down && separation < CONTACT.threat && closing > CONTACT.closing;
    if (!wr.diving && !threat) return this.finish(true, 'catch', info);
    wr.securing = true;
    this.securing = { until: this.t + CONTACT.window, needGround: wr.diving, threat, info };
    return undefined;
  }

  stepSecuring(contact) {
    const s = this.securing;
    const wr = this.wr;
    if (contact && contact.closing >= CONTACT.minHit) return this.resolveHit(contact);
    if (s.needGround) {
      if (!wr.down && wr.airborne) return undefined; // still laid out
      // The ground is the last defender.
      if (this.rng.chance(groundHoldProbability(wr))) return this.finish(true, 'catch', s.info);
      wr.hasBall = false;
      this.ball.deflect(this.rng, 0.5);
      return this.finish(false, 'drop', { ...s.info, lostToGround: true });
    }
    if (this.t >= s.until) return this.finish(true, 'catch', s.info);
    return undefined;
  }

  /** The defender arrives with the ball in the receiver's hands. */
  resolveHit(contact) {
    const s = this.securing;
    const wr = this.wr;
    const db = this.db;
    const p = holdOnProbability({ wr, db, closing: contact.closing, catchType: s.info.catchType, airborne: wr.airborne || wr.diving });
    const held = this.rng.chance(p);
    const info = { ...s.info, hit: contact.closing };
    if (!wr.down && (contact.closing >= CONTACT.knockdown || wr.airborne)) {
      wr.knockdown(this.shove(contact, 'wr'), CONTACT.downTime);
    }
    if (!db.down && db.airborne) {
      db.offBalance = true;
      db.fall = this.shove(contact, 'db', 0.6);
    }
    this.emit('hit', { power: contact.closing, held });
    if (held) return this.finish(true, 'catch', { ...info, throughContact: true });
    wr.hasBall = false;
    this.ball.deflect(this.rng, 0.8);
    return this.finish(false, 'hit', info);
  }

  finish(complete, reason, info = {}) {
    if (this.result) return;
    this.securing = null;
    this.wr.securing = false;
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
