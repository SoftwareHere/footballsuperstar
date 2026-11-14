import * as THREE from 'three';
import { BODY, LEG_LENGTH } from '../../physics/body.js';
import { JUMP } from '../../config.js';
import { clamp } from '../../core/vec.js';
import { solveTwoBone } from './ik.js';

const B = BODY;
const TAU = Math.PI * 2;
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

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
 *   - Hands go to the ball: the arms reach the actual ball position, and the
 *     shoulders turn to it.
 *   - A jump is a jump: the takeoff foot plants, the hips sink as the legs
 *     load and the arms cock, the legs drive him up off that foot, he
 *     reaches at the top, and his feet come back down under him and soak
 *     up the landing.
 *   - Hands go to the other man too: a corner's punch into the receiver's
 *     chest and then onto his hip and back as he rides him, a receiver's to
 *     the shoulder he is fighting past or back at the hands that are on him.
 *   - Knocked off balance he stumbles: ragged, wide steps, arms out.
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
    this.airK = 0;
    this.moodK = 0;
    // Jumping: which foot he goes up off, and whether it is both.
    this.jump = { leg: 0, two: true, from: new THREE.Vector3(), to: new THREE.Vector3() };
    this.wasLoading = false;
    this.fallSpeed = 0; // how fast he was coming down, for the landing
    this.reachYaw = 0; // shoulders turned to the ball
    this.handK = 0; // hands up for the man in front of him
    this.handOn = 0; // ...and on him
    this.hadHandOn = false;
    this.wasStumble = 0;
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

  /**
   * Snap to a standing pose at the athlete's position (new rep, or back on
   * his feet). `feet` are where his feet are already standing, if they are.
   */
  reset(s, feet = null) {
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
    this.airK = 0;
    this.moodK = 0;
    this.wasAir = false;
    this.wasLoading = false;
    this.reachYaw = 0;
    this.handK = 0;
    this.handOn = 0;
    this.wasStumble = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    const sinF = Math.sin(s.facing);
    const cosF = Math.cos(s.facing);
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      const spot = this.idleSpot(s, side, sinF, cosF, v1);
      if (feet) leg.pos.set(feet[i].x, 0, feet[i].z);
      else leg.pos.copy(spot);
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
    const loading = Boolean(s.loading) && grounded; // legs loading for a jump, feet still down
    const load = loading ? clamp(s.load || 0, 0, 1) : 0;
    const v0 = s.jumpSpeed || 4; // how fast he leaves the turf
    // 1 leaving the turf, 0 at the top, -1 coming back down.
    const flight = air ? clamp((s.vy || 0) / v0, -1, 1) : 0;
    const stumble = clamp(s.stumble || 0, 0, 1);
    const hands = s.hands && s.foe ? s.hands : null;
    this.handK = damp(this.handK, hands ? hands.k : 0, 14, dt);
    this.handOn = damp(this.handOn, hands && hands.on ? 1 : 0, hands && hands.on ? 22 : 12, dt);
    const handK = this.handK;
    this.airK = damp(this.airK, air ? 1 : 0, air ? 22 : 16, dt);
    this.diveK = damp(this.diveK, dive ? 1 : 0, dive ? 16 : 10, dt);
    const settled = grounded && speed < 1.6;
    this.moodK = damp(this.moodK, s.mood && settled ? 1 : 0, 6, dt);
    const cele = s.mood === 'celebrate' ? this.moodK : 0;
    const sad = s.mood === 'dejected' ? this.moodK : 0;
    const reachUp = Math.max(this.arms[0].reach, this.arms[1].reach) * (1 - this.diveK);
    if (loading && !this.wasLoading) this.beginJump(s, speed, sinF, cosF);
    this.wasLoading = loading;

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
    leanT += sad * 0.26 - cele * 0.07;
    crouch += sad * 0.03;
    if (hands) {
      // Hands on a man: sunk a little and leaning into him. A receiver with
      // a man hanging on his back is pulled up out of his lean instead.
      const into = { release: 0.14, jam: 0.18, check: 0.1, ride: 0.16, ridden: -0.14 }[hands.kind] ?? 0.1;
      leanT += into * handK * (hands.kind === 'ridden' ? this.handOn : 1);
      if (hands.kind === 'jam') crouch += 0.1 * handK;
      else if (hands.kind === 'check' || hands.kind === 'ride') crouch += 0.06 * handK;
    }
    // The moment the hands land: the corner throws his weight into the
    // punch, and the receiver is rocked back by it.
    const landed = Boolean(hands && hands.on);
    if (landed && !this.hadHandOn && grounded) {
      if (hands.kind === 'jam') {
        this.lean.v += 3.2;
        this.drop.v -= 0.7;
      } else if (hands.kind === 'release') {
        this.lean.v -= 3.6;
      } else if (hands.kind === 'ride') {
        this.lean.v += 1.6;
      } else if (hands.kind === 'ridden') {
        this.lean.v -= 2;
      }
    }
    this.hadHandOn = landed;
    // Catching his balance: bent over it, low.
    leanT += 0.36 * stumble;
    crouch += 0.1 * stumble + 0.14 * clamp(s.landing || 0, 0, 1);
    if (s.throwing !== null && s.throwing !== undefined) leanT = s.throwing < 1 ? -0.1 : 0.22;
    if (loading) leanT = 0.32 * Math.sin(Math.PI * Math.min(1, load * 1.3)); // hinges over as the legs load
    if (air) {
      leanT = -0.04 - 0.1 * reachUp; // opens up to the ball
      crouch = -0.03;
      this.fallSpeed = Math.max(0, -(s.vy || 0));
    }
    // He just came down: the legs soak it up.
    if (this.wasAir && grounded) this.drop.v -= dive ? 1.6 : clamp(0.7 * this.fallSpeed, 1.6, 3.6);
    this.wasAir = !grounded;
    // Knocked off his stride: his trunk goes the way he was hit before his feet catch up.
    if (stumble > this.wasStumble + 0.3 && s.shove) {
      this.lean.v += 4.5 * (s.shove.x * sinF + s.shove.z * cosF);
      this.bank.v -= 5 * (s.shove.x * cosF - s.shove.z * sinF);
      this.drop.v -= 1.2;
    }
    this.wasStumble = stumble;
    let bankT = -0.018 * aL * (0.4 + 0.6 * amp) + 0.2 * stumble * Math.sin(this.time * 15);
    if (hands && hands.kind === 'release') {
      // Dips the shoulder nearer the man and slides by.
      const foeLeft = (s.foe.chest.x - s.x) * cosF - (s.foe.chest.z - s.z) * sinF;
      bankT -= Math.sign(foeLeft) * 0.13 * handK;
    } else if (hands && hands.kind === 'ridden') {
      // Dragged at from one side: he leans away from it, fighting to get free.
      const foeLeft = (s.foe.chest.x - s.x) * cosF - (s.foe.chest.z - s.z) * sinF;
      bankT += Math.sign(foeLeft) * 0.1 * this.handOn + 0.05 * this.handOn * Math.sin(this.time * 17);
    }
    const quick = loading || air ? 24 : 11;
    const lean = this.lean.step(leanT, quick, 0.8, dt);
    const bank = this.bank.step(clamp(bankT, -0.36, 0.36), 12, 0.75, dt);
    const drop = this.drop.step(-crouch, 15, 0.7, dt);
    // Loading the legs: the hips sink and are already coming back up, as fast
    // as he will leave the turf, at the moment his feet do.
    const dip = loading ? -((v0 * JUMP.load) / (1.15 * Math.PI)) * Math.sin(Math.PI * Math.pow(load, 1.15)) : 0;

    // ---- feet
    this.stepFeet(dt, s, speed, amp, vF, sinF, cosF, grounded, loading, stumble);
    // +1 as the left foot lands out in front, -1 as the right one does.
    const swingFrac = this.swingFrac(speed, amp, this.freq || 1);
    const striding = grounded && !loading && speed > 0.4;
    const stride = striding ? Math.cos(TAU * (this.cycle - swingFrac)) : 0;
    this.twist = damp(this.twist, stride * Math.min(1, speed / 3) * (vF < -0.5 ? 0.5 : 1), 20, dt);

    // Lowest at mid-stance, highest in flight.
    const midStance = (swingFrac + 1) / 2;
    const bob = striding ? -(0.012 + 0.03 * amp) * Math.cos(2 * TAU * (this.cycle - midStance)) : 0;
    const breath = Math.sin(this.time * 1.7) * 0.006 * (1 - amp);
    const hop = cele * Math.abs(Math.sin(this.time * 5.2)) * 0.16;

    // ---- pelvis, in the world
    const diveK = this.diveK;
    const pelvis = rig.pelvis;
    const height = lerp(B.hipHeight + drop + bob + breath + hop + dip, 0.5, diveK);
    pelvis.position.set(s.x, s.y + height, s.z);
    // Carry the hips forward a touch when leaning so the feet stay under him.
    pelvis.position.x -= sinF * lean * 0.1 * (1 - diveK);
    pelvis.position.z -= cosF * lean * 0.1 * (1 - diveK);
    e1.set(lerp(lean * 0.55, 1.32, diveK), s.facing - this.twist * 0.13, bank * (1 - diveK), 'YXZ');
    pelvis.quaternion.setFromEuler(e1);
    this.wPelvis.copy(pelvis.quaternion);

    // ---- spine and chest: the shoulders counter the hips, and turn to the ball
    let yawT = 0;
    if (s.ball && s.ball.live && !s.hasBall && reachUp > 0.05) {
      const bx = s.ball.x - s.x;
      const bz = s.ball.z - s.z;
      const left = bx * cosF - bz * sinF;
      const ahead = bx * sinF + bz * cosF;
      if (left * left + ahead * ahead > 0.09) yawT = clamp(Math.atan2(left, ahead), -1.1, 1.1) * reachUp;
    }
    this.reachYaw = damp(this.reachYaw, yawT, 12, dt);
    const turn = this.reachYaw * (1 - diveK);
    e1.set(lean * 0.28 - reachUp * 0.12 - diveK * 0.2, this.twist * 0.16 + turn * 0.4, -bank * 0.35, 'YXZ');
    rig.spine.quaternion.setFromEuler(e1);
    e1.set(lean * 0.17 - reachUp * 0.1 - diveK * 0.22 - cele * 0.05, this.twist * 0.2 + turn * 0.45, -bank * 0.3, 'YXZ');
    rig.chest.quaternion.setFromEuler(e1);
    this.wSpine.copy(this.wPelvis).multiply(rig.spine.quaternion);
    this.wChest.copy(this.wSpine).multiply(rig.chest.quaternion);
    this.chestPos
      .copy(rig.chest.position)
      .applyQuaternion(this.wSpine)
      .add(v1.copy(rig.spine.position).applyQuaternion(this.wPelvis))
      .add(pelvis.position);

    this.poseHead(dt, s, lean, sad, diveK);
    this.poseLegs(dt, s, sinF, cosF, diveK, air || loading, flight);
    this.poseArms(dt, s, amp, speed, cele, sad, diveK, { loading, load, air, stumble, hands, handK, handOn: this.handOn });
  }

  // ------------------------------------------------------------------ feet

  /**
   * The start of a jump. At a run he goes up off one foot: the one that is
   * about to come down is put down ahead of him, so that he passes over it
   * while his legs load and leaves the turf off it. From a stand, or nearly,
   * he goes up off both feet where they are.
   */
  beginJump(s, speed, sinF, cosF) {
    const legs = this.legs;
    const j = this.jump;
    j.two = speed < 2.6;
    // The foot in the air is the next one down; if both are down, the one behind him.
    if (legs[0].planted !== legs[1].planted) j.leg = legs[0].planted ? 1 : 0;
    else {
      const ahead = (i) => (legs[i].pos.x - s.x) * (s.vx || 0) + (legs[i].pos.z - s.z) * (s.vz || 0);
      j.leg = ahead(0) < ahead(1) ? 0 : 1;
    }
    for (const leg of legs) {
      leg.relative = false;
      leg.stepT = 0;
    }
    if (j.two) return;
    const leg = legs[j.leg];
    const side = j.leg === 0 ? 1 : -1;
    const reach = JUMP.load * 0.62; // he is over it a little past halfway through the load
    j.from.copy(leg.pos);
    j.to.set(s.x + (s.vx || 0) * reach + cosF * side * B.hipWidth * 0.8, 0, s.z + (s.vz || 0) * reach - sinF * side * B.hipWidth * 0.8);
  }

  /** Feet while the legs load: planted, with the body carried over them. */
  stepPlant(dt, s) {
    const j = this.jump;
    const load = clamp(s.load || 0, 0, 1);
    const toes = Math.max(0, (load - 0.68) / 0.32); // up onto his toes as he leaves
    this.legs.forEach((leg, i) => {
      if (j.two) {
        // Both feet stay where they are; one caught in the air comes straight down.
        leg.planted = true;
        leg.lift = damp(leg.lift, 0, 40, dt);
        leg.ground = damp(leg.ground, 1, 30, dt);
        leg.pitch = damp(leg.pitch, toes * 0.7, 30, dt);
      } else if (i === j.leg) {
        // The takeoff foot reaches out and plants.
        const u = clamp(load / 0.4, 0, 1);
        leg.pos.lerpVectors(j.from, j.to, smooth(u));
        leg.lift = u < 1 ? Math.max(leg.lift * (1 - u), 0.05 * Math.sin(Math.PI * u)) : 0;
        leg.planted = u >= 1;
        leg.ground = damp(leg.ground, 1, 30, dt);
        leg.pitch = u < 1 ? damp(leg.pitch, -0.2, 30, dt) : damp(leg.pitch, toes * 0.8, 30, dt);
      } else {
        // The other leg leaves the turf early and drives its knee up.
        leg.planted = load < 0.3;
        if (!leg.planted) leg.ground = damp(leg.ground, 0, 26, dt);
        leg.pitch = damp(leg.pitch, 0.5, 20, dt);
      }
    });
  }

  stepFeet(dt, s, speed, amp, vF, sinF, cosF, grounded, loading = false, stumble = 0) {
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
        // He comes down with his feet under him, a touch ahead the way he is travelling.
        leg.pos.set(s.x + (s.vx || 0) * 0.04 + cosF * side * B.hipWidth * 1.15, 0, s.z + (s.vz || 0) * 0.04 - sinF * side * B.hipWidth * 1.15);
        leg.lift = 0;
      });
      return;
    }
    if (loading) {
      this.stepPlant(dt, s);
      return;
    }
    for (const leg of legs) leg.ground = damp(leg.ground, 1, 20, dt);

    // A man catching his balance keeps his feet moving even when he is going nowhere.
    const moving = speed > 0.4 || stumble > 0.25;
    if (moving) {
      // Cadence rises with speed; backpedal steps are shorter and quicker,
      // and stumbling ones quicker and wider still.
      const freq = clamp(0.95 + 0.165 * speed, 0, 2.5) * (vF < -0.5 ? 1.2 : 1) * (1 + 0.5 * stumble);
      this.cycle = (this.cycle + dt * freq) % 1;
      this.freq = freq;
      const swingFrac = this.swingFrac(speed, amp, freq);
      const stanceTime = (1 - swingFrac) / freq;
      // Feet run a narrower line at speed, and a much wider one off balance.
      const track = B.hipWidth * (1.15 - 0.45 * amp) * (1 + 1.4 * stumble);
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
          const stepHeight = (0.07 + 0.045 * speed) * (vF < -0.5 ? 0.5 : 1) + 0.05 * stumble;
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

  /**
   * `jumping` is true from the moment his legs load until he is back down;
   * `flight` runs 1 (leaving the turf) .. 0 (the top) .. -1 (coming down).
   */
  poseLegs(dt, s, sinF, cosF, diveK, jumping = false, flight = 0) {
    const rig = this.rig;
    const pelvis = rig.pelvis;
    const j = this.jump;
    const rising = clamp(flight, 0, 1);
    const falling = clamp(-flight, 0, 1);
    rig.legs.forEach((joint, i) => {
      const leg = this.legs[i];
      const side = joint.side;
      const lead = i === this.carryArm ? 1 : 0;
      if (jumping) {
        // Where each foot is carried in the air, from the hips.
        if (j.two) {
          // Off both feet: legs long and toes down as he leaves, eased at the top, reaching down to land.
          v2.set(side * B.hipWidth * 1.1, lerp(lerp(-0.84, -0.95, rising), -0.93, falling), lerp(lerp(0, -0.06, rising), 0.05, falling));
        } else if (i === j.leg) {
          // The leg he went up off trails long behind him, then comes under him.
          v2.set(side * B.hipWidth * 1.1, lerp(lerp(-0.8, -0.93, rising), -0.93, falling), lerp(lerp(0, -0.28, rising), 0.06, falling));
        } else {
          // The other knee drives up, then that foot reaches down too.
          v2.set(side * B.hipWidth * 1.1, lerp(lerp(-0.74, -0.58, rising), -0.93, falling), lerp(lerp(0.12, 0.26, rising), 0.08, falling));
        }
      } else {
        // Laid out, or tumbling: lead knee up, trail leg long.
        v2.set(side * B.hipWidth * 1.1, lerp(-0.86, -0.62, lead), lerp(-0.22, 0.2, lead));
      }
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

  poseArms(dt, s, amp, speed, cele, sad, diveK, { loading = false, load = 0, air = false, stumble = 0, hands = null, handK = 0, handOn = 0 } = {}) {
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
    // While the legs load the arms cock back; they are thrown up as he leaves.
    const thrown = loading ? smooth(clamp((load - 0.4) / 0.5, 0, 1)) : 1;
    const cocked = loading ? 1 - thrown : 0;
    if (ball && ball.live && !hasBall) {
      v1.set(ball.x - this.chestPos.x, ball.y - this.chestPos.y, ball.z - this.chestPos.z);
      const dist = v1.length();
      if (s.diving) reaching = 1;
      else if (s.attempting) reaching = Math.max(thrown, clamp((2.6 - dist) / 0.8, 0, 1)); // unless it is on him already
      else if (s.catcher) reaching = clamp((3.2 - dist) / 1.3, 0, 1); // routine catch: hands come up late
      if (reaching > 0) {
        v1.applyQuaternion(q1.copy(this.wChest).invert());
        // Too far to the side for both hands, or already called a one-hander.
        if (s.catchType === 'oneHand' || Math.abs(v1.x) > 0.6) oneHand = v1.x >= 0 ? 0 : 1;
      }
    }

    // The man in front of him, in his own frame: + is to his left.
    let foeLeft = 0;
    if (hands) {
      v1.copy(s.foe.chest).sub(this.chestPos).applyQuaternion(q1.copy(this.wChest).invert());
      foeLeft = v1.x;
    }
    const jumpingFree = Boolean(s.attempting) && !s.diving && !(ball && ball.live); // a jump with no ball to go to

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
      if (stumble > 0.01) {
        // Arms out, fighting for balance.
        v3.set(side * (0.44 + 0.08 * Math.sin(this.time * 11 + i * 2.1)), -0.18 + 0.14 * Math.sin(this.time * 13 + i * 1.7), 0.12);
        rel.lerp(v3, Math.min(1, stumble * 1.2));
        rate = 20;
      }
      if (jumpingFree && !loading) {
        rel.set(side * 0.14, 0.6, 0.16); // thrown up overhead
        rate = 26;
      }
      if (cocked > 0.01) {
        rel.lerp(v3.set(side * 0.17, -0.5, -0.2), cocked); // loaded: down and back
        rate = 30;
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
      } else if (hands && handK > 0.01 && !hasBall && throwing === null) {
        const foe = s.foe;
        const near = foeLeft >= 0 === (i === 0); // the arm on the other man's side
        const nearShoulder = foe.sh[foe.sh[0].distanceToSquared(this.chestPos) < foe.sh[1].distanceToSquared(this.chestPos) ? 0 : 1];
        if (hands.kind === 'ridden') {
          // Hands on him from behind. The arm on that side chops back at
          // them; the other one keeps driving.
          if (near) {
            rel.lerp(v3.set(side * 0.3, -0.3, -0.16), handK);
            world = v3.copy(nearShoulder).lerp(foe.chest, 0.5);
            world.y -= 0.12;
            reach = handOn * (0.3 + 0.12 * Math.sin(this.time * 13));
          }
          rate = 22;
        } else {
          // Hands come up in front of him first, elbows bent, ready...
          rel.lerp(v3.set(side * 0.17, hands.kind === 'jam' ? -0.08 : -0.16, hands.kind === 'jam' ? 0.24 : 0.29), handK);
          // ...and go onto the man once he is within reach.
          if (hands.kind === 'jam') {
            // Both hands into his chest plate: they shoot out, come back and
            // shoot out again, one after the other.
            const beat = Math.sin(this.time * 13 + i * Math.PI);
            const punch = 0.7 + 0.3 * Math.max(-0.4, beat);
            world = v3.copy(foe.chest).add(v1.set(side * 0.1, 0.03, 0).applyQuaternion(this.wChest));
            reach = handOn * punch;
            rate = 30;
          } else if (hands.kind === 'ride') {
            // Riding him: the near hand on his hip, the far one across his
            // back, pressing all the way.
            world = v3.copy(foe.chest);
            if (near) {
              world.lerp(nearShoulder, 0.25).y -= 0.34;
            } else {
              world.lerp(nearShoulder, 0.6).y -= 0.04;
            }
            reach = handOn * (0.92 + 0.08 * Math.sin(this.time * 11 + i * 2));
            rate = 26;
          } else if (near) {
            // One hand: a check on his hip downfield, or knocking his shoulder away to get past.
            world = v3.copy(nearShoulder);
            if (hands.kind === 'check') world.lerp(foe.chest, 0.5).y -= 0.2;
            reach = handOn;
          }
          if (rate < 24) rate = 24;
        }
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
