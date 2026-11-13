import { GAME_LENGTHS, QB } from '../config.js';
import { STAT_KEYS, STAT_INFO, STAT_MAX, overall, fortyTime, deriveParams } from '../sim/ratings.js';
import { RIVALS } from '../progression/opponents.js';
import { xpToNext, canUpgrade, tierMultiplier, MAX_LEVEL, POINTS_PER_LEVEL } from '../progression/progression.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const key = (k) => `<kbd>${k}</kbd>`;

const HINTS = {
  'wr:presnap': `${key('Space')} Snap the ball`,
  'wr:live': `${key('WASD')} Run ${key('Shift')} Sprint ${key('Q')}${key('E')} Juke ${key('Enter')} Call for the ball`,
  'wr:called': `${key('WASD')} Keep running: he leads you ${key('Shift')} Sprint`,
  'wr:flight': `Get to the ring ${key('Space')} Jump, or dive if it is out of reach`,
  'db:presnap': `${key('WASD')} Set your cushion ${key('Space')} Ready`,
  'db:live': `${key('WASD')} Stay with him ${key('Shift')} Sprint ${key('Q')}${key('E')} Break step`,
  'db:flight': `Get to the ring ${key('Space')} Jump or dive to swat, or run through him`,
  done: `${key('Space')} Next rep`,
};

const CONTROLS = [
  ['Move', `${key('W')}${key('A')}${key('S')}${key('D')} or arrow keys`],
  ['Sprint (uses your sprint tank)', `hold ${key('Shift')}`],
  ['Play the ball: jump, or dive when it is out of reach', key('Space')],
  ['Juke / quick break step left, right', `${key('Q')} ${key('E')}`],
  ['Call for the ball (offense), with your right hand', key('Enter')],
  ['Snap / ready / next rep', key('Space')],
  ['Camera: follow, broadcast or cinematic', key('C')],
  ['Pause, mute', `${key('Esc')} ${key('M')}`],
];

/** All DOM: menus, HUD, banners. The game calls in; clicks call back out. */
export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.screen = null;
    this.backTo = null;
    this.sel = { tier: 1, target: 5 };
    root.innerHTML = `
      <div class="hud" hidden>
        <div class="scorebar">
          <div class="side you"><span class="poss" data-h="possYou"></span><span class="name">YOU</span><span class="pts" data-h="you">0</span></div>
          <div class="mid"><div class="to" data-h="to"></div><div class="role" data-h="role"></div></div>
          <div class="side them"><span class="pts" data-h="rival">0</span><span class="name" data-h="rivalName"></span><span class="poss" data-h="possRival"></span></div>
        </div>
        <div class="clock" data-h="clock"><div class="clock-track"><i data-h="clockFill"></i></div><span data-h="clockText">4.0</span><small>THROW CLOCK</small></div>
        <div class="banner" data-h="banner"><b></b><span></span></div>
        <div class="tip" data-h="tip" hidden></div>
        <div class="stamina"><label>SPRINT</label><div class="bar"><i data-h="stam"></i></div></div>
        <div class="hints" data-h="hints"></div>
        <div class="ballarrow" data-h="arrow" hidden><i></i><span>BALL</span></div>
      </div>
      <div class="screen" hidden></div>`;
    this.hud = root.querySelector('.hud');
    this.screenEl = root.querySelector('.screen');
    this.h = {};
    for (const el of root.querySelectorAll('[data-h]')) this.h[el.dataset.h] = el;
    this.bannerTimer = 0;
    this.lastHint = '';

    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el && !el.disabled) this.act(el.dataset.action, el.dataset);
    });
    window.addEventListener('keydown', (e) => this.keydown(e));
  }

  get open() {
    return this.screen !== null;
  }

  // ---------------------------------------------------------------- screens

  show(name, html) {
    this.screen = name;
    this.screenEl.hidden = false;
    this.screenEl.className = `screen screen-${name}`;
    this.screenEl.innerHTML = html;
    const first = this.screenEl.querySelector('[data-autofocus]') || this.screenEl.querySelector('button:not(:disabled)');
    first?.focus({ preventScroll: true });
  }

  hideScreens() {
    this.screen = null;
    this.screenEl.hidden = true;
    this.screenEl.innerHTML = '';
  }

  keydown(e) {
    // A key the game already handled (Esc to pause/resume) is not also a menu key.
    if (!this.open || e.defaultPrevented) return;
    const buttons = [...this.screenEl.querySelectorAll('button:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement);
    const move = (d) => {
      e.preventDefault();
      const n = buttons.length;
      if (n) buttons[i < 0 ? 0 : (i + d + n) % n].focus({ preventScroll: true });
    };
    switch (e.code) {
      case 'ArrowDown':
      case 'ArrowRight':
      case 'KeyS':
      case 'KeyD':
        return move(1);
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'KeyW':
      case 'KeyA':
        return move(-1);
      case 'Escape': {
        const back = this.screenEl.querySelector('[data-action="back"], [data-action="resume"]');
        if (back) {
          e.preventDefault();
          back.click();
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  act(action, data) {
    const h = this.handlers;
    h.sound?.('click');
    const career = h.career();
    switch (action) {
      case 'setup':
        return this.showSetup(career);
      case 'upgrades':
        return this.showUpgrades(career, this.screen === 'postgame' ? 'postgame' : 'menu');
      case 'howto':
        return this.showHowTo(this.screen === 'pause' ? 'pause' : 'menu');
      case 'reset':
        return this.showConfirmReset();
      case 'reset-yes':
        h.reset();
        return this.showMenu(h.career());
      case 'rival':
        this.sel.tier = Number(data.tier);
        return this.showSetup(career, `[data-tier="${this.sel.tier}"]`);
      case 'length':
        this.sel.target = Number(data.target);
        return this.showSetup(career, `[data-target="${this.sel.target}"]`);
      case 'start':
        return h.start(this.sel.tier, this.sel.target);
      case 'spend':
        if (h.spend(data.stat)) this.showUpgrades(h.career(), this.backTo, data.stat);
        return undefined;
      case 'back':
        if (this.backTo === 'pause') return this.showPause();
        if (this.backTo === 'postgame' && this.postgame) return this.showPostgame(this.postgame);
        return this.showMenu(career);
      case 'resume':
        return h.resume();
      case 'quit':
        return h.quit();
      case 'rematch':
        return h.start(this.sel.tier, this.sel.target);
      case 'next':
        this.sel.tier = Math.min(RIVALS.length, this.sel.tier + 1);
        return h.start(this.sel.tier, this.sel.target);
      case 'menu':
        return h.quit();
      default:
        return undefined;
    }
  }

  playerCard(career) {
    const need = xpToNext(career.level);
    const maxed = career.level >= MAX_LEVEL;
    const pct = maxed ? 100 : Math.min(100, (career.xp / need) * 100);
    return `
      <div class="player-card">
        <div class="lvl"><small>LEVEL</small><b>${career.level}</b></div>
        <div class="meta">
          <div class="row"><span>Overall <b>${overall(career.stats)}</b></span><span>Record <b>${career.wins}-${career.losses}</b></span></div>
          <div class="xpbar"><i style="width:${pct}%"></i></div>
          <div class="row small"><span>${maxed ? 'Max level' : `${career.xp} / ${need} XP`}</span>${
            career.points ? `<span class="pts-note">${career.points} skill point${career.points === 1 ? '' : 's'} to spend</span>` : ''
          }</div>
        </div>
      </div>`;
  }

  showMenu(career) {
    this.sel.tier = career.settings.tier;
    this.sel.target = career.settings.target;
    this.postgame = null;
    this.show(
      'menu',
      `<div class="panel menu">
        <div class="logo"><span>FOOTBALL</span><b>SUPERSTAR</b></div>
        <p class="tagline">1-on-1s. You against him, both ways. First to the number wins.</p>
        ${this.playerCard(career)}
        <div class="buttons">
          <button class="btn primary" data-action="setup" data-autofocus>Play</button>
          <button class="btn" data-action="upgrades">Upgrades${career.points ? `<span class="badge">${career.points}</span>` : ''}</button>
          <button class="btn" data-action="howto">How to play</button>
          <button class="btn ghost" data-action="reset">Reset career</button>
        </div>
        <p class="foot">Arrow keys and Enter, or the mouse.</p>
      </div>`
    );
  }

  showSetup(career, focusSelector = null) {
    this.sel.tier = Math.min(this.sel.tier, career.unlocked);
    const rival = RIVALS[this.sel.tier - 1];
    const cards = RIVALS.map((r, i) => {
      const tier = i + 1;
      const locked = tier > career.unlocked;
      const wins = career.beaten[r.id] || 0;
      const status = locked ? 'Locked' : wins ? `Beaten x${wins}` : 'New';
      return `<button class="rival${tier === this.sel.tier ? ' on' : ''}${locked ? ' locked' : ''}" data-action="rival" data-tier="${tier}" ${
        locked ? 'disabled' : ''
      } aria-pressed="${tier === this.sel.tier}">
          <span class="chip" style="background:${hex(r.colors.jersey)};color:${hex(r.colors.trim)}">${r.number}</span>
          <span class="who"><b>${esc(r.name)}</b><small>${esc(r.title)}</small></span>
          <span class="ovr"><b>${overall(r.ratings)}</b><small>${status}</small></span>
        </button>`;
    }).join('');
    const mine = career.stats;
    const cmp = [
      ['SPD', 'speed'],
      ['AGI', 'agility'],
      ['HND', 'hands'],
      ['JMP', 'jumping'],
      ['STR', 'strength'],
    ]
      .map(([label, k]) => {
        const d = mine[k] - rival.ratings[k];
        return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${label} ${rival.ratings[k]}<small> you ${mine[k]}</small></span>`;
      })
      .join('');
    const lengths = GAME_LENGTHS.map(
      (n) =>
        `<button class="seg${n === this.sel.target ? ' on' : ''}" data-action="length" data-target="${n}" aria-pressed="${n === this.sel.target}">First to ${n}</button>`
    ).join('');
    this.show(
      'setup',
      `<div class="panel wide">
        <h2>Pick your rival</h2>
        <div class="rivals">${cards}</div>
        <div class="scout">
          <div><b>${esc(rival.name)}</b> <em>"${esc(rival.nick)}"</em> · XP x${tierMultiplier(this.sel.tier)}</div>
          <p>${esc(rival.scout)}</p>
          <div class="cmp">${cmp}</div>
        </div>
        <div class="length"><span>Game length</span><div class="segs">${lengths}</div></div>
        <div class="buttons row">
          <button class="btn ghost" data-action="back">Back</button>
          <button class="btn primary" data-action="start" data-autofocus>Start game</button>
        </div>
      </div>`
    );
    this.backTo = 'menu';
    if (focusSelector) this.screenEl.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  showUpgrades(career, backTo = 'menu', focusStat = null) {
    this.backTo = backTo;
    const p = deriveParams(career.stats);
    const rows = STAT_KEYS.map((k) => {
      const v = career.stats[k];
      const info = STAT_INFO[k];
      return `<div class="stat">
          <div class="stat-name"><b>${info.label}</b><small>${info.blurb}</small></div>
          <div class="stat-bar"><i style="width:${(v / STAT_MAX) * 100}%"></i></div>
          <div class="stat-val">${v}</div>
          <button class="btn plus" data-action="spend" data-stat="${k}" ${canUpgrade(career, k) ? '' : 'disabled'} aria-label="Add a point to ${info.label}">+</button>
        </div>`;
    }).join('');
    this.show(
      'upgrades',
      `<div class="panel wide">
        <h2>Upgrades</h2>
        <div class="up-head">
          <span>Level ${career.level} · Overall <b>${overall(career.stats)}</b></span>
          <span class="pts-left"><b>${career.points}</b> skill point${career.points === 1 ? '' : 's'}</span>
        </div>
        <div class="stats">${rows}</div>
        <div class="derived">
          <span>40-yard dash <b>${fortyTime(career.stats).toFixed(2)}s</b></span>
          <span>Vertical <b>${Math.round(p.jumpHeight * 36)}"</b></span>
          <span>Sprint tank <b>${p.sprintSeconds.toFixed(1)}s</b></span>
        </div>
        <p class="foot">Win games to level up. Every level is ${POINTS_PER_LEVEL} skill points.</p>
        <div class="buttons row"><button class="btn primary" data-action="back" ${career.points ? '' : 'data-autofocus'}>Done</button></div>
      </div>`
    );
    const again = focusStat && this.screenEl.querySelector(`[data-stat="${focusStat}"]:not(:disabled)`);
    (again || this.screenEl.querySelector('.plus:not(:disabled)') || this.screenEl.querySelector('[data-action="back"]')).focus({
      preventScroll: true,
    });
  }

  showHowTo(backTo = 'menu') {
    this.backTo = backTo;
    this.handlers.seenHowTo?.();
    this.show(
      'howto',
      `<div class="panel wide">
        <h2>How to play</h2>
        <div class="how">
          <ul class="rules">
            <li><b>Both ways.</b> You and your rival trade off. With the ball you are the receiver; without it you are the corner.</li>
            <li><b>Scoring.</b> A completion is a point for the receiver. An incompletion is a point for the defender. Possession flips after every point.</li>
            <li><b>Offense is freestyle.</b> No plays. Run anything, then press ${key('Enter')} to call for the ball. The QB leads you from your speed and direction, so call it coming out of your break.</li>
            <li><b>${QB.deadline}-second pressure.</b> Nobody calls for it in ${QB.deadline} seconds? The QB throws anyway.</li>
            <li><b>The ring.</b> A yellow ring shows where the ball comes down. A white ring closes on it as the ball arrives: be there and press ${key('Space')}. Too far away to jump for it? ${key('Space')} lays you out in a dive instead.</li>
            <li><b>It is physical.</b> A ball off the hands can pop up and stay live: the ring turns orange and anybody can come down with it. And a catch is not safe until it is finished. A defender who arrives with the ball can jar it loose, so on defense, run through the receiver.</li>
            <li><b>Level up.</b> Every game earns XP. Spend skill points on stats that work on both sides of the ball.</li>
          </ul>
          <table class="controls">${CONTROLS.map(([a, k]) => `<tr><td>${a}</td><td>${k}</td></tr>`).join('')}</table>
        </div>
        <div class="buttons row"><button class="btn primary" data-action="back" data-autofocus>Got it</button></div>
      </div>`
    );
  }

  showConfirmReset() {
    this.backTo = 'menu';
    this.show(
      'confirm',
      `<div class="panel">
        <h2>Reset career?</h2>
        <p class="tagline">This erases your level, stats and unlocked rivals. It cannot be undone.</p>
        <div class="buttons row">
          <button class="btn" data-action="back" data-autofocus>Keep my career</button>
          <button class="btn danger" data-action="reset-yes">Erase it</button>
        </div>
      </div>`
    );
  }

  showPause() {
    this.show(
      'pause',
      `<div class="panel">
        <h2>Paused</h2>
        <div class="buttons">
          <button class="btn primary" data-action="resume" data-autofocus>Resume</button>
          <button class="btn" data-action="howto">How to play</button>
          <button class="btn ghost" data-action="quit">Quit to menu</button>
        </div>
        <p class="foot">Quitting ends this game with no XP.</p>
      </div>`
    );
  }

  showPostgame(data) {
    this.postgame = data;
    const { won, score, target, rival, reward, career, summary, tier } = data;
    const lines = reward.xp.lines.map((l) => `<div class="row"><span>${esc(l.label)}</span><b>+${l.xp} XP</b></div>`).join('');
    const canNext = won && tier < RIVALS.length && tier + 1 <= career.unlocked;
    this.show(
      'postgame',
      `<div class="panel wide post ${won ? 'won' : 'lost'}">
        <div class="result">${won ? 'YOU WIN' : 'YOU LOSE'}</div>
        <div class="final">You <b>${score.user}</b> - <b>${score.rival}</b> ${esc(rival.name)} <small>first to ${target}</small></div>
        <div class="tallies">
          <span>Catches <b>${summary.catches}/${summary.targets}</b></span>
          <span>Stops <b>${summary.stops}/${summary.defended}</b></span>
          <span>Picks <b>${summary.picks}</b></span>
        </div>
        <div class="xp-lines">${lines}<div class="row total"><span>Total</span><b>+${reward.xp.total} XP</b></div></div>
        ${
          reward.levels
            ? `<div class="levelup">LEVEL UP! You are level ${career.level}. <b>+${reward.pointsGained} skill points</b></div>`
            : ''
        }
        ${reward.unlockedTier ? `<div class="unlock">New rival unlocked: <b>${esc(RIVALS[reward.unlockedTier - 1].name)}</b></div>` : ''}
        ${this.playerCard(career)}
        <div class="buttons row wrap">
          ${career.points ? `<button class="btn primary" data-action="upgrades" data-autofocus>Spend points<span class="badge">${career.points}</span></button>` : ''}
          ${canNext ? `<button class="btn${career.points ? '' : ' primary'}" data-action="next" ${career.points ? '' : 'data-autofocus'}>Next rival</button>` : ''}
          <button class="btn${career.points || canNext ? '' : ' primary'}" data-action="rematch" ${career.points || canNext ? '' : 'data-autofocus'}>Rematch</button>
          <button class="btn ghost" data-action="menu">Menu</button>
        </div>
      </div>`
    );
  }

  // -------------------------------------------------------------------- HUD

  showHud(on) {
    this.hud.hidden = !on;
    if (!on) {
      this.h.banner.classList.remove('show');
      this.h.tip.hidden = true;
    }
  }

  banner(title, sub = '', tone = '', seconds = 1.6) {
    const el = this.h.banner;
    el.className = `banner show ${tone}`;
    el.querySelector('b').textContent = title;
    el.querySelector('span').textContent = sub;
    this.bannerTimer = seconds;
  }

  tip(text) {
    this.h.tip.hidden = !text;
    this.h.tip.textContent = text || '';
  }

  tick(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.h.banner.classList.remove('show');
    }
  }

  updateHud(s) {
    const h = this.h;
    h.you.textContent = s.score.user;
    h.rival.textContent = s.score.rival;
    h.rivalName.textContent = s.rivalName.toUpperCase();
    h.to.textContent = `FIRST TO ${s.target}`;
    h.role.textContent = s.role === 'wr' ? 'OFFENSE · RECEIVER' : 'DEFENSE · CORNER';
    h.role.className = `role ${s.role}`;
    h.possYou.classList.toggle('on', s.role === 'wr');
    h.possRival.classList.toggle('on', s.role === 'db');

    const live = s.phase === 'live';
    h.clock.classList.toggle('show', live || s.phase === 'flight');
    h.clock.classList.toggle('hot', live && s.clock < 1.5);
    h.clock.classList.toggle('thrown', s.phase === 'flight');
    h.clockText.textContent = s.phase === 'flight' ? 'THROWN' : s.clock.toFixed(1);
    h.clockFill.style.width = `${(s.clock / QB.deadline) * 100}%`;

    h.stam.style.width = `${Math.max(0, s.stamina) * 100}%`;
    h.stam.parentElement.classList.toggle('empty', s.exhausted);

    let hintKey = s.phase === 'done' ? 'done' : `${s.role}:${s.phase}`;
    if (hintKey === 'wr:live' && s.called) hintKey = 'wr:called';
    if (hintKey !== this.lastHint) {
      this.lastHint = hintKey;
      h.hints.innerHTML = HINTS[hintKey] || '';
    }

    const a = s.arrow;
    h.arrow.hidden = !a;
    if (a) {
      const x = Math.min(0.94, Math.max(0.06, a.x));
      const y = Math.min(0.88, Math.max(0.14, a.y));
      h.arrow.style.left = `${x * 100}%`;
      h.arrow.style.top = `${y * 100}%`;
      h.arrow.firstElementChild.style.transform = `rotate(${Math.atan2(a.y - 0.5, a.x - 0.5) + Math.PI / 2}rad)`;
    }
  }
}
