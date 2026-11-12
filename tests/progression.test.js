import { describe, it, expect } from 'vitest';
import {
  newCareer,
  xpToNext,
  addXp,
  spendPoint,
  matchXp,
  recordMatch,
  POINTS_PER_LEVEL,
  MAX_LEVEL,
  START_POINTS,
} from '../src/progression/progression.js';
import { RIVALS } from '../src/progression/opponents.js';
import { overall, STAT_MAX } from '../src/sim/ratings.js';

describe('progression', () => {
  it('each level needs more XP than the last', () => {
    for (let level = 1; level < 30; level++) expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
  });

  it('XP rolls over into levels and skill points', () => {
    const c = newCareer();
    const levels = addXp(c, xpToNext(1) + xpToNext(2) + 10);
    expect(levels).toBe(2);
    expect(c.level).toBe(3);
    expect(c.xp).toBe(10);
    expect(c.points).toBe(START_POINTS + 2 * POINTS_PER_LEVEL);
  });

  it('stops at the level cap', () => {
    const c = newCareer();
    addXp(c, 1e9);
    expect(c.level).toBe(MAX_LEVEL);
  });

  it('spending a point raises the stat and the overall, and respects the caps', () => {
    const c = newCareer();
    const before = overall(c.stats);
    for (let i = 0; i < START_POINTS; i++) expect(spendPoint(c, 'speed')).toBe(true);
    expect(c.stats.speed).toBe(60 + START_POINTS);
    expect(c.points).toBe(0);
    expect(overall(c.stats)).toBeGreaterThan(before);
    expect(spendPoint(c, 'speed')).toBe(false); // no points left
    c.points = 5;
    c.stats.hands = STAT_MAX;
    expect(spendPoint(c, 'hands')).toBe(false); // already maxed
    expect(spendPoint(c, 'not-a-stat')).toBe(false);
    expect(c.points).toBe(5);
  });

  it('winning, longer games and tougher rivals all pay more', () => {
    const win = matchXp({ won: true, userPoints: 5, target: 5, tier: 1 }).total;
    const loss = matchXp({ won: false, userPoints: 4, target: 5, tier: 1 }).total;
    const shutout = matchXp({ won: false, userPoints: 0, target: 5, tier: 1 }).total;
    expect(win).toBeGreaterThan(loss);
    expect(loss).toBeGreaterThan(shutout);
    expect(shutout).toBeGreaterThan(0);
    expect(matchXp({ won: true, userPoints: 7, target: 7, tier: 1 }).total).toBeGreaterThan(win);
    expect(matchXp({ won: true, userPoints: 3, target: 3, tier: 1 }).total).toBeLessThan(win);
    expect(matchXp({ won: true, userPoints: 5, target: 5, tier: 4 }).total).toBeGreaterThan(win);
  });

  it('a first win levels you up and unlocks the next rival', () => {
    const c = newCareer();
    const out = recordMatch(c, { won: true, userPoints: 5, target: 5, tier: 1 });
    expect(out.levels).toBeGreaterThanOrEqual(1);
    expect(c.level).toBeGreaterThan(1);
    expect(c.wins).toBe(1);
    expect(c.unlocked).toBe(2);
    expect(out.unlockedTier).toBe(2);
    expect(c.beaten[RIVALS[0].id]).toBe(1);
  });

  it('a loss still earns XP but unlocks nothing; replaying an old rival unlocks nothing', () => {
    const c = newCareer();
    const lost = recordMatch(c, { won: false, userPoints: 2, target: 5, tier: 1 });
    expect(lost.xp.total).toBeGreaterThan(0);
    expect(c.losses).toBe(1);
    expect(c.unlocked).toBe(1);
    c.unlocked = 3;
    const replay = recordMatch(c, { won: true, userPoints: 5, target: 5, tier: 1 });
    expect(replay.unlockedTier).toBe(null);
    expect(c.unlocked).toBe(3);
  });

  it('beating the last rival does not unlock past the end of the ladder', () => {
    const c = newCareer();
    c.unlocked = RIVALS.length;
    recordMatch(c, { won: true, userPoints: 5, target: 5, tier: RIVALS.length });
    expect(c.unlocked).toBe(RIVALS.length);
  });

  it('rivals get tougher up the ladder', () => {
    for (let i = 1; i < RIVALS.length; i++) {
      expect(overall(RIVALS[i].ratings)).toBeGreaterThan(overall(RIVALS[i - 1].ratings));
    }
  });
});
