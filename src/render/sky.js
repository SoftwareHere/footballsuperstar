import * as THREE from 'three';

/** Direction to the sun: late afternoon, behind and to the right of the offense. */
export const SUN_DIR = new THREE.Vector3(0.56, 0.6, 0.57).normalize();

/**
 * A painted sky as an equirectangular texture: gradient, haze on the horizon,
 * the sun's glow and some cloud. It is both the backdrop and what shiny
 * things (helmets) reflect.
 */
export function createSkyTexture() {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#16407f');
  grad.addColorStop(0.28, '#2f6fbe');
  grad.addColorStop(0.43, '#79aee0');
  grad.addColorStop(0.495, '#d9e6ee');
  grad.addColorStop(0.5, '#e8e4d8');
  grad.addColorStop(0.52, '#5d7a5c');
  grad.addColorStop(1, '#27402b');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Where the sun sits on the map.
  const u = Math.atan2(SUN_DIR.z, SUN_DIR.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(SUN_DIR.y) / Math.PI + 0.5;
  const sx = u * W;
  const sy = (1 - v) * H;
  for (const dx of [-W, 0, W]) {
    const glow = g.createRadialGradient(sx + dx, sy, 0, sx + dx, sy, H * 0.55);
    glow.addColorStop(0, 'rgba(255,246,214,0.95)');
    glow.addColorStop(0.035, 'rgba(255,238,190,0.7)');
    glow.addColorStop(0.16, 'rgba(255,226,170,0.22)');
    glow.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H * 0.52);
  }

  // Clouds: soft blobs strung into banks, flatter toward the horizon.
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  })();
  for (let bank = 0; bank < 26; bank++) {
    const cx = rand() * W;
    const cy = H * (0.2 + rand() * 0.26);
    const flat = 0.35 + (cy / (H * 0.5)) * 0.25;
    const size = 40 + rand() * 90;
    for (let i = 0; i < 16; i++) {
      const x = cx + (rand() - 0.5) * size * 5;
      const y = cy + (rand() - 0.5) * size * 0.7;
      const r = size * (0.5 + rand() * 0.7);
      for (const dx of [-W, 0, W]) {
        const c = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        c.addColorStop(0, 'rgba(255,255,255,0.2)');
        c.addColorStop(0.6, 'rgba(250,246,240,0.08)');
        c.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = c;
        g.save();
        g.translate(x + dx, y);
        g.scale(1, flat);
        g.translate(-(x + dx), -y);
        g.fillRect(x + dx - r, y - r, r * 2, r * 2);
        g.restore();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
