// OpenStreetMap -> game map conversion.
// Shared by the in-game "Explore anywhere" loader and tools/fetch-uae-maps.mjs.
//
// Map format (all distances in metres, x = east, y = north, origin = map centre):
// {
//   id, name, emirate, center: {lat, lon}, radius,
//   nodes:     [[x, y], ...],
//   roads:     [{ name, type, lanes, oneway, maxspeed, n: [nodeIndex, ...] }],
//   signals:   [nodeIndex, ...],          // highway=traffic_signals
//   stops:     [nodeIndex, ...],          // highway=stop / give_way
//   buildings: [{ h, p: [[x, y], ...] }],
//   areas:     [{ kind: 'water'|'park', p: [[x, y], ...] }],
//   cameras:   [[x, y]],                  // highway=speed_camera
//   tolls:     [{ x, y, name }],          // highway=toll_gantry (Salik / Darb)
//   rest:      [{ x, y, kind, name }]     // fuel / services / rest areas
// }

export const ROAD_TYPES = {
  motorway: { rank: 9, lanes: 4, speed: 120, width: 3.7 },
  trunk: { rank: 8, lanes: 3, speed: 100, width: 3.6 },
  primary: { rank: 7, lanes: 3, speed: 80, width: 3.5 },
  secondary: { rank: 6, lanes: 2, speed: 60, width: 3.4 },
  tertiary: { rank: 5, lanes: 2, speed: 60, width: 3.3 },
  motorway_link: { rank: 4, lanes: 1, speed: 80, width: 3.7 },
  trunk_link: { rank: 4, lanes: 1, speed: 60, width: 3.6 },
  primary_link: { rank: 4, lanes: 1, speed: 60, width: 3.5 },
  secondary_link: { rank: 4, lanes: 1, speed: 40, width: 3.4 },
  tertiary_link: { rank: 4, lanes: 1, speed: 40, width: 3.3 },
  unclassified: { rank: 3, lanes: 1, speed: 40, width: 3.2 },
  residential: { rank: 3, lanes: 1, speed: 40, width: 3.2 },
  living_street: { rank: 2, lanes: 1, speed: 25, width: 3.0 },
  service: { rank: 1, lanes: 1, speed: 25, width: 3.0 },
};

const ROAD_REGEX = Object.keys(ROAD_TYPES).join('|');

export function bboxAround(lat, lon, radius) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

export function overpassQuery(lat, lon, radius, withBuildings = true) {
  const b = bboxAround(lat, lon, radius).map((v) => v.toFixed(6)).join(',');
  return (
    `[out:json][timeout:120];(` +
    `way["highway"~"^(${ROAD_REGEX})$"]["area"!="yes"](${b});` +
    `node["highway"~"^(traffic_signals|stop|give_way|speed_camera|toll_gantry)$"](${b});` +
    `node["amenity"="fuel"](${b});way["amenity"="fuel"](${b});` +
    `node["highway"~"^(services|rest_area)$"](${b});way["highway"~"^(services|rest_area)$"](${b});` +
    (withBuildings ? `way["building"](${b});` : '') +
    `way["natural"="water"](${b});way["leisure"="park"](${b});` +
    `);out body;>;out skel qt;`
  );
}

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function fetchOverpass(query, fetchImpl = fetch, onProgress = () => {}) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      onProgress(`Contacting ${new URL(url).host}…`);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No Overpass endpoint reachable');
}

export function parseMaxspeed(v) {
  if (!v) return 0;
  const m = String(v).match(/(\d+(?:\.\d+)?)\s*(mph)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Math.round(m[2] ? n * 1.609 : n);
}

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  return (x % 1000) / 1000;
}

function polygonArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return a / 2;
}

/**
 * Convert raw Overpass JSON into the compact game map format.
 */
export function convertOsm(osm, meta) {
  const { lat, lon, radius } = meta;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  const r2 = (radius * 1.05) ** 2;
  const round = (v) => Math.round(v * 10) / 10;

  const osmNodes = new Map();
  const tagged = [];
  const ways = [];
  for (const el of osm.elements || []) {
    if (el.type === 'node') {
      osmNodes.set(el.id, [round((el.lon - lon) * kx), round((el.lat - lat) * ky)]);
      if (el.tags && (el.tags.highway || el.tags.amenity)) tagged.push(el);
    } else if (el.type === 'way' && el.tags) {
      ways.push(el);
    }
  }

  const nodes = [];
  const nodeIndex = new Map();
  const idx = (id) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(osmNodes.get(id));
      nodeIndex.set(id, i);
    }
    return i;
  };
  const inside = (p) => p && p[0] * p[0] + p[1] * p[1] <= r2;

  const roads = [];
  const buildings = [];
  const areas = [];
  const rest = [];
  for (const w of ways) {
    const t = w.tags;
    if (t.amenity === 'fuel' || t.highway === 'services' || t.highway === 'rest_area') {
      const p = w.nodes.map((id) => osmNodes.get(id)).filter(Boolean);
      if (!p.length) continue;
      const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
      const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
      if (inside([cx, cy])) rest.push({ x: round(cx), y: round(cy), kind: t.amenity === 'fuel' ? 'fuel' : 'rest', name: t['name:en'] || t.name || t.brand || '' });
    } else if (t.highway && ROAD_TYPES[t.highway]) {
      if (t.highway === 'service' && t.service) continue; // skip driveways / parking aisles
      if (t.access === 'private' || t.access === 'no') continue;
      const def = ROAD_TYPES[t.highway];
      // split the way into runs of nodes that fall inside the play radius
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ||
            ((t.highway === 'motorway' || t.highway.endsWith('_link')) && t.oneway !== 'no');
          const reverse = t.oneway === '-1';
          const n = run.map(idx);
          if (reverse) n.reverse();
          let lanes = parseInt(t.lanes, 10) || 0;
          if (!lanes) lanes = oneway ? Math.max(1, Math.ceil(def.lanes / 1.5)) : def.lanes;
          if (lanes > 7) lanes = 7;
          roads.push({
            name: t['name:en'] || t.name || t.ref || '',
            type: t.highway,
            lanes,
            oneway: oneway || reverse,
            maxspeed: parseMaxspeed(t.maxspeed) || def.speed,
            n,
          });
        }
        run = [];
      };
      for (const id of w.nodes) {
        if (inside(osmNodes.get(id))) run.push(id);
        else flush();
      }
      flush();
    } else if (t.building) {
      const p = w.nodes.map((id) => osmNodes.get(id)).filter(Boolean);
      if (p.length < 4 || !inside(p[0])) continue;
      p.pop(); // closed ring: drop duplicate end point
      if (Math.abs(polygonArea(p)) < 12) continue;
      let h = parseFloat(t.height) || (parseFloat(t['building:levels']) || 0) * 3.4;
      if (!h) h = 6 + hash(w.id) * (t.building === 'house' || t.building === 'villa' ? 4 : 22);
      buildings.push({ h: Math.round(Math.min(h, 830)), p });
    } else if (t.natural === 'water' || t.leisure === 'park') {
      const p = w.nodes.map((id) => osmNodes.get(id)).filter(Boolean);
      if (p.length < 4) continue;
      p.pop();
      areas.push({ kind: t.natural === 'water' ? 'water' : 'park', p });
    }
  }

  const signals = [];
  const stops = [];
  const cameras = [];
  const tolls = [];
  for (const el of tagged) {
    const p = osmNodes.get(el.id);
    const tg = el.tags;
    if (tg.highway === 'speed_camera') {
      if (inside(p)) cameras.push([p[0], p[1]]);
      continue;
    }
    if (tg.highway === 'toll_gantry') {
      if (inside(p)) tolls.push({ x: p[0], y: p[1], name: tg['name:en'] || tg.name || tg.operator || '' });
      continue;
    }
    if (tg.amenity === 'fuel' || tg.highway === 'services' || tg.highway === 'rest_area') {
      if (inside(p)) rest.push({ x: p[0], y: p[1], kind: tg.amenity === 'fuel' ? 'fuel' : 'rest', name: tg['name:en'] || tg.name || tg.brand || '' });
      continue;
    }
    const i = nodeIndex.get(el.id);
    if (i === undefined) continue; // not on a kept road
    if (el.tags.highway === 'traffic_signals') signals.push(i);
    else stops.push(i);
  }

  // keep the nearest buildings only – phones cannot draw an entire city at once
  buildings.sort((a, b) => a.p[0][0] ** 2 + a.p[0][1] ** 2 - (b.p[0][0] ** 2 + b.p[0][1] ** 2));
  if (buildings.length > (meta.maxBuildings || 7000)) buildings.length = meta.maxBuildings || 7000;

  return {
    id: meta.id,
    name: meta.name,
    emirate: meta.emirate || '',
    center: { lat, lon },
    radius,
    source: 'osm',
    nodes,
    roads,
    signals,
    stops,
    buildings,
    areas,
    cameras,
    tolls,
    rest,
  };
}

export async function loadOsmArea(meta, onProgress) {
  const query = overpassQuery(meta.lat, meta.lon, meta.radius);
  const raw = await fetchOverpass(query, fetch, onProgress);
  onProgress && onProgress('Building road network…');
  return convertOsm(raw, meta);
}
