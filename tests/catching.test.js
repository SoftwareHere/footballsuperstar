import { describe, it, expect } from 'vitest';
import { Athlete } from '../src/sim/athlete.js';
import { uniformRatings } from '../src/sim/ratings.js';
import {
  reachInfo,
  catchProbability,
  breakupProbability,
  classifyCatch,
  holdOnProbability,
  groundHoldProbability,
  planBallPlay,
  isToeTap,
  tipChance,
} from '../src/sim/catching.js';
import { Ball } from '../src/sim/ball.js';
import { RNG } from '../src/core/rng.js';
import { SIM_DT, DIVE, FIELD, TIP } from '../src/config.js';

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

describe('physical catches', () => {
  // A flat pass arriving at (0, -10), a quarter of a second out.
  function incoming() {
    const ball = new Ball(0, 2.1, 5);
    ball.throwTo({ x: 0, y: 2.1, z: 5 }, { x: 0, y: 1.65, z: -10 }, 0.75);
    while (ball.eta > 0.25) ball.step(SIM_DT);
    return ball;
  }

  it('names the catch from how the ball met the body', () => {
    const a = athlete(70);
    const ballPos = { x: 0, y: 1.5, z: 0 };
    const still = { x: 0, y: -4, z: 0 };
    const kind = (reach, extra = {}) => classifyCatch({ athlete: a, reach, ballPos, ballVel: still, ...extra });
    expect(kind({ kind: 'dive', quality: 0.5 })).toBe('dive');
    expect(kind({ kind: 'body', quality: 0.8 }, { tips: 1 })).toBe('juggle');
    expect(kind({ kind: 'attempt', quality: 0.1 })).toBe('oneHand');
    expect(kind({ kind: 'attempt', quality: 0.8 })).toBe('leap');
    expect(kind({ kind: 'body', quality: 0.8 })).toBe('body');
    expect(kind({ kind: 'body', quality: 0.8 }, { ballPos: { x: 0, y: 0.8, z: 0 } })).toBe('low');
    // Running away from the passer with the ball dropping in from behind.
    a.vel.z = -8;
    expect(kind({ kind: 'attempt', quality: 0.8 }, { ballVel: { x: 0, y: -5, z: -18 } })).toBe('overShoulder');
  });

  it('a harder hit is harder to hold on through; hands and strength help', () => {
    const wr = athlete(60);
    const db = athlete(60);
    const hold = (over = {}) => holdOnProbability({ wr, db, closing: 5, ...over });
    expect(hold({ closing: 8 })).toBeLessThan(hold({ closing: 3 }));
    expect(hold({ wr: athlete(60, { hands: 95 }) })).toBeGreaterThan(hold());
    expect(hold({ wr: athlete(60, { strength: 95 }) })).toBeGreaterThan(hold());
    expect(hold({ db: athlete(60, { strength: 95 }) })).toBeLessThan(hold());
    expect(hold({ airborne: true })).toBeLessThan(hold());
    expect(hold({ catchType: 'oneHand' })).toBeLessThan(hold());
    for (const closing of [0, 2, 6, 20]) {
      const p = hold({ closing });
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
    expect(groundHoldProbability(athlete(95))).toBeGreaterThan(groundHoldProbability(athlete(50)));
  });

  it('lays out only when a jump cannot get there and a dive can', () => {
    const ball = incoming();
    const low = ball.whenAt(DIVE.height);
    const at = (x, z) => {
      const a = athlete(60);
      a.pos.x = x;
      a.pos.z = z;
      return a;
    };
    // Standing on the spot: just jump.
    expect(planBallPlay(at(0, -10), ball).dive).toBe(false);
    // A couple of yards to the side: dive, toward the ball.
    const plan = planBallPlay(at(low.x + 2.4, low.z), ball);
    expect(plan.dive).toBe(true);
    expect(plan.x).toBeLessThan(-0.9);
    expect(plan.speed).toBeGreaterThanOrEqual(DIVE.minSpeed);
    expect(plan.speed).toBeLessThanOrEqual(DIVE.maxSpeed);
    // Hopelessly far: no point.
    expect(planBallPlay(at(low.x + DIVE.range + 2, low.z), ball).dive).toBe(false);
    // Already on the turf, or the ball is not in the air.
    const down = at(low.x + 2.4, low.z);
    down.down = true;
    expect(planBallPlay(down, ball).dive).toBe(false);
    ball.state = 'loose';
    expect(planBallPlay(at(low.x + 2.4, low.z), ball).dive).toBe(false);
  });

  it('a dive reaches a ball a man on his feet cannot', () => {
    const a = athlete(60);
    const spot = { x: -1.3, y: 1.0, z: 0 };
    expect(reachInfo(a, 'wr', spot).inReach).toBe(false);
    a.dive({ x: -1, z: 0, speed: 7, air: 0.4 });
    expect(a.diving).toBe(true);
    const laidOut = reachInfo(a, 'wr', spot);
    expect(laidOut.kind).toBe('dive');
    expect(laidOut.inReach).toBe(true);
    // Flat on the turf he can reach nothing.
    a.goDown(1, null);
    expect(reachInfo(a, 'wr', spot).inReach).toBe(false);
  });

  it('a toe-tap is a catch at the boundary with momentum carrying him out', () => {
    const a = athlete(60);
    a.pos.x = FIELD.halfWidth - 0.4;
    a.vel.x = 6;
    expect(isToeTap(a)).toBe(true);
    a.vel.x = -6; // coming back in
    expect(isToeTap(a)).toBe(false);
    a.pos.x = 0;
    a.vel.x = 6; // middle of the field
    expect(isToeTap(a)).toBe(false);
  });

  it('a ball that hits him square is more likely to pop up alive', () => {
    expect(tipChance({ quality: 0.9, kind: 'attempt' })).toBeGreaterThan(tipChance({ quality: 0.1, kind: 'attempt' }));
    expect(tipChance({ quality: 1, kind: 'none' })).toBe(0);
  });

  it('a tipped ball is a new, short flight that still comes down', () => {
    const ball = incoming();
    while (ball.eta > 0) ball.step(SIM_DT);
    ball.tip(new RNG(5));
    expect(ball.state).toBe('flight');
    expect(ball.tips).toBe(1);
    expect(ball.vel.y).toBeGreaterThanOrEqual(TIP.pop[0]);
    expect(ball.eta).toBeGreaterThan(0.2);
    expect(ball.eta).toBeLessThan(1.5);
    // The ring moves to where it is coming down, and it does come down there.
    const target = { ...ball.target };
    let landed = false;
    let closest = Infinity;
    for (let i = 0; i < 3 / SIM_DT && !landed; i++) {
      landed = ball.step(SIM_DT);
      if (ball.vel.y < 0) closest = Math.min(closest, Math.hypot(ball.pos.x - target.x, ball.pos.y - target.y, ball.pos.z - target.z));
    }
    expect(landed).toBe(true);
    expect(closest).toBeLessThan(0.15);
  });
});
