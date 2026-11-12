import { describe, it, expect } from 'vitest';
import { SIM_DT } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Rep } from '../src/sim/rep.js';
import { ReceiverAI } from '../src/sim/receiverAI.js';
import { DefenderAI } from '../src/sim/defenderAI.js';
import { uniformRatings, STAT_KEYS } from '../src/sim/ratings.js';
import { newCareer, spendPoint, addXp } from '../src/progression/progression.js';
import { RIVALS } from '../src/progression/opponents.js';
import { completionRate } from './simHarness.js';

const rate = (wr, db, reps = 400) =>
  completionRate({ wrRatings: uniformRatings(wr), dbRatings: uniformRatings(db), reps }).rate;

// These run a few thousand simulated reps; the point is that ratings decide
// who wins, so that levelling up really does help.
describe('balance', () => {
  it('evenly matched athletes split the reps reasonably evenly', () => {
    for (const level of [50, 65, 80, 95]) {
      const r = rate(level, level);
      expect(r).toBeGreaterThan(0.42);
      expect(r).toBeLessThan(0.75);
    }
  });

  it('a better receiver completes more, a better defender allows less', () => {
    const even = rate(65, 65);
    const wrUp = rate(80, 65);
    const dbUp = rate(65, 80);
    expect(wrUp).toBeGreaterThan(even + 0.08);
    expect(dbUp).toBeLessThan(even - 0.08);
  });

  it('the gap keeps mattering: bigger edge, bigger swing', () => {
    expect(rate(90, 60)).toBeGreaterThan(rate(75, 60));
    expect(rate(60, 90)).toBeLessThan(rate(60, 75));
    expect(rate(90, 60)).toBeGreaterThan(0.8);
    expect(rate(60, 90)).toBeLessThan(0.4);
  });

  it('spending skill points raises your win rate on both sides of the ball', () => {
    const rival = RIVALS[2].ratings;
    const rookie = newCareer();
    const veteran = newCareer();
    addXp(veteran, 60000);
    while (veteran.points > 0) {
      const stat = [...STAT_KEYS].sort((a, b) => veteran.stats[a] - veteran.stats[b])[0];
      if (!spendPoint(veteran, stat)) break;
    }
    const asWr = (stats) => completionRate({ wrRatings: stats, dbRatings: rival, reps: 400 }).rate;
    const asDb = (stats) => completionRate({ wrRatings: rival, dbRatings: stats, reps: 400 }).rate;
    expect(asWr(veteran.stats)).toBeGreaterThan(asWr(rookie.stats) + 0.1);
    expect(asDb(veteran.stats)).toBeLessThan(asDb(rookie.stats) - 0.1);
  });

  it('a corner who expects a route takes it away', () => {
    const run = (expect_, confidence) => {
      let complete = 0;
      const reps = 300;
      for (let i = 0; i < reps; i++) {
        const rng = new RNG(900 + i);
        const receiver = new ReceiverAI({ rng, tier: 8 });
        // Force the receiver to run the same in-breaking route every time.
        const weighted = rng.weighted.bind(rng);
        let first = true;
        rng.weighted = (w) => (first && 'dig' in w ? ((first = false), 'dig') : weighted(w));
        const rep = new Rep({
          wr: { ratings: uniformRatings(65), controller: receiver },
          db: { ratings: uniformRatings(65), controller: new DefenderAI({ rng, expect: expect_, confidence }) },
          rng,
          side: i % 2 ? 1 : -1,
        });
        for (let k = 0; k < 30 / SIM_DT && !rep.result; k++) rep.step(SIM_DT);
        if (rep.result.complete) complete += 1;
      }
      return complete / reps;
    };
    const cold = run(null, 0);
    const sittingOnIt = run('in', 1);
    const guessedWrong = run('out', 1);
    expect(sittingOnIt).toBeLessThan(cold - 0.2);
    expect(guessedWrong).toBeGreaterThanOrEqual(cold - 0.05);
  });
});
