// Traffic-light controllers built from OSM highway=traffic_signals nodes.
// Nearby signal nodes are clustered into one junction with two phase groups
// (by approach axis) so crossing streets never show green together.
import * as THREE from 'three';
import { mergeSimple } from './worldBuilder.js';

const GREEN = 16, AMBER = 3, ALLRED = 2;

export class Signals {
  constructor(graph, world) {
    this.graph = graph;
    this.world = world;
    this.group = new THREE.Group();
    this.controllers = [];
    this.approaches = []; // {ctrl, groupIdx, node, x, z, dx, dz, hw, headIndex}
    this.byNode = new Map(); // node -> [approach]
    this.build();
  }

  build() {
    const g = this.graph;
    const sig = (g.map.signals || []).filter((n) => g.nodeRoads.has(n));
    // cluster within 45 m
    const parent = sig.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < sig.length; i++) {
      for (let j = i + 1; j < sig.length; j++) {
        const a = g.pts[sig[i]], b = g.pts[sig[j]];
        if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 45 * 45) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map();
    sig.forEach((n, i) => {
      const r = find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r).push(n);
    });

    for (const nodes of clusters.values()) {
      const ctrl = { nodes, axis: null, offset: Math.random() * 40, cycle: 2 * (GREEN + AMBER + ALLRED), states: ['red', 'red'] };
      for (const n of nodes) {
        const p = g.pts[n];
        for (const rid of g.nodeRoads.get(n)) {
          const road = g.roads[rid];
          const k = road.n.indexOf(n);
          const neighbours = [];
          if (k > 0) neighbours.push(road.n[k - 1]); // traffic arriving forwards
          if (!road.oneway && k < road.n.length - 1) neighbours.push(road.n[k + 1]); // arriving backwards
          for (const from of neighbours) {
            if (nodes.includes(from)) continue; // internal link between two signal nodes of the same junction
            const a = g.pts[from];
            let dx = p[0] - a[0], dz = p[1] - a[1];
            const len = Math.hypot(dx, dz);
            if (len < 3) continue;
            dx /= len; dz /= len;
            const ang = Math.atan2(dz, dx);
            if (ctrl.axis === null) ctrl.axis = ang;
            let diff = Math.abs(((ang - ctrl.axis) % Math.PI + Math.PI) % Math.PI);
            diff = Math.min(diff, Math.PI - diff);
            const groupIdx = diff < Math.PI / 4 ? 0 : 1;
            const hw = road.oneway ? road.width / 2 : road.width / 2; // stop line spans our half on two-way roads
            const back = Math.min(len - 1, 3 + (this.world.junctionR.get(n) || 0));
            const ap = {
              ctrl, groupIdx, node: n, road, hw, dx, dz,
              x: p[0] - dx * back, z: p[1] - dz * back,
              twoWay: !road.oneway,
            };
            this.approaches.push(ap);
            if (!this.byNode.has(n)) this.byNode.set(n, []);
            this.byNode.get(n).push(ap);
          }
        }
      }
      // pedestrian-crossing style signal (only one axis): short red phase
      ctrl.single = !this.approaches.some((a) => a.ctrl === ctrl && a.groupIdx === 1);
      this.controllers.push(ctrl);
    }
    this.buildMeshes();
    this.update(0);
  }

  buildMeshes() {
    const n = this.approaches.length;
    if (!n) return;
    const pole = new THREE.CylinderGeometry(0.11, 0.14, 6, 8);
    pole.translate(0, 3, 0);
    const arm = new THREE.CylinderGeometry(0.08, 0.08, 1, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(-0.5, 0, 0); // extends to -x (towards road centre after placement), length scaled per instance
    const head = new THREE.BoxGeometry(0.42, 1.25, 0.32);
    const lens = new THREE.CircleGeometry(0.14, 12);
    const up = new THREE.Vector3(0, 1, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5c6166, metalness: 0.6, roughness: 0.45 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    this.poles = new THREE.InstancedMesh(mergeSimple([pole]), poleMat, n);
    this.arms = new THREE.InstancedMesh(arm, poleMat, n);
    this.heads = new THREE.InstancedMesh(head, headMat, n * 2); // side head + overhead head
    this.bulbs = [0, 1, 2].map(() => {
      const m = new THREE.InstancedMesh(lens, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n * 2);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 2 * 3), 3);
      return m;
    });
    const stopLines = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    this.approaches.forEach((ap, i) => {
      const rx = -ap.dz, rz = ap.dx; // right of travel direction
      const side = ap.hw + 1.2;
      const px = ap.x + rx * side, pz = ap.z + rz * side;
      const rot = Math.atan2(-ap.dx, -ap.dz); // local +Z faces oncoming drivers
      q.setFromAxisAngle(up, rot);
      m4.compose(v.set(px, 0, pz), q, s);
      this.poles.setMatrixAt(i, m4);
      // arm over the road (towards the left of the driver -> local -X after rotation)
      const armLen = Math.min(ap.twoWay ? ap.hw : ap.hw * 1.2, 9);
      m4.compose(v.set(px, 5.8, pz), q, new THREE.Vector3(armLen, 1, 1));
      this.arms.setMatrixAt(i, m4);
      // side head at 3 m and overhead head at arm end
      const heads = [
        [px, 3.2, pz],
        [px - rx * armLen * 0.85, 5.1, pz - rz * armLen * 0.85],
      ];
      heads.forEach(([hx, hy, hz], k) => {
        const hi = i * 2 + k;
        m4.compose(v.set(hx, hy, hz), q, s);
        this.heads.setMatrixAt(hi, m4);
        for (let b = 0; b < 3; b++) {
          const off = new THREE.Vector3(0, 0.38 - b * 0.38, 0.165).applyQuaternion(q);
          m4.compose(v.set(hx + off.x, hy + off.y, hz + off.z), q, s);
          this.bulbs[b].setMatrixAt(hi, m4);
        }
      });
      ap.headIndex = i;
      stopLines.push(ap);
    });
    this.group.add(this.poles, this.arms, this.heads, ...this.bulbs);

    // stop lines
    const pos = [], idx = [];
    for (const ap of stopLines) {
      const rx = -ap.dz, rz = ap.dx;
      const from = ap.twoWay ? 0.2 : -ap.hw + 0.3;
      const to = ap.hw - 0.3;
      const w = 0.5;
      const base = pos.length / 3;
      const p = (o, f) => [ap.x + rx * o + ap.dx * f, 0.1, ap.z + rz * o + ap.dz * f];
      pos.push(...p(from, -w), ...p(to, -w), ...p(to, 0), ...p(from, 0));
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  stateOf(ctrl, groupIdx, t) {
    const T = (t + ctrl.offset) % ctrl.cycle;
    if (ctrl.single) {
      // green 34 s, amber 3 s, red 5 s
      const c = T % 42;
      return c < 34 ? 'green' : c < 37 ? 'amber' : 'red';
    }
    const half = GREEN + AMBER + ALLRED;
    const local = groupIdx === 0 ? T : (T + half) % ctrl.cycle;
    if (local < GREEN) return 'green';
    if (local < GREEN + AMBER) return 'amber';
    return 'red';
  }

  update(t) {
    this.time = t;
    if (!this.bulbs) return;
    const off = [0.08, 0.08, 0.08];
    const colors = { red: [1.0, 0.08, 0.05], amber: [1.0, 0.62, 0.0], green: [0.1, 1.0, 0.35] };
    let dirty = false;
    for (const ap of this.approaches) {
      const st = this.stateOf(ap.ctrl, ap.groupIdx, t);
      if (st === ap.state) continue;
      ap.state = st;
      dirty = true;
      for (let k = 0; k < 2; k++) {
        const hi = ap.headIndex * 2 + k;
        this.bulbs[0].setColorAt(hi, new THREE.Color(...(st === 'red' ? colors.red : off)));
        this.bulbs[1].setColorAt(hi, new THREE.Color(...(st === 'amber' ? colors.amber : off)));
        this.bulbs[2].setColorAt(hi, new THREE.Color(...(st === 'green' ? colors.green : off)));
      }
    }
    if (dirty) for (const b of this.bulbs) b.instanceColor.needsUpdate = true;
  }

  /** State for traffic travelling along (dx,dz) into node n, or null if no light. */
  stateFor(n, dx, dz) {
    const list = this.byNode.get(n);
    if (!list) return null;
    let best = null, bd = -2;
    for (const ap of list) {
      const d = ap.dx * dx + ap.dz * dz;
      if (d > bd) { bd = d; best = ap; }
    }
    return best && bd > 0.7 ? best : null;
  }

  /** Detect a vehicle crossing a stop line on red. Returns the approach or null. */
  checkCrossing(x0, z0, x1, z1) {
    for (const ap of this.approaches) {
      if (Math.abs(ap.x - x1) > 30 || Math.abs(ap.z - z1) > 30) continue;
      const s0 = (x0 - ap.x) * ap.dx + (z0 - ap.z) * ap.dz;
      const s1 = (x1 - ap.x) * ap.dx + (z1 - ap.z) * ap.dz;
      if (!(s0 < 0 && s1 >= 0)) continue;
      const lat = (x1 - ap.x) * -ap.dz + (z1 - ap.z) * ap.dx; // right offset
      const from = ap.twoWay ? -0.5 : -ap.hw - 0.5;
      if (lat < from || lat > ap.hw + 0.5) continue;
      return ap;
    }
    return null;
  }
}
