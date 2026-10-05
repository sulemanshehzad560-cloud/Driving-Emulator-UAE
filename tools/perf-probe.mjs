#!/usr/bin/env node
// Perf probe: start a drive in headless Chromium and report the CPU cost of a
// game update, draw calls and triangles per frame (GPU timings under
// SwiftShader are not representative; draw calls and JS time are).
// Usage: node tools/perf-probe.mjs <buildDir> [cityId] [quality]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const buildDir = path.resolve(process.argv[2] || 'android/app/src/main/assets/www');
const city = process.argv[3] || 'downtown';
const quality = process.argv[4] || 'high';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = path.join(buildDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(buildDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1594, height: 720 }, hasTouch: true })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript((q) => {
  localStorage.setItem('uaedrive.profile.v1', JSON.stringify({ settings: { quality: q, resolution: 'auto', mirrors: 'all' }, }));
}, quality);
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForSelector('.splash', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.mouse.click(797, 360);
await page.waitForSelector('.disclaimer, .login, .app .bottom-nav', { timeout: 60000 });
if (await page.$('.disclaimer')) await page.click('[data-go]');
if (await page.$('.login, [data-p="guest"]')) { await page.waitForSelector('[data-p="guest"]'); await page.click('[data-p="guest"]'); }
await page.waitForSelector('.app .bottom-nav');
await page.click('.bottom-nav [data-tab="map"]');
await page.waitForSelector(`.city[data-drive="${city}"]`);
await page.click(`.city[data-drive="${city}"]`);
await page.waitForFunction(() => window.__game, null, { timeout: 300000 });
if (await page.$('[data-tut]')) await page.click('[data-tut]');
await page.waitForTimeout(4000);
const r = await page.evaluate(async () => {
  const g = window.__game, R = g.renderer;
  g.input.keys.add('w');
  for (let i = 0; i < 60; i++) g.update(1 / 30);
  await new Promise((res) => setTimeout(res, 3000));
  let tu = 0; const n = 120;
  for (let i = 0; i < n; i++) { const t = performance.now(); g.update(1 / 30); tu += performance.now() - t; }
  R.info.autoReset = false; R.info.reset();
  const t = performance.now(); g.render(1 / 30); const tr = performance.now() - t;
  const info = { calls: R.info.render.calls, tris: R.info.render.triangles, geoms: R.info.memory.geometries, tex: R.info.memory.textures, programs: R.info.programs?.length };
  R.info.autoReset = true;
  // count scene objects
  let meshes = 0, visible = 0, inst = 0, shadowCasters = 0;
  g.scene.traverse((o) => { if (o.isMesh) { meshes++; if (o.visible) visible++; if (o.isInstancedMesh) inst++; if (o.castShadow) shadowCasters++; } });
  return { updateMs: tu / n, renderMsSwiftshader: tr, pixelRatio: R.getPixelRatio(), buf: [R.domElement.width, R.domElement.height], ...info, meshes, visible, inst, shadowCasters, post: !!g.post, q: g.qualityKey };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
server.close();
