import * as THREE from 'three';
import { P } from '../../physics/body.js';
import { aimBone, UP } from './ik.js';

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const x = new THREE.Vector3();
const y = new THREE.Vector3();
const z = new THREE.Vector3();
const dir = new THREE.Vector3();
const fwd = new THREE.Vector3();
const m = new THREE.Matrix4();
const torso = new THREE.Quaternion();
const upper = new THREE.Quaternion();
const lower = new THREE.Quaternion();
const tmp = new THREE.Quaternion();
const flat = new THREE.Quaternion();
const limp = new THREE.Quaternion();

const ARMS = [
  [P.SH_L, P.EL_L, P.HA_L],
  [P.SH_R, P.EL_R, P.HA_R],
];
const LEGS = [
  [P.HIP_L, P.KN_L, P.FT_L],
  [P.HIP_R, P.KN_R, P.FT_R],
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Bend the skeleton to match the ragdoll's particles. The torso takes its
 * orientation from the shoulder and hip lines; each limb points from one
 * particle to the next. A foot or hand that is bearing weight on the turf
 * lies flat on it; otherwise it hangs limp.
 */
export function poseFromRagdoll(rig, rag) {
  // Torso frame: x toward his left, y up his spine, z out of his chest.
  x.subVectors(rag.get(P.SH_L, a), rag.get(P.SH_R, b));
  x.add(a.subVectors(rag.get(P.HIP_L, a), rag.get(P.HIP_R, b)));
  y.subVectors(rag.get(P.NECK, a), rag.get(P.PELVIS, b));
  z.crossVectors(x, y).normalize();
  y.normalize();
  x.crossVectors(y, z).normalize();
  m.makeBasis(x, y, z);
  torso.setFromRotationMatrix(m);

  rig.pelvis.position.copy(rag.get(P.PELVIS, a));
  rig.pelvis.quaternion.copy(torso);
  rig.spine.quaternion.identity();
  rig.chest.quaternion.identity();

  dir.subVectors(rag.get(P.HEAD, a), rag.get(P.NECK, b)).normalize();
  aimBone(rig.head, torso, dir, tmp, UP);

  // The way he is facing along the turf: where planted feet and hands point.
  fwd.set(z.x, 0, z.z);
  if (fwd.lengthSq() < 0.04) fwd.set(y.x, 0, y.z).multiplyScalar(z.y < 0 ? 1 : -1); // lying down: head-first or feet-first
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
  fwd.normalize();

  rig.arms.forEach((arm, i) => {
    const [S, E, H] = ARMS[i];
    dir.subVectors(rag.get(E, a), rag.get(S, b)).normalize();
    aimBone(arm.shoulder, torso, dir, upper);
    const elbowY = a.y;
    dir.subVectors(rag.get(H, a), rag.get(E, b)).normalize();
    aimBone(arm.elbow, upper, dir, lower);
    // A hand he is leaning on lies flat, fingers forward; the wrist takes the bend.
    const weight = clamp01((0.1 - a.y) / 0.03) * clamp01((elbowY - a.y - 0.12) / 0.15);
    arm.hand.quaternion.identity();
    if (weight > 0) {
      y.copy(fwd).negate();
      z.set(0, 1, 0);
      x.crossVectors(y, z).normalize();
      m.makeBasis(x, y, z);
      flat.setFromRotationMatrix(m);
      tmp.copy(lower).invert().multiply(flat);
      arm.hand.quaternion.slerp(tmp, weight);
    }
  });

  rig.legs.forEach((leg, i) => {
    const [H, K, F] = LEGS[i];
    dir.subVectors(rag.get(K, a), rag.get(H, b)).normalize();
    aimBone(leg.hip, torso, dir, upper);
    const kneeY = a.y;
    dir.subVectors(rag.get(F, a), rag.get(K, b)).normalize();
    aimBone(leg.knee, upper, dir, lower);
    // Feet go limp (toes fall away from the shin) unless he is standing on them.
    limp.setFromAxisAngle(x.set(1, 0, 0), 0.5);
    const weight = clamp01((0.13 - a.y) / 0.05) * clamp01((kneeY - a.y - 0.14) / 0.18);
    leg.foot.quaternion.copy(limp);
    if (weight > 0) {
      flat.setFromAxisAngle(UP, Math.atan2(fwd.x, fwd.z));
      tmp.copy(lower).invert().multiply(flat);
      leg.foot.quaternion.slerp(tmp, weight);
    }
  });
}
