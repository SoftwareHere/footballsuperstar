import * as THREE from 'three';
import { BODY, P, PARTICLE_COUNT } from '../physics/body.js';
import { Ragdoll, PARTICLE_RADIUS, PARTICLE_MASS } from '../physics/ragdoll.js';
import { buildRig } from './athlete/rig.js';
import { Animator } from './athlete/animator.js';
import { poseFromRagdoll } from './athlete/ragdollPose.js';
import { solveTwoBone } from './athlete/ik.js';

const B = BODY;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const TOTAL_MASS = PARTICLE_MASS.reduce((a, b) => a + b, 0);

const EASE_IN = 0.1; // seconds to blend out of the animated pose as a fall starts
const LEG_PLANT = 0.3; // by this far into getting up, his feet are his own again
const LIMB_SPEED = 9; // yd/s: fastest a limb may be moving against the body as a fall starts
const MIN_SHOVE = 3.2; // yd/s: the least a hit that puts him down tips him over with
// Particles of each leg, in the order the rig lists its legs.
const LEG_POINTS = [
  [P.HIP_L, P.KN_L, P.FT_L],
  [P.HIP_R, P.KN_R, P.FT_R],
];
// What must stay above the turf while he gets up (his feet are placed, and arms are let be).
const TRUNK = [P.HEAD, P.NECK, P.CHEST, P.PELVIS, P.SH_L, P.SH_R, P.HIP_L, P.HIP_R];

function numberTexture(number, color, outline) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.font = '900 190px "Arial Narrow", Impact, "Helvetica Neue", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = outline;
  g.strokeText(String(number), 128, 138);
  g.fillStyle = color;
  g.fillText(String(number), 128, 138);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const tmp = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const qUpper = new THREE.Quaternion();
const qLower = new THREE.Quaternion();
const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * A football player: a jointed, padded body that is either animated from
 * what the athlete is doing, or thrown around as a rag doll when he has been
 * knocked off his feet, with a blend back as he gets up.
 *
 * The model faces +z; one unit is one yard.
 */
export class AthleteModel {
  constructor(colors, number = 1) {
    this.mats = {
      jersey: new THREE.MeshStandardMaterial({ roughness: 0.78 }),
      trim: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      helmet: new THREE.MeshPhysicalMaterial({ roughness: 0.22, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide }),
      pants: new THREE.MeshStandardMaterial({ roughness: 0.72 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.62 }),
      sock: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.85 }),
      glove: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x17191e, roughness: 0.5 }),
      sole: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 }),
      mask: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.35, metalness: 0.7 }),
      visor: new THREE.MeshPhysicalMaterial({ color: 0x0b0d12, roughness: 0.08, metalness: 0.4, clearcoat: 1, side: THREE.DoubleSide }),
      number: new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.35, toneMapped: true }),
    };
    this.rig = buildRig(this.mats);
    this.group = this.rig.root;
    this.animator = new Animator(this.rig);
    this.ragdoll = new Ragdoll();
    this.mode = 'anim'; // 'anim' | 'ragdoll' | 'recover'
    this.points = Array.from({ length: PARTICLE_COUNT }, () => [0, 0, 0]);
    this.prevPoints = Array.from({ length: PARTICLE_COUNT }, () => [0, 0, 0]);
    this.velocities = Array.from({ length: PARTICLE_COUNT }, () => [0, 0, 0]);
    this.frames = 0; // frames tracked since the last reset
    this.lastDt = 0;
    this.socket = new THREE.Vector3();
    this.socketDir = new THREE.Vector3(0, 0, 1);
    this.impact = 0; // hardest ground hit this frame, for dust and sound
    // Joints in a fixed order, for blending whole poses.
    const r = this.rig;
    this.joints = [r.pelvis, r.spine, r.chest, r.head];
    for (const arm of r.arms) this.joints.push(arm.shoulder, arm.elbow, arm.hand);
    for (const leg of r.legs) this.joints.push(leg.hip, leg.knee, leg.foot);
    // The pose he was in when the rag doll took over, or when he started to get up.
    this.fromQuats = this.joints.map(() => new THREE.Quaternion());
    this.fromPos = new THREE.Vector3();
    this.fallTime = 0; // seconds since the rag doll took over
    this.easeOffset = new THREE.Vector3(); // how far fitting the rag doll to the pose moved his hips
    this.scratchPoints = Array.from({ length: PARTICLE_COUNT }, () => [0, 0, 0]);
    // Where the rag doll left each leg: ankle, which way the knee pointed, how the foot lay.
    this.fromFeet = [new THREE.Vector3(), new THREE.Vector3()];
    this.fromKnees = [new THREE.Vector3(), new THREE.Vector3()];
    this.fromFootQuats = [new THREE.Quaternion(), new THREE.Quaternion()];
    this.setLook(colors, number);
  }

  setLook(colors, number) {
    const M = this.mats;
    M.jersey.color.setHex(colors.jersey);
    M.trim.color.setHex(colors.trim);
    M.helmet.color.setHex(colors.helmet);
    M.pants.color.setHex(colors.pants);
    if (colors.skin) M.skin.color.setHex(colors.skin);
    // Numbers in the trim colour, edged so they read on any jersey.
    const jersey = new THREE.Color(colors.jersey);
    const lum = jersey.r * 0.3 + jersey.g * 0.59 + jersey.b * 0.11;
    M.number.map?.dispose();
    M.number.map = numberTexture(number, '#' + new THREE.Color(colors.trim).getHexString(), lum > 0.5 ? '#16181d' : 'rgba(0,0,0,0.55)');
    M.number.needsUpdate = true;
  }

  /** Back to a clean standing pose (new rep). */
  reset() {
    this.mode = 'anim';
    this.ragdoll.active = false;
    this.frames = 0;
    this.fallTime = 0;
    this.animator.started = false;
  }

  /**
   * state: { x, y, z, facing, vx, vy, vz, speed, backpedal, airborne, attempting,
   *          diving, down, rise, fall, calling, hasBall, securing, mood,
   *          crouch, throwing, release, ball, lookAt, catcher, catchType,
   *          obstacle }
   */
  update(dt, s) {
    this.impact = 0;
    const lying = Boolean(s.down) && !(s.rise > 0);
    if (lying) {
      if (this.mode !== 'ragdoll') this.startRagdoll(s);
      // The game and the rag doll fall and slide by the same rules, so this
      // only has to take up the slack between them: a slow, gentle pull.
      const anchor = { x: s.x, z: s.z, strength: 0.012, maxSpeed: 1 };
      this.ragdoll.step(dt, { anchor, obstacles: s.obstacle ? [s.obstacle] : null });
      this.impact = this.ragdoll.impact;
      poseFromRagdoll(this.rig, this.ragdoll);
      this.fallTime += dt;
      if (this.fallTime < EASE_IN) this.easeIn(smooth(this.fallTime / EASE_IN));
      this.holdBallLimp();
    } else if (s.down) {
      // Getting up: from where the rag doll left him to his feet.
      if (this.mode !== 'recover') this.startRecover(s);
      this.animator.update(dt, s);
      this.recover(s);
      this.socket.copy(this.animator.socket);
      this.socketDir.copy(this.animator.socketDir);
    } else {
      if (this.mode !== 'anim') {
        this.mode = 'anim';
        this.ragdoll.active = false;
      }
      this.animator.update(dt, s);
      this.socket.copy(this.animator.socket);
      this.socketDir.copy(this.animator.socketDir);
    }
    this.track(dt);
  }

  /** Remember where every body part is, so a fall starts with the motion it had. */
  track(dt) {
    const swap = this.prevPoints;
    this.prevPoints = this.points;
    this.points = swap;
    this.measure(this.points);
    if (dt > 1e-5) {
      this.lastDt = dt;
      this.frames += 1;
    }
  }

  /** Where each rag doll particle is on the skeleton as it is posed right now. */
  measure(points) {
    const r = this.rig;
    r.root.updateMatrixWorld(true);
    const put = (i, obj, x = 0, y = 0, z = 0) => {
      tmp.set(x, y, z).applyMatrix4(obj.matrixWorld);
      const pt = points[i];
      pt[0] = tmp.x;
      pt[1] = tmp.y;
      pt[2] = tmp.z;
    };
    put(P.PELVIS, r.pelvis);
    put(P.NECK, r.head);
    put(P.HEAD, r.head, 0, B.neck, 0);
    put(P.CHEST, r.chest, 0, B.spine * 0.62 - B.chestAt, B.chestDepth);
    const ids = [
      [P.SH_L, P.EL_L, P.HA_L, P.HIP_L, P.KN_L, P.FT_L],
      [P.SH_R, P.EL_R, P.HA_R, P.HIP_R, P.KN_R, P.FT_R],
    ];
    for (let i = 0; i < 2; i++) {
      const [SH, EL, HA, HIP, KN, FT] = ids[i];
      put(SH, r.arms[i].shoulder);
      put(EL, r.arms[i].elbow);
      put(HA, r.arms[i].hand);
      put(HIP, r.legs[i].hip);
      put(KN, r.legs[i].knee);
      put(FT, r.legs[i].foot);
    }
  }

  /**
   * Hand the body over to the rag doll. As a whole it moves exactly the way
   * the game says the athlete is moving, so the two stay together; each limb
   * keeps whatever swing it had on top of that; and the hit tips him over.
   */
  startRagdoll(s) {
    this.mode = 'ragdoll';
    this.fallTime = 0;
    this.joints.forEach((j, i) => this.fromQuats[i].copy(j.quaternion));
    this.fromPos.copy(this.rig.pelvis.position);

    const usable = this.frames >= 2 && this.lastDt > 1e-5;
    const mean = [0, 0, 0];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const v = this.velocities[i];
      for (let c = 0; c < 3; c++) {
        v[c] = usable ? (this.points[i][c] - this.prevPoints[i][c]) / this.lastDt : 0;
        mean[c] += (PARTICLE_MASS[i] * v[c]) / TOTAL_MASS;
      }
    }
    // Off the ground the game knows how fast he is rising or falling; on it,
    // go by how the body was actually moving (a dive is still coming down).
    const vy = s.y > 0.02 ? s.vy || 0 : Math.max(-6, Math.min(3, mean[1]));
    const body = [s.vx || 0, vy, s.vz || 0];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const v = this.velocities[i];
      for (let c = 0; c < 3; c++) v[c] -= mean[c];
      const mag = Math.hypot(v[0], v[1], v[2]);
      const k = mag > LIMB_SPEED ? LIMB_SPEED / mag : 1;
      for (let c = 0; c < 3; c++) v[c] = v[c] * k + body[c];
    }
    this.ragdoll.start(this.points, this.velocities);
    // Fitting the rag doll to the pose can shift things a little: ease that in.
    this.ragdoll.get(P.PELVIS, tmp);
    this.easeOffset.copy(this.fromPos).sub(tmp);

    const f = s.fall;
    const shove = f ? Math.hypot(f.vx, f.vz) : 0;
    if (shove > 0.05) {
      const high = f.high !== false;
      // A hit on a man standing lifts him off his feet a little.
      const lift = high && !(s.y > 0.02) ? Math.max(0, f.vy) * 0.25 : 0;
      // However light the hit, a man going down goes over: he does not sink where he stands.
      const k = Math.max(1, MIN_SHOVE / shove);
      this.ragdoll.impulse(f.vx * k, lift, f.vz * k, high);
    }
  }

  /** The first moments of a fall: `w` goes 0 (the pose he was in) to 1 (all rag doll). */
  easeIn(w) {
    this.joints.forEach((j, i) => {
      q1.copy(j.quaternion);
      j.quaternion.slerpQuaternions(this.fromQuats[i], q1, w);
    });
    this.rig.pelvis.position.addScaledVector(this.easeOffset, 1 - w);
  }

  /** He is about to get up: remember how the rag doll left him. */
  startRecover(s) {
    const rig = this.rig;
    this.joints.forEach((j, i) => this.fromQuats[i].copy(j.quaternion));
    this.fromPos.copy(rig.pelvis.position);
    // `points` is the skeleton as it was last drawn.
    LEG_POINTS.forEach(([HIP, KN, FT], i) => {
      const hip = this.points[HIP];
      const knee = this.points[KN];
      const foot = this.points[FT];
      this.fromFeet[i].set(foot[0], foot[1], foot[2]);
      // Which way the knee points: off the line from hip to ankle.
      this.fromKnees[i].set(knee[0] - (hip[0] + foot[0]) / 2, knee[1] - (hip[1] + foot[1]) / 2, knee[2] - (hip[2] + foot[2]) / 2);
      if (this.fromKnees[i].lengthSq() < 1e-6) this.fromKnees[i].set(0, 1, 0);
      this.fromKnees[i].normalize();
      rig.legs[i].foot.getWorldQuaternion(this.fromFootQuats[i]);
    });
    this.animator.reset(s);
    this.mode = 'recover';
  }

  /**
   * Getting up. The animator has just posed him standing (crouched low at
   * first); blend to that from how he lay. His feet stay on the turf and walk
   * in under him, and nothing is allowed through the ground on the way.
   */
  recover(s) {
    const rig = this.rig;
    const pelvis = rig.pelvis;
    const rise = clamp01(s.rise);
    const w = smooth(rise);
    this.joints.forEach((j, i) => {
      q1.copy(j.quaternion);
      j.quaternion.slerpQuaternions(this.fromQuats[i], q1, w);
    });
    pelvis.position.lerpVectors(this.fromPos, pelvis.position, w);

    // Head, shoulders and hips stay above the turf.
    this.measure(this.scratchPoints);
    let under = 0;
    for (const i of TRUNK) under = Math.min(under, this.scratchPoints[i][1] - PARTICLE_RADIUS[i] * 0.85);
    pelvis.position.y -= under;

    // Legs: from the hips, wherever the blend has put them, down to feet that
    // slide along the turf from where they lay to where he will stand.
    const plant = smooth(clamp01(rise / LEG_PLANT));
    e1.set(0, s.facing, 0, 'YXZ');
    const flat = q2.setFromEuler(e1);
    rig.legs.forEach((joint, i) => {
      const leg = this.animator.legs[i];
      const base = 10 + i * 3; // this leg's hip, knee and foot in `joints`
      const hip = v1.copy(joint.hip.position).applyQuaternion(pelvis.quaternion).add(pelvis.position);
      const target = v2.set(leg.pos.x, B.ankle + leg.lift, leg.pos.z);
      target.lerpVectors(this.fromFeet[i], target, w);
      target.y = Math.max(target.y, B.ankle);
      // Knees swing round from where they pointed to the way he faces.
      const pole = v3.set(joint.side * 0.08, 0, 1).applyQuaternion(pelvis.quaternion);
      pole.lerpVectors(this.fromKnees[i], pole, w);
      for (let attempt = 0; attempt < 3; attempt++) {
        solveTwoBone(joint.hip, joint.knee, pelvis.quaternion, hip, target, pole, B.thigh, B.shin, qUpper, qLower);
        // A knee folded under the turf: bend it upward instead.
        const kneeY = hip.y + tmp.set(0, -B.thigh, 0).applyQuaternion(qUpper).y;
        if (kneeY >= PARTICLE_RADIUS[P.KN_L] * 0.85) break;
        pole.y += 0.8;
      }
      // Ease from the rag doll's legs into these, so nothing snaps as he starts to move.
      q1.copy(joint.hip.quaternion);
      joint.hip.quaternion.slerpQuaternions(this.fromQuats[base], q1, plant);
      q1.copy(joint.knee.quaternion);
      joint.knee.quaternion.slerpQuaternions(this.fromQuats[base + 1], q1, plant);
      // The foot turns from however it lay to flat on the turf, facing forward.
      qLower.copy(pelvis.quaternion).multiply(joint.hip.quaternion).multiply(joint.knee.quaternion);
      q1.copy(this.fromFootQuats[i]).slerp(flat, w);
      joint.foot.quaternion.copy(qLower).invert().multiply(q1);
    });
  }

  /** A ball he is still holding stays in his hands while he is on the turf. */
  holdBallLimp() {
    const rag = this.ragdoll;
    const hand = this.animator.carryArm === 0 ? P.HA_L : P.HA_R;
    rag.get(hand, this.socket);
    rag.get(P.CHEST, tmp);
    this.socket.lerp(tmp, 0.35);
    this.socket.y = Math.max(this.socket.y, 0.11);
  }

  /** World position of a body part by ragdoll particle index (for effects). */
  point(i, out) {
    const pt = this.points[i];
    return out.set(pt[0], pt[1], pt[2]);
  }
}
