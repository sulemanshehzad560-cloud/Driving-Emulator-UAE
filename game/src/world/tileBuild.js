// Turns one 1 km world tile (from tools/uae_tiles.py) into GPU-ready
// geometry buffers + instance lists + graph/collision data.
// Pure JS (no DOM) so it runs inside a Web Worker.
// Tile-local space: x = east, z = -north, origin at the tile's SW corner.
import { emirateName } from './cities.js';
import { Earcut } from 'three/src/extras/Earcut.js';

export const TILE = 1000;
const RANK = {
  motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, motorway_link: 4, trunk_link: 4, primary_link: 4,
  secondary_link: 4, tertiary_link: 4, unclassified: 3, residential: 3, living_street: 2, service: 1,
};
const LANE_W = { motorway: 3.7, trunk: 3.6, primary: 3.5, secondary: 3.4, tertiary: 3.3 };

export function roadWidth(r) {
  const lw = LANE_W[r.type.replace('_link', '')] || 3.1;
  const lanes = r.oneway ? r.lanes : Math.max(2, r.lanes);
  return Math.max(r.oneway ? 4 : 6, lanes * lw);
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class Geo {
  constructor(opts = {}) {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = opts.color ? [] : null;
    this.r = opts.road ? [] : null;
    this.i = [];
  }
  get count() {
    return this.p.length / 3;
  }
  vert(x, y, z, nx, ny, nz, u, v, col, road) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.c) this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
    if (this.r) this.r.push(road ? road[0] : 0, road ? road[1] : 5);
    return this.count - 1;
  }
  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  out() {
    if (!this.i.length) return null;
    const o = {
      p: new Float32Array(this.p),
      n: new Float32Array(this.n),
      uv: new Float32Array(this.uv),
      i: this.count > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
    if (this.c) o.c = new Float32Array(this.c);
    if (this.r) o.r = new Float32Array(this.r);
    return o;
  }
}

// ------------------------------------------------------------ helpers
const COLORS = {
  white: [0.95, 0.95, 0.93], beige: [0.93, 0.86, 0.72], brown: [0.6, 0.45, 0.32], grey: [0.7, 0.7, 0.7], gray: [0.7, 0.7, 0.7],
  yellow: [0.95, 0.85, 0.55], red: [0.75, 0.35, 0.3], blue: [0.5, 0.65, 0.8], cream: [0.95, 0.9, 0.78], tan: [0.82, 0.7, 0.55],
  black: [0.25, 0.25, 0.27], green: [0.55, 0.7, 0.55], orange: [0.9, 0.6, 0.35], sand: [0.9, 0.8, 0.62],
};
function parseColour(s) {
  if (!s) return null;
  s = s.trim().toLowerCase();
  if (COLORS[s]) return COLORS[s];
  const m = s.match(/^#?([0-9a-f]{6})$/);
  if (m) {
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  return null;
}

const PLASTER = [[0.96, 0.92, 0.84], [0.93, 0.86, 0.74], [0.98, 0.97, 0.94], [0.88, 0.8, 0.68], [0.95, 0.9, 0.8], [0.9, 0.88, 0.85], [0.85, 0.78, 0.7]];

function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) a += (pts[j] - pts[i]) * (pts[j + 1] + pts[i + 1]);
  return a / 2;
}

/** flat [x,y,...] tile coords (y north) -> [[x, z], ...] local (z = -y), CCW seen from above */
function toXZ(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], -flat[i + 1]]);
  let a = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i++) a += (out[j][0] - out[i][0]) * (out[j][1] + out[i][1]);
  if (a > 0) out.reverse();
  return out;
}

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i][1] > z) !== (pts[j][1] > z) && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  }
  return inside;
}

/** Triangulated horizontal polygon with holes at height y. */
function flatPoly(g, outer, holes, y, uvScale, col) {
  const flat = [];
  const holeIdx = [];
  for (const [x, z] of outer) flat.push(x, z);
  for (const h of holes || []) {
    holeIdx.push(flat.length / 2);
    for (const [x, z] of h) flat.push(x, z);
  }
  const tris = Earcut.triangulate(flat, holeIdx, 2);
  const base = g.count;
  for (let i = 0; i < flat.length; i += 2) g.vert(flat[i], y, flat[i + 1], 0, 1, 0, flat[i] / uvScale, flat[i + 1] / uvScale, col);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    // make sure the triangle faces up
    const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx = flat[c * 2], cz = flat[c * 2 + 1];
    const cross = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (cross >= 0) g.tri(base + a, base + b, base + c);
    else g.tri(base + a, base + c, base + b);
  }
}

// ------------------------------------------------------------ main builder
export function buildTile(T, opts) {
  const q = opts.quality; // { props: bool, parked: bool, detail: 0..2 }
  const facades = opts.facades || []; // photo facade [{floors, bays}]
  const [tx, ty] = T.t;
  const ox = tx * TILE, oy = ty * TILE;
  const rand = rng((tx * 73856093) ^ (ty * 19349663));

  // nodes in local xz
  const N = T.ids.length;
  const px = new Float64Array(N), pz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = T.np[i * 2];
    pz[i] = -T.np[i * 2 + 1];
  }
  const roads = T.roads.map((r) => ({ ...r, width: roadWidth(r), rank: RANK[r.type] || 1 }));

  // node usage -> junctions (boundary nodes, negative ids, are never junctions)
  const deg = new Map();
  const nodeRoads = new Map();
  for (const r of roads) {
    r.n.forEach((n, k) => {
      const end = k === 0 || k === r.n.length - 1;
      deg.set(n, (deg.get(n) || 0) + (end ? 1 : 2));
      if (!nodeRoads.has(n)) nodeRoads.set(n, []);
      nodeRoads.get(n).push(r);
    });
  }
  const junctionR = new Map();
  for (const [n, d] of deg) {
    if (d >= 3 && T.ids[n] > 0) {
      let r = 0;
      for (const rd of nodeRoads.get(n)) r = Math.max(r, rd.width / 2 + 1);
      junctionR.set(n, r);
    }
  }

  const G = {
    ground: new Geo(), sea: new Geo(), road: new Geo({ road: true }), junction: new Geo({ road: true }), shoulder: new Geo(),
    sidewalk: new Geo(), kerb: new Geo(), kerbStriped: new Geo(), markW: new Geo(), markY: new Geo(),
    barrier: new Geo(), guardrail: new Geo(), roof: new Geo({ color: true }),
    park: new Geo(), golf: new Geo(), pitch: new Geo(), farm: new Geo(), mangrove: new Geo(), beach: new Geo(),
    parking: new Geo(), sandArea: new Geo(), water: new Geo(),
  };
  const walls = new Map(); // material key -> Geo(color)
  const wallGeo = (k) => {
    if (!walls.has(k)) walls.set(k, new Geo({ color: true }));
    return walls.get(k);
  };
  const inst = { palm: [], lamp: [], pool: [], speed: {}, stop: [], bench: [], bin: [], utility: [], shelter: [], parked: [], rooftop: [], dome: [], minaret: [], gantry: [] };

  // ---------------- ground + sea + land use
  const g = G.ground;
  const b0 = g.vert(0, 0, 0, 0, 1, 0, 0, 0), b1 = g.vert(TILE, 0, 0, 0, 1, 0, TILE / 10, 0);
  const b2 = g.vert(TILE, 0, -TILE, 0, 1, 0, TILE / 10, -TILE / 10), b3 = g.vert(0, 0, -TILE, 0, 1, 0, 0, -TILE / 10);
  g.i.push(b0, b1, b2, b0, b2, b3);
  for (const s of T.sea || []) flatPoly(G.sea, toXZ(s.p), (s.ho || []).map(toXZ), 0.02, 25);
  const AREA_GEO = { water: 'water', park: 'park', golf: 'golf', pitch: 'pitch', farm: 'farm', mangrove: 'mangrove', beach: 'beach', parking: 'parking', sand: 'sandArea' };
  const parkPolys = [];
  for (const a of T.areas || []) {
    const key = AREA_GEO[a.k];
    if (!key) continue;
    const outer = toXZ(a.p);
    flatPoly(G[key], outer, (a.ho || []).map(toXZ), a.k === 'water' ? 0.025 : 0.03, a.k === 'water' ? 25 : 8);
    if (a.k === 'park' || a.k === 'golf') parkPolys.push(outer);
  }

  // ---------------- buildings (also collision + props exclusion)
  const bGrid = new Map();
  const buildingPolys = [];
  const addToGrid = (pts, idx) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    for (let i = Math.floor(minX / 25); i <= Math.floor(maxX / 25); i++) {
      for (let j = Math.floor(minZ / 25); j <= Math.floor(maxZ / 25); j++) {
        const k = i * 1000 + j;
        if (!bGrid.has(k)) bGrid.set(k, []);
        bGrid.get(k).push(idx);
      }
    }
  };
  const inBuilding = (x, z, pad = 0) => {
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = bGrid.get((Math.floor(x / 25) + di) * 1000 + Math.floor(z / 25) + dj);
        if (!list) continue;
        for (const bi of list) {
          const p = buildingPolys[bi];
          if (pointInPoly(x, z, p)) return true;
          if (pad) {
            for (let i = 0; i < p.length; i++) {
              const a = p[i], b = p[(i + 1) % p.length];
              const dx = b[0] - a[0], dz = b[1] - a[1];
              const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
              if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < pad) return true;
            }
          }
        }
      }
    }
    return false;
  };

  const maxB = q.maxBuildings || 4000;
  (T.buildings || []).slice(0, maxB).forEach((b) => {
    const outer = toXZ(b.p);
    if (outer.length < 3) return;
    const holes = (b.ho || []).map(toXZ);
    const idx = buildingPolys.length;
    buildingPolys.push(outer);
    addToGrid(outer, idx);
    buildBuilding(b, outer, holes, wallGeo, G.roof, inst, facades, rand);
  });

  // ---------------- roads
  for (const r of roads) {
    const pts = r.n.map((n) => [px[n], pz[n]]);
    if (pts.length < 2) continue;
    const hw = r.width / 2;
    const trimA = junctionR.get(r.n[0]) || 0, trimB = junctionR.get(r.n[r.n.length - 1]) || 0;
    const motorway = r.rank >= 8 || r.type === 'motorway_link';
    roadRibbon(G.road, pts, r);
    if (motorway) {
      sideStrip(G.shoulder, pts, hw, hw + 2.2, 0.015, 4);
    } else if (r.rank >= 2) {
      sideStrip(G.sidewalk, pts, hw, hw + 3.4, 0.012, 3, !r.oneway);
    }
    // kerbs / barriers along the edges (trimmed at junctions)
    const trimmed = trimLine(pts, trimA + 1.5, trimB + 1.5);
    for (const seg of trimmed) {
      if (motorway) {
        if (r.oneway && r.rank >= 8) jersey(G.barrier, seg, -hw - 0.6);
        guardrail(G.guardrail, seg, hw + 1.4);
      } else if (r.rank >= 3) {
        const striped = r.rank >= 5;
        kerb(striped ? G.kerbStriped : G.kerb, seg, hw, striped);
        if (!r.oneway || r.rank < 5) kerb(striped ? G.kerbStriped : G.kerb, seg, -hw, striped);
        else kerb(striped ? G.kerbStriped : G.kerb, seg, -hw, striped);
      }
    }
    markings(G, r, pts, junctionR);
    if (q.props) roadProps(r, pts, hw, junctionR, inst, rand, inBuilding, motorway);
  }
  for (const [n, rad] of junctionR) {
    disc(G.junction, px[n], pz[n], rad + 0.6, 0.06, 20, true);
    disc(G.sidewalk, px[n], pz[n], rad + 3.6, 0.011, 16);
  }

  // ---------------- signals: stop lines + zebra crossings on every approach
  const signalApproaches = [];
  for (const n of T.signals || []) {
    const jr = junctionR.get(n) || 4;
    for (const r of nodeRoads.get(n) || []) {
      const k = r.n.indexOf(n);
      const froms = [];
      if (k > 0) froms.push(r.n[k - 1]);
      if (!r.oneway && k < r.n.length - 1) froms.push(r.n[k + 1]);
      for (const f of froms) {
        let dx = px[n] - px[f], dz = pz[n] - pz[f];
        const len = Math.hypot(dx, dz);
        if (len < 6) continue;
        dx /= len;
        dz /= len;
        const hw = r.width / 2;
        const from = r.oneway ? -hw + 0.3 : 0.2;
        signalApproaches.push({ node: n, dx, dz, back: Math.min(len - 1, jr + 4.5), hw, twoWay: !r.oneway });
        // stop line
        paintBar(G.markW, px[n], pz[n], dx, dz, jr + 4.5, 0.5, from, hw - 0.3);
        // zebra between the stop line and the junction (full road width)
        for (let s = -hw + 0.4; s < hw - 0.4; s += 1.0) paintBar(G.markW, px[n], pz[n], dx, dz, jr + 3.6, 3.0, s, s + 0.5);
      }
    }
  }

  // ---------------- props from OSM points
  if (q.props) {
    for (const [x, y] of T.bus || []) {
      const z = -y;
      const near = nearestSeg(roads, px, pz, x, z);
      if (!near) continue;
      inst.shelter.push(x, z, Math.atan2(-near.nz, -near.nx));
    }
    for (const [x, y] of T.trees || []) if (!inBuilding(x, -y)) inst.palm.push(x, -y, rand() * 6.28, 0.8 + rand() * 0.4);
    // palms and benches in parks
    for (const p of parkPolys) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of p) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const n = Math.min(40, Math.floor(((maxX - minX) * (maxZ - minZ)) / 900));
      for (let k = 0; k < n; k++) {
        const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
        if (pointInPoly(x, z, p) && !inBuilding(x, z, 2)) inst.palm.push(x, z, rand() * 6.28, 0.8 + rand() * 0.5);
      }
    }
  }

  // ---------------- minimap raster data (drawn on the main thread or in an OffscreenCanvas)
  const meshes = {};
  for (const [k, geo] of Object.entries(G)) {
    const o = geo.out();
    if (o) meshes[k] = o;
  }
  for (const [k, geo] of walls) {
    const o = geo.out();
    if (o) meshes[`wall:${k}`] = o;
  }
  const toF32 = (a) => new Float32Array(a);
  const instances = {};
  for (const [k, v] of Object.entries(inst)) {
    if (k === 'speed') {
      instances.speed = {};
      for (const [s, arr] of Object.entries(v)) instances.speed[s] = toF32(arr);
    } else if (k === 'gantry') instances.gantry = v;
    else if (v.length) instances[k] = toF32(v);
  }

  return {
    key: `${tx}_${ty}`,
    t: [tx, ty],
    origin: [ox, oy],
    emirate: emirateName(T.e),
    meshes,
    instances,
    graph: {
      ids: T.ids,
      xy: T.np, // tile-local (x, north)
      roads: T.roads.map((r) => ({ w: r.w, name: r.name, ref: r.ref || '', type: r.type, lanes: r.lanes, oneway: r.oneway, maxspeed: r.maxspeed, n: r.n, rb: r.rb || 0 })),
    },
    junctions: [...junctionR].map(([n, rr]) => [n, rr]),
    signals: T.signals || [],
    signalApproaches,
    stops: T.stops || [],
    cameras: T.cameras || [],
    tolls: T.tolls || [],
    rest: T.rest || [],
    buildings: buildingPolys.map((p) => toF32(p.flat())),
    buildingHeights: (T.buildings || []).slice(0, maxB).map((b) => b.h),
  };
}

// ------------------------------------------------------------ roads
function lateralNormals(pts) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n - 1, i + 1)];
    let ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    let tx = ax + bx, tz = az + bz;
    const lt = Math.hypot(tx, tz) || 1;
    tx /= lt; tz /= lt;
    const nx = -tz, nz = tx; // right-hand normal
    const cos = Math.max(0.5, nx * -az + nz * ax);
    out.push([nx / cos, nz / cos]);
  }
  return out;
}

function roadRibbon(g, pts, r) {
  const nrm = lateralNormals(pts);
  const hw = r.width / 2;
  const lanes = r.oneway ? r.lanes : Math.max(2, r.lanes);
  const laneW = r.width / lanes;
  const cols = [-hw, 0, hw];
  let v = 0;
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const row = cols.map((o) => {
      const lane = r.oneway ? (o + hw) / laneW : o / laneW;
      const edge = hw - Math.abs(o);
      return g.vert(pts[i][0] + nrm[i][0] * o, 0.05, pts[i][1] + nrm[i][1] * o, 0, 1, 0, o / 4, v / 4, null, [lane, edge]);
    });
    if (prev) {
      for (let c = 0; c < 2; c++) g.quad(prev[c], prev[c + 1], row[c + 1], row[c]);
    }
    prev = row;
  }
}

function sideStrip(g, pts, from, to, y, uvScale, both = true) {
  const nrm = lateralNormals(pts);
  for (const side of both ? [1, -1] : [1, -1]) {
    let v = 0;
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const a = side * from, b = side * to;
      const r0 = g.vert(pts[i][0] + nrm[i][0] * a, y, pts[i][1] + nrm[i][1] * a, 0, 1, 0, a / uvScale, v / uvScale);
      const r1 = g.vert(pts[i][0] + nrm[i][0] * b, y, pts[i][1] + nrm[i][1] * b, 0, 1, 0, b / uvScale, v / uvScale);
      if (prev) {
        if (side > 0) g.quad(prev[0], prev[1], r1, r0);
        else g.quad(prev[1], prev[0], r0, r1);
      }
      prev = [r0, r1];
    }
  }
}

/** Split a polyline, trimming `a` metres off the start and `b` off the end. */
function trimLine(pts, a, b) {
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cum.push(total);
  }
  if (total - a - b < 2) return [];
  const at = (s) => {
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] >= s) {
        const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
    }
    return pts[pts.length - 1];
  };
  const out = [at(a)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > a && cum[i] < total - b) out.push(pts[i]);
  out.push(at(total - b));
  return [out];
}

/** Raised kerb (15 cm) along an offset line: top face + face towards the road. */
function kerb(g, pts, off, striped) {
  const nrm = lateralNormals(pts);
  const s = Math.sign(off);
  const inner = off, outer = off + s * 0.25;
  let v = 0;
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [nx, nz] = nrm[i];
    const x = pts[i][0], z = pts[i][1];
    const uv = striped ? v / 2 : v / 2;
    const a = g.vert(x + nx * inner, 0.05, z + nz * inner, -nx * s, 0, -nz * s, 0, uv);
    const b = g.vert(x + nx * inner, 0.2, z + nz * inner, -nx * s, 0, -nz * s, 0.5, uv);
    const c = g.vert(x + nx * inner, 0.2, z + nz * inner, 0, 1, 0, 0.5, uv);
    const d = g.vert(x + nx * outer, 0.2, z + nz * outer, 0, 1, 0, 1, uv);
    if (prev) {
      if (s > 0) {
        g.quad(prev[0], a, b, prev[1]);
        g.quad(prev[2], c, d, prev[3]);
      } else {
        g.quad(prev[0], prev[1], b, a);
        g.quad(prev[2], prev[3], d, c);
      }
    }
    prev = [a, b, c, d];
  }
}

/** Concrete jersey barrier (median) along an offset line. */
function jersey(g, pts, off) {
  const nrm = lateralNormals(pts);
  const profile = [[-0.3, 0], [-0.22, 0.25], [-0.08, 0.82], [0.08, 0.82], [0.22, 0.25], [0.3, 0]];
  let v = 0;
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [nx, nz] = nrm[i];
    const row = profile.map(([o, y], k) => {
      const ln = Math.hypot(nx, nz) || 1;
      // approximate outward normal for the profile facet
      const up = k === 2 || k === 3 ? 1 : 0.3;
      const side = o < 0 ? -1 : 1;
      return g.vert(pts[i][0] + nx * (off + o), y, pts[i][1] + nz * (off + o), (nx / ln) * side * (1 - up), up, (nz / ln) * side * (1 - up), k / 5, v / 3);
    });
    if (prev) for (let k = 0; k < profile.length - 1; k++) g.quad(prev[k], row[k], row[k + 1], prev[k + 1]);
    prev = row;
  }
}

function guardrail(g, pts, off) {
  const nrm = lateralNormals(pts);
  let v = 0;
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [nx, nz] = nrm[i];
    const x = pts[i][0] + nx * off, z = pts[i][1] + nz * off;
    const a = g.vert(x, 0.45, z, -nx, 0, -nz, 0, v);
    const b = g.vert(x, 0.78, z, -nx, 0, -nz, 1, v);
    if (prev) {
      g.quad(prev[0], a, b, prev[1]);
      g.quad(prev[1], b, a, prev[0]);
    }
    prev = [a, b];
  }
  // posts every 4 m
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dz);
    for (let s = (4 - acc) % 4; s < len; s += 4) {
      const t = s / len;
      const [nx, nz] = nrm[i];
      const x = pts[i - 1][0] + dx * t + nx * (off + 0.08), z = pts[i - 1][1] + dz * t + nz * (off + 0.08);
      box(g, x, 0.4, z, 0.1, 0.8, 0.1);
    }
    acc = (acc + len) % 4;
  }
}

function box(g, cx, cy, cz, sx, sy, sz) {
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  for (const [n, vs] of faces) {
    const ids = vs.map(([x, y, z], k) => g.vert(cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2, n[0], n[1], n[2], k & 1, k >> 1));
    g.quad(ids[0], ids[3], ids[2], ids[1]);
  }
}

function disc(g, x, z, r, y, segs, road) {
  const c = g.vert(x, y, z, 0, 1, 0, x / 4, z / 4, null, road ? [0.5, 5] : null);
  const ids = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ids.push(g.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 1, 0, (x + Math.cos(a) * r) / 4, (z + Math.sin(a) * r) / 4, null, road ? [0.5, 5] : null));
  }
  for (let i = 0; i < segs; i++) g.tri(c, ids[i + 1], ids[i]);
}

function paintQuad(g, a, b, off, w, dash, trimA, trimB) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ux = dx / len, uz = dz / len, rx = -uz, rz = ux;
  const start = trimA, end = len - trimB;
  if (end - start < 0.5) return;
  const emit = (s0, s1) => {
    const hw = w / 2;
    const p0x = a[0] + ux * s0 + rx * off, p0z = a[1] + uz * s0 + rz * off;
    const p1x = a[0] + ux * s1 + rx * off, p1z = a[1] + uz * s1 + rz * off;
    const i0 = g.vert(p0x - rx * hw, 0.09, p0z - rz * hw, 0, 1, 0, p0x / 3, p0z / 3);
    const i1 = g.vert(p0x + rx * hw, 0.09, p0z + rz * hw, 0, 1, 0, (p0x + 0.3) / 3, p0z / 3);
    const i2 = g.vert(p1x + rx * hw, 0.09, p1z + rz * hw, 0, 1, 0, (p1x + 0.3) / 3, p1z / 3);
    const i3 = g.vert(p1x - rx * hw, 0.09, p1z - rz * hw, 0, 1, 0, p1x / 3, p1z / 3);
    g.quad(i0, i1, i2, i3);
  };
  if (!dash) emit(start, end);
  else for (let s = start; s < end; s += dash[0] + dash[1]) emit(s, Math.min(end, s + dash[0]));
}

/** A bar across the road: `back` metres before node n along -d, `depth` deep, lateral from..to. */
function paintBar(g, x, z, dx, dz, back, depth, from, to) {
  const rx = -dz, rz = dx;
  const cx = x - dx * back, cz = z - dz * back;
  const p = (o, f) => [cx + rx * o + dx * f, cz + rz * o + dz * f];
  const a = p(from, -depth), b = p(to, -depth), c = p(to, 0), d = p(from, 0);
  const ids = [a, b, c, d].map(([px_, pz_]) => g.vert(px_, 0.095, pz_, 0, 1, 0, px_ / 3, pz_ / 3));
  g.quad(ids[0], ids[1], ids[2], ids[3]);
}

function markings(G, r, pts, junctionR) {
  const hw = r.width / 2;
  const lanes = r.oneway ? r.lanes : Math.max(2, r.lanes);
  const lpd = r.oneway ? r.lanes : Math.max(1, Math.floor(r.lanes / 2));
  for (let i = 1; i < pts.length; i++) {
    const na = r.n[i - 1], nb = r.n[i];
    const tA = junctionR.has(na) ? junctionR.get(na) + 1 : 0;
    const tB = junctionR.has(nb) ? junctionR.get(nb) + 1 : 0;
    const a = pts[i - 1], b = pts[i];
    if (r.oneway) {
      paintQuad(G.markY, a, b, -hw + 0.35, 0.15, null, tA, tB);
      paintQuad(G.markW, a, b, hw - 0.35, 0.15, null, tA, tB);
      const lw = (r.width - 0.7) / lanes;
      for (let k = 1; k < lanes; k++) paintQuad(G.markW, a, b, -hw + 0.35 + lw * k, 0.13, [3, 6], tA, tB);
    } else if (r.rank >= 3) {
      paintQuad(G.markW, a, b, hw - 0.35, 0.14, null, tA, tB);
      paintQuad(G.markW, a, b, -hw + 0.35, 0.14, null, tA, tB);
      if (lpd >= 2) {
        paintQuad(G.markY, a, b, 0.15, 0.12, null, tA, tB);
        paintQuad(G.markY, a, b, -0.15, 0.12, null, tA, tB);
        const lw = (hw - 0.35) / lpd;
        for (let k = 1; k < lpd; k++) {
          paintQuad(G.markW, a, b, lw * k, 0.12, [3, 6], tA, tB);
          paintQuad(G.markW, a, b, -lw * k, 0.12, [3, 6], tA, tB);
        }
      } else {
        paintQuad(G.markW, a, b, 0, 0.12, [3, 5], tA, tB);
      }
    }
  }
}

function nearestSeg(roads, px, pz, x, z) {
  let best = null, bd = 40;
  for (const r of roads) {
    for (let i = 1; i < r.n.length; i++) {
      const ax = px[r.n[i - 1]], az = pz[r.n[i - 1]], bx = px[r.n[i]], bz = pz[r.n[i]];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const cx = ax + dx * t, cz = az + dz * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < bd) {
        bd = d;
        const l = Math.hypot(x - cx, z - cz) || 1;
        best = { nx: (x - cx) / l, nz: (z - cz) / l, road: r };
      }
    }
  }
  return best;
}

// ------------------------------------------------------------ props along roads
function roadProps(r, pts, hw, junctionR, inst, rand, inBuilding, motorway) {
  const nearJ = (x, z, d) => {
    for (const n of [r.n[0], r.n[r.n.length - 1]]) {
      // only ends can be junctions for a split piece, but check all nodes cheaply
      void n;
    }
    for (let k = 0; k < r.n.length; k++) {
      const jr = junctionR.get(r.n[k]);
      if (jr !== undefined && Math.hypot(pts[k][0] - x, pts[k][1] - z) < jr + d) return true;
    }
    return false;
  };
  let palmAcc = rand() * 18, lampAcc = rand() * 40, furnAcc = rand() * 60, parkAcc = rand() * 7;
  let signDone = false;
  let gantryAcc = 600 + rand() * 600;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const ux = dx / len, uz = dz / len, rx = -uz, rz = ux;
    const rot = Math.atan2(-ux, -uz); // local +Z faces oncoming traffic
    // speed limit sign at the start of long roads (each direction)
    if (!signDone && r.rank >= 3 && len > 40) {
      signDone = true;
      const s = Math.min(len - 5, 18);
      const off = hw + 1.4;
      const key = String(r.maxspeed);
      if (!inst.speed[key]) inst.speed[key] = [];
      inst.speed[key].push(a[0] + ux * s + rx * off, a[1] + uz * s + rz * off, rot);
      if (!r.oneway) inst.speed[key].push(b[0] - ux * s - rx * off, b[1] - uz * s - rz * off, rot + Math.PI);
    }
    // palms on urban roads
    if (!motorway && r.rank >= 5) {
      for (let s = palmAcc; s < len; s += 18) {
        const x = a[0] + ux * s, z = a[1] + uz * s;
        if (nearJ(x, z, 14)) continue;
        for (const side of r.oneway ? [1, -1] : [1, -1]) {
          const off = side * (hw + 2.3);
          const qx = x + rx * off, qz = z + rz * off;
          if (!inBuilding(qx, qz, 1.5)) inst.palm.push(qx, qz, rand() * 6.28, 0.85 + rand() * 0.35);
        }
      }
      palmAcc = ((palmAcc - len) % 18 + 18) % 18;
    }
    // street lights: double-arm on the median of dual carriageways, single-arm elsewhere
    if (r.rank >= 5) {
      for (let s = lampAcc; s < len; s += 40) {
        const x = a[0] + ux * s, z = a[1] + uz * s;
        if (nearJ(x, z, 10)) continue;
        if (r.oneway) {
          const off = -hw - 1.2;
          const qx = x + rx * off, qz = z + rz * off;
          inst.lamp.push(qx, qz, rot + Math.PI / 2, 1);
          inst.pool.push(x + rx * (-hw + 3), z + rz * (-hw + 3), 0);
        } else {
          const off = hw + 1.0;
          const qx = x + rx * off, qz = z + rz * off;
          if (!inBuilding(qx, qz, 1)) {
            inst.lamp.push(qx, qz, rot - Math.PI / 2, 0);
            inst.pool.push(x + rx * (hw - 2.5), z + rz * (hw - 2.5), 0);
          }
        }
      }
      lampAcc = ((lampAcc - len) % 40 + 40) % 40;
    }
    // street furniture on urban roads
    if (!motorway && r.rank >= 3 && r.rank <= 7) {
      for (let s = furnAcc; s < len; s += 55) {
        const x = a[0] + ux * s, z = a[1] + uz * s;
        if (nearJ(x, z, 12)) continue;
        const off = hw + 3.0;
        const qx = x + rx * off, qz = z + rz * off;
        if (inBuilding(qx, qz, 1)) continue;
        const pick = rand();
        const list = pick < 0.4 ? inst.bench : pick < 0.75 ? inst.bin : inst.utility;
        list.push(qx, qz, rot - Math.PI / 2);
      }
      furnAcc = ((furnAcc - len) % 55 + 55) % 55;
    }
    // parked cars along residential streets
    if (r.type === 'residential' || r.type === 'unclassified' || r.type === 'living_street') {
      for (let s = parkAcc; s < len; s += 6.5) {
        if (rand() > 0.33) continue;
        const x = a[0] + ux * s, z = a[1] + uz * s;
        if (nearJ(x, z, 8)) continue;
        const side = rand() < 0.5 ? 1 : -1;
        const off = side * (hw + 1.35);
        const qx = x + rx * off, qz = z + rz * off;
        if (inBuilding(qx, qz, 1.4)) continue;
        inst.parked.push(qx, qz, rot + (side > 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.08, Math.floor(rand() * 64));
      }
      parkAcc = ((parkAcc - len) % 6.5 + 6.5) % 6.5;
    }
    // overhead direction gantries on motorways / trunks
    if (r.rank >= 8 && r.oneway) {
      gantryAcc -= len;
      if (gantryAcc < 0 && len > 30) {
        gantryAcc = 1100 + rand() * 500;
        const s = len / 2;
        inst.gantry.push({ x: a[0] + ux * s, z: a[1] + uz * s, rot, width: r.width + 3, name: r.name || '', ref: r.ref || '' });
      }
    }
  }
}

// ------------------------------------------------------------ buildings
function hashId(id) {
  let h = Math.floor(Math.abs(id)) % 2147483647;
  h = (h * 48271) % 2147483647;
  return h / 2147483647;
}

function pickStyle(b, facades) {
  const h = b.h, k = b.k || '', r = hashId(b.id || h * 97);
  if (k === 'mosque') return 'mosque';
  if (k === 'industrial' || k === 'warehouse' || k === 'hangar') return 'ind';
  if (h >= 45) {
    if (r < 0.62) return `glass${Math.floor(r * 100) % 4}`;
    if (r < 0.8 || !facades.length) return 'office';
    return `photo${Math.floor(r * 1000) % facades.length}`;
  }
  if (h >= 11) {
    if (facades.length && r < 0.3) return `photo${Math.floor(r * 1000) % facades.length}`;
    if (r < 0.8) return `apt${Math.floor(r * 100) % 3}`;
    return 'office';
  }
  if (k === 'retail' || k === 'commercial') return 'shop';
  return 'villa';
}

function facadeScale(style, facades) {
  if (style.startsWith('photo')) {
    const f = facades[+style.slice(5)] || { floors: 3, bays: 3 };
    return [Math.max(3, f.bays * 3.3), Math.max(3, f.floors * 3.3)];
  }
  if (style === 'ind') return [8, 8];
  if (style === 'shop') return [9.9, 5];
  return [9.9, 9.9];
}

function wallRing(g, pts, y0, y1, uScale, vScale, col, vOffset = 0) {
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = -dz / len, nz = dx / len; // outward for CCW rings (seen from above)
    // snap the facade repeat to whole bays per wall so windows are not cut in half
    const u2 = u + Math.max(1, Math.round(len / uScale));
    const v0 = (y0 - vOffset) / vScale, v1 = (y1 - vOffset) / vScale;
    const i0 = g.vert(a[0], y0, a[1], nx, 0, nz, u, v0, col);
    const i1 = g.vert(c[0], y0, c[1], nx, 0, nz, u2, v0, col);
    const i2 = g.vert(c[0], y1, c[1], nx, 0, nz, u2, v1, col);
    const i3 = g.vert(a[0], y1, a[1], nx, 0, nz, u, v1, col);
    g.quad(i0, i1, i2, i3);
    u = u2;
  }
}

function shrink(pts, f) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) {
    cx += x;
    cz += z;
  }
  cx /= pts.length;
  cz /= pts.length;
  return pts.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f]);
}

function buildBuilding(b, outer, holes, wallGeo, roofGeo, inst, facades, rand) {
  const h = Math.max(3.5, b.h), mh = b.mh || 0;
  const style = pickStyle(b, facades);
  const r = hashId((b.id || 1) * 7 + 3);
  let tint = parseColour(b.c);
  if (!tint) {
    if (style.startsWith('glass') || style.startsWith('photo') || style === 'office') {
      const k = 0.88 + r * 0.24;
      tint = [k, k, k];
    } else tint = PLASTER[Math.floor(r * PLASTER.length)];
  }
  const [us, vs] = facadeScale(style, facades);
  const wallKey = style === 'mosque' ? 'mosque' : style;
  const g = wallGeo(wallKey);
  const area = Math.abs(ringArea(outer.flat()));

  // shop fronts at street level for mid-rise buildings
  let y0 = mh;
  if (!mh && h >= 11 && h < 45 && r < 0.55 && style !== 'mosque') {
    wallRing(wallGeo('shop'), outer, 0, 4.6, 9.9, 4.6, [1, 1, 1]);
    y0 = 4.6;
  }
  const roofCol = [tint[0] * 0.78, tint[1] * 0.78, tint[2] * 0.78];
  if (h >= 110 && area > 300) {
    // setback tiers for towers
    const tiers = h >= 250 ? [[y0, h * 0.55, 1], [h * 0.55, h * 0.82, 0.78], [h * 0.82, h, 0.55]] : [[y0, h * 0.68, 1], [h * 0.68, h, 0.82]];
    let prev = null;
    for (const [a, top, s] of tiers) {
      const ring = s === 1 ? outer : shrink(outer, s);
      wallRing(g, ring, a, top + 1, us, vs, tint);
      if (prev) flatPoly(roofGeo, prev, [ring], a, 6, roofCol);
      prev = ring;
    }
    flatPoly(roofGeo, prev, [], h, 6, roofCol);
    if (h >= 250) {
      // spire
      let cx = 0, cz = 0;
      for (const [x, z] of outer) {
        cx += x;
        cz += z;
      }
      inst.minaret.push(cx / outer.length, h, cz / outer.length, 2.2, h * 0.18, 1);
    }
  } else {
    wallRing(g, outer, y0, h + (h > 6 ? 0.9 : 0), us, vs, tint); // +0.9 m parapet
    for (const hole of holes) wallRing(g, [...hole].reverse(), y0, h, us, vs, tint);
    flatPoly(roofGeo, outer, holes, h, 6, roofCol);
  }

  // rooftop plant: chillers / water tanks
  if (h > 6 && area > 120 && style !== 'mosque') {
    const n = Math.min(5, 1 + Math.floor(area / 400));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of outer) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    for (let k = 0; k < n * 3 && k < 15; k++) {
      const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
      if (!pointInPoly(x, z, outer)) continue;
      const sx = 1.5 + rand() * 3, sz = 1.2 + rand() * 2.5, sy = 1 + rand() * 1.8;
      inst.rooftop.push(x, (h >= 110 ? h : h) + sy / 2, z, rand() * 3.14, sx, sy, sz);
    }
  }
  if (style === 'mosque') {
    let cx = 0, cz = 0;
    for (const [x, z] of outer) {
      cx += x;
      cz += z;
    }
    cx /= outer.length;
    cz /= outer.length;
    const rad = Math.min(12, Math.sqrt(area) / 3.2);
    inst.dome.push(cx, h, cz, rad, r < 0.3 ? 1 : 0);
    // minaret at the first corner
    inst.minaret.push(outer[0][0], 0, outer[0][1], 1.6, Math.max(18, h * 2.4), 0);
  }
}
