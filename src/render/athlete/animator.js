import * as THREE from 'three';
import { GRAVITY } from '../../config.js';
import { BODY, LEG_LENGTH } from '../../physics/body.js';
import { clamp } from '../../core/vec.js';
import { solveTwoBone } from './ik.js';

const B = BODY;
const TAU = Math.PI * 2;
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const DIVE_SINK = 0.24; // seconds before he lands that a diving body starts down to the turf

/** A damped spring on one number: follows its target with weight and a little overshoot. */
class Spring {
  constructor(value = 0) {
    this.x = value;
    this.v = 0;
  }

  step(target, omega, zeta, dt) {
    // Semi-implicit Euler in small slices so a slow frame cannot blow it up.
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.v += (omega * omega * (target - this.x) - 2 * zeta * omega * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }

  set(value) {
    this.x = value;
    this.v = 0;
  }
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Drives the skeleton from what the athlete is doing. Nothing here is a
 * canned clip: each frame it works out where the pelvis, feet and hands
 * should be, then inverse kinematics bends the limbs to get them there.
 *
 *   - Feet are planted in the world and stay put until they lift, so they do
 *     not slide. Each swinging foot goes to where the body is about to be.
 *     Sprinting, backpedalling, shuffling and cutting all fall out of that.
 *   - The body leans into acceleration and banks into cuts, on springs.
 *   - Hands go to the ball: the arms reach the actual ball position.
 */
export class Animator {
  constructor(rig) {
    this.rig = rig;
    this.cycle = Math.random();
    this.freq = 1;
    this.time = Math.random() * 10;
    this.legs = [0, 1].map(() => ({
      pos: new THREE.Vector3(), // where the ankle's ground point is, world
      from: new THREE.Vector3(),
      planted: true,
      lift: 0,
      pitch: 0,
      stepT: 0, // > 0 while taking an idle adjustment step
      relative: false, // `from` is measured from the body (running) rather than the world
      stepDur: 0.2,
      air: new THREE.Vector3(), // smoothed pose target while off the ground, pelvis space
      ground: 1, // 1 = foot follows the ground plan, 0 = follows the airborne pose
    }));
    this.arms = [0, 1].map(() => ({
      rel: new THREE.Vector3(0, -0.5, 0.03), // smoothed hand target, chest space, from the shoulder
      reach: 0, // 0 = pose, 1 = the hand goes to a point in the world
      end: new THREE.Vector3(), // where the hand actually is, world
    }));
    this.vel = new THREE.Vector2();
    this.acc = new THREE.Vector2();
    this.lean = new Spring();
    this.bank = new Spring();
    this.drop = new Spring(); // pelvis height offset (crouch, landing)
    this.twist = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.tuck = 0; // 0 ball in the hands, 1 tucked away
    this.carryArm = 0;
    this.hadBall = false;
    this.wasAir = false;
    this.diveK = 0;
    this.sinkK = 0; // 0 flying flat in a dive .. 1 coming down onto the turf
    this.airK = 0;
    this.moodK = 0;
    this.socket = new THREE.Vector3(); // where a ball he is holding sits, world
    this.socketDir = new THREE.Vector3(0, 0, 1);
    this.started = false;
    // Scratch world rotations down the chain.
    this.wPelvis = new THREE.Quaternion();
    this.wSpine = new THREE.Quaternion();
    this.wChest = new THREE.Quaternion();
    this.wUpper = new THREE.Quaternion();
    this.wLower = new THREE.Quaternion();
    this.chestPos = new THREE.Vector3();
  }

  /** Snap to a standing pose at the athlete's position (new rep, or getting up). */
  reset(s) {
    this.started = true;
    this.vel.set(s.vx || 0, s.vz || 0);
    this.acc.set(0, 0);
    this.lean.set(0);
    this.bank.set(0);
    this.drop.set(0);
    this.twist = 0;
    this.tuck = s.hasBall ? 1 : 0;
    this.hadBall = Boolean(s.hasBall);
    this.diveK = 0;
    this.sinkK = 0;
    this.airK = 0;
    this.moodK = 0;
    this.wasAir = false;
    const sinF = Math.sin(s.facing);
    const cosF = Math.cos(s.facing);
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      const spot = this.idleSpot(s, side, sinF, cosF, v1);
      leg.pos.copy(spot);
      leg.planted = true;
      leg.lift = 0;
      leg.pitch = 0;
      leg.stepT = 0;
      leg.ground = 1;
      leg.air.set(side * B.hipWidth, -LEG_LENGTH + 0.1, 0);
    });
    this.arms.forEach((arm, i) => {
      arm.rel.set((i === 0 ? 1 : -1) * 0.055, -0.62, 0.08);
      arm.reach = 0;
    });
  }

  /** Where a foot wants to stand when he is not going anywhere. */
  idleSpot(s, side, sinF, cosF, out) {
    let width = B.hipWidth * 1.25;
    let stagger = 0;
    if (s.crouch === 'wr') {
      // Two-point stance: inside foot up, outside foot back.
      stagger = side * (s.x >= 0 ? 1 : -1) > 0 ? -0.26 : 0.2;
      width = B.hipWidth * 1.1;
    } else if (s.crouch === 'db') {
      width = B.hipWidth * 2.0;
    } else if (s.crouch === 'qb') {
      width = B.hipWidth * 1.7;
      stagger = side > 0 ? 0.08 : -0.08;
    } else if (s.mood === 'celebrate') {
      width = B.hipWidth * 1.8;
    }
    // left = (cosF, -sinF), forward = (sinF, cosF) in (x, z)
    out.set(s.x + cosF * side * width + sinF * stagger, 0, s.z - sinF * side * width + cosF * stagger);
    return out;
  }

  update(dt, s) {
    if (!this.started) this.reset(s);
    this.time += dt;
    const rig = this.rig;
    const sinF = Math.sin(s.facing);
    const cosF = Math.cos(s.facing);
    const vx = s.vx || 0;
    const vz = s.vz || 0;
    const speed = Math.hypot(vx, vz);
    const amp = clamp(speed / 9, 0, 1);

    // ---- how the body is being pushed around
    if (dt > 1e-5) {
      const ax = clamp((vx - this.vel.x) / dt, -40, 40);
      const az = clamp((vz - this.vel.y) / dt, -40, 40);
      this.acc.x = damp(this.acc.x, ax, 14, dt);
      this.acc.y = damp(this.acc.y, az, 14, dt);
    }
    this.vel.set(vx, vz);
    const vF = vx * sinF + vz * cosF; // speed the way he is facing
    const aF = this.acc.x * sinF + this.acc.y * cosF;
    const aL = this.acc.x * cosF - this.acc.y * sinF; // toward his left

    const air = Boolean(s.airborne) && !s.diving;
    const dive = Boolean(s.diving);
    const grounded = !air && !dive;
    this.airK = damp(this.airK, air ? 1 : 0, air ? 22 : 16, dt);
    this.diveK = damp(this.diveK, dive ? 1 : 0, dive ? 16 : 10, dt);
    // A dive ends on the turf: as he comes down the body sinks to meet it, so
    // he is on the ground when the game says he has landed, not above it.
    let sinking = 0;
    if (dive) {
      const vy = s.vy || 0;
      const landsIn = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, s.y))) / GRAVITY;
      sinking = smooth(clamp(1 - landsIn / DIVE_SINK, 0, 1));
    }
    this.sinkK = dive ? damp(this.sinkK, sinking, 40, dt) : 0;
    const settled = grounded && speed < 1.6;
    this.moodK = damp(this.moodK, s.mood && settled ? 1 : 0, 6, dt);
    const cele = s.mood === 'celebrate' ? this.moodK : 0;
    const sad = s.mood === 'dejected' ? this.moodK : 0;
    const rising = s.rise > 0 ? 1 - smooth(clamp(s.rise, 0, 1)) : 0; // 1 just off the turf

    // ---- lean, bank, crouch: on springs so the body has weight
    let leanT = clamp(0.03 * aF + 0.2 * amp * Math.sign(vF || 1) * (vF < 0 ? 0.25 : 1), -0.3, 0.62);
    let crouch = 0.03 + 0.05 * amp;
    if (s.crouch === 'wr') {
      leanT = 0.4;
      crouch = 0.13;
    } else if (s.crouch === 'db') {
      leanT = 0.34;
      crouch = 0.2;
    } else if (s.crouch === 'qb') {
      leanT = 0.16;
      crouch = 0.1;
    }
    if (s.backpedal) {
      leanT = 0.16;
      crouch += 0.1;
    }
    leanT += sad * 0.26 - cele * 0.07 + rising * 0.65;
    crouch += sad * 0.03 + rising * 0.42;
    if (s.throwing !== null && s.throwing !== undefined) leanT = s.throwing < 1 ? -0.1 : 0.22;
    if (air) {
      leanT = 0.05;
      crouch = -0.03;
    }
    // He just came down: the legs soak it up.
    if (this.wasAir && grounded) this.drop.v -= 1.6;
    this.wasAir = !grounded;
    const lean = this.lean.step(leanT, 11, 0.8, dt);
    const bank = this.bank.step(clamp(-0.018 * aL * (0.4 + 0.6 * amp), -0.32, 0.32), 12, 0.75, dt);
    const drop = this.drop.step(-crouch, 15, 0.7, dt);

    // ---- feet
    this.stepFeet(dt, s, speed, amp, vF, sinF, cosF, grounded);
    // +1 as the left foot lands out in front, -1 as the right one does.
    const swingFrac = this.swingFrac(speed, amp, this.freq || 1);
    const stride = grounded && speed > 0.4 ? Math.cos(TAU * (this.cycle - swingFrac)) : 0;
    this.twist = damp(this.twist, stride * Math.min(1, speed / 3) * (vF < -0.5 ? 0.5 : 1), 20, dt);

    // Lowest at mid-stance, highest in flight.
    const midStance = (swingFrac + 1) / 2;
    const bob = grounded && speed > 0.4 ? -(0.012 + 0.03 * amp) * Math.cos(2 * TAU * (this.cycle - midStance)) : 0;
    const breath = Math.sin(this.time * 1.7) * 0.006 * (1 - amp);
    const hop = cele * Math.abs(Math.sin(this.time * 5.2)) * 0.16;

    // ---- pelvis, in the world
    const diveK = this.diveK;
    const pelvis = rig.pelvis;
    const sinkK = this.sinkK;
    const height = lerp(B.hipHeight + drop + bob + breath + hop, lerp(0.5, 0.3, sinkK), diveK);
    pelvis.position.set(s.x, s.y + height, s.z);
    // Carry the hips forward a touch when leaning so the feet stay under him.
    pelvis.position.x -= sinF * lean * 0.1 * (1 - diveK);
    pelvis.position.z -= cosF * lean * 0.1 * (1 - diveK);
    e1.set(lerp(lean * 0.55, 1.32, diveK), s.facing - this.twist * 0.13, bank * (1 - diveK), 'YXZ');
    pelvis.quaternion.setFromEuler(e1);
    this.wPelvis.copy(pelvis.quaternion);

    // ---- spine and chest: the shoulders counter the hips
    const reachUp = Math.max(this.arms[0].reach, this.arms[1].reach) * (1 - diveK);
    // (Laid out he arches his back to keep his head up; coming down he flattens.)
    const arch = diveK * (1 - 0.6 * sinkK);
    e1.set(lean * 0.28 - reachUp * 0.12 - arch * 0.2, this.twist * 0.16, -bank * 0.35, 'YXZ');
    rig.spine.quaternion.setFromEuler(e1);
    e1.set(lean * 0.17 - reachUp * 0.1 - arch * 0.22 - cele * 0.05, this.twist * 0.2, -bank * 0.3, 'YXZ');
    rig.chest.quaternion.setFromEuler(e1);
    this.wSpine.copy(this.wPelvis).multiply(rig.spine.quaternion);
    this.wChest.copy(this.wSpine).multiply(rig.chest.quaternion);
    this.chestPos
      .copy(rig.chest.position)
      .applyQuaternion(this.wSpine)
      .add(v1.copy(rig.spine.position).applyQuaternion(this.wPelvis))
      .add(pelvis.position);

    this.poseHead(dt, s, lean, sad, diveK);
    this.poseLegs(dt, s, sinF, cosF, diveK);
    this.poseArms(dt, s, amp, speed, cele, sad, diveK);
  }

  // ------------------------------------------------------------------ feet

  stepFeet(dt, s, speed, amp, vF, sinF, cosF, grounded) {
    const legs = this.legs;
    if (!grounded) {
      // Off the ground the feet belong to the pose; remember where they are
      // so the landing starts from there.
      legs.forEach((leg, i) => {
        const side = i === 0 ? 1 : -1;
        leg.planted = false;
        leg.relative = false;
        leg.stepT = 0;
        leg.ground = damp(leg.ground, 0, 24, dt);
        // He comes down with his feet under him.
        leg.pos.set(s.x + cosF * side * B.hipWidth, 0, s.z - sinF * side * B.hipWidth);
        leg.lift = 0;
      });
      return;
    }
    for (const leg of legs) leg.ground = damp(leg.ground, 1, 20, dt);

    const moving = speed > 0.4;
    if (moving) {
      // Cadence rises with speed; backpedal steps are shorter and quicker.
      const freq = clamp(0.95 + 0.165 * speed, 0, 2.5) * (vF < -0.5 ? 1.2 : 1);
      this.cycle = (this.cycle + dt * freq) % 1;
      this.freq = freq;
      const swingFrac = this.swingFrac(speed, amp, freq);
      const stanceTime = (1 - swingFrac) / freq;
      const track = B.hipWidth * (1.15 - 0.45 * amp); // feet run a narrower line at speed
      legs.forEach((leg, i) => {
        const side = i === 0 ? 1 : -1;
        const ph = (this.cycle + (i === 0 ? 0 : 0.5)) % 1;
        leg.stepT = 0;
        if (ph < swingFrac) {
          if (leg.planted || !leg.relative) {
            leg.planted = false;
            // Swing is worked out relative to the body, so the foot stays with him.
            leg.relative = true;
            leg.from.set(leg.pos.x - s.x, 0, leg.pos.z - s.z);
          }
          const u = ph / swingFrac;
          // It lands half a stance ahead of the hips, so the body passes over it.
          const lead = stanceTime * 0.5;
          const tx = (s.vx || 0) * lead + cosF * side * track;
          const tz = (s.vz || 0) * lead - sinF * side * track;
          const e = smooth(u);
          leg.pos.x = s.x + lerp(leg.from.x, tx, e);
          leg.pos.z = s.z + lerp(leg.from.z, tz, e);
          // The heel kicks up early in the swing, more so at speed.
          const stepHeight = (0.07 + 0.045 * speed) * (vF < -0.5 ? 0.5 : 1);
          leg.lift = stepHeight * Math.sin(Math.PI * Math.pow(u, 0.75));
          leg.pitch = lerp(0.95 * amp + 0.2, -0.3, smooth(u));
        } else {
          leg.planted = true;
          leg.lift = 0;
          // Heel peels off late in the stance.
          const k = (ph - swingFrac) / (1 - swingFrac);
          leg.pitch = Math.max(0, k - 0.55) * 1.6 * amp;
        }
      });
      return;
    }

    // Standing: feet step to their spots, one at a time.
    legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      const other = legs[1 - i];
      const spot = this.idleSpot(s, side, sinF, cosF, v1);
      leg.pitch = damp(leg.pitch, 0, 14, dt);
      if (leg.stepT > 0) {
        leg.stepT -= dt;
        const u = clamp(1 - leg.stepT / leg.stepDur, 0, 1);
        leg.pos.lerpVectors(leg.from, spot, smooth(u));
        leg.lift = 0.08 * Math.sin(Math.PI * u);
        if (leg.stepT <= 0) {
          leg.planted = true;
          leg.lift = 0;
          leg.pos.copy(spot);
        }
        return;
      }
      const off = Math.hypot(leg.pos.x - spot.x, leg.pos.z - spot.z);
      if ((!leg.planted || off > 0.15) && other.stepT <= 0) {
        leg.from.copy(leg.pos);
        leg.relative = false;
        leg.stepDur = clamp(0.14 + off * 0.12, 0.14, 0.26);
        leg.stepT = leg.stepDur;
        leg.planted = false;
      } else if (leg.planted) {
        leg.lift = 0;
      }
    });
  }

  /**
   * Fraction of each stride a foot spends in the air. A planted foot can only
   * be passed over for about a yard before the leg runs out, so the faster he
   * goes the shorter the ground contact: at a sprint both feet are off the turf
   * between steps.
   */
  swingFrac(speed, amp, freq) {
    return clamp(Math.max(0.4 + 0.3 * amp, 1 - (freq * 0.95) / Math.max(speed, 0.5)), 0.4, 0.8);
  }

  poseLegs(dt, s, sinF, cosF, diveK) {
    const rig = this.rig;
    const pelvis = rig.pelvis;
    rig.legs.forEach((joint, i) => {
      const leg = this.legs[i];
      const side = joint.side;
      // Off the ground: lead knee up, trail leg long. Laid out: both legs trailing.
      const lead = i === this.carryArm ? 1 : 0;
      v2.set(side * B.hipWidth * 1.1, lerp(-0.86, -0.62, lead), lerp(-0.22, 0.2, lead));
      if (diveK > 0.01) v2.lerp(v3.set(side * B.hipWidth * 1.3, -0.93, lerp(-0.12, 0.06, lead)), diveK);
      leg.air.x = damp(leg.air.x, v2.x, 16, dt);
      leg.air.y = damp(leg.air.y, v2.y, 16, dt);
      leg.air.z = damp(leg.air.z, v2.z, 16, dt);

      const hip = v1.copy(joint.hip.position).applyQuaternion(this.wPelvis).add(pelvis.position);
      const target = v2.copy(leg.air).applyQuaternion(this.wPelvis).add(pelvis.position);
      const ground = leg.ground;
      if (ground > 0.001) {
        v3.set(leg.pos.x, B.ankle + leg.lift, leg.pos.z);
        target.lerp(v3, ground);
      }
      // Knees point the way the hips face.
      const pole = v3.set(side * 0.08, 0, 1).applyQuaternion(this.wPelvis);
      solveTwoBone(joint.hip, joint.knee, this.wPelvis, hip, target, pole, B.thigh, B.shin, this.wUpper, this.wLower);
      // Foot: flat and facing forward on the ground, toes pointed in the air.
      e1.set(lerp(0.9, leg.pitch, ground) * (1 - diveK) + diveK * 1.1, s.facing, 0, 'YXZ');
      q1.setFromEuler(e1);
      if (diveK > 0.01) q1.slerp(q2.copy(this.wLower), diveK * 0.6);
      joint.foot.quaternion.copy(this.wLower).invert().multiply(q1);
    });
  }

  // ------------------------------------------------------------------ head

  poseHead(dt, s, lean, sad, diveK) {
    let yaw = 0;
    let pitch = -lean * 0.75 + sad * 0.55 - diveK * 0.95;
    if (s.lookAt) {
      // Eyes on the ball (or the man), as far as the neck allows.
      v1.set(s.lookAt.x - this.chestPos.x, s.lookAt.y - (this.chestPos.y + 0.45), s.lookAt.z - this.chestPos.z);
      v1.applyQuaternion(q1.copy(this.wChest).invert());
      const flat = Math.hypot(v1.x, v1.z);
      if (flat + Math.abs(v1.y) > 0.3) {
        yaw = clamp(Math.atan2(v1.x, v1.z), -1.25, 1.25);
        pitch = clamp(-Math.atan2(v1.y, Math.max(flat, 0.2)), -0.95, 0.6) * (1 - sad);
      }
    }
    this.headYaw = damp(this.headYaw, yaw, 10, dt);
    this.headPitch = damp(this.headPitch, pitch, 10, dt);
    e1.set(this.headPitch, this.headYaw, 0, 'YXZ');
    this.rig.head.quaternion.setFromEuler(e1);
  }

  // ------------------------------------------------------------------ arms

  poseArms(dt, s, amp, speed, cele, sad, diveK) {
    const rig = this.rig;
    const ball = s.ball || null;
    const hasBall = Boolean(s.hasBall);
    const swingAmt = Math.min(1, speed / 3);

    // Which arm carries, decided at the moment he gets the ball.
    if (hasBall && !this.hadBall) {
      this.tuck = 0;
      if (ball) {
        v1.set(ball.x - this.chestPos.x, 0, ball.z - this.chestPos.z).applyQuaternion(q1.copy(this.wChest).invert());
        this.carryArm = v1.x >= 0 ? 0 : 1;
      }
    }
    this.hadBall = hasBall;
    const throwing = s.throwing !== null && s.throwing !== undefined ? s.throwing : null;
    // Two hands on it until the catch is finished; then it is tucked away.
    const twoHands = hasBall && throwing === null && Boolean(s.securing || s.diving || s.twoHands);
    this.tuck = damp(this.tuck, hasBall && !twoHands && cele < 0.5 ? 1 : 0, 7, dt);

    // Is he going for the ball with his hands?
    let reaching = 0;
    let oneHand = -1;
    if (ball && ball.live && !hasBall) {
      v1.set(ball.x - this.chestPos.x, ball.y - this.chestPos.y, ball.z - this.chestPos.z);
      const dist = v1.length();
      if (s.attempting || s.diving) reaching = 1;
      else if (s.catcher) reaching = clamp((1.9 - dist) / 0.8, 0, 1); // routine catch: hands come up late
      if (reaching > 0) {
        v1.applyQuaternion(q1.copy(this.wChest).invert());
        // Too far to the side for both hands, or already called a one-hander.
        if (s.catchType === 'oneHand' || Math.abs(v1.x) > 0.6) oneHand = v1.x >= 0 ? 0 : 1;
      }
    }

    rig.arms.forEach((joint, i) => {
      const arm = this.arms[i];
      const side = joint.side;
      // Arm drive: opposite the same-side leg. Work out the swing as a shoulder
      // angle and an elbow bend, and put the hand where that leaves it.
      const a = (i === 0 ? -1 : 1) * this.twist;
      const drive = clamp(speed / 6, 0, 1);
      const bend = clamp(speed / 2.2, 0, 1); // arms come up as soon as he is moving
      const sh = a * (0.25 + 0.6 * drive) * swingAmt + 0.06; // shoulder: + forward
      const el = lerp(0.2, 1.45, bend) + a * 0.3 * drive; // elbow closes as the hand comes up
      const rel = v2.set(
        side * (0.055 - 0.11 * Math.max(0, a) * drive),
        -B.upperArm * Math.cos(sh) - B.forearm * Math.cos(sh + el),
        B.upperArm * Math.sin(sh) + B.forearm * Math.sin(sh + el)
      );
      let world = null; // a point in the world this hand should go to
      let rate = 16;

      if (s.crouch === 'db') rel.set(side * 0.04, -0.46, 0.2);
      else if (s.crouch === 'wr') rel.set(side * 0.05, -0.42, i === 0 ? 0.16 : -0.02);
      if (s.backpedal) rel.set(side * 0.1, -0.36, 0.18 + a * 0.08);

      if (sad > 0.01) rel.lerp(v3.set(side * 0.03, -0.63, 0.04), sad);
      if (cele > 0.01) {
        const pump = Math.sin(this.time * 10.5 + i * 0.6) * 0.07;
        rel.lerp(v3.set(side * 0.2, 0.5 + pump, 0.1), cele);
      }
      if (s.calling && i === 1) {
        rel.set(side * 0.1 + Math.sin(this.time * 14) * 0.05, 0.6, 0.1);
        rate = 22;
      }

      if (hasBall && throwing === null) {
        if (i === this.carryArm) {
          // Both hands on it, then tucked against the ribs.
          v3.set(-side * B.shoulderWidth + side * 0.07, -0.16, 0.24);
          rel.lerp(v3, 1 - this.tuck);
          if (this.tuck > 0.01) rel.lerp(v3.set(-side * 0.1, -0.33, 0.2), this.tuck * (1 - cele));
          rate = 20;
        } else if (twoHands || this.tuck < 0.6) {
          rel.lerp(v3.set(-side * B.shoulderWidth + side * 0.07, -0.16, 0.24), 1 - this.tuck);
          rate = 20;
        }
      }

      if (throwing !== null) {
        if (i === 1) {
          if (throwing < 1) {
            // Ball comes up past the ear, then to the release point.
            const cock = smooth(clamp(throwing / 0.6, 0, 1));
            rel.set(side * lerp(-0.12, 0.1, cock), lerp(-0.18, 0.2, cock), lerp(0.24, -0.2, cock));
            if (throwing > 0.6 && s.release) world = v3.set(s.release.x, s.release.y, s.release.z);
            rate = 30;
          } else {
            rel.set(-side * 0.3, -0.12, 0.42); // follow through, across the body
            rate = 18;
          }
        } else {
          rel.set(side * 0.04, -0.22, throwing < 1 ? 0.3 : -0.1);
        }
      }

      let reach = 0;
      if (reaching > 0 && ball) {
        if (oneHand === -1 || oneHand === i) {
          reach = reaching;
          // Two hands frame the ball; one hand goes straight to it.
          const spread = oneHand === i ? 0 : side * 0.085;
          world = v3.set(ball.x, ball.y, ball.z).add(v1.set(spread, 0, 0).applyQuaternion(this.wChest));
        } else {
          rel.set(side * 0.42, -0.12, -0.14); // the off arm swings out for balance
        }
        rate = 26;
      } else if (diveK > 0.3 && !hasBall) {
        rel.set(side * 0.05, 0.62, 0.2);
      }
      if (world && throwing !== null) reach = smooth(clamp((throwing - 0.6) / 0.4, 0, 1));

      arm.rel.x = damp(arm.rel.x, rel.x, rate, dt);
      arm.rel.y = damp(arm.rel.y, rel.y, rate, dt);
      arm.rel.z = damp(arm.rel.z, rel.z, rate, dt);
      arm.reach = damp(arm.reach, reach, reach > arm.reach ? 22 : 10, dt);

      const shoulder = v1.copy(joint.shoulder.position).applyQuaternion(this.wChest).add(this.chestPos);
      const target = v2.copy(arm.rel).applyQuaternion(this.wChest).add(shoulder);
      if (world && arm.reach > 0.001) target.lerp(world, arm.reach);
      // Elbows stay back, down and out.
      const pole = q1.copy(this.wChest);
      const poleDir = v3.set(side * 0.35, -0.3, -1).applyQuaternion(pole);
      solveTwoBone(joint.shoulder, joint.elbow, this.wChest, shoulder, target, poleDir, B.upperArm, B.forearm, this.wUpper, this.wLower, arm.end);
      joint.hand.quaternion.identity();
    });

    // Where a held ball sits: in the hands, sliding into the tuck.
    const carry = this.arms[this.carryArm];
    const other = this.arms[1 - this.carryArm];
    const side = this.carryArm === 0 ? 1 : -1;
    if (throwing !== null && throwing < 1) {
      this.socket.copy(this.arms[1].end);
      this.socket.addScaledVector(v1.set(0, 0.07, 0.03).applyQuaternion(this.wChest), 1);
    } else {
      v1.copy(carry.end).lerp(other.end, 0.5 * (1 - this.tuck));
      v1.addScaledVector(v2.set(0, -0.02, 0.07).applyQuaternion(this.wChest), 1 - this.tuck);
      // Tucked: between the forearm and the ribs.
      v2.copy(carry.end).addScaledVector(v3.set(-side * 0.03, 0.09, -0.02).applyQuaternion(this.wChest), 1);
      this.socket.copy(v1).lerp(v2, this.tuck);
    }
    this.socketDir.set(side * 0.35 * this.tuck, 0.35 * this.tuck, 1).applyQuaternion(this.wChest).normalize();
  }
}
