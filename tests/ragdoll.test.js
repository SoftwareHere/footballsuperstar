import { describe, it, expect } from 'vitest';
import { Ragdoll, CONSTRAINTS, PARTICLE_RADIUS } from '../src/physics/ragdoll.js';
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

  it('does nothing until it is started', () => {
    const rag = new Ragdoll();
    rag.step(0.5);
    expect(rag.active).toBe(false);
    expect(Array.from(rag.pos).every((v) => v === 0)).toBe(true);
  });
});
