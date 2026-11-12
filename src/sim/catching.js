import { FIELD, DIVE, CONTACT, TIP } from '../config.js';
import { clamp, distToVerticalSegment, distToSegment3 } from '../core/vec.js';

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
  if (athlete.down) return { bottom: 0, top: 0, radius: 0, kind: 'none' };
  if (athlete.diving) {
    const d = athlete.diveDir;
    const y = athlete.y;
    return {
      kind: 'dive',
      radius: DIVE.radius + p.reachBonus * 0.6 + assist,
      bottom: y + 0.55,
      top: y + 1.0,
      // From his chest out to his hands, which are stretched up and ahead of him.
      seg: [athlete.pos.x, y + 0.55, athlete.pos.z, athlete.pos.x + d.x * DIVE.reach, y + 1.0, athlete.pos.z + d.z * DIVE.reach],
    };
  }
  if (athlete.attempting) {
    // The receiver knows where the ball is going, so he gets the longer reach.
    const radius = (role === 'wr' ? 0.9 + p.reachBonus : 0.72 + p.reachBonus * 0.8) + assist;
    return { bottom: athlete.y + 0.3, top: athlete.y + 2.55, radius, kind: 'attempt' };
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

const JUMP = Object.freeze({ dive: false });

/**
 * How should this athlete go for the ball if he leaves his feet right now?
 * A plain jump unless the ball is coming down out of jumping reach and a dive
 * would get there: then { dive: true, x, z, speed, air, t }.
 *
 * `aim` is where he believes the ball is coming down (defaults to the truth).
 */
export function planBallPlay(athlete, ball, aim = null) {
  if (ball.state !== 'flight' || !ball.target || athlete.down || athlete.airborne) return JUMP;
  const low = ball.whenAt(DIVE.height);
  if (!low || low.t > DIVE.maxTime) return JUMP;
  const target = aim || ball.target;
  const eta = Math.max(ball.eta, 0);
  // Where a jump would leave him when the ball gets there.
  const px = athlete.pos.x + athlete.vel.x * eta;
  const pz = athlete.pos.z + athlete.vel.z * eta;
  const gap = Math.hypot(target.x - px, target.z - pz);
  if (gap <= DIVE.minGap + athlete.params.reachBonus + (athlete.reachAssist || 0)) return JUMP;
  // Dive at the point where the ball gets down to diving height.
  const lx = low.x + (target.x - ball.target.x);
  const lz = low.z + (target.z - ball.target.z);
  const dx = lx - athlete.pos.x;
  const dz = lz - athlete.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > DIVE.range || d < 0.5) return JUMP;
  const air = clamp(low.t + 0.06, DIVE.minAir, DIVE.maxAir);
  // His hands lead his body, so his body has a little less ground to cover.
  const speed = clamp((d - DIVE.reach * 0.7) / Math.max(low.t, 0.12), DIVE.minSpeed, DIVE.maxSpeed);
  return { dive: true, x: dx / d, z: dz / d, speed, air, t: low.t };
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

/** Caught right at the boundary with his momentum taking him out: feet down first. */
export function isToeTap(athlete) {
  if (!athlete.inBounds) return false;
  const sideGap = FIELD.halfWidth - Math.abs(athlete.pos.x);
  const endGap = athlete.pos.z - FIELD.endZ;
  const outSide = athlete.vel.x * Math.sign(athlete.pos.x) > 3;
  const outEnd = athlete.vel.z < -3;
  return (sideGap < 0.9 && outSide) || (endGap < 0.9 && outEnd);
}

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
