// Dynamic road graph for the streamed world. Tiles add and remove their road
// pieces; pieces from neighbouring tiles join through shared border nodes.
// World space: X = east, Z = -north.
import { roadWidth } from './tileBuild.js';

const RANK = {
  motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, motorway_link: 4, trunk_link: 4, primary_link: 4,
  secondary_link: 4, tertiary_link: 4, unclassified: 3, residential: 3, living_street: 2, service: 1,
};
export const LANE_W = 3.5;
const CELL = 40;
const gkey = (i, j) => i * 1000003 + j;

export function lanesPerDirection(road) {
  return road.oneway ? road.lanes : Math.max(1, Math.floor(road.lanes / 2));
}

export class DynamicGraph {
  constructor() {
    this.nodes = new Map(); // id -> {x, z, refs}
    this.out = new Map(); // id -> [edge]
    this.nodeRoads = new Map(); // id -> Set(road)
    this.grid = new Map(); // cell -> [segment]
    this.tiles = new Map(); // key -> {roads, edges, segs, cells}
    this.edgeSeq = 0;
    this.version = 0;
    this.edges = []; // live edges (rebuilt lazily for spawning)
    this._edgesDirty = true;
  }

  addTile(key, origin, g) {
    const [ox, oy] = origin;
    const rec = { roads: [], edges: [], segs: [], cells: new Set(), nodes: [] };
    for (let i = 0; i < g.ids.length; i++) {
      const id = g.ids[i];
      let n = this.nodes.get(id);
      if (!n) {
        n = { x: ox + g.xy[i * 2], z: -(oy + g.xy[i * 2 + 1]), refs: 0 };
        this.nodes.set(id, n);
      }
      n.refs++;
      rec.nodes.push(id);
    }
    for (const r of g.roads) {
      const road = {
        ...r,
        tile: key,
        ids: r.n.map((k) => g.ids[k]),
        width: roadWidth(r),
        rank: RANK[r.type] || 1,
      };
      rec.roads.push(road);
      for (let k = 0; k < road.ids.length; k++) {
        const id = road.ids[k];
        if (!this.nodeRoads.has(id)) this.nodeRoads.set(id, new Set());
        this.nodeRoads.get(id).add(road);
        if (k === 0) continue;
        const a = road.ids[k - 1];
        if (a === id) continue;
        const seg = { a, b: id, road };
        rec.segs.push(seg);
        this.indexSeg(seg, rec.cells);
        rec.edges.push(this.addEdge(a, id, road));
        if (!road.oneway) rec.edges.push(this.addEdge(id, a, road));
      }
    }
    this.tiles.set(key, rec);
    this.version++;
    this._edgesDirty = true;
  }

  removeTile(key) {
    const rec = this.tiles.get(key);
    if (!rec) return;
    for (const e of rec.edges) {
      e.alive = false;
      const list = this.out.get(e.a);
      if (list) {
        const i = list.indexOf(e);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.out.delete(e.a);
      }
    }
    for (const road of rec.roads) {
      for (const id of road.ids) {
        const s = this.nodeRoads.get(id);
        if (s) {
          s.delete(road);
          if (!s.size) this.nodeRoads.delete(id);
        }
      }
    }
    for (const c of rec.cells) {
      const list = this.grid.get(c);
      if (!list) continue;
      const kept = list.filter((s) => s.road.tile !== key);
      if (kept.length) this.grid.set(c, kept);
      else this.grid.delete(c);
    }
    for (const id of rec.nodes) {
      const n = this.nodes.get(id);
      if (n && --n.refs <= 0) this.nodes.delete(id);
    }
    this.tiles.delete(key);
    this.version++;
    this._edgesDirty = true;
  }

  addEdge(a, b, road) {
    const pa = this.nodes.get(a), pb = this.nodes.get(b);
    const dx = pb.x - pa.x, dz = pb.z - pa.z;
    const len = Math.hypot(dx, dz) || 0.01;
    const e = { id: this.edgeSeq++, a, b, road, len, dx: dx / len, dz: dz / len, alive: true };
    if (!this.out.has(a)) this.out.set(a, []);
    this.out.get(a).push(e);
    return e;
  }

  indexSeg(seg, cells) {
    const pa = this.nodes.get(seg.a), pb = this.nodes.get(seg.b);
    const pad = seg.road.width / 2;
    for (let i = Math.floor((Math.min(pa.x, pb.x) - pad) / CELL); i <= Math.floor((Math.max(pa.x, pb.x) + pad) / CELL); i++) {
      for (let j = Math.floor((Math.min(pa.z, pb.z) - pad) / CELL); j <= Math.floor((Math.max(pa.z, pb.z) + pad) / CELL); j++) {
        const k = gkey(i, j);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(seg);
        cells.add(k);
      }
    }
  }

  get liveEdges() {
    if (this._edgesDirty) {
      this.edges = [];
      for (const rec of this.tiles.values()) for (const e of rec.edges) if (e.alive) this.edges.push(e);
      this._edgesDirty = false;
    }
    return this.edges;
  }

  pt(id) {
    return this.nodes.get(id);
  }

  degree(id) {
    const s = this.nodeRoads.get(id);
    if (!s) return 0;
    let d = 0;
    for (const r of s) {
      const k = r.ids.indexOf(id);
      d += k === 0 || k === r.ids.length - 1 ? 1 : 2;
    }
    return d;
  }

  isJunction(id) {
    return id > 0 && this.degree(id) >= 3;
  }

  /** Nearest road segment to (x, z). */
  /** Good place to start a drive: a long, major (but not motorway) road near the point. */
  spawnPoint(x, z, radius = 450) {
    const r = Math.ceil(radius / CELL);
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let best = null, bestScore = Infinity;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.grid.get(gkey(i, j));
        if (!list) continue;
        for (const s of list) {
          const pa = this.nodes.get(s.a), pb = this.nodes.get(s.b);
          if (!pa || !pb) continue;
          const dx = pb.x - pa.x, dz = pb.z - pa.z;
          const len = Math.hypot(dx, dz);
          if (len < 25) continue;
          const px = (pa.x + pb.x) / 2, pz = (pa.z + pb.z) / 2;
          const d = Math.hypot(x - px, z - pz);
          if (d > radius) continue;
          const rank = s.road.rank;
          const pref = rank >= 8 ? 4 : rank; // motorways are fine, but city streets read better at the start
          const score = d - pref * 45 - Math.min(len, 120) * 0.4;
          if (score < bestScore) {
            bestScore = score;
            best = { seg: s, road: s.road, dist: d, t: 0.5, px, pz, dx, dz, onRoad: true };
          }
        }
      }
    }
    return best;
  }

  nearest(x, z, maxDist = 30, heading = null) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let best = null, bestScore = Infinity;
    const seen = new Set();
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.grid.get(gkey(i, j));
        if (!list) continue;
        for (const s of list) {
          if (seen.has(s)) continue;
          seen.add(s);
          const pa = this.nodes.get(s.a), pb = this.nodes.get(s.b);
          if (!pa || !pb) continue;
          const dx = pb.x - pa.x, dz = pb.z - pa.z;
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - pa.x) * dx + (z - pa.z) * dz) / l2));
          const px = pa.x + dx * t, pz = pa.z + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d > maxDist) continue;
          let score = d - s.road.width / 2 - s.road.rank * 0.3;
          if (heading) {
            const l = Math.sqrt(l2);
            score -= Math.abs((dx / l) * heading[0] + (dz / l) * heading[1]) * 3;
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

  nearestNode(x, z, maxDist = 400) {
    let best = null, bd = maxDist * maxDist;
    const r = Math.ceil(maxDist / CELL);
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.grid.get(gkey(i, j));
        if (!list) continue;
        for (const s of list) {
          for (const id of [s.a, s.b]) {
            if (!this.out.has(id)) continue;
            const p = this.nodes.get(id);
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < bd) {
              bd = d;
              best = id;
            }
          }
        }
      }
    }
    return best;
  }

  /** A* over the loaded road network. Returns a list of node ids or null. */
  route(from, to, limit = 80000) {
    if (from == null || to == null) return null;
    if (from === to) return [from];
    const tp = this.nodes.get(to);
    if (!tp) return null;
    const h = (id) => {
      const p = this.nodes.get(id);
      return Math.hypot(p.x - tp.x, p.z - tp.z) / 33;
    };
    const g = new Map([[from, 0]]);
    const prev = new Map();
    const heap = new MinHeap();
    heap.push(h(from), from);
    const closed = new Set();
    while (heap.size) {
      const n = heap.pop();
      if (n === to) break;
      if (closed.has(n)) continue;
      closed.add(n);
      if (closed.size > limit) break;
      for (const e of this.out.get(n) || []) {
        const cost = g.get(n) + e.len / Math.max(5, e.road.maxspeed / 3.6);
        if (cost < (g.get(e.b) ?? Infinity)) {
          g.set(e.b, cost);
          prev.set(e.b, n);
          heap.push(cost + h(e.b), e.b);
        }
      }
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

export class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
