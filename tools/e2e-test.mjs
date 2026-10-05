#!/usr/bin/env node
// End-to-end test of the built game in headless Chromium:
// splash -> disclaimer -> guest sign-in -> home -> map / garage / profile /
// settings -> start a drive in a UAE city -> drive, steer, brake -> lights,
// indicators, cameras (incl. cockpit mirrors), big map + GPS route, radio,
// climate, pause -> quit. Takes screenshots and fails on JS errors or broken
// gameplay.
//
// Usage: node tools/e2e-test.mjs <buildDir> <outDir> [cityId] [quality]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const buildDir = path.resolve(process.argv[2] || 'android/app/src/main/assets/www');
const outDir = path.resolve(process.argv[3] || 'e2e-shots');
const city = process.argv[4] || 'downtown';
const quality = process.argv[5] || 'low';
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = path.join(buildDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(buildDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 880, height: 400 }, deviceScaleFactor: 1, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  // missing optional assets (favicon, offline radio streams) are not failures
  if (m.type() === 'error' && !/Failed to load resource|net::ERR|radio|stream/i.test(t)) errors.push(`console: ${t}`);
});

let step = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
};
const shot = async (name) => {
  step++;
  await page.screenshot({ path: path.join(outDir, `${String(step).padStart(2, '0')}-${name}.png`), timeout: 180000 });
};
const sim = (frames, keys = []) => page.evaluate(([n, k]) => {
  const g = window.__game;
  for (const key of k) g.input.keys.add(key);
  for (let i = 0; i < n; i++) g.update(1 / 30);
  for (const key of k) g.input.keys.delete(key);
}, [frames, keys]);
const state = () => page.evaluate(() => {
  const g = window.__game;
  return { x: g.player.x, z: g.player.z, kmh: g.player.kmh, heading: g.player.heading, lights: g.lightsOn, ind: { ...g.ind }, cam: g.cameraMode, paused: g.paused };
});

await page.addInitScript((q) => {
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('uaedrive.profile.v1', JSON.stringify({ settings: { quality: q, resolution: '540p', mirrors: 'all' } }));
  }
}, quality);
await page.goto(url);
await page.waitForSelector('.splash', { timeout: 30000 });
await page.waitForTimeout(800);
await shot('splash');
check('splash screen', true);

await page.mouse.click(440, 200);
await page.waitForSelector('.disclaimer', { timeout: 60000 });
await shot('disclaimer');
check('disclaimer shown', true);
await page.click('[data-go]');
await page.waitForSelector('.login');
await shot('login');
check('sign-in options', (await page.$$('.social')).length === 3);
await page.click('[data-p="guest"]');
await page.waitForSelector('.app .bottom-nav');
await page.waitForTimeout(1500);
await shot('home');
check('home screen', true);

for (const tab of ['map', 'garage', 'profile', 'settings']) {
  await page.click(`.bottom-nav [data-tab="${tab}"]`);
  await page.waitForSelector(`.tab-${tab}`);
  await page.waitForTimeout(tab === 'garage' ? 1500 : 600);
  await shot(tab);
}
check('all home tabs open', true);
await page.click(".bottom-nav [data-tab=\"map\"]");
await page.waitForSelector('.city[data-drive]');
const cities = await page.$$eval('.city[data-drive]', (els) => els.length);
check('UAE map lists cities in all emirates', cities >= 20, `${cities} cities`);

// ---------------- drive
const t0 = Date.now();
await page.click(`.city[data-drive="${city}"]`);
await page.waitForSelector('.loading');
await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
check('drive loads', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (await page.$('.tutorial')) {
  await shot('tutorial');
  await page.click('[data-tut]');
}
const start = await state();
const onRoad = await page.evaluate(() => !!window.__game.currentRoad || !!window.__game.graph.nearest(window.__game.player.x, window.__game.player.z, 12));
check('spawned on a road', onRoad);
await sim(5);
await page.waitForTimeout(1200);
await shot('drive-start');

await sim(90, ['w']);
let s = await state();
check('accelerates', s.kmh > 20, `${s.kmh.toFixed(0)} km/h`);
const moved = Math.hypot(s.x - start.x, s.z - start.z);
check('car moves', moved > 10, `${moved.toFixed(0)} m`);
// regression: with no input the car must hold its heading (it used to spin after knocks)
const hs = await page.evaluate(() => { const g = window.__game; const h = g.player.heading; for (let i = 0; i < 60; i++) g.update(1 / 30); return Math.abs(Math.atan2(Math.sin(g.player.heading - h), Math.cos(g.player.heading - h))) * 180 / Math.PI; });
check('no self-steering with zero input', hs < 0.5, `Δheading ${hs.toFixed(2)}°`);
// regression: trees and poles are solid
const solid = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  let best = null;
  for (const list of g.colliders.byTile.values()) for (const c of list) {
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (c.r < 0.5 && d > 30 && d < 400 && (!best || d < best.d)) best = { c, d };
  }
  if (!best) return { skip: true };
  const c = best.c, h = Math.atan2(-(c.x - p.x), -(c.z - p.z));
  const save = [p.x, p.z, p.heading];
  p.place(c.x + Math.sin(h) * 22, c.z + Math.cos(h) * 22, h);
  let minD = 1e9;
  g.input.keys.add('w');
  for (let i = 0; i < 120; i++) { g.update(1 / 30); minD = Math.min(minD, Math.hypot(c.x - p.x, c.z - p.z)); }
  g.input.keys.delete('w');
  p.place(...save);
  return { minD, half: p.length / 2 };
});
check('trees and poles are solid', solid.skip || solid.minD > solid.half - 0.3, solid.skip ? 'no obstacle nearby' : `closest ${solid.minD.toFixed(2)} m, half length ${solid.half.toFixed(2)} m`);
const h0 = (await state()).heading;
await sim(20, ['w', 'a']);
s = await state();
const dh = Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0));
check('steering left turns left', dh > 0.02, `Δheading ${dh.toFixed(3)}`);
await sim(60, ['s']);
s = await state();
check('brakes', s.kmh < 15, `${s.kmh.toFixed(0)} km/h`);
await page.waitForTimeout(800);
await shot('after-drive');

await page.evaluate(() => { const g = window.__game; g.action('lights'); g.action('indLeft'); });
await sim(3);
s = await state();
check('headlights + indicator', s.lights > 0 && s.ind.left);

await page.evaluate(() => { const g = window.__game; g.cameraMode = 'cockpit'; });
await sim(4);
await page.waitForTimeout(1500);
await shot('cockpit');
const mirrors = await page.evaluate(() => [...document.querySelectorAll('.mirror-frame')].filter((f) => f.style.display !== 'none').length);
check('cockpit mirrors visible', mirrors >= 1, `${mirrors} mirrors`);
await page.evaluate(() => { window.__game.cameraMode = 'chase'; });
await sim(3);

await page.evaluate(() => window.__game.action('map'));
await page.waitForTimeout(1200);
await shot('bigmap');
const routed = await page.evaluate(() => {
  const g = window.__game;
  g.setDestination(g.player.x + 600, g.player.z - 600, 'Test destination');
  return !!(g.route && g.route.length) || !!g.dest;
});
check('GPS destination + route', routed);
await page.evaluate(() => window.__game.action('map'));

await page.evaluate(() => window.__game.action('radio'));
await page.waitForTimeout(500);
await shot('radio');
await page.evaluate(() => { window.__game.action('radio'); window.__game.action('ac'); });
await page.waitForTimeout(500);
await shot('climate');
await page.evaluate(() => window.__game.action('ac'));

await page.evaluate(() => window.__game.setPaused(true));
await page.waitForTimeout(500);
await shot('pause');
check('pause menu', await page.evaluate(() => !document.getElementById('pause').classList.contains('hidden')));
await page.click('[data-p="quit"]');
await page.waitForSelector('.app .bottom-nav', { timeout: 30000 });
check('quit back to menu', true);

for (const e of errors) check('no JS errors', false, e);
if (!errors.length) check('no JS errors', true);
fs.writeFileSync(path.join(outDir, 'results.txt'), results.join('\n') + '\n');
await browser.close();
server.close();
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
