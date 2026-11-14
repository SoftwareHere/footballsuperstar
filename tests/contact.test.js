import { describe, it, expect } from 'vitest';
import { SIM_DT, GRAVITY, JUMP, BALANCE, HANDS, CONTACT, FALL } from '../src/config.js';
import { RNG } from '../src/core/rng.js';
import { Rep } from '../src/sim/rep.js';
import { Athlete } from '../src/sim/athlete.js';
import { blankIntent } from '../src/sim/aiCommon.js';
import { uniformRatings } from '../src/sim/ratings.js';
import { angleDelta } from '../src/core/vec.js';
import { ReceiverAI } from '../src/sim/receiverAI.js';
import { DefenderAI } from '../src/sim/defenderAI.js';
import { runRep } from './simHarness.js';

const athlete = (rating = 70, extra = {}) => new Athlete({ ratings: { ...uniformRatings(rating), ...extra }, x: 0, z: 0 });
const idle = blankIntent();
const jump = { ...blankIntent(), jump: true };
const ticks = (seconds) => Math.round(seconds / SIM_DT);

describe('jumping', () => {
  it('loads his legs first: the hands go up at once, the feet leave a beat later', () => {
    const a = athlete();
    a.step(jump, SIM_DT);
    expect(a.attempting).toBe(true);
    expect(a.airborne).toBe(false);
    expect(a.gather).toBeGreaterThan(0);
    let left = null;
    for (let i = 1; i < ticks(0.5) && left === null; i++) {
      a.step(idle, SIM_DT);
      if (a.jumpedThisTick) left = i * SIM_DT;
    }
    expect(left).toBeGreaterThan(JUMP.load - 0.02);
    expect(left).toBeLessThan(JUMP.load + 0.03);
    expect(a.airborne).toBe(true);
  });

  it('goes as high as his jumping says, then comes down on his feet and soaks it up', () => {
    const a = athlete();
    a.step(jump, SIM_DT);
    let peak = 0;
    let landed = false;
    for (let i = 0; i < ticks(2) && !landed; i++) {
      a.step(idle, SIM_DT);
      peak = Math.max(peak, a.y);
      landed = a.landedThisTick;
    }
    expect(landed).toBe(true);
    expect(peak).toBeGreaterThan(a.params.jumpHeight * 0.97);
    expect(peak).toBeLessThan(a.params.jumpHeight * 1.03);
    expect(a.down).toBe(false);
    expect(a.attempting).toBe(false);
    expect(a.landing).toBeGreaterThan(0);
    // A clean landing costs a moment, no more.
    for (let i = 0; i < ticks(JUMP.landing + 0.05); i++) a.step(idle, SIM_DT);
    expect(a.landing).toBe(0);
    expect(a.recovery).toBe(0);
  });

  it('pushes off toward the ball he is going up for, as far as one push allows', () => {
    const near = athlete();
    near.step(jump, SIM_DT, { dive: false, x: 0.8, z: 0, t: 0.5 });
    const far = athlete();
    far.step(jump, SIM_DT, { dive: false, x: 30, z: 0, t: 0.5 });
    const plain = athlete();
    plain.step(jump, SIM_DT);
    for (const a of [near, far, plain]) for (let i = 0; i < ticks(JUMP.load + 0.02); i++) a.step(idle, SIM_DT);
    expect(plain.speed).toBe(0);
    expect(near.vel.x).toBeGreaterThan(0.5);
    expect(near.vel.x).toBeLessThan(JUMP.attack);
    expect(far.vel.x).toBeCloseTo(JUMP.attack, 5);
    // The push gets him to a ball that is within reach of it.
    while (near.airborne) near.step(idle, SIM_DT);
    expect(near.pos.x).toBeGreaterThan(0.6);
  });

  it('turns his whole body to the ball on the way up', () => {
    const a = athlete();
    a.facing = Math.PI; // facing downfield
    a.track = { x: 0, z: 12 }; // the ball is behind him
    a.step(jump, SIM_DT);
    for (let i = 0; i < ticks(0.4); i++) a.step(idle, SIM_DT);
    expect(a.airborne).toBe(true);
    expect(Math.abs(angleDelta(a.facing, 0))).toBeLessThan(0.05);
    // A man who is not playing the ball keeps running the way he was.
    const b = athlete();
    b.facing = Math.PI;
    b.track = { x: 0, z: 12 };
    for (let i = 0; i < ticks(0.4); i++) b.step({ ...idle, z: -1, sprint: true }, SIM_DT);
    expect(Math.abs(angleDelta(b.facing, Math.PI))).toBeLessThan(0.05);
    // ...unless he squares up to catch it on his feet.
    b.squareUp = true;
    for (let i = 0; i < ticks(0.4); i++) b.step(idle, SIM_DT);
    expect(Math.abs(angleDelta(b.facing, 0))).toBeLessThan(0.05);
  });
});

describe('balance', () => {
  it('a bump is shrugged off, a hit makes him stumble, a big one puts him down', () => {
    const a = athlete();
    expect(a.hit(BALANCE.absorb * 0.9, 1, 0)).toBe(null);
    expect(a.balance).toBe(1);
    expect(a.hit(3, 1, 0)).toBe('stumble');
    expect(a.balance).toBeGreaterThan(0);
    expect(a.balance).toBeLessThan(1);
    expect(a.stumbling).toBe(1);
    expect(a.down).toBe(false);
    expect(athlete().hit(9, 1, 0)).toBe('fall');
  });

  it('hits add up, and balance comes back when he is left alone', () => {
    const a = athlete();
    expect(a.hit(3.8, 1, 0)).toBe('stumble');
    const left = a.balance;
    // The same hit again, straight away, is one too many.
    const b = athlete();
    b.hit(3.8, 1, 0);
    expect(b.hit(3.8, 1, 0)).toBe('fall');
    for (let i = 0; i < ticks(0.5); i++) a.step(idle, SIM_DT);
    expect(a.balance).toBeGreaterThan(left);
    for (let i = 0; i < ticks(2); i++) a.step(idle, SIM_DT);
    expect(a.balance).toBe(1);
    expect(a.stumbling).toBe(0);
    expect(a.hit(3.8, 1, 0)).toBe('stumble');
  });

  it('a stumbling man cannot run or cut the way he usually can', () => {
    const run = { ...idle, z: -1, sprint: true };
    const fine = athlete();
    const hurt = athlete();
    hurt.hit(4.5, 0, 1);
    for (let i = 0; i < ticks(0.4); i++) {
      fine.step(run, SIM_DT);
      hurt.step(run, SIM_DT);
    }
    expect(hurt.down).toBe(false);
    expect(-hurt.pos.z).toBeLessThan(-fine.pos.z * 0.8);
    // But he gets his feet back.
    for (let i = 0; i < ticks(1.5); i++) hurt.step(run, SIM_DT);
    expect(hurt.speed).toBeGreaterThan(hurt.params.topSpeed * 0.95);
  });

  it('a man in the air has less to stand on, and agility helps keep your feet', () => {
    const power = 3.6;
    const grounded = athlete();
    grounded.hit(power, 1, 0);
    const flying = athlete();
    flying.airborne = true;
    flying.hit(power, 1, 0);
    expect(flying.balance).toBeLessThan(grounded.balance);
    const nimble = athlete(70, { agility: 99 });
    nimble.hit(power, 1, 0);
    expect(nimble.balance).toBeGreaterThan(grounded.balance);
  });

  it('bumped in the air he lands on his feet and stumbles; hit hard up there he comes down in a heap', () => {
    const land = (power) => {
      const a = athlete();
      a.step(jump, SIM_DT);
      for (let i = 0; i < ticks(JUMP.load + 0.1); i++) a.step(idle, SIM_DT);
      expect(a.airborne).toBe(true);
      const outcome = a.hit(power, 1, 0);
      let guard = 0;
      while (a.airborne && guard++ < 500) a.step(idle, SIM_DT);
      return { a, outcome };
    };
    const bumped = land(2.4);
    expect(bumped.a.down).toBe(false);
    expect(bumped.a.stumbling).toBeGreaterThan(0);
    expect(bumped.a.landing).toBeGreaterThan(JUMP.landing); // a heavy landing
    const clean = land(0);
    expect(clean.a.down).toBe(false);
    expect(clean.a.stumbling).toBe(0);
    const drilled = land(6);
    expect(drilled.outcome).toBe('fall');
    expect(drilled.a.down).toBe(true);
  });

  it('once down he stays down until he has stopped sliding, then takes his time getting up', () => {
    const a = athlete();
    a.vel.z = -9;
    a.knockdown({ vx: 0, vy: 2, vz: -3, high: true }, 0.05);
    let started = null;
    for (let i = 0; i < ticks(4) && a.down; i++) {
      a.step(idle, SIM_DT);
      if (started === null && a.rise > 0) {
        started = i * SIM_DT;
        expect(a.speed).toBeLessThanOrEqual(FALL.settle);
      }
    }
    expect(started).toBeGreaterThan(0.3); // long after the 0.05s he was told to lie there
    expect(a.down).toBe(false);
    expect(a.balance).toBe(1);
  });
});

/** A contact as Rep.collide reports it: receiver at -n, defender at +n. */
const contact = (closing, { va = 0, vb = closing, aShare = 0.5 } = {}) => ({ closing, va, vb, nx: 0, nz: -1, aShare, fresh: true });

function pair(wrRatings = uniformRatings(65), dbRatings = uniformRatings(65)) {
  const still = { intent: blankIntent(), update() { return this.intent; } };
  const rng = new RNG(1);
  return new Rep({ wr: { ratings: wrRatings, controller: still }, db: { ratings: dbRatings, controller: { ...still, intent: blankIntent() } }, rng });
}

describe('hits', () => {
  it('the man who is hit feels it more than the man who brings it', () => {
    const rep = pair();
    rep.strike(contact(5), 'wr');
    rep.strike(contact(5), 'db');
    expect(rep.wr.balance).toBeLessThan(rep.db.balance);
    expect(rep.db.balance).toBeGreaterThan(0.5);
  });

  it('strength decides who stays on his feet', () => {
    const outcome = (wrStrength) => {
      const rep = pair({ ...uniformRatings(65), strength: wrStrength }, uniformRatings(65));
      const c = contact(5.6, { aShare: rep.db.params.strength / (rep.wr.params.strength + rep.db.params.strength) });
      return { result: rep.strike(c, 'wr'), wr: rep.wr };
    };
    const weak = outcome(40);
    const strong = outcome(95);
    expect(weak.result).toBe('fall');
    expect(weak.wr.down).toBe(true);
    expect(weak.wr.fall).not.toBe(null);
    expect(strong.result).toBe('stumble');
    expect(strong.wr.down).toBe(false);
    // The stumble carries him the way he was hit (the defender came from -z... toward +z).
    expect(strong.wr.vel.z).toBeGreaterThan(0.5);
  });

  it('before the catch a man on his feet stumbles but is never knocked over', () => {
    const rep = pair();
    rep.touching = false;
    rep.jostle(contact(14));
    expect(rep.wr.down).toBe(false);
    expect(rep.wr.balance).toBeGreaterThanOrEqual(BALANCE.floor);
    expect(rep.wr.stumbling).toBeGreaterThan(0);
    expect(rep.events.some((e) => e.type === 'stumble' && e.who === 'wr')).toBe(true);
    // After the whistle the same collision puts him on the turf.
    const late = pair();
    late.phase = 'done';
    late.jostle(contact(14));
    expect(late.wr.down).toBe(true);
    expect(late.events.filter((e) => e.type === 'fall' && e.who === 'wr').length).toBe(1);
  });

  it('with the ball in his hands he keeps his feet through a hit if he can', () => {
    const rep = pair();
    rep.phase = 'flight';
    rep.securing = { until: 1, needGround: false, threat: true, info: { catchType: 'body' } };
    rep.wr.securing = true;
    rep.wr.hasBall = true;
    rep.ball.attachTo(rep.wr);
    rep.resolveHit(contact(4.4)); // used to be an automatic knockdown
    expect(rep.result).not.toBe(null);
    expect(rep.wr.down).toBe(false);
    expect(rep.wr.stumbling).toBeGreaterThan(0);
    expect(rep.result.knockedDown).toBe(false);
    const hit = rep.events.find((e) => e.type === 'hit');
    expect(hit.down).toBe(false);

    const big = pair();
    big.phase = 'flight';
    big.securing = { until: 1, needGround: false, threat: true, info: { catchType: 'body' } };
    big.wr.hasBall = true;
    big.ball.attachTo(big.wr);
    big.resolveHit(contact(8));
    expect(big.wr.down).toBe(true);
    expect(big.result.knockedDown).toBe(true);
    expect(big.events.find((e) => e.type === 'hit').down).toBe(true);
    expect(CONTACT.downTime).toBeGreaterThan(0);
  });

  it('in real reps some hits at the catch leave him standing and some put him down', () => {
    let standing = 0;
    let down = 0;
    for (let seed = 0; seed < 500; seed++) {
      const { result } = runRep({ wrRatings: uniformRatings(65), dbRatings: uniformRatings(80), seed: 5000 + seed });
      if (result.hit === undefined) continue;
      if (result.knockedDown) down += 1;
      else standing += 1;
    }
    expect(standing).toBeGreaterThan(5);
    expect(down).toBeGreaterThan(5);
  });
});

// A receiver who runs straight downfield, and a corner who squats in front of him.
class Straight {
  constructor() {
    this.intent = blankIntent();
  }
  update(rep) {
    this.intent.snap = rep.phase === 'presnap';
    this.intent.z = rep.phase === 'presnap' ? 0 : -1;
    this.intent.sprint = true;
    return this.intent;
  }
}
class Squat {
  constructor() {
    this.intent = blankIntent();
  }
  setup(rep) {
    rep.db.pos.x = rep.wr.pos.x + 0.25;
    rep.db.pos.z = rep.wr.pos.z - 1.6;
    rep.db.faceTarget = rep.wr.pos;
  }
  update(rep) {
    // Mirror him side to side, give no ground.
    const off = rep.wr.pos.x - rep.db.pos.x;
    this.intent.x = Math.sign(off) * Math.min(1, Math.abs(off) * 2);
    return this.intent;
  }
}

/**
 * Run the release. `start` moves both men that many yards downfield before
 * the snap, so the same meeting happens outside the jam zone.
 */
function release({ wrStrength = 65, dbStrength = 65, corner = true, yards = 6, start = 0 } = {}) {
  const rep = new Rep({
    wr: { ratings: { ...uniformRatings(65), strength: wrStrength }, controller: new Straight() },
    db: { ratings: { ...uniformRatings(65), strength: dbStrength }, controller: new Squat() },
    rng: new RNG(5),
    side: 1,
  });
  rep.wr.pos.z -= start;
  rep.db.pos.z -= start;
  const out = { time: null, shoved: 0, wrHands: new Set(), dbHands: new Set(), events: new Set(), rep };
  Object.assign(out, { punches: 0, stumbles: 0, handsOn: 0, touching: 0, lowBalance: 1 });
  for (let i = 0; i < ticks(8) && out.time === null; i++) {
    if (!corner) rep.db.pos.x = rep.wr.pos.x + 10;
    rep.step(SIM_DT);
    if (rep.wr.hands) out.wrHands.add(rep.wr.hands.kind);
    if (rep.db.hands) out.dbHands.add(rep.db.hands.kind);
    for (const e of rep.events) {
      out.events.add(e.type);
      if (e.type === 'punch') out.punches += 1;
      if (e.type === 'stumble' && e.who === 'wr') out.stumbles += 1;
    }
    if (rep.wr.held > 0) out.handsOn += SIM_DT; // seconds with the corner's hands on him
    if (rep.touching) out.touching += SIM_DT; // ...and with their bodies together
    out.lowBalance = Math.min(out.lowBalance, rep.wr.balance);
    rep.events.length = 0;
    out.shoved = Math.max(out.shoved, -rep.db.vel.z); // how hard the corner was driven back
    if (-rep.wr.pos.z >= yards + start) out.time = rep.t;
  }
  return out;
}

describe('hands at the line', () => {
  it('the corner jams, the receiver fights his hands and gets past instead of stopping', () => {
    const free = release({ corner: false });
    const even = release();
    expect(free.wrHands.size).toBe(0);
    expect(even.dbHands.has('jam')).toBe(true);
    expect(even.wrHands.has('release')).toBe(true);
    expect(even.events.has('hands')).toBe(true);
    // The jam costs him real time, but he is through: he does not sit on the man's chest.
    expect(even.time).not.toBe(null);
    expect(even.time).toBeGreaterThan(free.time + 0.4);
    expect(even.time).toBeLessThan(free.time + 1.0);
    expect(even.rep.wr.pos.z).toBeLessThan(even.rep.db.pos.z - 1);
    // It is a fight, not a brush: hands on him for most of a second, and bodies together.
    expect(even.handsOn).toBeGreaterThan(0.5);
    expect(even.touching).toBeGreaterThan(0.15);
  });

  it('the jam lands with a punch: it takes a bite out of his speed and rocks him', () => {
    const even = release();
    expect(even.events.has('punch')).toBe(true);
    expect(even.lowBalance).toBeLessThan(0.97);
    expect(even.stumbles).toBe(0); // an even punch rocks him, no more
    // The instant it lands, at arm's length with the receiver coming at him.
    const rep = pair();
    rep.phase = 'live';
    Object.assign(rep.wr.pos, { x: 0, z: 0 });
    Object.assign(rep.db.pos, { x: 0, z: -1 });
    rep.db.facing = 0;
    rep.wr.vel.z = -4;
    rep.wr.want.z = -8;
    rep.handFight(SIM_DT);
    expect(rep.events.some((e) => e.type === 'punch')).toBe(true);
    expect(-rep.wr.vel.z).toBeLessThan(4 - HANDS.punch * 0.8);
    expect(-rep.wr.vel.z).toBeGreaterThan(0); // stood up, not sent backwards
    expect(rep.wr.balance).toBeLessThan(1);
    // It only lands once.
    rep.events.length = 0;
    rep.handFight(SIM_DT);
    expect(rep.events.some((e) => e.type === 'punch')).toBe(false);
    // A much stronger corner's punch knocks a weak receiver off his stride.
    const bullied = release({ wrStrength: 40, dbStrength: 95 });
    expect(bullied.stumbles).toBeGreaterThan(0);
    expect(bullied.rep.wr.down).toBe(false);
  });

  it('once the jam is shed it is beaten: no second one until there is daylight between them', () => {
    const weak = release({ wrStrength: 40, dbStrength: 95 });
    expect(weak.events.has('shed')).toBe(true);
    expect(weak.punches).toBe(1);
    expect(weak.time).not.toBe(null);
    // Daylight gives the corner his jam back.
    const rep = weak.rep;
    rep.fight.spent = true;
    rep.db.pos.x = rep.wr.pos.x + HANDS.show + 1;
    rep.handFight(SIM_DT);
    expect(rep.fight.spent).toBe(false);
  });

  it('strength decides the hand fight, both ways', () => {
    const even = release();
    const strongWr = release({ wrStrength: 95 });
    const weakWr = release({ wrStrength: 40 });
    const strongDb = release({ dbStrength: 95 });
    const weakDb = release({ dbStrength: 40 });
    expect(strongWr.time).toBeLessThan(even.time - 0.08);
    expect(weakWr.time).toBeGreaterThan(even.time + 0.15);
    expect(strongDb.time).toBeGreaterThan(even.time + 0.15);
    expect(weakDb.time).toBeLessThan(even.time - 0.08);
    // The mismatch is not a wall: even the weakest receiver gets off the line.
    expect(release({ wrStrength: 40, dbStrength: 95 }).time).toBeLessThan(3.2);
    // The stronger receiver drives into the hands; the weaker one is stood up by them.
    expect(strongWr.touching).toBeGreaterThan(0.1);
    expect(strongWr.handsOn).toBeLessThan(even.handsOn);
    expect(weakWr.handsOn).toBeGreaterThan(even.handsOn);
  });

  it('a stronger receiver moves the corner off his spot, and is slowed less himself', () => {
    // One instant of the fight, at arm's length, receiver driving into the corner.
    const instant = (wrStrength, dbStrength) => {
      const rep = pair({ ...uniformRatings(65), strength: wrStrength }, { ...uniformRatings(65), strength: dbStrength });
      rep.phase = 'live';
      Object.assign(rep.wr.pos, { x: 0, z: 0 });
      Object.assign(rep.db.pos, { x: 0, z: -1 });
      rep.db.facing = 0; // squared up to him
      rep.wr.vel.z = -3;
      rep.wr.want.z = -6;
      rep.handFight(SIM_DT);
      return { slowed: rep.wr.vel.z + 3, shoved: -rep.db.vel.z, wrHeld: rep.wr.held, dbHeld: rep.db.held };
    };
    const bully = instant(95, 40);
    const even = instant(65, 65);
    const bullied = instant(40, 95);
    expect(even.slowed).toBeGreaterThan(0);
    expect(even.shoved).toBeGreaterThan(0);
    expect(bully.shoved).toBeGreaterThan(even.shoved * 1.3);
    expect(even.shoved).toBeGreaterThan(bullied.shoved * 1.3);
    expect(bully.slowed).toBeLessThan(even.slowed * 0.75);
    expect(bullied.slowed).toBeGreaterThan(even.slowed * 1.3);
    // Hands on a man take some of his footwork away, more so from the weaker one.
    expect(bullied.wrHeld).toBeGreaterThan(bully.wrHeld);
    expect(bully.dbHeld).toBeGreaterThan(bullied.dbHeld);
  });

  it('down the field it is only a hand-check, and nobody jams a man who is past him', () => {
    // The same meeting, but well past the line: the jam zone is behind them.
    const deep = release({ start: HANDS.zone + 1 });
    expect(deep.dbHands.has('check')).toBe(true);
    expect(deep.dbHands.has('jam')).toBe(false);
    const close = release();
    const free = release({ corner: false });
    expect(deep.time - free.time).toBeLessThan((close.time - free.time) * 0.8);
    expect(deep.time).toBeGreaterThan(free.time);
    // Once he is by him the hands come off.
    const rep = deep.rep;
    for (let i = 0; i < ticks(0.5); i++) rep.step(SIM_DT);
    expect(rep.wr.pos.z).toBeLessThan(rep.db.pos.z);
    expect(rep.wr.held).toBe(0);
    expect(rep.wr.hands).toBe(null);
    expect(HANDS.check).toBeLessThan(1);
  });

  it('hands come off when the ball is in the air, and a man on the turf has none', () => {
    const rep = release({ yards: 0.9 }).rep; // stopped while they are still engaged
    expect(rep.db.hands).not.toBe(null);
    rep.phase = 'flight';
    rep.handFight(SIM_DT);
    expect(rep.db.hands).toBe(null);
    expect(rep.wr.hands).toBe(null);
    rep.phase = 'live';
    rep.db.goDown(1, null);
    rep.handFight(SIM_DT);
    expect(rep.wr.hands).toBe(null);
    expect(rep.wr.held).toBe(0);
  });

  it('a sidestep gets him out of the hands sooner', () => {
    const shedAt = (juke) => {
      const rep = new Rep({
        wr: { ratings: uniformRatings(65), controller: new Straight() },
        db: { ratings: uniformRatings(65), controller: new Squat() },
        rng: new RNG(5),
        side: 1,
      });
      for (let i = 0; i < ticks(4); i++) {
        rep.wrCtl.intent.juke = juke && rep.fight.on && rep.fight.time > 0.15 ? 1 : 0;
        rep.step(SIM_DT);
        if (rep.events.some((e) => e.type === 'shed')) return rep.t;
        if (rep.fight.time === 0 && rep.t > 0.6 && !rep.fight.on) return rep.t; // out of them without a shed
        rep.events.length = 0;
      }
      return null;
    };
    expect(shedAt(true)).toBeLessThan(shedAt(false) - 0.2);
  });

  it('gravity is gravity', () => {
    // Hang time of a jump follows from its height: nobody floats.
    const a = athlete();
    a.step(jump, SIM_DT);
    let air = 0;
    for (let i = 0; i < ticks(3); i++) {
      a.step(idle, SIM_DT);
      if (a.airborne) air += SIM_DT;
    }
    const expected = 2 * Math.sqrt((2 * a.params.jumpHeight) / GRAVITY);
    expect(Math.abs(air - expected)).toBeLessThan(0.03);
  });
});

// A receiver who just runs, and a corner who chases him down from behind.
class Run {
  constructor(jukeAt = null) {
    this.intent = blankIntent();
    this.jukeAt = jukeAt;
  }
  update(rep) {
    this.intent.z = -1;
    this.intent.sprint = true;
    this.intent.juke = this.jukeAt !== null && rep.t >= this.jukeAt ? 1 : 0;
    if (this.intent.juke) this.jukeAt = null;
    return this.intent;
  }
}
class Chase {
  constructor() {
    this.intent = blankIntent();
  }
  update(rep) {
    const dx = rep.wr.pos.x - rep.db.pos.x;
    const dz = rep.wr.pos.z - rep.db.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.intent.x = dx / d;
    this.intent.z = dz / d;
    this.intent.sprint = true;
    return this.intent;
  }
}

/**
 * The receiver is already running down the field at `speed` and the corner
 * starts `gap` yards behind him. `dbSpeed` is the corner's speed rating.
 */
function chase({ gap = 2.5, dbSpeed = 65, seconds = 3, speed = 7, jukeAt = null } = {}) {
  const rep = new Rep({
    wr: { ratings: uniformRatings(65), controller: new Run(jukeAt) },
    db: { ratings: { ...uniformRatings(65), speed: dbSpeed }, controller: new Chase() },
    rng: new RNG(5),
    side: 1,
  });
  rep.snap();
  Object.assign(rep.wr.pos, { x: 11, z: -6 });
  Object.assign(rep.db.pos, { x: 11, z: -6 + gap });
  rep.wr.vel.z = -speed;
  rep.db.vel.z = -speed;
  const out = { rep, hit: null, shed: null, kinds: new Set(), wrKinds: new Set(), events: [] };
  Object.assign(out, { ridden: 0, together: 0, slowest: 99, dbSlowest: 99, dbFastest: 0, wrFastest: 0, gapAfterHit: 0 });
  for (let i = 0; i < ticks(seconds); i++) {
    rep.step(SIM_DT);
    for (const e of rep.events) {
      out.events.push(e);
      if (e.type === 'shed' && out.shed === null) out.shed = rep.t;
    }
    rep.events.length = 0;
    const d = Math.hypot(rep.db.pos.x - rep.wr.pos.x, rep.db.pos.z - rep.wr.pos.z);
    if (rep.touching && out.hit === null) out.hit = rep.t;
    if (rep.db.hands) out.kinds.add(rep.db.hands.kind);
    if (rep.wr.hands) out.wrKinds.add(rep.wr.hands.kind);
    out.wrFastest = Math.max(out.wrFastest, rep.wr.speed);
    out.dbFastest = Math.max(out.dbFastest, rep.db.speed);
    if (out.hit !== null && out.shed === null) {
      out.dbSlowest = Math.min(out.dbSlowest, rep.db.speed);
      out.gapAfterHit = Math.max(out.gapAfterHit, d);
      if (d < HANDS.reach) out.together += SIM_DT;
    }
    if (rep.wr.held > 0) {
      out.ridden += SIM_DT;
      out.slowest = Math.min(out.slowest, rep.wr.speed);
    }
  }
  out.depth = -rep.wr.pos.z;
  return out;
}

describe('contact costs speed', () => {
  it('a receiver who glances off a defender comes away slower, never faster', () => {
    const rep = pair();
    rep.phase = 'live';
    Object.assign(rep.wr.pos, { x: 0, z: 0 });
    Object.assign(rep.db.pos, { x: 0.5, z: -0.65 }); // half a body across his path
    rep.wr.vel.z = -8;
    const contact = rep.collide();
    expect(contact).not.toBe(null);
    expect(rep.wr.speed).toBeLessThan(7.5);
    expect(rep.wr.speed).toBeGreaterThan(4); // he slides off him: he does not stop on his chest
    expect(rep.wr.vel.x).toBeLessThan(-1); // ...past the shoulder he was already outside of
    // Leaning on him after that does not build speed out of nothing either.
    for (let i = 0; i < 40; i++) {
      const before = rep.wr.speed;
      rep.collide();
      expect(rep.wr.speed).toBeLessThanOrEqual(before + 1e-9);
    }
  });

  it('what a man loses is the speed between them, not the speed they share', () => {
    // Running the same way, the corner a touch faster and right on his back.
    const rep = pair();
    rep.phase = 'live';
    Object.assign(rep.wr.pos, { x: 0, z: -10 });
    Object.assign(rep.db.pos, { x: 0, z: -9.2 });
    rep.wr.vel.z = -8;
    rep.db.vel.z = -9;
    const contact = rep.collide();
    expect(contact.closing).toBeCloseTo(1, 5);
    // He slows to the receiver's pace. He used to lose most of his nine yards a second.
    expect(-rep.db.vel.z).toBeGreaterThan(7.9);
    expect(-rep.db.vel.z).toBeLessThan(9);
    expect(-rep.wr.vel.z).toBeCloseTo(8, 5); // and the receiver is not shoved along
    // Head on, each still loses most of what he brought.
    const meet = pair();
    meet.phase = 'live';
    Object.assign(meet.wr.pos, { x: 0, z: 0 });
    Object.assign(meet.db.pos, { x: 0, z: -0.8 });
    meet.wr.vel.z = -6;
    meet.db.vel.z = 4;
    meet.collide();
    expect(-meet.wr.vel.z).toBeLessThan(6 * 0.5);
    expect(meet.db.vel.z).toBeLessThan(4 * 0.5);
  });

  it('nobody comes out of the hands or off a body faster than his own legs carry him', () => {
    let worst = 0;
    let fights = 0;
    for (const [wrRating, dbRating] of [
      [65, 65],
      [85, 55],
      [55, 85],
    ]) {
      for (let seed = 0; seed < 60; seed++) {
        const rng = new RNG(7000 + seed);
        const rep = new Rep({
          wr: { ratings: uniformRatings(wrRating), controller: new ReceiverAI({ rng, tier: 5 }) },
          db: { ratings: uniformRatings(dbRating), controller: new DefenderAI({ rng }) },
          rng,
          side: seed % 2 ? 1 : -1,
        });
        const sinceJuke = { wr: 9, db: 9 };
        let fought = false;
        for (let i = 0; i < ticks(20) && !rep.result; i++) {
          rep.step(SIM_DT);
          rep.events.length = 0;
          if (rep.phase !== 'live') continue;
          const d = Math.hypot(rep.db.pos.x - rep.wr.pos.x, rep.db.pos.z - rep.wr.pos.z);
          for (const who of ['wr', 'db']) {
            const a = rep[who];
            // A juke is a burst of his own; it is the only thing here that tops his sprint.
            sinceJuke[who] = a.jukeLock > 0 ? 0 : sinceJuke[who] + SIM_DT;
            if (d < HANDS.show && sinceJuke[who] > 0.8) worst = Math.max(worst, a.speed / a.params.topSpeed);
          }
          if (rep.fight.on) fought = true;
        }
        if (fought) fights += 1;
      }
    }
    expect(fights).toBeGreaterThan(60); // plenty of hand fights in there
    expect(worst).toBeLessThanOrEqual(1.0001);
  });
});

describe('riding a receiver', () => {
  it('a corner who runs into the back of a receiver stays on him instead of bouncing off', () => {
    const free = chase({ gap: 30 });
    const ride = chase({ dbSpeed: 85 });
    expect(ride.hit).not.toBe(null);
    // From the hit until the hands are shed he never loses him, and he never stops dead.
    expect(ride.shed).toBeGreaterThan(ride.hit + 0.6);
    expect(ride.gapAfterHit).toBeLessThan(HANDS.full);
    expect(ride.together).toBeGreaterThan(0.6);
    expect(ride.dbSlowest).toBeGreaterThan(ride.rep.wr.params.topSpeed * 0.6);
    // Hands on his hip and his back, and the receiver feels every bit of it.
    expect(ride.kinds.has('ride')).toBe(true);
    expect(ride.wrKinds.has('ridden')).toBe(true);
    expect(ride.events.some((e) => e.type === 'hands' && e.kind === 'ride')).toBe(true);
    expect(ride.slowest).toBeLessThan(ride.rep.wr.params.topSpeed * 0.8);
    expect(ride.depth).toBeLessThan(free.depth - 1.5);
    // Nobody got a tow or a shove out of it.
    expect(ride.wrFastest).toBeLessThanOrEqual(ride.rep.wr.params.topSpeed + 1e-6);
    expect(ride.dbFastest).toBeLessThanOrEqual(ride.rep.db.params.topSpeed + 1e-6);
  });

  it('he has to get his body on him: hands that are only reaching do nothing', () => {
    // Same speed, a yard behind: within arm's reach all the way, and never touching.
    const free = chase({ gap: 30 });
    const close = chase({ gap: 1.0 });
    expect(close.hit).toBe(null);
    expect(close.kinds.has('ride')).toBe(true); // the arms are up
    expect(close.ridden).toBe(0);
    expect(close.depth).toBeCloseTo(free.depth, 3);
  });

  it('the hold is strength against strength, and it works anywhere on the field', () => {
    const ridden = (wrStrength, dbStrength) => {
      const rep = pair({ ...uniformRatings(65), strength: wrStrength }, { ...uniformRatings(65), strength: dbStrength });
      rep.phase = 'live';
      Object.assign(rep.wr.pos, { x: 0, z: -20 }); // well past the jam zone
      Object.assign(rep.db.pos, { x: 0, z: -19.14 }); // on his back
      rep.db.facing = Math.PI; // chasing him
      rep.wr.vel.z = -7;
      rep.wr.want.z = -8;
      rep.db.vel.z = -7;
      rep.touching = true; // he has run into him
      rep.handFight(SIM_DT);
      return rep;
    };
    const even = ridden(65, 65);
    expect(even.fight.mode).toBe('ride');
    expect(even.wr.held).toBeGreaterThan(0.6);
    expect(ridden(40, 95).wr.held).toBeGreaterThan(even.wr.held);
    expect(ridden(95, 40).wr.held).toBeLessThan(even.wr.held * 0.6);
    // Being held takes top speed as well as footwork.
    const run = { ...idle, z: -1, sprint: true };
    const loose = athlete();
    const held = athlete();
    for (let i = 0; i < ticks(2); i++) {
      held.held = even.wr.held;
      loose.step(run, SIM_DT);
      held.step(run, SIM_DT);
    }
    expect(held.speed).toBeLessThan(loose.speed * 0.85);
    expect(held.speed).toBeGreaterThan(loose.speed * 0.6);
    // What he is trying to do has not changed: that is what the quarterback reads.
    expect(Math.hypot(held.want.x, held.want.z)).toBeCloseTo(loose.speed, 3);
  });

  it('when the receiver pulls away the corner hangs on, and it drags at the receiver', () => {
    const rep = pair();
    rep.phase = 'live';
    Object.assign(rep.wr.pos, { x: 0, z: -20 });
    Object.assign(rep.db.pos, { x: 0, z: -19.1 });
    rep.db.facing = Math.PI;
    rep.wr.vel.z = -8;
    rep.wr.want.z = -8;
    rep.db.vel.z = -6;
    rep.touching = true;
    rep.handFight(SIM_DT);
    expect(-rep.wr.vel.z).toBeLessThan(8);
    expect(-rep.db.vel.z).toBeGreaterThan(6);
    expect(-rep.db.vel.z).toBeLessThan(-rep.wr.vel.z); // towed, not slung past him
  });

  it('the receiver sheds it in time, a juke sheds it sooner, and then the corner has to hit him again', () => {
    const ride = chase({ dbSpeed: 85 });
    expect(ride.events.some((e) => e.type === 'shed')).toBe(true);
    const shaken = chase({ dbSpeed: 85, jukeAt: ride.hit + 0.25 });
    expect(shaken.shed).toBeLessThan(ride.shed - 0.2);
    // Right after the shed the hands are off, and stay off until he gets his body on him again.
    const rep = pair();
    rep.phase = 'live';
    Object.assign(rep.wr.pos, { x: 0, z: -20 });
    Object.assign(rep.db.pos, { x: 0, z: -19.0 });
    rep.db.facing = Math.PI;
    rep.wr.vel.z = -8;
    rep.wr.want.z = -8;
    rep.db.vel.z = -8;
    rep.touching = true;
    rep.handFight(SIM_DT);
    expect(rep.wr.held).toBeGreaterThan(0);
    rep.fight.time = 99; // long enough for anybody
    rep.handFight(SIM_DT);
    expect(rep.fight.rest).toBeGreaterThan(0);
    rep.touching = false;
    for (let i = 0; i < ticks(HANDS.rest + 0.2); i++) rep.handFight(SIM_DT);
    expect(rep.fight.rest).toBe(0);
    expect(rep.wr.held).toBe(0); // still within reach, but he has not hit him again
    rep.touching = true;
    rep.handFight(SIM_DT);
    expect(rep.wr.held).toBeGreaterThan(0);
  });

  it('the jam turns into a ride as the receiver gets past, and the hands come off for the ball', () => {
    const even = release();
    expect(even.dbHands.has('jam')).toBe(true);
    expect(even.dbHands.has('ride')).toBe(true);
    const ride = chase({ dbSpeed: 85, seconds: 2.2 });
    expect(ride.rep.wr.held).toBeGreaterThan(0);
    ride.rep.phase = 'flight';
    ride.rep.handFight(SIM_DT);
    expect(ride.rep.wr.held).toBe(0);
    expect(ride.rep.db.hands).toBe(null);
    expect(ride.rep.fight.mode).toBe(null);
  });
});
