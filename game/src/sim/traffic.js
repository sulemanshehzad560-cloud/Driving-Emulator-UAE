// AI traffic: cars follow the directed road graph in their lane, keep a safe
// gap, obey traffic lights and stop signs, and respawn around the player.
import * as THREE from 'three';
import { buildTrafficCar } from '../cars/carFactory.js';
import { TRAFFIC_TYPES } from '../cars/catalog.js';
import { lanesPerDirection } from '../world/roadGraph.js';

function pickType() {
  const total = TRAFFIC_TYPES.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of TRAFFIC_TYPES) {
    if ((r -= t.weight) <= 0) return t;
  }
  return TRAFFIC_TYPES[0];
}

export class Traffic {
  constructor(graph, signals, scene, count) {
    this.graph = graph;
    this.signals = signals;
    this.scene = scene;
    this.cars = [];
    this.count = count;
    this.edgeCars = new Map();
    this.spawnable = graph.edges.filter((e) => e.len > 20 && e.road.rank >= 3);
    for (let i = 0; i < count; i++) {
      const t = pickType();
      const color = t.paints[Math.floor(Math.random() * t.paints.length)];
      const mesh = buildTrafficCar(t.style, color, !!t.taxi);
      scene.add(mesh);
      this.cars.push({ mesh, style: t.style, len: t.style === 'van' ? 5.2 : 4.9, edge: null, s: 0, speed: 0, lane: 0, active: false, heading: 0, x: 0, z: 0 });
    }
  }

  spawn(car, px, pz, minD, maxD) {
    for (let tries = 0; tries < 30; tries++) {
      const e = this.spawnable[Math.floor(Math.random() * this.spawnable.length)];
      if (!e) return false;
      const a = this.graph.pts[e.a];
      const d = Math.hypot(a[0] - px, a[1] - pz);
      if (d < minD || d > maxD) continue;
      const s = Math.random() * e.len * 0.6 + 4;
      const list = this.edgeCars.get(e.id) || [];
      if (list.some((o) => Math.abs(o.s - s) < 12)) continue;
      car.edge = e;
      car.s = s;
      car.lane = Math.floor(Math.random() * lanesPerDirection(e.road));
      car.speed = (e.road.maxspeed / 3.6) * 0.6;
      car.cruise = 0.75 + Math.random() * 0.25;
      car.active = true;
      car.mesh.visible = true;
      car.next = this.chooseNext(e);
      this.position(car, 1);
      return true;
    }
    return false;
  }

  chooseNext(e) {
    const outs = (this.graph.out.get(e.b) || []).filter((o) => o.b !== e.a);
    if (!outs.length) return (this.graph.out.get(e.b) || [])[0] || null;
    // weight towards going straight on bigger roads
    let best = null, bw = -1;
    for (const o of outs) {
      const straight = o.dx * e.dx + o.dz * e.dz;
      const w = Math.random() * (1 + Math.max(0, straight) * 2) * (o.road.rank >= 3 ? 1 : 0.2);
      if (w > bw) { bw = w; best = o; }
    }
    return best;
  }

  laneOffset(car, e) {
    const road = e.road;
    const lpd = lanesPerDirection(road);
    const lane = Math.min(car.lane, lpd - 1);
    if (road.oneway) return -road.width / 2 + (road.width / road.lanes) * (lane + 0.5);
    return (road.width / 2 / lpd) * (lane + 0.5);
  }

  position(car, blend) {
    const e = car.edge;
    const a = this.graph.pts[e.a];
    const off = this.laneOffset(car, e);
    const x = a[0] + e.dx * car.s - e.dz * off;
    const z = a[1] + e.dz * car.s + e.dx * off;
    const heading = Math.atan2(-e.dx, -e.dz);
    let dh = heading - car.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    car.heading += dh * blend;
    // smooth lane/corner transitions
    car.x += (x - car.x) * (blend >= 1 ? 1 : Math.min(1, blend * 1.5));
    car.z += (z - car.z) * (blend >= 1 ? 1 : Math.min(1, blend * 1.5));
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
  }

  update(dt, player, time) {
    const px = player.x, pz = player.z;
    this.edgeCars.clear();
    for (const c of this.cars) {
      if (!c.active) continue;
      if (!this.edgeCars.has(c.edge.id)) this.edgeCars.set(c.edge.id, []);
      this.edgeCars.get(c.edge.id).push(c);
    }
    const [pfx, pfz] = player.forward;

    for (const c of this.cars) {
      if (!c.active) {
        this.spawn(c, px, pz, 120, 380);
        continue;
      }
      const dist = Math.hypot(c.x - px, c.z - pz);
      if (dist > 480) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }
      const e = c.edge;
      const limit = (e.road.maxspeed / 3.6) * c.cruise;
      let target = limit;
      const remain = e.len - c.s;

      // traffic lights / stop signs at end of this edge
      const ap = this.signals.stateFor(e.b, e.dx, e.dz);
      if (ap && ap.state !== 'green') {
        const a0 = this.graph.pts[e.a];
        const sLine = (ap.x - a0[0]) * e.dx + (ap.z - a0[1]) * e.dz;
        const stopDist = sLine - c.s - 3;
        // amber: stop only if we comfortably can; red: always stop before the line
        const comfortable = (c.speed * c.speed) / (2 * 4.5) < stopDist;
        if (stopDist > -1 && (ap.state === 'red' || comfortable)) target = Math.min(target, Math.sqrt(2 * 4 * Math.max(0, stopDist)));
      }
      if (c.next) {
        const turn = c.next.dx * e.dx + c.next.dz * e.dz;
        if (turn < 0.8 && remain < 40) target = Math.min(target, 4 + Math.max(0, turn) * 8 + remain * 0.25);
      }

      // car ahead (same edge, same lane; or on next edge)
      let gap = Infinity;
      for (const o of this.edgeCars.get(e.id) || []) {
        if (o === c || o.lane !== c.lane) continue;
        const d = o.s - c.s;
        if (d > 0 && d < gap) gap = d - o.len;
      }
      if (c.next && remain < 40) {
        for (const o of this.edgeCars.get(c.next.id) || []) {
          const d = remain + o.s;
          if (d < gap) gap = d - o.len;
        }
      }
      // player ahead
      const tx = px - c.x, tz = pz - c.z;
      const hx = -Math.sin(c.heading), hz = -Math.cos(c.heading);
      const ahead = tx * hx + tz * hz;
      const side = Math.abs(tx * -hz + tz * hx);
      if (ahead > 0 && ahead < 40 && side < 2.6) gap = Math.min(gap, ahead - player.length);
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 3) * 0.9));

      if (target > c.speed) c.speed = Math.min(target, c.speed + 2.6 * dt);
      else c.speed = Math.max(target, c.speed - (gap < 8 ? 12 : 7) * dt);
      if (c.speed < 0) c.speed = 0;
      c.s += c.speed * dt;
      c.braking = target < c.speed - 0.5;

      while (c.s > c.edge.len) {
        c.s -= c.edge.len;
        if (!c.next) {
          c.active = false;
          c.mesh.visible = false;
          break;
        }
        c.edge = c.next;
        c.lane = Math.min(c.lane, lanesPerDirection(c.edge.road) - 1);
        c.next = this.chooseNext(c.edge);
      }
      if (c.active) this.position(c, Math.min(1, dt * 6));
    }
  }

  /** Player collision: returns {nx, nz, impact} for the first hit or null. */
  collide(player) {
    const R = 1.9;
    const [fx, fz] = player.forward;
    const pts = [[player.x + fx * 1.3, player.z + fz * 1.3], [player.x - fx * 1.3, player.z - fz * 1.3]];
    for (const c of this.cars) {
      if (!c.active) continue;
      const hx = -Math.sin(c.heading), hz = -Math.cos(c.heading);
      const cps = [[c.x + hx * 1.3, c.z + hz * 1.3], [c.x - hx * 1.3, c.z - hz * 1.3]];
      for (const p of pts) {
        for (const q of cps) {
          const dx = p[0] - q[0], dz = p[1] - q[1];
          const d = Math.hypot(dx, dz);
          if (d < R && d > 1e-3) {
            const nx = dx / d, nz = dz / d;
            const push = R - d;
            player.x += nx * push;
            player.z += nz * push;
            c.speed *= 0.5;
            return { nx, nz, car: c };
          }
        }
      }
    }
    return null;
  }
}
