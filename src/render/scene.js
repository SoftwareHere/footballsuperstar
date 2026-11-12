import * as THREE from 'three';
import { QB, BODY_RADIUS } from '../config.js';
import { angleDelta } from '../core/vec.js';
import { createField } from './field.js';
import { createSkyTexture, SUN_DIR } from './sky.js';
import { createStadium } from './stadium.js';
import { Effects } from './effects.js';
import { AthleteModel } from './athleteModel.js';
import { BallModel } from './ballModel.js';
import { Markers } from './markers.js';
import { CameraRig } from './cameraRig.js';

export const USER_COLORS = { jersey: 0x1e6bff, trim: 0xffffff, helmet: 0xf4f6fa, pants: 0xf4f6fa };
const QB_COLORS = { jersey: 0xff7a1a, trim: 0x1b1b1f, helmet: 0xe9e9ee, pants: 0x2b2f36, skin: 0xc68c5a };

const mix = (a, b, t) => a + (b - a) * t;

// Picture quality, best last: [pixel ratio cap, shadows, floodlight glare].
// The game starts at the top and steps down if the machine cannot hold a
// playable frame rate.
const QUALITY = [
  [0.5, false, false],
  [0.75, false, false],
  [1, true, true],
  [2, true, true],
];

/** Everything Three.js: owns the renderer and mirrors the simulation each frame. */
export class SceneView {
  /** `quality`: 'high' or 'low' pins the picture quality; anything else adapts. */
  constructor(canvas, quality = 'auto') {
    this.canvas = canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = (this.scene = new THREE.Scene());
    // One painted sky does three jobs: backdrop, ambient light, and what helmets reflect.
    const sky = createSkyTexture();
    scene.background = sky;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(sky).texture;
    scene.environmentIntensity = 0.75;
    pmrem.dispose();
    scene.fog = new THREE.Fog(0xcfdde6, 130, 460);

    // Late-afternoon sun, low enough to throw long shadows across the turf.
    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x35603c, 0.85));
    const sun = (this.sun = new THREE.DirectionalLight(0xffe7bf, 3.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -24;
    sc.right = sc.top = 24;
    sc.near = 1;
    sc.far = 150;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    scene.add(createField());
    const stadium = createStadium();
    scene.add(stadium.group);
    this.drawScore = stadium.setScore;
    this.flares = stadium.flares;
    this.scoreKey = '';
    this.fx = new Effects();
    scene.add(this.fx.group);
    this.fxState = { wr: { air: false, wait: 0 }, db: { air: false, wait: 0 } };

    this.userModel = new AthleteModel(USER_COLORS, 1);
    this.rivalModel = new AthleteModel({ jersey: 0xc8102e, trim: 0xffffff, helmet: 0x222222, pants: 0x222222, skin: 0x6b4226 }, 2);
    this.qbModel = new AthleteModel(QB_COLORS, 12);
    this.ball = new BallModel();
    this.markers = new Markers();
    scene.add(this.userModel.group, this.rivalModel.group, this.qbModel.group, this.ball.group, this.ball.shadow, this.markers.group);

    this.rig = new CameraRig(1);
    this.focus = { x: 0, y: 0, z: 0, speed: 0 };
    this.tmp = new THREE.Vector3();
    this.ballPos = { x: 0, y: 0, z: 0 };
    this.throwClock = 0;
    this.pinned = quality === 'high' || quality === 'low';
    this.slow = { time: 0, frames: 0, strikes: 0, warm: 2 };
    this.setQuality(quality === 'low' ? 0 : QUALITY.length - 1);
  }

  setQuality(level) {
    this.quality = Math.max(0, Math.min(QUALITY.length - 1, level));
    const [ratio, shadows, glare] = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    this.sun.castShadow = shadows;
    for (const flare of this.flares) flare.visible = glare;
    this.resize();
  }

  /**
   * Watch the frame rate and trade picture quality for it when it stays low:
   * first resolution, then shadows. It only ever steps down, so the picture
   * does not flicker between settings.
   */
  tune(real) {
    if (this.pinned || this.quality === 0 || real <= 0) return;
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
    w.strikes = fps < 26 ? w.strikes + 1 : 0;
    if (w.strikes >= 2) {
      w.strikes = 0;
      w.warm = 1;
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
  }

  lightOn(x, z) {
    this.sun.position.set(x + SUN_DIR.x * 70, SUN_DIR.y * 70, z + SUN_DIR.z * 70);
    this.sun.target.position.set(x, 0, z);
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
    if (st.air && !off && !a.down) fx.burst(a.pos.x, a.pos.z, 10, a.vel.x, a.vel.z, 0.8); // landed on his feet
    st.air = off;
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
    for (const st of Object.values(this.fxState)) st.air = false;
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
      speed: a.speed,
      backpedal: a.backpedal,
      airborne: a.airborne,
      attempting: a.attempting,
      diving: a.diving,
      down: a.down,
      rise: a.rise,
      fall: a.fall,
      calling: a.callTimer > 0,
      hasBall: a.hasBall,
      securing: a.securing,
      mood: a.mood,
      catchType: a.catchInfo ? a.catchInfo.type : null,
      throwing: null,
      ...extra,
    };
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
    for (const role of ['wr', 'db']) {
      const a = rep[role];
      const other = rep[role === 'wr' ? 'db' : 'wr'];
      let lookAt = null;
      if (live || sim.state === 'loose') lookAt = bp;
      else if (role === 'db' && rep.phase !== 'done') lookAt = { x: other.pos.x, y: 1.7, z: other.pos.z };
      else if (role === 'wr' && pre) lookAt = { x: a.pos.x, y: 1.6, z: a.pos.z - 8 };
      states[role] = this.athleteState(a, was ? was[role] : null, alpha, {
        crouch: pre ? role : null,
        ball: ballInfo,
        lookAt,
        catcher: role === 'wr',
        obstacle: other.down ? null : { x: other.pos.x, z: other.pos.z, radius: BODY_RADIUS * 0.85, top: 1.85 },
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
    this.lightOn(user.pos.x, user.pos.z);
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

  render() {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
