// AI traffic on the streamed road graph: cars follow lanes, keep a safe gap,
// slow for bends, obey traffic lights and stop signs, and are recycled
// around the player. Density follows the road class (busier on motorways).
import { blobMaterial, buildTrafficCar, styleDims } from '../cars/carFactory.js';
import { modelTrafficCar } from '../cars/modelCars.js';
import { TRAFFIC_TYPES } from '../cars/catalog.js';
import { lanesPerDirection } from '../world/graph.js';
import { bakeVehicle, bakedMaterial } from '../render/batch.js';
import * as THREE from 'three';

// one baked geometry per car type and colour, shared by every car that uses it
const bakedCars = new Map();
function trafficMesh(t, color, tpl) {
  const key = `${TRAFFIC_TYPES.indexOf(t)}-${color}`;
  let geo = bakedCars.get(key);
  if (!geo) {
    const src = tpl ? modelTrafficCar(tpl, t.paintMat, color) : buildTrafficCar(t.style, color, !!t.taxi, t.taxiRoof);
    geo = bakeVehicle(src, { paint: color });
    bakedCars.set(key, geo);
  }
  // one draw call per car; its own material instance only carries the brake-lamp state
  return new THREE.Mesh(geo, bakedMaterial({ lights: true }));
}

function pickType(rand) {
  const total = TRAFFIC_TYPES.reduce((s, t) => s + t.weight, 0);
  let r = rand * total;
  for (const t of TRAFFIC_TYPES) if ((r -= t.weight) <= 0) return t;
  return TRAFFIC_TYPES[0];
}

export function regionAt(X) {
  // west of the Ghantoot / Jebel Ali area is Abu Dhabi
  return X < 15000 ? 'abudhabi' : 'dubai';
}

export class Traffic {
  constructor(graph, lights, scene, count, templates = new Map()) {
    this.graph = graph;
    this.lights = lights;
    this.scene = scene;
    this.cars = [];
    this.count = count;
    this.edgeCars = new Map();
    const pool = Math.round(count * 1.4);
    for (let i = 0; i < pool; i++) {
      const t = pickType((i * 0.61803398875) % 1);
      const color = t.paints[i % t.paints.length];
      const tpl = t.model && templates.get(t.model);
      const mesh = trafficMesh(t, color, tpl);
      mesh.visible = false;
      scene.add(mesh);
      const dims = styleDims(t.style);
      this.cars.push({ mesh, type: t, len: (tpl && t.len) || dims.L, width: dims.W, edge: null, s: 0, speed: 0, lane: 0, active: false, heading: 0, x: 0, z: 0, index: i });
    }
    // contact shadows of all traffic cars: one instanced draw call
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(plane, blobMaterial(), this.cars.length);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.cars.length; i++) this.blobs.setMatrixAt(i, this.hidden);
    scene.add(this.blobs);
    this.m4 = new THREE.Matrix4();
    this.q4 = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.p3 = new THREE.Vector3();
    this.s3 = new THREE.Vector3();
    this.activeTarget = count;
  }

  activeCount() {
    let n = 0;
    for (const c of this.cars) if (c.active) n++;
    return n;
  }

  spawn(car, px, pz, minD, maxD, region) {
    if (car.type.region && car.type.region !== region) return false;
    const edges = this.graph.liveEdges;
    if (!edges.length) return false;
    for (let tries = 0; tries < 25; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      if (!e.alive || e.len < 20 || e.road.rank < 3) continue;
      if (car.type.big && e.road.rank < 5) continue;
      // busier big roads: reject minor roads more often
      if (Math.random() > 0.25 + e.road.rank * 0.09) continue;
      const a = this.graph.pt(e.a);
      if (!a) continue;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < minD || d > maxD) continue;
      const s = Math.random() * e.len * 0.6 + 4;
      const list = this.edgeCars.get(e.id) || [];
      if (list.some((o) => Math.abs(o.s - s) < 14)) continue;
      car.edge = e;
      car.s = s;
      car.lane = Math.floor(Math.random() * lanesPerDirection(e.road));
      car.speed = (e.road.maxspeed / 3.6) * 0.6;
      car.cruise = (car.type.big ? 0.7 : 0.8) + Math.random() * 0.22;
      car.active = true;
      car.mesh.visible = true;
      car.next = this.chooseNext(e);
      this.position(car, 1);
      return true;
    }
    return false;
  }

  chooseNext(e) {
    const all = (this.graph.out.get(e.b) || []).filter((o) => o.alive);
    const outs = all.filter((o) => o.b !== e.a);
    if (!outs.length) return all[0] || null;
    let best = null, bw = -1;
    for (const o of outs) {
      const straight = o.dx * e.dx + o.dz * e.dz;
      const w = Math.random() * (1 + Math.max(0, straight) * 2.5) * (o.road.rank >= 3 ? 1 : 0.15);
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
    const a = this.graph.pt(e.a);
    if (!a) return;
    const off = this.laneOffset(car, e);
    const x = a.x + e.dx * car.s - e.dz * off;
    const z = a.z + e.dz * car.s + e.dx * off;
    const heading = Math.atan2(-e.dx, -e.dz);
    let dh = heading - car.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    car.heading += dh * blend;
    const k = blend >= 1 ? 1 : Math.min(1, blend * 1.5);
    car.x += (x - car.x) * k;
    car.z += (z - car.z) * k;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    this.q4.setFromAxisAngle(this.up, car.heading);
    this.m4.compose(this.p3.set(car.x, 0.11, car.z), this.q4, this.s3.set(car.width * 1.3, 1, car.len * 1.18));
    this.blobs.setMatrixAt(car.index, this.m4);
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  despawn(c) {
    c.active = false;
    c.mesh.visible = false;
    this.blobs.setMatrixAt(c.index, this.hidden);
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  update(dt, player) {
    const px = player.x, pz = player.z;
    const region = regionAt(px);
    this.edgeCars.clear();
    let active = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      if (!c.edge.alive) {
        this.despawn(c);
        continue;
      }
      active++;
      if (!this.edgeCars.has(c.edge.id)) this.edgeCars.set(c.edge.id, []);
      this.edgeCars.get(c.edge.id).push(c);
    }
    let spawns = 2; // spread spawning over frames
    for (const c of this.cars) {
      if (!c.active) {
        if (active < this.activeTarget && spawns > 0 && this.spawn(c, px, pz, 110, 420, region)) {
          active++;
          spawns--;
        }
        continue;
      }
      if (Math.hypot(c.x - px, c.z - pz) > 520) {
        this.despawn(c);
        continue;
      }
      const e = c.edge;
      const limit = (e.road.maxspeed / 3.6) * c.cruise;
      let target = limit;
      const remain = e.len - c.s;
      const ap = this.lights.stateFor(e.b, e.dx, e.dz);
      if (ap && ap.state !== 'green') {
        const a0 = this.graph.pt(e.a);
        const sLine = (ap.x - a0.x) * e.dx + (ap.z - a0.z) * e.dz;
        const stopDist = sLine - c.s - c.len / 2 - 0.5;
        const comfortable = (c.speed * c.speed) / (2 * 4.5) < stopDist;
        if (stopDist > -1 && (ap.state === 'red' || comfortable)) target = Math.min(target, Math.sqrt(2 * 4 * Math.max(0, stopDist)));
      }
      if (c.next) {
        const turn = c.next.dx * e.dx + c.next.dz * e.dz;
        if (turn < 0.85 && remain < 45) target = Math.min(target, 4 + Math.max(0, turn) * 9 + remain * 0.25);
      }
      let gap = Infinity;
      for (const o of this.edgeCars.get(e.id) || []) {
        if (o === c || o.lane !== c.lane) continue;
        const d = o.s - c.s;
        if (d > 0 && d < gap) gap = d - (o.len + c.len) / 2;
      }
      if (c.next && remain < 45) {
        for (const o of this.edgeCars.get(c.next.id) || []) {
          const d = remain + o.s;
          if (d < gap) gap = d - (o.len + c.len) / 2;
        }
      }
      // yield to the player
      const tx = px - c.x, tz = pz - c.z;
      const hx = -Math.sin(c.heading), hz = -Math.cos(c.heading);
      const ahead = tx * hx + tz * hz;
      const side = Math.abs(tx * -hz + tz * hx);
      if (ahead > 0 && ahead < 45 && side < 2.6) gap = Math.min(gap, ahead - (player.length + c.len) / 2);
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 2.5) * 0.9));

      if (target > c.speed) c.speed = Math.min(target, c.speed + (c.type.big ? 1.4 : 2.6) * dt);
      else c.speed = Math.max(target, c.speed - (gap < 8 ? 12 : 7) * dt);
      c.s += c.speed * dt;
      c.braking = target < c.speed - 0.5 || c.speed < 0.3;
      c.mesh.material.userData.u.uBrake.value = c.braking ? 1 : 0;

      while (c.active && c.s > c.edge.len) {
        c.s -= c.edge.len;
        if (!c.next || !c.next.alive) {
          this.despawn(c);
          break;
        }
        c.edge = c.next;
        c.lane = Math.min(c.lane, lanesPerDirection(c.edge.road) - 1);
        c.next = this.chooseNext(c.edge);
      }
      if (c.active) this.position(c, Math.min(1, dt * 6));
    }
  }

  /** Player collision: returns {nx, nz, car} or null. */
  collide(player) {
    const [fx, fz] = player.forward;
    const pts = [[player.x + fx * 1.3, player.z + fz * 1.3], [player.x - fx * 1.3, player.z - fz * 1.3]];
    for (const c of this.cars) {
      if (!c.active) continue;
      if (Math.abs(c.x - player.x) > 12 || Math.abs(c.z - player.z) > 12) continue;
      const hx = -Math.sin(c.heading), hz = -Math.cos(c.heading);
      const half = c.len / 2 - 1;
      const n = Math.max(2, Math.ceil(c.len / 2.6));
      for (const p of pts) {
        for (let k = 0; k < n; k++) {
          const f = -half + (2 * half * k) / (n - 1);
          const qx = c.x + hx * f, qz = c.z + hz * f;
          const dx = p[0] - qx, dz = p[1] - qz;
          const d = Math.hypot(dx, dz);
          const R = c.type.big ? 2.3 : 1.9;
          if (d < R && d > 1e-3) {
            const nx = dx / d, nz = dz / d;
            player.x += nx * (R - d);
            player.z += nz * (R - d);
            c.speed *= 0.5;
            return { nx, nz, car: c };
          }
        }
      }
    }
    return null;
  }
}
