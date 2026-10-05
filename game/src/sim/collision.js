// Solid world for the player's car: building footprints (polygons, from the
// streamer) plus round obstacles — palm trunks, lamp posts, sign posts,
// signal poles, camera poles, toll-gantry legs, bus shelters, parked cars.
// The car is two circles (front/back). Motion is swept in small steps so a
// fast car cannot tunnel through a wall or a pole between two frames.

const CELL = 16;
const key = (i, j) => i * 1000003 + j;

export class Colliders {
  constructor() {
    this.grid = new Map(); // cell -> [circle]
    this.byTile = new Map(); // tile key -> [circle]
  }

  /** circles: flat [x, z, r, ...] in world space */
  addTile(tileKey, flat) {
    this.removeTile(tileKey);
    const list = [];
    for (let i = 0; i < flat.length; i += 3) {
      const c = { x: flat[i], z: flat[i + 1], r: flat[i + 2], cells: [] };
      const i0 = Math.floor((c.x - c.r) / CELL), i1 = Math.floor((c.x + c.r) / CELL);
      const j0 = Math.floor((c.z - c.r) / CELL), j1 = Math.floor((c.z + c.r) / CELL);
      for (let a = i0; a <= i1; a++) {
        for (let b = j0; b <= j1; b++) {
          const k = key(a, b);
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(c);
          c.cells.push(k);
        }
      }
      list.push(c);
    }
    this.byTile.set(tileKey, list);
  }

  removeTile(tileKey) {
    const list = this.byTile.get(tileKey);
    if (!list) return;
    for (const c of list) {
      for (const k of c.cells) {
        const cell = this.grid.get(k);
        if (!cell) continue;
        const i = cell.indexOf(c);
        if (i >= 0) cell.splice(i, 1);
        if (!cell.length) this.grid.delete(k);
      }
    }
    this.byTile.delete(tileKey);
  }

  /** Push a circle out of round obstacles. */
  collideCircle(x, z, r) {
    let hit = false, nxs = 0, nzs = 0;
    const i0 = Math.floor((x - r - 2) / CELL), i1 = Math.floor((x + r + 2) / CELL);
    const j0 = Math.floor((z - r - 2) / CELL), j1 = Math.floor((z + r + 2) / CELL);
    const seen = new Set();
    for (let a = i0; a <= i1; a++) {
      for (let b = j0; b <= j1; b++) {
        const cell = this.grid.get(key(a, b));
        if (!cell) continue;
        for (const c of cell) {
          if (seen.has(c)) continue;
          seen.add(c);
          let dx = x - c.x, dz = z - c.z;
          const d = Math.hypot(dx, dz), min = r + c.r;
          if (d >= min) continue;
          if (d < 1e-4) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
          x = c.x + dx * min;
          z = c.z + dz * min;
          nxs += dx; nzs += dz;
          hit = true;
        }
      }
    }
    const nl = Math.hypot(nxs, nzs) || 1;
    return { x, z, nx: nxs / nl, nz: nzs / nl, hit };
  }
}

/**
 * Obstacles of one streamed tile (world space) from its prop instances.
 * Radii are the solid part a car would hit: trunks and poles, not canopies.
 */
export function tileObstacles(data) {
  const [ox, oy] = data.origin;
  const inst = data.instances || {};
  const out = [];
  const add = (lx, lz, r) => out.push(ox + lx, -oy + lz, r);
  const each = (arr, stride, fn) => { if (arr) for (let i = 0; i < arr.length; i += stride) fn(arr, i); };
  each(inst.palm, 4, (a, i) => add(a[i], a[i + 1], 0.42 * (a[i + 3] || 1)));
  each(inst.lamp, 4, (a, i) => add(a[i], a[i + 1], 0.3));
  if (inst.speed) for (const arr of Object.values(inst.speed)) each(arr, 3, (a, i) => add(a[i], a[i + 1], 0.14));
  each(inst.bin, 3, (a, i) => add(a[i], a[i + 1], 0.35));
  each(inst.utility, 3, (a, i) => add(a[i], a[i + 1], 0.55));
  each(inst.bench, 3, (a, i) => {
    const ux = Math.cos(a[i + 2]), uz = -Math.sin(a[i + 2]);
    for (const s of [-0.6, 0.6]) add(a[i] + ux * s, a[i + 1] + uz * s, 0.4);
  });
  each(inst.shelter, 3, (a, i) => {
    const ux = Math.cos(a[i + 2]), uz = -Math.sin(a[i + 2]);
    for (const s of [-1.4, 0, 1.4]) add(a[i] + ux * s, a[i + 1] + uz * s, 0.7);
  });
  each(inst.parked, 4, (a, i) => {
    // parked car: heading a[i+2] (car faces -z at rotation 0) -> two circles along its length
    const fx = -Math.sin(a[i + 2]), fz = -Math.cos(a[i + 2]);
    for (const s of [-1.35, 0, 1.35]) add(a[i] + fx * s, a[i + 1] + fz * s, 0.95);
  });
  return out;
}
