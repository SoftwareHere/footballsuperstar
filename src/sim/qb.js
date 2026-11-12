import { FIELD, QB, CATCH_HEIGHT, GRAVITY } from '../config.js';
import { clamp } from '../core/vec.js';

/** Horizontal ball speed: bullets underneath, more air under the deep ball. */
export function ballSpeedFor(distance) {
  return clamp(23.5 - (distance - 15) * 0.18, 17.5, 23.5);
}

/**
 * The QB reads the receiver's body: he throws to where the receiver is
 * heading (the velocity he is driving toward), not just where his momentum
 * points this instant. That is what makes a throw out of a break work.
 */
export function readReceiver(receiver, anticipation = 0.65) {
  const v = receiver.vel;
  const w = receiver.want || v;
  return { x: v.x + (w.x - v.x) * anticipation, z: v.z + (w.z - v.z) * anticipation };
}

function clampInBounds(p) {
  p.x = clamp(p.x, -(FIELD.halfWidth - 1), FIELD.halfWidth - 1);
  p.z = clamp(p.z, FIELD.endZ + 1, FIELD.backZ - 2);
}

/**
 * Lead the receiver: find the spot he reaches if he keeps going at `recvVel`,
 * and the flight time that puts the ball there with him.
 */
export function solveLead({ from, recvPos, recvVel, defPos = null, rng = null, errorScale = 1 }) {
  // Throw him open: shade the ball away from a defender in tight coverage.
  let awayX = 0;
  let awayZ = 0;
  if (defPos) {
    const dx = recvPos.x - defPos.x;
    const dz = recvPos.z - defPos.z;
    const sep = Math.hypot(dx, dz);
    if (sep > 0.05) {
      const amount = 0.75 * clamp(1 - (sep - 1) / 2.5, 0, 1);
      awayX = (dx / sep) * amount;
      awayZ = (dz / sep) * amount;
    }
  }
  let T = 0.8;
  const spot = { x: recvPos.x, z: recvPos.z };
  let distance = 0;
  for (let i = 0; i < 24; i++) {
    spot.x = recvPos.x + recvVel.x * T + awayX;
    spot.z = recvPos.z + recvVel.z * T + awayZ;
    clampInBounds(spot);
    distance = Math.hypot(spot.x - from.x, spot.z - from.z);
    T = Math.max(0.3, distance / ballSpeedFor(distance));
  }
  if (rng) {
    const sigma = (0.16 + 0.011 * distance) * errorScale;
    spot.x += rng.gauss() * sigma;
    spot.z += rng.gauss() * sigma;
    clampInBounds(spot);
  }
  return { target: { x: spot.x, y: CATCH_HEIGHT, z: spot.z }, flightTime: T, distance };
}

/** Peak height of a throw, for tests and camera framing. */
export function apexHeight(fromY, flightTime) {
  const vy = (CATCH_HEIGHT - fromY + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
  return fromY + (vy * vy) / (2 * GRAVITY);
}

/**
 * The AI quarterback. He takes the snap, drops back, and throws when the
 * receiver calls for the ball. If nobody has called by the deadline he throws
 * anyway, to wherever the receiver is heading.
 */
export class Quarterback {
  constructor() {
    this.pos = { x: QB.x, z: QB.z };
    this.state = 'presnap'; // 'presnap' | 'drop' | 'windup' | 'thrown'
    this.windupT = 0;
    this.forced = false;
    this.facing = Math.PI;
  }

  get hand() {
    return { x: this.pos.x + 0.3, y: QB.releaseHeight, z: this.pos.z };
  }

  snap() {
    this.state = 'drop';
  }

  /** Returns a throw description on the tick the ball is released, else null. */
  step(t, dt, { called, receiver, defender = null, rng }) {
    if (this.state === 'presnap' || this.state === 'thrown') return null;

    const k = clamp(t / QB.dropTime, 0, 1);
    this.pos.z = QB.z + (QB.dropZ - QB.z) * k;
    this.facing = Math.atan2(receiver.pos.x - this.pos.x, receiver.pos.z - this.pos.z);

    if (this.state === 'drop') {
      const earliest = QB.minRelease - QB.windup;
      if (called && t >= earliest) {
        this.state = 'windup';
        this.forced = false;
      } else if (t >= QB.deadline) {
        // Out of time: he has to get rid of it.
        this.state = 'windup';
        this.forced = true;
      }
      return null;
    }

    // windup
    this.windupT += dt;
    if (this.windupT < QB.windup) return null;
    this.state = 'thrown';
    const from = this.hand;
    const lead = solveLead({
      from,
      recvPos: receiver.pos,
      recvVel: readReceiver(receiver),
      defPos: defender ? defender.pos : null,
      rng,
      errorScale: this.forced ? 1.35 : 1,
    });
    return { from, ...lead, forced: this.forced };
  }
}
