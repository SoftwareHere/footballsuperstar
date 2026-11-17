/* eslint-disable no-console */
// End-to-end test for phones: the landscape gate, menus that fit a short
// landscape screen without scrolling, and a game played with real multi-touch
// input on the on-screen controls.
//
//   npm run dev              (in one terminal)
//   npm run e2e:mobile       (in another; needs Playwright available to Node)
//
// FS_URL overrides the address. Screenshots land in tests/e2e/shots/mobile.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.FS_URL || 'http://localhost:5173/';
const SHOTS = path.join(__dirname, 'shots', 'mobile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Landscape phone screens, with room taken off for the browser's bars.
const SIZES = [
  { width: 667, height: 375, name: 'se' },
  { width: 740, height: 340, name: 'android' },
  { width: 844, height: 390, name: 'iphone14' },
];

let failures = 0;
function check(cond, message) {
  if (cond) console.log(`  ok  ${message}`);
  else {
    failures += 1;
    console.log(`  FAIL ${message}`);
  }
}

/** Does the open screen fit without scrolling? The how-to rules column may scroll. */
const fits = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.screen');
    const panel = el.querySelector('.panel');
    const r = panel.getBoundingClientRect();
    return {
      scroll: el.scrollHeight - el.clientHeight,
      scrollX: el.scrollWidth - el.clientWidth,
      inside: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 0.5 && r.right <= window.innerWidth + 0.5,
      h: Math.round(r.height),
    };
  });

function fakePostgame() {
  const g = window.__fs;
  const career = g.career;
  return {
    won: true,
    score: { user: 5, rival: 3 },
    target: 5,
    rival: { name: 'Marcus Reed' },
    tier: 1,
    reward: {
      xp: {
        lines: [
          { label: 'Win', xp: 120 },
          { label: 'Points scored', xp: 50 },
          { label: 'Rival tier x1.0', xp: 0 },
          { label: 'Clean game', xp: 25 },
        ],
        total: 195,
      },
      levels: 1,
      pointsGained: 3,
      unlockedTier: 2,
    },
    career: { ...career, points: 3 },
    summary: { catches: 3, targets: 4, stops: 2, defended: 4, picks: 1 },
  };
}

async function screens(page, size) {
  const tag = `${size.width}x${size.height}`;
  const open = {
    menu: () => window.__fs.ui.showMenu(window.__fs.career),
    setup: () => window.__fs.ui.showSetup(window.__fs.career),
    upgrades: () => window.__fs.ui.showUpgrades(window.__fs.career),
    howto: () => window.__fs.ui.showHowTo('menu'),
    settings: () => window.__fs.ui.showSettings(window.__fs.career),
    confirm: () => window.__fs.ui.showConfirmReset(),
    pause: () => window.__fs.ui.showPause(),
  };
  for (const [name, fn] of Object.entries(open)) {
    await page.evaluate(fn);
    await sleep(60);
    const f = await fits(page);
    check(f.scroll <= 0 && f.scrollX <= 0 && f.inside, `${tag} ${name} fits (panel ${f.h}px, overflow ${f.scroll}px)`);
    await page.screenshot({ path: path.join(SHOTS, `${size.name}-${name}.png`) });
  }
  // The post-game screen with everything on it: level up, unlock, four buttons.
  await page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const make = new Function(`return (${src})()`);
    const data = make();
    window.__fs.ui.sel.tier = 1;
    window.__fs.ui.showPostgame(data);
  }, fakePostgame.toString());
  await sleep(60);
  const f = await fits(page);
  check(f.scroll <= 0 && f.inside, `${tag} postgame fits (panel ${f.h}px, overflow ${f.scroll}px)`);
  await page.screenshot({ path: path.join(SHOTS, `${size.name}-postgame.png`) });
}

/** Multi-touch through the DevTools protocol: each finger is {id, x, y}. */
class Fingers {
  constructor(cdp) {
    this.cdp = cdp;
    this.down = new Map();
  }

  async send(type) {
    const touchPoints = [...this.down.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 }));
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }

  async start(id, x, y) {
    this.down.set(id, { x, y });
    await this.send('touchStart');
  }

  async move(id, x, y) {
    this.down.set(id, { x, y });
    await this.send('touchMove');
  }

  async end(id) {
    this.down.delete(id);
    await this.send('touchEnd');
  }

  async tap(id, x, y) {
    await this.start(id, x, y);
    await sleep(40);
    await this.end(id);
  }
}

const centerOf = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);

const state = (page) =>
  page.evaluate(() => {
    const g = window.__fs;
    const r = g.rep;
    if (!r) return { state: g.state, paused: g.paused };
    const me = g.role === 'wr' ? r.wr : r.db;
    return {
      state: g.state,
      paused: g.paused,
      role: g.role,
      phase: r.phase,
      t: r.t,
      tPre: r.tPre,
      called: r.called,
      me: { x: me.pos.x, z: me.pos.z, stamina: me.stamina, sprinting: me.sprinting },
      target: r.ball.target,
      eta: r.ball.eta,
      reps: g.match.history.length,
      callText: document.querySelector('.tp-call b').textContent,
    };
  });

async function play(page, cdp) {
  const fingers = new Fingers(cdp);
  const stick = await centerOf(page, '.tp-stick');
  const call = await centerOf(page, '.tp-call');
  const jump = await centerOf(page, '.tp-jump');
  const sprint = await centerOf(page, '.tp-sprint');
  const cutR = await centerOf(page, '.tp-cutr');

  let tested = { move: false, call: false, sprint: false, cut: false, snap: { wr: false, db: false } };
  for (let rep = 0; rep < 4; rep++) {
    await page.waitForFunction(() => window.__fs.rep?.phase === 'presnap' && window.__fs.rep.tPre > 0.5, null, { timeout: 30000 });
    const s0 = await state(page);
    check(s0.callText === (s0.role === 'wr' ? 'SNAP' : 'READY'), `presnap Call button reads ${s0.callText} (${s0.role})`);
    await fingers.tap(2, call.x, call.y);
    await page.waitForFunction(() => window.__fs.rep.phase !== 'presnap', null, { timeout: 5000 }).catch(() => {});
    const s1 = await state(page);
    check(s1.phase !== 'presnap', `Call snaps the ball (${s1.role})`);
    tested.snap[s1.role] = true;

    // Run upfield with the stick, sprinting with the other thumb.
    const startZ = s1.me.z;
    await fingers.start(1, stick.x, stick.y);
    await fingers.move(1, stick.x + 4, stick.y - 30);
    await fingers.move(1, stick.x + 8, stick.y - 60);
    await fingers.start(3, sprint.x, sprint.y);
    await sleep(900);
    const s2 = await state(page);
    if (s2.phase === 'live') {
      check(s2.me.z < startZ - 1.5, `stick moves the player upfield (${startZ.toFixed(1)} -> ${s2.me.z.toFixed(1)})`);
      check(s2.me.sprinting || s2.me.stamina < 1, `holding Sprint sprints (stamina ${s2.me.stamina.toFixed(2)})`);
      tested.move = true;
      tested.sprint = true;
    }
    await fingers.end(3);

    if (s2.role === 'wr' && s2.phase === 'live') {
      await fingers.tap(4, cutR.x, cutR.y);
      const ev = await page.evaluate(() => window.__fs.rep.wr.jukeTimer > 0);
      check(ev, 'Cut button jukes');
      tested.cut = true;
      await sleep(250);
      await fingers.tap(2, call.x, call.y);
      await sleep(80);
      const s3 = await state(page);
      check(s3.called || s3.phase !== 'live', 'Call button calls for the ball');
      tested.call = true;
    }

    // Steer toward the ball and go up for it.
    let jumped = false;
    for (let i = 0; i < 400; i++) {
      const s = await state(page);
      if (s.state !== 'match' || s.phase === 'done') break;
      if (s.phase === 'flight' && s.target) {
        const dx = s.target.x - s.me.x;
        const dz = s.target.z - s.me.z;
        const len = Math.hypot(dx, dz) || 1;
        await fingers.move(1, stick.x + (dx / len) * 50, stick.y + (dz / len) * 50);
        if (s.eta < 0.36 && !jumped) {
          await fingers.tap(5, jump.x, jump.y);
          jumped = true;
        }
      }
      await sleep(25);
    }
    await fingers.end(1);
    await page.waitForFunction(() => window.__fs.rep?.phase === 'done' || window.__fs.state !== 'match', null, { timeout: 20000 });
    const sd = await state(page);
    if (sd.state !== 'match') break;
    await page.waitForFunction(() => window.__fs.rep.tDone > 0.9, null, { timeout: 5000 });
    check((await state(page)).callText === 'NEXT', 'Call button reads NEXT after the rep');
    if (rep === 0) await page.screenshot({ path: path.join(SHOTS, 'result.png') });
    await fingers.tap(2, call.x, call.y); // skip to the next rep
  }
  check(tested.move && tested.sprint, 'stick and sprint exercised');
  check(tested.call && tested.cut, 'call and cut exercised on offense');
  check(tested.snap.wr && tested.snap.db, 'snapped on offense and readied on defense');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    // Full screen would stop the test from turning the "phone" round.
    Element.prototype.requestFullscreen = () => Promise.resolve();
    // A fresh career that has already seen the how-to.
    if (!sessionStorage.getItem('fs-e2e')) {
      localStorage.clear();
      sessionStorage.setItem('fs-e2e', '1');
    }
  });

  console.log('portrait gate');
  await page.goto(`${URL}?seed=7&quality=low`);
  await page.waitForFunction(() => window.__fs);
  await sleep(300);
  const gate = await page.evaluate(() => ({
    rotate: !document.querySelector('.rotate').hidden,
    screen: !document.querySelector('.screen').hidden,
    touch: document.documentElement.classList.contains('touch'),
  }));
  check(gate.touch, 'phone detected');
  check(gate.rotate, 'portrait shows the rotate prompt');
  check(!gate.screen, 'no menu until the phone is sideways');
  await page.screenshot({ path: path.join(SHOTS, 'portrait.png') });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => !document.querySelector('.screen').hidden, null, { timeout: 3000 }).catch(() => {});
  const after = await page.evaluate(() => ({
    rotate: !document.querySelector('.rotate').hidden,
    screen: document.querySelector('.screen').className,
  }));
  check(!after.rotate, 'landscape hides the rotate prompt');
  check(/screen-(menu|howto)/.test(after.screen), `landscape opens the menu (${after.screen})`);
  await page.evaluate(() => window.__fs.ui.handlers.seenHowTo());

  for (const size of SIZES) {
    console.log(`menus at ${size.width}x${size.height}`);
    await page.setViewportSize(size);
    await sleep(350);
    await screens(page, size);
  }

  console.log('touch play');
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(300);
  await page.evaluate(() => window.__fs.ui.showSetup(window.__fs.career));
  await page.tap('[data-action="start"]');
  await page.waitForFunction(() => window.__fs.state === 'match');
  await sleep(600);
  check(await page.evaluate(() => !document.querySelector('.touchpad').hidden), 'touch controls show in a game');
  await page.screenshot({ path: path.join(SHOTS, 'presnap.png') });
  const cdp = await context.newCDPSession(page);
  await play(page, cdp);
  await page.waitForFunction(() => window.__fs.rep?.phase === 'presnap', null, { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, 'hud.png') });

  console.log('pause button and portrait mid-game');
  const pauseAt = await centerOf(page, '.tp-pause');
  await page.touchscreen.tap(pauseAt.x, pauseAt.y);
  await sleep(150);
  check(await page.evaluate(() => window.__fs.paused && document.querySelector('.touchpad').hidden), 'pause button pauses and hides the controls');
  await page.tap('[data-action="resume"]');
  await sleep(150);
  check(await page.evaluate(() => !window.__fs.paused), 'resume from the pause menu');
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(300);
  check(await page.evaluate(() => window.__fs.paused && !document.querySelector('.rotate').hidden), 'turning upright pauses the game');
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(300);
  check(await page.evaluate(() => document.querySelector('.rotate').hidden), 'turning back hides the prompt');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall mobile checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
