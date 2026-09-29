// Prop geometries (built once) and per-tile instancing helpers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { speedSignTexture, stopSignTexture } from '../render/textures.js';

function merge(list) {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  const m = mergeGeometries(clean, false);
  m.computeBoundingSphere();
  return m;
}

export class Props {
  constructor(M) {
    this.M = M;
    this.geo = {};
    this.build();
    this.textCache = new Map();
  }

  build() {
    const G = this.geo;
    // ---- date palm: curved ringed trunk + 14 drooping fronds + crown
    const trunk = new THREE.CylinderGeometry(0.2, 0.32, 8, 10, 8, true);
    trunk.translate(0, 4, 0);
    const tp = trunk.attributes.position;
    const tuv = trunk.attributes.uv;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      tp.setX(i, tp.getX(i) + (y / 8) ** 2 * 0.6);
      tuv.setXY(i, tuv.getX(i) * 2, (y / 8) * 12);
    }
    trunk.computeVertexNormals();
    G.palmTrunk = trunk;
    const fronds = [];
    for (let i = 0; i < 14; i++) {
      const len = 3.4 + (i % 3) * 0.4;
      const g = new THREE.PlaneGeometry(1.3, len, 1, 6);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const t = Math.min(1, Math.max(0, (p.getY(k) + len / 2) / len)); // 0 at base, 1 at tip
        p.setY(k, t * len);
        p.setZ(k, -(t ** 1.8) * len * 0.55 + (p.getX(k) ** 2) * 0.25); // droop + V-shaped leaflets
      }
      g.rotateX(-Math.PI / 2 + 0.55 - (i % 2) * 0.35);
      g.rotateY((i / 14) * Math.PI * 2 + (i % 3) * 0.15);
      g.translate(0.6, 7.9, 0);
      fronds.push(g);
    }
    G.palmCrown = merge(fronds);
    G.palmCrown.computeVertexNormals();

    // ---- street lights
    const pole = new THREE.CylinderGeometry(0.09, 0.16, 11, 8);
    pole.translate(0, 5.5, 0);
    const base = new THREE.CylinderGeometry(0.28, 0.32, 0.6, 8);
    base.translate(0, 0.3, 0);
    const arm = (dir) => {
      const a = new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6);
      a.rotateZ(Math.PI / 2 - dir * 0.15);
      a.translate(dir * 1.3, 11, 0);
      return a;
    };
    G.lampSingle = merge([pole.clone(), base.clone(), arm(1)]);
    G.lampDouble = merge([pole, base, arm(1), arm(-1)]);
    const head = (dir) => {
      const h = new THREE.BoxGeometry(0.9, 0.14, 0.34);
      h.translate(dir * 2.6, 10.95, 0);
      return h;
    };
    G.headSingle = merge([head(1)]);
    G.headDouble = merge([head(1), head(-1)]);
    const pool = new THREE.CircleGeometry(7.5, 20);
    pool.rotateX(-Math.PI / 2);
    pool.translate(0, 0.12, 0);
    G.pool = pool;

    // ---- signs
    const sp = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
    sp.translate(0, 1.3, 0);
    G.signPole = sp;
    const face = new THREE.CircleGeometry(0.45, 24);
    face.translate(0, 2.6, 0.06);
    G.signFace = face;
    const back = new THREE.CircleGeometry(0.45, 24);
    back.rotateY(Math.PI);
    back.translate(0, 2.6, 0.05);
    G.signBack = back;
    const oct = new THREE.CircleGeometry(0.45, 8);
    oct.rotateZ(Math.PI / 8);
    oct.translate(0, 2.6, 0.06);
    G.stopFace = oct;

    // ---- street furniture
    const seat = new THREE.BoxGeometry(1.8, 0.08, 0.45);
    seat.translate(0, 0.45, 0);
    const backrest = new THREE.BoxGeometry(1.8, 0.4, 0.06);
    backrest.translate(0, 0.72, -0.2);
    G.bench = merge([seat, backrest]);
    const legs = [];
    for (const x of [-0.8, 0.8]) {
      const l = new THREE.BoxGeometry(0.08, 0.45, 0.4);
      l.translate(x, 0.225, 0);
      legs.push(l);
    }
    G.benchLegs = merge(legs);
    const bin = new THREE.CylinderGeometry(0.28, 0.24, 0.95, 12);
    bin.translate(0, 0.475, 0);
    G.bin = bin;
    const ub = new THREE.BoxGeometry(0.9, 1.3, 0.45);
    ub.translate(0, 0.65, 0);
    G.utility = ub;
    // Dubai air-conditioned bus shelter: glass box with a slim roof
    const glass = [];
    const frame = [];
    const W = 4.5, D = 2, H = 2.6;
    for (const [sx, sy, sz, x, y, z] of [[W, H, 0.05, 0, H / 2, -D / 2], [0.05, H, D, -W / 2, H / 2, 0], [0.05, H, D, W / 2, H / 2, 0], [1.6, H, 0.05, -W / 2 + 0.8, H / 2, D / 2], [1.6, H, 0.05, W / 2 - 0.8, H / 2, D / 2]]) {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(x, y, z);
      glass.push(g);
    }
    const roof = new THREE.BoxGeometry(W + 0.4, 0.18, D + 0.5);
    roof.translate(0, H + 0.09, 0);
    frame.push(roof);
    const base2 = new THREE.BoxGeometry(W + 0.2, 0.12, D + 0.2);
    base2.translate(0, 0.06, 0);
    frame.push(base2);
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
      const p = new THREE.BoxGeometry(0.1, H, 0.1);
      p.translate(x, H / 2, z);
      frame.push(p);
    }
    G.shelterGlass = merge(glass);
    G.shelterFrame = merge(frame);

    // ---- rooftop chiller / water tank
    G.rooftop = new THREE.BoxGeometry(1, 1, 1);

    // ---- mosque dome, minaret, tower spire
    const dome = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const drum = new THREE.CylinderGeometry(1, 1, 0.35, 20, 1, true);
    drum.translate(0, -0.17, 0);
    G.dome = merge([dome, drum]);
    const shaft = new THREE.CylinderGeometry(0.8, 1, 1, 12);
    shaft.translate(0, 0.5, 0);
    G.minaretShaft = shaft;
    const balcony = new THREE.CylinderGeometry(1.35, 1.1, 0.5, 12);
    const cap = new THREE.ConeGeometry(0.9, 2.8, 12);
    cap.translate(0, 1.6, 0);
    G.minaretTop = merge([balcony, cap]);
    const spire = new THREE.CylinderGeometry(0.15, 1, 1, 8);
    spire.translate(0, 0.5, 0);
    G.spire = spire;

    // ---- overhead gantry frame (unit width, scaled per instance)
    G.gantryLeg = new THREE.BoxGeometry(0.35, 7.2, 0.35);
    G.gantryLeg.translate(0, 3.6, 0);
    G.gantryBeam = new THREE.BoxGeometry(1, 0.5, 0.4);
  }

  /** Build all prop meshes for one tile. Returns a Group (tile-local). */
  tileGroup(inst, opts) {
    const M = this.M;
    const G = this.geo;
    const group = new THREE.Group();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const shadow = !!opts.shadows;

    const instanced = (geo, mat, arr, stride, fill, castShadow = shadow) => {
      if (!arr || !arr.length) return null;
      const n = Math.floor(arr.length / stride);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        fill(arr, i * stride, m4);
        mesh.setMatrixAt(i, m4);
      }
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      mesh.computeBoundingSphere();
      group.add(mesh);
      return mesh;
    };
    const placeYaw = (a, o, m, scale = 1, y = 0) => {
      q.setFromAxisAngle(up, a[o + 2]);
      m.compose(v.set(a[o], y, a[o + 1]), q, s.set(scale, scale, scale));
    };

    instanced(G.palmTrunk, M.palmTrunk, inst.palm, 4, (a, o, m) => placeYaw(a, o, m, a[o + 3]));
    instanced(G.palmCrown, M.palmLeaf, inst.palm, 4, (a, o, m) => placeYaw(a, o, m, a[o + 3]));
    // lamps: split singles and doubles
    if (inst.lamp) {
      const singles = [], doubles = [];
      for (let i = 0; i < inst.lamp.length; i += 4) (inst.lamp[i + 3] ? doubles : singles).push(inst.lamp[i], inst.lamp[i + 1], inst.lamp[i + 2]);
      instanced(G.lampSingle, M.pole, singles, 3, (a, o, m) => placeYaw(a, o, m));
      instanced(G.headSingle, M.lampHead, singles, 3, (a, o, m) => placeYaw(a, o, m), false);
      instanced(G.lampDouble, M.pole, doubles, 3, (a, o, m) => placeYaw(a, o, m));
      instanced(G.headDouble, M.lampHead, doubles, 3, (a, o, m) => placeYaw(a, o, m), false);
    }
    instanced(G.pool, M.lightPool, inst.pool, 3, (a, o, m) => m.makeTranslation(a[o], 0, a[o + 1]), false);
    if (inst.speed) {
      for (const [speed, arr] of Object.entries(inst.speed)) {
        if (!this.speedMats) this.speedMats = {};
        if (!this.speedMats[speed]) this.speedMats[speed] = new THREE.MeshStandardMaterial({ map: speedSignTexture(+speed), roughness: 0.5, emissive: 0x222222 });
        instanced(G.signPole, M.pole, arr, 3, (a, o, m) => placeYaw(a, o, m), false);
        instanced(G.signFace, this.speedMats[speed], arr, 3, (a, o, m) => placeYaw(a, o, m), false);
        instanced(G.signBack, M.signBack, arr, 3, (a, o, m) => placeYaw(a, o, m), false);
      }
    }
    instanced(G.bench, M.bench, inst.bench, 3, (a, o, m) => placeYaw(a, o, m), false);
    instanced(G.benchLegs, M.darkMetal, inst.bench, 3, (a, o, m) => placeYaw(a, o, m), false);
    instanced(G.bin, M.bin, inst.bin, 3, (a, o, m) => placeYaw(a, o, m), false);
    instanced(G.utility, M.utility, inst.utility, 3, (a, o, m) => placeYaw(a, o, m), false);
    instanced(G.shelterFrame, M.shelterFrame, inst.shelter, 3, (a, o, m) => placeYaw(a, o, m));
    instanced(G.shelterGlass, M.shelterGlass, inst.shelter, 3, (a, o, m) => placeYaw(a, o, m), false);
    instanced(G.rooftop, M.rooftop, inst.rooftop, 7, (a, o, m) => {
      q.setFromAxisAngle(up, a[o + 3]);
      m.compose(v.set(a[o], a[o + 1], a[o + 2]), q, s.set(a[o + 4], a[o + 5], a[o + 6]));
    });
    if (inst.dome) {
      const gold = [], white = [];
      for (let i = 0; i < inst.dome.length; i += 5) (inst.dome[i + 4] ? gold : white).push(...inst.dome.slice(i, i + 4));
      const fill = (a, o, m) => m.compose(v.set(a[o], a[o + 1] + 0.35, a[o + 2]), q.identity(), s.set(a[o + 3], a[o + 3] * 1.15, a[o + 3]));
      instanced(G.dome, M.dome, white, 4, fill);
      instanced(G.dome, M.domeGold, gold, 4, fill);
    }
    if (inst.minaret) {
      const minarets = [], spires = [];
      for (let i = 0; i < inst.minaret.length; i += 6) (inst.minaret[i + 5] ? spires : minarets).push(...inst.minaret.slice(i, i + 5));
      instanced(G.minaretShaft, M.mosque, minarets, 5, (a, o, m) => m.compose(v.set(a[o], a[o + 1], a[o + 2]), q.identity(), s.set(a[o + 3], a[o + 4], a[o + 3])));
      instanced(G.minaretTop, M.dome, minarets, 5, (a, o, m) => m.compose(v.set(a[o], a[o + 1] + a[o + 4], a[o + 2]), q.identity(), s.set(a[o + 3], a[o + 3], a[o + 3])));
      instanced(G.spire, M.pole, spires, 5, (a, o, m) => m.compose(v.set(a[o], a[o + 1], a[o + 2]), q.identity(), s.set(a[o + 3], a[o + 4], a[o + 3])));
    }
    for (const gt of inst.gantry || []) group.add(this.gantry(gt));
    return group;
  }

  gantry({ x, z, rot, width, name, ref }) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    const hw = width / 2;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(this.geo.gantryLeg, this.M.pole);
      leg.userData.sharedGeometry = true;
      leg.position.x = sx * hw;
      g.add(leg);
    }
    const beam = new THREE.Mesh(this.geo.gantryBeam, this.M.pole);
    beam.userData.sharedGeometry = true;
    beam.scale.x = width;
    beam.position.y = 7.2;
    g.add(beam);
    const text = `${ref ? ref + '  ' : ''}${name || 'Highway'}`;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width * 0.8, 11), 2.2), this.signMaterial(text));
    sign.position.set(0, 6.2, 0.25);
    g.add(sign);
    const backSign = new THREE.Mesh(sign.geometry, this.M.gantryGreen);
    backSign.rotation.y = Math.PI;
    backSign.position.set(0, 6.2, 0.2);
    g.add(backSign);
    return g;
  }

  signMaterial(text) {
    if (this.textCache.has(text)) return this.textCache.get(text);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 104;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b6b3a';
    ctx.fillRect(0, 0, 512, 104);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 500, 92);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = text.match(/^(E ?\d+|D ?\d+|E\d+)\s+(.*)$/);
    if (m) {
      // route shield + name
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(18, 22, 110, 60);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px Arial';
      ctx.fillText(m[1].replace(' ', ''), 73, 54);
      ctx.font = 'bold 34px Arial';
      ctx.fillText(m[2].slice(0, 22), 320, 54);
    } else {
      ctx.font = 'bold 36px Arial';
      ctx.fillText(text.slice(0, 26), 256, 54);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0x111111 });
    this.textCache.set(text, mat);
    return mat;
  }

  stopSigns(list) {
    const group = new THREE.Group();
    if (!list.length) return group;
    const mat = this.stopMat || (this.stopMat = new THREE.MeshStandardMaterial({ map: stopSignTexture(), roughness: 0.5, emissive: 0x220000 }));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const n = list.length / 3;
    const poles = new THREE.InstancedMesh(this.geo.signPole, this.M.pole, n);
    const faces = new THREE.InstancedMesh(this.geo.stopFace, mat, n);
    for (let i = 0; i < n; i++) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), list[i * 3 + 2]);
      m4.compose(new THREE.Vector3(list[i * 3], 0, list[i * 3 + 1]), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m4);
      faces.setMatrixAt(i, m4);
    }
    group.add(poles, faces);
    return group;
  }
}
