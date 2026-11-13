import { describe, it, expect } from 'vitest';
import { Ragdoll, CONSTRAINTS, PARTICLE_RADIUS, PARTICLE_MASS, RAGDOLL_STEP } from '../src/physics/ragdoll.js';
import { restPoints, BODY, P, PARTICLE_COUNT } from '../src/physics/body.js';
import { FALL, GRAVITY, SIM_DT } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Athlete, NO_INTENT } from '../src/sim/athlete.js';
import { uniformRatings } from '../src/sim/ratings.js';

const standing = () => restPoints().map(([x, y, z]) => [x, y + BODY.hipHeight, z]);
const read = (rag, i) => rag.get(i, {});

/** Knock a standing, running body over and return how it went. */
function fall({ seconds = 5, vz = 7, shove = [3, 2, 0] } = {}) {
  const rag = new Ragdoll();
  const pts = standing();
  rag.start(pts, pts.map(() => [0, 0, vz]));
  rag.impulse(...shove, true);
  let stretch = 0;
  let lowest = Infinity;
  for (let i = 0; i < seconds * 60; i++) {
    rag.step(1 / 60);
    for (const c of CONSTRAINTS) {
      if (c.kind !== 0 || c.stiffness !== 1) continue; // bones only
      const a = read(rag, c.a);
      const b = read(rag, c.b);
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      stretch = Math.max(stretch, Math.abs(d - c.length) / c.length);
    }
    for (let k = 0; k < PARTICLE_COUNT; k++) {
      const p = read(rag, k);
      if (!Number.isFinite(p.x + p.y + p.z)) throw new Error(`particle ${k} is not finite`);
      lowest = Math.min(lowest, p.y - PARTICLE_RADIUS[k]);
    }
  }
  return { rag, stretch, lowest };
}

describe('ragdoll', () => {
  it('falls over, slides, and comes to rest lying on the turf', () => {
    const { rag } = fall();
    expect(rag.atRest).toBe(true);
    const head = read(rag, P.HEAD);
    const pelvis = read(rag, P.PELVIS);
    expect(head.y).toBeLessThan(0.45);
    expect(pelvis.y).toBeLessThan(0.45);
    // He was running downfield: he ends up downfield of where he was hit.
    expect(pelvis.z).toBeGreaterThan(1.5);
  });

  it('keeps its bones their length and never sinks into the turf', () => {
    for (const shove of [[3, 2, 0], [-6, 1, 4], [0, 5, -8]]) {
      const { stretch, lowest } = fall({ shove });
      expect(stretch).toBeLessThan(0.06);
      expect(lowest).toBeGreaterThan(-1e-6);
    }
  });

  it('knees do not fold backward', () => {
    const { rag } = fall({ shove: [0, 1, -9] });
    // Forward of the body, from the shoulder line and the spine.
    const sl = read(rag, P.SH_L);
    const sr = read(rag, P.SH_R);
    const n = read(rag, P.NECK);
    const pv = read(rag, P.PELVIS);
    const ax = sl.x - sr.x;
    const ay = sl.y - sr.y;
    const az = sl.z - sr.z;
    const ux = n.x - pv.x;
    const uy = n.y - pv.y;
    const uz = n.z - pv.z;
    const f = [ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux];
    const fl = Math.hypot(...f);
    for (const [HIP, KN, FT] of [[P.HIP_L, P.KN_L, P.FT_L], [P.HIP_R, P.KN_R, P.FT_R]]) {
      const h = read(rag, HIP);
      const k = read(rag, KN);
      const t = read(rag, FT);
      const front = ((k.x - (h.x + t.x) / 2) * f[0] + (k.y - (h.y + t.y) / 2) * f[1] + (k.z - (h.z + t.z) / 2) * f[2]) / fl;
      expect(front).toBeGreaterThan(-0.05);
    }
  });

  it('is deterministic, and follows the anchor it is given', () => {
    const a = fall({ seconds: 2 }).rag;
    const b = fall({ seconds: 2 }).rag;
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));

    const rag = new Ragdoll();
    const pts = standing();
    rag.start(pts, pts.map(() => [0, 0, 0]));
    for (let i = 0; i < 240; i++) rag.step(1 / 60, { anchor: { x: 6, z: -4, strength: 0.05 } });
    const pelvis = read(rag, P.PELVIS);
    expect(Math.hypot(pelvis.x - 6, pelvis.z + 4)).toBeLessThan(1);
  });

  it('does nothing until it is started', () => {
    const rag = new Ragdoll();
    rag.step(0.5);
    expect(rag.active).toBe(false);
    expect(Array.from(rag.pos).every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The rest of this file pins down the physics: each test is a way the rag doll
// used to crumple or float.

const N = PARTICLE_COUNT;
const TAU = Math.PI * 2;
const TOTAL_MASS = PARTICLE_MASS.reduce((a, b) => a + b, 0);
const LEGS = [
  [1, P.HIP_L, P.KN_L, P.FT_L],
  [-1, P.HIP_R, P.KN_R, P.FT_R],
];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const velocity = (rag, i) => ({
  x: (rag.pos[i * 3] - rag.prev[i * 3]) / RAGDOLL_STEP,
  y: (rag.pos[i * 3 + 1] - rag.prev[i * 3 + 1]) / RAGDOLL_STEP,
  z: (rag.pos[i * 3 + 2] - rag.prev[i * 3 + 2]) / RAGDOLL_STEP,
});
const speed = (rag, i) => Math.hypot(...Object.values(velocity(rag, i)));

/** Mass-weighted mean of a per-particle vector. */
function weighted(rag, of) {
  const out = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < N; i++) {
    const v = of(rag, i);
    out.x += (PARTICLE_MASS[i] * v.x) / TOTAL_MASS;
    out.y += (PARTICLE_MASS[i] * v.y) / TOTAL_MASS;
    out.z += (PARTICLE_MASS[i] * v.z) / TOTAL_MASS;
  }
  return out;
}
const centre = (rag) => weighted(rag, read);
const drift = (rag) => weighted(rag, velocity);

/** Angular momentum about the centre of mass. */
function spin(rag) {
  const c = centre(rag);
  const v0 = drift(rag);
  const L = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < N; i++) {
    const l = cross(sub(read(rag, i), c), sub(velocity(rag, i), v0));
    L.x += PARTICLE_MASS[i] * l.x;
    L.y += PARTICLE_MASS[i] * l.y;
    L.z += PARTICLE_MASS[i] * l.z;
  }
  return L;
}

/** The torso's own axes: x to his left, y up his spine, z out of his chest. */
function torso(rag) {
  const x = unit(sub(read(rag, P.SH_L), read(rag, P.SH_R)));
  const y = unit(sub(read(rag, P.NECK), read(rag, P.PELVIS)));
  return { x, y, z: unit(cross(x, y)) };
}

/** Standing, turned to face `yaw`, with his feet `lift` off the turf. */
const upright = (yaw = 0, lift = 0) => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return restPoints().map(([x, y, z]) => [x * c + z * s, y + BODY.hipHeight + lift, -x * s + z * c]);
};
const faceDown = (height = 0.5) => restPoints().map(([x, y, z]) => [x, -z + height, y]);
const faceUp = (height = 0.3) => restPoints().map(([x, y, z]) => [x, z + height, -y]);
const still = (pts) => pts.map(() => [0, 0, 0]);

function settle(rag, seconds, options) {
  for (let i = 0; i < seconds * 120; i++) rag.step(1 / 120, options);
  return rag;
}

describe('ragdoll: in the air', () => {
  it('falls and flies like a body in a vacuum: nothing slows it down', () => {
    const rng = new RNG(5);
    const rag = new Ragdoll();
    const pts = upright(0.4, 6);
    // Tumbling, with every limb going its own way.
    rag.start(pts, pts.map((p) => [rng.range(-1.5, 1.5), rng.range(-1.5, 1.5), 8 + 4 * (p[1] - 7)]));
    const from = centre(rag);
    const v = drift(rag);
    const t = 0.6;
    settle(rag, t);
    const to = centre(rag);
    expect(to.x).toBeCloseTo(from.x + v.x * t, 9);
    expect(to.z).toBeCloseTo(from.z + v.z * t, 9);
    // Gravity is applied once a step, hence t + step.
    expect(to.y).toBeCloseTo(from.y + v.y * t - (GRAVITY * t * (t + RAGDOLL_STEP)) / 2, 9);
    // Forward travel in particular: this used to come up a quarter short.
    expect(to.z - from.z).toBeGreaterThan(v.z * t * 0.999);
  });

  it('keeps its spin while it tumbles', () => {
    const rag = new Ragdoll();
    const pts = upright(0, 6);
    rag.start(pts, pts.map((p) => [0, 0, 6 + 5 * (p[1] - 7)]));
    const before = spin(rag);
    settle(rag, 0.6);
    const after = spin(rag);
    const size = (L) => Math.hypot(L.x, L.y, L.z);
    expect(size(before)).toBeGreaterThan(50);
    expect(Math.abs(size(after) - size(before)) / size(before)).toBeLessThan(0.12);
    // And about the same axis.
    expect(dot(unit(before), unit(after))).toBeGreaterThan(0.99);
  });
});

describe('ragdoll: taking over from a pose', () => {
  it('starts from whatever pose it is given without throwing anything', () => {
    const rag = new Ragdoll();
    const pts = upright();
    // Bend him forward at the waist, the way the animation leans a runner: the
    // rag doll's torso is stiffer than that, so the pose has to be fitted.
    const c = Math.cos(0.6);
    const s = Math.sin(0.6);
    const hinge = BODY.hipHeight + 0.3;
    for (const i of [P.NECK, P.HEAD, P.SH_L, P.SH_R, P.EL_L, P.EL_R, P.HA_L, P.HA_R]) {
      const y = pts[i][1] - hinge;
      const z = pts[i][2];
      pts[i][1] = hinge + y * c - z * s;
      pts[i][2] = y * s + z * c;
    }
    rag.start(pts, still(pts));
    let moved = 0;
    for (let i = 0; i < N; i++) {
      // Fitting the pose is not motion: it used to come out as up to 11 yd/s.
      expect(speed(rag, i)).toBeLessThan(1e-9);
      const p = read(rag, i);
      moved = Math.max(moved, Math.hypot(p.x - pts[i][0], p.y - pts[i][1], p.z - pts[i][2]));
    }
    // And it does not move him far.
    expect(moved).toBeLessThan(0.2);
  });

  it('a hit tips him over without changing where the body as a whole is going', () => {
    for (const high of [true, false]) {
      const rag = new Ragdoll();
      const pts = upright();
      rag.start(pts, pts.map(() => [1, 0, -5]));
      const before = drift(rag);
      rag.impulse(4, 0, 1.5, high);
      const after = drift(rag);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.z).toBeCloseTo(before.z, 9);
      // Hit high, his head goes with the shove and his feet the other way; hit low, the reverse.
      const along = (i) => dot(sub(velocity(rag, i), after), unit({ x: 4, y: 0, z: 1.5 }));
      expect(along(P.HEAD) * (high ? 1 : -1)).toBeGreaterThan(1.5);
      expect(along(P.FT_L) * (high ? 1 : -1)).toBeLessThan(-1.5);
    }
  });

  it('a light hit still puts him on the turf, flat, not sunk where he stood', () => {
    const rag = new Ragdoll();
    const pts = upright();
    rag.start(pts, still(pts));
    rag.impulse(3.2, 0, 0, true);
    // From a dead stop he drops to his knees and pitches forward: the slowest fall there is.
    settle(rag, 1.4);
    const pelvis = read(rag, P.PELVIS);
    const head = read(rag, P.HEAD);
    expect(pelvis.y).toBeLessThan(0.3);
    expect(head.y).toBeLessThan(0.35);
    // He went over the way he was pushed: head beyond his hips.
    expect(head.x - pelvis.x).toBeGreaterThan(0.4);
  });
});

describe('ragdoll: joints', () => {
  // Knocked off his feet every which way: running, jumping, hit high and low.
  const rng = new RNG(2024);
  const falls = [];
  for (let run = 0; run < 150; run++) {
    const rag = new Ragdoll();
    const lift = rng.chance(0.4) ? rng.range(0, 0.6) : 0;
    const pts = upright(rng.range(0, TAU), lift);
    const pace = rng.range(2, 9);
    const heading = rng.range(0, TAU);
    rag.start(pts, pts.map(() => [Math.sin(heading) * pace, lift ? rng.range(-2, 0) : 0, Math.cos(heading) * pace]));
    const from = rng.range(0, TAU);
    const shove = rng.range(2, 8);
    rag.impulse(Math.sin(from) * shove, lift ? 0 : 0.3 + 0.06 * shove, Math.cos(from) * shove, rng.chance(0.6));
    const seen = { stretch: 0, lowest: Infinity, behind: 0, splits: -Infinity, crossed: Infinity, knee: Infinity, downAt: null, restedAt: null };
    for (let f = 0; f < 240; f++) {
      rag.step(1 / 60);
      const frame = torso(rag);
      for (const [side, HIP, KN, FT] of LEGS) {
        const thigh = unit(sub(read(rag, KN), read(rag, HIP)));
        const up = dot(thigh, frame.y);
        const back = -dot(thigh, frame.z);
        const out = side * dot(thigh, frame.x);
        // A thigh pointing up his back.
        if (back > 0) seen.behind = Math.max(seen.behind, up);
        seen.splits = Math.max(seen.splits, out);
        seen.crossed = Math.min(seen.crossed, out);
        // The knee against the front of its own thigh.
        const along = dot(frame.x, thigh);
        const hinge = unit({ x: frame.x.x - thigh.x * along, y: frame.x.y - thigh.y * along, z: frame.x.z - thigh.z * along });
        const front = cross(thigh, hinge);
        const h = read(rag, HIP);
        const k = read(rag, KN);
        const t = read(rag, FT);
        const a = BODY.shin / (BODY.thigh + BODY.shin);
        const mid = { x: a * h.x + (1 - a) * t.x, y: a * h.y + (1 - a) * t.y, z: a * h.z + (1 - a) * t.z };
        seen.knee = Math.min(seen.knee, dot(sub(k, mid), front));
      }
      for (const c of CONSTRAINTS) {
        if (c.kind !== 0 || c.stiffness !== 1) continue; // bones only
        const a = read(rag, c.a);
        const b = read(rag, c.b);
        seen.stretch = Math.max(seen.stretch, Math.abs(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - c.length) / c.length);
      }
      for (let i = 0; i < N; i++) {
        const p = read(rag, i);
        if (!Number.isFinite(p.x + p.y + p.z)) throw new Error(`particle ${i} is not finite`);
        seen.lowest = Math.min(seen.lowest, p.y - PARTICLE_RADIUS[i]);
      }
      const time = (f + 1) / 60;
      if (seen.downAt === null && read(rag, P.PELVIS).y < 0.3 && read(rag, P.NECK).y < 0.4) seen.downAt = time;
      if (seen.restedAt === null && rag.atRest) seen.restedAt = time;
    }
    falls.push({ rag, ...seen, fromHisFeet: lift === 0 });
  }

  it('hips stay in their sockets: no splits, no legs crossed over, no thigh up his back', () => {
    for (const f of falls) {
      expect(f.splits).toBeLessThan(Math.sin(1.2)); // 70 degrees apart (three falls in four used to pass this)
      expect(f.crossed).toBeGreaterThan(-Math.sin(0.7));
      expect(f.behind).toBeLessThan(0.5);
    }
  });

  it('knees only fold backward, about their own thigh', () => {
    for (const f of falls) expect(f.knee).toBeGreaterThan(-0.03);
  });

  it('bones keep their length, and nothing goes through the turf', () => {
    for (const f of falls) {
      // (The worst of it is one frame of a hard landing.)
      expect(f.stretch).toBeLessThan(0.1);
      expect(f.lowest).toBeGreaterThan(-1e-6);
    }
  });

  it('he ends up lying flat: on the turf, not propped up in a heap, and still', () => {
    for (const f of falls) {
      expect(f.restedAt).not.toBe(null);
      expect(read(f.rag, P.PELVIS).y).toBeLessThan(0.26);
      expect(read(f.rag, P.HEAD).y).toBeLessThan(0.3);
    }
  });

  it('from his feet he is on the turf in about the time the game allows for it', () => {
    const times = falls.filter((f) => f.fromHisFeet).map((f) => f.downAt).sort((a, b) => a - b);
    expect(times.every((t) => t !== null)).toBe(true);
    const median = times[times.length >> 1];
    expect(Math.abs(median - FALL.topple)).toBeLessThan(0.12);
    // Nobody hangs in the air.
    expect(times[times.length - 1]).toBeLessThan(1.3);
  });
});

describe('ragdoll: on the turf', () => {
  it('lies on the grass, not above it', () => {
    const down = new Ragdoll();
    down.start(faceDown(), still(faceDown()));
    settle(down, 3);
    const y = (rag, i) => read(rag, i).y;
    // Face down his chest is on the turf (the jersey front is 0.16 from the
    // line of his spine; he used to hang 0.1 to 0.15 above it).
    expect(y(down, P.CHEST)).toBeLessThan(0.03);
    expect(y(down, P.NECK)).toBeLessThan(0.22);
    expect(Math.min(y(down, P.SH_L), y(down, P.SH_R))).toBeLessThan(0.17);
    expect(y(down, P.PELVIS)).toBeLessThan(0.16);
    // A leg can lie straight: knee and foot both down.
    for (const i of [P.KN_L, P.KN_R]) expect(y(down, i)).toBeLessThan(PARTICLE_RADIUS[i] + 0.02);
    for (const i of [P.FT_L, P.FT_R]) expect(y(down, i)).toBeLessThan(PARTICLE_RADIUS[i] + 0.02);

    const up = new Ragdoll();
    up.start(faceUp(), still(faceUp()));
    settle(up, 3);
    for (const i of [P.NECK, P.SH_L, P.SH_R, P.PELVIS, P.HIP_L, P.HIP_R]) expect(y(up, i)).toBeLessThan(PARTICLE_RADIUS[i] + 0.03);
    for (const i of [P.KN_L, P.KN_R]) expect(y(up, i)).toBeLessThan(0.14);
    for (const i of [P.FT_L, P.FT_R]) expect(y(up, i)).toBeLessThan(PARTICLE_RADIUS[i] + 0.02);
  });

  it('slides to a stop at the rate the game slides a downed athlete', () => {
    for (const [vx, vz] of [[0, 8], [8, 0], [0, -5]]) {
      const rag = new Ragdoll();
      rag.start(faceUp(), still(faceUp()));
      settle(rag, 1);
      for (let i = 0; i < N; i++) {
        rag.prev[i * 3] = rag.pos[i * 3] - vx * RAGDOLL_STEP;
        rag.prev[i * 3 + 2] = rag.pos[i * 3 + 2] - vz * RAGDOLL_STEP;
      }
      const from = centre(rag);
      settle(rag, 2);
      const to = centre(rag);
      const v = Math.hypot(vx, vz);
      const expected = (v * v) / (2 * FALL.friction);
      expect(Math.hypot(to.x - from.x, to.z - from.z) / expected).toBeGreaterThan(0.92);
      expect(Math.hypot(to.x - from.x, to.z - from.z) / expected).toBeLessThan(1.08);
    }
  });

  it('once he is still he stays still', () => {
    const rag = fall({ seconds: 3 }).rag;
    expect(rag.atRest).toBe(true);
    const from = centre(rag);
    settle(rag, 0.5);
    const to = centre(rag);
    expect(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)).toBeLessThan(0.01);
  });
});

describe('ragdoll: where the game says he is', () => {
  // The game tracks the athlete as a point that topples, lands and slides
  // (sim/athlete.js). The body is started with the athlete's velocity and
  // should end up in the same place by itself; the anchor only takes up slack.
  function knockdowns(anchor) {
    const rng = new RNG(77);
    const out = [];
    for (let run = 0; run < 60; run++) {
      const a = new Athlete({ ratings: uniformRatings(70) });
      const pace = rng.range(2, 9);
      const heading = rng.range(0, TAU);
      a.vel.x = Math.sin(heading) * pace;
      a.vel.z = Math.cos(heading) * pace;
      const from = rng.range(0, TAU);
      const closing = rng.range(4.2, 9.2);
      const hit = { vx: Math.sin(from) * closing * 0.6, vy: 1.2 + 0.25 * closing, vz: Math.cos(from) * closing * 0.6, high: true };
      a.knockdown(hit, 0.7);
      const rag = new Ragdoll();
      const pts = upright(rng.range(0, TAU));
      rag.start(pts, pts.map(() => [a.vel.x, 0, a.vel.z]));
      rag.impulse(hit.vx, hit.vy * 0.25, hit.vz, true);
      const body = centre(rag);
      const start = { x: a.pos.x, z: a.pos.z };
      let apart = 0;
      let moving = 0;
      for (let i = 0; i < 6 / SIM_DT && a.rise === 0; i++) {
        a.step(NO_INTENT, SIM_DT);
        const at = { x: body.x + a.pos.x - start.x, z: body.z + a.pos.z - start.z };
        rag.step(SIM_DT, anchor ? { anchor: { ...at, ...anchor } } : {});
        const c = centre(rag);
        apart = Math.hypot(c.x - at.x, c.z - at.z);
        moving = rag.energy;
      }
      out.push({ apart, moving });
    }
    return out;
  }
  const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];

  it('the body ends up where the athlete does, with nothing holding it there', () => {
    const runs = knockdowns(null);
    // (It used to be yards away, and was towed back.)
    expect(median(runs.map((r) => r.apart))).toBeLessThan(0.5);
    expect(Math.max(...runs.map((r) => r.apart))).toBeLessThan(1.5);
  });

  it('a gentle anchor takes up the slack', () => {
    const runs = knockdowns({ strength: 0.012, maxSpeed: 1 });
    expect(median(runs.map((r) => r.apart))).toBeLessThan(0.2);
    expect(Math.max(...runs.map((r) => r.apart))).toBeLessThan(0.6);
  });

  it('he has finished falling by the time the athlete starts to get up', () => {
    const runs = knockdowns(null);
    // Mean squared speed under half a (yd/s)^2: lying there. Nearly every fall used to be cut off in mid-air.
    const stillFalling = runs.filter((r) => r.moving > 0.5).length;
    expect(stillFalling).toBeLessThanOrEqual(3);
  });

  it('the anchor never carries him faster than it is told', () => {
    const rag = new Ragdoll();
    rag.start(faceUp(), still(faceUp()));
    settle(rag, 1);
    const from = centre(rag);
    settle(rag, 1, { anchor: { x: from.x + 20, z: from.z, strength: 0.05, maxSpeed: 1 } });
    const to = centre(rag);
    expect(to.x - from.x).toBeGreaterThan(0.9);
    expect(to.x - from.x).toBeLessThan(1.01);
  });
});

describe('ragdoll: other players', () => {
  it('a player on his feet is a post he does not fall through', () => {
    const post = { x: 0.9, z: 0, radius: 0.36, top: 1.85 };
    const rag = new Ragdoll();
    const pts = upright(Math.PI / 2); // facing the post
    rag.start(pts, pts.map(() => [3, 0, 0]));
    rag.impulse(4, 0.5, 0, true);
    settle(rag, 2.5, { obstacles: [post] });
    for (let i = 0; i < N; i++) {
      const p = read(rag, i);
      if (p.y > post.top) continue;
      expect(Math.hypot(p.x - post.x, p.z - post.z)).toBeGreaterThan(post.radius + PARTICLE_RADIUS[i] - 0.03);
      expect(p.y).toBeGreaterThan(PARTICLE_RADIUS[i] - 1e-6);
    }
  });

  it('two men on the turf do not pass through each other', () => {
    const under = new Ragdoll();
    under.start(faceUp(), still(faceUp()));
    settle(under, 1);
    // The second man comes down across the first one's thighs.
    const across = restPoints().map(([x, y, z]) => [y - 0.3, -z + 1.0, -0.75 + x]);
    const over = new Ragdoll();
    over.start(across, across.map(() => [0, -1, 0]));
    for (let i = 0; i < 3 * 120; i++) {
      under.step(1 / 120, { obstacles: [{ body: over }] });
      over.step(1 / 120, { obstacles: [{ body: under }] });
    }
    let overlap = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const a = read(under, i);
        const b = read(over, j);
        overlap = Math.max(overlap, PARTICLE_RADIUS[i] + PARTICLE_RADIUS[j] - Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      }
    }
    expect(overlap).toBeLessThan(0.04);
    // He is lying on the other man, not in him: his trunk is held up off the turf.
    expect(read(over, P.PELVIS).y + read(over, P.NECK).y).toBeGreaterThan(0.45);
    for (const rag of [under, over]) {
      for (let i = 0; i < N; i++) {
        const p = read(rag, i);
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(p.y).toBeGreaterThan(PARTICLE_RADIUS[i] - 1e-6);
      }
    }
  });
});
