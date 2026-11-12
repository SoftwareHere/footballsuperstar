import { describe, it, expect } from 'vitest';
import { QB, CATCH_HEIGHT, SIM_DT, FIELD } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Ball } from '../src/sim/ball.js';
import { solveLead, ballSpeedFor, Quarterback, readReceiver } from '../src/sim/qb.js';

const from = { x: 0.3, y: QB.releaseHeight, z: QB.dropZ };

function flyToTarget(lead) {
  const ball = new Ball(from.x, from.y, from.z);
  ball.throwTo(from, lead.target, lead.flightTime);
  let t = 0;
  while (t < lead.flightTime - 1e-9) {
    ball.step(SIM_DT);
    t += SIM_DT;
  }
  return ball;
}

describe('lead pass', () => {
  it('puts the ball where a receiver holding his course will be, at catch height', () => {
    const cases = [
      { pos: { x: 11, z: -6 }, vel: { x: -7, z: -4 } }, // slant
      { pos: { x: 12, z: -12 }, vel: { x: 0, z: -9 } }, // go
      { pos: { x: 14, z: -8 }, vel: { x: 8, z: 0 } }, // out
      { pos: { x: 10, z: -7 }, vel: { x: 0, z: 0 } }, // sitting down
    ];
    for (const c of cases) {
      const lead = solveLead({ from, recvPos: c.pos, recvVel: c.vel });
      const ball = flyToTarget(lead);
      const recvX = c.pos.x + c.vel.x * lead.flightTime;
      const recvZ = c.pos.z + c.vel.z * lead.flightTime;
      expect(Math.hypot(ball.pos.x - recvX, ball.pos.z - recvZ)).toBeLessThan(0.3);
      expect(Math.abs(ball.pos.y - CATCH_HEIGHT)).toBeLessThan(0.3);
    }
  });

  it('never leads the receiver out of bounds', () => {
    const lead = solveLead({ from, recvPos: { x: 24, z: -10 }, recvVel: { x: 9, z: 0 } });
    expect(lead.target.x).toBeLessThanOrEqual(FIELD.halfWidth - 1);
    const deep = solveLead({ from, recvPos: { x: 5, z: -40 }, recvVel: { x: 0, z: -9 } });
    expect(deep.target.z).toBeGreaterThanOrEqual(FIELD.endZ + 1);
  });

  it('shades the throw away from a defender in tight coverage', () => {
    const recvPos = { x: 10, z: -10 };
    const open = solveLead({ from, recvPos, recvVel: { x: 0, z: 0 } });
    const covered = solveLead({ from, recvPos, recvVel: { x: 0, z: 0 }, defPos: { x: 9, z: -10 } });
    expect(covered.target.x).toBeGreaterThan(open.target.x + 0.5);
    const farAway = solveLead({ from, recvPos, recvVel: { x: 0, z: 0 }, defPos: { x: 0, z: -10 } });
    expect(farAway.target.x).toBeCloseTo(open.target.x, 5);
  });

  it('throws deep balls slower and with more air', () => {
    expect(ballSpeedFor(10)).toBeGreaterThan(ballSpeedFor(40));
    const short = solveLead({ from, recvPos: { x: 8, z: -3 }, recvVel: { x: 0, z: 0 } });
    const long = solveLead({ from, recvPos: { x: 8, z: -35 }, recvVel: { x: 0, z: 0 } });
    expect(long.flightTime).toBeGreaterThan(short.flightTime * 2);
  });

  it('reads where the receiver is trying to go, not just his momentum', () => {
    const cutting = { vel: { x: 0, z: -8 }, want: { x: 8, z: 0 } }; // planting to break out
    const read = readReceiver(cutting);
    expect(read.x).toBeGreaterThan(4);
    expect(read.z).toBeGreaterThan(-4);
  });
});

describe('quarterback', () => {
  const receiver = { pos: { x: 11, z: -8 }, vel: { x: 0, z: -8 }, want: { x: 0, z: -8 } };

  function runUntilThrow({ callAt }) {
    const qb = new Quarterback();
    qb.snap();
    const rng = new RNG(5);
    for (let t = SIM_DT; t < 10; t += SIM_DT) {
      const thrown = qb.step(t, SIM_DT, { called: callAt !== null && t >= callAt, receiver, rng });
      if (thrown) return { t, thrown };
    }
    return null;
  }

  it('throws shortly after the receiver calls for it', () => {
    const { t, thrown } = runUntilThrow({ callAt: 2.0 });
    expect(t).toBeGreaterThan(2.0 + QB.windup - 0.02);
    expect(t).toBeLessThan(2.0 + QB.windup + 0.05);
    expect(thrown.forced).toBe(false);
  });

  it('cannot release before finishing his drop, however early the call', () => {
    const { t } = runUntilThrow({ callAt: 0.1 });
    expect(t).toBeGreaterThan(QB.minRelease - 0.02);
    expect(t).toBeLessThan(QB.minRelease + 0.05);
  });

  it('is forced to throw once the 4 seconds are up and nobody has called', () => {
    const { t, thrown } = runUntilThrow({ callAt: null });
    expect(t).toBeGreaterThan(QB.deadline + QB.windup - 0.02);
    expect(t).toBeLessThan(QB.deadline + QB.windup + 0.05);
    expect(thrown.forced).toBe(true);
  });

  it('a call just inside the 4 seconds still counts as a called throw', () => {
    const { t, thrown } = runUntilThrow({ callAt: QB.deadline - 0.1 });
    expect(thrown.forced).toBe(false);
    expect(t).toBeLessThan(QB.deadline + QB.windup);
  });
});
