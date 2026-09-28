// Procedural car models: side-profile silhouettes extruded with bevels,
// a glass greenhouse, clear-coat paint and detailed wheels.
// Local frame: car faces -Z, +Y up, origin at ground level between the axles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Profiles in metres: u along the length (rear = -L/2, front = +L/2), v up.
const STYLES = {
  sedan: {
    L: 5.18, W: 1.92, wheelR: 0.36, track: 1.66, axleF: 1.55, axleR: -1.52, ride: 0.2,
    body: [[-2.59, 0.38], [-2.6, 0.72], [-2.5, 0.98], [-2.25, 1.02], [-1.3, 1.02], [1.05, 0.98], [2.2, 0.86], [2.5, 0.74], [2.6, 0.55], [2.57, 0.36]],
    cabin: [[-1.95, 0.98], [-1.2, 1.44], [0.3, 1.47], [1.2, 0.98]],
  },
  coupe: {
    L: 4.75, W: 1.9, wheelR: 0.35, track: 1.64, axleF: 1.45, axleR: -1.38, ride: 0.17,
    body: [[-2.37, 0.38], [-2.38, 0.72], [-2.28, 0.93], [-1.9, 0.97], [0.9, 0.92], [2.0, 0.8], [2.33, 0.66], [2.38, 0.5], [2.34, 0.34]],
    cabin: [[-1.95, 0.95], [-0.9, 1.34], [0.1, 1.36], [1.0, 0.92]],
  },
  gt: {
    L: 4.6, W: 1.98, wheelR: 0.36, track: 1.7, axleF: 1.5, axleR: -1.2, ride: 0.13,
    body: [[-2.3, 0.35], [-2.32, 0.7], [-2.2, 0.86], [-1.7, 0.9], [0.4, 0.88], [1.6, 0.76], [2.2, 0.6], [2.31, 0.44], [2.26, 0.3]],
    cabin: [[-2.0, 0.88], [-0.8, 1.26], [-0.15, 1.28], [0.55, 0.88]],
    spoiler: true,
  },
  suv: {
    L: 5.05, W: 2.0, wheelR: 0.4, track: 1.72, axleF: 1.55, axleR: -1.5, ride: 0.3,
    body: [[-2.52, 0.5], [-2.54, 0.95], [-2.45, 1.16], [-1.6, 1.18], [1.3, 1.14], [2.25, 1.02], [2.5, 0.86], [2.55, 0.6], [2.5, 0.46]],
    cabin: [[-2.42, 1.16], [-2.2, 1.78], [0.6, 1.8], [1.45, 1.14]],
  },
  boxy: {
    L: 4.85, W: 1.98, wheelR: 0.42, track: 1.66, axleF: 1.48, axleR: -1.4, ride: 0.34,
    body: [[-2.42, 0.52], [-2.43, 1.24], [2.28, 1.24], [2.34, 1.12], [2.42, 0.95], [2.42, 0.52]],
    cabin: [[-2.4, 1.23], [-2.38, 1.95], [0.95, 1.95], [1.12, 1.23]],
    spare: true, sharp: true,
  },
  super: {
    L: 4.6, W: 2.02, wheelR: 0.35, track: 1.72, axleF: 1.45, axleR: -1.35, ride: 0.11,
    body: [[-2.3, 0.33], [-2.32, 0.78], [-2.1, 0.86], [-1.0, 0.9], [0.2, 0.84], [1.4, 0.64], [2.2, 0.46], [2.3, 0.33]],
    cabin: [[-1.35, 0.88], [-0.7, 1.16], [0.05, 1.18], [0.95, 0.72]],
    spoiler: true, intakes: true,
  },
  hyper: {
    L: 4.7, W: 2.05, wheelR: 0.36, track: 1.76, axleF: 1.5, axleR: -1.4, ride: 0.09,
    body: [[-2.35, 0.3], [-2.37, 0.74], [-2.0, 0.84], [-0.9, 0.9], [0.2, 0.82], [1.5, 0.56], [2.3, 0.36], [2.35, 0.28]],
    cabin: [[-1.5, 0.86], [-0.6, 1.12], [0.1, 1.12], [1.0, 0.66]],
    spoiler: true, intakes: true, fin: true,
  },
  van: {
    L: 5.2, W: 2.0, wheelR: 0.38, track: 1.72, axleF: 1.75, axleR: -1.6, ride: 0.28,
    body: [[-2.6, 0.48], [-2.6, 2.05], [1.6, 2.05], [2.3, 1.2], [2.6, 0.95], [2.6, 0.48]],
    cabin: [[1.2, 1.9], [1.62, 1.95], [2.22, 1.22], [1.5, 1.22]], sharp: true,
  },
};

const sharedMats = new Map();
function mat(key, make) {
  if (!sharedMats.has(key)) sharedMats.set(key, make());
  return sharedMats.get(key);
}

export function paintMaterial(color, quality = 'high') {
  return mat(`paint-${color}-${quality}`, () =>
    quality === 'low'
      ? new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 })
      : new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
  );
}

function smoothPath(points, segments = 6, sharp = false) {
  if (sharp) return points.map(([u, v]) => new THREE.Vector2(u, v));
  const curve = new THREE.SplineCurve(points.map(([u, v]) => new THREE.Vector2(u, v)));
  return curve.getPoints(points.length * segments);
}

function profileShape(profile, st, arches) {
  const shape = new THREE.Shape();
  const top = smoothPath(profile, 5, st.sharp);
  // bottom edge from front to rear with wheel arches
  shape.moveTo(top[0].x, top[0].y);
  for (const p of top) shape.lineTo(p.x, p.y);
  const bottom = st.ride + 0.06;
  const front = profile[profile.length - 1];
  shape.lineTo(front[0], bottom);
  if (arches) {
    for (const ax of [st.axleF, st.axleR]) {
      const r = st.wheelR + 0.07;
      shape.lineTo(ax + r, bottom);
      shape.absarc(ax, st.wheelR, r, 0, Math.PI, false);
      shape.lineTo(ax - r, bottom);
    }
  }
  shape.lineTo(profile[0][0], bottom);
  shape.closePath();
  return shape;
}

function extrude(shape, width, bevel, curveSegs) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: bevel > 0 ? 3 : 0,
    curveSegments: curveSegs,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // +u (front) -> -Z
  return g;
}

function wheel(st, detail) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(st.wheelR, st.wheelR, 0.26, detail ? 24 : 12, 1),
    mat('tyre', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 })),
  );
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const rimMat = mat('rim', () => new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 1, roughness: 0.22 }));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(st.wheelR * 0.68, st.wheelR * 0.68, 0.28, detail ? 20 : 10), mat('rimdark', () => new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.8, roughness: 0.4 })));
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  if (detail) {
    const spokes = 5;
    for (let i = 0; i < spokes; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, st.wheelR * 1.3, 0.07), rimMat);
      s.position.x = 0.14;
      s.rotation.x = (i / spokes) * Math.PI * 2;
      g.add(s);
      const s2 = s.clone();
      s2.position.x = -0.14;
      g.add(s2);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10), rimMat);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(st.wheelR * 0.5, st.wheelR * 0.5, 0.2, 16), mat('brake', () => new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.5 })));
    disc.rotation.z = Math.PI / 2;
    g.add(disc);
  }
  return g;
}

/**
 * Build a car model.
 * @returns {THREE.Group} with userData {wheels: [fl, fr, rl, rr], brakeMat, headMat, spec}
 */
export function buildCar({ style = 'sedan', color = 0xffffff, detail = true, taxi = false, quality = 'high' } = {}) {
  const st = STYLES[style] || STYLES.sedan;
  const car = new THREE.Group();
  const paint = paintMaterial(color, detail ? quality : 'low');
  const glass = mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x0b1118, metalness: 0.9, roughness: 0.05, transparent: false }));
  const trim = mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.5, metalness: 0.3 }));
  const chrome = mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 }));

  const bodyW = st.W;
  const body = new THREE.Mesh(extrude(profileShape(st.body, st, true), bodyW, detail ? 0.12 : 0.06, detail ? 10 : 5), paint);
  body.castShadow = true;
  car.add(body);

  // greenhouse (glass) and roof panel
  const cabinW = bodyW * 0.84;
  const cabinPts = smoothPath(st.cabin, 4, st.sharp).map((p) => [p.x, p.y]);
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(cabinPts[0][0], cabinPts[0][1] - 0.05);
  for (const p of cabinPts) cabinShape.lineTo(p[0], p[1]);
  cabinShape.lineTo(cabinPts[cabinPts.length - 1][0], cabinPts[cabinPts.length - 1][1] - 0.05);
  cabinShape.closePath();
  const cabin = new THREE.Mesh(extrude(cabinShape, cabinW, detail ? 0.08 : 0.04, 4), glass);
  car.add(cabin);
  // roof: thin painted slab over the top of the greenhouse
  const roofTop = Math.max(...st.cabin.map((p) => p[1]));
  const roofPts = st.cabin.filter((p) => p[1] > roofTop - 0.06);
  if (roofPts.length >= 2) {
    const r0 = roofPts[0][0], r1 = roofPts[roofPts.length - 1][0];
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.94, 0.05, Math.abs(r1 - r0) + 0.25), taxi ? mat('taxiroof', () => new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4 })) : paint);
    roof.position.set(0, roofTop + 0.01, -(r0 + r1) / 2);
    car.add(roof);
  }

  // lights
  const front = st.body[st.body.length - 2];
  const rear = st.body[1];
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 0.6 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0a0a, emissiveIntensity: 0.4 });
  const headY = Math.min(front[1] + 0.02, (st.body[st.body.length - 3][1] + front[1]) / 2);
  const frontZ = -st.L / 2 + 0.02;
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.1), headMat);
    hl.position.set(s * (bodyW / 2 - 0.3), headY, frontZ + 0.06);
    car.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.08), brakeMat);
    tl.position.set(s * (bodyW / 2 - 0.3), rear[1] - 0.05, st.L / 2 - 0.02);
    car.add(tl);
  }
  // full-width light bar on the rear (modern look)
  if (detail && style !== 'boxy' && style !== 'van') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.9, 0.03, 0.06), brakeMat);
    bar.position.set(0, rear[1] - 0.02, st.L / 2 - 0.01);
    car.add(bar);
  }
  // grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(style === 'boxy' ? 1.1 : 0.75, style === 'boxy' ? 0.3 : 0.2, 0.06), trim);
  grille.position.set(0, (st.ride + front[1]) / 2 + 0.05, frontZ);
  car.add(grille);
  if (detail) {
    const slats = style === 'boxy' ? 4 : 2;
    for (let i = 0; i < slats; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(style === 'boxy' ? 1.05 : 0.7, 0.015, 0.02), chrome);
      sl.position.set(0, grille.position.y - 0.08 + (i + 0.5) * (0.16 / slats) * (style === 'boxy' ? 1.5 : 1), frontZ - 0.035);
      car.add(sl);
    }
  }
  // door shut lines and chrome handles
  if (detail && style !== 'van') {
    const belt = st.cabin[0][1];
    const doorTop = belt - 0.04, doorBot = st.ride + 0.2;
    const seamH = doorTop - doorBot;
    const cuts = style === 'super' || style === 'hyper' || style === 'gt' || style === 'coupe'
      ? [st.cabin[st.cabin.length - 1][0] - 0.05, st.cabin[0][0] + 0.55]
      : [st.cabin[st.cabin.length - 1][0] - 0.05, (st.cabin[0][0] + st.cabin[st.cabin.length - 1][0]) / 2 - 0.1, st.cabin[0][0] + 0.35];
    for (const s of [-1, 1]) {
      for (const u of cuts) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, seamH, 0.012), trim);
        seam.position.set(s * (bodyW / 2 + 0.005), doorBot + seamH / 2, -u);
        car.add(seam);
      }
      for (let k = 0; k < cuts.length - 1; k++) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.16), chrome);
        handle.position.set(s * (bodyW / 2 + 0.012), doorTop - 0.12, -(cuts[k + 1] + 0.25));
        car.add(handle);
      }
    }
  }
  // side sills between the wheel arches
  const sillLen = st.axleF - st.axleR - (st.wheelR + 0.1) * 2;
  for (const s of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, sillLen), trim);
    sill.position.set(s * (bodyW / 2 - 0.01), st.ride + 0.12, -(st.axleF + st.axleR) / 2);
    car.add(sill);
  }
  // mirrors
  if (detail) {
    for (const s of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), paint);
      const base = st.cabin[st.cabin.length - 1];
      mirror.position.set(s * (bodyW / 2 + 0.05), base[1] + 0.08, -base[0] + 0.25);
      car.add(mirror);
    }
  }
  if (st.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.9, 0.04, 0.32), style === 'gt' ? paint : trim);
    wing.position.set(0, rear[1] + (style === 'gt' ? 0.1 : 0.22), st.L / 2 - 0.25);
    car.add(wing);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.1), trim);
      post.position.set(s * bodyW * 0.3, rear[1] + 0.08, st.L / 2 - 0.25);
      car.add(post);
    }
  }
  if (st.intakes) {
    for (const s of [-1, 1]) {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.7), trim);
      intake.position.set(s * (bodyW / 2 + 0.005), 0.58, 0.5);
      car.add(intake);
    }
  }
  if (st.fin) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 1.3), paint);
    fin.position.set(0, 1.0, 1.1);
    car.add(fin);
  }
  if (st.spare) {
    const spare = wheel({ ...st, wheelR: 0.36 }, false);
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0, 1.0, st.L / 2 + 0.15);
    car.add(spare);
  }
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.22), mat('taxisign', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd24a, emissiveIntensity: 0.6 })));
    sign.position.set(0, roofTop + 0.12, 0);
    car.add(sign);
  }

  const wheels = [];
  for (const [ax, s] of [[st.axleF, -1], [st.axleF, 1], [st.axleR, -1], [st.axleR, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * (st.track / 2), st.wheelR, -ax);
    const w = wheel(st, detail);
    pivot.add(w);
    car.add(pivot);
    wheels.push(pivot);
  }

  // fake contact shadow for cheap quality levels
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(st.W * 1.15, st.L * 1.05),
    mat('blob', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 })),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.11;
  car.add(blob);

  car.userData = { wheels, brakeMat, headMat, style: st, paint };
  car.traverse((o) => {
    if (o.isMesh && o !== blob) o.castShadow = detail;
  });
  return car;
}

export function styleDims(style) {
  const st = STYLES[style] || STYLES.sedan;
  return { L: st.L, W: st.W, wheelbase: st.axleF - st.axleR };
}

// ---- cheap traffic cars: every part merged into one mesh per material ----

const bakedCache = new Map();

function bake(style, taxi) {
  const key = `${style}-${taxi}`;
  if (bakedCache.has(key)) return bakedCache.get(key);
  const src = buildCar({ style, color: 0xffffff, detail: false, taxi, quality: 'low' });
  src.updateMatrixWorld(true);
  const groups = new Map();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const matKey = o.material === src.userData.paint ? 'paint' : o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    if (!groups.has(matKey)) groups.set(matKey, []);
    groups.get(matKey).push(g);
  });
  const parts = [];
  for (const [m, list] of groups) parts.push({ material: m, geometry: mergeGeometries(list, false) });
  const out = { parts, dims: styleDims(style) };
  bakedCache.set(key, out);
  return out;
}

export function buildTrafficCar(style, color, taxi = false) {
  const { parts } = bake(style, taxi);
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material === 'paint' ? paintMaterial(color, 'low') : p.material);
    m.matrixAutoUpdate = false;
    g.add(m);
  }
  return g;
}
