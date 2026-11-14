import { describe, it, expect } from 'vitest';
import { Ragdoll, CONSTRAINTS, PARTICLE_RADIUS, TONE } from '../src/physics/ragdoll.js';
import { restPoints, BODY, P, PARTICLE_COUNT } from '../src/physics/body.js';

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

  /** The angle at joint b, in degrees: 180 is dead straight. */
  const angle = (rag, a, b, c) => {
    const A = read(rag, a);
    const B = read(rag, b);
    const C = read(rag, c);
    const u = [A.x - B.x, A.y - B.y, A.z - B.z];
    const v = [C.x - B.x, C.y - B.y, C.z - B.z];
    return (Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
  };

  /** Knock him over and report how far his joints folded on the way, and how he ended up. */
  function crumple(tone, shove, vz = 7, high = true) {
    const rag = new Ragdoll();
    rag.tone = tone;
    const pts = standing();
    rag.start(pts, pts.map(() => [0, 0, vz]));
    rag.impulse(...shove, high);
    let knee = 180;
    let hip = 180;
    for (let i = 0; i < 5 * 60; i++) {
      rag.step(1 / 60);
      knee = Math.min(knee, angle(rag, P.HIP_L, P.KN_L, P.FT_L), angle(rag, P.HIP_R, P.KN_R, P.FT_R));
      hip = Math.min(hip, angle(rag, P.NECK, P.PELVIS, P.KN_L), angle(rag, P.NECK, P.PELVIS, P.KN_R));
    }
    const head = read(rag, P.HEAD);
    const span = Math.max(
      ...[P.FT_L, P.FT_R].map((f) => {
        const foot = read(rag, f);
        return Math.hypot(head.x - foot.x, head.y - foot.y, head.z - foot.z);
      })
    );
    const kneesAtRest = Math.min(angle(rag, P.HIP_L, P.KN_L, P.FT_L), angle(rag, P.HIP_R, P.KN_R, P.FT_R));
    return { rag, knee, hip, span, kneesAtRest };
  }

  const SHOVES = [
    [[3, 2, 0], 7, true],
    [[-6, 1, 4], 7, true],
    [[0, 1, -9], 7, true],
    [[5, 1, 0], 0, false],
    [[0, 0.5, 0], 0, true], // his legs just go from under him
    [[-3, 4, -3], 9, false],
  ];

  it('stiff joints: he falls like an athlete, not a sack, and ends up laid out', () => {
    expect(TONE.length).toBeGreaterThan(8);
    for (const [shove, vz, high] of SHOVES) {
      const limp = crumple(0, shove, vz, high);
      const stiff = crumple(1, shove, vz, high);
      // His knees and hips fold less on the way down...
      expect(stiff.knee).toBeGreaterThan(limp.knee + 10);
      expect(stiff.knee).toBeGreaterThan(70);
      expect(stiff.hip).toBeGreaterThan(100);
      // ...and he does not come to rest in a heap.
      expect(stiff.rag.atRest).toBe(true);
      expect(stiff.span).toBeGreaterThan(1.5);
      expect(stiff.kneesAtRest).toBeGreaterThan(120);
      expect(stiff.span).toBeGreaterThanOrEqual(limp.span - 0.1);
    }
    // Dropped straight down with no tone at all, he folds up on himself.
    expect(crumple(0, [0, 0.5, 0], 0).span).toBeLessThan(1.1);
  });

  it('joints never fold past what a body can do, however he is hit', () => {
    for (const [shove, vz, high] of SHOVES) {
      for (const scale of [1, 2.5]) {
        const hard = crumple(1, shove.map((v) => v * scale), vz, high);
        expect(hard.knee).toBeGreaterThan(55);
        expect(hard.hip).toBeGreaterThan(60);
      }
    }
  });

  it('knows how he is lying', () => {
    const lay = (pitch) => {
      // Lay the standing body down, face down (+) or rolled onto its back (-), head toward +z.
      const rag = new Ragdoll();
      const pts = restPoints().map(([x, y, z]) => [x * pitch, 0.25 - z * pitch, y]);
      rag.start(pts, pts.map(() => [0, 0, 0]));
      for (let i = 0; i < 120; i++) rag.step(1 / 60);
      return rag.lie();
    };
    const prone = lay(1);
    expect(prone.up).toBeLessThan(-0.6);
    expect(prone.az).toBeGreaterThan(0.95);
    expect(prone.flat).toBeGreaterThan(0.9);
    const supine = lay(-1);
    expect(supine.up).toBeGreaterThan(0.6);
    expect(supine.az).toBeGreaterThan(0.95);
    const up = new Ragdoll();
    up.start(standing(), null);
    expect(up.lie().flat).toBeLessThan(0.05);
  });

  it('his own muscles can move him: softly, or exactly', () => {
    const goal = new Float64Array(PARTICLE_COUNT * 3);
    standing().forEach(([x, y, z], i) => goal.set([x + 2, y, z - 1], i * 3));
    const far = (rag) => {
      let worst = 0;
      for (let k = 0; k < PARTICLE_COUNT * 3; k++) worst = Math.max(worst, Math.abs(rag.pos[k] - goal[k]));
      return worst;
    };
    const { rag } = fall({ seconds: 2 });
    const start = far(rag);
    // A soft pull closes the distance gradually, and he is still resting on the turf.
    rag.moveTo(goal, 0.02);
    for (let i = 0; i < 6; i++) rag.step(1 / 60);
    const part = far(rag);
    expect(part).toBeLessThan(start);
    expect(part).toBeGreaterThan(start * 0.2);
    // Full drive puts every part where it should be, and holds it there against gravity.
    rag.moveTo(goal, 1);
    for (let i = 0; i < 30; i++) rag.step(1 / 60);
    expect(far(rag)).toBeLessThan(0.03); // all but the soles, which the goal put a hair into the turf
    // Let go, and he drops.
    rag.moveTo(null, 0);
    for (let i = 0; i < 120; i++) rag.step(1 / 60);
    expect(read(rag, P.HEAD).y).toBeLessThan(0.6);
  });

  it('does nothing until it is started', () => {
    const rag = new Ragdoll();
    rag.step(0.5);
    expect(rag.active).toBe(false);
    expect(Array.from(rag.pos).every((v) => v === 0)).toBe(true);
  });
});
