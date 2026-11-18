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
  feetOut,
  tipChance,
} from '../src/sim/catching.js';
import { Ball } from '../src/sim/ball.js';
import { RNG } from '../src/core/rng.js';
import { SIM_DT, DIVE, FIELD, TIP, JUMP } from '../src/config.js';

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

  it('feet come down under him in the open field; by a line he drags them back in, as far as his body control allows', () => {
    const open = athlete(70);
    open.pos.x = 10;
    open.vel.x = 6;
    open.facing = Math.PI / 2;
    const free = open.footfall();
    expect(free.dragged).toBe(false);
    expect(free.feet[1].x).toBeGreaterThan(open.pos.x + 0.5); // the second foot a stride on
    // Coming down just over the sideline with his momentum taking him out.
    const over = (rating) => {
      const a = athlete(60, { agility: rating, hands: rating });
      a.pos.x = FIELD.halfWidth + 0.3;
      a.vel.x = 5;
      a.facing = Math.PI / 2;
      return a.footfall();
    };
    const great = over(95);
    expect(great.dragged).toBe(true);
    expect(feetOut(great.feet)).toBe(0);
    // Both toes behind him, toward the field, and down almost together.
    for (const f of great.feet) expect(f.x).toBeLessThan(FIELD.halfWidth);
    expect(Math.abs(great.feet[0].x - great.feet[1].x)).toBeLessThan(0.25);
    expect(feetOut(over(40).feet)).toBeGreaterThan(0);
    // Well over: nobody gets them in.
    const far = athlete(99);
    far.pos.x = FIELD.halfWidth + 1.5;
    far.vel.x = 5;
    expect(feetOut(far.footfall().feet)).toBe(2);
    // The end line works the same way.
    const back = athlete(95);
    back.pos.z = FIELD.endZ - 0.2;
    back.vel.z = -6;
    expect(back.footfall().dragged).toBe(true);
    expect(feetOut(back.footfall().feet)).toBe(0);
  });

  it('a contested ball coming in stride is played hard: a layout or a high-point, by his ratings and the ball', () => {
    // He is running onto it, two yards short, with the defender on his hip.
    const setup = (ratings, ballY = 1.65) => {
      const ball = new Ball(0, 2.1, 5);
      ball.throwTo({ x: 0, y: 2.1, z: 5 }, { x: 0, y: ballY, z: -10 }, 0.75);
      while (ball.eta > 0.25) ball.step(SIM_DT);
      const a = athlete(60, ratings);
      a.pos.z = -8;
      a.vel.z = -7;
      const foe = athlete(60);
      foe.pos.x = 0.8;
      foe.pos.z = -8.3;
      foe.vel.z = -7;
      return { a, ball, foe };
    };
    const quick = setup({ agility: 95, speed: 95, jumping: 40, strength: 40 });
    const layout = planBallPlay(quick.a, quick.ball, null, { role: 'wr', foe: quick.foe });
    expect(layout.aggressive).toBe('layout');
    expect(layout.dive).toBe(true);
    expect(layout.reach).toBeGreaterThan(0);
    const leaper = setup({ jumping: 95, strength: 95, agility: 40, speed: 40 });
    const high = planBallPlay(leaper.a, leaper.ball, null, { role: 'wr', foe: leaper.foe });
    expect(high.aggressive).toBe('highPoint');
    expect(high.dive).toBe(false);
    expect(high.attack).toBeGreaterThan(JUMP.attack);
    expect(high.reach).toBeGreaterThan(0);
    // Even ratings: the height of the ball decides.
    expect(planBallPlay(setup({}).a, setup({}).ball, null, { foe: setup({}).foe }).aggressive).toBe('layout');
    const lofted = setup({}, 2.4);
    expect(planBallPlay(lofted.a, lofted.ball, null, { foe: lofted.foe }).aggressive).toBe('highPoint');
    // Nobody near him: an ordinary jump.
    const alone = planBallPlay(quick.a, quick.ball, null, { role: 'wr', foe: null });
    expect(alone.aggressive).toBeUndefined();
    expect(alone.dive).toBe(false);
    // The defender plays it hard the same way, coming down in his path.
    const db = planBallPlay(quick.a, quick.ball, null, { role: 'db', foe: quick.foe });
    expect(db.aggressive).toBe('layout');
    // Keeping his feet: no layout, he goes up for it instead.
    expect(planBallPlay(quick.a, quick.ball, null, { role: 'db', foe: quick.foe, safe: true }).aggressive).toBe('highPoint');
    // A contested high-point reaches farther than an ordinary jump.
    const a = athlete(60);
    a.attempting = true;
    const plain = reachInfo(a, 'wr', { x: 0, y: 2, z: 0 }).radius;
    a.playReach = high.reach;
    expect(reachInfo(a, 'wr', { x: 0, y: 2, z: 0 }).radius).toBeGreaterThan(plain);
  });

  it('a defender who cannot get to the ball lays out at the receiver instead; a receiver never does', () => {
    const ball = incoming(); // coming down at (0, -10)
    // The receiver has drifted off the spot toward the defender, who is well away from the ball.
    const wr = athlete(60);
    wr.pos.x = 1.4;
    wr.pos.z = -10;
    wr.vel.x = 6;
    const db = athlete(60);
    db.pos.x = 4.8;
    db.pos.z = -10;
    const plan = planBallPlay(db, ball, null, { role: 'db', foe: wr });
    expect(plan.dive).toBe(true);
    expect(plan.atMan).toBe(true);
    expect(plan.x).toBeLessThan(-0.9); // at him
    // Not when he is keeping his feet, and never for a receiver.
    expect(planBallPlay(db, ball, null, { role: 'db', foe: wr, safe: true }).dive).toBe(false);
    expect(planBallPlay(db, ball, null, { role: 'wr', foe: wr }).dive).toBe(false);
  });

  // A ball from the quarterback to `target`, `eta` seconds from getting there.
  const throwTo = (target, eta, flight = 1.3) => {
    const ball = new Ball(0, 2.1, 7.5);
    ball.throwTo({ x: 0, y: 2.1, z: 7.5 }, { y: 1.65, ...target }, flight);
    while (ball.eta > eta) ball.step(SIM_DT);
    return ball;
  };
  const placed = (x, z, vx, vz, ratings = {}) => {
    const a = athlete(60, ratings);
    a.pos.x = x;
    a.pos.z = z;
    a.vel.x = vx;
    a.vel.z = vz;
    return a;
  };
  // Press jump now with this plan and run to the moment his feet leave the turf.
  const takeOff = (a, plan) => {
    const intent = { x: 0, z: Math.sign(a.vel.z), sprint: true, jump: true, juke: 0 };
    a.step(intent, SIM_DT, plan);
    for (let i = 0; i < 60 && !a.airborne; i++) a.step({ ...intent, jump: false }, SIM_DT);
    expect(a.airborne).toBe(true);
    return a;
  };
  const towardBall = (a, ball) => {
    const dx = ball.target.x - a.pos.x;
    const dz = ball.target.z - a.pos.z;
    return (a.vel.x * dx + a.vel.z * dz) / Math.hypot(dx, dz);
  };

  it('a corner who has got ahead of the receiver dives back into him when the ball comes down on his side', () => {
    // The receiver has stopped and come back for it; the corner is on top of him, still drifting downfield.
    const wr = placed(0.3, -15, 0, 3);
    const db = placed(-0.3, -16.5, 0, -4);
    const ball = throwTo({ x: 0.3, z: -15 + 3 * 0.6 }, 0.6);
    const plan = planBallPlay(db, ball, null, { role: 'db', foe: wr });
    expect(plan.dive).toBe(true);
    expect(plan.atMan).toBe(true);
    expect(plan.z).toBeGreaterThan(0.9); // back up the field, into him
    takeOff(db, plan);
    expect(towardBall(db, ball)).toBeGreaterThan(3);
    // Not when he is keeping his feet.
    expect(planBallPlay(db, ball, null, { role: 'db', foe: wr, safe: true }).atMan).toBeUndefined();

    // Pressed too early to dive: he still goes up toward it, never away from it.
    const early = placed(-0.3, -17.5, 0, -6);
    const lob = throwTo({ x: 0.3, z: -15 + 3 * 0.9 }, 0.9);
    const jump = planBallPlay(early, lob, null, { role: 'db', foe: placed(0.3, -15, 0, 3) });
    expect(jump.dive).toBe(false);
    takeOff(early, jump);
    expect(towardBall(early, lob)).toBeGreaterThan(0);
  });

  it('a corner ahead of the receiver plays an overthrown ball that is closer to him', () => {
    const wr = placed(0.3, -15, 0, -7.5);
    const db = placed(-0.4, -16, 0, -7.5);
    const ball = throwTo({ x: 0, z: -16 - 7.5 * 0.6 - 1 }, 0.6);
    const plan = planBallPlay(db, ball, null, { role: 'db', foe: wr });
    expect(plan.atMan).toBeUndefined();
    takeOff(db, plan);
    expect(towardBall(db, ball)).toBeGreaterThan(0);
  });

  it('a receiver whose defender is better placed goes up and toward the ball rather than laying out', () => {
    // As in the contested ball above (a quick receiver would lay out), but the defender is under it.
    const ball = new Ball(0, 2.1, 5);
    ball.throwTo({ x: 0, y: 2.1, z: 5 }, { x: 0, y: 1.65, z: -10 }, 0.75);
    while (ball.eta > 0.25) ball.step(SIM_DT);
    const quick = { agility: 95, speed: 95, jumping: 40, strength: 40 };
    const wr = placed(0, -8, 0, -7, quick);
    const db = placed(0.3, -9.4, 0, -7);
    const plan = planBallPlay(wr, ball, null, { role: 'wr', foe: db });
    expect(plan.dive).toBe(false);
    expect(plan.aggressive).toBe('highPoint');
    expect(plan.attack).toBeGreaterThan(JUMP.attack);
    // Out of jumping reach with the defender sitting on the spot: still no dive.
    const low = ball.whenAt(DIVE.height);
    const wide = placed(low.x + 2.4, low.z, 0, 0, quick);
    expect(planBallPlay(wide, ball, null, { role: 'wr', foe: placed(0, -10, 0, 0) }).dive).toBe(false);
    // With the defender nowhere near it, the same receiver lays out as before.
    expect(planBallPlay(wide, ball, null, { role: 'wr', foe: placed(8, -4, 0, 0) }).dive).toBe(true);
  });

  it('a jump for a ball behind him never carries him away from it', () => {
    // Running hard downfield; the ball is coming down three yards behind him, too far off to dive for yet.
    for (const role of ['wr', 'db']) {
      const a = placed(0, -15, 0, -8);
      const ball = throwTo({ x: 0.5, z: -12 }, 1.0);
      const plan = planBallPlay(a, ball, null, { role });
      expect(plan.dive).toBe(false);
      takeOff(a, plan);
      expect(towardBall(a, ball)).toBeGreaterThanOrEqual(0);
    }
    // A ball out ahead of him in stride: his momentum carries him on to it, as before.
    const a = placed(0, -15, 0, -8);
    const ahead = throwTo({ x: 0, z: -22 }, 0.8);
    takeOff(a, planBallPlay(a, ahead, null, { role: 'wr' }));
    expect(a.vel.z).toBeLessThan(-5);
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
