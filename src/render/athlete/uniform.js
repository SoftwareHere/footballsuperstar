import * as THREE from 'three';
import { makeCanvas, tileNoise, writeNormals, canvasTexture } from '../textures.js';

/**
 * The player's uniform, painted into one texture atlas so the whole body
 * draws in one call. Layout, in atlas pixels (1024 square, top-left origin):
 * the torso, legs and arms are unrolled tubes (u around the body, v by bind-
 * pose height `top`..`bottom` in yards), the helmet and shoulder caps are
 * spheres, and the small parts are solid tiles.
 */
export const ATLAS = 1024;
const INSET = 4; // gutter so neighbouring regions do not bleed into each other

export const REGIONS = {
  torso: { x: 0, y: 0, w: 512, h: 512, top: 1.72, bottom: 0.86 },
  legL: { x: 512, y: 0, w: 128, h: 512, top: 1.16, bottom: 0.03, front: 0.25 },
  legR: { x: 640, y: 0, w: 128, h: 512, top: 1.16, bottom: 0.03, front: 0.75 },
  armL: { x: 768, y: 0, w: 128, h: 512, top: 1.72, bottom: 0.9 },
  armR: { x: 896, y: 0, w: 128, h: 512, top: 1.72, bottom: 0.9 },
  helmet: { x: 0, y: 512, w: 512, h: 256 }, // phi from -pi/2 to 5pi/2 across, theta 0..pi down
  cap: { x: 512, y: 512, w: 256, h: 256 }, // phi 0..2pi across, theta 0..pi down
};
const TILE_NAMES = ['helmet', 'trim', 'mask', 'cleat', 'sole', 'glove', 'skin', 'visor', 'jersey', 'pants', 'pad', 'strap'];
export const TILES = Object.fromEntries(TILE_NAMES.map((n, i) => [n, { x: 768 + (i % 4) * 64, y: 512 + Math.floor(i / 4) * 64, w: 64, h: 64 }]));

// Bands on the body, by bind-pose height in yards.
const WAIST = 1.19; // jersey tucked into the pants
const PANTS_END = 0.44; // just below the knee
const SLEEVE_END = 1.455;
const CHEST_RX = 0.228; // half-width of the torso where the number sits

const px = (r, u) => r.x + INSET + u * (r.w - 2 * INSET);
const py = (r, y) => r.y + ((r.top - y) / (r.top - r.bottom)) * r.h;

/** UV for a point on an unrolled tube: `u` 0..1 around, `y` bind-pose height. */
export function tubeUV(region, u, y) {
  return [px(region, u) / ATLAS, 1 - py(region, y) / ATLAS];
}
export function tileUV(name) {
  const t = TILES[name];
  return [(t.x + t.w / 2) / ATLAS, 1 - (t.y + t.h / 2) / ATLAS];
}
/** UV on the helmet from sphere angles. */
export function helmetUV(phi, theta) {
  const r = REGIONS.helmet;
  return [(r.x + INSET + ((phi + Math.PI / 2) / (Math.PI * 3)) * (r.w - 2 * INSET)) / ATLAS, 1 - (r.y + (theta / Math.PI) * r.h) / ATLAS];
}
export function capUV(phi, theta) {
  const r = REGIONS.cap;
  return [(r.x + INSET + (phi / (Math.PI * 2)) * (r.w - 2 * INSET)) / ATLAS, 1 - (r.y + (theta / Math.PI) * r.h) / ATLAS];
}

const css = (hex) => '#' + new THREE.Color(hex).getHexString();
const rgb = (hex) => {
  const c = new THREE.Color(hex);
  c.convertLinearToSRGB();
  return [c.r * 255, c.g * 255, c.b * 255];
};
const luma = (hex) => {
  const [r, g, b] = rgb(hex);
  return (r * 0.3 + g * 0.59 + b * 0.11) / 255;
};
const near = (a, b) => {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 70;
};

let logoCache = null;
/** The helmet decal: a star, read straight from either side. */
function logo(fill, edge) {
  const c = logoCache || (logoCache = makeCanvas(128));
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 24 : 58;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = edge;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
  return g.getImageData(0, 0, 128, 128);
}

/** Fill a sphere-mapped region pixel by pixel: `fn(x, y, z)` gives [r, g, b] for a point on the unit sphere. */
function paintSphere(g, scale, region, phiStart, phiSpan, fn) {
  const x0 = Math.round(region.x * scale);
  const y0 = Math.round(region.y * scale);
  const w = Math.round(region.w * scale);
  const h = Math.round(region.h * scale);
  const inset = INSET * scale;
  const img = g.getImageData(x0, y0, w, h);
  for (let j = 0; j < h; j++) {
    const theta = ((j + 0.5) / h) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let i = 0; i < w; i++) {
      const phi = phiStart + ((i + 0.5 - inset) / (w - 2 * inset)) * phiSpan;
      const c = fn(-Math.cos(phi) * st, ct, Math.sin(phi) * st);
      const k = (j * w + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, x0, y0);
}

/**
 * Paint a player's look into `canvas`: colours { jersey, trim, helmet, pants,
 * skin } (hex) and his number.
 */
export function paintLook(canvas, colors, number) {
  const s = canvas.width / ATLAS;
  const g = canvas.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0);
  const jersey = css(colors.jersey);
  const trim = css(colors.trim);
  const pants = css(colors.pants);
  const skin = css(colors.skin);
  const fill = (c, x, y, w, h) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const band = (r, c, yTop, yBottom, u0 = 0, u1 = 1) => {
    const x0 = u0 <= 0 ? r.x : px(r, u0);
    const x1 = u1 >= 1 ? r.x + r.w : px(r, u1);
    fill(c, x0, py(r, yTop), x1 - x0, py(r, yBottom) - py(r, yTop));
  };
  const shade = (r, alpha, yTop, yBottom, fadeDown = true) => {
    const y0 = py(r, yTop);
    const y1 = py(r, yBottom);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(fadeDown ? 0 : 1, `rgba(0,0,0,${alpha})`);
    grad.addColorStop(fadeDown ? 1 : 0, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(r.x, y0, r.w, y1 - y0);
  };

  // ---- torso: jersey over pants
  const T = REGIONS.torso;
  band(T, jersey, T.top, WAIST);
  band(T, pants, WAIST, T.bottom);
  band(T, '#1c1e23', 1.157, 1.124); // belt
  band(T, trim, T.top, 1.666); // collar
  // V at the front of the collar.
  g.fillStyle = trim;
  g.beginPath();
  g.moveTo(px(T, 0.205), py(T, 1.668));
  g.lineTo(px(T, 0.25), py(T, 1.605));
  g.lineTo(px(T, 0.295), py(T, 1.668));
  g.fill();
  // Side panels under the arms.
  for (const u of [0, 0.5, 1]) band(T, trim, 1.54, 1.23, Math.max(0, u - 0.035), Math.min(1, u + 0.035));
  for (const u of [0, 0.5, 1]) band(T, jersey, 1.54, 1.23, Math.max(0, u - 0.02), Math.min(1, u + 0.02));
  // Where cloth folds and tucks, and where the pads shade it.
  shade(T, 0.28, WAIST + 0.035, WAIST - 0.005, false);
  shade(T, 0.2, WAIST - 0.005, WAIST - 0.05);
  shade(T, 0.14, 0.93, T.bottom, false);
  shade(T, 0.18, 1.66, 1.6);
  // Numbers, front and back, squeezed to undo the stretch of the unrolled chest.
  const vScale = T.h / (T.top - T.bottom);
  const hScale = (T.w - 2 * INSET) / (Math.PI * 2 * CHEST_RX);
  const outline = luma(colors.jersey) > 0.5 ? '#16181d' : 'rgba(0,0,0,0.45)';
  for (const [u, y, tall] of [
    [0.25, 1.405, 0.2],
    [0.75, 1.39, 0.25],
  ]) {
    const hPx = tall * vScale;
    g.save();
    g.translate(px(T, u), py(T, y));
    g.scale(hScale / vScale, 1);
    g.font = `900 ${hPx * 1.38}px "Arial Narrow", Impact, "Helvetica Neue", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = hPx * 0.13;
    g.strokeStyle = outline;
    g.strokeText(String(number), 0, hPx * 0.06);
    g.fillStyle = trim;
    g.fillText(String(number), 0, hPx * 0.06);
    g.restore();
  }

  // ---- legs: pants with a side stripe, socks, tape over the ankles
  const stripe = near(colors.trim, colors.pants) ? jersey : trim;
  for (const L of [REGIONS.legL, REGIONS.legR]) {
    band(L, pants, L.top, PANTS_END);
    band(L, jersey, PANTS_END, 0.12);
    band(L, '#e6e8eb', 0.12, L.bottom);
    band(L, stripe, L.top, PANTS_END + 0.01, 0, 0.045);
    band(L, stripe, L.top, PANTS_END + 0.01, 0.955, 1);
    band(L, trim, 0.39, 0.375);
    band(L, trim, 0.36, 0.348);
    shade(L, 0.25, PANTS_END + 0.015, PANTS_END - 0.02, false);
    shade(L, 0.3, L.top, L.top - 0.12);
    // Grass on the knee.
    const kx = px(L, L.front);
    const ky = py(L, 0.53);
    const stain = g.createRadialGradient(kx, ky, 0, kx, ky, 18);
    stain.addColorStop(0, 'rgba(64,86,34,0.32)');
    stain.addColorStop(1, 'rgba(64,86,34,0)');
    g.fillStyle = stain;
    g.fillRect(kx - 18, ky - 18, 36, 36);
  }

  // ---- arms: sleeve, skin, wrist tape
  for (const A of [REGIONS.armL, REGIONS.armR]) {
    band(A, skin, A.top, A.bottom);
    band(A, jersey, A.top, SLEEVE_END);
    band(A, trim, 1.505, 1.488);
    band(A, trim, 1.478, 1.468);
    shade(A, 0.22, SLEEVE_END + 0.012, SLEEVE_END, false);
    band(A, '#e9ebee', 1.02, A.bottom);
    shade(A, 0.12, 1.3, 1.25, false);
    shade(A, 0.12, 1.25, 1.2);
  }

  // ---- solid tiles
  const tiles = {
    helmet: css(colors.helmet),
    trim,
    mask: '#24262b',
    cleat: '#16181c',
    sole: '#e2e2e2',
    glove: '#eef0f2',
    skin,
    visor: '#0a0c10',
    jersey,
    pants,
    pad: '#191a1e',
    strap: '#e7e9ec',
  };
  for (const [name, color] of Object.entries(tiles)) {
    const t = TILES[name];
    fill(color, t.x, t.y, t.w, t.h);
  }

  // ---- helmet: shell colour, a stripe front to back, and a star on each side
  g.setTransform(1, 0, 0, 1, 0, 0);
  const shell = rgb(colors.helmet);
  const tr = rgb(colors.trim);
  const jr = rgb(near(colors.trim, colors.helmet) ? colors.jersey : colors.trim);
  const edge = rgb(colors.jersey);
  const decal = logo(near(colors.trim, colors.helmet) ? jersey : trim, near(colors.jersey, colors.helmet) ? '#15171c' : jersey);
  paintSphere(g, s, REGIONS.helmet, -Math.PI / 2, Math.PI * 3, (x, y, z) => {
    const ax = Math.abs(x);
    if (y > -0.35 && ax < 0.045) return jr;
    if (y > -0.35 && ax < 0.062) return edge;
    if (ax > 0.45) {
      const h = (x > 0 ? -z : z) - 0.1; // the decal sits a little behind the ear hole
      const v = y - 0.08;
      const du = Math.floor((h / 0.62 + 0.5) * 128);
      const dv = Math.floor((0.5 - v / 0.62) * 128);
      if (du >= 0 && du < 128 && dv >= 0 && dv < 128) {
        const k = (dv * 128 + du) * 4;
        const a = decal.data[k + 3] / 255;
        if (a > 0) return [shell[0] + (decal.data[k] - shell[0]) * a, shell[1] + (decal.data[k + 1] - shell[1]) * a, shell[2] + (decal.data[k + 2] - shell[2]) * a];
      }
    }
    return shell;
  });
  // ---- shoulder caps: jersey with two stripes over each shoulder
  const jc = rgb(colors.jersey);
  paintSphere(g, s, REGIONS.cap, 0, Math.PI * 2, (x) => {
    const ax = Math.abs(x);
    if ((ax > 0.42 && ax < 0.54) || (ax > 0.62 && ax < 0.69)) return tr;
    return jc;
  });
}

let shared = null;

/** Surface maps every player shares: roughness/metalness and fabric normals, in the same layout. */
export function sharedMaps() {
  if (shared) return shared;
  const size = 512;
  const s = size / ATLAS;

  // Roughness in green, metalness in blue (the glTF convention three.js reads).
  const orm = makeCanvas(size);
  const g = orm.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0);
  const rm = (rough, metal = 0) => `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
  const area = (r, c, yTop = r.top, yBottom = r.bottom) => {
    g.fillStyle = c;
    g.fillRect(r.x, py(r, yTop), r.w, py(r, yBottom) - py(r, yTop));
  };
  const T = REGIONS.torso;
  area(T, rm(0.82));
  area(T, rm(0.56), WAIST, T.bottom);
  area(T, rm(0.45), 1.157, 1.124);
  for (const L of [REGIONS.legL, REGIONS.legR]) {
    area(L, rm(0.56));
    area(L, rm(0.9), PANTS_END, 0.12);
    area(L, rm(0.7), 0.12, L.bottom);
  }
  for (const A of [REGIONS.armL, REGIONS.armR]) {
    area(A, rm(0.5));
    area(A, rm(0.82), A.top, SLEEVE_END);
    area(A, rm(0.72), 1.02, A.bottom);
  }
  const H = REGIONS.helmet;
  g.fillStyle = rm(0.13);
  g.fillRect(H.x, H.y, H.w, H.h);
  const C = REGIONS.cap;
  g.fillStyle = rm(0.8);
  g.fillRect(C.x, C.y, C.w, C.h);
  const tileRM = { helmet: rm(0.13), trim: rm(0.7), mask: rm(0.32, 0.75), cleat: rm(0.36), sole: rm(0.6), glove: rm(0.45), skin: rm(0.5), visor: rm(0.05, 0.35), jersey: rm(0.82), pants: rm(0.56), pad: rm(0.9), strap: rm(0.6) };
  for (const [name, c] of Object.entries(tileRM)) {
    const t = TILES[name];
    g.fillStyle = c;
    g.fillRect(t.x, t.y, t.w, t.h);
  }

  // Fabric: mesh jersey, knit pants with folds, ribbed socks, a hint of skin.
  const height = new Float32Array(size * size).fill(0.5);
  const folds = tileNoise(size, 10, 36, 2, 11);
  const fine = tileNoise(size, 128, 128, 1, 12);
  for (let j = 0; j < size; j++) {
    const ay = j / s;
    for (let i = 0; i < size; i++) {
      const ax = i / s;
      const k = j * size + i;
      const mesh = 0.5 + 0.5 * Math.cos(i * 2.2) * Math.cos(j * 2.2);
      let h = 0.5;
      if (ay < 512 && ax < 512) {
        const y = T.top - (ay / T.h) * (T.top - T.bottom);
        const waist = Math.exp(-(((y - WAIST - 0.06) / 0.07) ** 2));
        h = y > WAIST ? 0.25 * mesh + folds[k] * (0.3 + 0.8 * waist) : 0.15 * fine[k] + folds[k] * 0.3;
      } else if (ay < 512 && ax < 768) {
        const r = ax < 640 ? REGIONS.legL : REGIONS.legR;
        const y = r.top - (ay / r.h) * (r.top - r.bottom);
        h = y > PANTS_END ? 0.15 * fine[k] + folds[k] * 0.3 : 0.5 + 0.3 * Math.cos(i * 1.6);
      } else if (ay < 512) {
        const r = REGIONS.armL;
        const y = r.top - (ay / r.h) * (r.top - r.bottom);
        h = y > SLEEVE_END ? 0.25 * mesh + folds[k] * 0.3 : 0.5 + 0.05 * fine[k];
      } else if (ax >= 512 && ax < 768 && ay < 768) {
        h = 0.3 * mesh;
      }
      height[k] = h;
    }
  }
  const nc = makeCanvas(size);
  const ng = nc.getContext('2d');
  const img = ng.createImageData(size, size);
  writeNormals(img, size, height, size, size, 1.6, 0, 0, false);
  ng.putImageData(img, 0, 0);

  shared = { orm: canvasTexture(orm, { srgb: false }), normal: canvasTexture(nc, { srgb: false }) };
  return shared;
}
