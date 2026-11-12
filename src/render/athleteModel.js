import * as THREE from 'three';
import { BODY, P, PARTICLE_COUNT } from '../physics/body.js';
import { Ragdoll } from '../physics/ragdoll.js';
import { buildRig } from './athlete/rig.js';
import { Animator } from './athlete/animator.js';
import { poseFromRagdoll } from './athlete/ragdollPose.js';

const B = BODY;
const smooth = (t) => t * t * (3 - 2 * t);

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
    this.fromQuats = this.joints.map(() => new THREE.Quaternion());
    this.fromPos = new THREE.Vector3();
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
    this.animator.started = false;
  }

  /**
   * state: { x, y, z, facing, vx, vz, speed, backpedal, airborne, attempting,
   *          diving, down, rise, fall, calling, hasBall, securing, mood,
   *          crouch, throwing, release, ball, lookAt, catcher, catchType,
   *          obstacle }
   */
  update(dt, s) {
    this.impact = 0;
    const lying = Boolean(s.down) && !(s.rise > 0);
    if (lying) {
      if (this.mode !== 'ragdoll') this.startRagdoll(s);
      const anchor = { x: s.x, z: s.z, strength: 0.045 };
      this.ragdoll.step(dt, { anchor, obstacles: s.obstacle ? [s.obstacle] : null });
      this.impact = this.ragdoll.impact;
      poseFromRagdoll(this.rig, this.ragdoll);
      this.holdBallLimp();
    } else if (s.down) {
      // Getting up: blend from where the rag doll left him to his feet.
      if (this.mode !== 'recover') {
        this.joints.forEach((j, i) => this.fromQuats[i].copy(j.quaternion));
        this.fromPos.copy(this.rig.pelvis.position);
        this.animator.reset(s);
        this.mode = 'recover';
      }
      this.animator.update(dt, s);
      const w = smooth(Math.min(1, Math.max(0, s.rise)));
      this.joints.forEach((j, i) => j.quaternion.slerpQuaternions(this.fromQuats[i], j.quaternion, w));
      this.rig.pelvis.position.lerpVectors(this.fromPos, this.rig.pelvis.position, w);
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
    const r = this.rig;
    r.root.updateMatrixWorld(true);
    const swap = this.prevPoints;
    this.prevPoints = this.points;
    this.points = swap;
    const put = (i, obj, x = 0, y = 0, z = 0) => {
      tmp.set(x, y, z).applyMatrix4(obj.matrixWorld);
      const pt = this.points[i];
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
    if (dt > 1e-5) {
      this.lastDt = dt;
      this.frames += 1;
    }
  }

  startRagdoll(s) {
    this.mode = 'ragdoll';
    const vx = s.vx || 0;
    const vz = s.vz || 0;
    const usable = this.frames >= 2 && this.lastDt > 1e-5;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const v = this.velocities[i];
      if (usable) {
        // Each part keeps the speed it had last frame (limbs mid-swing keep swinging).
        for (let c = 0; c < 3; c++) v[c] = (this.points[i][c] - this.prevPoints[i][c]) / this.lastDt;
        const mag = Math.hypot(v[0], v[1], v[2]);
        if (mag > 16) for (let c = 0; c < 3; c++) v[c] *= 16 / mag;
      } else {
        v[0] = vx;
        v[1] = 0;
        v[2] = vz;
      }
    }
    this.ragdoll.start(this.points, this.velocities);
    const f = s.fall;
    if (f) this.ragdoll.impulse(f.vx * 0.7, Math.max(0, f.vy) * 0.6, f.vz * 0.7, f.high !== false);
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
