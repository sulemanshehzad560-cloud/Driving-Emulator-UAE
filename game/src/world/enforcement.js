// Speed cameras, toll gates (Salik in Dubai, Darb in Abu Dhabi) and rest
// stops / fuel stations. Uses OpenStreetMap positions where mapped and fills
// the gaps with rule-based placement so every map has them.
import * as THREE from 'three';
import { salikTexture, glowTexture } from '../render/textures.js';

// UAE federal speeding fines (AED) by km/h over the limit.
export function speedingFine(over) {
  if (over > 80) return { aed: 3000, points: 23 };
  if (over > 60) return { aed: 2000, points: 12 };
  if (over > 50) return { aed: 1000, points: 0 };
  if (over > 40) return { aed: 700, points: 0 };
  if (over > 30) return { aed: 600, points: 0 };
  return { aed: 300, points: 0 };
}

function snapToRoad(graph, x, z) {
  const nr = graph.nearest(x, z, 60);
  if (!nr) return null;
  const l = Math.hypot(nr.dx, nr.dz) || 1;
  return { road: nr.road, x: nr.px, z: nr.pz, dx: nr.dx / l, dz: nr.dz / l };
}

function textSprite(text, bg, fg = '#fff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = fg;
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Enforcement {
  constructor(graph, world) {
    this.graph = graph;
    this.world = world;
    this.group = new THREE.Group();
    this.cameras = [];
    this.tolls = [];
    this.rest = [];
    const map = graph.map;
    const emirate = (map.emirate || '').toLowerCase();
    this.tollName = emirate.includes('abu dhabi') ? 'Darb' : emirate.includes('dubai') ? 'Salik' : null;

    // --- speed cameras ---
    for (const [x, y] of map.cameras || []) {
      const s = snapToRoad(graph, x, -y);
      if (s) this.cameras.push(s);
    }
    if (this.cameras.length < 3) this.autoCameras();

    // --- toll gates ---
    for (const t of map.tolls || []) {
      const s = snapToRoad(graph, t.x, -t.y);
      if (s) this.tolls.push({ ...s, name: t.name || this.tollName || 'Toll' });
    }
    if (!this.tolls.length && this.tollName) this.autoTolls();

    // --- rest areas / fuel ---
    for (const r of map.rest || []) this.rest.push({ x: r.x, z: -r.y, kind: r.kind, name: r.name || (r.kind === 'fuel' ? 'Fuel station' : 'Rest area') });
    if (this.rest.length < 2) this.autoRest();

    this.buildMeshes();
  }

  autoCameras() {
    const g = this.graph;
    let acc = 300;
    for (const road of g.roads) {
      if (road.maxspeed < 60 || road.rank < 5) continue;
      for (let i = 1; i < road.n.length; i++) {
        const a = g.pts[road.n[i - 1]], b = g.pts[road.n[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc += len;
        if (acc > 700 && len > 60) {
          acc = 0;
          const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
          this.cameras.push({ road, x: a[0] + dx * len * 0.5, z: a[1] + dz * len * 0.5, dx, dz });
        }
      }
    }
  }

  autoTolls() {
    const g = this.graph;
    const candidates = g.roads.filter((r) => r.type === 'motorway' || r.type === 'trunk');
    const placed = [];
    for (const road of candidates) {
      let total = 0;
      const segs = [];
      for (let i = 1; i < road.n.length; i++) {
        const a = g.pts[road.n[i - 1]], b = g.pts[road.n[i]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        segs.push([a, b, len]);
        total += len;
      }
      if (total < 400) continue;
      let s = total / 2;
      for (const [a, b, len] of segs) {
        if (s <= len) {
          const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
          const x = a[0] + dx * s, z = a[1] + dz * s;
          if (!placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < 600)) {
            placed.push([x, z]);
            this.tolls.push({ road, x, z, dx, dz, name: `${this.tollName} Gate` });
          }
          break;
        }
        s -= len;
      }
      if (this.tolls.length >= 4) break;
    }
  }

  autoRest() {
    const g = this.graph;
    const roads = g.roads.filter((r) => r.rank >= 6).sort((a, b) => b.n.length - a.n.length);
    for (const road of roads.slice(0, 4)) {
      const k = Math.floor(road.n.length / 2);
      const a = g.pts[road.n[Math.max(0, k - 1)]], b = g.pts[road.n[k]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      const off = road.width / 2 + 14;
      const x = (a[0] + b[0]) / 2 - dz * off, z = (a[1] + b[1]) / 2 + dx * off;
      if (this.world.pointInBuilding(x, z)) continue;
      this.rest.push({ x, z, kind: 'fuel', name: ['ENOC', 'ADNOC', 'Emarat'][this.rest.length % 3] + ' Station' });
    }
  }

  buildMeshes() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.5, roughness: 0.4 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.3, roughness: 0.5 });
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    this.flashes = [];
    for (const c of this.cameras) {
      const rx = -c.dz, rz = c.dx;
      const off = c.road.width / 2 + 1.6;
      const g = new THREE.Group();
      g.position.set(c.x + rx * off, 0, c.z + rz * off);
      g.rotation.y = Math.atan2(-c.dx, -c.dz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 4.2, 8), poleMat);
      pole.position.y = 2.1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.8), boxMat);
      box.position.set(0, 4.4, 0);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), lensMat);
      lens.position.set(0, 4.45, 0.41);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      flash.scale.set(4, 4, 1);
      flash.position.set(0, 4.4, 0.6);
      g.add(pole, box, lens, flash);
      c.flash = flash;
      this.group.add(g);
    }

    const gantryMat = new THREE.MeshStandardMaterial({ color: 0xbfc5cc, metalness: 0.6, roughness: 0.35 });
    for (const t of this.tolls) {
      const hw = t.road.width / 2 + 1.5;
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);
      g.rotation.y = Math.atan2(-t.dx, -t.dz);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), gantryMat);
        leg.position.set(s * hw, 3.5, 0);
        g.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.4, 0.8, 0.6), gantryMat);
      beam.position.y = 6.8;
      g.add(beam);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(hw * 1.6, 12), 1.4), new THREE.MeshStandardMaterial({ map: this.tollName === 'Darb' ? textSprite('DARB  •  درب', '#7a1f2b') : salikTexture(), emissive: 0x222222 }));
      sign.position.set(0, 6.8, 0.32);
      g.add(sign);
      this.group.add(g);
    }

    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.05 });
    const pumpMat = new THREE.MeshStandardMaterial({ color: 0x0f6bb3, roughness: 0.5 });
    for (const r of this.rest) {
      const g = new THREE.Group();
      g.position.set(r.x, 0, r.z);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.03;
      g.add(pad);
      if (r.kind === 'fuel') {
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 12), canopyMat);
        canopy.position.y = 5.2;
        g.add(canopy);
        for (const [px, pz] of [[-6, -3], [6, -3], [-6, 3], [6, 3]]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), poleMat);
          col.position.set(px, 2.5, pz);
          g.add(col);
        }
        for (const px of [-3, 3]) {
          const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.5), pumpMat);
          pump.position.set(px, 0.85, 0);
          g.add(pump);
        }
      } else {
        const hut = new THREE.Mesh(new THREE.BoxGeometry(10, 3.5, 6), new THREE.MeshStandardMaterial({ color: 0xe8dcc4 }));
        hut.position.y = 1.75;
        g.add(hut);
      }
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textSprite(r.name.slice(0, 16), r.kind === 'fuel' ? '#0f6bb3' : '#2e7d32'), depthWrite: false }));
      label.scale.set(8, 2, 1);
      label.position.y = 8;
      g.add(label);
      r.mesh = g;
      this.group.add(g);
    }
  }

  /**
   * Check the player each frame. Returns a list of events:
   * {type:'camera', kmh, limit, fine} | {type:'toll', name, aed} | {type:'rest', rest}
   */
  update(dt, player, limit, now) {
    const events = [];
    const kmh = player.kmh;
    for (const c of this.cameras) {
      if (c.flash.material.opacity > 0) c.flash.material.opacity = Math.max(0, c.flash.material.opacity - dt * 3);
      const dx = player.x - c.x, dz = player.z - c.z;
      if (dx * dx + dz * dz > 22 * 22) continue;
      const along = dx * c.dx + dz * c.dz;
      const [fx, fz] = player.forward;
      if (Math.abs(along) > 4 || fx * c.dx + fz * c.dz < 0.5) continue;
      if (c.cooldown && now - c.cooldown < 20) continue;
      const camLimit = c.road.maxspeed || limit;
      // UAE radars commonly allow a 20 km/h buffer
      if (kmh > camLimit + 20) {
        c.cooldown = now;
        c.flash.material.opacity = 1;
        events.push({ type: 'camera', kmh: Math.round(kmh), limit: camLimit, fine: speedingFine(kmh - camLimit) });
      }
    }
    for (const t of this.tolls) {
      const dx = player.x - t.x, dz = player.z - t.z;
      if (dx * dx + dz * dz > 30 * 30) continue;
      const along = dx * t.dx + dz * t.dz;
      if (Math.abs(along) > 3) continue;
      if (t.cooldown && now - t.cooldown < 30) continue;
      t.cooldown = now;
      events.push({ type: 'toll', name: this.tollName || t.name, aed: this.tollName === 'Darb' ? 4 : 5 });
    }
    for (const r of this.rest) {
      const d = Math.hypot(player.x - r.x, player.z - r.z);
      r.near = d < 16 && kmh < 8;
    }
    return events;
  }
}
