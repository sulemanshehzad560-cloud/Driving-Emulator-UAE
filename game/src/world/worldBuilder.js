// Builds the 3D city (roads, markings, buildings, palms, lamps, signs) from a
// RoadGraph. Geometry is merged per 400 m chunk so the GPU does little work
// and off-screen chunks are frustum-culled.
import * as THREE from 'three';
import { LANE_W, lanesPerDirection } from './roadGraph.js';
import {
  asphaltTexture, sandTexture, pavementTexture, grassTexture, facadeTextures, glassTextures,
  speedSignTexture, stopSignTexture,
} from '../render/textures.js';

const CHUNK = 400;

class Acc {
  constructor(withColor = false) {
    this.pos = [];
    this.uv = [];
    this.col = withColor ? [] : null;
    this.idx = [];
  }
  quad(a, b, c, d, uvs, color) {
    // a,b,c,d: [x,y,z] counter-clockwise when seen from the front
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    this.uv.push(...uvs);
    if (this.col) for (let i = 0; i < 4; i++) this.col.push(color.r, color.g, color.b);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c, uvs, color) {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...uvs);
    if (this.col) for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
    this.idx.push(base, base + 1, base + 2);
  }
  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

class ChunkedAcc {
  constructor(withColor = false) {
    this.withColor = withColor;
    this.map = new Map();
  }
  at(x, z) {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = new Acc(this.withColor)));
    return a;
  }
  meshes(material, opts = {}) {
    const out = [];
    for (const acc of this.map.values()) {
      const g = acc.geometry();
      if (!g) continue;
      const m = new THREE.Mesh(g, material);
      m.receiveShadow = !!opts.receiveShadow;
      m.castShadow = !!opts.castShadow;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      if (opts.renderOrder) m.renderOrder = opts.renderOrder;
      out.push(m);
    }
    return out;
  }
}

function layerMaterial(params, layer) {
  const m = new THREE.MeshStandardMaterial(params);
  if (layer) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -layer;
    m.polygonOffsetUnits = -layer * 2;
  }
  return m;
}

/** Emit a ribbon along a polyline (array of [x,z]) with miter joins. */
function ribbon(acc, pts, halfWidth, y, vScale = 1 / 8) {
  const n = pts.length;
  if (n < 2) return;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[Math.min(n - 1, i + 1)];
    let ax = p1[0] - p0[0], az = p1[1] - p0[1];
    let bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    let tx = ax + bx, tz = az + bz;
    const lt = Math.hypot(tx, tz) || 1;
    tx /= lt; tz /= lt;
    // right-hand normal of tangent
    const nx = -tz, nz = tx;
    const cos = Math.max(0.5, nx * -az + nz * ax); // dot(normal, rightNormal(a))
    normals.push([nx / cos, nz / cos]);
  }
  let v = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i];
    const na = normals[i - 1], nb = normals[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v2 = v + len * vScale;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    acc.at(mx, mz).quad(
      [a[0] - na[0] * halfWidth, y, a[1] - na[1] * halfWidth],
      [a[0] + na[0] * halfWidth, y, a[1] + na[1] * halfWidth],
      [b[0] + nb[0] * halfWidth, y, b[1] + nb[1] * halfWidth],
      [b[0] - nb[0] * halfWidth, y, b[1] - nb[1] * halfWidth],
      [0, v, 1, v, 1, v2, 0, v2],
    );
    v = v2;
  }
}

function disc(acc, x, z, r, y, segs = 16) {
  const a = acc.at(x, z);
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI * 2, t1 = ((i + 1) / segs) * Math.PI * 2;
    a.tri(
      [x, y, z],
      [x + Math.cos(t1) * r, y, z + Math.sin(t1) * r],
      [x + Math.cos(t0) * r, y, z + Math.sin(t0) * r],
      [0.5, 0.5, 0.5 + Math.cos(t1) * 0.5, 0.5 + Math.sin(t1) * 0.5, 0.5 + Math.cos(t0) * 0.5, 0.5 + Math.sin(t0) * 0.5],
    );
  }
}

/** Thin painted line offset from a segment, optionally dashed. */
function paintLine(acc, a, b, offset, width, y, dash, trimA, trimB) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ux = dx / len, uz = dz / len;
  const rx = -uz, rz = ux;
  const start = trimA, end = len - trimB;
  if (end - start < 1) return;
  const emit = (s0, s1) => {
    const ox = rx * offset, oz = rz * offset;
    const hw = width / 2;
    const p0x = a[0] + ux * s0 + ox, p0z = a[1] + uz * s0 + oz;
    const p1x = a[0] + ux * s1 + ox, p1z = a[1] + uz * s1 + oz;
    acc.at(p0x, p0z).quad(
      [p0x - rx * hw, y, p0z - rz * hw],
      [p0x + rx * hw, y, p0z + rz * hw],
      [p1x + rx * hw, y, p1z + rz * hw],
      [p1x - rx * hw, y, p1z - rz * hw],
      [0, 0, 1, 0, 1, 1, 0, 1],
    );
  };
  if (!dash) emit(start, end);
  else for (let s = start; s < end; s += dash[0] + dash[1]) emit(s, Math.min(end, s + dash[0]));
}

function palmGeometries() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 7.5, 6, 4);
  trunk.translate(0, 3.75, 0);
  // gentle curve
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + (tp.getY(i) / 7.5) ** 2 * 0.5);
  trunk.computeVertexNormals();
  const fronds = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.PlaneGeometry(0.9, 3.6, 1, 5);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 1.8; // 0..3.6 along the frond
      const w = Math.sin((y / 3.6) * Math.PI) * 0.9 + 0.1;
      p.setX(k, p.getX(k) * w);
      p.setZ(k, -((y / 3.6) ** 2) * 1.6); // droop
      p.setY(k, y);
    }
    g.rotateX(-Math.PI / 2 + 0.25);
    g.rotateY((i / 8) * Math.PI * 2 + (i % 2) * 0.2);
    g.translate(0.5, 7.4, 0);
    fronds.push(g);
  }
  const crown = mergeSimple(fronds);
  crown.computeVertexNormals();
  return { trunk, crown };
}

function mergeSimple(geoms) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const g of geoms) {
    const gi = g.index ? g.toNonIndexed() : g;
    pos.push(...gi.attributes.position.array);
    if (gi.attributes.normal) nor.push(...gi.attributes.normal.array);
    if (gi.attributes.uv) uv.push(...gi.attributes.uv.array);
    for (let i = 0; i < gi.attributes.position.count; i++) idx.push(base + i);
    base += gi.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

export { mergeSimple };

export class World {
  constructor(graph, quality) {
    this.graph = graph;
    this.quality = quality;
    this.group = new THREE.Group();
    this.nightMaterials = [];
    this.buildingGrid = new Map();
    this.buildingCell = 25;
    this.buildings = [];
    this.build();
  }

  build() {
    const g = this.graph;
    const q = this.quality;
    const R = g.map.radius || 1500;

    // ground
    const groundSize = R * 2 + 3000;
    const sand = sandTexture().clone();
    sand.needsUpdate = true;
    sand.repeat.set(groundSize / 60, groundSize / 60);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshStandardMaterial({ map: sand, color: 0xf0d5a8, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // areas (water, parks)
    const waterMat = layerMaterial({ color: 0x1f6f8b, roughness: 0.08, metalness: 0.6 }, 1);
    const parkMat = layerMaterial({ map: grassTexture(), color: 0x9ccf7c, roughness: 1 }, 1);
    for (const a of g.map.areas || []) {
      if (a.p.length < 3) continue;
      const shape = new THREE.Shape(a.p.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2); // (x, y) -> (x, 0, -y)
      if (a.kind === 'park') {
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8);
      }
      const m = new THREE.Mesh(geo, a.kind === 'water' ? waterMat : parkMat);
      m.position.y = a.kind === 'water' ? 0.012 : 0.015;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // roads
    const sidewalk = new ChunkedAcc();
    const asphalt = new ChunkedAcc();
    const junctions = new ChunkedAcc();
    const white = new ChunkedAcc();
    const yellow = new ChunkedAcc();
    const junctionR = new Map();

    for (const road of g.roads) {
      for (const n of [road.n[0], road.n[road.n.length - 1], ...road.n]) {
        if (g.isJunction(n)) junctionR.set(n, Math.max(junctionR.get(n) || 0, road.width / 2 + 0.8));
      }
    }

    for (const road of g.roads) {
      const pts = road.n.map((i) => g.pts[i]);
      const hw = road.width / 2;
      if (road.type !== 'motorway' && road.type !== 'motorway_link') ribbon(sidewalk, pts, hw + 2.6, 0.02, 1 / 4);
      else ribbon(sidewalk, pts, hw + 1.2, 0.02, 1 / 4);
      ribbon(asphalt, pts, hw, 0.05, 1 / 7);

      // markings
      const lpd = lanesPerDirection(road);
      for (let i = 1; i < road.n.length; i++) {
        const na = road.n[i - 1], nb = road.n[i];
        const a = g.pts[na], b = g.pts[nb];
        const trimA = (junctionR.get(na) || 0) + (junctionR.has(na) ? 1 : 0);
        const trimB = (junctionR.get(nb) || 0) + (junctionR.has(nb) ? 1 : 0);
        const y = 0.09;
        if (road.oneway) {
          paintLine(yellow, a, b, -hw + 0.35, 0.15, y, null, trimA, trimB);
          paintLine(white, a, b, hw - 0.35, 0.15, y, null, trimA, trimB);
          const lw = (road.width - 0.7) / road.lanes;
          for (let k = 1; k < road.lanes; k++) paintLine(white, a, b, -hw + 0.35 + lw * k, 0.13, y, [3, 6], trimA, trimB);
        } else {
          if (road.rank >= 3) {
            paintLine(white, a, b, hw - 0.35, 0.14, y, null, trimA, trimB);
            paintLine(white, a, b, -hw + 0.35, 0.14, y, null, trimA, trimB);
          }
          if (lpd >= 2) {
            paintLine(yellow, a, b, 0.15, 0.12, y, null, trimA, trimB);
            paintLine(yellow, a, b, -0.15, 0.12, y, null, trimA, trimB);
            const lw = (hw - 0.35) / lpd;
            for (let k = 1; k < lpd; k++) {
              paintLine(white, a, b, lw * k, 0.12, y, [3, 6], trimA, trimB);
              paintLine(white, a, b, -lw * k, 0.12, y, [3, 6], trimA, trimB);
            }
          } else if (road.rank >= 3) {
            paintLine(white, a, b, 0, 0.12, y, [3, 5], trimA, trimB);
          }
        }
      }
    }
    for (const [n, r] of junctionR) {
      const p = g.pts[n];
      disc(junctions, p[0], p[1], r + 0.6, 0.07, 18);
      disc(sidewalk, p[0], p[1], r + 3, 0.02, 14);
    }

    const asphaltMap = asphaltTexture();
    const sidewalkMap = pavementTexture();
    const matSidewalk = layerMaterial({ map: sidewalkMap, color: 0xd8d2c4, roughness: 0.95 }, 1);
    const matRoad = layerMaterial({ map: asphaltMap, color: 0x9a9a9a, roughness: 0.88, metalness: 0.02 }, 2);
    const matJunction = layerMaterial({ map: asphaltMap, color: 0x9a9a9a, roughness: 0.88 }, 3);
    const matWhite = layerMaterial({ color: 0xf2f2f2, roughness: 0.7, emissive: 0x222222 }, 4);
    const matYellow = layerMaterial({ color: 0xf2c200, roughness: 0.7, emissive: 0x221a00 }, 4);
    const shadows = q.shadows;
    for (const m of sidewalk.meshes(matSidewalk, { receiveShadow: shadows })) this.group.add(m);
    for (const m of asphalt.meshes(matRoad, { receiveShadow: shadows })) this.group.add(m);
    for (const m of junctions.meshes(matJunction, { receiveShadow: shadows })) this.group.add(m);
    for (const m of white.meshes(matWhite)) this.group.add(m);
    for (const m of yellow.meshes(matYellow)) this.group.add(m);

    this.junctionR = junctionR;
    this.buildBuildings();
    this.buildPalmsAndLamps();
    this.buildSigns();
  }

  buildBuildings() {
    const g = this.graph;
    const walls = new ChunkedAcc(true);
    const towers = new ChunkedAcc(true);
    const roofs = new ChunkedAcc(true);
    const tints = [0xffffff, 0xf3e6cf, 0xe8d7b8, 0xdcd3c5, 0xf5efe6, 0xd9c29b].map((c) => new THREE.Color(c));
    const towerTints = [0xffffff, 0xcfe3f0, 0xb8d0e0, 0xe0e7ee].map((c) => new THREE.Color(c));
    const roofColor = new THREE.Color(0xbdb5a6);
    const limit = this.quality.maxBuildings;
    const list = g.map.buildings.slice(0, limit);

    list.forEach((b, bi) => {
      let pts = b.p.map(([x, y]) => [x, -y]);
      // ensure counter-clockwise (seen from above, in x/z with z south => area sign flips)
      let area = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
      if (area > 0) pts = pts.reverse();
      const h = Math.max(4, b.h);
      const tower = h > 55;
      const acc = tower ? towers : walls;
      const tint = tower ? towerTints[bi % towerTints.length] : tints[bi % tints.length];
      let u = 0;
      const cx = pts[0][0], cz = pts[0][1];
      const chunk = acc.at(cx, cz);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const u2 = u + len / 12;
        const v = h / 3.5;
        chunk.quad([a[0], 0, a[1]], [c[0], 0, c[1]], [c[0], h, c[1]], [a[0], h, a[1]], [u, 0, u2, 0, u2, v, u, v], tint);
        u = u2;
      }
      // roof
      try {
        const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        const rc = roofs.at(cx, cz);
        for (const t of tris) {
          const p0 = pts[t[0]];
          let p1 = pts[t[1]], p2 = pts[t[2]];
          // make the roof face up: y of (p1-p0)x(p2-p0) must be positive
          if ((p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]) < 0) [p1, p2] = [p2, p1];
          rc.tri([p0[0], h, p0[1]], [p1[0], h, p1[1]], [p2[0], h, p2[1]], [0, 0, 0, 0, 0, 0], roofColor);
        }
      } catch (e) { /* degenerate polygon */ }

      // collision index
      const idx = this.buildings.length;
      this.buildings.push(pts);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const C = this.buildingCell;
      for (let i = Math.floor(minX / C); i <= Math.floor(maxX / C); i++) {
        for (let j = Math.floor(minZ / C); j <= Math.floor(maxZ / C); j++) {
          const k = i * 100003 + j;
          if (!this.buildingGrid.has(k)) this.buildingGrid.set(k, []);
          this.buildingGrid.get(k).push(idx);
        }
      }
    });

    const facade = facadeTextures();
    const glass = glassTextures();
    const wallMat = new THREE.MeshStandardMaterial({
      map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.85,
    });
    const towerMat = new THREE.MeshStandardMaterial({
      map: glass.map, emissiveMap: glass.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.22, metalness: 0.45, color: 0x9fb3c4,
    });
    const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.nightMaterials.push({ mat: wallMat, night: 0.55 }, { mat: towerMat, night: 0.5 });
    const cast = this.quality.shadows;
    for (const m of walls.meshes(wallMat, { castShadow: cast, receiveShadow: cast })) this.group.add(m);
    for (const m of towers.meshes(towerMat, { castShadow: cast, receiveShadow: cast })) this.group.add(m);
    for (const m of roofs.meshes(roofMat, { receiveShadow: cast })) this.group.add(m);
  }

  /** Returns building indices near a point. */
  buildingsNear(x, z) {
    const C = this.buildingCell;
    return this.buildingGrid.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) || [];
  }

  pointInBuilding(x, z) {
    for (const bi of this.buildingsNear(x, z)) {
      const p = this.buildings[bi];
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  /** Push a circle out of building walls. Returns {x, z, nx, nz, hit}. */
  collideCircle(x, z, r) {
    let hit = false;
    let nxs = 0, nzs = 0;
    for (let iter = 0; iter < 2; iter++) {
      const seen = new Set();
      const C = this.buildingCell;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const list = this.buildingGrid.get((Math.floor(x / C) + di) * 100003 + Math.floor(z / C) + dj);
          if (!list) continue;
          for (const bi of list) {
            if (seen.has(bi)) continue;
            seen.add(bi);
            const p = this.buildings[bi];
            for (let i = 0; i < p.length; i++) {
              const a = p[i], b = p[(i + 1) % p.length];
              const dx = b[0] - a[0], dz = b[1] - a[1];
              const l2 = dx * dx + dz * dz || 1;
              const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
              const px = a[0] + dx * t, pz = a[1] + dz * t;
              let ox = x - px, oz = z - pz;
              const d = Math.hypot(ox, oz);
              if (d < r) {
                if (d < 1e-4) { ox = -dz; oz = dx; }
                const l = Math.hypot(ox, oz) || 1;
                ox /= l; oz /= l;
                x = px + ox * r;
                z = pz + oz * r;
                nxs += ox; nzs += oz;
                hit = true;
              }
            }
          }
        }
      }
    }
    const nl = Math.hypot(nxs, nzs) || 1;
    return { x, z, nx: nxs / nl, nz: nzs / nl, hit };
  }

  buildPalmsAndLamps() {
    const g = this.graph;
    const q = this.quality;
    const palms = [];
    const lamps = [];
    const near = (x, z, list, d) => {
      for (const n of list) if ((n[0] - x) ** 2 + (n[1] - z) ** 2 < d * d) return true;
      return false;
    };
    const junctionPts = [...this.junctionR.keys()].map((n) => g.pts[n]);
    const jGrid = new Map();
    for (const p of junctionPts) {
      const k = Math.floor(p[0] / 50) * 100003 + Math.floor(p[1] / 50);
      if (!jGrid.has(k)) jGrid.set(k, []);
      jGrid.get(k).push(p);
    }
    const nearJunction = (x, z, d) => {
      const ci = Math.floor(x / 50), cj = Math.floor(z / 50);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
        const l = jGrid.get(i * 100003 + j);
        if (l && near(x, z, l, d)) return true;
      }
      return false;
    };
    const free = (x, z) => {
      const nr = g.nearest(x, z, 12);
      if (nr && nr.dist < nr.road.width / 2 + 1.5) return false;
      return !this.pointInBuilding(x, z) && !this.collideCircle(x, z, 1.5).hit;
    };

    for (const road of g.roads) {
      if (road.rank < 5 || road.type.endsWith('_link')) continue;
      const hw = road.width / 2;
      let carry = 0;
      let lampCarry = 10;
      for (let i = 1; i < road.n.length; i++) {
        const a = g.pts[road.n[i - 1]], b = g.pts[road.n[i]];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const ux = dx / len, uz = dz / len, rx = -uz, rz = ux;
        for (let s = carry; s < len; s += 24) {
          const x = a[0] + ux * s, z = a[1] + uz * s;
          if (nearJunction(x, z, 16)) continue;
          for (const side of road.oneway ? [1] : [-1, 1]) {
            const px = x + rx * side * (hw + 3.2), pz = z + rz * side * (hw + 3.2);
            if (palms.length < q.maxPalms && free(px, pz)) palms.push([px, pz, Math.random() * 6.28, 0.85 + Math.random() * 0.35]);
          }
        }
        carry = (carry - len) % 24;
        if (carry < 0) carry += 24;
        for (let s = lampCarry; s < len; s += 45) {
          const x = a[0] + ux * s, z = a[1] + uz * s;
          if (nearJunction(x, z, 12)) continue;
          const side = road.oneway ? -1 : 1;
          const px = x + rx * side * (hw + 1.0), pz = z + rz * side * (hw + 1.0);
          if (lamps.length < q.maxLamps && free(px, pz)) lamps.push([px, pz, Math.atan2(-rx * side, -rz * side)]);
        }
        lampCarry = (lampCarry - len) % 45;
        if (lampCarry < 0) lampCarry += 45;
      }
    }
    // palms in parks
    for (const a of g.map.areas || []) {
      if (a.kind !== 'park') continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of a.p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      for (let k = 0; k < 40 && palms.length < q.maxPalms; k++) {
        const x = minX + Math.random() * (maxX - minX), y = minY + Math.random() * (maxY - minY);
        let inside = false;
        const p = a.p;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
        }
        if (inside && free(x, -y)) palms.push([x, -y, Math.random() * 6.28, 0.8 + Math.random() * 0.5]);
      }
    }

    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    if (palms.length) {
      const { trunk, crown } = palmGeometries();
      const trunkMesh = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 }), palms.length);
      const crownMesh = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x3f7d2c, roughness: 0.9, side: THREE.DoubleSide }), palms.length);
      palms.forEach(([x, z, rot, s], i) => {
        quat.setFromAxisAngle(up, rot);
        m4.compose(new THREE.Vector3(x, 0, z), quat, new THREE.Vector3(s, s, s));
        trunkMesh.setMatrixAt(i, m4);
        crownMesh.setMatrixAt(i, m4);
      });
      trunkMesh.castShadow = crownMesh.castShadow = this.quality.shadows;
      this.group.add(trunkMesh, crownMesh);
    }
    if (lamps.length) {
      const pole = new THREE.CylinderGeometry(0.08, 0.14, 10, 6);
      pole.translate(0, 5, 0);
      const arm = new THREE.BoxGeometry(0.1, 0.1, 2.4);
      arm.translate(0, 9.9, 1.1);
      const poleGeo = mergeSimple([pole, arm]);
      poleGeo.computeVertexNormals();
      const head = new THREE.BoxGeometry(0.35, 0.12, 0.8);
      head.translate(0, 9.8, 2.2);
      const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x8e959b, metalness: 0.7, roughness: 0.4 }), lamps.length);
      const headMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffd9a0, emissiveIntensity: 0 });
      const headMesh = new THREE.InstancedMesh(head, headMat, lamps.length);
      lamps.forEach(([x, z, rot], i) => {
        quat.setFromAxisAngle(up, rot);
        m4.compose(new THREE.Vector3(x, 0, z), quat, new THREE.Vector3(1, 1, 1));
        poleMesh.setMatrixAt(i, m4);
        headMesh.setMatrixAt(i, m4);
      });
      this.nightMaterials.push({ mat: headMat, night: 3 });
      this.group.add(poleMesh, headMesh);
    }
    this.lampPositions = lamps;
  }

  buildSigns() {
    const g = this.graph;
    const bySpeed = new Map();
    const stops = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const road of g.roads) {
      if (road.rank < 3) continue;
      let total = 0;
      for (let i = 1; i < road.n.length; i++) {
        const a = g.pts[road.n[i - 1]], b = g.pts[road.n[i]];
        total += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      if (total < 90) continue;
      const dirs = road.oneway ? [1] : [1, -1];
      for (const d of dirs) {
        const ns = d === 1 ? road.n : [...road.n].reverse();
        const a = g.pts[ns[0]], b = g.pts[ns[1]];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 25) continue;
        const ux = dx / len, uz = dz / len;
        const off = road.oneway ? road.width / 2 + 1.3 : road.width / 2 + 1.3;
        const s = Math.min(len - 5, 18 + (this.junctionR.get(ns[0]) || 0));
        const x = a[0] + ux * s - uz * off, z = a[1] + uz * s + ux * off;
        if (!bySpeed.has(road.maxspeed)) bySpeed.set(road.maxspeed, []);
        const list = bySpeed.get(road.maxspeed);
        if (list.length < 120) list.push([x, z, Math.atan2(-ux, -uz)]);
      }
    }
    // stop signs
    for (const n of g.map.stops || []) {
      const p = g.pts[n];
      for (const rid of g.nodeRoads.get(n) || []) {
        const road = g.roads[rid];
        const k = road.n.indexOf(n);
        const prev = road.n[k - 1];
        if (prev === undefined || road.rank > 4) continue;
        const a = g.pts[prev];
        const dx = p[0] - a[0], dz = p[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const back = 6 + (this.junctionR.get(n) || 0);
        stops.push([p[0] - ux * back - uz * (road.width / 2 + 1), p[1] - uz * back + ux * (road.width / 2 + 1), Math.atan2(-ux, -uz)]);
      }
    }

    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
    poleGeo.translate(0, 1.3, 0);
    const signGeo = new THREE.CircleGeometry(0.45, 20);
    signGeo.translate(0, 2.6, 0.06);
    const backGeo = new THREE.CircleGeometry(0.45, 20);
    backGeo.rotateY(Math.PI);
    backGeo.translate(0, 2.6, 0.05);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.5, roughness: 0.5 });
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const place = (items, faceMat, faceGeo) => {
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, items.length);
      const faces = new THREE.InstancedMesh(faceGeo, faceMat, items.length);
      const backs = new THREE.InstancedMesh(backGeo, backMat, items.length);
      items.forEach(([x, z, rot], i) => {
        quat.setFromAxisAngle(up, rot);
        m4.compose(new THREE.Vector3(x, 0, z), quat, one);
        poles.setMatrixAt(i, m4);
        faces.setMatrixAt(i, m4);
        backs.setMatrixAt(i, m4);
      });
      this.group.add(poles, faces, backs);
    };
    for (const [speed, items] of bySpeed) {
      place(items, new THREE.MeshStandardMaterial({ map: speedSignTexture(speed), roughness: 0.5, emissive: 0x333333 }), signGeo);
    }
    if (stops.length) {
      const oct = new THREE.CircleGeometry(0.45, 8);
      oct.rotateZ(Math.PI / 8);
      oct.translate(0, 2.6, 0.06);
      place(stops.slice(0, 300), new THREE.MeshStandardMaterial({ map: stopSignTexture(), roughness: 0.5, emissive: 0x220000 }), oct);
    }
  }

  setNight(amount) {
    for (const { mat, night } of this.nightMaterials) mat.emissiveIntensity = amount * night;
  }
}
