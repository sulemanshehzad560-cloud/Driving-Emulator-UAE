// Streams 1 km world tiles around the player: requests them from a worker
// pool, turns the returned buffers into meshes, registers roads in the
// dynamic graph, and unloads tiles that fall behind.
import * as THREE from 'three';
import { TILE, tileAt } from './projection.js';
import { buildTile, roadWidth } from './tileBuild.js';
import { buildTrafficCar } from '../cars/carFactory.js';

const MESH_MATS = {
  ground: 'ground', sea: 'sea', water: 'water', road: 'road', junction: 'junction', shoulder: 'shoulder', sidewalk: 'sidewalk',
  kerb: 'kerb', kerbStriped: 'kerbStriped', markW: 'markW', markY: 'markY', barrier: 'barrier', guardrail: 'guardrail',
  roof: 'roof', park: 'park', golf: 'golf', pitch: 'pitch', farm: 'farm', mangrove: 'mangrove', beach: 'beach', parking: 'parking',
  sandArea: 'sandArea',
};
const RECEIVE = new Set(['ground', 'road', 'junction', 'sidewalk', 'shoulder', 'park', 'golf', 'pitch', 'farm', 'beach', 'parking', 'sandArea', 'roof', 'kerb', 'kerbStriped', 'markW', 'markY']);
const CAST = new Set(['barrier', 'roof']);

export class Streamer {
  constructor({ scene, materials, props, quality, index, base = 'world', onAdd, onRemove }) {
    this.scene = scene;
    this.mats = materials;
    this.props = props;
    this.q = quality;
    this.base = base;
    this.index = index; // Set of "tx_ty" that exist
    this.onAdd = onAdd;
    this.onRemove = onRemove;
    this.tiles = new Map(); // key -> tile
    this.pending = new Map(); // key -> promise
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.loadRadius = quality.tileRadius || 1600;
    this.propRadius = quality.propRadius || 800;
    this.unloadRadius = this.loadRadius + 700;
    this.maxInFlight = 2;
    this.workers = [];
    this.jobs = new Map();
    this.jobSeq = 0;
    this.useWorker = typeof Worker !== 'undefined';
    if (this.useWorker) {
      const n = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
      for (let i = 0; i < n; i++) {
        try {
          const w = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' });
          w.onmessage = (e) => this.onWorker(e.data);
          w.onerror = () => { this.useWorker = false; };
          this.workers.push(w);
        } catch (e) {
          this.useWorker = false;
        }
      }
      this.maxInFlight = Math.max(2, this.workers.length * 2);
    }
    this.rr = 0;
    this.buildOpts = {
      quality: { props: true, maxBuildings: quality.maxBuildingsPerTile || 3000 },
      facades: (materials.M.photoFacades || []).map((m) => m.userData.facade),
    };
  }

  tileUrl(key) {
    return `${this.base}/tiles/${key}.json`;
  }

  onWorker(msg) {
    const job = this.jobs.get(msg.id);
    if (!job) return;
    this.jobs.delete(msg.id);
    if (msg.ok) job.resolve(msg.tile);
    else job.reject(new Error(msg.error));
  }

  build(key) {
    const url = new URL(this.tileUrl(key), location.href).href;
    if (this.useWorker && this.workers.length) {
      const id = ++this.jobSeq;
      const w = this.workers[this.rr++ % this.workers.length];
      return new Promise((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        w.postMessage({ id, url, opts: this.buildOpts });
      });
    }
    // main-thread fallback
    return fetch(url).then((r) => r.json()).then((t) => buildTile(t, this.buildOpts));
  }

  /** Keys of tiles within radius r of (X, Z), nearest first. */
  wanted(X, Z, r) {
    const [cx, cy] = tileAt(X, Z);
    const n = Math.ceil(r / TILE) + 1;
    const out = [];
    for (let dx = -n; dx <= n; dx++) {
      for (let dy = -n; dy <= n; dy++) {
        const tx = cx + dx, ty = cy + dy;
        const key = `${tx}_${ty}`;
        if (this.index && !this.index.has(key)) continue;
        const d = this.distToTile(X, Z, tx, ty);
        if (d <= r) out.push([d, key]);
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }

  distToTile(X, Z, tx, ty) {
    const x0 = tx * TILE, x1 = x0 + TILE;
    const z1 = -ty * TILE, z0 = z1 - TILE;
    const dx = X < x0 ? x0 - X : X > x1 ? X - x1 : 0;
    const dz = Z < z0 ? z0 - Z : Z > z1 ? Z - z1 : 0;
    return Math.hypot(dx, dz);
  }

  /** Call every frame. Returns true while tiles near the player are still loading. */
  update(X, Z) {
    for (const [d, key] of this.wanted(X, Z, this.loadRadius)) {
      if (this.tiles.has(key) || this.pending.has(key)) continue;
      if (this.pending.size >= this.maxInFlight) break;
      const p = this.build(key)
        .then((data) => {
          this.pending.delete(key);
          if (this.tiles.has(key)) return;
          this.add(data);
        })
        .catch((e) => {
          this.pending.delete(key);
          console.warn('[tiles] failed', key, e.message);
          if (this.index) this.index.delete(key);
        });
      this.pending.set(key, p);
    }
    for (const [key, t] of this.tiles) {
      const d = this.distToTile(X, Z, t.t[0], t.t[1]);
      if (d > this.unloadRadius) this.remove(key);
      else if (t.props) t.props.visible = d < this.propRadius + 150;
      if (!t.props && d < this.propRadius) this.addProps(t);
    }
    // loading state for the tile under the player
    const [cx, cy] = tileAt(X, Z);
    const k = `${cx}_${cy}`;
    return (!this.index || this.index.has(k)) && !this.tiles.has(k);
  }

  /** Load everything around a point before starting to drive. */
  async preload(X, Z, r = 700, onProgress) {
    const list = this.wanted(X, Z, r).map(([, k]) => k);
    let done = 0;
    await Promise.all(list.map((key) => this.build(key).then((data) => {
      if (!this.tiles.has(key)) this.add(data);
      onProgress && onProgress(++done, list.length);
    }).catch(() => onProgress && onProgress(++done, list.length))));
    for (const t of this.tiles.values()) if (!t.props && this.distToTile(X, Z, t.t[0], t.t[1]) < this.propRadius) this.addProps(t);
  }

  add(data) {
    const M = this.mats.M;
    const [ox, oy] = data.origin;
    const group = new THREE.Group();
    group.position.set(ox, 0, -oy);
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    const shadows = this.q.shadows;
    for (const [key, buf] of Object.entries(data.meshes)) {
      let mat;
      if (key.startsWith('wall:')) mat = this.wallMaterial(key.slice(5));
      else mat = M[MESH_MATS[key]];
      if (!mat) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(buf.p, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(buf.n, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(buf.uv, 2));
      if (buf.c) g.setAttribute('color', new THREE.BufferAttribute(buf.c, 3));
      if (buf.r) g.setAttribute('aRoad', new THREE.BufferAttribute(buf.r, 2));
      g.setIndex(new THREE.BufferAttribute(buf.i, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${data.key}:${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = shadows && (RECEIVE.has(key) || key.startsWith('wall:'));
      mesh.castShadow = shadows && (CAST.has(key) || key.startsWith('wall:'));
      if (key === 'ground') mesh.renderOrder = -2;
      group.add(mesh);
    }
    this.root.add(group);
    const tile = {
      key: data.key,
      t: data.t,
      origin: data.origin,
      emirate: data.emirate,
      group,
      data,
      props: null,
      collision: this.collisionIndex(data),
    };
    this.tiles.set(data.key, tile);
    this.onAdd && this.onAdd(tile);
  }

  wallMaterial(style) {
    const M = this.mats.M;
    if (style.startsWith('glass')) return M.glass[+style.slice(5) % M.glass.length];
    if (style.startsWith('apt')) return M.apartment[+style.slice(3) % M.apartment.length];
    if (style.startsWith('photo')) return M.photoFacades[+style.slice(5)] || M.office;
    return { office: M.office, villa: M.villa, shop: M.storefront, ind: M.industrial, mosque: M.mosque }[style] || M.office;
  }

  addProps(tile) {
    const inst = tile.data.instances || {};
    const g = this.props.tileGroup(inst, { shadows: this.q.shadows && this.q.propShadows });
    g.add(this.props.stopSigns(stopSignList(tile.data)));
    if (inst.parked && this.q.parkedCars !== false) g.add(parkedCars(inst.parked, this.q));
    tile.group.add(g);
    g.updateMatrixWorld(true);
    tile.props = g;
  }

  remove(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    this.onRemove && this.onRemove(t);
    this.root.remove(t.group);
    t.group.traverse((o) => {
      if (o.geometry && !o.userData.sharedGeometry && !o.isInstancedMesh) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    this.tiles.delete(key);
  }

  clear() {
    for (const k of [...this.tiles.keys()]) this.remove(k);
  }

  dispose() {
    this.clear();
    for (const w of this.workers) w.terminate();
    this.scene.remove(this.root);
  }

  // ------------------------------------------------ collision
  collisionIndex(data) {
    const [ox, oy] = data.origin;
    const polys = data.buildings.map((flat) => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([ox + flat[i], -oy + flat[i + 1]]);
      return pts;
    });
    const grid = new Map();
    polys.forEach((pts, idx) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      for (let i = Math.floor(minX / 25); i <= Math.floor(maxX / 25); i++) {
        for (let j = Math.floor(minZ / 25); j <= Math.floor(maxZ / 25); j++) {
          const k = i * 1000003 + j;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(idx);
        }
      }
    });
    return { polys, grid };
  }

  buildingsNear(x, z) {
    const out = [];
    const [tx, ty] = tileAt(x, z);
    const k = Math.floor(x / 25) * 1000003 + Math.floor(z / 25);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const t = this.tiles.get(`${tx + dx}_${ty + dy}`);
        if (!t) continue;
        const list = t.collision.grid.get(k);
        if (list) for (const i of list) out.push(t.collision.polys[i]);
      }
    }
    return out;
  }

  pointInBuilding(x, z) {
    for (const p of this.buildingsNear(x, z)) {
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  /** Push a circle out of building walls. */
  collideCircle(x, z, r) {
    let hit = false, nxs = 0, nzs = 0;
    for (let iter = 0; iter < 2; iter++) {
      const seen = new Set();
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const p of this.buildingsNear(x + di * 25, z + dj * 25)) {
            if (seen.has(p)) continue;
            seen.add(p);
            for (let i = 0; i < p.length; i++) {
              const a = p[i], c = p[(i + 1) % p.length];
              const dx = c[0] - a[0], dz = c[1] - a[1];
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
}

function stopSignList(data) {
  // stop signs on minor roads entering a junction (tile-local)
  const out = [];
  const g = data.graph;
  const jr = new Map(data.junctions);
  for (const n of data.stops || []) {
    const x = g.xy[n * 2], z = -g.xy[n * 2 + 1];
    for (const r of g.roads) {
      const k = r.n.indexOf(n);
      if (k <= 0) continue;
      const p = r.n[k - 1];
      const px = g.xy[p * 2], pz = -g.xy[p * 2 + 1];
      const dx = x - px, dz = z - pz;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const back = 6 + (jr.get(n) || 0);
      const side = roadWidth(r) / 2 + 1;
      out.push(x - ux * back - uz * side, z - uz * back + ux * side, Math.atan2(-ux, -uz));
    }
  }
  return out;
}

const PARKED_STYLES = ['sedan', 'suv', 'sedan', 'coupe', 'boxy', 'van', 'suv', 'sedan'];
const PARKED_COLORS = [0xffffff, 0xc0c0c0, 0x1c1c1c, 0x8c8c8c, 0x1b2a41, 0x7a0e0e, 0xf1e3c2, 0xe6e6e6, 0x2f4f4f, 0x6b5b45];

function parkedCars(arr, q) {
  const group = new THREE.Group();
  const byStyle = new Map();
  for (let i = 0; i < arr.length; i += 4) {
    const v = arr[i + 3];
    const style = PARKED_STYLES[v % PARKED_STYLES.length];
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style).push(arr[i], arr[i + 1], arr[i + 2], v);
  }
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  for (const [style, list] of byStyle) {
    const proto = buildTrafficCar(style, 0xffffff, false);
    const n = list.length / 4;
    for (const part of proto.children) {
      const paint = part.material.userData?.isPaint;
      const mat = paint ? part.material.clone() : part.material;
      if (paint) mat.color.set(0xffffff);
      const mesh = new THREE.InstancedMesh(part.geometry, mat, n);
      mesh.userData.sharedGeometry = true;
      for (let i = 0; i < n; i++) {
        quat.setFromAxisAngle(up, list[i * 4 + 2]);
        m4.compose(new THREE.Vector3(list[i * 4], 0, list[i * 4 + 1]), quat, one);
        mesh.setMatrixAt(i, m4);
        if (paint) mesh.setColorAt(i, col.set(PARKED_COLORS[list[i * 4 + 3] % PARKED_COLORS.length]));
      }
      mesh.castShadow = !!q.propShadows;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}
