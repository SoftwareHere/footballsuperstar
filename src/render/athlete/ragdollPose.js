import * as THREE from 'three';
import { P } from '../../physics/body.js';
import { aimBone, aimBoneHinge, UP } from './ik.js';

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const x = new THREE.Vector3();
const y = new THREE.Vector3();
const z = new THREE.Vector3();
const u = new THREE.Vector3();
const l = new THREE.Vector3();
const hinge = new THREE.Vector3();
const m = new THREE.Matrix4();
const torso = new THREE.Quaternion();
const upper = new THREE.Quaternion();
const lower = new THREE.Quaternion();
const tmp = new THREE.Quaternion();

const ARMS = [
  [P.SH_L, P.EL_L, P.HA_L],
  [P.SH_R, P.EL_R, P.HA_R],
];
const LEGS = [
  [P.HIP_L, P.KN_L, P.FT_L],
  [P.HIP_R, P.KN_R, P.FT_R],
];

// A straight limb has no bend to take its twist from: it leans on the torso's
// side axis instead, more the straighter it is.
const STRAIGHT = 0.12;

/**
 * Bend the skeleton to match the ragdoll's particles. The torso takes its
 * orientation from the shoulder and hip lines; each limb points from one
 * particle to the next, turned so that its joint folds the way the particles
 * say it is folding (kneecaps, elbows and toes then point the right way).
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

  u.subVectors(rag.get(P.HEAD, a), rag.get(P.NECK, b)).normalize();
  aimBone(rig.head, torso, u, tmp, UP);

  rig.arms.forEach((arm, i) => {
    const [S, E, H] = ARMS[i];
    u.subVectors(rag.get(E, a), rag.get(S, b)).normalize();
    l.subVectors(rag.get(H, a), rag.get(E, b)).normalize();
    // An elbow folds the forearm toward the front of the upper arm.
    hinge.crossVectors(l, u).addScaledVector(x, STRAIGHT).addScaledVector(z, STRAIGHT * 0.2);
    aimBoneHinge(arm.shoulder, torso, u, hinge, upper);
    aimBoneHinge(arm.elbow, upper, l, hinge, lower);
    arm.hand.quaternion.identity();
  });

  rig.legs.forEach((leg, i) => {
    const [H, K, F] = LEGS[i];
    u.subVectors(rag.get(K, a), rag.get(H, b)).normalize();
    l.subVectors(rag.get(F, a), rag.get(K, b)).normalize();
    // A knee folds the shin back behind the thigh.
    hinge.crossVectors(u, l).addScaledVector(x, STRAIGHT);
    aimBoneHinge(leg.hip, torso, u, hinge, upper);
    aimBoneHinge(leg.knee, upper, l, hinge, lower);
    // Feet go limp: toes fall away from the shin.
    leg.foot.quaternion.setFromAxisAngle(a.set(1, 0, 0), 0.5);
  });
}
