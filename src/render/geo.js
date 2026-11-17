import * as THREE from 'three';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();

/**
 * Bake a placement into a geometry (it is changed in place and returned).
 * `rot` is [x, y, z] Euler angles, optionally with an order as a 4th entry.
 */
export function place(geometry, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
  q.setFromEuler(e);
  m4.compose(p.set(pos[0], pos[1], pos[2]), q, s.set(scale[0], scale[1], scale[2]));
  geometry.applyMatrix4(m4);
  return geometry;
}

/** Give every vertex of a geometry one colour (sRGB hex), times `shade`. */
export function paint(geometry, hex, shade = 1) {
  const c = new THREE.Color(hex).multiplyScalar(shade);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/**
 * Merge geometries into one, so they draw in one call. Only the attributes
 * every part has are kept; indexed and non-indexed parts can be mixed.
 */
export function merge(parts) {
  const names = Object.keys(parts[0].attributes).filter((name) => parts.every((g) => g.attributes[name]));
  let vertices = 0;
  let indices = 0;
  for (const g of parts) {
    vertices += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = parts[0].attributes[name].itemSize;
    const Arr = parts[0].attributes[name].array.constructor;
    const arr = new Arr(vertices * size);
    let off = 0;
    for (const g of parts) {
      const a = g.attributes[name];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[(off + i) * size + c] = a.getComponent(i, c);
      off += a.count;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vOff = 0;
  let iOff = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[iOff++] = g.index.getX(i) + vOff;
    else for (let i = 0; i < n; i++) index[iOff++] = i + vOff;
    vOff += n;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}
