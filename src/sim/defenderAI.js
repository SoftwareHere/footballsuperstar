import { HANDS } from '../config.js';
import { clamp } from '../core/vec.js';
import { norm } from './ratings.js';
import { blankIntent, steer, playTheBall, classifyBreak } from './aiCommon.js';

/**
 * The rival playing cornerback. He sees the receiver slightly in the past
 * (his reaction time), keeps a cushion on top of vertical routes, drives on
 * anything underneath, can be frozen by a juke, and breaks on the ball once
 * he reads the throw. Lined up in press he sits on the line and gets his
 * hands on the receiver before he opens up to run with him.
 *
 * `expect` ('in' | 'out' | 'deep' | 'short') is what the receiver has been
 * running lately. A defender who expects a break cheats his alignment toward
 * it and jumps it faster, but is slower to anything else.
 */
export class DefenderAI {
  constructor({ rng, expect = null, confidence = 0 }) {
    this.rng = rng;
    this.expect = expect;
    this.confidence = confidence;
    this.isAI = true;
    this.intent = blankIntent();
  }

  setup(rep) {
    const me = rep.db;
    const wr = rep.wr;
    const style = this.rng.weighted({ press: 0.45, off: 0.4, soft: 0.15 });
    this.cushion0 =
      style === 'press' ? this.rng.range(1.3, 2.0) : style === 'off' ? this.rng.range(3.5, 5.5) : this.rng.range(6, 7.5);
    const inside = -Math.sign(wr.pos.x || 1);
    this.side = -inside;
    this.shade = inside * 0.5; // inside leverage, toward the QB
    if (this.expect === 'in') this.shade = inside * (0.5 + 0.9 * this.confidence);
    else if (this.expect === 'out') this.shade = -inside * (0.2 + this.confidence); // outside leverage
    else if (this.expect === 'deep') this.cushion0 += 3 * this.confidence;
    else if (this.expect === 'short') this.cushion0 = this.rng.range(1.3, 1.8);
    // Close enough to get his hands on him: he will jam before he bails.
    this.pressUntil = this.cushion0 <= 2.2 ? this.rng.range(0.45, 0.8) : 0;
    me.pos.x = wr.pos.x + this.shade;
    me.pos.z = wr.pos.z - this.cushion0;
    me.facing = 0;
    me.faceTarget = wr.pos;
    this.history = [];
    this.mode = 'backpedal'; // 'backpedal' | 'turn' | 'run'
    this.turnTimer = 0;
    this.biteUntil = -1;
    this.biteSeenT = 0;
    this.throwSeenAt = null;
    this.aimError = null;
    this.jumpLead = 1;
  }

  /** Where the receiver was `seenT` seconds into the rep. */
  perceive(seenT) {
    const h = this.history;
    while (h.length > 2 && h[1].t <= seenT) h.shift();
    return h[0];
  }

  update(rep) {
    const out = this.intent;
    out.jump = false;
    out.juke = 0;
    out.snap = false;
    out.call = false;
    const me = rep.db;
    const wr = rep.wr;
    const p = me.params;

    if (rep.phase === 'presnap') {
      out.x = 0;
      out.z = 0;
      out.sprint = false;
      return out;
    }

    // He reads the receiver's hips as well as his momentum: part of what he
    // sees is where the receiver is trying to go, not just where he is going.
    const read = 0.25 + 0.5 * clamp(norm(me.ratings.agility), 0, 1);
    this.history.push({
      t: rep.t,
      x: wr.pos.x,
      z: wr.pos.z,
      vx: wr.vel.x + (wr.want.x - wr.vel.x) * read,
      vz: wr.vel.z + (wr.want.z - wr.vel.z) * read,
    });

    if (wr.jukedThisTick && rep.t >= this.biteUntil) {
      const edge = (wr.ratings.agility - me.ratings.agility) / 100;
      if (this.rng.chance(clamp(0.4 + edge * 1.2, 0.08, 0.9))) {
        this.biteSeenT = rep.t - p.reaction;
        this.biteUntil = rep.t + this.rng.range(0.22, 0.5);
      }
    }

    if (rep.phase === 'flight' && rep.securing) {
      // The receiver has it but has not finished the catch: go through him.
      me.speedCap = 1;
      me.backpedal = false;
      me.faceTarget = null;
      const top = p.topSpeed;
      const dx = wr.pos.x - me.pos.x;
      const dz = wr.pos.z - me.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      steer(out, me, (dx / d) * top, (dz / d) * top);
      out.sprint = true;
      return out;
    }

    if (rep.phase === 'flight') {
      if (this.throwSeenAt === null) {
        this.throwSeenAt = rep.t + p.reaction * 0.7;
        const read = (norm(me.ratings.agility) + norm(me.ratings.hands)) / 2;
        const sigma = 0.85 - 0.7 * clamp(read, 0, 1);
        this.aimError = { x: this.rng.gauss() * sigma, z: this.rng.gauss() * sigma };
        this.jumpLead = this.rng.range(0.7, 1.15);
      }
      if (rep.t >= this.throwSeenAt) {
        me.speedCap = 1;
        me.backpedal = false;
        me.faceTarget = null;
        const ball = rep.ball;
        // His read sharpens as the ball gets closer.
        const blur = clamp(ball.eta / Math.max(ball.flightTime, 0.01), 0, 1);
        const qx = rep.qb.pos.x - ball.target.x;
        const qz = rep.qb.pos.z - ball.target.z;
        const qn = Math.hypot(qx, qz) || 1;
        const aim = {
          x: ball.target.x + this.aimError.x * blur + (qx / qn) * 0.3,
          z: ball.target.z + this.aimError.z * blur + (qz / qn) * 0.3,
        };
        // He has to actually get to the catch point to make a play on it.
        playTheBall(out, me, ball, aim, this.jumpLead, 1.15);
        return out;
      }
    }

    this.cover(rep, out);
    return out;
  }

  cover(rep, out) {
    const me = rep.db;
    const p = me.params;
    // Guess right and he is on it early; guess wrong and he is a step late.
    let reaction = p.reaction;
    if (this.expect && rep.t > 0.5) {
      const now = classifyBreak(rep.wr.vel, this.side);
      reaction *= now === this.expect ? 1 - 0.55 * this.confidence : 1 + 0.35 * this.confidence;
    }
    let seenT = rep.t - reaction;
    if (rep.t < this.biteUntil) seenT = Math.min(seenT, this.biteSeenT);
    const seen = this.perceive(seenT);

    // Good corners anticipate part of their own delay.
    const lead = reaction * 0.6;
    const px = seen.x + seen.vx * lead;
    const pz = seen.z + seen.vz * lead;
    const vertical = -seen.vz; // receiver's speed toward the end zone

    // A corner who trusts his speed plays tighter; a slower one gives ground.
    const respect = clamp(rep.wr.params.topSpeed / p.topSpeed, 0.7, 1.3) ** 2;
    const cushionNow = seen.z - me.pos.z;
    const onTop = 0.6 + 0.19 * Math.max(0, vertical) * respect;
    let cushion;
    if (vertical > 3) cushion = Math.max(onTop, Math.min(cushionNow, this.cushion0));
    else cushion = 0.78; // nothing deep to respect: drive on him
    // Pressing: hold the line at arm's length until the hands have landed.
    const pressing = rep.t < this.pressUntil && this.mode === 'backpedal' && cushionNow > 0.3;
    if (pressing) cushion = Math.min(cushion, HANDS.full);

    const tx = px + this.shade;
    const tz = pz - cushion;
    const vx = seen.vx + (tx - me.pos.x) * 3.2;
    const vz = seen.vz + (tz - me.pos.z) * 3.2;

    // Backpedal is slow. Once the receiver eats the cushion, flip and run.
    if (this.mode === 'backpedal') {
      const needs = -vz > p.topSpeed * 0.62 + 0.4;
      if (needs && cushionNow < onTop + 0.9) {
        this.mode = 'turn';
        this.turnTimer = p.hipTurn;
      }
    } else if (this.mode === 'turn') {
      this.turnTimer -= rep.dt;
      if (this.turnTimer <= 0) {
        this.mode = 'run';
        me.faceTarget = null;
      }
    }
    const retreating = vz < -0.5;
    me.backpedal = this.mode === 'backpedal' && retreating;
    if (this.mode === 'backpedal') me.speedCap = retreating ? 0.62 : 1;
    else if (this.mode === 'turn') me.speedCap = 0.55;
    else me.speedCap = 1;

    steer(out, me, vx, vz);
  }
}

