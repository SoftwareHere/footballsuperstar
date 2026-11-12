import { describe, it, expect } from 'vitest';
import { STAT_KEYS, deriveParams, overall, fortyTime, uniformRatings } from '../src/sim/ratings.js';

describe('ratings', () => {
  it('every stat improves the thing it is supposed to', () => {
    const lo = deriveParams(uniformRatings(50));
    const hi = deriveParams(uniformRatings(90));
    expect(hi.topSpeed).toBeGreaterThan(lo.topSpeed);
    expect(hi.accel).toBeGreaterThan(lo.accel);
    expect(hi.cutRate).toBeGreaterThan(lo.cutRate);
    expect(hi.jukeCooldown).toBeLessThan(lo.jukeCooldown);
    expect(hi.reaction).toBeLessThan(lo.reaction);
    expect(hi.catchBase).toBeGreaterThan(lo.catchBase);
    expect(hi.reachBonus).toBeGreaterThan(lo.reachBonus);
    expect(hi.jumpHeight).toBeGreaterThan(lo.jumpHeight);
    expect(hi.strength).toBeGreaterThan(lo.strength);
    expect(hi.sprintSeconds).toBeGreaterThan(lo.sprintSeconds);
    expect(hi.betweenReps).toBeGreaterThan(lo.betweenReps);
  });

  it('a single stat only moves its own parameters', () => {
    const base = deriveParams(uniformRatings(60));
    const fast = deriveParams({ ...uniformRatings(60), speed: 95 });
    expect(fast.topSpeed).toBeGreaterThan(base.topSpeed);
    expect(fast.accel).toBe(base.accel);
    expect(fast.catchBase).toBe(base.catchBase);
  });

  it('overall is the rating when every stat is equal, and rises with any stat', () => {
    expect(overall(uniformRatings(70))).toBe(70);
    for (const key of STAT_KEYS) {
      expect(overall({ ...uniformRatings(60), [key]: 99 })).toBeGreaterThan(60);
    }
  });

  it('40 time gets faster with speed and acceleration, in a believable range', () => {
    const slow = fortyTime(uniformRatings(45));
    const quick = fortyTime(uniformRatings(95));
    expect(quick).toBeLessThan(slow);
    expect(quick).toBeGreaterThan(4.0);
    expect(slow).toBeLessThan(6.5);
  });
});
