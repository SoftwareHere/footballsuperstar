import { QB, WR_START_X, BODY_RADIUS, USER_ASSIST } from '../config.js';
import { clamp, dist2 } from '../core/vec.js';
import { Athlete, NO_INTENT } from './athlete.js';
import { Ball } from './ball.js';
import { Quarterback } from './qb.js';
import { reachInfo, catchProbability, breakupProbability } from './catching.js';
import { classifyBreak } from './aiCommon.js';

/**
 * One rep of 1-on-1s: receiver vs. defender with the AI QB throwing.
 *
 *   presnap -> live -> flight -> done
 *
 * Controllers (keyboard or AI) are asked for an intent every tick. The rep
 * is pure simulation: it knows nothing about rendering or who the human is.
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

  stepAthletes(dt) {
    const wrI = this.wrCtl.update(this, 'wr', dt);
    const dbI = this.dbCtl.update(this, 'db', dt);
    if (wrI.call && !this.called && this.phase === 'live') {
      this.called = true;
      this.callTime = this.t;
      this.wr.callTimer = 0.9;
      this.emit('call');
    }
    this.wr.step(wrI, dt);
    this.db.step(dbI, dt);
    if (this.wr.jukedThisTick) this.emit('juke', { who: 'wr' });
    if (this.db.jukedThisTick) this.emit('juke', { who: 'db' });
    if (this.wr.jumpedThisTick) this.emit('jump', { who: 'wr' });
    if (this.db.jumpedThisTick) this.emit('jump', { who: 'db' });
    this.collide();
  }

  /** Bodies can't overlap; the stronger athlete gives less ground. */
  collide() {
    const a = this.wr;
    const b = this.db;
    let dx = b.pos.x - a.pos.x;
    let dz = b.pos.z - a.pos.z;
    let d = Math.hypot(dx, dz);
    const min = BODY_RADIUS * 2;
    if (d >= min) return;
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
    if (va > 0 && !a.airborne) {
      a.vel.x -= nx * va * 0.7 * aShare * 2;
      a.vel.z -= nz * va * 0.7 * aShare * 2;
    }
    const vb = -(b.vel.x * nx + b.vel.z * nz);
    if (vb > 0 && !b.airborne) {
      b.vel.x += nx * vb * 0.7 * (1 - aShare) * 2;
      b.vel.z += nz * vb * 0.7 * (1 - aShare) * 2;
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
    this.stepAthletes(dt);
    const hitGround = this.ball.step(dt);
    if (this.ball.state === 'flight' && this.ball.tFlight > 0.1) this.checkCatch();
    if (!this.result && hitGround) this.finish(false, 'ground');
  }

  stepDone(dt) {
    this.tDone += dt;
    this.wr.speedCap = 1;
    this.db.speedCap = 1;
    this.wr.step(NO_INTENT, dt);
    this.db.step(NO_INTENT, dt);
    this.collide();
    this.ball.step(dt);
  }

  /**
   * Each athlete gets one play on the ball, at the moment it is closest to
   * his hands. Whoever the ball reaches first plays it first.
   */
  checkCatch() {
    const ballPos = this.ball.pos;
    const wrNow = reachInfo(this.wr, 'wr', ballPos);
    const dbNow = reachInfo(this.db, 'db', ballPos);
    const prev = this.prevReach;
    this.prevReach = { wr: wrNow, db: dbNow };
    if (!prev) return;

    const wrPlay = !this.wrTried && prev.wr.inReach && wrNow.dist > prev.wr.dist;
    const dbPlay = !this.dbTried && prev.db.inReach && dbNow.dist > prev.db.dist;

    if (wrPlay) {
      this.wrTried = true;
      const contested = !this.dbTried && prev.db.inReach && prev.db.kind === 'attempt';
      const separation = dist2(this.wr.pos, this.db.pos);
      const p = catchProbability({
        wr: this.wr,
        db: this.db,
        quality: prev.wr.quality,
        attempting: prev.wr.kind === 'attempt',
        separation,
        dbAttempting: this.db.attempting,
        dbInReach: contested,
      });
      const info = { p, separation, contested };
      if (this.rng.chance(p)) {
        if (!this.wr.inBounds) {
          this.ball.deflect(this.rng, 0.4);
          return this.finish(false, 'oob', info);
        }
        this.ball.attachTo(this.wr);
        this.wr.hasBall = true;
        return this.finish(true, 'catch', info);
      }
      this.ball.deflect(this.rng);
      return this.finish(false, contested || separation < 1.3 ? 'breakup' : 'drop', info);
    }

    if (dbPlay) {
      this.dbTried = true;
      if (this.rng.chance(breakupProbability(prev.db, this.db))) {
        const pick = prev.db.kind === 'attempt' && this.rng.chance(this.db.params.intChance * prev.db.quality);
        if (pick) {
          this.ball.attachTo(this.db);
          this.db.hasBall = true;
          return this.finish(false, 'int');
        }
        this.ball.deflect(this.rng);
        return this.finish(false, 'swat');
      }
    }
  }

  finish(complete, reason, info = {}) {
    if (this.result) return;
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
    this.emit('result', { complete, reason });
  }

}
