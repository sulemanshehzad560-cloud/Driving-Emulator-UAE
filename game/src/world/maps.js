// Loads a map: bundled OpenStreetMap pack -> live Overpass download ->
// procedurally generated roads as a last resort, so there is always
// something to drive on ("imaginary" roads fill any gap in the data).
import { REGIONS } from './regions.js';
import { loadOsmArea } from './osm.js';
import { buildProceduralCity } from './procedural.js';

const CACHE = 'uaedrive-maps-v1';

async function cacheGet(key) {
  try {
    if (!('caches' in window)) return null;
    const c = await caches.open(CACHE);
    const r = await c.match(key);
    return r ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

async function cachePut(key, data) {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open(CACHE);
    await c.put(key, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* ignore */ }
}

function usable(map) {
  return map && map.roads && map.roads.length >= 8;
}

/** Fill sparse areas (desert, new developments) with generated roads. */
function withFallback(map, onProgress) {
  if (usable(map)) return map;
  onProgress && onProgress('Few mapped roads here – generating roads for this area…');
  const gen = buildProceduralCity();
  return { ...gen, id: map?.id || gen.id, name: `${map?.name || 'Unmapped area'} (generated roads)`, emirate: map?.emirate || gen.emirate, center: map?.center || gen.center };
}

export async function loadRegion(id, onProgress = () => {}) {
  if (id === 'demo-city') return buildProceduralCity();
  const region = REGIONS.find((r) => r.id === id);
  onProgress('Loading bundled city pack…');
  try {
    const res = await fetch(`maps/${id}.json`);
    if (res.ok) {
      const map = await res.json();
      if (usable(map)) return map;
    }
  } catch (e) { /* not bundled */ }
  if (!region) return buildProceduralCity();
  return loadAnywhere({ ...region }, onProgress);
}

export async function loadAnywhere({ lat, lon, radius = 1200, name = 'Custom location', emirate = '', id }, onProgress = () => {}) {
  const key = `https://cache.local/${lat.toFixed(4)},${lon.toFixed(4)},${radius}`;
  const cached = await cacheGet(key);
  if (usable(cached)) {
    onProgress('Loaded from offline cache');
    return cached;
  }
  onProgress('Downloading roads from OpenStreetMap…');
  try {
    const map = await loadOsmArea({ id: id || 'custom', name, emirate, lat, lon, radius }, onProgress);
    if (usable(map)) await cachePut(key, map);
    return withFallback(map, onProgress);
  } catch (e) {
    onProgress('No internet connection – using generated roads');
    const gen = buildProceduralCity();
    return { ...gen, name: `${name} (offline generated roads)`, emirate: emirate || gen.emirate };
  }
}

export async function bundledIndex() {
  try {
    const res = await fetch('maps/index.json');
    if (!res.ok) return {};
    const list = await res.json();
    return Object.fromEntries(list.map((i) => [i.id, i.bundled]));
  } catch (e) {
    return {};
  }
}

export function guessEmirate(lat, lon) {
  let best = REGIONS[0], bd = Infinity;
  for (const r of REGIONS) {
    const d = (r.lat - lat) ** 2 + (r.lon - lon) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best.emirate;
}
