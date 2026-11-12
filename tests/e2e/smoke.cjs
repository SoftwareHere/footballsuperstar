/* eslint-disable no-console */
// End-to-end smoke test: plays real games in a headless browser using only
// the keyboard, on both offense and defense.
//
//   npm run dev            (in one terminal)
//   npm run e2e            (in another; needs Playwright available to Node)
//
// FS_URL overrides the address. Screenshots land in tests/e2e/shots.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.FS_URL || 'http://localhost:5173/';
const SHOTS = path.join(__dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERT: ${message}`);
  console.log(`  ok  ${message}`);
}

async function setKeys(page, held, want) {
  for (const k of [...held]) {
    if (!want.has(k)) {
      await page.keyboard.up(k);
      held.delete(k);
    }
  }
  for (const k of want) {
    if (!held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    }
  }
}

const snapshot = (page) =>
  page.evaluate(() => {
    const g = window.__fs;
    const r = g.rep;
    if (!r) return { state: g.state };
    const me = g.role === 'wr' ? r.wr : r.db;
    const him = g.role === 'wr' ? r.db : r.wr;
    return {
      state: g.state,
      role: g.role,
      phase: r.phase,
      t: r.t,
      tPre: r.tPre,
      called: r.called,
      me: { x: me.pos.x, z: me.pos.z, air: me.airborne },
      him: { x: him.pos.x, z: him.pos.z },
      target: r.ball.target,
      eta: r.ball.eta,
      score: { ...g.match.score },
      reps: g.match.history.length,
    };
  });

/** Keys that move from `from` toward `to` (up-screen is -z). */
function steer(from, to, want) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx > 0.45) want.add('KeyD');
  if (dx < -0.45) want.add('KeyA');
  if (dz < -0.45) want.add('KeyW');
  if (dz > 0.45) want.add('KeyS');
}

/** Play one rep with the keyboard. Returns what happened. */
async function playRep(page, { call, shots = {} }) {
  await page.waitForFunction(
    () => window.__fs.state === 'match' && window.__fs.rep.phase === 'presnap' && window.__fs.rep.tPre > 0.5,
    null,
    { timeout: 30000 }
  );
  const start = await snapshot(page);
  const role = start.role;
  const held = new Set();
  let jumped = false;
  let pressedCall = false;
  let sawLive = false;
  let sawFlight = false;
  let maxLiveT = 0;

  await page.keyboard.press('Space'); // snap on offense, "ready" on defense

  for (let i = 0; i < 1200; i++) {
    const s = await snapshot(page);
    if (s.state !== 'match' || s.reps > start.reps || s.phase === 'done') break;
    const want = new Set();
    if (s.phase === 'live') {
      if (!sawLive && shots.live) await page.screenshot({ path: path.join(SHOTS, shots.live) });
      sawLive = true;
      maxLiveT = Math.max(maxLiveT, s.t);
      want.add('ShiftLeft');
      if (role === 'wr') {
        if (s.t < 1.1) want.add('KeyW');
        else want.add(s.me.x > 0 ? 'KeyA' : 'KeyD'); // break across the middle
        if (call && s.t > 1.5 && !s.called && !pressedCall) {
          await setKeys(page, held, want);
          await page.keyboard.press('Enter'); // call for the ball: right hand
          pressedCall = true;
        }
      } else {
        steer(s.me, { x: s.him.x, z: s.him.z - 1.2 }, want);
      }
    } else if (s.phase === 'flight' && s.target) {
      if (!sawFlight && shots.flight) await page.screenshot({ path: path.join(SHOTS, shots.flight) });
      sawFlight = true;
      want.add('ShiftLeft');
      steer(s.me, s.target, want);
      if (s.eta < 0.36 && !jumped) {
        await setKeys(page, held, want);
        await page.keyboard.press('Space');
        jumped = true;
      }
    }
    await setKeys(page, held, want);
    await sleep(25);
  }
  await setKeys(page, held, new Set());

  await page.waitForFunction((n) => window.__fs.match && window.__fs.match.history.length > n, start.reps, { timeout: 20000 });
  if (shots.result) {
    await sleep(350);
    await page.screenshot({ path: path.join(SHOTS, shots.result) });
  }
  const entry = await page.evaluate(() => {
    const m = window.__fs.match;
    return { ...m.history[m.history.length - 1], score: { ...m.score }, winner: m.winner, possession: m.possession };
  });
  return { role, start, entry, sawLive, sawFlight, maxLiveT };
}

/** Play a whole game from the setup screen's Start button. */
async function playGame(page, { call, label, shots = false }) {
  const reps = [];
  for (let n = 0; n < 12; n++) {
    const state = await page.evaluate(() => window.__fs.state);
    if (state !== 'match') break;
    const first = reps.find((r) => r.role === 'wr') === undefined;
    const firstD = reps.find((r) => r.role === 'db') === undefined;
    const role = await page.evaluate(() => window.__fs.role);
    const want =
      shots && role === 'wr' && first
        ? { live: '05-offense-live.png', flight: '06-offense-ball-in-air.png', result: '07-offense-result.png' }
        : shots && role === 'db' && firstD
          ? { live: '08-defense-live.png', flight: '09-defense-ball-in-air.png', result: '10-defense-result.png' }
          : {};
    const rep = await playRep(page, { call, shots: want });
    reps.push(rep);
    const e = rep.entry;
    console.log(
      `    ${label} rep ${reps.length}: ${rep.role === 'wr' ? 'offense' : 'defense'} -> ${e.complete ? 'complete' : 'incomplete'} (${e.reason}${
        e.forced ? ', forced throw' : e.called ? ', called' : ''
      }), score ${e.score.user}-${e.score.rival}`
    );
    if (e.winner) break;
    await page.keyboard.press('Space'); // skip the result linger
  }
  await page.waitForFunction(() => window.__fs.state === 'postgame', null, { timeout: 20000 });
  return reps;
}

function checkRules(reps, target) {
  let user = 0;
  let rival = 0;
  reps.forEach((rep, i) => {
    const e = rep.entry;
    const offense = rep.role === 'wr' ? 'user' : 'rival';
    const defense = offense === 'user' ? 'rival' : 'user';
    const scorer = e.complete ? offense : defense;
    if (scorer === 'user') user += 1;
    else rival += 1;
    if (e.score.user !== user || e.score.rival !== rival) throw new Error(`score wrong after rep ${i + 1}`);
    if (e.scorer !== scorer) throw new Error(`wrong scorer on rep ${i + 1}`);
    if (i > 0 && reps[i - 1].role === rep.role) throw new Error(`possession did not flip before rep ${i + 1}`);
    if (!rep.sawFlight) throw new Error(`no throw seen on rep ${i + 1}`);
  });
  assert(true, 'completion = point for the receiver, incompletion = point for the defender, every rep');
  assert(true, 'possession flipped after every point');
  assert(Math.max(user, rival) === target && Math.min(user, rival) < target, `game ended at first to ${target} (${user}-${rival})`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

  console.log(`Loading ${URL}`);
  await page.goto(`${URL}?seed=11`, { waitUntil: 'load' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs, null, { timeout: 20000 });
  await sleep(600);

  console.log('Menus');
  assert((await page.evaluate(() => window.__fs.ui.screen)) === 'howto', 'first visit opens How to play');
  await page.screenshot({ path: path.join(SHOTS, '01-how-to-play.png') });
  await page.keyboard.press('Enter');
  await sleep(700);
  assert((await page.evaluate(() => window.__fs.ui.screen)) === 'menu', 'Enter closes it and shows the main menu');
  assert((await page.evaluate(() => window.__fs.view.renderer.info.render.triangles)) > 500, '3D scene is rendering');
  await page.screenshot({ path: path.join(SHOTS, '02-menu.png') });

  await page.keyboard.press('ArrowDown'); // Upgrades
  await page.keyboard.press('Enter');
  await sleep(250);
  assert((await page.evaluate(() => window.__fs.ui.screen)) === 'upgrades', 'arrow keys + Enter reach Upgrades');
  const before = await page.evaluate(() => ({ ...window.__fs.career.stats, points: window.__fs.career.points }));
  await page.keyboard.press('Enter'); // + on the first stat (speed)
  await page.keyboard.press('Enter');
  await sleep(150);
  const after = await page.evaluate(() => ({ ...window.__fs.career.stats, points: window.__fs.career.points }));
  assert(after.speed === before.speed + 2 && after.points === before.points - 2, 'spending 2 skill points raised Speed by 2');
  await page.screenshot({ path: path.join(SHOTS, '03-upgrades.png') });
  await page.keyboard.press('Escape');
  await sleep(200);

  await page.keyboard.press('Enter'); // Play
  await sleep(250);
  assert((await page.evaluate(() => window.__fs.ui.screen)) === 'setup', 'Play opens rival and game-length setup');
  await page.click('[data-target="3"]');
  await sleep(150);
  await page.screenshot({ path: path.join(SHOTS, '04-setup.png') });
  const lengths = await page.$$eval('[data-action="length"]', (els) => els.map((e) => e.dataset.target).join(','));
  assert(lengths === '3,5,7', 'game length offers first to 3, 5 or 7');
  await page.click('[data-action="start"]');

  console.log('Game 1: first to 3, calling for the ball on offense');
  const careerBefore = await page.evaluate(() => ({ level: window.__fs.career.level, xp: window.__fs.career.xp }));
  const game1 = await playGame(page, { call: true, label: 'g1', shots: true });
  checkRules(game1, 3);
  assert(game1.some((r) => r.role === 'wr') && game1.some((r) => r.role === 'db'), 'played both offense and defense');
  const offense1 = game1.filter((r) => r.role === 'wr');
  assert(offense1.every((r) => r.entry.called && !r.entry.forced), 'pressing Enter made the QB throw (called, not forced)');
  assert(offense1.every((r) => r.maxLiveT < 3.5), 'called throws came out well before the 4-second clock');

  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '11-postgame.png') });
  const post = await page.evaluate(() => ({
    level: window.__fs.career.level,
    xp: window.__fs.career.xp,
    wins: window.__fs.career.wins,
    losses: window.__fs.career.losses,
    saved: JSON.parse(window.localStorage.getItem('footballsuperstar.save.v1')),
    text: document.querySelector('.screen').innerText,
  }));
  const gained = post.level > careerBefore.level || post.xp > careerBefore.xp;
  assert(gained, `XP awarded after the game (level ${careerBefore.level} -> ${post.level}, xp ${post.xp})`);
  assert(post.wins + post.losses === 1, 'the game was added to the record');
  assert(/XP/.test(post.text) && /YOU (WIN|LOSE)/.test(post.text), 'post-game screen shows the result and XP');
  assert(post.saved.level === post.level && post.saved.xp === post.xp, 'progress written to localStorage');

  console.log('Game 2: rematch, never calling for the ball');
  await page.click('[data-action="rematch"]');
  const game2 = await playGame(page, { call: false, label: 'g2' });
  checkRules(game2, 3);
  const offense2 = game2.filter((r) => r.role === 'wr');
  assert(offense2.length > 0, 'had the ball at least once');
  assert(offense2.every((r) => r.entry.forced && !r.entry.called), 'with no call, the QB was forced to throw');
  assert(offense2.every((r) => r.maxLiveT >= 4.0), 'forced throws only came after the full 4 seconds');

  console.log('Persistence');
  const end = await page.evaluate(() => ({ ...window.__fs.career }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs, null, { timeout: 20000 });
  await sleep(500);
  const reloaded = await page.evaluate(() => ({ ...window.__fs.career, screen: window.__fs.ui.screen }));
  assert(reloaded.level === end.level && reloaded.xp === end.xp, `level and XP survive a reload (level ${reloaded.level})`);
  assert(reloaded.stats.speed === end.stats.speed && reloaded.points === end.points, 'stats and skill points survive a reload');
  assert(reloaded.wins + reloaded.losses === 2, 'record survives a reload');
  assert(reloaded.screen === 'menu', 'returning players go straight to the menu');
  await page.screenshot({ path: path.join(SHOTS, '12-menu-after.png') });

  console.log('Pause');
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.click('[data-action="start"]');
  await page.waitForFunction(() => window.__fs.state === 'match', null, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await sleep(200);
  assert(await page.evaluate(() => window.__fs.paused && window.__fs.ui.screen === 'pause'), 'Esc pauses the game');
  const t0 = await page.evaluate(() => window.__fs.rep.tPre);
  await sleep(500);
  assert((await page.evaluate(() => window.__fs.rep.tPre)) === t0, 'nothing moves while paused');
  await page.keyboard.press('Escape');
  await sleep(200);
  assert(await page.evaluate(() => !window.__fs.paused && window.__fs.ui.screen === null), 'Esc resumes');

  console.log('Cinematic camera');
  const camera = () => page.evaluate(() => window.__fs.career.settings.camera);
  const seen = [await camera()];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyC');
    await sleep(120);
    seen.push(await camera());
  }
  assert(seen.join(',') === 'follow,broadcast,lock,follow', `C cycles follow, broadcast, cinematic (${seen.join(' > ')})`);
  await page.keyboard.press('KeyC');
  await sleep(120);
  await page.keyboard.press('KeyC');
  await sleep(120);
  assert((await camera()) === 'lock', 'cinematic camera selected');
  await page.waitForFunction(() => document.getElementById('ui').classList.contains('cinematic'), null, { timeout: 5000 });
  assert(true, 'cinematic camera darkens the edges of the picture');
  await page.waitForFunction(() => window.__fs.rep.phase === 'presnap' && window.__fs.rep.tPre > 0.5, null, { timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, '13-cinematic-presnap.png') });
  await page.keyboard.press('Space'); // snap, or "ready"
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => window.__fs.rep.phase !== 'presnap', null, { timeout: 10000 });
  // While he runs, the camera must stay bolted to him and pointed at the end zone.
  const rig = [];
  for (let i = 0; i < 6; i++) {
    await sleep(110);
    rig.push(
      await page.evaluate(() => {
        const v = window.__fs.view;
        const cam = v.rig.camera;
        const dir = cam.getWorldDirection(cam.position.clone());
        return { dx: cam.position.x - v.focus.x, dz: cam.position.z - v.focus.z, dirX: dir.x, dirZ: dir.z, x: v.focus.x, z: v.focus.z, mode: v.rig.mode };
      })
    );
    if (i === 2) await page.screenshot({ path: path.join(SHOTS, '14-cinematic-running.png') });
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const moved = Math.hypot(rig[5].x - rig[0].x, rig[5].z - rig[0].z);
  const drift = Math.max(...rig.map((r) => Math.hypot(r.dx - rig[0].dx, r.dz - rig[0].dz)));
  assert(rig.every((r) => r.mode === 'lock'), 'camera rig is in lock mode');
  assert(moved > 1.5, `the player ran (${moved.toFixed(1)} yards)`);
  assert(drift < 1e-6, `camera stayed locked to the player (drift ${drift.toExponential(1)} yards)`);
  // No sideways component at all, and pointing downfield (-z); it tilts down more on defense.
  assert(rig.every((r) => Math.abs(r.dirX) < 1e-6 && r.dirZ < -0.7), 'camera kept facing straight down the field at the end zone');

  assert(problems.length === 0, `no console or page errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  await browser.close();
  console.log('\nSMOKE TEST PASSED');
})().catch((err) => {
  console.error(`\nSMOKE TEST FAILED: ${err.message}`);
  process.exit(1);
});
