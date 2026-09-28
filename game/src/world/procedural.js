// Offline fallback city ("Dubai-style" grid with a Sheikh Zayed Road style
// motorway), used when no OpenStreetMap pack is available.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildProceduralCity() {
  const R = 1400;
  const rand = rng(971);
  const lines = [];
  const EW_NAMES = ['Al Safa Street', 'Al Wasl Road', 'Financial Centre Road', 'Al Khail Road', 'Umm Suqeim Street'];
  const NS_NAMES = { '-1200': 'Jumeirah Street', '-600': 'Al Thanya Road', 600: 'Marasi Drive', 1200: 'Ras Al Khor Road' };

  // Sheikh Zayed Road: two one-way carriageways, 6 lanes each (right-hand traffic)
  lines.push({ axis: 'ns', c: 16, from: -R, to: R, road: { name: 'Sheikh Zayed Road', type: 'motorway', lanes: 5, oneway: true, maxspeed: 100 } });
  lines.push({ axis: 'ns', c: -16, from: R, to: -R, road: { name: 'Sheikh Zayed Road', type: 'motorway', lanes: 5, oneway: true, maxspeed: 100 } });

  let k = 0;
  for (let y = -1200; y <= 1200; y += 600) {
    lines.push({ axis: 'ew', c: y, from: -R, to: R, road: { name: EW_NAMES[k++], type: 'primary', lanes: 3, oneway: false, maxspeed: 80 } });
  }
  for (const x of [-1200, -600, 600, 1200]) {
    lines.push({ axis: 'ns', c: x, from: -R, to: R, road: { name: NS_NAMES[x], type: 'secondary', lanes: 2, oneway: false, maxspeed: 60 } });
  }
  // residential grid
  let street = 1;
  for (let v = -1350; v <= 1350; v += 150) {
    if (v % 600 === 0) continue;
    // east-west streets on each side of SZR, leaving a tower strip next to the motorway
    lines.push({ axis: 'ew', c: v, from: -R, to: -300, road: { name: `${street}${suffix(street)} Street`, type: 'residential', lanes: 1, oneway: false, maxspeed: 40 } });
    lines.push({ axis: 'ew', c: v, from: 300, to: R, road: { name: `${street}${suffix(street)} Street`, type: 'residential', lanes: 1, oneway: false, maxspeed: 40 } });
    street++;
    if (Math.abs(v) < 300) continue;
    lines.push({ axis: 'ns', c: v, from: -R, to: R, road: { name: `${street}${suffix(street)} Street`, type: 'residential', lanes: 1, oneway: false, maxspeed: 40 } });
    street++;
  }
  // service roads alongside the tower strip
  lines.push({ axis: 'ns', c: 300, from: -R, to: R, road: { name: 'Sheikh Zayed Road Service Road', type: 'tertiary', lanes: 2, oneway: false, maxspeed: 60 } });
  lines.push({ axis: 'ns', c: -300, from: -R, to: R, road: { name: 'Sheikh Zayed Road Service Road', type: 'tertiary', lanes: 2, oneway: false, maxspeed: 60 } });

  const nodes = [];
  const nodeKey = new Map();
  const node = (x, y) => {
    const key = `${Math.round(x)},${Math.round(y)}`;
    let i = nodeKey.get(key);
    if (i === undefined) {
      i = nodes.length;
      nodes.push([x, y]);
      nodeKey.set(key, i);
    }
    return i;
  };
  const between = (v, a, b) => v >= Math.min(a, b) - 0.01 && v <= Math.max(a, b) + 0.01;

  const roads = [];
  const nodeRoads = new Map();
  for (const L of lines) {
    const cuts = [L.from, L.to];
    for (const M of lines) {
      if (M.axis === L.axis) continue;
      if (between(M.c, L.from, L.to) && between(L.c, M.from, M.to)) cuts.push(M.c);
    }
    const dir = Math.sign(L.to - L.from);
    const uniq = [...new Set(cuts.map((v) => Math.round(v)))].sort((a, b) => (a - b) * dir);
    const n = uniq.map((v) => (L.axis === 'ew' ? node(v, L.c) : node(L.c, v)));
    const road = { ...L.road, n };
    roads.push(road);
    for (const i of n) {
      if (!nodeRoads.has(i)) nodeRoads.set(i, []);
      nodeRoads.get(i).push(road);
    }
  }

  const RANK = { motorway: 9, primary: 7, secondary: 6, tertiary: 5, residential: 3 };
  const signals = [];
  const stops = [];
  for (const [i, rs] of nodeRoads) {
    if (rs.length < 2) continue;
    const ranks = rs.map((r) => RANK[r.type]).sort((a, b) => b - a);
    if (ranks[1] >= 5) signals.push(i);
    else if (ranks[0] >= 5 && ranks[1] <= 3) stops.push(i);
  }

  // buildings
  const buildings = [];
  const box = (cx, cy, w, d, h) => buildings.push({ h, p: [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]] });
  // tower strip along SZR
  for (let y = -1320; y <= 1320; y += 75) {
    if (Math.abs(y % 600) < 60 || Math.abs(y % 600) > 540) continue;
    for (const side of [-1, 1]) {
      const cx = side * (160 + rand() * 20);
      box(cx, y, 45 + rand() * 25, 40 + rand() * 20, 60 + Math.floor(rand() * 240));
    }
  }
  box(160, 300, 60, 60, 828); // the tallest tower
  // residential / mid-rise blocks
  for (let bx = -1350; bx < 1350; bx += 150) {
    for (let by = -1350; by < 1350; by += 150) {
      const cx = bx + 75;
      const cy = by + 75;
      if (Math.abs(cx) < 320) continue;
      if (Math.hypot(cx - 900, cy + 900) < 260) continue; // park
      const mid = Math.abs(cx) < 700;
      if (mid) {
        box(cx - 30, cy - 30, 40, 40, 20 + Math.floor(rand() * 45));
        box(cx + 30, cy + 30, 40, 40, 15 + Math.floor(rand() * 40));
      } else {
        for (const [ox, oy] of [[-35, -35], [35, -35], [-35, 35], [35, 35]]) box(cx + ox, cy + oy, 22, 18, 7 + Math.floor(rand() * 4));
      }
    }
  }

  const circle = (cx, cy, r) => Array.from({ length: 24 }, (_, i) => [cx + Math.cos((i / 24) * Math.PI * 2) * r, cy + Math.sin((i / 24) * Math.PI * 2) * r]);
  const areas = [
    { kind: 'park', p: circle(900, -900, 230) },
    { kind: 'water', p: [[-1390, 1240], [-640, 1240], [-640, 1380], [-1390, 1380]] },
  ];

  return {
    id: 'demo-city',
    name: 'Dubai Test Track (offline)',
    emirate: 'Dubai',
    center: { lat: 25.1972, lon: 55.2744 },
    radius: R,
    source: 'procedural',
    nodes,
    roads,
    signals,
    stops,
    buildings,
    areas,
  };
}

function suffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}
