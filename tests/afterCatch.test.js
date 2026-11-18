import { describe, it, expect } from 'vitest';
import { SIM_DT, FIELD, RUN, TACKLE, GRAVITY } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Rep, yardLine } from '../src/sim/rep.js';
import { scoreFor } from '../src/sim/match.js';
import { blankIntent } from '../src/sim/aiCommon.js';
import { uniformRatings } from '../src/sim/ratings.js';
import { tackleOdds, breakFreeOdds, diveTackleOdds } from '../src/sim/catching.js';
import { Athlete } from '../src/sim/athlete.js';
import { runRep } from './simHarness.js';

/** A controller that runs a little script every tick. */
class Script {
  constructor(fn = null) {
    this.intent = blankIntent();
    this.fn = fn;
  }
  update(rep) {
    const i = this.intent;
    i.x = 0;
    i.z = 0;
    i.sprint = false;
    i.jump = false;
    i.juke = 0;
    this.fn?.(rep, i);
    return i;
  }
}

const runStraight = (rep, i) => {
  i.z = -1;
  i.sprint = true;
};
const chase = (rep, i) => {
  const me = rep.db;
  const wr = rep.wr;
  const dx = wr.pos.x - me.pos.x;
  const dz = wr.pos.z - me.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  i.x = dx / d;
  i.z = dz / d;
  i.sprint = true;
};

/** A rep that has just become a run after the catch, with the men where we want them. */
function afterCatch({ wr = {}, db = {}, wrCtl = runStraight, dbCtl = chase, seed = 1, wrRatings = uniformRatings(65), dbRatings = uniformRatings(65), info = {} } = {}) {
  const rep = new Rep({
    wr: { ratings: wrRatings, controller: new Script(wrCtl) },
    db: { ratings: dbRatings, controller: new Script(dbCtl) },
    rng: new RNG(seed),
    side: 1,
  });
  rep.phase = 'flight';
  rep.t = 2;
  const place = (a, s, facing) => {
    Object.assign(a.pos, s.pos);
    Object.assign(a.vel, s.vel || { x: 0, z: 0 });
    a.facing = s.facing ?? facing;
  };
  place(rep.wr, { pos: { x: 0, z: -10 }, ...wr }, Math.PI);
  place(rep.db, { pos: { x: 15, z: -10 }, ...db }, 0);
  if (db.facing === undefined) rep.db.facing = Math.atan2(rep.wr.pos.x - rep.db.pos.x, rep.wr.pos.z - rep.db.pos.z);
  rep.ball.attachTo(rep.wr);
  rep.ball.step(SIM_DT);
  rep.wr.hasBall = true;
  rep.completeCatch({ catchType: 'body', ...info });
  return rep;
}

function play(rep, seconds = 14) {
  const events = [];
  for (let i = 0; i < seconds / SIM_DT && !rep.result; i++) {
    rep.step(SIM_DT);
    for (const e of rep.events) events.push({ ...e, t: rep.t });
    rep.events.length = 0;
  }
  return events;
}

describe('after the catch', () => {
  it('a catch short of the goal line becomes a run, which ends in a touchdown, a tackle, out of bounds or the whistle', () => {
    const endings = new Set();
    let runs = 0;
    for (let seed = 0; seed < 250; seed++) {
      const { result, log } = runRep({ wrRatings: uniformRatings(65), dbRatings: uniformRatings(65), seed: 7000 + seed });
      if (!result.complete) {
        expect(result.touchdown).toBeFalsy();
        continue;
      }
      endings.add(result.endedBy);
      expect(result.touchdown).toBe(result.reason === 'touchdown');
      expect(['endzone', 'wrap', 'hit', 'dive', 'stretch', 'oob', 'pushed', 'down', 'whistle']).toContain(result.endedBy);
      if (log.includes('caught')) {
        runs += 1;
        expect(result.yac).toBeGreaterThanOrEqual(0);
        if (!result.touchdown) expect(result.endYard).toBeGreaterThan(0);
      }
      expect(scoreFor(result).points).toBe(result.touchdown ? 3 : 1);
    }
    expect(runs).toBeGreaterThan(60);
    for (const e of ['endzone', 'wrap', 'dive']) expect(endings.has(e)).toBe(true);
  });

  it('running across the goal line is a touchdown', () => {
    const rep = afterCatch({ wr: { pos: { x: 0, z: FIELD.goalZ + 3 }, vel: { x: 0, z: -7 } }, db: { pos: { x: 15, z: 0 } } });
    expect(rep.phase).toBe('run');
    const events = play(rep);
    expect(rep.result.complete).toBe(true);
    expect(rep.result.reason).toBe('touchdown');
    expect(rep.result.touchdown).toBe(true);
    expect(rep.result.endedBy).toBe('endzone');
    expect(rep.result.yac).toBeCloseTo(3, 0);
    expect(scoreFor(rep.result)).toEqual({ role: 'wr', points: 3 });
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('a catch in the end zone is a touchdown straight away', () => {
    const rep = afterCatch({ wr: { pos: { x: 3, z: FIELD.goalZ - 4 } } });
    expect(rep.result.reason).toBe('touchdown');
    expect(rep.result.catchYard).toBeLessThan(0);
  });

  it('a dive that gets the ball across is a touchdown; one that comes up short is down where he lands', () => {
    const dive = (z) => {
      const rep = afterCatch({
        wr: { pos: { x: 0, z }, vel: { x: 0, z: -8 } },
        db: { pos: { x: 12, z: -5 } },
        wrCtl: (r, i) => {
          runStraight(r, i);
          i.jump = true;
        },
      });
      play(rep);
      return rep;
    };
    const over = dive(FIELD.goalZ + 3);
    expect(over.result.touchdown).toBe(true);
    // The ball crossed before he came down: his body may still be short of the line.
    const short = dive(FIELD.goalZ + 9);
    expect(short.result.touchdown).toBe(false);
    expect(short.result.endedBy).toBe('stretch');
    expect(over.result.stretched).toBe(true);
    expect(short.wr.down).toBe(true);
    expect(short.result.endYard).toBeGreaterThan(1);
    expect(short.result.endYard).toBeLessThan(7.5);
    expect(short.result.yac).toBeGreaterThan(1.5);
  });

  it('stepping out of bounds after the catch is a catch, worth 1', () => {
    const rep = afterCatch({
      wr: { pos: { x: FIELD.halfWidth - 0.6, z: -12 }, vel: { x: 6, z: 0 }, facing: Math.PI / 2 },
      wrCtl: (r, i) => {
        i.x = 1;
        i.sprint = true;
      },
    });
    play(rep);
    expect(rep.result.complete).toBe(true);
    expect(rep.result.reason).toBe('catch');
    expect(rep.result.endedBy).toBe('oob');
    expect(scoreFor(rep.result).points).toBe(1);
  });

  it('a run that goes nowhere is whistled dead', () => {
    const rep = afterCatch({ wrCtl: null, dbCtl: null, db: { pos: { x: 20, z: 10 } } });
    play(rep, RUN.maxTime + 2);
    expect(rep.result.endedBy).toBe('whistle');
    expect(rep.result.complete).toBe(true);
    expect(rep.result.time).toBeGreaterThanOrEqual(2 + RUN.maxTime - 0.05);
  });
});

describe('tackling', () => {
  // The runner heads downfield into a defender who comes at him head on.
  const headOn = (seed, { db = {}, wr = {}, dbRatings = uniformRatings(65), wrRatings = uniformRatings(65), wrCtl = runStraight, dbCtl = chase } = {}) =>
    afterCatch({
      seed,
      wr: { pos: { x: 0, z: -8 }, vel: { x: 0, z: -6 }, ...wr },
      db: { pos: { x: 0.3, z: -16 }, vel: { x: 0, z: 0 }, ...db },
      dbRatings,
      wrRatings,
      wrCtl,
      dbCtl,
    });

  it('the odds: a better tackler, a man squared up, a man not mid-juke all bring him down more often', () => {
    const a = (r) => new Athlete({ ratings: uniformRatings(r) });
    const even = tackleOdds({ tackler: a(65), runner: a(65) });
    expect(tackleOdds({ tackler: a(90), runner: a(65) })).toBeGreaterThan(even);
    expect(tackleOdds({ tackler: a(65), runner: a(90) })).toBeLessThan(even);
    expect(tackleOdds({ tackler: a(65), runner: a(65), front: 0 })).toBeLessThan(even);
    expect(tackleOdds({ tackler: a(65), runner: a(65), juking: true })).toBeLessThan(even);
    expect(breakFreeOdds({ tackler: a(65), runner: a(90) })).toBeGreaterThan(breakFreeOdds({ tackler: a(65), runner: a(65) }));
    expect(diveTackleOdds({ quality: 1, tackler: a(65), runner: a(65) })).toBeGreaterThan(diveTackleOdds({ quality: 0, tackler: a(65), runner: a(65) }));
    for (const r of [1, 50, 99]) {
      const p = tackleOdds({ tackler: a(r), runner: a(100 - r) });
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('a stronger tackler stops more runners', () => {
    const stops = (strength) => {
      let n = 0;
      for (let seed = 0; seed < 120; seed++) {
        const rep = headOn(seed, { dbRatings: { ...uniformRatings(65), strength } });
        play(rep);
        if (!rep.result.touchdown) n += 1;
      }
      return n;
    };
    expect(stops(95)).toBeGreaterThan(stops(40) + 10);
  });

  it('a juke as he closes makes the tackler miss more often', () => {
    const misses = (juke) => {
      let n = 0;
      for (let seed = 0; seed < 150; seed++) {
        const rep = headOn(seed, {
          wrCtl: (r, i) => {
            runStraight(r, i);
            const d = Math.hypot(r.db.pos.x - r.wr.pos.x, r.db.pos.z - r.wr.pos.z);
            if (juke && d < 1.6 && d > 1.15) i.juke = 1;
          },
        });
        const events = play(rep, 3);
        if (events.some((e) => e.type === 'broken')) n += 1;
      }
      return n;
    };
    expect(misses(true)).toBeGreaterThan(misses(false) + 8);
  });

  // A defender who holds his ground in front of him and lets him come.
  const sitThere = (rep, i) => {
    rep.db.faceTarget = rep.wr.pos;
  };

  it('a wrapped-up runner churns forward with the tackler on him, then they both go down', () => {
    let checked = 0;
    for (let seed = 0; seed < 80 && checked < 5; seed++) {
      const rep = headOn(seed, { wr: { vel: { x: 0, z: -4 } }, dbCtl: sitThere, wrCtl: (r, i) => (i.z = -0.6) });
      let wrapZ = null;
      for (let i = 0; i < 12 / SIM_DT && !rep.result; i++) {
        rep.step(SIM_DT);
        for (const e of rep.events) if (e.type === 'wrap') wrapZ = rep.wr.pos.z;
        rep.events.length = 0;
        if (rep.run?.wrap && rep.run.wrap.t > 0) {
          // Glued together, and both are held.
          expect(Math.hypot(rep.db.pos.x - rep.wr.pos.x, rep.db.pos.z - rep.wr.pos.z)).toBeCloseTo(TACKLE.hold, 1);
          expect(rep.wr.hands.kind).toBe('wrapped');
          expect(rep.db.hands.kind).toBe('wrap');
        }
      }
      if (wrapZ === null || rep.result.endedBy !== 'wrap') continue;
      checked += 1;
      expect(rep.wr.down).toBe(true);
      expect(rep.db.down).toBe(true);
      expect(rep.result.tackleKind ?? 'wrap').toBe('wrap');
      // He fell forward for what he could get.
      expect(yardLine(rep.ball.pos.z)).toBeLessThan(yardLine(wrapZ));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a runner who breaks the wrap leaves the tackler on the turf', () => {
    let seen = 0;
    for (let seed = 0; seed < 300 && seen < 3; seed++) {
      const rep = headOn(seed, { wrRatings: uniformRatings(90), dbRatings: uniformRatings(55), dbCtl: sitThere, wrCtl: (r, i) => (i.z = -0.6) });
      for (let i = 0; i < 4 / SIM_DT && !rep.result; i++) {
        rep.step(SIM_DT);
        const shed = rep.events.some((e) => e.type === 'broken' && e.kind === 'shed');
        rep.events.length = 0;
        if (shed) {
          seen += 1;
          expect(rep.db.down).toBe(true);
          expect(rep.wr.down).toBe(false);
          expect(rep.run.broken).toBeGreaterThan(0);
          break;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('arriving fast enough, a tackle is a hit that puts him straight down', () => {
    let hits = 0;
    for (let seed = 0; seed < 120; seed++) {
      const rep = headOn(seed, { wr: { vel: { x: 0, z: -8 } }, db: { vel: { x: 0, z: 7 } }, dbRatings: uniformRatings(90) });
      const events = play(rep, 3);
      const hit = events.find((e) => e.type === 'tackle' && e.kind === 'hit');
      if (!hit) continue;
      expect(hit.power).toBeGreaterThanOrEqual(TACKLE.hitAt);
      if (rep.result.endedBy === 'hit') {
        hits += 1;
        expect(rep.wr.down).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(5);
  });
});

describe('diving after the catch', () => {
  const diveAt = (seed, dbAt) =>
    afterCatch({
      seed,
      wr: { pos: { x: 0, z: -10 }, vel: { x: 0, z: -6 } },
      db: { pos: dbAt, vel: { x: 0, z: -6 } },
      dbCtl: (r, i) => {
        chase(r, i);
        i.jump = true;
      },
    });

  it('a defender who lays out at his legs takes them out or trips him up, and ends up on the turf either way', () => {
    const outcomes = new Set();
    for (let seed = 0; seed < 60; seed++) {
      const rep = diveAt(seed, { x: 0.3, z: -8.2 });
      let dove = false;
      let outcome = null;
      for (let i = 0; i < 2 / SIM_DT && !rep.result && !outcome; i++) {
        rep.step(SIM_DT);
        for (const e of rep.events) {
          if (e.type === 'dive' && e.who === 'db') dove = true;
          if (e.type === 'tackle' && e.kind === 'dive') outcome = 'down';
          if (e.type === 'broken' && e.kind === 'trip') outcome = 'trip';
        }
        rep.events.length = 0;
      }
      expect(dove).toBe(true);
      expect(rep.db.diveKind).toBe('tackle');
      if (outcome === 'down') {
        expect(rep.wr.down).toBe(true);
        expect(rep.result.endedBy).toBe('dive');
      }
      if (outcome === 'trip') expect(rep.wr.stumbling).toBeGreaterThan(0);
      if (outcome) outcomes.add(outcome);
      // However it went, the diver is on the turf.
      for (let i = 0; i < 1 / SIM_DT && !rep.result; i++) rep.step(SIM_DT);
      expect(rep.db.down || rep.db.diving).toBe(true);
    }
    expect(outcomes.has('down')).toBe(true);
    expect(outcomes.has('trip')).toBe(true);
  });

  it('out of diving range the defender leaving his feet does nothing at all', () => {
    const rep = diveAt(1, { x: 0, z: -2 });
    for (let i = 0; i < 0.6 / SIM_DT; i++) {
      rep.step(SIM_DT);
      if (Math.hypot(rep.db.pos.x - rep.wr.pos.x, rep.db.pos.z - rep.wr.pos.z) > TACKLE.diveRange + 0.5) {
        expect(rep.db.airborne).toBe(false);
        expect(rep.db.gather).toBe(0);
      }
    }
  });
});

describe('coming down in bounds', () => {
  // A receiver in the air with the ball in his hands; the defender nowhere near.
  function airborneCatch({ x, z = -12, vx = 0, vz = 0, y = 0.8, rating = 65 }) {
    const still = new Script();
    const rep = new Rep({ wr: { ratings: uniformRatings(rating), controller: still }, db: { ratings: uniformRatings(65), controller: new Script() }, rng: new RNG(3), side: 1 });
    rep.phase = 'flight';
    rep.t = 2;
    const wr = rep.wr;
    wr.pos.x = x;
    wr.pos.z = z;
    wr.vel.x = vx;
    wr.vel.z = vz;
    wr.facing = Math.atan2(vx, vz || 1e-6);
    wr.airborne = true;
    wr.y = y;
    wr.vy = 0;
    rep.db.pos.x = 0;
    rep.db.pos.z = 10;
    rep.ball.attachTo(wr);
    wr.hasBall = true;
    rep.secure({ catchType: 'leap' }, 30);
    for (let i = 0; i < 2 / SIM_DT && !rep.result && rep.phase === 'flight'; i++) rep.step(SIM_DT);
    return rep;
  }

  it('going up in bounds and coming down out of bounds is no catch', () => {
    const rep = airborneCatch({ x: FIELD.halfWidth - 1, vx: 7 });
    expect(rep.result.complete).toBe(false);
    expect(rep.result.reason).toBe('oob');
    expect(rep.result.feetOut).toBe(2);
    expect(scoreFor(rep.result)).toEqual({ role: 'db', points: 1 });
  });

  it('coming down in bounds, it is a catch and he runs with it', () => {
    const rep = airborneCatch({ x: FIELD.halfWidth - 4, vz: -6 });
    expect(rep.result).toBe(null);
    expect(rep.phase).toBe('run');
    expect(rep.run.info.toeTap).toBe(false);
  });

  it('just over the line, good body control drags both toes in: a toe-tap. Poor body control does not.', () => {
    // He lands about half a yard past the line, his momentum taking him out.
    const at = { x: FIELD.halfWidth + 0.15 - 3.2 * Math.sqrt((2 * 0.8) / GRAVITY), vx: 3.2 };
    const good = airborneCatch({ ...at, rating: 95 });
    expect(good.result?.reason === 'oob').toBe(false);
    const toeTap = good.run ? good.run.info.toeTap : good.result.toeTap;
    expect(toeTap).toBe(true);
    expect(good.wr.feetDown.every((f) => Math.abs(f.x) < FIELD.halfWidth)).toBe(true);
    expect(good.wr.dragged).toBe(true);
    const poor = airborneCatch({ ...at, rating: 40 });
    expect(poor.result.reason).toBe('oob');
    expect(poor.result.feetOut).toBeGreaterThan(0);
  });

  it('a dive that lands out of bounds is no catch', () => {
    const rep = new Rep({ wr: { ratings: uniformRatings(65), controller: new Script() }, db: { ratings: uniformRatings(65), controller: new Script() }, rng: new RNG(2), side: 1 });
    rep.phase = 'flight';
    const wr = rep.wr;
    wr.pos.x = FIELD.halfWidth - 1.5;
    wr.pos.z = -12;
    wr.dive({ x: 1, z: 0, speed: 7, air: 0.45 });
    rep.db.pos.z = 10;
    rep.ball.attachTo(wr);
    wr.hasBall = true;
    rep.secure({ catchType: 'dive' }, 30);
    for (let i = 0; i < 2 / SIM_DT && !rep.result; i++) rep.step(SIM_DT);
    expect(rep.result.reason).toBe('oob');
    expect(rep.result.bodyOut).toBe(true);
  });

  it('an interception has to come down in bounds too', () => {
    const pick = (x) => {
      const rep = new Rep({ wr: { ratings: uniformRatings(65), controller: new Script() }, db: { ratings: uniformRatings(65), controller: new Script() }, rng: new RNG(2), side: 1 });
      rep.phase = 'flight';
      const db = rep.db;
      db.pos.x = x;
      db.pos.z = -12;
      db.vel.x = 6;
      db.facing = Math.PI / 2;
      db.airborne = true;
      db.y = 0.7;
      db.vy = 0;
      rep.wr.pos.z = 10;
      rep.ball.attachTo(db);
      db.hasBall = true;
      rep.pick = { info: {} };
      for (let i = 0; i < 2 / SIM_DT && !rep.result; i++) rep.step(SIM_DT);
      return rep.result;
    };
    const out = pick(FIELD.halfWidth - 0.8);
    expect(out.reason).toBe('oob');
    expect(out.pickOob).toBe(true);
    expect(scoreFor(out)).toEqual({ role: 'db', points: 1 });
    const inside = pick(5);
    expect(inside.reason).toBe('int');
    expect(scoreFor(inside)).toEqual({ role: 'db', points: 3 });
  });
});
