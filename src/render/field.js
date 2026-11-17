import * as THREE from 'three';
import { FIELD } from '../config.js';
import { RNG } from '../core/rng.js';
import { makeCanvas, tileNoise, writeNormals, canvasTexture } from './textures.js';
import { merge, paint, place } from './geo.js';

const TEX = { minX: -32, maxX: 32, minZ: -50, maxZ: 20 };
const APRON = '#36602a';
const GRASS_TILE = 0.55; // blade detail repeats per yard

/** The painted field: stripes, end zone, lines and numbers. `PX` is texture pixels per yard. */
function drawTurf(PX) {
  const rng = new RNG(4242);
  const canvas = makeCanvas((TEX.maxX - TEX.minX) * PX, (TEX.maxZ - TEX.minZ) * PX);
  const g = canvas.getContext('2d');
  const X = (x) => (x - TEX.minX) * PX;
  const Y = (z) => (z - TEX.minZ) * PX;
  const rect = (x0, z0, x1, z1) => g.fillRect(X(x0), Y(z0), (x1 - x0) * PX, (z1 - z0) * PX);
  const hw = FIELD.halfWidth;

  g.fillStyle = APRON;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Mowing stripes, every 5 yards. Kept subtle: the shader adds the sheen that
  // changes with the camera, as real cut grass does.
  for (let z = FIELD.endZ, i = 0; z < TEX.maxZ; z += 5, i++) {
    g.fillStyle = i % 2 ? '#457b31' : '#3f732c';
    rect(-hw - 2, z, hw + 2, Math.min(z + 5, TEX.maxZ));
  }
  // Broad, soft patches of wear and growth so the field is not one flat colour.
  for (let i = 0; i < 90; i++) {
    const x = rng.next() * canvas.width;
    const y = rng.next() * canvas.height;
    const r = (2 + rng.next() * 7) * PX;
    const patch = g.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, rng.chance(0.5) ? 'rgba(170,160,80,0.07)' : 'rgba(0,25,0,0.08)');
    patch.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = patch;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // End zone, painted onto the grass.
  g.globalAlpha = 0.9;
  g.fillStyle = '#17377c';
  rect(-hw, FIELD.endZ, hw, FIELD.goalZ);
  g.globalAlpha = 1;
  g.save();
  g.translate(X(0), Y((FIELD.endZ + FIELD.goalZ) / 2));
  g.fillStyle = 'rgba(244,246,240,0.9)';
  g.font = `italic 900 ${6.2 * PX}px "Arial Narrow", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SUPERSTAR', 0, 0.3 * PX);
  g.restore();

  g.fillStyle = 'rgba(242,244,236,0.93)';
  for (let z = FIELD.goalZ + 5; z <= 15; z += 5) rect(-hw, z - 0.055, hw, z + 0.055);
  rect(-hw, FIELD.goalZ - 0.11, hw, FIELD.goalZ + 0.11);
  for (let z = FIELD.goalZ + 1; z < FIELD.backZ; z++) {
    if ((z - FIELD.goalZ) % 5 === 0) continue;
    for (const x of [-3.08, 3.08]) rect(x - 0.33, z - 0.05, x + 0.33, z + 0.05);
    rect(-hw + 0.3, z - 0.05, -hw + 0.97, z + 0.05);
    rect(hw - 0.97, z - 0.05, hw - 0.3, z + 0.05);
  }
  // The white border outside the sidelines and end line.
  const b = 2;
  rect(-hw - b, FIELD.endZ - b, -hw, TEX.maxZ);
  rect(hw, FIELD.endZ - b, hw + b, TEX.maxZ);
  rect(-hw - b, FIELD.endZ - b, hw + b, FIELD.endZ);

  // Yard numbers, read from each sideline, with the arrow toward the nearer goal.
  g.font = `900 ${2.4 * PX}px "Arial Narrow", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let z = FIELD.goalZ + 10, n = 10; z <= 15; z += 10, n += 10) {
    for (const side of [-1, 1]) {
      g.save();
      g.translate(X(side * 15.2), Y(z));
      g.rotate((side * Math.PI) / 2);
      g.fillText(String(n).split('').join(' '), 0, 0);
      if (n < 50) {
        // The arrow sits on the goal side of the number.
        const dir = -side;
        g.beginPath();
        g.moveTo(dir * 2.05 * PX, -0.62 * PX);
        g.lineTo(dir * 2.05 * PX, -1.02 * PX);
        g.lineTo(dir * 2.45 * PX, -0.82 * PX);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }

  // Grass growing through everything, the paint included: short blades along the mow.
  const blades = Math.round(canvas.width * canvas.height * 0.045);
  for (let i = 0; i < blades; i++) {
    const light = rng.chance(0.5);
    g.fillStyle = light ? `rgba(200,240,150,${0.03 + rng.next() * 0.05})` : `rgba(0,28,6,${0.05 + rng.next() * 0.08})`;
    g.fillRect(rng.next() * canvas.width, rng.next() * canvas.height, 1, 2 + rng.next() * 4);
  }
  return canvasTexture(canvas, { anisotropy: 16 });
}

/**
 * Close-up grass, tiling: r = fine blades laid along the field, g = broad
 * patches, b = clumps. And the matching normal map, from the blades.
 */
function grassDetail(size) {
  const blades = tileNoise(size, size / 4, size / 16, 2, 7, 0.45);
  const patches = tileNoise(size, 4, 4, 4, 8);
  const clumps = tileNoise(size, 24, 24, 2, 9);
  const canvas = makeCanvas(size);
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = blades[i] * 255;
    img.data[i * 4 + 1] = patches[i] * 255;
    img.data[i * 4 + 2] = clumps[i] * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const detail = canvasTexture(canvas, { srgb: false, repeat: true });

  const ncanvas = makeCanvas(size);
  const ng = ncanvas.getContext('2d');
  const nimg = ng.createImageData(size, size);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = blades[i] * 0.8 + clumps[i] * 0.4;
  writeNormals(nimg, size, h, size, size, 3.2);
  ng.putImageData(nimg, 0, 0);
  const normal = canvasTexture(ncanvas, { srgb: false, repeat: true });
  return { detail, normal };
}

const GRASS_FRAGMENT = /* glsl */ `
  vec2 gp = vGrassPos.xz;
  float gNear = 1.0 - smoothstep(16.0, 75.0, distance(cameraPosition, vGrassPos));
  float gBlade = texture2D(uGrass, gp * ${GRASS_TILE.toFixed(3)}).r;
  float gClump = texture2D(uGrass, gp * 0.19 + 0.37).b;
  float gPatch = texture2D(uGrass, gp * 0.041 + 0.61).g;
  float gDetail = mix(1.0, 0.7 + 0.6 * gBlade, 0.85 * gNear) * (0.88 + 0.24 * gClump);
  // Drier, yellower grass in places.
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.1, 1.03, 0.8), smoothstep(0.45, 0.8, gPatch) * 0.6);
  // Mowing: blades lie one way and then the other every five yards, so which
  // stripe looks light depends on where you look from.
  float gBand = mod(floor((vGrassPos.z + 35.0) / 5.0), 2.0) * 2.0 - 1.0;
  vec3 gView = normalize(cameraPosition - vGrassPos);
  float gSheen = gBand * gView.z * 0.17 * (1.0 - step(31.0, abs(vGrassPos.x)));
  diffuseColor.rgb *= gDetail * (1.0 + gSheen);
`;

/** Turn a lit material into grass: blades, clumps and mowing sheen, done in the shader. */
function grassify(material, detail) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: detail };
    shader.vertexShader =
      'varying vec3 vGrassPos;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGrassPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader =
      'varying vec3 vGrassPos;\nuniform sampler2D uGrass;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${GRASS_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `grass-${material.type}`;
  return material;
}

/** Goalpost and pylons, as one mesh. */
function hardware() {
  const parts = [];
  const tube = (r, h, pos, rot = [0, 0, 0]) => parts.push(paint(place(new THREE.CylinderGeometry(r, r, h, 12), pos, rot), 0xffcf1a));
  const z = FIELD.endZ;
  tube(0.13, 3.4, [0, 1.7, z - 1.2]);
  tube(0.11, 1.4, [0, 3.33, z - 0.55], [Math.PI / 2, 0, 0]);
  tube(0.1, 6.17, [0, 3.33, z], [0, 0, Math.PI / 2]);
  for (const x of [-3.085, 3.085]) tube(0.08, 9.5, [x, 3.33 + 4.75, z]);
  parts.push(paint(place(new THREE.CylinderGeometry(0.34, 0.34, 2, 16), [0, 1, z - 1.2]), 0x17377c));
  for (const pz of [FIELD.goalZ, FIELD.endZ]) {
    for (const x of [-FIELD.halfWidth, FIELD.halfWidth]) parts.push(paint(place(new THREE.BoxGeometry(0.14, 0.5, 0.14), [x, 0.25, pz]), 0xff5a0d));
  }
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 }));
  mesh.castShadow = true;
  return mesh;
}

/**
 * The field itself: turf, paint, goalpost and pylons. `px` is texture pixels
 * per yard. `setQuality(pbr)` swaps between full and cheap (matte) lighting.
 */
export function createField(px = 32) {
  const group = new THREE.Group();
  const { detail, normal } = grassDetail(px >= 32 ? 512 : 256);
  const turfMap = drawTurf(px);
  const w = TEX.maxX - TEX.minX;
  const d = TEX.maxZ - TEX.minZ;

  const turfNormal = normal.clone();
  turfNormal.repeat.set(w * GRASS_TILE, d * GRASS_TILE);
  turfNormal.needsUpdate = true;
  const groundNormal = normal.clone();
  groundNormal.repeat.set(600 * GRASS_TILE, 600 * GRASS_TILE);
  groundNormal.needsUpdate = true;

  const scale = new THREE.Vector2(0.55, 0.55);
  const mats = {
    turf: {
      pbr: grassify(new THREE.MeshStandardMaterial({ map: turfMap, normalMap: turfNormal, normalScale: scale, roughness: 0.92, metalness: 0 }), detail),
      cheap: grassify(new THREE.MeshLambertMaterial({ map: turfMap }), detail),
    },
    ground: {
      pbr: grassify(new THREE.MeshStandardMaterial({ color: APRON, normalMap: groundNormal, normalScale: scale, roughness: 0.94, metalness: 0 }), detail),
      cheap: grassify(new THREE.MeshLambertMaterial({ color: APRON }), detail),
    },
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mats.ground.pbr);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);

  const turf = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mats.turf.pbr);
  turf.rotation.x = -Math.PI / 2;
  turf.position.set((TEX.minX + TEX.maxX) / 2, 0, (TEX.minZ + TEX.maxZ) / 2);
  turf.receiveShadow = true;
  group.add(turf);

  group.add(hardware());

  // Line of scrimmage, TV-style.
  const los = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.halfWidth * 2, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x35b4ff, transparent: true, opacity: 0.7, depthWrite: false })
  );
  los.rotation.x = -Math.PI / 2;
  los.position.set(0, 0.015, 0);
  group.add(los);

  for (const m of group.children) {
    m.updateMatrix();
    m.matrixAutoUpdate = false;
  }
  const setQuality = (pbr) => {
    turf.material = pbr ? mats.turf.pbr : mats.turf.cheap;
    ground.material = pbr ? mats.ground.pbr : mats.ground.cheap;
  };
  return { group, setQuality };
}
