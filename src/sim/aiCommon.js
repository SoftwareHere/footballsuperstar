import { GRAVITY, DIVE, JUMP } from '../config.js';
import { len2 } from '../core/vec.js';
import { planBallPlay } from './catching.js';

/**
 * What kind of route is this, judged from the receiver's motion?
 * 'in' / 'out' = breaking across the field, 'deep' = vertical,
 * 'short' = sitting down or working back to the QB.
 */
export function classifyBreak(vel, side) {
  const speed = len2(vel.x, vel.z);
  if (speed < 3) return 'short';
  const outward = (vel.x * side) / speed;
  const downfield = -vel.z / speed;
  if (Math.abs(outward) > 0.45) return outward > 0 ? 'out' : 'in';
  return downfield > 0 ? 'deep' : 'short';
}

export function blankIntent() {
  return { x: 0, z: 0, sprint: false, jump: false, juke: 0, call: false, snap: false };
}

/** Steer toward a desired velocity, expressed as a throttled direction. */
export function steer(out, me, vx, vz) {
  const want = len2(vx, vz);
  const top = me.params.topSpeed * me.speedCap;
  if (want < 0.15) {
    out.x = 0;
    out.z = 0;
    out.sprint = false;
    return;
  }
  const sprint = want > me.params.topSpeed * me.params.jogFactor * 0.97;
  const limit = sprint && !me.exhausted ? top : top * me.params.jogFactor;
  const throttle = Math.min(1, want / limit);
  out.x = (vx / want) * throttle;
  out.z = (vz / want) * throttle;
  out.sprint = sprint;
}

/**
 * Run to where the ball is coming down, arrive as it does, and go up for it.
 * `aim` is where this athlete believes the ball will arrive. He only goes up
 * for it if he will be within `jumpRange` yards of that spot; if he cannot
 * get there on his feet he lays out for it instead.
 */
export function playTheBall(out, me, ball, aim, jumpLeadScale, jumpRange = 1.7) {
  const eta = Math.max(ball.eta, 0);
  const dx = aim.x - me.pos.x;
  const dz = aim.z - me.pos.z;
  const d = len2(dx, dz);
  if (d < 0.25) {
    steer(out, me, 0, 0);
  } else {
    const speed = Math.min(me.params.topSpeed, d / Math.max(eta, 0.1));
    steer(out, me, (dx / d) * speed, (dz / d) * speed);
    out.sprint = true;
  }
  if (me.airborne || me.down || me.gather > 0) return;
  // Out of reach on his feet: dive, timed so he is laid out when it arrives.
  const plan = planBallPlay(me, ball, aim);
  if (plan.dive) {
    // Only for a ball he can actually get a hand on, not one sailing to someone else.
    if (d <= DIVE.range && plan.t <= DIVE.minAir + 0.1 * jumpLeadScale) out.jump = true;
    return;
  }
  // Jump so the peak of the jump meets the ball: the legs have to load first.
  const tApex = JUMP.load + Math.sqrt((2 * me.params.jumpHeight) / GRAVITY);
  if (eta <= tApex * jumpLeadScale) {
    const px = me.pos.x + me.vel.x * eta;
    const pz = me.pos.z + me.vel.z * eta;
    if (Math.hypot(aim.x - px, aim.z - pz) <= jumpRange) out.jump = true;
  }
}

/** Keep going the way he is already going (ball in his hands, hit coming). */
export function runThrough(out, me) {
  const speed = len2(me.vel.x, me.vel.z);
  if (speed < 0.5) return steer(out, me, 0, 0);
  const top = me.params.topSpeed;
  steer(out, me, (me.vel.x / speed) * top, (me.vel.z / speed) * top);
  out.sprint = true;
  return undefined;
}
