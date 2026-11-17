/* eslint-disable no-console */
// Picture cost: how long a frame takes to draw and how much is in it, for
// each picture quality and lighting.
//
//   npm run dev            (in one terminal)
//   npm run perf           (in another; needs Playwright available to Node)
//
// FS_URL overrides the address. FS_QUALITY and FS_LIGHTING take comma lists
// (default: low,medium,high and golden). FS_SHOTS=dir saves a picture of each.
//
// The browser here draws in software, so the times are only good for
// comparing one build or setting against another on the same machine.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.FS_URL || 'http://localhost:5173/';
const QUALITY = (process.env.FS_QUALITY || 'low,medium,high').split(',');
const LIGHTING = (process.env.FS_LIGHTING || 'golden').split(',');
const SHOTS = process.env.FS_SHOTS || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(browser, quality, lighting) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`${URL}?seed=11&quality=${quality}&lighting=${lighting}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs, null, { timeout: 60000 });
  const boot = Date.now() - t0;
  await page.evaluate(() => {
    const g = window.__fs;
    g.career.seenHowTo = true;
    g.startMatch(1, 3);
  });
  await page.waitForFunction(() => window.__fs.rep && window.__fs.rep.phase === 'presnap' && window.__fs.rep.tPre > 0.5, null, { timeout: 60000 });
  await sleep(1500); // shaders compiled, quality settled
  const result = await page.evaluate(() => {
    const g = window.__fs;
    const view = g.view;
    const r = view.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    const times = [];
    let calls = 0;
    let triangles = 0;
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      if (r.info.autoReset === false) r.info.reset();
      view.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the picture to be finished
      times.push(performance.now() - t);
      calls = Math.max(calls, r.info.render.calls);
      triangles = Math.max(triangles, r.info.render.triangles);
    }
    times.sort((a, b) => a - b);
    const size = { x: r.domElement.width, y: r.domElement.height };
    return {
      ms: times[Math.floor(times.length / 2)],
      calls,
      triangles,
      textures: r.info.memory.textures,
      geometries: r.info.memory.geometries,
      programs: r.info.programs ? r.info.programs.length : 0,
      buffer: `${size.x}x${size.y}`,
      tier: view.quality,
    };
  });
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `perf-${quality}-${lighting}.png`) });
  }
  await page.close();
  return { quality, lighting, boot, ...result, errors };
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const rows = [];
  for (const lighting of LIGHTING) {
    for (const quality of QUALITY) {
      const row = await measure(browser, quality, lighting);
      rows.push(row);
      console.log(
        `${quality.padEnd(7)} ${lighting.padEnd(7)} tier ${row.tier}  ${row.ms.toFixed(1).padStart(6)} ms/frame  ${String(row.calls).padStart(4)} draws  ${String(
          row.triangles
        ).padStart(7)} tris  ${String(row.textures).padStart(3)} textures  ${String(row.programs).padStart(3)} shaders  ${row.buffer}  boot ${row.boot} ms${
          row.errors.length ? `  ERRORS: ${row.errors.join(' | ')}` : ''
        }`
      );
    }
  }
  await browser.close();
  if (rows.some((r) => r.errors.length)) process.exit(1);
})().catch((err) => {
  console.error(`PERF RUN FAILED: ${err.message}`);
  process.exit(1);
});
