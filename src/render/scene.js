import * as THREE from 'three';
import { QB, BODY_RADIUS, JUMP, GRAVITY, TOE } from '../config.js';
import { P } from '../physics/body.js';
import { angleDelta } from '../core/vec.js';
import { createField } from './field.js';
import { createSky } from './sky.js';
import { createStadium } from './stadium.js';
import { Effects } from './effects.js';
import { AthleteModel } from './athleteModel.js';
import { BallModel } from './ballModel.js';
import { Markers } from './markers.js';
import { CameraRig } from './cameraRig.js';
import { LIGHTING, TURF_BOUNCE } from './lighting.js';
import { Pipeline } from './pipeline.js';

export const USER_COLORS = { jersey: 0x1e6bff, trim: 0xffffff, helmet: 0xf4f6fa, pants: 0xf4f6fa };
const QB_COLORS = { jersey: 0xff7a1a, trim: 0x1b1b1f, helmet: 0xe9e9ee, pants: 0x2b2f36, skin: 0xc68c5a };

const mix = (a, b, t) => a + (b - a) * t;
const fillDir = new THREE.Vector3();

// Shadow lookups are pushed out along the surface by about this many shadow-map
// texels, so a body does not shadow itself in speckles and bands.
const NORMAL_BIAS = 1.0;

/**
 * Picture quality, cheapest first. The game picks a starting tier from the
 * graphics chip and steps down while the frame rate stays low.
 *   ratio    cap on device pixels per CSS pixel
 *   shadow   sun shadow map size (0: no real shadows, just the soft blobs)
 *   post     camera pipeline: HDR, bloom, grade, vignette, grain
 *   pbr      full physically based turf (otherwise the matte, cheap kind)
 */
const TIERS = [
  { ratio: 0.6, shadow: 0, post: false, pbr: false },
  { ratio: 0.8, shadow: 0, post: false, pbr: false },
  { ratio: 1, shadow: 1024, post: false, pbr: true },
  { ratio: 1.5, shadow: 2048, post: true, pbr: true },
  { ratio: 2, shadow: 2048, post: true, pbr: true },
];
export const GRAPHICS = { low: 0, medium: 2, high: 4 };
const GFX_KEY = 'footballsuperstar.gfx.v1';

function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    return '';
  }
}

/** A first guess at what the machine can draw, from the name of its graphics chip. */
function guessTier(gpu) {
  const name = gpu.toLowerCase();
  const nav = globalThis.navigator || {};
  const mobile = /android|iphone|ipad|mobile/i.test(nav.userAgent || '') || (nav.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  let tier = 2;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(name)) tier = 0;
  else if (mobile) tier = 1;
  else if (/nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|apple m\d (pro|max|ultra)/.test(name)) tier = 4;
  else if (/apple m\d|apple gpu|intel\(r\) arc| arc /.test(name)) tier = 3;
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) tier = Math.min(tier, 2);
  return tier;
}

function loadGfx() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(GFX_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveGfx(value) {
  try {
    globalThis.localStorage?.setItem(GFX_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable: start from the guess next time */
  }
}

/** Everything Three.js: owns the renderer and mirrors the simulation each frame. */
export class SceneView {
  /**
   * `quality`: 'low', 'medium' or 'high' pins the picture quality; 'auto'
   * (or anything else) adapts. `lighting`: 'golden', 'night' or 'midday'.
   */
  constructor(canvas, { quality = 'auto', lighting = 'golden' } = {}) {
    this.canvas = canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.info.autoReset = false; // counted per frame, across every pass
    this.gpu = gpuName(renderer);
    const stored = loadGfx();
    this.autoTier = guessTier(this.gpu);
    if (stored && stored.gpu === this.gpu && Number.isInteger(stored.tier)) this.autoTier = Math.min(this.autoTier, stored.tier);
    const startTier = quality in GRAPHICS ? GRAPHICS[quality] : this.autoTier;
    this.post = Pipeline.supported(renderer) ? new Pipeline(renderer) : null;

    const scene = (this.scene = new THREE.Scene());
    this.sky = createSky();
    scene.add(this.sky.mesh);
    scene.fog = new THREE.Fog(0xcfdde6, 150, 700);
    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0x35603c, 0.4);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xffe7bf, 3));
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025; // set from the texel size (fitShadowBias)
    sun.shadow.radius = 2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 220;
    scene.add(sun, sun.target);
    this.fill = new THREE.DirectionalLight(0xffffff, 0);
    scene.add(this.fill, this.fill.target);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.shadowHalf = 0;

    const detail = startTier >= 2 ? 2 : 1;
    this.field = createField(detail >= 2 ? 32 : 16);
    scene.add(this.field.group);
    const stadium = (this.stadium = createStadium());
    scene.add(stadium.group);
    this.drawScore = stadium.setScore;
    this.scoreKey = '';
    this.fx = new Effects();
    scene.add(this.fx.group);
    this.fxState = { wr: { air: false, wait: 0, feet: null }, db: { air: false, wait: 0, feet: null } };

    this.userModel = new AthleteModel(USER_COLORS, 1, detail);
    this.rivalModel = new AthleteModel({ jersey: 0xc8102e, trim: 0xffffff, helmet: 0x222222, pants: 0x222222, skin: 0x6b4226 }, 2, detail);
    this.qbModel = new AthleteModel(QB_COLORS, 12, detail);
    this.ball = new BallModel();
    this.markers = new Markers();
    scene.add(this.userModel.group, this.rivalModel.group, this.qbModel.group, this.ball.group, this.ball.shadow, this.markers.group);
    // Left out of the reflection picture: the players, and the turf (it would
    // flood every white uniform with green; the sky's own ground stands in).
    this.dynamic = [this.userModel.group, this.rivalModel.group, this.qbModel.group, this.ball.group, this.ball.shadow, this.markers.group, this.fx.group, this.field.group];

    // Reflections and ambient light come from a picture of the stadium itself,
    // taken once from the middle of the field whenever the lighting changes.
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    this.cubeCamera = new THREE.CubeCamera(0.5, 900, this.cubeTarget);
    this.cubeCamera.position.set(0, 6, -14);
    scene.add(this.cubeCamera);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
    this.envDirty = true;

    this.rig = new CameraRig(1);
    this.focus = { x: 0, y: 0, z: 0, speed: 0 };
    this.tmp = new THREE.Vector3();
    // Where each player's chest and shoulders are, for the other man's hands.
    this.bodies = [0, 1].map(() => ({ chest: new THREE.Vector3(), sh: [new THREE.Vector3(), new THREE.Vector3()], legs: new THREE.Vector3() }));
    this.knee = new THREE.Vector3();
    this.ballPos = { x: 0, y: 0, z: 0 };
    this.throwClock = 0;
    this.time = 0;
    this.dirty = true;
    this.pinned = quality in GRAPHICS;
    this.slow = { time: 0, frames: 0, strikes: 0, warm: 2, probe: null };
    this.setLighting(lighting);
    this.setQuality(startTier);
  }

  /** 'low' | 'medium' | 'high' pin the picture quality; 'auto' lets it adapt. */
  setGraphics(mode) {
    this.pinned = mode in GRAPHICS;
    this.slow = { time: 0, frames: 0, strikes: 0, warm: 2, probe: null };
    this.setQuality(this.pinned ? GRAPHICS[mode] : this.autoTier);
  }

  setQuality(level) {
    this.quality = Math.max(0, Math.min(TIERS.length - 1, level));
    const t = TIERS[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.ratio));
    const sun = this.sun;
    const shadows = t.shadow > 0;
    if (shadows && sun.shadow.mapSize.x !== t.shadow) {
      sun.shadow.mapSize.set(t.shadow, t.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = shadows;
    this.fitShadowBias();
    this.fx.blobStrength = shadows ? 0.55 : 1;
    this.field.setQuality(t.pbr);
    this.usePost = t.post && this.post !== null;
    this.resize();
    this.dirty = true;
  }

  /** Golden hour, night or midday. */
  setLighting(name) {
    const L = LIGHTING[name] || LIGHTING.golden;
    this.lighting = LIGHTING[name] ? name : 'golden';
    this.preset = L;
    this.sunDir.set(...L.key.dir).normalize();
    this.sun.color.setHex(L.key.color);
    this.sun.intensity = L.key.intensity;
    if (L.fill) {
      this.fill.color.setHex(L.fill.color);
      this.fill.intensity = L.fill.intensity;
      this.fill.position.set(...L.fill.dir).multiplyScalar(80);
      this.fill.visible = true;
    } else {
      this.fill.visible = false;
    }
    // The sky half as the preset has it; the ground half is the light the
    // key and fill put on the turf, coming back up off it.
    this.hemi.intensity = 1;
    this.hemi.color.setHex(L.hemi.sky).multiplyScalar(L.hemi.intensity);
    let onTurf = L.key.intensity * Math.max(0, this.sunDir.y);
    if (L.fill) onTurf += L.fill.intensity * Math.max(0, fillDir.set(...L.fill.dir).normalize().y);
    const bounce = TURF_BOUNCE.albedo * onTurf;
    const [tr, tg, tb] = TURF_BOUNCE.tint;
    this.hemi.groundColor.setRGB(tr * bounce, tg * bounce, tb * bounce, THREE.LinearSRGBColorSpace);
    this.scene.environmentIntensity = L.env;
    this.scene.fog.color.setHex(L.fog.color);
    this.scene.fog.near = L.fog.near;
    this.scene.fog.far = L.fog.far;
    this.renderer.toneMappingExposure = L.exposure;
    this.sky.set(L.sky, L.sunDir || L.key.dir);
    this.stadium.setLights(L);
    this.post?.setGrade(L.grade);
    if (this.post) this.post.bloomStrength = name === 'night' ? 0.85 : 0.5;
    this.envDirty = true;
    this.dirty = true;
    this.lightOn(this.focus.x, this.focus.z);
  }

  /** Re-take the picture of the stadium that everything reflects. */
  captureEnvironment() {
    this.envDirty = false;
    for (const o of this.dynamic) o.userData.wasVisible = o.visible;
    for (const o of this.dynamic) o.visible = false;
    const castShadow = this.sun.castShadow;
    this.sun.castShadow = false;
    this.scene.environment = null;
    this.cubeCamera.update(this.renderer, this.scene);
    this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget);
    this.scene.environment = this.envTarget.texture;
    this.sun.castShadow = castShadow;
    for (const o of this.dynamic) o.visible = o.userData.wasVisible;
  }

  /**
   * Watch the frame rate and trade picture quality for it when it stays low.
   * If a step down does not help, the limit is somewhere else (the display,
   * or the processor), so the picture goes back up and stays there.
   */
  tune(real) {
    if (this.pinned || real <= 0) return;
    const w = this.slow;
    if (w.warm > 0) {
      w.warm -= real; // shaders are still compiling: not a fair sample
      return;
    }
    w.time += real;
    w.frames += 1;
    if (w.time < 1.5) return;
    const fps = w.frames / w.time;
    w.time = 0;
    w.frames = 0;
    if (w.probe) {
      const { from, before } = w.probe;
      w.probe = null;
      if (fps < before * 1.08) {
        this.setQuality(from);
        this.pinned = true;
        return;
      }
      saveGfx({ gpu: this.gpu, tier: this.quality });
      this.autoTier = this.quality;
    }
    const floor = this.quality >= 2 ? 45 : 28;
    w.strikes = fps < floor ? w.strikes + 1 : 0;
    if (w.strikes >= 2 && this.quality > 0) {
      w.strikes = 0;
      w.warm = 1;
      w.probe = { from: this.quality, before: fps };
      this.setQuality(this.quality - 1);
    }
  }

  setRival(rival) {
    this.rivalModel.setLook({ skin: 0x6b4226, ...rival.colors }, rival.number);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    const r = this.renderer.getPixelRatio();
    this.post?.setSize(Math.max(1, Math.floor(w * r)), Math.max(1, Math.floor(h * r)));
    this.dirty = true;
  }

  /**
   * Aim the shadows at the play: the sun's shadow box covers both players
   * (x, z and ox, oz), and no more, so its detail is spent where it shows.
   */
  lightOn(x, z, ox = x, oz = z) {
    const cx = (x + ox) / 2;
    const cz = (z + oz) / 2;
    const half = Math.min(28, Math.max(12, Math.ceil((Math.hypot(ox - x, oz - z) / 2 + 7) / 4) * 4));
    const cam = this.sun.shadow.camera;
    if (half !== this.shadowHalf) {
      this.shadowHalf = half;
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.updateProjectionMatrix();
      this.fitShadowBias();
    }
    const d = this.sunDir;
    this.sun.position.set(cx + d.x * 90, d.y * 90, cz + d.z * 90);
    this.sun.target.position.set(cx, 0, cz);
    if (this.fill.visible) this.fill.target.position.set(cx, 0, cz);
  }

  /** Size the shadow's normal offset to one texel of the shadow map as it is now. */
  fitShadowBias() {
    const size = this.sun.shadow.mapSize.x;
    if (!this.shadowHalf || !size) return;
    this.sun.shadow.normalBias = Math.max(0.02, (NORMAL_BIAS * 2 * this.shadowHalf) / size);
  }

  /** Repaint the stadium scoreboard when the score changes. */
  setScore(you, rival, name, target) {
    const key = `${you}|${rival}|${name}|${target}`;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    this.drawScore(you, rival, name, target);
  }

  /** Turf thrown up by cleats and bodies, and the soft shadow under each player. */
  groundEffects(dt, who, index, a, model, isUser) {
    const fx = this.fx;
    const st = this.fxState[who];
    const pelvis = model.rig.pelvis.position;
    fx.blob(index, pelvis.x, pelvis.z, Math.max(0, pelvis.y - (a.down ? 0.2 : 1.0)), a.down ? 1.7 : 1.25);
    st.wait = Math.max(0, st.wait - dt);
    const off = a.airborne || (a.down && a.y > 0.05);
    if (a.feetDown && a.feetDown !== st.feet && !a.airborne) {
      // Landed: turf thrown up where each foot came down (more of it when he dragged them in).
      st.feet = a.feetDown;
      for (const f of a.feetDown) fx.burst(f.x, f.z, a.dragged ? 9 : 5, a.vel.x, a.vel.z, a.dragged ? 0.9 : 0.6);
    } else if (st.air && !off && !a.down) {
      fx.burst(a.pos.x, a.pos.z, 10, a.vel.x, a.vel.z, 0.8); // landed on his feet
    }
    st.air = off;
    if (a.toeDrag > 0 && a.feetDown && st.wait <= 0) {
      // Toes dragging the turf.
      for (const f of a.feetDown) fx.burst(f.x, f.z, 3, a.vel.x * 0.5, a.vel.z * 0.5, 0.5);
      st.wait = 0.04;
    }
    if (model.impact > 2.2) {
      // A body hitting the turf.
      fx.burst(pelvis.x, pelvis.z, Math.min(40, Math.round(model.impact * 5)), a.vel.x, a.vel.z, 1.2);
      if (isUser) this.rig.shake(Math.min(0.22, model.impact * 0.02));
    }
    if (st.wait > 0) return;
    if (a.down && a.speed > 2.2 && a.y <= 0.05) {
      fx.burst(pelvis.x, pelvis.z, 5, a.vel.x, a.vel.z, 0.7); // sliding
      st.wait = 0.05;
    } else if (!a.down && !a.airborne && a.speed > 3) {
      // Cleats tearing at the turf on a hard cut or a stop.
      const acc = model.animator.acc;
      const lateral = Math.abs(acc.x * a.vel.z - acc.y * a.vel.x) / a.speed;
      const braking = -(acc.x * a.vel.x + acc.y * a.vel.z) / a.speed;
      if (lateral > 17 || braking > 17) {
        fx.burst(a.pos.x, a.pos.z, 5, -a.vel.x * 0.4, -a.vel.z * 0.4, 0.6);
        st.wait = 0.12;
      }
    }
  }

  /** New rep: everybody back on his feet, camera cuts. */
  cut() {
    this.rig.cut();
    for (const m of [this.userModel, this.rivalModel, this.qbModel]) m.reset();
    for (const st of Object.values(this.fxState)) {
      st.air = false;
      st.feet = null;
    }
  }

  /**
   * What the model needs to know about an athlete. `was` is where he was one
   * simulation step ago and `alpha` how far we are into the current step, so
   * motion on screen is smooth however the frames fall against the sim clock.
   */
  athleteState(a, was, alpha, extra) {
    const facing = was ? was.facing + angleDelta(was.facing, a.facing) * alpha : a.facing;
    return {
      x: was ? mix(was.x, a.pos.x, alpha) : a.pos.x,
      y: was ? mix(was.y, a.y, alpha) : a.y,
      z: was ? mix(was.z, a.pos.z, alpha) : a.pos.z,
      facing,
      vx: a.vel.x,
      vz: a.vel.z,
      vy: a.vy,
      speed: a.speed,
      backpedal: a.backpedal,
      airborne: a.airborne,
      attempting: a.attempting,
      // Legs loading for a jump, how far through that he is, and how fast he will leave the turf.
      loading: a.gather > 0,
      load: a.gather > 0 ? 1 - a.gather / JUMP.load : 0,
      jumpSpeed: Math.sqrt(2 * GRAVITY * a.params.jumpHeight),
      landing: a.landing / JUMP.landing,
      diving: a.diving,
      down: a.down,
      rise: a.rise,
      fall: a.fall,
      stumble: a.stumbling,
      shove: a.shoveDir,
      hands: a.hands,
      calling: a.callTimer > 0,
      hasBall: a.hasBall,
      securing: a.securing,
      mood: a.mood,
      catchType: a.catchInfo ? a.catchInfo.type : null,
      // Feet by the line: reaching for the turf, where they came down, and the toes dragging in.
      toeReach: a.toeReach,
      feetDown: a.feetDown,
      toeDrag: a.toeDrag > 0 ? a.toeDrag / TOE.drag : 0,
      diveKind: a.diving ? a.diveKind : null,
      aggressive: a.aggressive,
      throwing: null,
      ...extra,
    };
  }

  /** Where a model's chest and shoulders were last frame. */
  bodyOf(model, out) {
    model.point(P.CHEST, out.chest);
    model.point(P.SH_L, out.sh[0]);
    model.point(P.SH_R, out.sh[1]);
    model.point(P.KN_L, out.legs);
    out.legs.add(model.point(P.KN_R, this.knee)).multiplyScalar(0.5);
    return out;
  }

  /**
   * Mirror a live rep. `userRole` is 'wr' or 'db'. `was` holds the previous
   * simulation step's positions ({ wr, db, ball, qb }) and `alpha` (0..1) is
   * how far between that step and the current one this frame falls.
   */
  syncRep(dt, rep, userRole, cameraMode, was = null, alpha = 1) {
    const pre = rep.phase === 'presnap';
    for (const m of [this.rivalModel, this.qbModel]) m.group.visible = true;
    this.ball.group.visible = true;
    this.markers.group.visible = true;

    const sim = rep.ball;
    const bp = this.ballPos;
    bp.x = was ? mix(was.ball.x, sim.pos.x, alpha) : sim.pos.x;
    bp.y = was ? mix(was.ball.y, sim.pos.y, alpha) : sim.pos.y;
    bp.z = was ? mix(was.ball.z, sim.pos.z, alpha) : sim.pos.z;
    const live = sim.state === 'flight';
    const ballInfo = { x: bp.x, y: bp.y, z: bp.z, live };

    const states = {};
    const modelOf = (role) => (role === userRole ? this.userModel : this.rivalModel);
    for (const role of ['wr', 'db']) {
      const a = rep[role];
      const other = rep[role === 'wr' ? 'db' : 'wr'];
      const foe = this.bodyOf(modelOf(role === 'wr' ? 'db' : 'wr'), this.bodies[role === 'wr' ? 0 : 1]);
      let lookAt = null;
      if (a.toeDrag > 0 && a.feetDown) {
        // Eyes on his feet: are they in?
        lookAt = { x: (a.feetDown[0].x + a.feetDown[1].x) / 2, y: 0.05, z: (a.feetDown[0].z + a.feetDown[1].z) / 2 };
      } else if (live || sim.state === 'loose') lookAt = bp;
      else if (role === 'db' && rep.phase !== 'done') lookAt = { x: other.pos.x, y: 1.7, z: other.pos.z };
      else if (role === 'wr' && pre) lookAt = { x: a.pos.x, y: 1.6, z: a.pos.z - 8 };
      states[role] = this.athleteState(a, was ? was[role] : null, alpha, {
        crouch: pre ? role : null,
        ball: ballInfo,
        lookAt,
        foe,
        catcher: role === 'wr',
        // A man on the turf is still in the way, low down: a pile-up does not sink into itself.
        obstacle: other.down ? { x: other.pos.x, z: other.pos.z, radius: 0.32, top: 0.32 } : { x: other.pos.x, z: other.pos.z, radius: BODY_RADIUS * 0.85, top: 1.85 },
      });
    }
    const userState = states[userRole];
    const rivalState = states[userRole === 'wr' ? 'db' : 'wr'];
    this.userModel.update(dt, userState);
    this.rivalModel.update(dt, rivalState);

    const qb = rep.qb;
    if (qb.state === 'thrown') this.throwClock += dt;
    else this.throwClock = 0;
    const dropping = qb.state === 'drop' && rep.t < QB.dropTime;
    const hand = qb.hand;
    this.qbModel.update(dt, {
      x: qb.pos.x,
      y: 0,
      z: was ? mix(was.qb.z, qb.pos.z, alpha) : qb.pos.z,
      facing: qb.facing,
      vx: 0,
      vz: dropping ? (QB.dropZ - QB.z) / QB.dropTime : 0,
      backpedal: dropping,
      crouch: pre ? 'qb' : null,
      hasBall: sim.state === 'held',
      twoHands: qb.state !== 'windup',
      throwing: qb.state === 'windup' ? qb.windupT / QB.windup : qb.state === 'thrown' && this.throwClock < 0.5 ? 1 : null,
      release: hand,
      lookAt: { x: rep.wr.pos.x, y: 1.7, z: rep.wr.pos.z },
    });

    // A ball in somebody's hands is drawn in those hands.
    let held = null;
    if (sim.state === 'held') held = this.qbModel;
    else if (sim.state === 'caught' && sim.holder) held = sim.holder === rep[userRole] ? this.userModel : this.rivalModel;
    this.ball.update(dt, sim, bp, held);

    const user = rep[userRole];
    const rivalRole = userRole === 'wr' ? 'db' : 'wr';
    const rival = rep[rivalRole];
    this.groundEffects(dt, userRole, 0, user, this.userModel, true);
    this.groundEffects(dt, rivalRole, 1, rival, this.rivalModel, false);
    this.fx.blob(2, qb.pos.x, this.qbModel.rig.pelvis.position.z, 0);
    this.fx.update(dt);
    this.markers.update(dt, { user: userState, rival: rivalState, ball: sim });
    this.focus.x = userState.x;
    this.focus.y = userState.y;
    this.focus.z = userState.z;
    this.focus.speed = user.speed;
    this.lightOn(user.pos.x, user.pos.z, rival.pos.x, rival.pos.z);
    this.rig.update(dt, {
      focus: this.focus,
      other: userRole === 'db' && rep.phase !== 'done' ? rival.pos : null,
      ball: sim,
      mode: cameraMode,
      role: userRole,
    });
  }

  /** Behind the menus: just your player on the field, camera drifting around. */
  syncMenu(dt) {
    this.rivalModel.group.visible = false;
    this.qbModel.group.visible = false;
    this.ball.group.visible = false;
    this.ball.shadow.visible = false;
    this.markers.group.visible = false;
    this.userModel.update(dt, { x: 0, y: 0, z: 0, facing: this.rig.orbit + 0.6, vx: 0, vz: 0, speed: 0 });
    this.fx.hideBlobs();
    this.fx.blob(0, 0, 0, 0);
    this.fx.update(dt);
    this.lightOn(0, 0);
    this.rig.updateMenu(dt);
  }

  /** Screen position (0..1) of a world point, and whether it is in view. */
  project(pos) {
    const v = this.tmp.set(pos.x, pos.y, pos.z).project(this.rig.camera);
    const behind = v.z > 1;
    let x = v.x;
    let y = v.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const visible = !behind && Math.abs(x) < 0.96 && Math.abs(y) < 0.94;
    return { x: (x + 1) / 2, y: (1 - y) / 2, visible, behind };
  }

  /** Draw the frame. `dt` drives the drifting clouds and the film grain. */
  render(dt = 0) {
    this.renderer.info.reset();
    if (this.envDirty) this.captureEnvironment();
    this.time += dt;
    this.sky.uniforms.uTime.value = this.time;
    if (this.usePost) this.post.render(this.scene, this.rig.camera, dt);
    else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.rig.camera);
    }
    this.dirty = false;
  }
}
