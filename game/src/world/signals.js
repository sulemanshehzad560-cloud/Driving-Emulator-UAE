// Traffic lights for the streamed world. Each tile brings its signalised
// junctions; nearby signal nodes are clustered into one controller with two
// phase groups (by approach axis) so crossing streams never get green together.
import * as THREE from 'three';

const GREEN = 16, AMBER = 3, ALLRED = 2;

export class TrafficLights {
  constructor(scene) {
    this.scene = scene;
    this.byTile = new Map();
    this.byNode = new Map(); // global node id -> [approach]
    this.approaches = [];
    this.time = 0;
    this.geo = this.buildGeometry();
    this.mats = {
      pole: new THREE.MeshStandardMaterial({ color: 0x4d5257, metalness: 0.6, roughness: 0.45 }),
      head: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55 }),
      plate: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }),
      lens: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    };
  }

  buildGeometry() {
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 6.2, 10);
    pole.translate(0, 3.1, 0);
    const arm = new THREE.CylinderGeometry(0.08, 0.1, 1, 8);
    arm.rotateZ(Math.PI / 2);
    arm.translate(-0.5, 0, 0);
    const head = new THREE.BoxGeometry(0.42, 1.3, 0.32);
    const plate = new THREE.BoxGeometry(0.66, 1.56, 0.03);
    plate.translate(0, 0, -0.18);
    const lens = new THREE.CircleGeometry(0.15, 16);
    const visor = new THREE.CylinderGeometry(0.17, 0.17, 0.22, 12, 1, true, 0, Math.PI);
    visor.rotateX(Math.PI / 2);
    visor.rotateZ(Math.PI);
    return { pole, arm, head, plate, lens, visor };
  }

  addTile(tile) {
    const d = tile.data;
    if (!d.signalApproaches || !d.signalApproaches.length) return;
    const [ox, oy] = d.origin;
    const ids = d.graph.ids;
    const xy = d.graph.xy;
    const aps = d.signalApproaches.map((a) => {
      const nx = ox + xy[a.node * 2], nz = -(oy + xy[a.node * 2 + 1]);
      return { ...a, id: ids[a.node], nx, nz, x: nx - a.dx * a.back, z: nz - a.dz * a.back, state: null };
    });
    // cluster signal nodes within 45 m into controllers
    const nodes = [...new Set(aps.map((a) => a.id))];
    const pos = new Map(aps.map((a) => [a.id, [a.nx, a.nz]]));
    const parent = new Map(nodes.map((n) => [n, n]));
    const find = (n) => (parent.get(n) === n ? n : (parent.set(n, find(parent.get(n))), parent.get(n)));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i]), b = pos.get(nodes[j]);
        if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 45 * 45) parent.set(find(nodes[i]), find(nodes[j]));
      }
    }
    const ctrls = new Map();
    for (const ap of aps) {
      const root = find(ap.id);
      if (!ctrls.has(root)) ctrls.set(root, { axis: null, offset: ((Math.abs(root) * 7919) % 400) / 10, cycle: 2 * (GREEN + AMBER + ALLRED), single: true });
      const c = ctrls.get(root);
      const ang = Math.atan2(ap.dz, ap.dx);
      if (c.axis === null) c.axis = ang;
      let diff = Math.abs((((ang - c.axis) % Math.PI) + Math.PI) % Math.PI);
      diff = Math.min(diff, Math.PI - diff);
      ap.groupIdx = diff < Math.PI / 4 ? 0 : 1;
      if (ap.groupIdx === 1) c.single = false;
      ap.ctrl = c;
      if (!this.byNode.has(ap.id)) this.byNode.set(ap.id, []);
      this.byNode.get(ap.id).push(ap);
    }
    const group = this.buildMeshes(aps);
    this.scene.add(group);
    this.byTile.set(tile.key, { aps, group });
    this.approaches.push(...aps);
    this.update(this.time, true);
  }

  /** Solid signal poles of a tile: flat [x, z, r, ...]. */
  obstaclesFor(tileKey) {
    return this.byTile.get(tileKey)?.group.userData.obstacles || [];
  }

  removeTile(tile) {
    const rec = this.byTile.get(tile.key);
    if (!rec) return;
    this.scene.remove(rec.group);
    rec.group.traverse((o) => o.isInstancedMesh && o.dispose());
    const set = new Set(rec.aps);
    this.approaches = this.approaches.filter((a) => !set.has(a));
    for (const ap of rec.aps) {
      const list = this.byNode.get(ap.id);
      if (!list) continue;
      const kept = list.filter((a) => !set.has(a));
      if (kept.length) this.byNode.set(ap.id, kept);
      else this.byNode.delete(ap.id);
    }
    this.byTile.delete(tile.key);
  }

  buildMeshes(aps) {
    const n = aps.length;
    const G = this.geo, M = this.mats;
    const group = new THREE.Group();
    const poles = new THREE.InstancedMesh(G.pole, M.pole, n);
    const arms = new THREE.InstancedMesh(G.arm, M.pole, n);
    const heads = new THREE.InstancedMesh(G.head, M.head, n * 2);
    const plates = new THREE.InstancedMesh(G.plate, M.plate, n * 2);
    const visors = new THREE.InstancedMesh(G.visor, M.head, n * 6);
    const bulbs = [0, 1, 2].map(() => {
      const m = new THREE.InstancedMesh(G.lens, M.lens, n * 2);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 2 * 3), 3);
      return m;
    });
    const obstacles = []; // signal poles are solid: [x, z, r, ...]
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    aps.forEach((ap, i) => {
      const rx = -ap.dz, rz = ap.dx;
      const side = ap.hw + 1.3;
      const px = ap.x + rx * side, pz = ap.z + rz * side;
      obstacles.push(px, pz, 0.22);
      q.setFromAxisAngle(up, Math.atan2(-ap.dx, -ap.dz));
      m4.compose(v.set(px, 0, pz), q, one);
      poles.setMatrixAt(i, m4);
      const armLen = Math.min(ap.twoWay ? ap.hw : ap.hw * 1.15, 9);
      m4.compose(v.set(px, 6, pz), q, new THREE.Vector3(armLen, 1, 1));
      arms.setMatrixAt(i, m4);
      const heads2 = [[px, 3.3, pz], [px - rx * armLen * 0.85, 5.3, pz - rz * armLen * 0.85]];
      heads2.forEach(([hx, hy, hz], k) => {
        const hi = i * 2 + k;
        m4.compose(v.set(hx, hy, hz), q, one);
        heads.setMatrixAt(hi, m4);
        plates.setMatrixAt(hi, m4);
        for (let b = 0; b < 3; b++) {
          const off = new THREE.Vector3(0, 0.4 - b * 0.4, 0.165).applyQuaternion(q);
          m4.compose(v.set(hx + off.x, hy + off.y, hz + off.z), q, one);
          bulbs[b].setMatrixAt(hi, m4);
          const offV = new THREE.Vector3(0, 0.4 - b * 0.4 + 0.02, 0.27).applyQuaternion(q);
          m4.compose(v.set(hx + offV.x, hy + offV.y, hz + offV.z), q, one);
          visors.setMatrixAt(hi * 3 + b, m4);
        }
      });
      ap.index = i;
    });
    for (const m of [poles, arms, heads, plates, visors, ...bulbs]) {
      m.computeBoundingSphere();
      group.add(m);
    }
    poles.castShadow = arms.castShadow = heads.castShadow = true;
    group.userData.bulbs = bulbs;
    for (const ap of aps) ap.bulbs = bulbs;
    group.userData.obstacles = obstacles;
    return group;
  }

  stateOf(ctrl, groupIdx, t) {
    const T = (t + ctrl.offset) % ctrl.cycle;
    if (ctrl.single) {
      const c = T % 42;
      return c < 34 ? 'green' : c < 37 ? 'amber' : 'red';
    }
    const half = GREEN + AMBER + ALLRED;
    const local = groupIdx === 0 ? T : (T + half) % ctrl.cycle;
    if (local < GREEN) return 'green';
    if (local < GREEN + AMBER) return 'amber';
    return 'red';
  }

  update(t, force = false) {
    this.time = t;
    const off = [0.06, 0.06, 0.06];
    const RED = [1, 0.08, 0.05], AMB = [1, 0.6, 0], GRN = [0.1, 1, 0.4];
    const dirty = new Set();
    const c = new THREE.Color();
    for (const ap of this.approaches) {
      const st = this.stateOf(ap.ctrl, ap.groupIdx, t);
      if (st === ap.state && !force) continue;
      ap.state = st;
      for (let k = 0; k < 2; k++) {
        const hi = ap.index * 2 + k;
        ap.bulbs[0].setColorAt(hi, c.setRGB(...(st === 'red' ? RED : off)));
        ap.bulbs[1].setColorAt(hi, c.setRGB(...(st === 'amber' ? AMB : off)));
        ap.bulbs[2].setColorAt(hi, c.setRGB(...(st === 'green' ? GRN : off)));
      }
      dirty.add(ap.bulbs);
    }
    for (const b of dirty) for (const m of b) m.instanceColor.needsUpdate = true;
  }

  /** Signal for traffic moving along (dx, dz) into node id, or null. */
  stateFor(id, dx, dz) {
    const list = this.byNode.get(id);
    if (!list) return null;
    let best = null, bd = -2;
    for (const ap of list) {
      const d = ap.dx * dx + ap.dz * dz;
      if (d > bd) { bd = d; best = ap; }
    }
    return best && bd > 0.7 ? best : null;
  }

  checkCrossing(x0, z0, x1, z1) {
    for (const ap of this.approaches) {
      if (Math.abs(ap.x - x1) > 30 || Math.abs(ap.z - z1) > 30) continue;
      const s0 = (x0 - ap.x) * ap.dx + (z0 - ap.z) * ap.dz;
      const s1 = (x1 - ap.x) * ap.dx + (z1 - ap.z) * ap.dz;
      if (!(s0 < 0 && s1 >= 0)) continue;
      const lat = (x1 - ap.x) * -ap.dz + (z1 - ap.z) * ap.dx;
      const from = ap.twoWay ? -0.5 : -ap.hw - 0.5;
      if (lat < from || lat > ap.hw + 0.5) continue;
      return ap;
    }
    return null;
  }

  /** Nearest approach ahead of the player (for the HUD). */
  ahead(x, z, fx, fz, maxDist = 150) {
    let best = null, bd = maxDist;
    for (const ap of this.approaches) {
      const dx = ap.x - x, dz = ap.z - z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > bd) continue;
      if (Math.abs(dx * -fz + dz * fx) > ap.hw + 3) continue;
      if (ap.dx * fx + ap.dz * fz < 0.8) continue;
      bd = along;
      best = { ap, dist: along };
    }
    return best;
  }
}
