import { FIELD, REP } from '../config.js';
import { clamp, dist2 } from '../core/vec.js';
import { blankIntent, steer, playTheBall } from './aiCommon.js';

// Each move is a list of [outside, depth] waypoints in yards from the
// receiver's alignment. `breakIdx` is the waypoint after which he is into his
// final break and may call for the ball. `settle` routes stop and wait;
// `timing` routes are called right at the break, before the defender recovers.
export const MOVES = {
  slant: { pts: [[0, 2.5], [-9, 9]], breakIdx: 0 },
  hitch: { pts: [[0, 7], [-0.8, 5.4]], breakIdx: 0, settle: true, timing: true },
  out: { pts: [[0, 8], [9, 8.3]], breakIdx: 0, timing: true },
  dig: { pts: [[0, 10], [-12, 10.3]], breakIdx: 0 },
  post: { pts: [[0, 11], [-10, 25]], breakIdx: 0 },
  corner: { pts: [[0, 11], [8, 23]], breakIdx: 0 },
  go: { pts: [[0.8, 4], [1.2, 34]], breakIdx: 0, deep: true },
  comeback: { pts: [[0, 14], [3.5, 11.2]], breakIdx: 0, settle: true, timing: true },
  // double moves
  sluggo: { pts: [[0, 2.5], [-3, 5.5], [-3.5, 30]], breakIdx: 1, deep: true },
  outAndUp: { pts: [[0, 6], [3, 6.3], [4, 30]], breakIdx: 1, deep: true },
  hitchAndGo: { pts: [[0, 6], [-0.3, 5.2], [0.5, 30]], breakIdx: 1, deep: true },
  postCorner: { pts: [[0, 10], [-3, 14], [7, 26]], breakIdx: 1 },
};

/** Route mix by rival tier (1-8): better rivals use more of the tree. */
export function moveWeights(tier) {
  const t = clamp((tier - 1) / 7, 0, 1);
  return {
    slant: 1.2,
    hitch: 1.0,
    out: 1.0,
    dig: 0.8 + 0.3 * t,
    post: 0.8 + 0.3 * t,
    corner: 0.6 + 0.4 * t,
    go: 1.0,
    comeback: 0.4 + 0.5 * t,
    sluggo: 0.9 * t,
    outAndUp: 0.9 * t,
    hitchAndGo: 0.8 * t,
    postCorner: 0.7 * t,
  };
}

/**
 * The rival playing receiver. He freestyles a move from his tree, calls for
 * the ball once he is out of his break with separation, then tracks it.
 */
export class ReceiverAI {
  constructor({ rng, tier = 1 }) {
    this.rng = rng;
    this.tier = tier;
    this.isAI = true;
    this.intent = blankIntent();
  }

  setup(rep) {
    const me = rep.wr;
    const side = Math.sign(me.pos.x) || 1;
    this.moveName = this.rng.weighted(moveWeights(this.tier));
    this.move = MOVES[this.moveName];
    const depthScale = this.rng.range(0.85, 1.15);
    this.points = this.move.pts.map(([out, depth]) => ({
      x: clamp(me.pos.x + side * out, -(FIELD.halfWidth - 1.5), FIELD.halfWidth - 1.5),
      z: clamp(me.pos.z - depth * depthScale, FIELD.endZ + 1.5, FIELD.backZ),
    }));
    this.idx = 0;
    this.breakT = null;
    this.finalDir = null;
    this.cadence = this.rng.range(1.9, REP.autoSnapDefense);
    this.needSep = this.rng.range(1.3, 2.1);
    // Polished receivers call it right out of the break. Raw ones are late,
    // which gives the defender time to recover.
    const raw = 1 - clamp((this.tier - 1) / 7, 0, 1);
    this.timingDelay = 0.05 + 0.4 * raw * this.rng.range(0.6, 1);
    this.breakDelay = 0.2 + 0.3 * raw * this.rng.range(0.6, 1);
    this.patience = this.breakDelay + this.rng.range(0.1, 0.4);
    this.jumpLead = this.rng.range(0.75, 1.1);
  }

  update(rep) {
    const out = this.intent;
    out.jump = false;
    out.juke = 0;
    out.call = false;
    out.snap = false;
    const me = rep.wr;

    if (rep.phase === 'presnap') {
      out.x = 0;
      out.z = 0;
      out.snap = rep.tPre >= this.cadence;
      return out;
    }

    if (rep.phase === 'flight') {
      me.faceTarget = null;
      playTheBall(out, me, rep.ball, rep.ball.target, this.jumpLead);
      return out;
    }

    this.runMove(rep, out);
    this.maybeCall(rep, out);
    return out;
  }

  runMove(rep, out) {
    const me = rep.wr;
    const top = me.params.topSpeed;
    const pts = this.points;

    if (this.idx < pts.length) {
      const target = pts[this.idx];
      const from = this.idx === 0 ? this.start || (this.start = { x: me.pos.x, z: me.pos.z }) : pts[this.idx - 1];
      const sx = target.x - from.x;
      const sz = target.z - from.z;
      const dx = target.x - me.pos.x;
      const dz = target.z - me.pos.z;
      const d = Math.hypot(dx, dz);
      const passed = dx * sx + dz * sz <= 0;
      if (d < 0.7 || passed) {
        if (this.idx === this.move.breakIdx) this.breakT = rep.t;
        this.idx += 1;
        if (this.idx >= pts.length) {
          const n = Math.hypot(sx, sz) || 1;
          this.finalDir = { x: sx / n, z: sz / n };
        }
        return this.runMove(rep, out);
      }
      steer(out, me, (dx / d) * top, (dz / d) * top);
      out.sprint = true;
      return;
    }

    if (this.move.settle) {
      // Sit down in the soft spot and show the QB your numbers.
      me.faceTarget = rep.qb.pos;
      steer(out, me, 0, 0);
      return;
    }
    // Keep running through the break, but stay on the field.
    let fx = this.finalDir.x;
    let fz = this.finalDir.z;
    if (Math.abs(me.pos.x) > FIELD.halfWidth - 2.5 && Math.sign(fx) === Math.sign(me.pos.x)) fx = 0;
    if (me.pos.z < FIELD.endZ + 2.5 && fz < 0) fz = 0;
    steer(out, me, fx * top, fz * top);
    out.sprint = true;
  }

  maybeCall(rep, out) {
    if (rep.called || rep.t < 0.55) return;
    const me = rep.wr;
    const db = rep.db;
    const sep = dist2(me.pos, db.pos);
    const depth = -me.pos.z;
    let call = false;

    if (this.breakT !== null) {
      const since = rep.t - this.breakT;
      if (this.move.deep) {
        const stacked = me.pos.z < db.pos.z - 0.4;
        call = since >= 0.3 && ((stacked && depth > 8) || depth > 17);
      } else {
        if (this.move.timing) call = since >= this.timingDelay;
        else call = since >= this.breakDelay && me.speed > me.params.topSpeed * 0.55 && (sep >= this.needSep || since >= this.patience);
      }
    }
    if (rep.t >= 3.4 || (this.breakT !== null && me.stamina < 0.2)) call = true;
    out.call = call;
  }
}
