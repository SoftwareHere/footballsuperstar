import { clamp, distToVerticalSegment } from '../core/vec.js';

/**
 * The volume an athlete can get hands on the ball in: a vertical segment
 * (bottom..top, measured from the turf) fattened by a radius.
 */
export function reachGeometry(athlete, role) {
  const p = athlete.params;
  const assist = athlete.reachAssist || 0; // a little help for human hands
  if (athlete.attempting) {
    // The receiver knows where the ball is going, so he gets the longer reach.
    const radius = (role === 'wr' ? 0.9 + p.reachBonus : 0.72 + p.reachBonus * 0.8) + assist;
    return { bottom: athlete.y + 0.3, top: athlete.y + 2.55, radius, kind: 'attempt' };
  }
  if (role === 'wr') {
    // No button press: a routine chest-high body catch.
    return { bottom: athlete.y + 0.6, top: athlete.y + 1.95, radius: 0.68 + p.reachBonus * 0.5 + assist, kind: 'body' };
  }
  // A defender who isn't playing the ball can still get hit by it.
  return { bottom: athlete.y + 0.3, top: athlete.y + 1.9, radius: 0.33, kind: 'block' };
}

/** How well placed the athlete is for the ball right now. */
export function reachInfo(athlete, role, ballPos) {
  const geom = reachGeometry(athlete, role);
  const dist = distToVerticalSegment(ballPos, athlete.pos.x, athlete.pos.z, geom.bottom, geom.top);
  return {
    ...geom,
    dist,
    inReach: dist <= geom.radius,
    quality: clamp(1 - dist / geom.radius, 0, 1), // 1 = right in the hands
  };
}

const contestSkill = (a) => a.params.hands * 0.4 + a.params.jumping * 0.3 + a.params.strengthRating * 0.3;

/**
 * Chance the receiver secures the ball.
 *   quality        0..1 how cleanly the ball met his hands
 *   attempting     he went up for it (vs. a passive body catch)
 *   separation     yards between receiver and defender
 *   dbAttempting   defender has his hands up
 *   dbInReach      defender can touch the ball too (a true 50/50)
 */
export function catchProbability({ wr, db, quality, attempting, separation, dbAttempting, dbInReach }) {
  let p = wr.params.catchBase;
  if (!attempting) p *= 0.8;
  // Only fingertip grabs at the edge of his reach are harder.
  p *= 1 - 0.22 * clamp((0.5 - quality) / 0.5, 0, 1);

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
  const hands = clamp((defender.params.hands - 40) / 59, 0, 1);
  return 0.7 + 0.22 * hands + 0.08 * quality;
}
