import { GRAVITY, FALL } from '../config.js';
import { BODY, LEG_LENGTH, ARM_LENGTH, P, PARTICLE_COUNT, restPoints } from './body.js';

const STEP = 1 / 120;
const ITERATIONS = 12;
const N = PARTICLE_COUNT;
const TAU = Math.PI * 2;

// The turf. A body lying flat slows at the same rate the simulation slides a
// downed athlete, so the two agree about where he ends up.
const MU = FALL.friction / GRAVITY;
const G_STEP = GRAVITY * STEP * STEP; // how far gravity moves a part in one sub-step
const BOUNCE = 0.12;
const BOUNCE_MIN = 1.2; // yd/s: slower than this a part just stops

// Muscle. Motion of the body as a whole (falling, sliding, tumbling) is left
// alone; this share of everything else (flailing, folding) is lost each sub-step.
const MUSCLE = 0.03;
// At the moment he is hit he is braced, then he goes limp.
const TONE_TIME = 0.22; // seconds for the bracing to fade
const TONE_TENSE = 0.02;
const TONE_LIMP = 0.0035;

// Joint limits, radians.
const HIP_FLEX = 2.0; // thigh up in front
const HIP_EXTEND = 0.55; // thigh back behind him
const HIP_OUT = 0.8; // legs apart
const HIP_IN = 0.35; // legs crossed
const KNEE_MIN = 0.02; // the knee stays this far (yd) ahead of the hip-foot line
const KNEE_TWIST = 0.9; // how far the shin can swing out to either side of the thigh
const ARM_BACK = 0.75; // sine of how far the upper arm can go behind his back
const LIMIT_STIFFNESS = 0.6;

// A hit turns him about his middle: for each yd/s of shove, a part this far
// (1 yd) above his centre of mass gains this much speed, and one below loses it.
const TOPPLE = 0.55;

// How far each particle's surface is from its centre: what touches the turf.
// These match the meshes in render/athlete/rig.js, so he lies on the grass
// rather than above it.
const RADIUS = new Float64Array(N);
RADIUS[P.HEAD] = BODY.headRadius;
RADIUS[P.NECK] = 0.13;
RADIUS[P.CHEST] = 0.02; // the particle already sits on the front of the ribcage
RADIUS[P.PELVIS] = 0.15;
RADIUS[P.SH_L] = RADIUS[P.SH_R] = 0.15;
RADIUS[P.EL_L] = RADIUS[P.EL_R] = 0.06;
RADIUS[P.HA_L] = RADIUS[P.HA_R] = 0.055;
RADIUS[P.HIP_L] = RADIUS[P.HIP_R] = 0.13;
RADIUS[P.KN_L] = RADIUS[P.KN_R] = 0.075;
RADIUS[P.FT_L] = RADIUS[P.FT_R] = 0.06;

// Heavier parts move less when a constraint pulls on them.
const MASS = new Float64Array(N);
MASS[P.HEAD] = 5;
MASS[P.NECK] = 9;
MASS[P.CHEST] = 9;
MASS[P.PELVIS] = 11;
MASS[P.SH_L] = MASS[P.SH_R] = 7;
MASS[P.EL_L] = MASS[P.EL_R] = 2.4;
MASS[P.HA_L] = MASS[P.HA_R] = 1.4;
MASS[P.HIP_L] = MASS[P.HIP_R] = 9;
MASS[P.KN_L] = MASS[P.KN_R] = 5;
MASS[P.FT_L] = MASS[P.FT_R] = 2.6;
const INV_MASS = MASS.map((m) => 1 / m);
const TOTAL_MASS = MASS.reduce((a, b) => a + b, 0);

// The ribcage and hips move as one braced box.
const TORSO = [P.NECK, P.CHEST, P.PELVIS, P.SH_L, P.SH_R, P.HIP_L, P.HIP_R];
const LEGS = [
  [1, P.HIP_L, P.KN_L, P.FT_L],
  [-1, P.HIP_R, P.KN_R, P.FT_R],
];
const ARMS = [
  [P.SH_L, P.EL_L],
  [P.SH_R, P.EL_R],
];
// Between two bodies the joints alone leave gaps a shin can slip through, so
// each long bone and the trunk also count at their middles: [end, end, radius].
const BONES = [
  [P.HIP_L, P.KN_L, 0.1],
  [P.KN_L, P.FT_L, 0.065],
  [P.HIP_R, P.KN_R, 0.1],
  [P.KN_R, P.FT_R, 0.065],
  [P.SH_L, P.EL_L, 0.065],
  [P.EL_L, P.HA_L, 0.05],
  [P.SH_R, P.EL_R, 0.065],
  [P.EL_R, P.HA_R, 0.05],
  [P.NECK, P.PELVIS, 0.16],
];
const SPHERES = N + BONES.length;
// Where along the hip-foot line the knee sits when the leg is straight.
const KNEE_HIP = BODY.shin / LEG_LENGTH;
const KNEE_FOOT = BODY.thigh / LEG_LENGTH;

const EQUAL = 0;
const MIN = 1;
const MAX = 2;

const REST = restPoints();
const restLength = (a, b) => Math.hypot(REST[a][0] - REST[b][0], REST[a][1] - REST[b][1], REST[a][2] - REST[b][2]);

function buildConstraints() {
  const len = restLength;
  const out = [];
  const add = (a, b, kind = EQUAL, length = len(a, b), stiffness = 1) => out.push({ a, b, kind, length, stiffness });

  // The torso: a braced box that keeps its shape.
  for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) add(TORSO[i], TORSO[j], EQUAL, undefined, 0.9);

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
    // (A leg can lie all but straight on the turf: the knee limit keeps it from locking.)
    add(HIP, FT, MAX, LEG_LENGTH * 0.997);
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

// What a body at ease settles toward: legs long, hips open. Held hard while he
// is braced and barely at all once he is limp, so a heap unfolds onto the turf.
const EASE = [
  { a: P.HIP_L, b: P.FT_L, length: LEG_LENGTH * 0.95 },
  { a: P.HIP_R, b: P.FT_R, length: LEG_LENGTH * 0.95 },
  { a: P.KN_L, b: P.NECK, length: restLength(P.KN_L, P.NECK) },
  { a: P.KN_R, b: P.NECK, length: restLength(P.KN_R, P.NECK) },
];

/**
 * Solve the symmetric 3x3 system I x = b. Returns false (and leaves `out`
 * alone) when I cannot be inverted.
 */
function solveSym(ixx, iyy, izz, ixy, ixz, iyz, bx, by, bz, out) {
  const c00 = iyy * izz - iyz * iyz;
  const c01 = ixz * iyz - ixy * izz;
  const c02 = ixy * iyz - ixz * iyy;
  const det = ixx * c00 + ixy * c01 + ixz * c02;
  if (Math.abs(det) < 1e-9) return false;
  const c11 = ixx * izz - ixz * ixz;
  const c12 = ixy * ixz - ixx * iyz;
  const c22 = ixx * iyy - ixy * ixy;
  out[0] = (c00 * bx + c01 * by + c02 * bz) / det;
  out[1] = (c01 * bx + c11 * by + c12 * bz) / det;
  out[2] = (c02 * bx + c12 * by + c22 * bz) / det;
  return true;
}

const scratch = [0, 0, 0];
const sphereA = [0, 0, 0, 0];
const sphereB = [0, 0, 0, 0];

/**
 * A football player as a rag doll: 16 particles held together by distance
 * constraints and joint limits (position-based dynamics on Verlet
 * integration). No three.js in here, so it runs in Node.
 *
 * World units are yards, y up, the turf is y = 0.
 *
 * Everything that acts inside the body (bones, joints, muscle) leaves the
 * momentum of the body as a whole alone, so only gravity, the turf and other
 * players can change where he is going.
 */
export class Ragdoll {
  constructor() {
    this.pos = new Float64Array(N * 3);
    this.prev = new Float64Array(N * 3);
    this.vel = new Float64Array(N * 3); // scratch: movement per sub-step
    this.press = new Float64Array(N); // how hard the turf pushed back this sub-step
    this.acc = 0; // leftover time not yet simulated
    this.active = false;
    this.calm = 0; // seconds it has been nearly still
    this.energy = 0;
    this.impact = 0; // hardest ground hit this update, yd/s
    this.tone = 0; // 1 braced .. 0 limp
    // The torso's frame and inertia, refreshed before the joints are checked.
    this.frame = new Float64Array(9); // x (his left), y (up his spine), z (out of his chest)
    this.torsoCom = new Float64Array(3);
    this.torsoInertia = new Float64Array(6);
  }

  /**
   * Start falling from a pose. `points` and `velocities` are arrays of
   * [x, y, z] (world space), one per particle.
   */
  start(points, velocities = null) {
    const { pos, prev } = this;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      pos[k] = points[i][0];
      pos[k + 1] = points[i][1];
      pos[k + 2] = points[i][2];
    }
    // Whatever pose he was in, the bones are the lengths they are. Fit the
    // pose first and give it its speed afterwards, so the fitting itself
    // never throws anything.
    for (let i = 0; i < 10; i++) {
      this.limits(1);
      this.solve(true);
      this.ground(false);
    }
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const v = velocities ? velocities[i] : null;
      for (let c = 0; c < 3; c++) prev[k + c] = pos[k + c] - (v ? v[c] : 0) * STEP;
    }
    this.acc = 0;
    this.calm = 0;
    this.energy = 0;
    this.impact = 0;
    this.tone = 1;
    this.active = true;
  }

  /**
   * A hit. It tips him over rather than carrying him off: the top of the body
   * goes with the shove and his legs the other way (`high`, hit in the chest),
   * or the reverse (his legs taken out from under him). Where the body as a
   * whole is going does not change; that is in the velocities it started with.
   * `vy` lifts him off his feet.
   */
  impulse(vx, vy, vz, high = true) {
    const { pos, prev } = this;
    let cy = 0;
    for (let i = 0; i < N; i++) cy += MASS[i] * pos[i * 3 + 1];
    cy /= TOTAL_MASS;
    // Spin about the centre of mass: speed grows with height above it.
    let mean = 0;
    const lever = this.vel; // borrowed as scratch
    for (let i = 0; i < N; i++) {
      lever[i] = Math.max(-1.1, Math.min(1.1, pos[i * 3 + 1] - cy)) * (high ? 1 : -1);
      mean += MASS[i] * lever[i];
    }
    mean /= TOTAL_MASS;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const w = (lever[i] - mean) * TOPPLE;
      prev[k] -= vx * w * STEP;
      prev[k + 1] -= vy * STEP;
      prev[k + 2] -= vz * w * STEP;
    }
    this.calm = 0;
  }

  /**
   * Advance by `dt` seconds in fixed sub-steps.
   *   anchor     { x, z, strength, maxSpeed } eases the body toward where the game says he is
   *   obstacles  [{ x, z, radius, top }] upright cylinders (a player on his feet), or
   *              [{ body }] another Ragdoll lying on the turf
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
    const { pos, prev, vel, press } = this;
    for (let k = 0; k < N * 3; k++) vel[k] = pos[k] - prev[k];
    this.muscle();

    let energy = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      energy += vel[k] * vel[k] + vel[k + 1] * vel[k + 1] + vel[k + 2] * vel[k + 2];
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      prev[k + 2] = pos[k + 2];
      pos[k] += vel[k];
      pos[k + 1] += vel[k + 1] - G_STEP;
      pos[k + 2] += vel[k + 2];
    }
    this.energy = energy / (STEP * STEP) / N; // mean squared speed
    this.tone *= Math.exp(-STEP / TONE_TIME);

    press.fill(0);
    for (let it = 0; it < ITERATIONS; it++) {
      // Joints first, bones after, so the bones have the last word on their length.
      this.limits(LIMIT_STIFFNESS);
      this.solve(false);
      this.ground(true);
    }
    this.contact();
    if (obstacles) for (const o of obstacles) this.avoid(o);
    if (anchor) this.dragTo(anchor);

    if (this.energy < 0.05) this.calm += STEP;
    else this.calm = 0;
  }

  /**
   * Damp everything except the motion of the body as a whole. Works out how
   * the body is moving and turning as if it were rigid, and eases every part
   * toward that. Falling, sliding and tumbling are untouched.
   */
  muscle() {
    const { pos, vel } = this;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const m = MASS[i];
      cx += m * pos[k];
      cy += m * pos[k + 1];
      cz += m * pos[k + 2];
      vx += m * vel[k];
      vy += m * vel[k + 1];
      vz += m * vel[k + 2];
    }
    cx /= TOTAL_MASS;
    cy /= TOTAL_MASS;
    cz /= TOTAL_MASS;
    vx /= TOTAL_MASS;
    vy /= TOTAL_MASS;
    vz /= TOTAL_MASS;
    // Angular momentum and inertia about the centre of mass.
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let ixx = 0;
    let iyy = 0;
    let izz = 0;
    let ixy = 0;
    let ixz = 0;
    let iyz = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const m = MASS[i];
      const rx = pos[k] - cx;
      const ry = pos[k + 1] - cy;
      const rz = pos[k + 2] - cz;
      const ux = vel[k] - vx;
      const uy = vel[k + 1] - vy;
      const uz = vel[k + 2] - vz;
      lx += m * (ry * uz - rz * uy);
      ly += m * (rz * ux - rx * uz);
      lz += m * (rx * uy - ry * ux);
      ixx += m * (ry * ry + rz * rz);
      iyy += m * (rx * rx + rz * rz);
      izz += m * (rx * rx + ry * ry);
      ixy -= m * rx * ry;
      ixz -= m * rx * rz;
      iyz -= m * ry * rz;
    }
    const w = scratch;
    if (!solveSym(ixx, iyy, izz, ixy, ixz, iyz, lx, ly, lz, w)) w[0] = w[1] = w[2] = 0;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      const rx = pos[k] - cx;
      const ry = pos[k + 1] - cy;
      const rz = pos[k + 2] - cz;
      vel[k] += (vx + w[1] * rz - w[2] * ry - vel[k]) * MUSCLE;
      vel[k + 1] += (vy + w[2] * rx - w[0] * rz - vel[k + 1]) * MUSCLE;
      vel[k + 2] += (vz + w[0] * ry - w[1] * rx - vel[k + 2]) * MUSCLE;
    }
  }

  /** Bones and the spacing between body parts. */
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
    if (rigid) return;
    const ease = TONE_LIMP + (TONE_TENSE - TONE_LIMP) * this.tone;
    for (const c of EASE) {
      const a = c.a * 3;
      const b = c.b * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d >= c.length || d < 1e-9) continue; // it only ever opens him out
      const wa = INV_MASS[c.a];
      const wb = INV_MASS[c.b];
      const k = ((d - c.length) / d / (wa + wb)) * ease;
      pos[a] += dx * k * wa;
      pos[a + 1] += dy * k * wa;
      pos[a + 2] += dz * k * wa;
      pos[b] -= dx * k * wb;
      pos[b + 1] -= dy * k * wb;
      pos[b + 2] -= dz * k * wb;
    }
  }

  /** Where the torso is facing, and how hard it is to turn. */
  measureTorso() {
    const { pos, frame, torsoCom, torsoInertia } = this;
    const at = (i, c) => pos[i * 3 + c];
    // x toward his left, y up his spine, z out of his chest.
    let xx = at(P.SH_L, 0) - at(P.SH_R, 0) + at(P.HIP_L, 0) - at(P.HIP_R, 0);
    let xy = at(P.SH_L, 1) - at(P.SH_R, 1) + at(P.HIP_L, 1) - at(P.HIP_R, 1);
    let xz = at(P.SH_L, 2) - at(P.SH_R, 2) + at(P.HIP_L, 2) - at(P.HIP_R, 2);
    let yx = at(P.NECK, 0) - at(P.PELVIS, 0);
    let yy = at(P.NECK, 1) - at(P.PELVIS, 1);
    let yz = at(P.NECK, 2) - at(P.PELVIS, 2);
    const yl = Math.hypot(yx, yy, yz);
    let zx = xy * yz - xz * yy;
    let zy = xz * yx - xx * yz;
    let zz = xx * yy - xy * yx;
    const zl = Math.hypot(zx, zy, zz);
    if (yl < 1e-6 || zl < 1e-6) return false;
    yx /= yl;
    yy /= yl;
    yz /= yl;
    zx /= zl;
    zy /= zl;
    zz /= zl;
    xx = yy * zz - yz * zy;
    xy = yz * zx - yx * zz;
    xz = yx * zy - yy * zx;
    frame[0] = xx;
    frame[1] = xy;
    frame[2] = xz;
    frame[3] = yx;
    frame[4] = yy;
    frame[5] = yz;
    frame[6] = zx;
    frame[7] = zy;
    frame[8] = zz;

    let m = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const i of TORSO) {
      m += MASS[i];
      cx += MASS[i] * at(i, 0);
      cy += MASS[i] * at(i, 1);
      cz += MASS[i] * at(i, 2);
    }
    torsoCom[0] = cx / m;
    torsoCom[1] = cy / m;
    torsoCom[2] = cz / m;
    torsoInertia.fill(0);
    for (const i of TORSO) {
      const rx = at(i, 0) - torsoCom[0];
      const ry = at(i, 1) - torsoCom[1];
      const rz = at(i, 2) - torsoCom[2];
      torsoInertia[0] += MASS[i] * (ry * ry + rz * rz);
      torsoInertia[1] += MASS[i] * (rx * rx + rz * rz);
      torsoInertia[2] += MASS[i] * (rx * rx + ry * ry);
      torsoInertia[3] -= MASS[i] * rx * ry;
      torsoInertia[4] -= MASS[i] * rx * rz;
      torsoInertia[5] -= MASS[i] * ry * rz;
    }
    return true;
  }

  /**
   * Turn a limb at its joint: move `child` a distance `dist` along the unit
   * direction (ex, ey, ez) relative to `joint`. A joint is not a free pivot, so
   * the torso takes the opposite twist and the body as a whole neither moves
   * nor starts to spin.
   */
  couple(joint, child, ex, ey, ez, dist) {
    const { pos, torsoCom, torsoInertia: I } = this;
    const j = joint * 3;
    const c = child * 3;
    const rx = pos[c] - pos[j];
    const ry = pos[c + 1] - pos[j + 1];
    const rz = pos[c + 2] - pos[j + 2];
    // The torque the pair of pushes makes, per unit of push.
    const nx = ry * ez - rz * ey;
    const ny = rz * ex - rx * ez;
    const nz = rx * ey - ry * ex;
    const t = scratch;
    let turn = 0;
    const turned = solveSym(I[0], I[1], I[2], I[3], I[4], I[5], nx, ny, nz, t);
    if (turned) turn = nx * t[0] + ny * t[1] + nz * t[2];
    const wj = INV_MASS[joint];
    const wc = INV_MASS[child];
    const push = dist / (wj + wc + turn);
    pos[c] += ex * push * wc;
    pos[c + 1] += ey * push * wc;
    pos[c + 2] += ez * push * wc;
    pos[j] -= ex * push * wj;
    pos[j + 1] -= ey * push * wj;
    pos[j + 2] -= ez * push * wj;
    if (!turned) return;
    const ax = -t[0] * push;
    const ay = -t[1] * push;
    const az = -t[2] * push;
    for (const i of TORSO) {
      const k = i * 3;
      const px = pos[k] - torsoCom[0];
      const py = pos[k + 1] - torsoCom[1];
      const pz = pos[k + 2] - torsoCom[2];
      pos[k] += ay * pz - az * py;
      pos[k + 1] += az * px - ax * pz;
      pos[k + 2] += ax * py - ay * px;
    }
  }

  /** Joints only go so far: hips, knees and shoulders. `k` is how much of the error to take out. */
  limits(k) {
    if (!this.measureTorso()) return;
    const { pos, frame: F } = this;

    for (const [side, HIP, KN, FT] of LEGS) {
      const h = HIP * 3;
      const n = KN * 3;
      const f = FT * 3;
      let tx = pos[n] - pos[h];
      let ty = pos[n + 1] - pos[h + 1];
      let tz = pos[n + 2] - pos[h + 2];
      const thigh = Math.hypot(tx, ty, tz);
      if (thigh < 1e-6) continue;
      tx /= thigh;
      ty /= thigh;
      tz /= thigh;

      // ---- hip: the thigh stays inside a cone under the pelvis
      const out = side * (tx * F[0] + ty * F[1] + tz * F[2]);
      const up = tx * F[3] + ty * F[4] + tz * F[5];
      const fwd = tx * F[6] + ty * F[7] + tz * F[8];
      const swing = Math.atan2(fwd, -up); // 0 hanging straight down, + raised in front
      const spread = Math.asin(Math.max(-1, Math.min(1, out)));
      let swingTo = swing;
      if (swing > HIP_FLEX || swing < -HIP_EXTEND) {
        // Past the limit: go back to whichever end of the range is nearer.
        const past = swing > HIP_FLEX ? swing - HIP_FLEX : swing + TAU - HIP_FLEX;
        swingTo = past < (TAU - HIP_FLEX - HIP_EXTEND) / 2 ? HIP_FLEX : -HIP_EXTEND;
      }
      const spreadTo = Math.max(-HIP_IN, Math.min(HIP_OUT, spread));
      if (swingTo !== swing || spreadTo !== spread) {
        const so = side * Math.sin(spreadTo);
        const co = Math.cos(spreadTo);
        const su = -Math.cos(swingTo) * co;
        const sf = Math.sin(swingTo) * co;
        const dx = so * F[0] + su * F[3] + sf * F[6] - tx;
        const dy = so * F[1] + su * F[4] + sf * F[7] - ty;
        const dz = so * F[2] + su * F[5] + sf * F[8] - tz;
        const d = Math.hypot(dx, dy, dz);
        if (d > 1e-7) this.couple(HIP, KN, dx / d, dy / d, dz / d, d * thigh * k);
      }

      // ---- knee: a hinge across the thigh that only folds backward
      tx = pos[n] - pos[h];
      ty = pos[n + 1] - pos[h + 1];
      tz = pos[n + 2] - pos[h + 2];
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-6) continue;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // The hinge runs across the hips, square to the thigh.
      const along = F[0] * tx + F[1] * ty + F[2] * tz;
      let hx = F[0] - tx * along;
      let hy = F[1] - ty * along;
      let hz = F[2] - tz * along;
      const hl = Math.hypot(hx, hy, hz);
      if (hl < 0.2) continue; // thigh pointing straight out sideways: no telling
      hx /= hl;
      hy /= hl;
      hz /= hl;
      // The front of the thigh.
      const fx = ty * hz - tz * hy;
      const fy = tz * hx - tx * hz;
      const fz = tx * hy - ty * hx;

      // How far the knee is ahead of the line from hip to foot.
      const ahead =
        (pos[n] - KNEE_HIP * pos[h] - KNEE_FOOT * pos[f]) * fx +
        (pos[n + 1] - KNEE_HIP * pos[h + 1] - KNEE_FOOT * pos[f + 1]) * fy +
        (pos[n + 2] - KNEE_HIP * pos[h + 2] - KNEE_FOOT * pos[f + 2]) * fz;
      if (ahead < KNEE_MIN) {
        const wh = INV_MASS[HIP] * KNEE_HIP;
        const wf = INV_MASS[FT] * KNEE_FOOT;
        const s = ((KNEE_MIN - ahead) / (INV_MASS[KN] + wh * KNEE_HIP + wf * KNEE_FOOT)) * k;
        pos[n] += fx * s * INV_MASS[KN];
        pos[n + 1] += fy * s * INV_MASS[KN];
        pos[n + 2] += fz * s * INV_MASS[KN];
        pos[h] -= fx * s * wh;
        pos[h + 1] -= fy * s * wh;
        pos[h + 2] -= fz * s * wh;
        pos[f] -= fx * s * wf;
        pos[f + 1] -= fy * s * wf;
        pos[f + 2] -= fz * s * wf;
      }

      // The shin folds back behind the thigh, not out to the side.
      let sx = pos[f] - pos[n];
      let sy = pos[f + 1] - pos[n + 1];
      let sz = pos[f + 2] - pos[n + 2];
      const shin = Math.hypot(sx, sy, sz);
      if (shin < 1e-6) continue;
      sx /= shin;
      sy /= shin;
      sz /= shin;
      const side2 = sx * hx + sy * hy + sz * hz;
      const back = -(sx * fx + sy * fy + sz * fz);
      const bend = Math.hypot(side2, back); // sine of the angle between shin and thigh
      // A nearly straight leg has nothing to twist. The limit comes in
      // gradually as the knee bends, so it never switches on with a kick.
      const firm = Math.min(1, (bend - 0.12) / 0.3);
      if (firm <= 0) continue;
      const twist = Math.atan2(side2, back);
      if (Math.abs(twist) <= KNEE_TWIST) continue;
      const to = Math.sign(twist) * KNEE_TWIST;
      const ds = bend * Math.sin(to) - side2;
      const db = bend * Math.cos(to) - back;
      const dx = hx * ds - fx * db;
      const dy = hy * ds - fy * db;
      const dz = hz * ds - fz * db;
      const d = Math.hypot(dx, dy, dz);
      if (d > 1e-7) this.couple(KN, FT, dx / d, dy / d, dz / d, d * shin * k * firm * firm);
    }

    // ---- shoulders: the upper arm does not go far behind his back
    for (const [SH, EL] of ARMS) {
      const s = SH * 3;
      const e = EL * 3;
      let ax = pos[e] - pos[s];
      let ay = pos[e + 1] - pos[s + 1];
      let az = pos[e + 2] - pos[s + 2];
      const arm = Math.hypot(ax, ay, az);
      if (arm < 1e-6) continue;
      ax /= arm;
      ay /= arm;
      az /= arm;
      const fwd = ax * F[6] + ay * F[7] + az * F[8];
      if (fwd >= -ARM_BACK) continue;
      // Push the elbow forward, square to the arm.
      let ex = F[6] - ax * fwd;
      let ey = F[7] - ay * fwd;
      let ez = F[8] - az * fwd;
      const el = Math.hypot(ex, ey, ez);
      if (el < 1e-6) continue;
      this.couple(SH, EL, ex / el, ey / el, ez / el, ((-ARM_BACK - fwd) * arm * k) / el);
    }
  }

  /** The turf: nothing goes through it. Remembers how hard each part was pressed into it. */
  ground(loaded) {
    const { pos, press } = this;
    for (let i = 0; i < N; i++) {
      const k = i * 3 + 1;
      const under = RADIUS[i] - pos[k];
      if (under <= 0) continue;
      pos[k] = RADIUS[i];
      if (loaded) press[i] += under;
    }
  }

  /**
   * Once per sub-step, for everything the turf pushed back on: a dull bounce,
   * and it grips in proportion to the weight on it.
   */
  contact() {
    const { pos, prev, press } = this;
    for (let i = 0; i < N; i++) {
      if (press[i] <= 0) continue;
      const k = i * 3;
      const vy = pos[k + 1] - prev[k + 1];
      if (vy < 0) {
        const speed = -vy / STEP;
        if (speed > this.impact) this.impact = speed;
        prev[k + 1] = speed > BOUNCE_MIN ? pos[k + 1] + vy * BOUNCE : pos[k + 1];
      }
      const vx = pos[k] - prev[k];
      const vz = pos[k + 2] - prev[k + 2];
      const v = Math.hypot(vx, vz);
      // A part with weight on it, or one that has just landed, grips harder.
      const grip = MU * press[i];
      if (v <= grip) {
        prev[k] = pos[k];
        prev[k + 2] = pos[k + 2];
      } else {
        const keep = 1 - grip / v;
        prev[k] = pos[k] - vx * keep;
        prev[k + 2] = pos[k + 2] - vz * keep;
      }
    }
  }

  /** Keep out of another player: on his feet he is an upright cylinder, down he is his own rag doll. */
  avoid(o) {
    const { pos, prev } = this;
    if (o.body) {
      const other = o.body;
      if (other === this || !other.active) return;
      const mine = sphereA;
      const his = sphereB;
      for (let i = 0; i < SPHERES; i++) {
        this.sphere(i, mine);
        for (let j = 0; j < SPHERES; j++) {
          other.sphere(j, his);
          const dx = mine[0] - his[0];
          const dy = mine[1] - his[1];
          const dz = mine[2] - his[2];
          const min = mine[3] + his[3];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          // He does the same for his half.
          const out = (min - d) * 0.5;
          if (i < N) {
            this.pushOut(i * 3, dx / d, dy / d, dz / d, out);
          } else {
            // The middle of a bone: both its ends move.
            this.pushOut(BONES[i - N][0] * 3, dx / d, dy / d, dz / d, out);
            this.pushOut(BONES[i - N][1] * 3, dx / d, dy / d, dz / d, out);
          }
          this.sphere(i, mine);
        }
      }
      // Being pushed out from under him never puts anything through the turf.
      for (let i = 0; i < N; i++) {
        const k = i * 3 + 1;
        if (pos[k] >= RADIUS[i]) continue;
        prev[k] += RADIUS[i] - pos[k];
        pos[k] = RADIUS[i];
      }
      return;
    }
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      if (pos[k + 1] > o.top) continue;
      const dx = pos[k] - o.x;
      const dz = pos[k + 2] - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.radius + RADIUS[i];
      if (d >= min || d < 1e-6) continue;
      this.pushOut(k, dx / d, 0, dz / d, (min - d) * 0.5);
    }
  }

  /** One of the balls another body collides with: a joint, or the middle of a bone. Fills [x, y, z, radius]. */
  sphere(i, out) {
    const { pos } = this;
    if (i < N) {
      out[0] = pos[i * 3];
      out[1] = pos[i * 3 + 1];
      out[2] = pos[i * 3 + 2];
      out[3] = RADIUS[i];
      return out;
    }
    const [a, b, radius] = BONES[i - N];
    out[0] = (pos[a * 3] + pos[b * 3]) / 2;
    out[1] = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2;
    out[2] = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
    out[3] = radius;
    return out;
  }

  /** Move a particle out along a unit normal, and stop it heading back in. The move itself adds no speed. */
  pushOut(k, nx, ny, nz, dist) {
    const { pos, prev } = this;
    pos[k] += nx * dist;
    pos[k + 1] += ny * dist;
    pos[k + 2] += nz * dist;
    prev[k] += nx * dist;
    prev[k + 1] += ny * dist;
    prev[k + 2] += nz * dist;
    const into = (pos[k] - prev[k]) * nx + (pos[k + 1] - prev[k + 1]) * ny + (pos[k + 2] - prev[k + 2]) * nz;
    if (into < 0) {
      prev[k] += nx * into;
      prev[k + 1] += ny * into;
      prev[k + 2] += nz * into;
    }
  }

  /**
   * Ease the whole body toward the anchor without adding speed. `maxSpeed`
   * (yd/s) limits how fast it may be carried.
   */
  dragTo({ x, z, strength = 0.05, maxSpeed = Infinity }) {
    const { pos, prev } = this;
    const cx = (pos[P.PELVIS * 3] + pos[P.NECK * 3]) / 2;
    const cz = (pos[P.PELVIS * 3 + 2] + pos[P.NECK * 3 + 2]) / 2;
    let mx = (x - cx) * strength;
    let mz = (z - cz) * strength;
    const m = Math.hypot(mx, mz);
    const max = maxSpeed * STEP;
    if (m > max) {
      mx *= max / m;
      mz *= max / m;
    }
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

export { RADIUS as PARTICLE_RADIUS, MASS as PARTICLE_MASS, CONSTRAINTS, STEP as RAGDOLL_STEP };
