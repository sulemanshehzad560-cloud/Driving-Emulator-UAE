#!/usr/bin/env node
// End-to-end smoke test: serves the built game, plays through
// splash -> disclaimer -> guest login -> dashboard -> garage -> settings ->
// loads a city -> drives with keyboard -> checks lights, indicators, cameras,
// mirrors, map, radio, AC, pause -> takes screenshots and fails on JS errors.
//
// Usage: node tools/e2e-test.mjs <buildDir> <outDir> [regionId]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const buildDir = path.resolve(process.argv[2] || 'android/app/src/main/assets/www');
const outDir = path.resolve(process.argv[3] || 'e2e-shots');
const region = process.argv[4] || 'demo-city';
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(buildDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(buildDir) || !fs.existsSync(p)) {
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|net::ERR|api\.radio-browser|overpass/i.test(m.text())) errors.push(`console: ${m.text()}`);
});

const step = async (name, fn) => {
  const t = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t} ms)`);
};
const shot = (n) => page.screenshot({ path: path.join(outDir, `${n}.png`) });
const sleep = (ms) => page.waitForTimeout(ms);
// Software-rendered CI browsers draw only a few frames per second, so advance
// the simulation at a fixed 30 Hz while keys are held, then render one frame.
const simulate = (seconds) => page.evaluate((n) => {
  const g = window.__game;
  for (let i = 0; i < n; i++) g.update(1 / 30);
}, Math.round(seconds * 30));

try {
  await step('load splash', async () => {
    await page.goto(url);
    await page.waitForSelector('.splash');
    await sleep(1200);
    await shot('01-splash');
  });
  await step('disclaimer', async () => {
    await page.mouse.click(640, 320);
    await page.waitForSelector('.disclaimer');
    await shot('02-disclaimer');
    await page.click('[data-go]');
  });
  await step('login as guest', async () => {
    await page.waitForSelector('.login');
    await page.click('[data-p="instagram"]');
    await page.waitForFunction(() => document.querySelector('.msg').textContent.includes('Instagram'));
    await shot('03-login');
    await page.click('[data-p="guest"]');
    await page.waitForSelector('.dash');
    await sleep(800);
    await shot('04-dashboard');
  });
  await step('garage: preview + paint', async () => {
    await page.click('[data-tab="garage"]');
    await page.click('[data-car="kaiser-g"]');
    await sleep(600);
    await shot('05-garage-gline');
    await page.click('[data-car="falcon-gt"]');
    await sleep(600);
    await shot('06-garage-supercar');
    await page.click('[data-car="kaiser-s"] [data-select], [data-car="kaiser-s"]');
  });
  await step('settings: 1080p + high', async () => {
    await page.click('[data-tab="settings"]');
    await page.selectOption('[data-set="resolution"]', '1080p');
    await page.selectOption('[data-set="quality"]', 'medium');
    await page.selectOption('[data-set="mirrors"]', 'all');
    await shot('07-settings');
    const pr = await page.evaluate(() => {
      const c = document.getElementById('gl');
      return [c.width, c.height];
    });
    if (pr[1] !== 1080) throw new Error(`expected 1080 px tall drawing buffer, got ${pr}`);
    // back to a lighter setting so software rendering in CI stays fast
    await page.selectOption('[data-set="resolution"]', '540p');
    await page.selectOption('[data-set="quality"]', 'low');
  });
  await step(`load city ${region}`, async () => {
    await page.click('[data-tab="drive"]');
    await page.click(`[data-region="${region}"]`);
    await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
    await sleep(1500);
    await shot('08-drive-start');
  });
  const state = () => page.evaluate(() => {
    const g = window.__game;
    return { x: g.player.x, z: g.player.z, kmh: g.player.kmh, road: g.currentRoad?.name, balance: g.profile.balance, lights: g.lights, cam: g.cameraMode, signals: g.signals.approaches.length, traffic: g.traffic.cars.filter((c) => c.active).length, fines: g.profile.sessionFines };
  });
  await step('drive forward', async () => {
    const s0 = await state();
    await page.keyboard.down('ArrowUp');
    await simulate(4);
    const s1 = await state();
    await page.keyboard.up('ArrowUp');
    console.log('   ', JSON.stringify(s1));
    if (Math.hypot(s1.x - s0.x, s1.z - s0.z) < 5) throw new Error('car did not move');
    if (s1.kmh < 10) throw new Error('car did not accelerate');
    await shot('09-driving-chase');
  });
  await step('Rust/WebAssembly physics core active', async () => {
    const core = await page.evaluate(() => !!window.__game.player.core);
    if (!core) throw new Error('physics.wasm did not load – running on the JS fallback');
  });
  await step('steer right turns right, then brake', async () => {
    const h0 = await page.evaluate(() => window.__game.player.heading);
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await simulate(0.8);
    await page.keyboard.up('ArrowRight');
    const h1 = await page.evaluate(() => window.__game.player.heading);
    console.log('    heading change steering right:', (h1 - h0).toFixed(3), 'rad');
    if (!(h1 < h0 - 0.05)) throw new Error('steering right did not turn the car right');
    await page.keyboard.up('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await simulate(3);
    await page.keyboard.up('ArrowDown');
    const s = await state();
    if (s.kmh > 15) throw new Error('car did not slow down when braking: ' + s.kmh);
  });
  await step('headlights + indicators + night', async () => {
    await page.keyboard.press('h');
    await page.keyboard.press('q');
    const s = await state();
    if (s.lights !== 1) throw new Error('headlights did not switch on');
    await page.evaluate(() => {
      const g = window.__game;
      g.hour = 22;
      g.applyEnvironment();
    });
    await sleep(1200);
    await shot('10-night-indicator');
  });
  await step('cockpit view with live mirrors', async () => {
    await page.evaluate(() => {
      const g = window.__game;
      g.cameraMode = 'cockpit';
      g.hour = 12.5;
      g.applyEnvironment();
    });
    await page.keyboard.down('ArrowUp');
    await simulate(1.5);
    await page.keyboard.up('ArrowUp');
    await sleep(1500);
    const visible = await page.evaluate(() => window.__game.mirrors.map((m) => m.mesh.visible));
    if (!visible.every(Boolean)) throw new Error(`mirrors not visible: ${visible}`);
    await shot('11-cockpit-mirrors');
  });
  await step('seasons: sandstorm + rain', async () => {
    await page.evaluate(() => {
      const g = window.__game;
      g.cameraMode = 'chase';
      g.settings.season = 'sandstorm';
      g.applyEnvironment();
    });
    await sleep(800);
    await shot('12-sandstorm');
    await page.evaluate(() => {
      const g = window.__game;
      g.settings.season = 'rain';
      g.hour = 17.8;
      g.applyEnvironment();
    });
    await sleep(800);
    await shot('13-rain-sunset');
    await page.evaluate(() => {
      const g = window.__game;
      g.settings.season = 'summer';
      g.hour = 12.5;
      g.applyEnvironment();
    });
  });
  await step('full map + GPS route', async () => {
    await page.keyboard.press('m');
    await sleep(300);
    const box = await page.locator('.bigmap canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3);
    await sleep(500);
    const hasRoute = await page.evaluate(() => !!window.__game.route);
    if (!hasRoute) throw new Error('no GPS route after tapping the map');
    await shot('14-bigmap-route');
    await page.keyboard.press('m');
  });
  await step('radio + AC panels', async () => {
    await page.click('[data-a="radio"]');
    await page.click('[data-src="music"]');
    await shot('15-radio');
    await page.click('.radio-panel [data-a="radio"]');
    await page.click('.quick [data-a="ac"]');
    await page.click('[data-ac="t-"]');
    const t = await page.evaluate(() => window.__game.climate.target);
    if (t !== 21.5) throw new Error('AC target did not change');
    await shot('16-ac');
    await page.click('.ac-panel [data-a="ac"]');
  });
  await step('red light enforcement', async () => {
    const fined = await page.evaluate(() => {
      const g = window.__game;
      const ap = g.signals.approaches[0];
      if (!ap) return 'no-signals';
      const before = g.profile.sessionFines;
      // force red and drive the car across the stop line
      ap.ctrl.offset = 0;
      const s = g.signals;
      const orig = s.stateOf.bind(s);
      s.stateOf = () => 'red';
      s.update(g.time + 100);
      g.player.place(ap.x - ap.dx * 6, ap.z - ap.dz * 6, Math.atan2(-ap.dx, -ap.dz));
      g.player.vx = ap.dx * 14;
      g.player.vz = ap.dz * 14;
      g.player.speed = 14;
      g.lastPos = [g.player.x, g.player.z];
      for (let i = 0; i < 40; i++) g.update(1 / 60);
      s.stateOf = orig;
      return g.profile.sessionFines - before;
    });
    console.log('    fine for red light:', fined);
    if (fined !== 'no-signals' && fined < 1000) throw new Error('red light was not fined');
    await sleep(500);
    await shot('17-red-light-fine');
  });
  await step('tilt + wheel steering modes', async () => {
    await page.evaluate(() => window.__game.input.setMode('wheel'));
    await sleep(200);
    await shot('18-wheel-controls');
    await page.evaluate(() => window.__game.input.setMode('tilt'));
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 0, gamma: 0 })));
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 20, gamma: 20 })));
    const steer = await page.evaluate(() => window.__game.input.update(0.016).steer);
    console.log('    tilt steer value:', steer.toFixed(2));
    if (Math.abs(steer) < 0.3) throw new Error('tilting the phone did not steer');
  });
  await step('pause + quit to menu', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause:not(.hidden)');
    await shot('19-pause');
    await page.click('[data-p="quit"]');
    await page.waitForSelector('.dash');
  });
  const perf = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) + ' MB heap' : '');
  console.log('   ', perf);
} catch (e) {
  errors.push(`test failure: ${e.message}`);
  await shot('zz-failure').catch(() => {});
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('\nE2E FAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nE2E PASSED – screenshots in', outDir);
