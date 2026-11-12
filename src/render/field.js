import * as THREE from 'three';
import { FIELD } from '../config.js';

const PX = 32; // texture pixels per yard
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

  // turf grain: short blades of lighter and darker green, laid along the mow
  for (let i = 0; i < 90000; i++) {
    const light = Math.random() < 0.5;
    g.fillStyle = light ? `rgba(190,255,170,${0.03 + Math.random() * 0.05})` : `rgba(0,30,5,${0.04 + Math.random() * 0.07})`;
    g.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1 + Math.random() * 2, 3 + Math.random() * 6);
  }
  // broad, soft patches so the field is not one flat colour
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 60 + Math.random() * 220;
    const patch = g.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,255,200,0.045)' : 'rgba(0,20,0,0.07)');
    patch.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = patch;
    g.fillRect(x - r, y - r, r * 2, r * 2);
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
  tex.anisotropy = 16;
  return tex;
}

/** Fine bumps so the turf catches the light like grass instead of paint. */
function turfNormalMap() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const k = (y * size + x) * 4;
      img.data[k] = 128 + dx * 90;
      img.data[k + 1] = 128 + dy * 90;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 76);
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
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 2, 12), new THREE.MeshStandardMaterial({ color: 0x1b3f8f, roughness: 0.8 }));
  pad.position.set(0, 1, 1.2);
  group.add(base, neck, bar, pad);
  for (const x of [-3.085, 3.085]) {
    const up = tube(0.08, 9.5);
    up.position.set(x, 3.33 + 4.75, 0);
    group.add(up);
  }
  group.traverse((m) => (m.castShadow = true));
  return group;
}

/** The field itself: turf, paint, goalpost and pylons. The stadium is separate. */
export function createField() {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshLambertMaterial({ color: 0x1a4a27 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  group.add(ground);

  const turf = new THREE.Mesh(
    new THREE.PlaneGeometry(TEX.maxX - TEX.minX, TEX.maxZ - TEX.minZ),
    new THREE.MeshStandardMaterial({
      map: drawTurf(),
      normalMap: turfNormalMap(),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.35,
    })
  );
  turf.rotation.x = -Math.PI / 2;
  turf.position.set((TEX.minX + TEX.maxX) / 2, 0, (TEX.minZ + TEX.maxZ) / 2);
  turf.receiveShadow = true;
  group.add(turf);

  const post = goalpost();
  post.position.set(0, 0, FIELD.endZ);
  group.add(post);

  // pylons at the goal line and end line
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
  for (const z of [FIELD.goalZ, FIELD.endZ]) {
    for (const x of [-FIELD.halfWidth, FIELD.halfWidth]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), pylonMat);
      pylon.position.set(x, 0.25, z);
      pylon.castShadow = true;
      group.add(pylon);
    }
  }

  // Team benches along each sideline.
  const benchMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.5, metalness: 0.4 });
  for (const side of [-1, 1]) {
    for (const z of [-6, -20]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 9), benchMat);
      bench.position.set(side * (FIELD.halfWidth + 4.2), 0.25, z);
      bench.castShadow = true;
      group.add(bench);
    }
  }

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
