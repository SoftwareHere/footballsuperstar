// The three looks the stadium can have. Colours are sRGB hex; directions
// point from the field toward the light. The camera always looks downfield
// (-z), so a key light from +x and a little behind it (+z) models the
// players from the side and throws their shadows forward across the turf.

export const LIGHTING = {
  golden: {
    label: 'Golden hour',
    key: { dir: [0.78, 0.3, 0.42], color: 0xffb877, intensity: 3.6 },
    fill: null,
    hemi: { sky: 0x9fb6d8, ground: 0x5d4a2e, intensity: 0.32 },
    env: 0.85,
    exposure: 0.98,
    fog: { color: 0xd8c3a2, near: 150, far: 760 },
    sky: {
      zenith: 0x3a6aad,
      horizon: 0xf2c58e,
      ground: 0x3a4430,
      sun: 0xffd3a0,
      sunSize: 0.9994,
      glow: 1.15,
      clouds: 0.4,
      cloudLit: 0xffdcb6,
      cloudShade: 0x8e8ea6,
      stars: 0,
    },
    lamps: 0.55,
    flares: 0.18,
    boards: 1.1,
    treeline: 0x2c3b2a,
    grade: { tint: [1.03, 1.0, 0.95], sat: 1.06, contrast: 0.14 },
  },
  night: {
    label: 'Night',
    // The four towers: the strongest one casts the shadows, the one across from it fills in.
    key: { dir: [-0.62, 0.62, 0.48], color: 0xeef3ff, intensity: 2.7 },
    fill: { dir: [0.66, 0.55, -0.5], color: 0xf6f3ff, intensity: 1.25 },
    hemi: { sky: 0x30405e, ground: 0x0e130d, intensity: 0.22 },
    env: 1.1,
    exposure: 1.12,
    fog: { color: 0x161d29, near: 110, far: 560 },
    sky: {
      zenith: 0x03060c,
      horizon: 0x1d2536,
      ground: 0x10140f,
      sun: 0x9eb2d6,
      sunSize: 0.99985,
      glow: 0.12,
      clouds: 0.18,
      cloudLit: 0x2d3648,
      cloudShade: 0x10141d,
      stars: 1,
    },
    sunDir: [-0.25, 0.75, -0.6], // the moon
    lamps: 9,
    flares: 0.95,
    boards: 2.2,
    treeline: 0x080b0a,
    grade: { tint: [0.97, 1.0, 1.05], sat: 1.04, contrast: 0.16 },
  },
  midday: {
    label: 'Midday',
    key: { dir: [0.32, 0.86, 0.4], color: 0xfff5e8, intensity: 3.9 },
    fill: null,
    hemi: { sky: 0xcfe2ff, ground: 0x4f653d, intensity: 0.42 },
    env: 1.0,
    exposure: 0.88,
    fog: { color: 0xc4d8ea, near: 190, far: 860 },
    sky: {
      zenith: 0x2462c2,
      horizon: 0xbad3ec,
      ground: 0x43503a,
      sun: 0xfff3dc,
      sunSize: 0.9995,
      glow: 0.55,
      clouds: 0.46,
      cloudLit: 0xffffff,
      cloudShade: 0xadb9cb,
      stars: 0,
    },
    lamps: 0.05,
    flares: 0,
    boards: 1.0,
    treeline: 0x34502f,
    grade: { tint: [1.0, 1.0, 1.0], sat: 1.04, contrast: 0.12 },
  },
};

export const LIGHTING_NAMES = Object.keys(LIGHTING);
