import { GRAVITY } from '../config.js';
import { BODY, LEG_LENGTH, ARM_LENGTH, P, PARTICLE_COUNT, restPoints } from './body.js';

const STEP = 1 / 120;
const ITERATIONS = 8;
const TURF_FRICTION = 26; // yd/s^2 of slide lost by a part dragging on the turf
const N = PARTICLE_COUNT;

// How far each particle's surface is from its centre: what touches the turf.
const RADIUS = new Float64Array(N);
RADIUS[P.HEAD] = BODY.headRadius;
RADIUS[P.NECK] = 0.13;
RADIUS[P.CHEST] = 0.1;
RADIUS[P.PELVIS] = 0.15;
RADIUS[P.SH_L] = RADIUS[P.SH_R] = 0.12;
RADIUS[P.EL_L] = RADIUS[P.EL_R] = 0.06;
RADIUS[P.HA_L] = RADIUS[P.HA_R] = 0.055;
RADIUS[P.HIP_L] = RADIUS[P.HIP_R] = 0.13;
RADIUS[P.KN_L] = RADIUS[P.KN_R] = 0.075;
RADIUS[P.FT_L] = RADIUS[P.FT_R] = 0.06;

// Heavier parts move less when a constraint pulls on them.
const INV_MASS = new Float64Array(N);
INV_MASS[P.HEAD] = 1 / 5;
INV_MASS[P.NECK] = 1 / 9;
INV_MASS[P.CHEST] = 1 / 9;
INV_MASS[P.PELVIS] = 1 / 11;
INV_MASS[P.SH_L] = INV_MASS[P.SH_R] = 1 / 7;
INV_MASS[P.EL_L] = INV_MASS[P.EL_R] = 1 / 2.4;
INV_MASS[P.HA_L] = INV_MASS[P.HA_R] = 1 / 1.4;
INV_MASS[P.HIP_L] = INV_MASS[P.HIP_R] = 1 / 9;
INV_MASS[P.KN_L] = INV_MASS[P.KN_R] = 1 / 5;
INV_MASS[P.FT_L] = INV_MASS[P.FT_R] = 1 / 2.6;

// How much of a shove each particle takes when the hit is high or low.
const UPPER = [P.HEAD, P.NECK, P.CHEST, P.SH_L, P.SH_R, P.EL_L, P.EL_R, P.HA_L, P.HA_R];

const EQUAL = 0;
const MIN = 1;
const MAX = 2;

function buildConstraints() {
  const rest = restPoints();
  const len = (a, b) => Math.hypot(rest[a][0] - rest[b][0], rest[a][1] - rest[b][1], rest[a][2] - rest[b][2]);
  const out = [];
  const add = (a, b, kind = EQUAL, length = len(a, b), stiffness = 1) => out.push({ a, b, kind, length, stiffness });

  // The torso: a braced box that keeps its shape.
  const torso = [P.NECK, P.CHEST, P.PELVIS, P.SH_L, P.SH_R, P.HIP_L, P.HIP_R];
  for (let i = 0; i < torso.length; i++) for (let j = i + 1; j < torso.length; j++) add(torso[i], torso[j], EQUAL, undefined, 0.9);

  // Head and neck: free to roll a little, never to fold.
  add(P.HEAD, P.NECK);
  for (const sh of [P.SH_L, P.SH_R]) {
    add(P.HEAD, sh, MIN, len(P.HEAD, sh) * 0.82);
    add(P.HEAD, sh, MAX, len(P.HEAD, sh) * 1.12);
  }
  add(P.HEAD, P.CHEST, MIN, len(P.HEAD, P.CHEST) * 0.8);
  add(P.HEAD, P.PELVIS, MIN, len(P.HEAD, P.PELVIS) * 0.94);

  for (const [SH, EL, HA, HIP, KN, FT, otherKN, otherFT] of [
    [P.SH_L, P.EL_L, P.HA_L, P.HIP_L, P.KN_L, P.FT_L, P.KN_R, P.FT_R],
    [P.SH_R, P.EL_R, P.HA_R, P.HIP_R, P.KN_R, P.FT_R, P.KN_L, P.FT_L],
  ]) {
    add(SH, EL);
    add(EL, HA);
    add(HIP, KN);
    add(KN, FT);
    // Elbows and knees: never locked dead straight, never folded flat.
    add(SH, HA, MAX, ARM_LENGTH * 0.985);
    add(SH, HA, MIN, ARM_LENGTH * 0.3);
    add(HIP, FT, MAX, LEG_LENGTH * 0.985);
    add(HIP, FT, MIN, LEG_LENGTH * 0.42);
    // Limbs stay outside the torso.
    add(EL, P.CHEST, MIN, 0.2);
    add(HA, P.CHEST, MIN, 0.17);
    add(HA, P.PELVIS, MIN, 0.2);
    add(HA, P.NECK, MIN, 0.2);
    add(KN, P.CHEST, MIN, 0.36);
    add(KN, P.NECK, MIN, 0.5);
    add(FT, P.PELVIS, MIN, 0.3);
    // Legs do not pass through each other, or do the splits.
    add(KN, otherKN, MIN, 0.15, 0.5);
    add(FT, otherFT, MIN, 0.14, 0.5);
    add(KN, otherKN, MAX, 0.95, 0.5);
    add(FT, otherFT, MAX, 1.45, 0.5);
  }
  return out;
}

const CONSTRAINTS = buildConstraints();

/**
 * A football player as a rag doll: 16 particles held together by distance
 * constraints (Verlet integration). No three.js in here, so it runs in Node.
 *
 * World units are yards, y up, the turf is y = 0.
 */
export class Ragdoll {
  constructor() {
    this.pos = new Float64Array(N * 3);
    this.prev = new Float64Array(N * 3);
    this.acc = 0; // leftover time not yet simulated
    this.active = false;
    this.calm = 0; // seconds it has been nearly still
    this.energy = 0;
    this.impact = 0; // hardest ground hit this update, yd/s
  }

  /**
   * Start falling from a pose. `points` and `velocities` are arrays of
   * [x, y, z] (world space), one per particle.
   */
  start(points, velocities = null) {
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const pt = points[i];
      const v = velocities ? velocities[i] : null;
      for (let c = 0; c < 3; c++) {
        this.pos[k + c] = pt[c];
        this.prev[k + c] = pt[c] - (v ? v[c] : 0) * STEP;
      }
    }
    this.acc = 0;
    this.calm = 0;
    this.active = true;
    // Whatever pose he was in, the bones are the lengths they are.
    for (let i = 0; i < 4; i++) this.solve(true);
  }

  /** Shove the whole body. `high` hits the chest and shoulders, otherwise the legs. */
  impulse(vx, vy, vz, high = true) {
    for (let i = 0; i < N; i++) {
      const upper = UPPER.includes(i);
      const w = high === upper ? 1.25 : 0.7;
      const k = i * 3;
      this.prev[k] -= vx * w * STEP;
      this.prev[k + 1] -= vy * STEP;
      this.prev[k + 2] -= vz * w * STEP;
    }
    this.calm = 0;
  }

  /**
   * Advance by `dt` seconds in fixed sub-steps.
   *   anchor     { x, z, strength } drags the body toward where the game says he is
   *   obstacles  [{ x, z, radius, top }] upright cylinders he cannot fall through
   */
  step(dt, { anchor = null, obstacles = null } = {}) {
    if (!this.active) return;
    this.impact = 0;
    this.acc = Math.min(this.acc + dt, STEP * 8);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.substep(anchor, obstacles);
    }
  }

  substep(anchor, obstacles) {
    const { pos, prev } = this;
    const g = GRAVITY * STEP * STEP;
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      // Bodies are not floppy: a little damping stands in for muscle.
      const vx = (pos[k] - prev[k]) * 0.992;
      const vy = (pos[k + 1] - prev[k + 1]) * 0.992;
      const vz = (pos[k + 2] - prev[k + 2]) * 0.992;
      energy += vx * vx + vy * vy + vz * vz;
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      prev[k + 2] = pos[k + 2];
      pos[k] += vx;
      pos[k + 1] += vy - g;
      pos[k + 2] += vz;
    }
    this.energy = energy / (STEP * STEP) / N; // mean squared speed

    for (let it = 0; it < ITERATIONS; it++) {
      this.solve(false);
      this.knees();
      this.ground();
    }
    this.contact();
    if (obstacles) for (const o of obstacles) this.avoid(o);
    if (anchor) this.dragTo(anchor);

    if (this.energy < 0.05) this.calm += STEP;
    else this.calm = 0;
  }

  solve(rigid) {
    const { pos } = this;
    for (const c of CONSTRAINTS) {
      const a = c.a * 3;
      const b = c.b * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz);
      if (c.kind === MIN && d >= c.length) continue;
      if (c.kind === MAX && d <= c.length) continue;
      if (d < 1e-9) {
        // Two particles in the same spot: nudge them apart along y.
        pos[b + 1] += 1e-4;
        continue;
      }
      const wa = INV_MASS[c.a];
      const wb = INV_MASS[c.b];
      const k = ((d - c.length) / d / (wa + wb)) * (rigid ? 1 : c.stiffness);
      pos[a] += dx * k * wa;
      pos[a + 1] += dy * k * wa;
      pos[a + 2] += dz * k * wa;
      pos[b] -= dx * k * wb;
      pos[b + 1] -= dy * k * wb;
      pos[b + 2] -= dz * k * wb;
    }
  }

  /** Knees only bend one way: keep each knee on the front side of its leg. */
  knees() {
    const { pos } = this;
    // Forward = (left shoulder - right shoulder) x (neck - pelvis), roughly.
    const ax = pos[P.SH_L * 3] - pos[P.SH_R * 3];
    const ay = pos[P.SH_L * 3 + 1] - pos[P.SH_R * 3 + 1];
    const az = pos[P.SH_L * 3 + 2] - pos[P.SH_R * 3 + 2];
    const ux = pos[P.NECK * 3] - pos[P.PELVIS * 3];
    const uy = pos[P.NECK * 3 + 1] - pos[P.PELVIS * 3 + 1];
    const uz = pos[P.NECK * 3 + 2] - pos[P.PELVIS * 3 + 2];
    let fx = ay * uz - az * uy;
    let fy = az * ux - ax * uz;
    let fz = ax * uy - ay * ux;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-6) return;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    for (const [HIP, KN, FT] of [
      [P.HIP_L, P.KN_L, P.FT_L],
      [P.HIP_R, P.KN_R, P.FT_R],
    ]) {
      const h = HIP * 3;
      const k = KN * 3;
      const f = FT * 3;
      // How far the knee sits in front of the middle of the hip-foot line.
      const mx = (pos[h] + pos[f]) / 2;
      const my = (pos[h + 1] + pos[f + 1]) / 2;
      const mz = (pos[h + 2] + pos[f + 2]) / 2;
      const front = (pos[k] - mx) * fx + (pos[k + 1] - my) * fy + (pos[k + 2] - mz) * fz;
      if (front >= 0.02) continue;
      const push = (0.02 - front) * 0.5;
      pos[k] += fx * push;
      pos[k + 1] += fy * push;
      pos[k + 2] += fz * push;
      pos[h] -= fx * push * 0.25;
      pos[h + 1] -= fy * push * 0.25;
      pos[h + 2] -= fz * push * 0.25;
      pos[f] -= fx * push * 0.25;
      pos[f + 1] -= fy * push * 0.25;
      pos[f + 2] -= fz * push * 0.25;
    }
  }

  /** The turf: nothing goes through it. */
  ground() {
    const { pos } = this;
    for (let i = 0; i < N; i++) {
      const k = i * 3 + 1;
      if (pos[k] < RADIUS[i]) pos[k] = RADIUS[i];
    }
  }

  /** Once per sub-step, for everything touching the turf: a dull bounce, and it grips. */
  contact() {
    const { pos, prev } = this;
    const grip = TURF_FRICTION * STEP * STEP;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      if (pos[k + 1] > RADIUS[i] + 1e-5) continue;
      const vy = pos[k + 1] - prev[k + 1];
      if (vy < 0) {
        if (-vy / STEP > this.impact) this.impact = -vy / STEP;
        prev[k + 1] = pos[k + 1] + vy * 0.12;
      }
      const vx = pos[k] - prev[k];
      const vz = pos[k + 2] - prev[k + 2];
      const v = Math.hypot(vx, vz);
      if (v < 1e-9) continue;
      const keep = Math.max(0, 1 - grip / v);
      prev[k] = pos[k] - vx * keep;
      prev[k + 2] = pos[k + 2] - vz * keep;
    }
  }

  /** Keep out of an upright cylinder (another player on his feet). */
  avoid({ x, z, radius, top }) {
    const { pos } = this;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      if (pos[k + 1] > top) continue;
      const dx = pos[k] - x;
      const dz = pos[k + 2] - z;
      const d = Math.hypot(dx, dz);
      const min = radius + RADIUS[i];
      if (d >= min || d < 1e-6) continue;
      const push = ((min - d) / d) * 0.5;
      pos[k] += dx * push;
      pos[k + 2] += dz * push;
    }
  }

  /** Slide the whole body toward the anchor without adding speed. */
  dragTo({ x, z, strength = 0.05 }) {
    const { pos, prev } = this;
    const cx = (pos[P.PELVIS * 3] + pos[P.NECK * 3]) / 2;
    const cz = (pos[P.PELVIS * 3 + 2] + pos[P.NECK * 3 + 2]) / 2;
    const mx = (x - cx) * strength;
    const mz = (z - cz) * strength;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      pos[k] += mx;
      prev[k] += mx;
      pos[k + 2] += mz;
      prev[k + 2] += mz;
    }
  }

  /** Read one particle into `out` ({ x, y, z } or a THREE.Vector3). */
  get(i, out) {
    const k = i * 3;
    out.x = this.pos[k];
    out.y = this.pos[k + 1];
    out.z = this.pos[k + 2];
    return out;
  }

  get atRest() {
    return this.calm > 0.25;
  }
}

export { RADIUS as PARTICLE_RADIUS, CONSTRAINTS };
