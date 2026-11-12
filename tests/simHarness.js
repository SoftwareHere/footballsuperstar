import { SIM_DT } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Rep } from '../src/sim/rep.js';
import { ReceiverAI } from '../src/sim/receiverAI.js';
import { DefenderAI } from '../src/sim/defenderAI.js';

/** Run one AI-vs-AI rep to its result. */
export function runRep({ wrRatings, dbRatings, seed, tier = 4, maxSeconds = 20 }) {
  const rng = new RNG(seed);
  const rep = new Rep({
    wr: { ratings: wrRatings, controller: new ReceiverAI({ rng, tier }) },
    db: { ratings: dbRatings, controller: new DefenderAI({ rng }) },
    rng,
    side: seed % 2 ? 1 : -1,
  });
  const log = [];
  for (let i = 0; i < maxSeconds / SIM_DT && !rep.result; i++) {
    rep.step(SIM_DT);
    for (const e of rep.events) log.push(e.type);
    rep.events.length = 0;
  }
  return { rep, result: rep.result, log, move: rep.wrCtl.moveName };
}

/** Completion rate over many seeded reps. */
export function completionRate({ wrRatings, dbRatings, reps = 300, tier = 4, seedBase = 1000 }) {
  let complete = 0;
  const reasons = {};
  for (let i = 0; i < reps; i++) {
    const { result } = runRep({ wrRatings, dbRatings, seed: seedBase + i, tier });
    if (!result) throw new Error(`rep ${i} never finished`);
    if (result.complete) complete += 1;
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
  }
  return { rate: complete / reps, reasons };
}
