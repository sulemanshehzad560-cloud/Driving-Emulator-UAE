// Road network graph: directed edges for traffic + routing, and a spatial
// index of segments for "which road am I on" queries.
// World coordinates: X = east, Z = south (Three.js convention, north = -Z).
import { ROAD_TYPES } from './osm.js';

export const LANE_W = 3.5;

export function roadWidth(road) {
  const def = ROAD_TYPES[road.type] || ROAD_TYPES.residential;
  const lanes = road.oneway ? road.lanes : Math.max(2, road.lanes);
  return Math.max(road.oneway ? 4 : 6, lanes * def.width);
}

export function lanesPerDirection(road) {
  return road.oneway ? road.lanes : Math.max(1, Math.floor(road.lanes / 2));
}

export class RoadGraph {
  constructor(map) {
    this.map = map;
    // map y (north) -> world z (south)
    this.pts = map.nodes.map((p) => (p ? [p[0], -p[1]] : [0, 0]));
    this.roads = map.roads.map((r, i) => ({ ...r, id: i, width: roadWidth(r), rank: (ROAD_TYPES[r.type] || ROAD_TYPES.residential).rank }));
    this.out = new Map(); // node -> [edge]
    this.edges = [];
    this.nodeRoads = new Map(); // node -> Set(roadId)
    this.segments = []; // {a, b, road}

    for (const road of this.roads) {
      for (let i = 0; i < road.n.length; i++) {
        const n = road.n[i];
        if (!this.nodeRoads.has(n)) this.nodeRoads.set(n, new Set());
        this.nodeRoads.get(n).add(road.id);
        if (i === 0) continue;
        const a = road.n[i - 1];
        if (a === n) continue;
        this.segments.push({ a, b: n, road });
        this.addEdge(a, n, road);
        if (!road.oneway) this.addEdge(n, a, road);
      }
    }
    this.degree = new Map();
    for (const [n, set] of this.nodeRoads) {
      let d = 0;
      for (const rid of set) {
        const r = this.roads[rid];
        const k = r.n.indexOf(n);
        d += k === 0 || k === r.n.length - 1 ? 1 : 2;
      }
      this.degree.set(n, d);
    }
    this.buildIndex();
  }

  addEdge(a, b, road) {
    const pa = this.pts[a];
    const pb = this.pts[b];
    const dx = pb[0] - pa[0];
    const dz = pb[1] - pa[1];
    const len = Math.hypot(dx, dz) || 0.01;
    const e = { id: this.edges.length, a, b, road, len, dx: dx / len, dz: dz / len };
    this.edges.push(e);
    if (!this.out.has(a)) this.out.set(a, []);
    this.out.get(a).push(e);
  }

  isJunction(n) {
    return (this.degree.get(n) || 0) >= 3;
  }

  buildIndex() {
    this.cell = 40;
    this.grid = new Map();
    const key = (i, j) => i * 100003 + j;
    this.segments.forEach((s, idx) => {
      const pa = this.pts[s.a];
      const pb = this.pts[s.b];
      const pad = s.road.width / 2;
      const i0 = Math.floor((Math.min(pa[0], pb[0]) - pad) / this.cell);
      const i1 = Math.floor((Math.max(pa[0], pb[0]) + pad) / this.cell);
      const j0 = Math.floor((Math.min(pa[1], pb[1]) - pad) / this.cell);
      const j1 = Math.floor((Math.max(pa[1], pb[1]) + pad) / this.cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = key(i, j);
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(idx);
        }
      }
    });
    this._key = key;
  }

  /** Nearest road segment to (x, z). Returns null if nothing within `maxDist`. */
  nearest(x, z, maxDist = 30, heading = null) {
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    let best = null;
    let bestScore = Infinity;
    const seen = new Set();
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.grid.get(this._key(i, j));
        if (!list) continue;
        for (const idx of list) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const s = this.segments[idx];
          const pa = this.pts[s.a];
          const pb = this.pts[s.b];
          const dx = pb[0] - pa[0];
          const dz = pb[1] - pa[1];
          const l2 = dx * dx + dz * dz || 1;
          let t = ((x - pa[0]) * dx + (z - pa[1]) * dz) / l2;
          t = Math.max(0, Math.min(1, t));
          const px = pa[0] + dx * t;
          const pz = pa[1] + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d > maxDist) continue;
          let score = d - s.road.width / 2 - s.road.rank * 0.3;
          if (heading) {
            // prefer segments aligned with the driving direction
            const l = Math.sqrt(l2);
            const align = Math.abs((dx / l) * heading[0] + (dz / l) * heading[1]);
            score -= align * 3;
          }
          if (score < bestScore) {
            bestScore = score;
            best = { seg: s, road: s.road, dist: d, t, px, pz, dx, dz, onRoad: d <= s.road.width / 2 + 0.8 };
          }
        }
      }
    }
    return best;
  }

  nearestNode(x, z) {
    let best = -1;
    let bd = Infinity;
    for (const n of this.out.keys()) {
      const p = this.pts[n];
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** A* shortest path, returns node list or null. */
  route(from, to) {
    if (from === to) return [from];
    const pt = this.pts;
    const h = (n) => Math.hypot(pt[n][0] - pt[to][0], pt[n][1] - pt[to][1]);
    const g = new Map([[from, 0]]);
    const prev = new Map();
    const open = [[h(from), from]];
    const closed = new Set();
    while (open.length) {
      // binary-heap-free min extraction is fine for a few thousand nodes
      let mi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
      const [, n] = open[mi];
      open[mi] = open[open.length - 1];
      open.pop();
      if (n === to) break;
      if (closed.has(n)) continue;
      closed.add(n);
      for (const e of this.out.get(n) || []) {
        const cost = g.get(n) + e.len / Math.max(20, e.road.maxspeed);
        if (cost < (g.get(e.b) ?? Infinity)) {
          g.set(e.b, cost);
          prev.set(e.b, n);
          open.push([cost + h(e.b) / 120, e.b]);
        }
      }
      if (closed.size > 60000) break;
    }
    if (!prev.has(to)) return null;
    const path = [to];
    let n = to;
    while (n !== from) {
      n = prev.get(n);
      path.push(n);
    }
    return path.reverse();
  }
}
