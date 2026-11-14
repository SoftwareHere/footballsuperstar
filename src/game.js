import { SIM_DT, REP, CAMERA_MODES } from './config.js';
import { RNG } from './core/rng.js';
import { Input } from './core/input.js';
import { Match } from './sim/match.js';
import { ReceiverAI } from './sim/receiverAI.js';
import { DefenderAI } from './sim/defenderAI.js';
import { blankIntent } from './sim/aiCommon.js';
import { rivalByTier } from './progression/opponents.js';
import { recordMatch, spendPoint } from './progression/progression.js';
import { loadCareer, saveCareer, resetCareer } from './progression/save.js';
import { SceneView } from './render/scene.js';
import { Sfx } from './audio/sfx.js';
import { UI } from './ui/ui.js';

/** Turns the keyboard into an athlete's intent. Same keys in both roles. */
class UserController {
  constructor(input, role) {
    this.input = input;
    this.role = role;
    this.intent = blankIntent();
  }

  update(rep) {
    const i = this.input;
    const out = this.intent;
    out.x = (i.held('right') ? 1 : 0) - (i.held('left') ? 1 : 0);
    out.z = (i.held('down') ? 1 : 0) - (i.held('up') ? 1 : 0); // up-screen is downfield (-z)
    out.sprint = i.held('sprint');
    out.jump = false;
    out.snap = false;
    out.call = false;
    out.juke = 0;
    if (rep.phase === 'presnap') {
      out.snap = i.take('action');
      i.take('call');
      i.take('jukeL');
      i.take('jukeR');
    } else {
      out.jump = i.take('action');
      out.juke = i.take('jukeL') ? -1 : i.take('jukeR') ? 1 : 0;
      out.call = this.role === 'wr' && i.take('call');
    }
    return out;
  }
}

const REASON_TEXT = {
  catch: 'Caught it',
  drop: 'Dropped',
  breakup: 'Broken up at the catch',
  swat: 'Swatted away',
  int: 'Picked off',
  ground: 'Nobody got there',
  oob: 'Caught out of bounds',
  hit: 'Jarred loose by the hit',
};

// How the catch was made, when it was something worth shouting about.
const CATCH_TITLES = {
  dive: 'DIVING CATCH!',
  oneHand: 'ONE-HANDED!',
  overShoulder: 'OVER THE SHOULDER!',
  juggle: 'JUGGLING CATCH!',
  low: 'SHOESTRING CATCH!',
};

const CAMERA_NAMES = { follow: 'FOLLOW CAM', broadcast: 'BROADCAST CAM', lock: 'CINEMATIC CAM' };

const TENDENCY_TEXT = {
  in: 'your inside breaks',
  out: 'your outside breaks',
  deep: 'the deep ball',
  short: 'your short stuff',
};

export class Game {
  constructor({ canvas, uiRoot }) {
    this.career = loadCareer();
    const query = new URLSearchParams(window.location.search);
    this.view = new SceneView(canvas, query.get('quality') || 'auto');
    this.input = new Input(window);
    this.sfx = new Sfx();
    this.sfx.setMuted(this.career.settings.muted);
    this.state = 'menu'; // 'menu' | 'match' | 'postgame'
    this.paused = false;
    this.timeScale = 1;
    this.slowmo = 0; // seconds of slow motion left
    this.cinematic = false;
    this.acc = 0;
    this.match = null;
    this.rep = null;
    this.role = 'wr';
    this.was = { wr: { x: 0, y: 0, z: 0, facing: 0 }, db: { x: 0, y: 0, z: 0, facing: 0 }, ball: { x: 0, y: 0, z: 0 }, qb: { z: 0 } };
    this.seed = Number(query.get('seed')) || null;

    this.ui = new UI(uiRoot, {
      career: () => this.career,
      start: (tier, target) => this.startMatch(tier, target),
      spend: (stat) => this.spend(stat),
      reset: () => this.reset(),
      resume: () => this.setPaused(false),
      quit: () => this.toMenu(),
      sound: (name) => this.sfx.play(name),
      seenHowTo: () => {
        if (!this.career.seenHowTo) {
          this.career.seenHowTo = true;
          saveCareer(this.career);
        }
      },
    });

    this.input.onCommand = (name) => this.command(name);
    window.addEventListener('resize', () => this.view.resize());
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'match' && !this.paused) this.setPaused(true);
    });

    if (this.career.seenHowTo) this.ui.showMenu(this.career);
    else this.ui.showHowTo('menu');

    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- commands

  command(name) {
    if (name === 'mute') {
      const muted = !this.career.settings.muted;
      this.career.settings.muted = muted;
      this.sfx.setMuted(muted);
      saveCareer(this.career);
      if (this.state === 'match' && !this.paused) this.ui.banner(muted ? 'SOUND OFF' : 'SOUND ON', '', 'small', 0.9);
      return true;
    }
    if (this.state !== 'match') return false;
    if (name === 'pause') {
      // While a sub-screen of the pause menu is open, Escape means "back".
      if (this.paused && this.ui.screen !== 'pause') return false;
      this.setPaused(!this.paused);
      return true;
    }
    if (name === 'camera' && !this.paused) {
      const modes = CAMERA_MODES;
      const next = modes[(modes.indexOf(this.career.settings.camera) + 1) % modes.length];
      this.career.settings.camera = next;
      saveCareer(this.career);
      this.ui.banner(CAMERA_NAMES[next], '', 'small', 0.9);
      return true;
    }
    return false;
  }

  setPaused(paused) {
    if (this.state !== 'match') return;
    this.paused = paused;
    this.input.capture = !paused;
    this.input.reset();
    if (paused) this.ui.showPause();
    else this.ui.hideScreens();
  }

  spend(stat) {
    if (!spendPoint(this.career, stat)) return false;
    saveCareer(this.career);
    return true;
  }

  reset() {
    this.career = resetCareer();
    this.career.seenHowTo = true;
    saveCareer(this.career);
    this.sfx.setMuted(false);
  }

  // ---------------------------------------------------------------- match

  startMatch(tier, target) {
    const rival = (this.rival = rivalByTier(tier));
    this.tier = tier;
    this.career.settings.tier = tier;
    this.career.settings.target = target;
    saveCareer(this.career);

    const rng = (this.rng = new RNG(this.seed ?? undefined));
    this.match = new Match({
      target,
      rng,
      user: {
        ratings: { ...this.career.stats },
        makeController: (role) => new UserController(this.input, role),
      },
      rival: {
        ratings: rival.ratings,
        makeController: (role, match) =>
          role === 'wr' ? new ReceiverAI({ rng, tier }) : new DefenderAI({ rng, ...match.tendency('user') }),
      },
    });

    this.view.setRival(rival);
    this.ui.hideScreens();
    this.ui.showHud(true);
    this.state = 'match';
    this.paused = false;
    this.input.capture = true;
    this.input.reset();
    this.sfx.unlock();
    this.sfx.setCrowd(true);
    this.beginRep(true);
  }

  beginRep(first = false) {
    const match = this.match;
    this.rep = match.startRep();
    this.role = match.userRole;
    this.recorded = false;
    this.heardCatch = false;
    this.slowmo = 0;
    this.acc = 0;
    this.view.cut();
    this.snapshot();
    this.input.clearPresses();

    const name = this.rival.name.split(' ')[1].toUpperCase();
    let title = 'POSSESSION FLIPS';
    if (first) title = match.tossWinner === 'user' ? 'YOU WON THE TOSS' : `${name} WON THE TOSS`;
    const sub =
      this.role === 'wr'
        ? 'You have the ball. Run anything, then call for it.'
        : `${name} has the ball. Stay with him and play the pass.`;
    this.ui.banner(title, sub, this.role === 'wr' ? 'warn' : '', 2.4);

    const expect = this.role === 'wr' ? this.rep.dbCtl.expect : null;
    this.ui.tip(expect ? `Scouting report: ${this.rival.name} is sitting on ${TENDENCY_TEXT[expect]}. Show him something else.` : '');
  }

  handleEvent(e) {
    const ui = this.ui;
    const offense = this.role === 'wr';
    switch (e.type) {
      case 'snap':
        this.sfx.play('hut');
        ui.banner('HUT!', '', 'small', 0.55);
        ui.tip('');
        break;
      case 'call':
        this.sfx.play('call');
        ui.banner(offense ? 'BALL!' : "HE'S CALLING FOR IT", '', 'small', 0.7);
        break;
      case 'windup':
        if (e.forced) {
          this.sfx.play('pressure');
          ui.banner('PRESSURE!', 'Out of time. The QB has to throw it.', 'warn', 1.1);
        }
        break;
      case 'throw':
        this.sfx.play('throw');
        break;
      case 'juke':
        this.sfx.play('juke');
        break;
      case 'jump':
        this.sfx.play('jump');
        break;
      case 'dive':
        this.sfx.play('dive');
        break;
      case 'catch':
        // Ball in the hands. It is not a completion until he finishes the catch.
        this.sfx.play('catch');
        this.heardCatch = true;
        break;
      case 'tip':
        this.sfx.play('tip');
        ui.banner('TIPPED!', 'Still live. Go get it.', 'warn', 0.9);
        break;
      case 'contact':
        if (e.power > 3) this.sfx.play('bump');
        break;
      case 'hands':
        this.sfx.play('hands'); // pads and palms: the fight at the line
        break;
      case 'punch':
        // The jam landing on the chest plate. You feel your own.
        this.sfx.play('punch');
        if (e.power > 0.6) this.view.rig.shake(Math.min(0.12, 0.05 * e.power));
        break;
      case 'shed':
        this.sfx.play('shed');
        break;
      case 'stumble':
        this.sfx.play('stumble');
        break;
      case 'hit':
        this.sfx.play('hit');
        this.view.rig.shake(Math.min(0.3, 0.05 + e.power * 0.03));
        if (e.down) this.slowmo = 0.3; // the hit that put him on the turf
        break;
      case 'fall':
        this.sfx.play('bodyfall');
        break;
      default:
    }
  }

  showResult(entry) {
    const mine = entry.scorer === 'user';
    const offense = entry.userRole === 'wr';
    let title;
    if (entry.complete) {
      if (!offense) title = 'CAUGHT';
      else if (entry.throughContact) title = 'HELD ON THROUGH THE HIT!';
      else if (entry.toeTap) title = 'TOE-TAP!';
      else title = CATCH_TITLES[entry.catchType] || 'COMPLETE!';
    } else if (entry.reason === 'int') title = entry.tips ? 'PICKED OFF THE TIP!' : 'INTERCEPTED!';
    else if (entry.reason === 'hit') title = 'JARRED LOOSE!';
    else if (entry.reason === 'swat' || entry.reason === 'breakup') title = offense ? 'BROKEN UP' : 'PASS BROKEN UP!';
    else title = 'INCOMPLETE';
    const who = mine ? 'YOU' : this.rival.name.split(' ')[1].toUpperCase();
    let detail;
    if (entry.complete) detail = `${Math.max(0, Math.round(entry.depth))} yards downfield`;
    else if (entry.lostToGround) detail = 'Lost it going to the ground';
    else if (entry.tips && entry.reason !== 'int') detail = 'Tipped, and nobody came down with it';
    else detail = REASON_TEXT[entry.reason];
    this.ui.banner(title, `${detail} · +1 ${who}`, mine ? 'good' : 'bad', REP.resultLinger + 0.4);
    // The grab itself was already heard when the ball hit his hands.
    if (!entry.complete) this.sfx.play('thud');
    else if (!this.heardCatch) this.sfx.play('catch');
    // A beat of slow motion for the spectacular ones.
    if (entry.complete && (entry.catchType === 'dive' || entry.catchType === 'oneHand' || entry.throughContact)) this.slowmo = 0.35;
    this.sfx.play(mine ? 'cheer' : 'groan');
    this.sfx.play('whistle');
  }

  /** Remember where everything is, so the picture can be smoothed between sim steps. */
  snapshot() {
    const rep = this.rep;
    const was = this.was;
    for (const who of ['wr', 'db']) {
      const a = rep[who];
      const w = was[who];
      w.x = a.pos.x;
      w.y = a.y;
      w.z = a.pos.z;
      w.facing = a.facing;
    }
    was.ball.x = rep.ball.pos.x;
    was.ball.y = rep.ball.pos.y;
    was.ball.z = rep.ball.pos.z;
    was.qb.z = rep.qb.pos.z;
  }

  stepSim() {
    const rep = this.rep;
    this.snapshot();
    rep.step(SIM_DT);
    for (const e of rep.events) this.handleEvent(e);
    rep.events.length = 0;

    if (rep.phase !== 'done' || this.state !== 'match') return;
    if (!this.recorded) {
      this.recorded = true;
      this.input.clearPresses();
      this.showResult(this.match.recordResult());
    }
    const skip = rep.tDone >= REP.minLinger && this.input.take('action');
    if (rep.tDone >= REP.resultLinger || skip) {
      if (this.match.winner) this.endMatch();
      else this.beginRep();
    }
  }

  endMatch() {
    const match = this.match;
    const won = match.winner === 'user';
    const reward = recordMatch(this.career, {
      won,
      userPoints: match.score.user,
      target: match.target,
      tier: this.tier,
    });
    saveCareer(this.career);
    this.state = 'postgame';
    this.input.capture = false;
    this.input.reset();
    this.sfx.setCrowd(false);
    this.sfx.play(won ? 'win' : 'lose');
    if (reward.levels) setTimeout(() => this.sfx.play('level'), 900);
    this.ui.showHud(false);
    this.ui.sel.tier = this.tier;
    this.ui.sel.target = match.target;
    this.ui.showPostgame({
      won,
      score: { ...match.score },
      target: match.target,
      rival: this.rival,
      tier: this.tier,
      reward,
      career: this.career,
      summary: match.summary(),
    });
  }

  toMenu() {
    this.state = 'menu';
    this.paused = false;
    this.match = null;
    this.rep = null;
    this.input.capture = false;
    this.input.reset();
    this.sfx.setCrowd(false);
    this.ui.showHud(false);
    this.view.cut();
    this.ui.showMenu(this.career);
  }

  // ----------------------------------------------------------------- loop

  frame(now) {
    const elapsed = Math.max(0, (now - this.last) / 1000);
    const real = Math.min(0.1, elapsed);
    this.last = now;
    const running = (this.state === 'match' && !this.paused) || this.state === 'postgame';

    // A short slow-motion beat on big hits and spectacular catches.
    let scale = this.timeScale;
    if (this.slowmo > 0 && !this.paused) {
      this.slowmo -= real;
      scale *= 0.35;
    }

    if (running && this.rep) {
      this.acc += real * scale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < Math.max(1, 60 * scale)) {
        this.stepSim();
        this.acc -= SIM_DT;
        steps += 1;
        if (!this.rep) break;
      }
      if (this.acc > SIM_DT * 4) this.acc = 0;
    }

    const viewDt = this.paused ? 0 : real * Math.min(scale, 2);
    if (this.rep && this.state !== 'menu') {
      const alpha = running ? Math.min(1, this.acc / SIM_DT) : 1;
      this.view.syncRep(viewDt, this.rep, this.role, this.career.settings.camera, this.was, alpha);
      if (this.state === 'match') this.updateHud();
    } else {
      this.view.syncMenu(real);
    }
    // The cinematic camera gets a darkened edge to the picture.
    const cinematic = this.state === 'match' && this.career.settings.camera === 'lock';
    if (cinematic !== this.cinematic) {
      this.cinematic = cinematic;
      this.ui.root.classList.toggle('cinematic', cinematic);
    }
    this.ui.tick(real);
    this.view.tune(Math.min(elapsed, 1)); // the true frame time, not the capped one
    this.view.render();
    requestAnimationFrame(this.frame);
  }

  updateHud() {
    const rep = this.rep;
    const me = this.role === 'wr' ? rep.wr : rep.db;
    let arrow = null;
    if (rep.phase === 'flight' && rep.ball.state === 'flight') {
      const p = this.view.project(rep.ball.pos);
      if (!p.visible) arrow = p;
    }
    this.view.setScore(this.match.score.user, this.match.score.rival, this.rival.name.split(' ')[1], this.match.target);
    this.ui.updateHud({
      score: this.match.score,
      target: this.match.target,
      rivalName: this.rival.name.split(' ')[1],
      role: this.role,
      phase: rep.phase,
      called: rep.called,
      clock: rep.clock,
      stamina: me.stamina,
      exhausted: me.exhausted,
      arrow,
    });
  }
}
