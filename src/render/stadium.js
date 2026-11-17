import * as THREE from 'three';
import { FIELD } from '../config.js';
import { RNG } from '../core/rng.js';
import { makeCanvas, canvasTexture } from './textures.js';
import { merge, paint, place } from './geo.js';

// Mostly the home team's blue and white, plenty of dark and neutral, a few away fans.
const SHIRTS = [0x1e5fd6, 0x1e5fd6, 0x1e5fd6, 0x173a7a, 0x173a7a, 0xdfe2e6, 0xdfe2e6, 0x2a2d33, 0x2a2d33, 0x15171c, 0x5a6270, 0x8b919b, 0xb3262f, 0xd8b23a, 0x6e4f3a, 0x3d6b48];
const SKIN = [0xf1c7a5, 0xe0ac83, 0xc68c5a, 0x8d5a3b, 0x6b4226, 0x4a2c1a];
const HAIR = [0x1a1410, 0x2b1d14, 0x4a3524, 0x7a5a3a, 0xc9a66b, 0x15130f];

const ROW_DEPTH = 0.95;
const ROW_RISE = 0.62;
const SEAT = 0.8;
const BASE = 2.1; // the front row sits on top of the wall

/**
 * One bank of seating, in its own frame: the front row runs along x at z = 0
 * and rows climb back toward -z. Returns the structure (vertex-coloured
 * pieces), the crowd (flat figures facing the field), and the LED ribbon.
 */
function stand(length, rows, rng, out) {
  const { structure, crowd, ribbon, matrix } = out;
  const push = (list, geo) => list.push(geo.applyMatrix4(matrix));
  // Concrete steps: a tread and a riser per row, with a strip of seats.
  for (let r = 0; r < rows; r++) {
    const y = BASE + r * ROW_RISE;
    const z = -r * ROW_DEPTH;
    push(structure, paint(place(new THREE.PlaneGeometry(length, ROW_DEPTH), [0, y, z - ROW_DEPTH / 2], [-Math.PI / 2, 0, 0]), 0x5c6068, r % 2 ? 0.92 : 1));
    push(structure, paint(place(new THREE.PlaneGeometry(length, ROW_RISE), [0, y + ROW_RISE / 2, z - ROW_DEPTH]), 0x474b53));
    push(structure, paint(place(new THREE.BoxGeometry(length, 0.36, 0.08), [0, y + 0.3, z - ROW_DEPTH * 0.8]), 0x173a7a));
  }
  const depth = rows * ROW_DEPTH;
  const rise = rows * ROW_RISE;
  // Front wall with a rail; the back wall and a roof over the top rows.
  push(structure, paint(place(new THREE.BoxGeometry(length, BASE, 0.5), [0, BASE / 2, 0.25]), 0x14306b));
  push(structure, paint(place(new THREE.BoxGeometry(length, 0.07, 0.07), [0, BASE + 0.9, 0.1]), 0xcfd5de));
  push(structure, paint(place(new THREE.BoxGeometry(length, rise + BASE + 6, 1.2), [0, (rise + BASE + 6) / 2, -depth - 0.6]), 0x262c38));
  push(structure, paint(place(new THREE.BoxGeometry(length + 2, 0.5, depth * 0.45), [0, rise + BASE + 6, -depth * 0.78]), 0x1d222c));
  push(structure, paint(place(new THREE.BoxGeometry(length + 2, 1.1, 0.3), [0, rise + BASE + 5.6, -depth * 0.555]), 0x0f1218));
  for (let x = -length / 2 + 6; x < length / 2; x += 18) push(structure, paint(place(new THREE.BoxGeometry(0.4, 7, 0.4), [x, rise + BASE + 2.5, -depth * 0.62]), 0x2a303c));
  // LED ribbon along the front of the wall.
  push(ribbon, place(new THREE.PlaneGeometry(length, 0.8), [0, BASE * 0.55, 0.51]));

  // The crowd: a body and a head for every filled seat, as flat figures facing the field.
  const cols = Math.floor(length / SEAT);
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const vert = (x, y, z, color, k) => {
    v.set(x, y, z).applyMatrix4(matrix);
    pos.push(v.x, v.y, v.z);
    col.push(color.r * k, color.g * k, color.b * k);
  };
  const skin = new THREE.Color();
  const hair = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      if (i % 16 === 7 || rng.chance(0.06)) continue; // aisles and empty seats
      const x = (i - cols / 2 + 0.5) * SEAT + (rng.next() - 0.5) * 0.16;
      const z = -(r + 0.55) * ROW_DEPTH;
      const standing = rng.chance(0.14);
      const y0 = BASE + r * ROW_RISE + (standing ? 0.05 : 0.32);
      const h = (standing ? 0.95 : 0.62) * (0.92 + rng.next() * 0.16);
      const w = 0.42 + rng.next() * 0.08;
      c.setHex(SHIRTS[Math.floor(rng.next() * SHIRTS.length)]).multiplyScalar(0.5 + rng.next() * 0.35);
      // Body: shoulders wider than the hips, darker low down.
      vert(x - w * 0.42, y0, z, c, 0.55);
      vert(x + w * 0.42, y0, z, c, 0.55);
      vert(x + w / 2, y0 + h, z, c, 1);
      vert(x - w * 0.42, y0, z, c, 0.55);
      vert(x + w / 2, y0 + h, z, c, 1);
      vert(x - w / 2, y0 + h, z, c, 1);
      // Head: a hexagon of skin with hair on top.
      skin.setHex(SKIN[Math.floor(rng.next() * SKIN.length)]);
      hair.setHex(HAIR[Math.floor(rng.next() * HAIR.length)]);
      const hy = y0 + h + 0.13;
      const hr = 0.105;
      const ring = [];
      for (let k = 0; k < 6; k++) ring.push([x + Math.cos((k * Math.PI) / 3) * hr * 0.85, hy + Math.sin((k * Math.PI) / 3) * hr]);
      const tri = (a, b, d) => {
        for (const k of [a, b, d]) {
          const [px, pyv] = ring[k];
          const top = pyv > hy + 0.02;
          vert(px, pyv, z + 0.01, top ? hair : skin, top ? 1 : 0.95);
        }
      };
      tri(0, 1, 5);
      tri(1, 2, 4);
      tri(1, 4, 5);
      tri(2, 3, 4);
      if (standing && rng.chance(0.35)) {
        // Arms up.
        const s = rng.chance(0.5) ? 1 : -1;
        vert(x + s * w * 0.4, y0 + h * 0.95, z, skin, 0.9);
        vert(x + s * w * 0.62, y0 + h * 0.95, z, skin, 0.9);
        vert(x + s * w * 0.62, y0 + h + 0.42, z, skin, 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Facing the field and a little upward, so they catch light from above.
  const n = new THREE.Vector3(0, 0.3, 1).normalize().transformDirection(matrix);
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) {
    nrm[i] = n.x;
    nrm[i + 1] = n.y;
    nrm[i + 2] = n.z;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  crowd.push(geo);
}

function glowTexture() {
  const canvas = makeCanvas(128);
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,248,225,0.75)');
  grad.addColorStop(0.5, 'rgba(255,240,200,0.16)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return canvasTexture(canvas, { anisotropy: 1 });
}

function ribbonTexture() {
  const canvas = makeCanvas(1024, 64);
  const g = canvas.getContext('2d');
  g.fillStyle = '#071226';
  g.fillRect(0, 0, 1024, 64);
  g.font = 'italic 900 40px "Arial Narrow", Impact, sans-serif';
  g.textBaseline = 'middle';
  for (let x = 0, i = 0; x < 1024; x += 256, i++) {
    g.fillStyle = i % 2 ? '#ffd21f' : '#7fb2ff';
    g.fillText(i % 2 ? '1-ON-1s' : 'SUPERSTAR', x + 18, 34);
  }
  // LED dots.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 1024, 1);
  for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 64);
  const tex = canvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Trees and hills on the horizon, as one ring. */
function treeline() {
  const canvas = makeCanvas(1024, 128);
  const g = canvas.getContext('2d');
  const rng = new RNG(5);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(0, 128);
  for (let x = 0; x <= 1024; x += 4) {
    const hill = 60 + Math.sin((x / 1024) * Math.PI * 6) * 14 + Math.sin((x / 1024) * Math.PI * 14 + 1) * 6;
    g.lineTo(x, 128 - hill - rng.next() * 18);
  }
  g.lineTo(1024, 128);
  g.fill();
  const tex = canvasTexture(canvas, { anisotropy: 1 });
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = 3;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(330, 330, 70, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x2c3b2a, alphaMap: tex, alphaTest: 0.5, side: THREE.BackSide })
  );
  mesh.position.set(0, 12, -10);
  return mesh;
}

/** The scoreboard screen. `draw(you, rival, name, target)` repaints it. */
function scoreboardScreen() {
  const canvas = makeCanvas(1024, 384);
  const g = canvas.getContext('2d');
  const tex = canvasTexture(canvas, { anisotropy: 4 });
  const draw = (you = 0, rival = 0, name = 'RIVAL', target = null) => {
    g.fillStyle = '#05080d';
    g.fillRect(0, 0, 1024, 384);
    g.fillStyle = '#0d1a33';
    g.fillRect(12, 12, 1000, 360);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 900 54px "Arial Narrow", Impact, sans-serif';
    g.fillStyle = '#ffd21f';
    g.fillText('FOOTBALL SUPERSTAR', 512, 54);
    g.font = '900 64px "Arial Narrow", Impact, sans-serif';
    g.fillStyle = '#7fb2ff';
    g.fillText('YOU', 250, 150);
    g.fillStyle = '#ff8a8a';
    g.fillText(String(name).toUpperCase().slice(0, 9), 774, 150);
    g.font = '900 170px "Arial Narrow", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText(String(you), 250, 268);
    g.fillText(String(rival), 774, 268);
    g.font = '900 44px "Arial Narrow", Impact, sans-serif';
    g.fillStyle = '#c9d4e6';
    g.fillText(target ? `FIRST TO ${target}` : '1-ON-1s', 512, 250);
    tex.needsUpdate = true;
  };
  draw();
  return { tex, draw };
}

/**
 * Everything around the field: the stands and the crowd in them, the light
 * towers, the scoreboard and the horizon. Built as a handful of merged
 * meshes, so it costs a handful of draw calls. `setLights(preset)` follows
 * the lighting.
 */
export function createStadium() {
  const group = new THREE.Group();
  const rng = new RNG(1234);
  const midZ = (FIELD.endZ + FIELD.backZ) / 2;
  const sideX = FIELD.halfWidth + 11;
  const out = { structure: [], crowd: [], ribbon: [], matrix: new THREE.Matrix4() };
  const at = (x, z, rotY) => out.matrix.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));

  // Two sidelines and the end behind the end zone.
  for (const side of [-1, 1]) {
    at(side * sideX, midZ, (-side * Math.PI) / 2);
    stand(98, 26, rng, out);
  }
  at(0, FIELD.endZ - 15, 0);
  stand(sideX * 2, 26, rng, out);

  // Light towers: masts and lamp racks; the lamps themselves are separate so they can glow.
  const lamps = [];
  const flares = [];
  const glow = glowTexture();
  const flareMat = new THREE.SpriteMaterial({ map: glow, color: 0xfff1cf, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  for (const [x, z] of [
    [-sideX - 22, FIELD.endZ - 22],
    [sideX + 22, FIELD.endZ - 22],
    [-sideX - 24, FIELD.backZ + 14],
    [sideX + 24, FIELD.backZ + 14],
  ]) {
    out.matrix.lookAt(new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 0, midZ), new THREE.Vector3(0, 1, 0));
    const rot = new THREE.Quaternion().setFromRotationMatrix(out.matrix);
    // lookAt aims -z at the target; the rack's lamps face +z, so turn it round.
    rot.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    out.matrix.compose(new THREE.Vector3(x, 0, z), rot, new THREE.Vector3(1, 1, 1));
    out.structure.push(paint(place(new THREE.CylinderGeometry(0.35, 0.6, 34, 8), [0, 17, 0]), 0x5a606b).applyMatrix4(out.matrix));
    out.structure.push(paint(place(new THREE.BoxGeometry(9.4, 4.6, 0.6), [0, 35, -0.1]), 0x3a3f49).applyMatrix4(out.matrix));
    for (let i = 0; i < 24; i++) {
      lamps.push(place(new THREE.CircleGeometry(0.42, 10), [((i % 8) - 3.5) * 1.05, 35 + (Math.floor(i / 8) - 1) * 1.3, 0.22]).applyMatrix4(out.matrix));
    }
    const flare = new THREE.Sprite(flareMat);
    flare.position.set(0, 35, 1.2).applyMatrix4(out.matrix);
    flare.scale.set(13, 13, 1);
    group.add(flare);
    flares.push(flare);
  }

  // Scoreboard behind the end zone.
  const boardZ = FIELD.endZ - 15 - 26;
  out.structure.push(paint(place(new THREE.BoxGeometry(27, 10.6, 1), [0, 27, boardZ]), 0x10141c));
  for (const x of [-9, 9]) out.structure.push(paint(place(new THREE.BoxGeometry(1, 22, 1), [x, 11, boardZ - 0.2]), 0x2a2e37));
  const board = scoreboardScreen();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(25.6, 9.6), new THREE.MeshBasicMaterial({ map: board.tex }));
  screen.position.set(0, 27, boardZ + 0.52);
  group.add(screen);

  // Benches along each sideline.
  for (const side of [-1, 1]) {
    for (const z of [-6, -20]) out.structure.push(paint(place(new THREE.BoxGeometry(0.5, 0.5, 9), [side * (FIELD.halfWidth + 4.2), 0.25, z]), 0x27324a));
  }

  const structure = new THREE.Mesh(merge(out.structure), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const crowd = new THREE.Mesh(merge(out.crowd), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const lampMesh = new THREE.Mesh(merge(lamps), new THREE.MeshBasicMaterial({ color: 0xfff6dc, side: THREE.DoubleSide }));
  const ribbonTex = ribbonTexture();
  const ribbonGeo = merge(out.ribbon);
  // Each ribbon shows the pattern about every 8 yards.
  const uv = ribbonGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 12);
  const ribbon = new THREE.Mesh(ribbonGeo, new THREE.MeshBasicMaterial({ map: ribbonTex }));
  const horizon = treeline();
  structure.receiveShadow = true;
  group.add(structure, crowd, lampMesh, ribbon, horizon);
  for (const m of [structure, crowd, lampMesh, ribbon, horizon, screen]) {
    m.updateMatrix();
    m.matrixAutoUpdate = false;
  }

  const base = new THREE.Color();
  const setLights = (preset) => {
    lampMesh.material.color.setHex(preset.lamps > 0.2 ? 0xfff6dc : 0x8a8f99).multiplyScalar(Math.max(0.5, preset.lamps));
    flareMat.opacity = preset.flares;
    for (const f of flares) f.visible = preset.flares > 0.01;
    ribbon.material.color.setScalar(preset.boards);
    screen.material.color.setScalar(preset.boards);
    horizon.material.color.copy(base.setHex(preset.treeline));
  };
  return { group, setScore: board.draw, flares, setLights };
}
