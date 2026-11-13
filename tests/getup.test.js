import { describe, it, expect } from 'vitest';
import { Ragdoll, CONSTRAINTS, PARTICLE_RADIUS } from '../src/physics/ragdoll.js';
import { GetUp, standAlong, STAND_ALONG } from '../src/physics/getup.js';
import { restPoints, BODY, P, PARTICLE_COUNT } from '../src/physics/body.js';
import { FALL } from '../src/config.js';

const standing = () => restPoints().map(([x, y, z]) => [x, y + BODY.hipHeight, z]);
const read = (rag, i) => rag.get(i, {});
const FPS = 60;

/**
 * Knock a running man over, let him slide to rest the way the game does
 * (the rag doll is dragged along with where the game says he is), then have
 * him pick himself up. Reports what happened at every frame of the get-up.
 */
function knockdownAndGetUp(shove, vz = 7, high = true) {
  const rag = new Ragdoll();
  const pts = standing();
  rag.start(pts, pts.map(() => [0, 0, vz]));
  rag.impulse(...shove, high);
  // The game's athlete: slides to a stop under friction.
  let x = 0;
  let z = 0;
  let vx = shove[0];
  let svz = vz * 0.45 + shove[2];
  for (let t = 0; t < 1.6; t += 1 / FPS) {
    const speed = Math.hypot(vx, svz);
    if (speed > 0) {
      const k = Math.max(0, speed - FALL.friction / FPS) / speed;
      vx *= k;
      svz *= k;
    }
    x += vx / FPS;
    z += svz / FPS;
    rag.step(1 / FPS, { anchor: { x, z, strength: 0.045, along: standAlong(rag.lie().up) } });
  }
  const lying = rag.lie();
  const getUp = new GetUp();
  getUp.begin(rag, x, z);
  const frames = [];
  const total = Math.round(FALL.getUp * FPS);
  for (let i = 0; i <= total; i++) {
    const u = i / total;
    rag.moveTo(getUp.goal, getUp.update(u));
    rag.tone = 1 - getUp.drive;
    rag.step(1 / FPS);
    let lowest = Infinity; // how far the lowest part of him is off the turf
    let stretch = 0;
    for (let k = 0; k < PARTICLE_COUNT; k++) {
      const p = read(rag, k);
      if (!Number.isFinite(p.x + p.y + p.z)) throw new Error(`particle ${k} is not finite`);
      lowest = Math.min(lowest, p.y - PARTICLE_RADIUS[k]);
    }
    for (const c of CONSTRAINTS) {
      if (c.kind !== 0 || c.stiffness !== 1) continue;
      const a = read(rag, c.a);
      const b = read(rag, c.b);
      stretch = Math.max(stretch, Math.abs(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - c.length) / c.length);
    }
    frames.push({
      u,
      drive: getUp.drive,
      lowest,
      stretch,
      pelvis: read(rag, P.PELVIS),
      head: read(rag, P.HEAD),
      feet: [read(rag, P.FT_L), read(rag, P.FT_R)],
      hands: [read(rag, P.HA_L), read(rag, P.HA_R)],
      knees: [read(rag, P.KN_L), read(rag, P.KN_R)],
    });
  }
  return { rag, getUp, frames, lying, spot: { x, z } };
}

const FALLS = [
  [[3, 2, 0], 7, true],
  [[-6, 1, 4], 7, true],
  [[0, 5, -8], 7, true],
  [[0, 1, -9], 7, true],
  [[5, 1, 0], 0, false],
  [[0, 2, 6], 8, false],
  [[4, 3, 4], 3, true],
  [[0, 0.5, 0], 0, true],
  [[-3, 4, -3], 9, false],
];
const runs = FALLS.map((f) => knockdownAndGetUp(...f));
const at = (run, u) => run.frames[Math.round(u * (run.frames.length - 1))];
const moved = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

describe('getting up', () => {
  it('however he fell, he ends up standing where the game has him', () => {
    for (const run of runs) {
      const end = run.frames[run.frames.length - 1];
      expect(end.pelvis.y).toBeGreaterThan(BODY.hipHeight - 0.08);
      expect(end.head.y).toBeGreaterThan(1.65);
      for (const foot of end.feet) {
        expect(foot.y).toBeLessThan(0.08); // on the turf
        expect(moved(foot, end.pelvis)).toBeLessThan(0.2); // and under his hips
      }
      expect(moved(end.pelvis, run.spot)).toBeLessThan(0.15);
      expect(moved(run.getUp.spot, run.spot)).toBeLessThan(0.15);
    }
  });

  it('never floats: some part of him is on the turf the whole way up, and nothing goes through it', () => {
    for (const run of runs) {
      for (const f of run.frames) {
        expect(f.lowest).toBeLessThan(0.02);
        expect(f.lowest).toBeGreaterThan(-1e-6);
        expect(f.stretch).toBeLessThan(0.04);
      }
    }
  });

  it('gathers himself softly from wherever he landed, then it is all him', () => {
    for (const run of runs) {
      expect(run.frames[0].drive).toBeLessThan(0.03);
      expect(at(run, 0.15).drive).toBeLessThan(0.1);
      expect(at(run, 0.5).drive).toBe(1);
      for (let i = 1; i < run.frames.length; i++) expect(run.frames[i].drive).toBeGreaterThanOrEqual(run.frames[i - 1].drive);
    }
  });

  it('face down he pushes up off his hands onto his knees, steps a foot through and stands over it', () => {
    const prone = runs.filter((r) => r.getUp.path === 'prone');
    expect(prone.length).toBeGreaterThan(2);
    for (const run of prone) {
      expect(run.lying.up).toBeLessThan(0.2);
      // He gathers himself first: nothing lifts while his hands find the turf...
      expect(at(run, 0.16).pelvis.y).toBeLessThan(0.25);
      // (an arm that was trapped under him may still be coming round as he starts to push)
      expect(Math.min(...at(run, 0.28).hands.map((h) => h.y))).toBeLessThan(0.1);
      // ...then he is up on hands and knees: hips high, hands and knees on the turf.
      const table = at(run, 0.4);
      expect(table.pelvis.y).toBeGreaterThan(0.5);
      for (const hand of table.hands) expect(hand.y).toBeLessThan(0.12);
      for (const knee of table.knees) expect(knee.y).toBeLessThan(0.14);
      // Kneeling tall: hands off the turf, both knees still down.
      const kneel = at(run, 0.56);
      for (const hand of kneel.hands) expect(hand.y).toBeGreaterThan(0.3);
      expect(Math.min(...kneel.knees.map((k) => k.y))).toBeLessThan(0.14);
      // One foot is through and flat under him before he rises: one knee up, one down.
      const half = at(run, 0.71);
      const lead = run.getUp.lead;
      expect(half.feet[lead].y).toBeLessThan(0.08);
      expect(half.knees[lead].y).toBeGreaterThan(0.4);
      expect(half.knees[1 - lead].y).toBeLessThan(0.2);
      expect(half.pelvis.y).toBeLessThan(0.75);
      // He stands up over that foot: it does not move again.
      const end = run.frames[run.frames.length - 1];
      expect(moved(half.feet[lead], end.feet[lead])).toBeLessThan(0.03);
      // He gets up facing the way his head was pointing.
      expect(Math.cos(run.getUp.heading) * run.lying.az + Math.sin(run.getUp.heading) * run.lying.ax).toBeGreaterThan(0.95);
    }
  });

  it('on his back he draws his feet in, sits up off his hands, and rocks forward over his feet', () => {
    const supine = runs.filter((r) => r.getUp.path === 'supine');
    expect(supine.length).toBeGreaterThan(2);
    for (const run of supine) {
      expect(run.lying.up).toBeGreaterThan(0.2);
      // Feet flat and knees up while he is still on his back.
      const drawn = at(run, 0.3);
      for (const foot of drawn.feet) expect(foot.y).toBeLessThan(0.09);
      for (const knee of drawn.knees) expect(knee.y).toBeGreaterThan(0.35);
      // Sitting up: head well up, seat and hands still on the turf.
      const sit = at(run, 0.45);
      expect(sit.head.y).toBeGreaterThan(0.75);
      expect(sit.pelvis.y).toBeLessThan(0.25);
      for (const hand of sit.hands) expect(hand.y).toBeLessThan(0.14);
      // Then his hips come up over his feet, which have not moved since he planted them.
      const up = at(run, 0.75);
      expect(up.pelvis.y).toBeGreaterThan(0.5);
      const end = run.frames[run.frames.length - 1];
      for (let i = 0; i < 2; i++) expect(moved(sit.feet[i], end.feet[i])).toBeLessThan(0.04);
      // He gets up facing the way his feet were pointing.
      expect(Math.cos(run.getUp.heading) * run.lying.az + Math.sin(run.getUp.heading) * run.lying.ax).toBeLessThan(-0.95);
    }
  });

  it('once his hips are coming up they keep coming up', () => {
    for (const run of runs) {
      const from = Math.round(0.5 * (run.frames.length - 1));
      let top = run.frames[from].pelvis.y;
      for (let i = from; i < run.frames.length; i++) {
        const y = run.frames[i].pelvis.y;
        expect(y).toBeGreaterThan(top - 0.08); // bar the hitch that lets a foot through
        top = Math.max(top, y);
      }
    }
  });

  it('the spot he will stand on depends on which way up he is lying', () => {
    expect(standAlong(-1)).toBeCloseTo(STAND_ALONG.prone, 5);
    expect(standAlong(1)).toBeCloseTo(STAND_ALONG.supine, 5);
    expect(standAlong(0.1)).toBeGreaterThan(STAND_ALONG.supine);
    expect(standAlong(0.1)).toBeLessThan(STAND_ALONG.prone);
  });
});
