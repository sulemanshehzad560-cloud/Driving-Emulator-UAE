#!/usr/bin/env node
// Downloads the bundled UAE city packs from OpenStreetMap (Overpass API) and
// writes them to game/public/maps/. Runs in CI before the APK build.
// Map data © OpenStreetMap contributors, ODbL 1.0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS } from '../game/src/world/regions.js';
import { overpassQuery, fetchOverpass, convertOsm } from '../game/src/world/osm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'game', 'public', 'maps');
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const index = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const r of REGIONS) {
  if (only.length && !only.includes(r.id)) continue;
  const file = path.join(outDir, `${r.id}.json`);
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      console.log(`[${r.id}] downloading (attempt ${attempt})…`);
      const raw = await fetchOverpass(overpassQuery(r.lat, r.lon, r.radius));
      const map = convertOsm(raw, r);
      if (map.roads.length < 20) throw new Error(`only ${map.roads.length} roads`);
      fs.writeFileSync(file, JSON.stringify(map));
      console.log(`[${r.id}] ${map.roads.length} roads, ${map.signals.length} signals, ${map.buildings.length} buildings, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
      ok = true;
    } catch (e) {
      console.warn(`[${r.id}] failed: ${e.message}`);
      await sleep(8000 * attempt);
    }
  }
  if (!ok && fs.existsSync(file)) ok = true; // keep a previously downloaded pack
  index.push({ id: r.id, bundled: ok });
  await sleep(3000); // be polite to the public Overpass servers
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`Done: ${index.filter((i) => i.bundled).length}/${index.length} packs bundled.`);
