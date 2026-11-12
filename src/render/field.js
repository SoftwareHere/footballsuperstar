import * as THREE from 'three';
import { FIELD } from '../config.js';

const PX = 24; // texture pixels per yard
const TEX = { minX: -32, maxX: 32, minZ: -50, maxZ: 20 };

function drawTurf() {
  const canvas = document.createElement('canvas');
  canvas.width = (TEX.maxX - TEX.minX) * PX;
  canvas.height = (TEX.maxZ - TEX.minZ) * PX;
  const g = canvas.getContext('2d');
  const X = (x) => (x - TEX.minX) * PX;
  const Y = (z) => (z - TEX.minZ) * PX;
  const rect = (x0, z0, x1, z1) => g.fillRect(X(x0), Y(z0), (x1 - x0) * PX, (z1 - z0) * PX);
  const hw = FIELD.halfWidth;

  // apron
  g.fillStyle = '#1c5a2c';
  g.fillRect(0, 0, canvas.width, canvas.height);

  // mowing stripes, every 5 yards
  for (let z = FIELD.endZ, i = 0; z < FIELD.backZ; z += 5, i++) {
    g.fillStyle = i % 2 ? '#2f8f43' : '#2a8139';
    rect(-hw, z, hw, Math.min(z + 5, FIELD.backZ));
  }

  // end zone
  g.fillStyle = '#1b3f8f';
  rect(-hw, FIELD.endZ, hw, FIELD.goalZ);
  g.save();
  g.translate(X(0), Y((FIELD.endZ + FIELD.goalZ) / 2));
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = `italic 900 ${6.2 * PX}px "Arial Narrow", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SUPERSTAR', 0, 0.3 * PX);
  g.restore();

  // turf speckle
  for (let i = 0; i < 16000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    g.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 2, 2);
  }

  g.fillStyle = '#f4f7f2';
  // yard lines
  for (let z = FIELD.goalZ + 5; z <= 15; z += 5) rect(-hw, z - 0.06, hw, z + 0.06);
  rect(-hw, FIELD.goalZ - 0.14, hw, FIELD.goalZ + 0.14); // goal line
  // hash marks, every yard
  for (let z = FIELD.goalZ + 1; z < FIELD.backZ; z++) {
    if ((z - FIELD.goalZ) % 5 === 0) continue;
    for (const x of [-3.08, 3.08]) rect(x - 0.33, z - 0.05, x + 0.33, z + 0.05);
    rect(-hw + 0.5, z - 0.05, -hw + 1.15, z + 0.05);
    rect(hw - 1.15, z - 0.05, hw - 0.5, z + 0.05);
  }
  // border
  const b = 0.9;
  rect(-hw - b, FIELD.endZ - b, -hw, FIELD.backZ);
  rect(hw, FIELD.endZ - b, hw + b, FIELD.backZ);
  rect(-hw - b, FIELD.endZ - b, hw + b, FIELD.endZ);

  // yard numbers, read from each sideline
  g.font = `900 ${2.6 * PX}px "Arial Narrow", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let z = FIELD.goalZ + 10, n = 10; z <= 15; z += 10, n += 10) {
    for (const side of [-1, 1]) {
      g.save();
      g.translate(X(side * 16.5), Y(z));
      g.rotate((side * Math.PI) / 2);
      g.fillText(String(n).split('').join(' '), 0, 0);
      g.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function crowdTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#20242c';
  g.fillRect(0, 0, 512, 128);
  const shirts = ['#e8e8ea', '#1e6bff', '#f2c230', '#c8102e', '#3a3f4b', '#7fb2ff', '#f08a24'];
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 96; col++) {
      if (Math.random() < 0.12) continue;
      g.fillStyle = shirts[(Math.random() * shirts.length) | 0];
      g.fillRect(col * 5.33 + (row % 2) * 2.6, row * 8 + 1, 3.6, 5);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function goalpost() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.45, metalness: 0.2 });
  const tube = (r, h) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mat);
  const base = tube(0.13, 3.4);
  base.position.set(0, 1.7, 1.2);
  const neck = tube(0.11, 1.4);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, 3.33, 0.55);
  const bar = tube(0.1, 6.17);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 3.33, 0);
  group.add(base, neck, bar);
  for (const x of [-3.085, 3.085]) {
    const up = tube(0.08, 9.5);
    up.position.set(x, 3.33 + 4.75, 0);
    group.add(up);
  }
  group.traverse((m) => (m.castShadow = true));
  return group;
}

function stand(width, depth, tex, repeat) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(repeat, 1.6);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({ map: t })
  );
  return mesh;
}

/** The practice field, end zone, goalpost and a simple stadium around it. */
export function createField() {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x18502a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  group.add(ground);

  const turf = new THREE.Mesh(
    new THREE.PlaneGeometry(TEX.maxX - TEX.minX, TEX.maxZ - TEX.minZ),
    new THREE.MeshLambertMaterial({ map: drawTurf() })
  );
  turf.rotation.x = -Math.PI / 2;
  turf.position.set((TEX.minX + TEX.maxX) / 2, 0, (TEX.minZ + TEX.maxZ) / 2);
  turf.receiveShadow = true;
  group.add(turf);

  const post = goalpost();
  post.position.set(0, 0, FIELD.endZ);
  group.add(post);

  // pylons at the goal line and end line
  const pylonMat = new THREE.MeshLambertMaterial({ color: 0xff6a13 });
  for (const z of [FIELD.goalZ, FIELD.endZ]) {
    for (const x of [-FIELD.halfWidth, FIELD.halfWidth]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), pylonMat);
      pylon.position.set(x, 0.25, z);
      group.add(pylon);
    }
  }

  // stands: two sidelines and behind the end zone
  const crowd = crowdTexture();
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x14306b });
  const lean = 0.95; // how far the seating leans back from vertical
  for (const side of [-1, 1]) {
    const s = stand(96, 26, crowd, 6);
    s.rotation.order = 'YXZ';
    s.rotation.y = (-side * Math.PI) / 2; // face the field
    s.rotation.x = -lean;
    s.position.set(side * 48.6, 9.7, -14);
    group.add(s);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 96), wallMat);
    wall.position.set(side * 37.5, 1.1, -14);
    group.add(wall);
  }
  const back = stand(76, 26, crowd, 5);
  back.rotation.x = -lean;
  back.position.set(0, 9.7, -71.6);
  group.add(back);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(76, 2.2, 1), wallMat);
  backWall.position.set(0, 1.1, -60.5);
  group.add(backWall);

  // line of scrimmage, TV-style
  const los = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.halfWidth * 2, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x35b4ff, transparent: true, opacity: 0.75 })
  );
  los.rotation.x = -Math.PI / 2;
  los.position.set(0, 0.015, 0);
  group.add(los);

  return group;
}

export function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2466c4');
  grad.addColorStop(0.35, '#5a9be0');
  grad.addColorStop(0.6, '#b5d8f4');
  grad.addColorStop(1, '#e4f1fb');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
