import * as THREE from 'three';

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Bright parts of the picture, a quarter size, with a soft threshold.
const brightFragment = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uTexel;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb
           + texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb
           + texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float l = max(c.r, max(c.g, c.b));
    float knee = 0.5;
    float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float k = max(soft, l - uThreshold) / max(l, 1e-4);
    gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
  }
`;

// Nine-tap Gaussian in five fetches, along one axis.
const blurFragment = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv).rgb * 0.2270270;
    c += texture2D(tInput, vUv + uStep * 1.3846154).rgb * 0.3162162;
    c += texture2D(tInput, vUv - uStep * 1.3846154).rgb * 0.3162162;
    c += texture2D(tInput, vUv + uStep * 3.2307692).rgb * 0.0702703;
    c += texture2D(tInput, vUv - uStep * 3.2307692).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const copyFragment = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv + uTexel * vec2(-0.5, -0.5)).rgb
           + texture2D(tInput, vUv + uTexel * vec2(0.5, -0.5)).rgb
           + texture2D(tInput, vUv + uTexel * vec2(-0.5, 0.5)).rgb
           + texture2D(tInput, vUv + uTexel * vec2(0.5, 0.5)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

// The lens: bloom, film tone curve, grade, vignette and grain.
const compositeFragment = /* glsl */ `
  uniform sampler2D tScene, tBloomA, tBloomB;
  uniform float uBloom, uVignette, uGrain, uTime, uSat, uContrast;
  uniform vec3 uTint;
  uniform vec2 uAspect;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    c += (texture2D(tBloomA, vUv).rgb * 0.55 + texture2D(tBloomB, vUv).rgb * 0.45) * uBloom;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    c = gl_FragColor.rgb * uTint;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(l), c, uSat), 0.0);
    // A gentle S-curve, done in a perceptual space.
    vec3 p = sqrt(c);
    p = mix(p, p * p * (3.0 - 2.0 * p), uContrast);
    c = p * p;
    vec2 q = (vUv - 0.5) * uAspect;
    c *= mix(1.0, smoothstep(1.05, 0.25, length(q)), uVignette);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * uGrain;
  }
`;

function pass(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: quadVertex, fragmentShader, depthTest: false, depthWrite: false });
}

const target = (w, h, samples = 0, depth = false) =>
  new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: depth, stencilBuffer: false });

/**
 * The picture as a camera would take it: the scene goes to a high dynamic
 * range buffer (multisampled, so edges are smooth), bright parts bloom, and
 * one last pass tone maps, grades and adds vignette and grain on the way to
 * the screen. Only used where the machine can afford it.
 */
export class Pipeline {
  static supported(renderer) {
    const ext = renderer.extensions;
    return renderer.capabilities.isWebGL2 !== false && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
  }

  constructor(renderer) {
    this.renderer = renderer;
    this.scene = target(1, 1, 4, true);
    this.a1 = target(1, 1);
    this.b1 = target(1, 1);
    this.a2 = target(1, 1);
    this.b2 = target(1, 1);
    this.width = 1;
    this.height = 1;
    this.bloom = true;
    this.time = 0;

    this.bright = pass(brightFragment, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 } });
    this.blur = pass(blurFragment, { tInput: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.copy = pass(copyFragment, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.composite = pass(compositeFragment, {
      tScene: { value: this.scene.texture },
      tBloomA: { value: this.a1.texture },
      tBloomB: { value: this.a2.texture },
      uBloom: { value: 0.6 },
      uVignette: { value: 0.32 },
      uGrain: { value: 0.012 },
      uTime: { value: 0 },
      uSat: { value: 1.05 },
      uContrast: { value: 0.14 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uAspect: { value: new THREE.Vector2(1, 1) },
    });
    // Bright, intermediate passes never tone map; only the last one does.
    for (const m of [this.bright, this.blur, this.copy]) m.toneMapped = false;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geometry, this.composite);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Drawing-buffer size in pixels. */
  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.scene.setSize(w, h);
    const w4 = Math.max(1, Math.round(w / 4));
    const h4 = Math.max(1, Math.round(h / 4));
    this.a1.setSize(w4, h4);
    this.b1.setSize(w4, h4);
    const w8 = Math.max(1, Math.round(w / 8));
    const h8 = Math.max(1, Math.round(h / 8));
    this.a2.setSize(w8, h8);
    this.b2.setSize(w8, h8);
    this.composite.uniforms.uAspect.value.set(w / Math.max(w, h), h / Math.max(w, h)).multiplyScalar(1.25);
  }

  setGrade({ tint, sat, contrast }) {
    const u = this.composite.uniforms;
    u.uTint.value.set(tint[0], tint[1], tint[2]);
    u.uSat.value = sat;
    u.uContrast.value = contrast;
  }

  draw(material, output) {
    this.quad.material = material;
    this.renderer.setRenderTarget(output);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    const u = this.composite.uniforms;
    if (this.bloom) {
      this.bright.uniforms.tInput.value = this.scene.texture;
      this.bright.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.draw(this.bright, this.a1);
      this.blurPair(this.a1, this.b1);
      this.copy.uniforms.tInput.value = this.a1.texture;
      this.copy.uniforms.uTexel.value.set(1 / this.a1.width, 1 / this.a1.height);
      this.draw(this.copy, this.a2);
      this.blurPair(this.a2, this.b2);
      u.uBloom.value = this.bloomStrength ?? 0.6;
    } else {
      u.uBloom.value = 0;
    }
    this.time += dt;
    u.uTime.value = this.time;
    this.draw(this.composite, null);
  }

  blurPair(a, b) {
    const m = this.blur;
    m.uniforms.tInput.value = a.texture;
    m.uniforms.uStep.value.set(1 / a.width, 0);
    this.draw(m, b);
    m.uniforms.tInput.value = b.texture;
    m.uniforms.uStep.value.set(0, 1 / a.height);
    this.draw(m, a);
  }

  dispose() {
    for (const t of [this.scene, this.a1, this.b1, this.a2, this.b2]) t.dispose();
  }
}
