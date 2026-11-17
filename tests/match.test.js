import { describe, it, expect } from 'vitest';
import { SIM_DT, QB, GAME_LENGTHS, FALL, DIVE } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Match, scoreFor } from '../src/sim/match.js';
import { Rep } from '../src/sim/rep.js';
import { Athlete } from '../src/sim/athlete.js';
import { ReceiverAI } from '../src/sim/receiverAI.js';
import { DefenderAI } from '../src/sim/defenderAI.js';
import { blankIntent } from '../src/sim/aiCommon.js';
import { uniformRatings } from '../src/sim/ratings.js';
import { runRep } from './simHarness.js';

function aiSide(rng, rating = 65) {
  return {
    ratings: uniformRatings(rating),
    makeController: (role) => (role === 'wr' ? new ReceiverAI({ rng, tier: 4 }) : new DefenderAI({ rng })),
  };
}

function playMatch(seed, target, firstPossession = null) {
  const rng = new RNG(seed);
  const match = new Match({ target, rng, user: aiSide(rng), rival: aiSide(rng), firstPossession });
  const log = [];
  while (!match.winner) {
    const rep = match.startRep();
    const before = { ...match.score };
    const offense = match.possession;
    for (let i = 0; i < 30 / SIM_DT && !rep.result; i++) rep.step(SIM_DT);
    const entry = match.recordResult();
    log.push({ offense, before, after: { ...match.score }, entry, nextOffense: match.possession });
    if (log.length > 50) throw new Error('match never ended');
  }
  return { match, log };
}

describe('match rules', () => {
  it('a catch is 1 and a touchdown 3 for the receiver; an incompletion is 1 and a pick 3 for the defender', () => {
    expect(scoreFor({ complete: true, reason: 'catch' })).toEqual({ role: 'wr', points: 1 });
    expect(scoreFor({ complete: true, reason: 'touchdown', touchdown: true })).toEqual({ role: 'wr', points: 3 });
    expect(scoreFor({ complete: false, reason: 'swat' })).toEqual({ role: 'db', points: 1 });
    expect(scoreFor({ complete: false, reason: 'oob', pickOob: true })).toEqual({ role: 'db', points: 1 });
    expect(scoreFor({ complete: false, reason: 'int' })).toEqual({ role: 'db', points: 3 });
  });

  it('every rep scores for the side it went to, by those rules', () => {
    const seen = new Set();
    for (const seed of [11, 21, 31]) {
      const { log } = playMatch(seed, 13);
      for (const { offense, before, after, entry } of log) {
        const defense = offense === 'user' ? 'rival' : 'user';
        const scorer = entry.complete ? offense : defense;
        const points = entry.touchdown || entry.reason === 'int' ? 3 : 1;
        seen.add(entry.touchdown ? 'td' : entry.reason);
        expect(entry.scorer).toBe(scorer);
        expect(entry.points).toBe(points);
        expect(after[scorer]).toBe(before[scorer] + points);
        const other = scorer === 'user' ? 'rival' : 'user';
        expect(after[other]).toBe(before[other]);
      }
    }
    // Both kinds of score for the offense came up.
    expect(seen.has('td')).toBe(true);
    expect(seen.has('catch')).toBe(true);
  });

  it('possession flips after every rep', () => {
    const { log } = playMatch(12, 13);
    expect(log.length).toBeGreaterThanOrEqual(5);
    for (const step of log) expect(step.nextOffense).not.toBe(step.offense);
    for (let i = 1; i < log.length; i++) expect(log[i].offense).not.toBe(log[i - 1].offense);
  });

  it('ends as soon as someone reaches the target, for every game length', () => {
    expect(GAME_LENGTHS).toEqual([5, 9, 13]);
    for (const target of GAME_LENGTHS) {
      for (const seed of [1, 2, 3]) {
        const { match, log } = playMatch(seed, target);
        const { user, rival } = match.score;
        // A 3-point play can carry the winner past the number, by at most 2.
        expect(match.score[match.winner]).toBeGreaterThanOrEqual(target);
        expect(match.score[match.winner]).toBeLessThanOrEqual(target + 2);
        expect(Math.min(user, rival)).toBeLessThan(target);
        // Nobody had reached it before the last rep.
        const last = log[log.length - 1];
        expect(Math.max(last.before.user, last.before.rival)).toBeLessThan(target);
        expect(log.reduce((sum, l) => sum + l.entry.points, 0)).toBe(user + rival);
      }
    }
  });

  it('the user is the receiver exactly when he has possession', () => {
    const rng = new RNG(3);
    const match = new Match({ target: 3, rng, user: aiSide(rng), rival: aiSide(rng), firstPossession: 'user' });
    expect(match.userRole).toBe('wr');
    const rep = match.startRep();
    for (let i = 0; i < 30 / SIM_DT && !rep.result; i++) rep.step(SIM_DT);
    match.recordResult();
    expect(match.userRole).toBe('db');
  });

  it('the coin toss is honoured and roughly fair', () => {
    let userFirst = 0;
    for (let seed = 0; seed < 200; seed++) {
      const rng = new RNG(seed);
      const match = new Match({ target: 3, rng, user: aiSide(rng), rival: aiSide(rng) });
      expect(match.possession).toBe(match.tossWinner);
      if (match.tossWinner === 'user') userFirst += 1;
    }
    expect(userFirst).toBeGreaterThan(70);
    expect(userFirst).toBeLessThan(130);
  });

  it('spots a route the user keeps running', () => {
    const rng = new RNG(1);
    const match = new Match({ target: 7, rng, user: aiSide(rng), rival: aiSide(rng) });
    expect(match.tendency('user')).toEqual({ expect: null, confidence: 0 });
    match.history.push({ offense: 'user', category: 'in' }, { offense: 'rival', category: 'deep' }, { offense: 'user', category: 'in' });
    expect(match.tendency('user')).toEqual({ expect: 'in', confidence: 0.5 });
    match.history.push({ offense: 'user', category: 'out' }, { offense: 'user', category: 'in' });
    expect(match.tendency('user')).toEqual({ expect: 'in', confidence: 0.75 });
  });
});

describe('rep', () => {
  it('is reproducible from its seed', () => {
    const a = runRep({ wrRatings: uniformRatings(70), dbRatings: uniformRatings(70), seed: 42 });
    const b = runRep({ wrRatings: uniformRatings(70), dbRatings: uniformRatings(70), seed: 42 });
    expect(a.result).toEqual(b.result);
    expect(a.log).toEqual(b.log);
  });

  it('always goes snap, throw, result, and every rep is decided', () => {
    for (let seed = 0; seed < 150; seed++) {
      const { result, log } = runRep({ wrRatings: uniformRatings(65), dbRatings: uniformRatings(65), seed });
      expect(result).not.toBe(null);
      expect(log.indexOf('snap')).toBeGreaterThanOrEqual(0);
      expect(log.indexOf('throw')).toBeGreaterThan(log.indexOf('snap'));
      expect(log.indexOf('result')).toBeGreaterThan(log.indexOf('throw'));
      expect(log.filter((e) => e === 'throw').length).toBe(1);
    }
  });

  // A receiver who just runs and never calls for the ball.
  class SilentReceiver {
    constructor() {
      this.intent = blankIntent();
    }
    update(rep) {
      this.intent.snap = rep.phase === 'presnap';
      this.intent.z = rep.phase === 'presnap' ? 0 : -1;
      return this.intent;
    }
  }

  it('the QB throws on his own when the 4 seconds run out', () => {
    const rng = new RNG(9);
    const rep = new Rep({
      wr: { ratings: uniformRatings(60), controller: new SilentReceiver() },
      db: { ratings: uniformRatings(60), controller: new DefenderAI({ rng }) },
      rng,
    });
    let thrownAt = null;
    let forced = null;
    for (let i = 0; i < 30 / SIM_DT && !rep.result; i++) {
      rep.step(SIM_DT);
      for (const e of rep.events) {
        if (e.type === 'throw') {
          thrownAt = rep.t;
          forced = e.forced;
        }
      }
      rep.events.length = 0;
    }
    expect(rep.called).toBe(false);
    expect(forced).toBe(true);
    expect(thrownAt).toBeGreaterThan(QB.deadline);
    expect(thrownAt).toBeLessThan(QB.deadline + QB.windup + 0.05);
    expect(rep.result.forced).toBe(true);
  });

  // A receiver who calls for it the instant the ball is snapped.
  class EagerReceiver extends SilentReceiver {
    update(rep) {
      super.update(rep);
      this.intent.call = rep.phase === 'live';
      return this.intent;
    }
  }

  it('a called throw comes out early, and is not a pressure throw', () => {
    const rng = new RNG(9);
    const rep = new Rep({
      wr: { ratings: uniformRatings(60), controller: new EagerReceiver() },
      db: { ratings: uniformRatings(60), controller: new DefenderAI({ rng }) },
      rng,
    });
    let thrownAt = null;
    for (let i = 0; i < 30 / SIM_DT && !rep.result; i++) {
      rep.step(SIM_DT);
      if (thrownAt === null && rep.phase === 'flight') thrownAt = rep.t;
    }
    expect(rep.called).toBe(true);
    expect(thrownAt).toBeLessThan(QB.minRelease + 0.05);
    expect(rep.result.forced).toBe(false);
  });
});

describe('going to the ground', () => {
  const run = { x: 1, z: 0, sprint: true, jump: true, juke: 0 };

  it('a man knocked down ignores his controller, slides to a stop, then gets up', () => {
    const a = new Athlete({ ratings: uniformRatings(70) });
    a.vel.z = -8;
    a.knockdown({ vx: 3, vy: 2, vz: 0, high: true }, 0.5);
    expect(a.down).toBe(true);
    expect(a.fellThisTick).toBe(true);
    const startX = a.pos.x;
    for (let i = 0; i < 0.45 / SIM_DT; i++) a.step(run, SIM_DT);
    // Still down: no jump, no sprint, and he is slowing, not accelerating.
    expect(a.down).toBe(true);
    expect(a.airborne).toBe(false);
    expect(a.speed).toBeLessThan(4);
    expect(a.rise).toBe(0);
    for (let i = 0; i < (0.1 + FALL.getUp * 0.5) / SIM_DT; i++) a.step(run, SIM_DT);
    expect(a.down).toBe(true);
    expect(a.rise).toBeGreaterThan(0);
    for (let i = 0; i < 1 / SIM_DT; i++) a.step({ ...run, jump: false }, SIM_DT);
    expect(a.down).toBe(false);
    expect(a.fall).toBe(null);
    // Back under control: he is running the way he was told.
    expect(a.vel.x).toBeGreaterThan(3);
    expect(a.pos.x).toBeGreaterThan(startX + 1);
  });

  it('a dive is committed: he flies, lands on the turf, and has to get up', () => {
    const a = new Athlete({ ratings: uniformRatings(70) });
    a.dive({ x: 0, z: -1, speed: 7, air: 0.4 });
    expect(a.diving && a.airborne && a.attempting).toBe(true);
    let fell = false;
    let ticks = 0;
    while (!a.down && ticks < 200) {
      a.step({ x: 1, z: 0, sprint: true, jump: false, juke: 0 }, SIM_DT);
      fell = fell || a.fellThisTick;
      ticks += 1;
    }
    expect(a.down).toBe(true);
    expect(fell).toBe(true);
    expect(ticks * SIM_DT).toBeGreaterThan(0.3);
    expect(ticks * SIM_DT).toBeLessThan(0.5);
    // He went where he dove, not where the stick was pointing.
    expect(a.pos.z).toBeLessThan(-2);
    expect(Math.abs(a.pos.x)).toBeLessThan(0.01);
    for (let i = 0; i < (DIVE.downTime + FALL.getUp + 0.2) / SIM_DT; i++) a.step(blankIntent(), SIM_DT);
    expect(a.down).toBe(false);
    expect(a.diving).toBe(false);
  });
});

describe('physical reps', () => {
  const reps = [];
  for (let seed = 0; seed < 400; seed++) {
    reps.push(runRep({ wrRatings: uniformRatings(65), dbRatings: uniformRatings(80), seed: 3000 + seed }));
  }
  const count = (log, type) => log.filter((e) => e === type).length;

  it('a tipped ball stays live: it can be caught, picked, or fall', () => {
    const tipped = reps.filter((r) => r.log.includes('tip'));
    expect(tipped.length).toBeGreaterThan(15);
    for (const r of tipped) {
      expect(r.result.tips).toBeGreaterThanOrEqual(1);
      expect(count(r.log, 'tip')).toBeLessThanOrEqual(2);
      expect(r.log.indexOf('result')).toBeGreaterThan(r.log.indexOf('tip'));
    }
    expect(tipped.some((r) => r.result.complete)).toBe(true);
    expect(tipped.some((r) => r.result.reason === 'int')).toBe(true);
    expect(tipped.some((r) => !r.result.complete && r.result.reason !== 'int')).toBe(true);
    // Nobody is credited with a tip on a rep that never had one.
    for (const r of reps) if (!r.log.includes('tip')) expect(r.result.tips || 0).toBe(0);
  });

  it('a hit at the catch is either held through or jars the ball loose', () => {
    const hit = reps.filter((r) => r.log.includes('hit'));
    expect(hit.length).toBeGreaterThan(3);
    for (const r of hit) {
      expect(r.log.indexOf('hit')).toBeGreaterThan(r.log.indexOf('catch'));
      const held = r.result.complete && r.result.throughContact === true;
      const jarred = !r.result.complete && r.result.reason === 'hit';
      // Held on in the air, but came down out of bounds.
      const out = !r.result.complete && r.result.reason === 'oob';
      expect(held || jarred || out).toBe(true);
      expect(r.result.hit).toBeGreaterThan(0);
    }
    // And the other way round: nobody gets 'hit' as a reason without a hit.
    for (const r of reps) if (r.result.reason === 'hit') expect(r.log.includes('hit')).toBe(true);
  });

  it('whatever happens at the catch, every rep still has one throw and one result', () => {
    for (const r of reps) {
      expect(r.result).not.toBe(null);
      expect(count(r.log, 'throw')).toBe(1);
      expect(count(r.log, 'result')).toBe(1);
      expect(r.result.time).toBeLessThan(16);
      if (r.result.complete) expect(r.rep.wr.hasBall).toBe(true);
      else if (r.result.reason !== 'int') expect(r.rep.wr.hasBall).toBe(false);
    }
  });

  it('the catch is named, and dives happen', () => {
    const kinds = new Set(reps.filter((r) => r.result.complete).map((r) => r.result.catchType));
    expect(kinds.has('leap')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(reps.some((r) => r.log.includes('dive'))).toBe(true);
  });
});
