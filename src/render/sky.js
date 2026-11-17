import * as THREE from 'three';
import { makeCanvas, tileNoise, canvasTexture } from './textures.js';

/** Cloud noise: three octave bands in r, g and b of one small tiling texture. */
function cloudNoise() {
  const size = 256;
  const bands = [tileNoise(size, 4, 4, 3, 101), tileNoise(size, 8, 8, 3, 202), tileNoise(size, 16, 16, 2, 303)];
  const canvas = makeCanvas(size);
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = bands[0][i] * 255;
    img.data[i * 4 + 1] = bands[1][i] * 255;
    img.data[i * 4 + 2] = bands[2][i] * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { srgb: false, repeat: true, anisotropy: 1 });
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Rotation only, pinned to the far plane: the sky is infinitely far away
    // and is only drawn where nothing else is.
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir, uZenith, uHorizon, uGround, uSun, uCloudLit, uCloudShade;
  uniform float uSunSize, uGlow, uClouds, uStars, uTime;
  uniform sampler2D uNoise;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float up = clamp(h, 0.0, 1.0);
    // Deep overhead, pale and hazy toward the horizon.
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.42));
    float mu = dot(d, uSunDir);
    float m = max(mu, 0.0);
    // Light scattered around the sun, strongest low in the sky.
    vec3 glow = uSun * (pow(m, 6.0) * 0.35 + pow(m, 48.0) * 0.9) * uGlow;
    sky += glow * (1.0 - up * 0.6);
    // A warm band where the sun is near the horizon.
    sky += uSun * uGlow * 0.18 * pow(1.0 - up, 6.0) * (0.4 + 0.6 * m);

    if (h > 0.0 && uClouds > 0.0) {
      vec2 uv = d.xz / (h + 0.08) * 0.11 + vec2(uTime * 0.0018, uTime * 0.0007);
      float n = texture2D(uNoise, uv).r * 0.58 + texture2D(uNoise, uv * 2.3 + 0.31).g * 0.3 + texture2D(uNoise, uv * 5.7 + 0.77).b * 0.12;
      float cover = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.28, n) * smoothstep(0.0, 0.12, h);
      float thick = smoothstep(0.45, 1.0, n);
      vec3 cloud = mix(uCloudLit, uCloudShade, thick * 0.8);
      cloud += uSun * uGlow * pow(m, 5.0) * (1.0 - thick) * 0.9; // silver lining
      cloud = mix(cloud, uHorizon, pow(1.0 - up, 4.0) * 0.7); // far clouds sink into the haze
      sky = mix(sky, cloud, cover * 0.92);
    }

    // The sun (or the moon) itself: very bright, so it blooms.
    float disc = smoothstep(uSunSize, uSunSize + (1.0 - uSunSize) * 0.4, mu);
    sky += uSun * disc * 24.0;

    if (uStars > 0.0 && h > 0.0) {
      vec3 cell = floor(d * 380.0);
      float s = hash(cell);
      float star = step(0.9975, s) * smoothstep(0.02, 0.25, h);
      sky += vec3(0.75, 0.82, 1.0) * star * (s - 0.9975) * 900.0 * uStars;
    }

    // Below the horizon: the ground beyond the stadium, lost in haze.
    sky = mix(sky, mix(uHorizon, uGround, 0.75), smoothstep(0.0, -0.06, h));
    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sky: drawn per pixel, so it is sharp at any resolution and costs nothing to keep. */
export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uSunSize: { value: 0.9995 },
    uGlow: { value: 1 },
    uClouds: { value: 0.4 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uNoise: { value: cloudNoise() },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // after the opaque scene, so it only fills the gaps
  mesh.matrixAutoUpdate = false;

  /** Apply a lighting preset's sky. `dir` is the sun (or moon) direction. */
  const set = (s, dir) => {
    uniforms.uSunDir.value.set(dir[0], dir[1], dir[2]).normalize();
    uniforms.uZenith.value.setHex(s.zenith);
    uniforms.uHorizon.value.setHex(s.horizon);
    uniforms.uGround.value.setHex(s.ground);
    uniforms.uSun.value.setHex(s.sun);
    uniforms.uCloudLit.value.setHex(s.cloudLit);
    uniforms.uCloudShade.value.setHex(s.cloudShade);
    uniforms.uSunSize.value = s.sunSize;
    uniforms.uGlow.value = s.glow;
    uniforms.uClouds.value = s.clouds;
    uniforms.uStars.value = s.stars;
  };
  return { mesh, set, uniforms };
}
