// Speed cameras, Salik (Dubai) / Darb (Abu Dhabi) toll gantries and fuel
// stations for the streamed world. OSM positions are used where mapped;
// motorways without mapped radars get rule-based ones.
import * as THREE from 'three';
import { glowTexture } from '../render/textures.js';

// UAE federal speeding fines (AED) by km/h over the limit.
export function speedingFine(over) {
  if (over > 80) return { aed: 3000, points: 23 };
  if (over > 60) return { aed: 2000, points: 12 };
  if (over > 50) return { aed: 1000, points: 0 };
  if (over > 40) return { aed: 700, points: 0 };
  if (over > 30) return { aed: 600, points: 0 };
  return { aed: 300, points: 0 };
}

export function tollSystem(emirate, X, Z) {
  const e = (emirate || '').toLowerCase();
  if (e.includes('abu dhabi') || e.includes('أبو ظبي')) return 'Darb';
  if (e.includes('dubai') || e.includes('دبي')) return 'Salik';
  // unknown emirate: west of Jebel Ali is Abu Dhabi
  return X < 25000 ? 'Darb' : 'Salik';
}

const BRANDS = {
  ENOC: { canopy: 0xffffff, stripe: 0x00539b, label: '#00539b' },
  ADNOC: { canopy: 0xffffff, stripe: 0x0060a9, label: '#0060a9' },
  EMARAT: { canopy: 0xffffff, stripe: 0xd71920, label: '#d71920' },
  EPPCO: { canopy: 0xffffff, stripe: 0xf39200, label: '#f39200' },
};

function label(text, bg) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 16), 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Enforcement {
  constructor(scene, graph) {
    this.scene = scene;
    this.graph = graph;
    this.byTile = new Map();
    this.cameras = [];
    this.tolls = [];
    this.rest = [];
    this.mats = {
      pole: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.5, roughness: 0.4 }),
      box: new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.3, roughness: 0.5 }),
      gantry: new THREE.MeshStandardMaterial({ color: 0xc4cad0, metalness: 0.7, roughness: 0.3 }),
      tollSign: {
        Salik: new THREE.MeshStandardMaterial({ map: label('SALIK  سالك', '#e4002b'), emissive: 0x221111 }),
        Darb: new THREE.MeshStandardMaterial({ map: label('DARB  درب', '#7a1f2b'), emissive: 0x220a0a }),
      },
      pad: new THREE.MeshStandardMaterial({ color: 0x6f6f6f, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      pump: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
      column: new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.6, roughness: 0.3 }),
      glow: new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
    };
  }

  snap(x, z) {
    const nr = this.graph.nearest(x, z, 60);
    if (!nr) return null;
    const l = Math.hypot(nr.dx, nr.dz) || 1;
    return { road: nr.road, x: nr.px, z: nr.pz, dx: nr.dx / l, dz: nr.dz / l };
  }

  addTile(tile) {
    const d = tile.data;
    const [ox, oy] = d.origin;
    const group = new THREE.Group();
    const rec = { group, cameras: [], tolls: [], rest: [] };
    const toll = tollSystem(d.emirate, ox + 500, -(oy + 500));

    for (const [x, y, ms] of d.cameras || []) {
      const s = this.snap(ox + x, -(oy + y));
      if (s) rec.cameras.push({ ...s, limit: ms || s.road.maxspeed });
    }
    if (!rec.cameras.length) {
      // rule-based radars on fast roads (about one per 1.5 km of motorway)
      for (const road of this.graph.tiles.get(tile.key)?.roads || []) {
        if (road.rank < 7 || road.ids.length < 2) continue;
        const h = Math.abs((road.w * 2654435761) % 1000) / 1000;
        if (h > (road.rank >= 8 ? 0.45 : 0.2)) continue;
        const a = this.graph.pt(road.ids[0]), b = this.graph.pt(road.ids[road.ids.length - 1]);
        if (!a || !b) continue;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 120) continue;
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        rec.cameras.push({ road, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, dx, dz, limit: road.maxspeed });
      }
    }
    for (const t of d.tolls || []) {
      const s = this.snap(ox + t.x, -(oy + t.y));
      if (s) rec.tolls.push({ ...s, name: /darb/i.test(t.name) ? 'Darb' : /salik/i.test(t.name) ? 'Salik' : toll });
    }
    for (const r of d.rest || []) {
      const brand = Object.keys(BRANDS).find((b) => (r.name || '').toUpperCase().includes(b)) || (toll === 'Darb' ? 'ADNOC' : 'ENOC');
      rec.rest.push({ x: ox + r.x, z: -(oy + r.y), kind: r.kind, brand, name: r.name || `${brand} Station` });
    }
    this.buildMeshes(rec);
    this.scene.add(group);
    this.byTile.set(tile.key, rec);
    this.cameras.push(...rec.cameras);
    this.tolls.push(...rec.tolls);
    this.rest.push(...rec.rest);
  }

  /** Solid camera poles and gantry legs of a tile: flat [x, z, r, ...]. */
  obstaclesFor(tileKey) {
    return this.byTile.get(tileKey)?.obstacles || [];
  }

  removeTile(tile) {
    const rec = this.byTile.get(tile.key);
    if (!rec) return;
    this.scene.remove(rec.group);
    const drop = (list, items) => {
      const s = new Set(items);
      return list.filter((x) => !s.has(x));
    };
    this.cameras = drop(this.cameras, rec.cameras);
    this.tolls = drop(this.tolls, rec.tolls);
    this.rest = drop(this.rest, rec.rest);
    this.byTile.delete(tile.key);
  }

  buildMeshes(rec) {
    const M = this.mats;
    rec.obstacles = [];
    const g = rec.group;
    for (const c of rec.cameras) {
      const rx = -c.dz, rz = c.dx;
      const off = c.road.width / 2 + 1.8;
      const o = new THREE.Group();
      o.position.set(c.x + rx * off, 0, c.z + rz * off);
      rec.obstacles.push(c.x + rx * off, c.z + rz * off, 0.25);
      o.rotation.y = Math.atan2(-c.dx, -c.dz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 4.6, 10), M.pole);
      pole.position.y = 2.3;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 1), M.box);
      box.position.y = 4.9;
      const flash = new THREE.Sprite(M.glow.clone());
      flash.scale.set(5, 5, 1);
      flash.position.set(0, 4.9, 0.7);
      o.add(pole, box, flash);
      c.flash = flash;
      g.add(o);
    }
    for (const t of rec.tolls) {
      const hw = t.road.width / 2 + 1.5;
      const o = new THREE.Group();
      o.position.set(t.x, 0, t.z);
      o.rotation.y = Math.atan2(-t.dx, -t.dz);
      for (const s of [-1, 1]) {
        // gantry legs stand on both sides of the carriageway (local x = right of travel)
        const lx = s * hw;
        rec.obstacles.push(t.x + -t.dz * lx, t.z + t.dx * lx, 0.45);
      }
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.4, 0.5), M.gantry);
        leg.position.set(s * hw, 3.7, 0);
        o.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.5, 1, 0.8), M.gantry);
      beam.position.y = 7.2;
      o.add(beam);
      for (let k = -1; k <= 1; k++) {
        const cam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), M.box);
        cam.position.set(k * hw * 0.6, 6.5, 0.3);
        o.add(cam);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(hw * 1.5, 10), 1.3), M.tollSign[t.name] || M.tollSign.Salik);
      sign.position.set(0, 7.2, 0.42);
      o.add(sign);
      g.add(o);
    }
    for (const r of rec.rest) {
      if (r.kind !== 'fuel') continue;
      const b = BRANDS[r.brand] || BRANDS.ENOC;
      const o = new THREE.Group();
      o.position.set(r.x, 0, r.z);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(30, 22), M.pad);
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.04;
      o.add(pad);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 13), new THREE.MeshStandardMaterial({ color: b.canopy, roughness: 0.4 }));
      canopy.position.y = 5.6;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(20.1, 0.35, 13.1), new THREE.MeshStandardMaterial({ color: b.stripe, emissive: b.stripe, emissiveIntensity: 0.3 }));
      stripe.position.y = 5.4;
      o.add(canopy, stripe);
      for (const [px, pz] of [[-7, -4], [7, -4], [-7, 4], [7, 4]]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.2, 0.45), M.column);
        col.position.set(px, 2.6, pz);
        o.add(col);
      }
      for (const px of [-4, 0, 4]) {
        const pump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.6), M.pump);
        pump.position.set(px, 0.9, 0);
        o.add(pump);
      }
      const shop = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 7), new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.6 }));
      shop.position.set(0, 2, -13);
      o.add(shop);
      const totem = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 0.4), new THREE.MeshStandardMaterial({ map: label(r.brand, b.label), emissive: 0x111111 }));
      totem.position.set(12, 3.5, 8);
      o.add(totem);
      r.mesh = o;
      g.add(o);
    }
  }

  /** Per-frame checks. Returns events: camera / toll. */
  update(dt, player, now) {
    const events = [];
    const kmh = player.kmh;
    const [fx, fz] = player.forward;
    for (const c of this.cameras) {
      if (c.flash && c.flash.material.opacity > 0) c.flash.material.opacity = Math.max(0, c.flash.material.opacity - dt * 3);
      const dx = player.x - c.x, dz = player.z - c.z;
      if (dx * dx + dz * dz > 24 * 24) continue;
      const along = dx * c.dx + dz * c.dz;
      if (Math.abs(along) > 4 || fx * c.dx + fz * c.dz < 0.5) continue;
      if (c.cooldown && now - c.cooldown < 20) continue;
      if (kmh > c.limit + 20) {
        c.cooldown = now;
        if (c.flash) c.flash.material.opacity = 1;
        events.push({ type: 'camera', kmh: Math.round(kmh), limit: c.limit, fine: speedingFine(kmh - c.limit) });
      }
    }
    for (const t of this.tolls) {
      const dx = player.x - t.x, dz = player.z - t.z;
      if (dx * dx + dz * dz > 30 * 30) continue;
      if (Math.abs(dx * t.dx + dz * t.dz) > 3) continue;
      if (t.cooldown && now - t.cooldown < 30) continue;
      t.cooldown = now;
      events.push({ type: 'toll', name: t.name, aed: t.name === 'Darb' ? 4 : 5 });
    }
    for (const r of this.rest) r.near = Math.hypot(player.x - r.x, player.z - r.z) < 16 && kmh < 8;
    return events;
  }

  /** Nearest camera ahead within `range` metres (Waze-style warning). */
  cameraAhead(player, range = 500) {
    const [fx, fz] = player.forward;
    let best = null, bd = range;
    for (const c of this.cameras) {
      const dx = c.x - player.x, dz = c.z - player.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > bd) continue;
      if (Math.abs(dx * -fz + dz * fx) > 25) continue;
      if (c.dx * fx + c.dz * fz < 0.5) continue;
      bd = along;
      best = { cam: c, dist: along };
    }
    return best;
  }
}
