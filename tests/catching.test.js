import { describe, it, expect } from 'vitest';
import { Athlete } from '../src/sim/athlete.js';
import { uniformRatings } from '../src/sim/ratings.js';
import { reachInfo, catchProbability, breakupProbability } from '../src/sim/catching.js';

const athlete = (rating, extra = {}) => new Athlete({ ratings: { ...uniformRatings(rating), ...extra }, x: 0, z: 0 });
const base = { quality: 0.9, attempting: true, separation: 5, dbAttempting: false, dbInReach: false };

describe('catching', () => {
  it('an open, clean catch is close to automatic', () => {
    const p = catchProbability({ ...base, wr: athlete(60), db: athlete(60) });
    expect(p).toBeGreaterThan(0.85);
  });

  it('tighter coverage makes the catch harder', () => {
    const wr = athlete(60);
    const db = athlete(60);
    const open = catchProbability({ ...base, wr, db, separation: 4 });
    const tight = catchProbability({ ...base, wr, db, separation: 1 });
    const draped = catchProbability({ ...base, wr, db, separation: 0.5, dbAttempting: true });
    const contested = catchProbability({ ...base, wr, db, separation: 0.5, dbAttempting: true, dbInReach: true });
    expect(tight).toBeLessThan(open);
    expect(draped).toBeLessThan(tight);
    expect(contested).toBeLessThan(draped);
  });

  it('going up for it beats a passive body catch', () => {
    const wr = athlete(60);
    const db = athlete(60);
    expect(catchProbability({ ...base, wr, db, attempting: true })).toBeGreaterThan(
      catchProbability({ ...base, wr, db, attempting: false })
    );
  });

  it('hands, jumping and strength each help the receiver win a contested ball', () => {
    const db = athlete(70);
    const contest = (wr) => catchProbability({ ...base, wr, db, separation: 0.6, dbAttempting: true, dbInReach: true });
    const plain = contest(athlete(70));
    for (const stat of ['hands', 'jumping', 'strength']) {
      expect(contest(athlete(70, { [stat]: 95 }))).toBeGreaterThan(plain);
    }
  });

  it('a stronger defender takes more off a covered catch', () => {
    const wr = athlete(70);
    const covered = (db) => catchProbability({ ...base, wr, db, separation: 1 });
    expect(covered(athlete(70, { strength: 95 }))).toBeLessThan(covered(athlete(70)));
  });

  it('probabilities stay in range at the extremes', () => {
    for (const [w, d] of [[1, 99], [99, 1], [99, 99], [1, 1]]) {
      for (const dbInReach of [true, false]) {
        const p = catchProbability({ ...base, wr: athlete(w), db: athlete(d), separation: 0, dbAttempting: true, dbInReach, quality: 0 });
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it('a jump raises the reach, and human players get a slightly bigger radius', () => {
    const a = athlete(60);
    const standing = reachInfo(a, 'wr', { x: 0, y: 3.6, z: 0 });
    expect(standing.inReach).toBe(false);
    a.attempting = true;
    a.y = 0.7;
    expect(reachInfo(a, 'wr', { x: 0, y: 3.6, z: 0 }).inReach).toBe(true);
    const ai = reachInfo(a, 'wr', { x: 1.1, y: 2, z: 0 });
    a.reachAssist = 0.15;
    const human = reachInfo(a, 'wr', { x: 1.1, y: 2, z: 0 });
    expect(human.radius).toBeGreaterThan(ai.radius);
  });

  it('a defender with better hands breaks up more passes', () => {
    const play = { quality: 0.6, kind: 'attempt' };
    expect(breakupProbability(play, athlete(95))).toBeGreaterThan(breakupProbability(play, athlete(50)));
  });
});
