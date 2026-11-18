import * as THREE from 'three';
import { BODY } from '../../physics/body.js';
import { place, merge } from '../geo.js';
import { REGIONS, tubeUV, tileUV, helmetUV, capUV } from './uniform.js';

const B = BODY;
const TAU = Math.PI * 2;

// Bones, in the order the skin refers to them.
const PELVIS = 0;
const SPINE = 1;
const CHEST = 2;
const HEAD = 3;
const ARM = [
  [4, 5, 6],
  [7, 8, 9],
]; // shoulder, elbow, hand; left (+x) first
const LEG = [
  [10, 11, 12],
  [13, 14, 15],
]; // hip, knee, foot

// Where the joints are in the bind pose (standing, every limb hanging straight down).
const HEAD_Y = B.hipHeight + B.spine + 0.01;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/**
 * Skin weights down a chain of bones, listed top to bottom as [bone, lo, hi]:
 * the bone has the body above `hi` to itself and hands it to the next bone
 * between `hi` and `lo`, so the joint bends smoothly.
 */
const chain = (links) => (y) => {
  for (let i = 0; i < links.length - 1; i++) {
    const [bone, lo, hi] = links[i];
    const next = links[i + 1][0];
    if (y >= hi) return [[bone, 1]];
    if (y > lo) {
      const t = smooth(lo, hi, y);
      return [
        [bone, t],
        [next, 1 - t],
      ];
    }
  }
  return [[links[links.length - 1][0], 1]];
};

// Catmull-Rom through the section values.
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * A body part as a smooth tube around a vertical axis, through cross-sections
 * [y, rx, rz, oz, n] listed bottom to top: rx, rz the half-widths, oz how far
 * the section sits forward, n the squareness (2 is an ellipse). The angle a
 * runs from +x toward +z; `a0` turns where u = 0 falls.
 */
function loft(sections, { cx = 0, cz = 0, seg = 16, rings = 24, a0 = 0, uv, weight }) {
  const S = sections.map((s) => [s[0], s[1], s[2], s[3] || 0, s[4] || 2]);
  const n = S.length;
  const val = (s, k) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(s)));
    const t = s - i;
    const g = (j) => S[Math.max(0, Math.min(n - 1, j))][k];
    return cr(g(i - 1), g(i), g(i + 1), g(i + 2), t);
  };
  const P = (a, s, out) => {
    const rx = Math.max(0.0005, val(s, 1));
    const rz = Math.max(0.0005, val(s, 2));
    const e = 2 / val(s, 4);
    out.set(cx + rx * spow(Math.cos(a), e), val(s, 0), cz + val(s, 3) + rz * spow(Math.sin(a), e));
    return out;
  };
  const pos = [];
  const nor = [];
  const uvs = [];
  const skin = [];
  const p = new THREE.Vector3();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const ta = new THREE.Vector3();
  const ts = new THREE.Vector3();
  const eps = 1e-3;
  for (let i = 0; i < rings; i++) {
    const s = (i / (rings - 1)) * (n - 1);
    const tiny = Math.min(val(s, 1), val(s, 2)) < 0.006;
    for (let j = 0; j <= seg; j++) {
      const u = j / seg;
      const a = a0 + u * TAU;
      P(a, s, p);
      pos.push(p.x, p.y, p.z);
      // The surface normal from the two directions along it. They are tiny
      // differences, so they are made unit length before they are crossed: the
      // cross of the raw ones is far too small to judge on a thin limb, and
      // would be taken for a closed-off end (pointing straight up or down).
      ta.subVectors(P(a + eps, s, pa), P(a - eps, s, pb)).normalize();
      ts.subVectors(P(a, Math.min(n - 1, s + eps), pa), P(a, Math.max(0, s - eps), pb)).normalize();
      const nn = ts.cross(ta);
      if (tiny || nn.lengthSq() < 1e-6) nn.set(0, s < (n - 1) / 2 ? -1 : 1, 0);
      nn.normalize();
      nor.push(nn.x, nn.y, nn.z);
      const t = uv(u, p.y);
      uvs.push(t[0], t[1]);
      skin.push(weight(p.y));
    }
  }
  const index = [];
  const row = seg + 1;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      index.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  setSkin(geo, skin);
  return geo;
}

function setSkin(geo, weights) {
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = typeof weights === 'function' ? weights(i) : weights[i];
    w.forEach(([bone, v], k) => {
      idx[i * 4 + k] = bone;
      wt[i * 4 + k] = v;
    });
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4));
  return geo;
}

/** A rigid part riding on one bone, all one solid colour from the atlas. */
function rigid(geo, bone, tile) {
  const [u, v] = tileUV(tile);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  const one = [[bone, 1]];
  return setSkin(geo, () => one);
}

/** A part of a sphere, its UVs re-made from its own angles by `map(phi, theta)`. */
function sphere(r, ws, hs, phiStart, phiLength, thetaStart, thetaLength, map) {
  const geo = new THREE.SphereGeometry(r, ws, hs, phiStart, phiLength, thetaStart, thetaLength);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const phi = phiStart + uv.getX(i) * phiLength;
    const theta = thetaStart + (1 - uv.getY(i)) * thetaLength;
    const t = map(phi, theta);
    uv.setXY(i, t[0], t[1]);
  }
  return geo;
}

/** Turn a closed shell inside out (for the padding seen through the face opening). */
function inside(geo) {
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  return geo;
}

function helmet() {
  const parts = [];
  const r = B.headRadius;
  const cy = HEAD_Y + B.neck;
  const open = 1.05; // half-width of the face opening, radians
  const shellScale = [1, 1.03, 1.1];
  const shellPart = (geo) => parts.push(setSkin(place(geo, [0, cy, 0], [0, 0, 0], shellScale), () => [[HEAD, 1]]));
  // Shell: dome, sides and back down to the jaw, and a brow over the face opening.
  shellPart(sphere(r, 28, 12, 0, TAU, 0, Math.PI / 2, helmetUV));
  shellPart(sphere(r, 22, 9, Math.PI / 2 + open, TAU - open * 2, Math.PI / 2, Math.PI * 0.3, helmetUV));
  shellPart(sphere(r * 1.005, 14, 3, Math.PI / 2 - open, open * 2, Math.PI * 0.36, Math.PI * 0.14, helmetUV));
  // Padding inside it.
  const pad = (geo) => parts.push(rigid(place(inside(geo), [0, cy, 0], [0, 0, 0], shellScale), HEAD, 'pad'));
  pad(new THREE.SphereGeometry(r * 0.975, 18, 7, 0, TAU, 0, Math.PI / 2));
  pad(new THREE.SphereGeometry(r * 0.975, 16, 6, Math.PI / 2 + open, TAU - open * 2, Math.PI / 2, Math.PI * 0.3));
  // The face, and a dark visor over the eyes.
  parts.push(rigid(place(new THREE.SphereGeometry(r * 0.86, 16, 12), [0, cy - 0.012, 0.022], [0, 0, 0], [0.92, 1, 1]), HEAD, 'skin'));
  parts.push(
    rigid(
      place(new THREE.SphereGeometry(r * 0.97, 16, 4, Math.PI / 2 - open * 0.92, open * 1.84, Math.PI * 0.39, Math.PI * 0.16), [0, cy, 0.012], [0, 0, 0], shellScale),
      HEAD,
      'visor'
    )
  );
  // Facemask: three bars wrapped round the front, two uprights.
  const maskR = r * 1.1 * 0.98;
  for (const [rad, y, arc] of [
    [maskR, cy - 0.035, 2.0],
    [maskR * 0.97, cy - 0.085, 1.9],
    [maskR * 0.9, cy - 0.132, 1.75],
  ]) {
    parts.push(rigid(place(new THREE.TorusGeometry(rad, 0.0085, 5, 16, arc), [0, y, 0.005], [Math.PI / 2, 0, Math.PI / 2 - arc / 2]), HEAD, 'mask'));
  }
  for (const x of [-0.045, 0.045]) {
    parts.push(rigid(place(new THREE.CylinderGeometry(0.0075, 0.0075, 0.105, 6), [x, cy - 0.084, maskR * 0.94], [0.12, 0, 0]), HEAD, 'mask'));
  }
  parts.push(rigid(place(new THREE.BoxGeometry(0.1, 0.03, 0.035), [0, cy - 0.145, 0.105]), HEAD, 'strap'));
  for (const s of [-1, 1]) {
    parts.push(rigid(place(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10), [s * r * 0.985, cy - 0.03, 0.01], [0, 0, Math.PI / 2]), HEAD, 'pad'));
  }
  return parts;
}

function glove(side) {
  const [, , HAND] = ARM[side > 0 ? 0 : 1];
  const x = side * B.shoulderWidth;
  const y = B.hipHeight + B.spine - B.shoulderDrop - B.upperArm - B.forearm; // the wrist
  const parts = [];
  const add = (geo, pos, rot = [0, 0, 0], scale = [1, 1, 1]) => parts.push(rigid(place(geo, [x + pos[0], y + pos[1], pos[2]], rot, scale), HAND, 'glove'));
  add(new THREE.CylinderGeometry(0.037, 0.034, 0.05, 12), [0, -0.012, 0]);
  add(new THREE.CapsuleGeometry(0.034, 0.05, 4, 10), [0, -0.052, 0], [0, 0, 0], [1.12, 1, 0.6]);
  for (let k = 0; k < 4; k++) add(new THREE.CapsuleGeometry(0.0105, 0.04, 3, 6), [(k - 1.5) * 0.0195, -0.106, 0.006], [0.3, 0, 0]);
  add(new THREE.CapsuleGeometry(0.0125, 0.034, 3, 6), [0, -0.034, 0.033], [-0.7, 0, 0]);
  return parts;
}

function cleat(side) {
  const [, , FOOT] = LEG[side > 0 ? 0 : 1];
  const x = side * B.hipWidth;
  const y = B.hipHeight - B.thigh - B.shin; // the ankle
  // Built along +y (heel to toe), then laid down along +z.
  const shoe = loft(
    [
      [-0.078, 0.004, 0.004, 0.008],
      [-0.07, 0.036, 0.04, 0.008, 2.2],
      [-0.04, 0.045, 0.044, 0.008, 2.4],
      [0.0, 0.047, 0.042, 0.008, 2.4],
      [0.05, 0.049, 0.036, 0.014, 2.4],
      [0.11, 0.05, 0.028, 0.022, 2.4],
      [0.16, 0.045, 0.02, 0.03, 2.2],
      [0.195, 0.032, 0.015, 0.035],
      [0.212, 0.004, 0.004, 0.037],
    ],
    { seg: 14, rings: 16, uv: () => tileUV('cleat'), weight: () => [[FOOT, 1]] }
  );
  place(shoe, [x, y, 0], [Math.PI / 2, 0, 0]);
  const sole = rigid(place(new THREE.BoxGeometry(0.092, 0.012, 0.28), [x, y - 0.046, 0.067]), FOOT, 'sole');
  const swoosh = rigid(place(new THREE.BoxGeometry(0.098, 0.012, 0.09), [x, y - 0.026, 0.05]), FOOT, 'trim');
  return [shoe, sole, swoosh];
}

let cached = null;

/** The whole player in the bind pose, one geometry with skin weights. */
function bodyGeometry() {
  if (cached) return cached;
  const parts = [];
  const torsoW = chain([[CHEST, 1.27, 1.38], [SPINE, 1.08, 1.17], [PELVIS]]);
  parts.push(
    loft(
      [
        [0.885, 0.004, 0.004, -0.01],
        [0.905, 0.12, 0.09, -0.012],
        [0.95, 0.185, 0.135, -0.018, 2.2],
        [1.02, 0.205, 0.148, -0.016, 2.2],
        [1.1, 0.192, 0.138, -0.006, 2.1],
        [1.17, 0.178, 0.128, 0.004],
        [1.25, 0.184, 0.132, 0.01],
        [1.34, 0.205, 0.142, 0.014, 2.1],
        [1.43, 0.228, 0.152, 0.012, 2.3],
        [1.51, 0.248, 0.16, 0.004, 2.6],
        [1.585, 0.255, 0.165, -0.004, 2.8],
        [1.635, 0.222, 0.152, -0.006, 2.8],
        [1.668, 0.14, 0.11, -0.006, 2.4],
        [1.686, 0.078, 0.07, -0.006],
        [1.696, 0.004, 0.004, -0.006],
      ],
      { seg: 32, rings: 40, uv: (u, y) => tubeUV(REGIONS.torso, u, y), weight: torsoW }
    )
  );
  // Shoulder pads under the jersey: a cap over each shoulder.
  for (const side of [1, -1]) {
    parts.push(setSkin(place(sphere(1, 18, 12, 0, TAU, 0, Math.PI, capUV), [side * 0.238, 1.598, -0.004], [0, 0, 0], [0.118, 0.078, 0.152]), () => [[CHEST, 1]]));
  }
  // Neck.
  parts.push(
    loft(
      [
        [1.6, 0.06, 0.058, -0.012],
        [1.66, 0.058, 0.056, -0.012],
        [1.72, 0.055, 0.055, -0.008],
        [1.78, 0.05, 0.05, -0.006],
      ],
      { seg: 14, rings: 8, uv: () => tileUV('skin'), weight: chain([[HEAD, 1.645, 1.7], [CHEST]]) }
    )
  );
  parts.push(...helmet());

  for (const side of [1, -1]) {
    const [SH, EL, HA] = ARM[side > 0 ? 0 : 1];
    parts.push(
      loft(
        [
          [0.925, 0.004, 0.004],
          [0.94, 0.03, 0.028],
          [0.975, 0.034, 0.031],
          [1.03, 0.04, 0.036],
          [1.12, 0.05, 0.046],
          [1.21, 0.053, 0.052, 0.002],
          [1.28, 0.049, 0.051, -0.004],
          [1.36, 0.056, 0.06, 0.004],
          [1.46, 0.062, 0.066, 0.006],
          [1.56, 0.07, 0.07, 0.002],
          [1.64, 0.074, 0.072],
          [1.69, 0.055, 0.055],
          [1.715, 0.004, 0.004],
        ],
        {
          cx: side * B.shoulderWidth,
          seg: 14,
          rings: 30,
          a0: side > 0 ? 0 : Math.PI,
          uv: (u, y) => tubeUV(side > 0 ? REGIONS.armL : REGIONS.armR, u, y),
          weight: chain([[SH, 1.23, 1.31], [EL, 0.95, 1.0], [HA]]),
        }
      )
    );
    parts.push(...glove(side));
  }

  for (const side of [1, -1]) {
    const [HIP, KNEE, FOOT] = LEG[side > 0 ? 0 : 1];
    parts.push(
      loft(
        [
          [0.05, 0.004, 0.004, 0.004],
          [0.075, 0.033, 0.036, 0.004],
          [0.13, 0.036, 0.04],
          [0.22, 0.046, 0.05, -0.006],
          [0.32, 0.058, 0.066, -0.014],
          [0.4, 0.06, 0.07, -0.01],
          [0.46, 0.064, 0.07, 0.008],
          [0.52, 0.068, 0.074, 0.016],
          [0.565, 0.07, 0.074, 0.01],
          [0.64, 0.08, 0.083, 0.004],
          [0.74, 0.093, 0.097, 0.01],
          [0.86, 0.102, 0.106, 0.006],
          [0.98, 0.11, 0.116, -0.004],
          [1.07, 0.108, 0.118, -0.012],
          [1.13, 0.08, 0.09, -0.01],
          [1.15, 0.004, 0.004, -0.01],
        ],
        {
          cx: side * B.hipWidth,
          seg: 16,
          rings: 36,
          a0: side > 0 ? 0 : Math.PI,
          uv: (u, y) => tubeUV(side > 0 ? REGIONS.legL : REGIONS.legR, u, y),
          weight: chain([[PELVIS, 0.95, 1.1], [HIP, 0.47, 0.6], [KNEE, 0.06, 0.11], [FOOT]]),
        }
      )
    );
    parts.push(...cleat(side));
  }
  cached = merge(parts);
  cached.computeBoundingSphere();
  return cached;
}

/**
 * The player: a skeleton of bones with one skinned body over it, so the
 * whole man is a single draw call and bends smoothly at every joint.
 *
 *   pelvis -> spine -> chest -> head
 *                      chest -> shoulder -> elbow -> hand   (x2)
 *   pelvis -> hip -> knee -> foot                           (x2)
 *
 * `root` stays at the world origin; `pelvis` is placed in world space by
 * whoever is driving the body (the animator or the ragdoll). Arms and legs
 * are listed left (+x) first. Every limb hangs straight down at rest.
 */
export function buildRig(material) {
  const root = new THREE.Group();
  const bone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const pelvis = bone(root, 0, B.hipHeight, 0);
  const spine = bone(pelvis, 0, 0.06, 0);
  const chest = bone(spine, 0, B.chestAt - 0.06, 0);
  const top = B.spine - B.chestAt; // shoulder line, in chest space
  const head = bone(chest, 0, top + 0.01, 0);
  const arms = [1, -1].map((side) => {
    const shoulder = bone(chest, side * B.shoulderWidth, top - B.shoulderDrop, 0);
    const elbow = bone(shoulder, 0, -B.upperArm, 0);
    const hand = bone(elbow, 0, -B.forearm, 0);
    return { shoulder, elbow, hand, side };
  });
  const legs = [1, -1].map((side) => {
    const hip = bone(pelvis, side * B.hipWidth, 0, 0);
    const knee = bone(hip, 0, -B.thigh, 0);
    const foot = bone(knee, 0, -B.shin, 0);
    return { hip, knee, foot, side };
  });
  const bones = [pelvis, spine, chest, head];
  for (const a of arms) bones.push(a.shoulder, a.elbow, a.hand);
  for (const l of legs) bones.push(l.hip, l.knee, l.foot);
  root.updateMatrixWorld(true);

  const mesh = new THREE.SkinnedMesh(bodyGeometry(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the body moves with its bones, not with the mesh
  root.add(mesh);
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  return { root, pelvis, spine, chest, head, arms, legs, mesh };
}
