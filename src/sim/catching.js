import { FIELD, DIVE, CONTACT, TIP, JUMP, CONTEST, TACKLE, CATCH_HEIGHT } from '../config.js';
import { clamp, lerp, distToVerticalSegment, distToSegment3 } from '../core/vec.js';

/**
 * The volume an athlete can get hands on the ball in. Standing or jumping it
 * is a vertical segment (bottom..top, measured from the turf) fattened by a
 * radius; laid out in a dive it is a short segment ahead of his body.
 *
 * `tipped` is true once the ball has come off somebody's hands: it is slower
 * and everybody is looking at it, so a defender on his feet can catch it.
 */
export function reachGeometry(athlete, role, tipped = false) {
  const p = athlete.params;
  const assist = athlete.reachAssist || 0; // a little help for human hands
  const extra = athlete.playReach || 0; // a contested ball, played hard
  if (athlete.down) return { bottom: 0, top: 0, radius: 0, kind: 'none' };
  if (athlete.diving) {
    const d = athlete.diveDir;
    const y = athlete.y;
    return {
      kind: 'dive',
      radius: DIVE.radius + p.reachBonus * 0.6 + assist + extra,
      bottom: y + 0.55,
      top: y + 1.0,
      // From his chest out to his hands, which are stretched up and ahead of him.
      seg: [athlete.pos.x, y + 0.55, athlete.pos.z, athlete.pos.x + d.x * DIVE.reach, y + 1.0, athlete.pos.z + d.z * DIVE.reach],
    };
  }
  if (athlete.attempting) {
    // The receiver knows where the ball is going, so he gets the longer reach.
    const radius = (role === 'wr' ? 0.9 + p.reachBonus : 0.72 + p.reachBonus * 0.8) + assist + extra;
    return { bottom: athlete.y + 0.3, top: athlete.y + 2.55 + extra * 0.6, radius, kind: 'attempt' };
  }
  if (role === 'wr') {
    // No button press: a routine chest-high body catch.
    return { bottom: athlete.y + 0.6, top: athlete.y + 1.95, radius: 0.68 + p.reachBonus * 0.5 + assist, kind: 'body' };
  }
  if (tipped) {
    return { bottom: athlete.y + 0.6, top: athlete.y + 1.95, radius: 0.5 + p.reachBonus * 0.5 + assist, kind: 'body' };
  }
  // A defender who isn't playing the ball can still get hit by it.
  return { bottom: athlete.y + 0.3, top: athlete.y + 1.9, radius: 0.33, kind: 'block' };
}

/** How well placed the athlete is for the ball right now. */
export function reachInfo(athlete, role, ballPos, tipped = false) {
  const geom = reachGeometry(athlete, role, tipped);
  let dist = Infinity;
  if (geom.kind === 'dive') dist = distToSegment3(ballPos, ...geom.seg);
  else if (geom.kind !== 'none') dist = distToVerticalSegment(ballPos, athlete.pos.x, athlete.pos.z, geom.bottom, geom.top);
  return {
    ...geom,
    dist,
    inReach: dist <= geom.radius,
    quality: geom.radius > 0 ? clamp(1 - dist / geom.radius, 0, 1) : 0, // 1 = right in the hands
  };
}

/** True when he is actively going for the ball (jump or dive), not just in its way. */
export const isAttempt = (kind) => kind === 'attempt' || kind === 'dive';

const PLAIN_JUMP = Object.freeze({ dive: false });

/**
 * Is this a contested ball coming to him in stride? The other man is right
 * on him and the ball is coming down ahead of him, where he is running.
 */
export function contestedInStride(athlete, target, foe, eta) {
  if (!foe || foe.down || !target) return false;
  if (Math.hypot(foe.pos.x - athlete.pos.x, foe.pos.z - athlete.pos.z) > CONTEST.near) return false;
  const speed = athlete.speed;
  if (speed < 3) return false;
  const tx = target.x - athlete.pos.x;
  const tz = target.z - athlete.pos.z;
  const td = Math.hypot(tx, tz);
  // Where he will be when it gets there, against where it is coming down.
  const gap = Math.hypot(target.x - (athlete.pos.x + athlete.vel.x * eta), target.z - (athlete.pos.z + athlete.vel.z * eta));
  if (gap > DIVE.range) return false;
  if (td < 0.5) return true; // right on him
  return (athlete.vel.x * tx + athlete.vel.z * tz) / (speed * td) >= CONTEST.ahead;
}

/**
 * How should this athlete go for the ball if he leaves his feet right now?
 * Usually a jump: { dive: false, x, z, t } says where and when the ball
 * arrives, so he can push off toward it. When it is coming down out of
 * jumping reach and a dive would get there: { dive: true, x, z, speed, air, t }.
 *
 *   aim    where he believes the ball is coming down (defaults to the truth)
 *   role   'wr' or 'db'
 *   foe    the other man
 *   safe   keep his feet: no laying out on a contested ball, no diving at the man
 *
 * A contested ball coming in stride is played hard, whichever side he is on:
 * he lays out for it (aggressive: 'layout') or goes up and takes it at its
 * highest point (aggressive: 'highPoint'), whichever his ratings and the
 * height of the ball suit. A defender who cannot get to the ball at all
 * lays out at the receiver instead (atMan: true).
 */
export function planBallPlay(athlete, ball, aim = null, { role = 'wr', foe = null, safe = false } = {}) {
  if (ball.state !== 'flight' || !ball.target || athlete.down || athlete.airborne) return PLAIN_JUMP;
  const p = athlete.params;
  const target = aim || ball.target;
  const eta = Math.max(ball.eta, 0);
  const jump = { dive: false, x: target.x, z: target.z, t: eta };
  const low = ball.whenAt(DIVE.height);

  // Lay out at the point where the ball gets down to diving height.
  const diveAtBall = () => {
    if (!low || low.t > DIVE.maxTime) return null;
    const lx = low.x + (target.x - ball.target.x);
    const lz = low.z + (target.z - ball.target.z);
    const dx = lx - athlete.pos.x;
    const dz = lz - athlete.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > DIVE.range || d < 0.5) return null;
    const air = clamp(low.t + 0.06, DIVE.minAir, DIVE.maxAir);
    // His hands lead his body, so his body has a little less ground to cover.
    const speed = clamp((d - DIVE.reach * 0.7) / Math.max(low.t, 0.12), DIVE.minSpeed, DIVE.maxSpeed);
    return { dive: true, x: dx / d, z: dz / d, speed, air, t: low.t };
  };

  if (contestedInStride(athlete, target, foe, eta)) {
    const high = clamp((target.y - CATCH_HEIGHT) / 0.7, 0, 1);
    if (!safe && p.layout + 0.35 * (1 - high) > p.highPoint + 0.35 * high) {
      const layout = diveAtBall();
      if (layout) return { ...layout, aggressive: 'layout', reach: CONTEST.layoutReach * p.layout };
    }
    return {
      ...jump,
      aggressive: 'highPoint',
      attack: JUMP.attack * CONTEST.attack,
      reach: lerp(CONTEST.reach[0], CONTEST.reach[1], p.highPoint),
    };
  }

  // Where a jump would leave him when the ball gets there.
  const px = athlete.pos.x + athlete.vel.x * eta;
  const pz = athlete.pos.z + athlete.vel.z * eta;
  const gap = Math.hypot(target.x - px, target.z - pz);
  if (gap <= DIVE.minGap + p.reachBonus + (athlete.reachAssist || 0)) return jump;
  const dive = diveAtBall();
  if (dive) return dive;

  if (role === 'db' && !safe && foe && !foe.down && eta <= DIVE.maxAir + 0.2) {
    // Nowhere near the ball: go at the man it is going to, and get there with it.
    const fx = foe.pos.x + foe.vel.x * eta - athlete.pos.x;
    const fz = foe.pos.z + foe.vel.z * eta - athlete.pos.z;
    const d = Math.hypot(fx, fz);
    if (d >= 0.6 && d <= DIVE.range + 0.4) {
      const air = clamp(eta + 0.05, DIVE.minAir, DIVE.maxAir);
      const speed = clamp((d - 0.5) / Math.max(eta, 0.12), DIVE.minSpeed, DIVE.maxSpeed);
      return { dive: true, x: fx / d, z: fz / d, speed, air, t: eta, atMan: true };
    }
  }
  return jump;
}

/**
 * What kind of catch was this? Decided by where the ball met the body.
 *   reach     the reachInfo at the moment of the catch
 *   ballPos   / ballVel at that moment
 *   tips      how many times the ball had already been tipped
 */
export function classifyCatch({ athlete, reach, ballPos, ballVel, tips = 0 }) {
  if (reach.kind === 'dive') return 'dive';
  if (tips > 0) return 'juggle';
  if (reach.kind === 'attempt' && reach.quality < 0.28) return 'oneHand';
  // Running away from the passer, downfield, with the ball dropping in over his shoulder.
  const speed = Math.hypot(athlete.vel.x, athlete.vel.z);
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z);
  if (speed > 5.5 && -athlete.vel.z > 4.5 && ballSpeed > 1) {
    const along = (athlete.vel.x * ballVel.x + athlete.vel.z * ballVel.z) / (speed * ballSpeed);
    if (along > 0.9) return 'overShoulder';
  }
  if (reach.kind === 'attempt') return 'leap';
  if (ballPos.y - athlete.y < 0.95) return 'low';
  return 'body';
}

/** How much harder each kind of catch is than a routine one. */
export const CATCH_DIFFICULTY = {
  body: 1,
  leap: 1,
  overShoulder: 0.98,
  low: 0.95,
  oneHand: 0.93,
  dive: 0.95,
  juggle: 0.92,
};

/** Is this spot on the turf in bounds? The lines themselves are out. */
export const spotInBounds = (pt) => Math.abs(pt.x) < FIELD.halfWidth && pt.z > FIELD.endZ;

/** How many of these feet came down out of bounds. */
export const feetOut = (feet) => feet.filter((f) => !spotInBounds(f)).length;

/** Is this spot in the end zone (and in bounds)? */
export const inEndZone = (pt) => spotInBounds(pt) && pt.z <= FIELD.goalZ;

const contestSkill = (a) => a.params.hands * 0.4 + a.params.jumping * 0.3 + a.params.strengthRating * 0.3;
const rated = (v) => clamp((v - 40) / 59, 0, 1);

/**
 * Chance the receiver secures the ball.
 *   quality        0..1 how cleanly the ball met his hands
 *   attempting     he went up for it (vs. a passive body catch)
 *   separation     yards between receiver and defender
 *   dbAttempting   defender has his hands up
 *   dbInReach      defender can touch the ball too (a true 50/50)
 *   catchType      optional, from classifyCatch
 */
export function catchProbability({ wr, db, quality, attempting, separation, dbAttempting, dbInReach, catchType = null }) {
  let p = wr.params.catchBase;
  if (!attempting) p *= 0.8;
  // Only fingertip grabs at the edge of his reach are harder.
  p *= 1 - 0.22 * clamp((0.5 - quality) / 0.5, 0, 1);
  if (catchType) p *= CATCH_DIFFICULTY[catchType] ?? 1;

  if (dbInReach) {
    const edge = (contestSkill(wr) - contestSkill(db)) / 100;
    p *= clamp(0.42 + edge * 0.9, 0.08, 0.85);
  } else {
    const tight = clamp(1 - separation / 2.5, 0, 1);
    const strengthEdge = db.params.strength - wr.params.strength;
    let pressure = tight * (0.5 + 0.45 * strengthEdge);
    if (dbAttempting) pressure += tight * 0.15;
    pressure *= 1 - wr.params.pressureResist;
    p *= 1 - clamp(pressure, 0, 0.7);
  }
  return clamp(p, 0.02, 0.99);
}

/** Chance a defender who got to the ball actually knocks it away. */
export function breakupProbability({ quality, kind }, defender) {
  if (kind === 'block') return 0.7;
  const hands = rated(defender.params.hands);
  return 0.7 + 0.22 * hands + 0.08 * quality;
}

/**
 * The receiver has the ball and takes a hit. Chance he holds on.
 *   closing    how fast the two bodies came together, yd/s
 *   catchType  dives and one-handers are easier to jar loose
 *   airborne   so is a man with no feet under him
 */
export function holdOnProbability({ wr, db, closing, catchType = 'body', airborne = false }) {
  const power = closing * Math.sqrt(db.params.strength / wr.params.strength);
  const grip = 0.6 * rated(wr.params.hands) + 0.4 * rated(wr.params.strengthRating);
  let p = 0.96 - 0.075 * Math.max(0, power - CONTACT.minHit) + 0.2 * grip;
  if (airborne) p -= 0.05;
  if (catchType === 'oneHand') p -= 0.07;
  if (catchType === 'dive' || catchType === 'juggle') p -= 0.05;
  return clamp(p, 0.3, 0.98);
}

/** Chance a diving catch survives hitting the turf. */
export function groundHoldProbability(wr) {
  return clamp(DIVE.groundHold + 0.15 * rated(wr.params.hands), 0.5, 0.99);
}

/** Chance a ball the receiver failed to hold pops up alive instead of dying. */
export function tipChance({ quality, kind }) {
  if (kind === 'none') return 0;
  return clamp(TIP.base + TIP.quality * quality, 0, 0.6);
}

/**
 * A tackler gets his arms on a ball carrier. Chance he wraps him up (or, if
 * he arrives fast enough, knocks him down).
 *   front    0..1 how squarely in front of the runner he is (1 = head on)
 *   juking   the runner is mid-sidestep
 */
export function tackleOdds({ tackler, runner, front = 1, juking = false }) {
  let p = TACKLE.base + TACKLE.skill * 0.5 * (tackler.params.tackling - runner.params.elusive);
  p *= TACKLE.behind + (1 - TACKLE.behind) * clamp(front, 0, 1);
  if (juking) p *= TACKLE.juke;
  p *= 1 - 0.5 * (tackler.stumbling || 0);
  p += 0.25 * (runner.stumbling || 0) * (1 - p);
  return clamp(p, 0.08, 0.95);
}

/** Chance a wrapped-up runner breaks the tackle before he goes down. */
export function breakFreeOdds({ tackler, runner, front = 1 }) {
  const edge = runner.params.elusive - tackler.params.tackling;
  return clamp(TACKLE.breakFree + 0.5 * edge + 0.12 * (1 - clamp(front, 0, 1)), 0.03, 0.6);
}

/** A diving tackler gets to the runner's legs. Chance he takes them out from under him. */
export function diveTackleOdds({ quality, tackler, runner, juking = false }) {
  let p = TACKLE.diveBase + 0.35 * clamp(quality, 0, 1) + 0.4 * (tackler.params.tackling - runner.params.elusive);
  if (juking) p *= 0.6;
  return clamp(p, 0.1, 0.92);
}
