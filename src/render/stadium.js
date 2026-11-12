import * as THREE from 'three';
import { FIELD } from '../config.js';

const SHIRTS = [0xe8e8ea, 0x1e6bff, 0xf2c230, 0xc8102e, 0x3a3f4b, 0x7fb2ff, 0xf08a24, 0x2f8f43, 0xffffff, 0x15171c, 0x9b59b6];

/**
 * A bank of seating full of people: a stepped concrete slope with one small
 * block per fan, all drawn in a single call.
 *   length  yards along the front row
 *   rows    how many rows deep
 */
function stand(length, rows, seed) {
  const group = new THREE.Group();
  const rowDepth = 0.95;
  const rowRise = 0.62;
  const seat = 0.8;
  const cols = Math.floor(length / seat);

  // The slope they sit on.
  const depth = rows * rowDepth;
  const rise = rows * rowRise;
  const slope = new THREE.Mesh(
    new THREE.PlaneGeometry(length, Math.hypot(depth, rise)),
    new THREE.MeshLambertMaterial({ color: 0x2a2e37 })
  );
  slope.rotation.x = -Math.atan2(depth, rise);
  slope.position.set(0, rise / 2 + 2.0, -depth / 2);
  group.add(slope);

  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const fans = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.72, 0.36), new THREE.MeshLambertMaterial(), cols * rows);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rand() < 0.07) continue; // an empty seat
      const x = (c - cols / 2 + 0.5) * seat + (rand() - 0.5) * 0.14;
      const y = 2.45 + r * rowRise + rand() * 0.1;
      const z = -(r + 0.5) * rowDepth;
      m.makeTranslation(x, y, z);
      fans.setMatrixAt(n, m);
      color.setHex(SHIRTS[Math.floor(rand() * SHIRTS.length)]);
      color.multiplyScalar(0.72 + rand() * 0.28);
      fans.setColorAt(n, color);
      n += 1;
    }
  }
  fans.count = n;
  fans.instanceMatrix.needsUpdate = true;
  fans.instanceColor.needsUpdate = true;
  fans.frustumCulled = false;
  group.add(fans);

  // Front wall with a rail, and the back rim.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 2.1, 0.5), new THREE.MeshLambertMaterial({ color: 0x14306b }));
  wall.position.set(0, 1.05, 0.25);
  group.add(wall);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0xcfd5de }));
  rail.position.set(0, 2.5, 0.2);
  group.add(rail);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(length, 2.4, 1.2), new THREE.MeshLambertMaterial({ color: 0x1b2233 }));
  rim.position.set(0, rise + 2.6, -depth - 0.6);
  group.add(rim);
  return group;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,248,225,0.75)');
  grad.addColorStop(0.5, 'rgba(255,240,200,0.16)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A floodlight tower: mast, a bank of lamps, and the glare around them. */
function lightTower(glow) {
  const group = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x555b66 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 34, 8), steel);
  mast.position.y = 17;
  group.add(mast);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(9, 4.4, 0.6), steel);
  rack.position.y = 35;
  group.add(rack);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
  const lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 10), lamp, 24);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) {
    m.makeTranslation(((i % 8) - 3.5) * 1.05, 35 + (Math.floor(i / 8) - 1) * 1.3, 0.32);
    lamps.setMatrixAt(i, m);
  }
  group.add(lamps);
  const flare = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, color: 0xfff1cf, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  flare.position.set(0, 35, 0.6);
  flare.scale.set(26, 26, 1);
  group.add(flare);
  return group;
}

/** The scoreboard behind the end zone. `draw(you, rival, name, target)` repaints it. */
function scoreboard() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(27, 10.6, 1), new THREE.MeshLambertMaterial({ color: 0x10141c }));
  group.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(25.6, 9.6), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.z = 0.52;
  group.add(screen);
  for (const x of [-9, 9]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1), new THREE.MeshLambertMaterial({ color: 0x2a2e37 }));
    leg.position.set(x, -15, -0.2);
    group.add(leg);
  }
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
  return { group, draw };
}

/** Everything around the field: the stands, the lights and the scoreboard. */
export function createStadium() {
  const group = new THREE.Group();
  const midZ = (FIELD.endZ + FIELD.backZ) / 2;
  const sideX = FIELD.halfWidth + 11;

  // Two sidelines and the end behind the end zone.
  for (const side of [-1, 1]) {
    const s = stand(98, 26, side > 0 ? 11 : 23);
    s.rotation.y = (-side * Math.PI) / 2;
    s.position.set(side * sideX, 0, midZ);
    group.add(s);
  }
  const end = stand(sideX * 2, 26, 37);
  end.position.set(0, 0, FIELD.endZ - 15);
  group.add(end);

  const glow = glowTexture();
  for (const [x, z] of [
    [-sideX - 22, FIELD.endZ - 22],
    [sideX + 22, FIELD.endZ - 22],
    [-sideX - 24, FIELD.backZ + 14],
    [sideX + 24, FIELD.backZ + 14],
  ]) {
    const tower = lightTower(glow);
    tower.position.set(x, 0, z);
    tower.lookAt(0, 0, midZ);
    group.add(tower);
  }

  const board = scoreboard();
  board.group.position.set(0, 27, FIELD.endZ - 15 - 26);
  group.add(board.group);
  return { group, setScore: board.draw };
}
