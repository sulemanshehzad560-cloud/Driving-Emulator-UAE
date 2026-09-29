// Procedural car models.
// Body: side-profile silhouette extruded with bevels, then sculpted in plan
// view (rounded corners, tumblehome, tucked sills) so it reads as a car, not
// a slab. Tinted see-through glass with a visible interior, multi-spoke rims
// with brake discs and calipers, LED daytime running lights, UAE plates.
// Local frame: car faces -Z, +Y up, origin at ground level between the axles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dubaiPlate } from '../render/texgen.js';

// Profiles in metres: u along the length (rear = -L/2, front = +L/2), v up.
const STYLES = {
  sedan: {
    L: 5.18, W: 1.92, wheelR: 0.36, track: 1.66, axleF: 1.55, axleR: -1.52, ride: 0.2, caliper: 0x1a1a1a,
    body: [[-2.59, 0.38], [-2.6, 0.72], [-2.5, 0.98], [-2.25, 1.02], [-1.3, 1.02], [1.05, 0.98], [2.2, 0.86], [2.5, 0.74], [2.6, 0.55], [2.57, 0.36]],
    cabin: [[-1.95, 0.98], [-1.2, 1.44], [0.3, 1.47], [1.2, 0.98]],
  },
  coupe: {
    L: 4.75, W: 1.9, wheelR: 0.35, track: 1.64, axleF: 1.45, axleR: -1.38, ride: 0.17, caliper: 0xc8102e,
    body: [[-2.37, 0.38], [-2.38, 0.72], [-2.28, 0.93], [-1.9, 0.97], [0.9, 0.92], [2.0, 0.8], [2.33, 0.66], [2.38, 0.5], [2.34, 0.34]],
    cabin: [[-1.95, 0.95], [-0.9, 1.34], [0.1, 1.36], [1.0, 0.92]],
  },
  gt: {
    L: 4.6, W: 1.98, wheelR: 0.36, track: 1.7, axleF: 1.5, axleR: -1.2, ride: 0.13, caliper: 0xf2c200,
    body: [[-2.3, 0.35], [-2.32, 0.7], [-2.2, 0.86], [-1.7, 0.9], [0.4, 0.88], [1.6, 0.76], [2.2, 0.6], [2.31, 0.44], [2.26, 0.3]],
    cabin: [[-2.0, 0.88], [-0.8, 1.26], [-0.15, 1.28], [0.55, 0.88]],
    spoiler: true,
  },
  suv: {
    L: 5.05, W: 2.0, wheelR: 0.4, track: 1.72, axleF: 1.55, axleR: -1.5, ride: 0.3, caliper: 0x1a1a1a,
    body: [[-2.52, 0.5], [-2.54, 0.95], [-2.45, 1.16], [-1.6, 1.18], [1.3, 1.14], [2.25, 1.02], [2.5, 0.86], [2.55, 0.6], [2.5, 0.46]],
    cabin: [[-2.42, 1.16], [-2.2, 1.78], [0.6, 1.8], [1.45, 1.14]],
  },
  boxy: {
    L: 4.85, W: 1.98, wheelR: 0.42, track: 1.66, axleF: 1.48, axleR: -1.4, ride: 0.34, caliper: 0x1a1a1a,
    body: [[-2.42, 0.52], [-2.43, 1.24], [2.28, 1.24], [2.34, 1.12], [2.42, 0.95], [2.42, 0.52]],
    cabin: [[-2.4, 1.23], [-2.38, 1.95], [0.95, 1.95], [1.12, 1.23]],
    spare: true, sharp: true, flares: true,
  },
  g63: {
    L: 4.87, W: 2.0, wheelR: 0.44, track: 1.7, axleF: 1.48, axleR: -1.41, ride: 0.33, caliper: 0xc8102e,
    body: [[-2.42, 0.52], [-2.43, 1.25], [2.26, 1.25], [2.33, 1.14], [2.42, 0.98], [2.43, 0.5]],
    cabin: [[-2.4, 1.24], [-2.38, 1.97], [0.93, 1.97], [1.1, 1.24]],
    spare: true, sharp: true, flares: true, g: true, darkRims: true,
  },
  super: {
    L: 4.6, W: 2.02, wheelR: 0.35, track: 1.72, axleF: 1.45, axleR: -1.35, ride: 0.11, caliper: 0xf2c200,
    body: [[-2.3, 0.33], [-2.32, 0.78], [-2.1, 0.86], [-1.0, 0.9], [0.2, 0.84], [1.4, 0.64], [2.2, 0.46], [2.3, 0.33]],
    cabin: [[-1.35, 0.88], [-0.7, 1.16], [0.05, 1.18], [0.95, 0.72]],
    spoiler: true, intakes: true,
  },
  hyper: {
    L: 4.7, W: 2.05, wheelR: 0.36, track: 1.76, axleF: 1.5, axleR: -1.4, ride: 0.09, caliper: 0x0a84ff,
    body: [[-2.35, 0.3], [-2.37, 0.74], [-2.0, 0.84], [-0.9, 0.9], [0.2, 0.82], [1.5, 0.56], [2.3, 0.36], [2.35, 0.28]],
    cabin: [[-1.5, 0.86], [-0.6, 1.12], [0.1, 1.12], [1.0, 0.66]],
    spoiler: true, intakes: true, fin: true,
  },
  van: {
    L: 5.2, W: 2.0, wheelR: 0.38, track: 1.72, axleF: 1.75, axleR: -1.6, ride: 0.28, caliper: 0x1a1a1a,
    body: [[-2.6, 0.48], [-2.6, 2.05], [1.6, 2.05], [2.3, 1.2], [2.6, 0.95], [2.6, 0.48]],
    cabin: [[1.2, 1.9], [1.62, 1.95], [2.22, 1.22], [1.5, 1.22]], sharp: true, noInterior: true,
  },
  pickup: {
    L: 5.35, W: 1.9, wheelR: 0.4, track: 1.62, axleF: 1.75, axleR: -1.55, ride: 0.32, caliper: 0x1a1a1a,
    body: [[-2.67, 0.55], [-2.68, 1.1], [0.3, 1.1], [0.35, 1.14], [1.5, 1.12], [2.4, 1.02], [2.65, 0.85], [2.67, 0.55]],
    cabin: [[-0.55, 1.12], [-0.5, 1.82], [0.85, 1.82], [1.45, 1.12]], sharp: true, bed: true,
  },
  bus: {
    L: 12, W: 2.55, wheelR: 0.5, track: 2.1, axleF: 4.1, axleR: -3.0, ride: 0.3, caliper: 0x1a1a1a,
    body: [[-6, 0.4], [-6, 3.15], [5.85, 3.15], [6, 2.95], [6, 0.4]],
    cabin: [[-5.9, 1.25], [-5.9, 2.75], [5.8, 2.75], [5.98, 1.25]], sharp: true, noInterior: true, bus: true,
  },
};

const sharedMats = new Map();
function mat(key, make) {
  if (!sharedMats.has(key)) sharedMats.set(key, make());
  return sharedMats.get(key);
}

export function paintMaterial(color, quality = 'high') {
  return mat(`paint-${color}-${quality}`, () => {
    const m = quality === 'low'
      ? new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.32 })
      : new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 });
    m.userData.isPaint = true;
    return m;
  });
}

const M = {
  glass: () => mat('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x0a1016, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.62, envMapIntensity: 2, clearcoat: 1, depthWrite: false })),
  glassOpaque: () => mat('glassOpaque', () => new THREE.MeshStandardMaterial({ color: 0x0b1118, metalness: 0.85, roughness: 0.05 })),
  trim: () => mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.55, metalness: 0.2 })),
  chrome: () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 })),
  tyre: () => mat('tyre', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 })),
  rim: () => mat('rim', () => new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 1, roughness: 0.2 })),
  rimDark: () => mat('rimDark', () => new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.9, roughness: 0.35 })),
  disc: () => mat('disc', () => new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.9, roughness: 0.45 })),
  seat: () => mat('seat', () => new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 0.7 })),
  plate: () => mat('plate', () => {
    const t = new THREE.CanvasTexture(dubaiPlate('K 7 1971'));
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 });
  }),
  lensHead: () => mat('lensHead', () => new THREE.MeshStandardMaterial({ color: 0x20262c, metalness: 0.8, roughness: 0.1 })),
  indicatorLens: () => mat('indicatorLens', () => new THREE.MeshStandardMaterial({ color: 0x663300, emissive: 0xff8c00, emissiveIntensity: 0 })),
};

function smoothPath(points, segments = 6, sharp = false) {
  if (sharp) return points.map(([u, v]) => new THREE.Vector2(u, v));
  const curve = new THREE.SplineCurve(points.map(([u, v]) => new THREE.Vector2(u, v)));
  return curve.getPoints(points.length * segments);
}

function profileShape(profile, st, arches) {
  const shape = new THREE.Shape();
  const top = smoothPath(profile, 5, st.sharp);
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
  g.rotateY(Math.PI / 2); // +u (front) -> -Z, width along X
  return g;
}

/**
 * Sculpt an extruded slab into a car-like volume: round the corners in plan
 * view, pull the flanks in towards the top (tumblehome) and tuck the sills.
 */
function sculpt(g, st, { taper = 0.1, tumble = 0.06, yLo = 0, yHi = 1, tuck = true } = {}) {
  const p = g.attributes.position;
  const halfL = st.L / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.min(1, Math.abs(z) / halfL);
    let k = 1 - taper * t ** 3;
    const h = Math.max(0, Math.min(1, (y - yLo) / Math.max(0.01, yHi - yLo)));
    k *= 1 - tumble * h * h;
    if (tuck && y < st.ride + 0.28) k *= 0.965;
    p.setX(i, x * k);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- wheels
const wheelGeoCache = new Map();
function wheelGeometries(r, detail) {
  const key = `${r}-${detail}`;
  if (wheelGeoCache.has(key)) return wheelGeoCache.get(key);
  const w = 0.27;
  // tyre: lathe profile with rounded sidewalls
  const prof = [];
  const rimR = r * 0.7;
  const segs = detail ? 10 : 5;
  for (let i = 0; i <= segs; i++) {
    const a = -Math.PI / 2 + (i / segs) * Math.PI;
    prof.push(new THREE.Vector2(r - 0.04 + Math.cos(a) * 0.04, (Math.sin(a) * w) / 2));
  }
  prof.unshift(new THREE.Vector2(rimR, -w / 2));
  prof.push(new THREE.Vector2(rimR, w / 2));
  const tyre = new THREE.LatheGeometry(prof, detail ? 28 : 14);
  tyre.rotateZ(Math.PI / 2);
  // rim face: shallow dish + 10 twin spokes
  const parts = [];
  const barrel = new THREE.CylinderGeometry(rimR, rimR, w * 0.9, detail ? 24 : 12, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  const hub = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.26, 0.06, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(w * 0.42, 0, 0);
  parts.push(hub);
  const lip = new THREE.TorusGeometry(rimR * 0.97, 0.018, 6, detail ? 28 : 12);
  lip.rotateY(Math.PI / 2);
  lip.translate(w * 0.44, 0, 0);
  parts.push(lip);
  if (detail) {
    for (let i = 0; i < 10; i++) {
      const s = new THREE.BoxGeometry(0.028, rimR * 0.78, 0.045);
      s.translate(0, rimR * 0.5, 0);
      s.rotateX((i / 10) * Math.PI * 2 + (i % 2) * 0.12);
      s.translate(w * 0.4, 0, 0);
      parts.push(s);
    }
  }
  const rim = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    return g;
  }));
  const disc = new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.03, 20);
  disc.rotateZ(Math.PI / 2);
  disc.translate(w * 0.12, 0, 0);
  const caliper = new THREE.BoxGeometry(0.07, rimR * 0.42, rimR * 0.3);
  caliper.translate(w * 0.22, rimR * 0.52, 0);
  const out = { tyre, rim, disc, caliper };
  wheelGeoCache.set(key, out);
  return out;
}

/** Icon 4x4 details: grille frame + badge ring, fender-top indicators, steps, side pipes, hinges, gutters. */
function gDetails(car, st, { bodyW, frontZ, front, trim, chrome, grilleY, gW, gH, belt, detail }) {
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    car.add(o);
    return o;
  };
  // chrome grille frame and a plain round badge (no manufacturer logo)
  add(new THREE.BoxGeometry(gW + 0.06, 0.025, 0.05), chrome, 0, grilleY + gH / 2 + 0.01, frontZ - 0.03);
  add(new THREE.BoxGeometry(gW + 0.06, 0.025, 0.05), chrome, 0, grilleY - gH / 2 - 0.01, frontZ - 0.03);
  add(new THREE.TorusGeometry(0.075, 0.012, 10, 32), chrome, 0, grilleY, frontZ - 0.06);
  add(new THREE.CircleGeometry(0.064, 28), trim, 0, grilleY, frontZ - 0.058, 0, Math.PI);
  // indicators sitting on top of the front wings
  const amber = mat('g-amber', () => new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 0.25, roughness: 0.2 }));
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.1, 0.05, 0.15), amber, s * (bodyW / 2 - 0.1), front[1] + 0.3, frontZ + 0.12);
    add(new THREE.BoxGeometry(0.12, 0.012, 0.17), chrome, s * (bodyW / 2 - 0.1), front[1] + 0.27, frontZ + 0.12);
  }
  // sculpted front bumper with three intakes and LED strips
  add(new THREE.BoxGeometry(bodyW - 0.04, 0.3, 0.14), trim, 0, st.ride + 0.25, frontZ - 0.02);
  const drl = mat('g-drl', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }));
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.12, 0.02), mat('g-mesh', () => new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 })), s * 0.62, st.ride + 0.24, frontZ - 0.095);
    add(new THREE.BoxGeometry(0.3, 0.012, 0.02), drl, s * 0.62, st.ride + 0.32, frontZ - 0.1);
  }
  if (!detail) return;
  const sillLen = st.axleF - st.axleR - (st.wheelR + 0.14) * 2;
  const midZ = -(st.axleF + st.axleR) / 2;
  for (const s of [-1, 1]) {
    // running boards with a chrome kick strip
    add(new THREE.BoxGeometry(0.2, 0.05, sillLen), trim, s * (bodyW / 2 + 0.08), st.ride + 0.02, midZ);
    add(new THREE.BoxGeometry(0.2, 0.012, sillLen - 0.1), chrome, s * (bodyW / 2 + 0.08), st.ride + 0.05, midZ);
    // twin side-exit exhausts ahead of the rear wheels
    for (const dz of [0, 0.13]) {
      add(new THREE.CylinderGeometry(0.042, 0.042, 0.14, 16, 1, true), chrome, s * (bodyW / 2 + 0.06), st.ride + 0.12, -st.axleR - st.wheelR - 0.25 - dz, 0, 0, Math.PI / 2);
    }
    // exposed door hinges and roof gutter
    for (const y of [belt - 0.15, st.ride + 0.45]) add(new THREE.BoxGeometry(0.03, 0.08, 0.05), chrome, s * (bodyW / 2 + 0.005), y, -st.cabin[st.cabin.length - 1][0] + 0.05);
    const roofTop = Math.max(...st.cabin.map((p) => p[1]));
    add(new THREE.BoxGeometry(0.03, 0.03, st.cabin[st.cabin.length - 1][0] - st.cabin[0][0]), chrome, s * (bodyW * 0.47), roofTop - 0.02, -(st.cabin[0][0] + st.cabin[st.cabin.length - 1][0]) / 2);
  }
}

function wheel(st, detail, side) {
  const g = new THREE.Group();
  const geo = wheelGeometries(st.wheelR, detail);
  const spin = new THREE.Group(); // rotates with the road
  spin.add(new THREE.Mesh(geo.tyre, M.tyre()));
  const rim = new THREE.Mesh(geo.rim, st.bus || st.darkRims ? M.rimDark() : M.rim());
  if (side < 0) rim.scale.x = -1; // spokes face outwards on both sides
  spin.add(rim);
  if (detail) {
    const disc = new THREE.Mesh(geo.disc, M.disc());
    if (side < 0) disc.scale.x = -1;
    spin.add(disc);
    // caliper does not spin
    const cal = new THREE.Mesh(geo.caliper, mat(`cal-${st.caliper}`, () => new THREE.MeshStandardMaterial({ color: st.caliper, roughness: 0.4 })));
    if (side < 0) cal.scale.x = -1;
    g.add(cal);
  }
  g.add(spin);
  g.userData.spin = spin;
  return g;
}

/**
 * Build a car model.
 * @returns {THREE.Group} with userData {wheels, brakeMat, headMat, drlMat, paint, indicators}
 */
export function buildCar({ style = 'sedan', color = 0xffffff, detail = true, taxi = false, taxiRoof = 0xc8102e, quality = 'high' } = {}) {
  const st = STYLES[style] || STYLES.sedan;
  const car = new THREE.Group();
  const paint = paintMaterial(color, detail ? quality : 'low');
  const trim = M.trim();
  const chrome = M.chrome();
  const belt = st.cabin[0][1];
  const roofTop = Math.max(...st.cabin.map((p) => p[1]));

  const bodyW = st.W;
  const bodyGeo = sculpt(extrude(profileShape(st.body, st, true), bodyW, detail ? 0.12 : 0.06, detail ? 10 : 5), st, {
    taper: st.bus || st.sharp ? 0.03 : 0.12, tumble: st.bus ? 0.01 : 0.05, yLo: st.ride, yHi: belt,
  });
  const body = new THREE.Mesh(bodyGeo, paint);
  car.add(body);
  // bevels push the skin past the nominal profile: lamps, plates and pipes sit on the real surface
  bodyGeo.computeBoundingBox();
  const zFront = bodyGeo.boundingBox.min.z, zRear = bodyGeo.boundingBox.max.z;

  // greenhouse: see-through tinted glass for detailed cars, dark mirror glass for traffic
  const cabinW = bodyW * (st.bus ? 0.99 : 0.9);
  const cabinPts = smoothPath(st.cabin, 4, st.sharp).map((p) => [p.x, p.y]);
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(cabinPts[0][0], cabinPts[0][1] - 0.05);
  for (const p of cabinPts) cabinShape.lineTo(p[0], p[1]);
  cabinShape.lineTo(cabinPts[cabinPts.length - 1][0], cabinPts[cabinPts.length - 1][1] - 0.05);
  cabinShape.closePath();
  const cabinGeo = sculpt(extrude(cabinShape, cabinW, detail ? 0.08 : 0.04, 4), st, {
    taper: st.bus || st.sharp ? 0.02 : 0.1, tumble: st.bus || st.sharp ? 0.04 : 0.2, yLo: belt, yHi: roofTop, tuck: false,
  });
  const see = detail && !st.noInterior && !st.g;
  const cabin = new THREE.Mesh(cabinGeo, st.g ? paint : see ? M.glass() : M.glassOpaque());
  if (st.g) {
    // body-coloured greenhouse with dark tinted panes set into it
    const tint = mat('g-tint', () => new THREE.MeshPhysicalMaterial({ color: 0x040507, metalness: 0.1, roughness: 0.08, envMapIntensity: 0.3 }));
    const roofTopG = Math.max(...st.cabin.map((p) => p[1]));
    const y0 = belt + 0.1, y1 = roofTopG - 0.1;
    for (const [u0, u1] of [[0.08, 0.86], [-0.98, -0.06], [-2.22, -1.1]]) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(cabinW + 0.012, y1 - y0, u1 - u0), tint);
      pane.position.set(0, (y0 + y1) / 2, -(u0 + u1) / 2);
      pane.renderOrder = 3;
      car.add(pane);
    }
    const fb = st.cabin[st.cabin.length - 1], ft = st.cabin[st.cabin.length - 2];
    const wsLen = Math.hypot(fb[0] - ft[0], fb[1] - ft[1]) - 0.16;
    const ws = new THREE.Mesh(new THREE.BoxGeometry(cabinW - 0.18, wsLen, 0.02), tint);
    ws.position.set(0, (fb[1] + ft[1]) / 2, -(fb[0] + ft[0]) / 2 - 0.02);
    ws.rotation.x = Math.atan2(fb[0] - ft[0], ft[1] - fb[1]);
    const rw = new THREE.Mesh(new THREE.BoxGeometry(cabinW - 0.34, y1 - y0 - 0.06, 0.02), tint);
    rw.position.set(0, (y0 + y1) / 2 + 0.02, -st.cabin[0][0] + 0.02);
    car.add(ws, rw);
  }
  cabin.renderOrder = 2;
  car.add(cabin);

  // roof panel + pillars keep the silhouette solid
  const roofPts = st.cabin.filter((p) => p[1] > roofTop - 0.06);
  if (roofPts.length >= 2) {
    const r0 = roofPts[0][0], r1 = roofPts[roofPts.length - 1][0];
    const roofMat = taxi ? mat(`taxiroof-${taxiRoof}`, () => new THREE.MeshStandardMaterial({ color: taxiRoof, roughness: 0.4 })) : paint;
    const roofW = cabinW * (st.sharp ? 0.97 : 0.8);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.06, Math.abs(r1 - r0) + (st.sharp ? 0.1 : 0.3)), roofMat);
    roof.position.set(0, roofTop + 0.005, -(r0 + r1) / 2);
    car.add(roof);
    if (detail && !st.bus) {
      // A and C pillars in body colour
      const aBase = st.cabin[st.cabin.length - 1], aTop = roofPts[roofPts.length - 1];
      const cBase = st.cabin[0], cTop = roofPts[0];
      for (const [b, t] of [[aBase, aTop], [cBase, cTop]]) {
        const len = Math.hypot(t[0] - b[0], t[1] - b[1]);
        for (const s of [-1, 1]) {
          const pil = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.09), st.sharp ? paint : trim);
          pil.position.set(s * cabinW * (st.sharp ? 0.49 : 0.43), (b[1] + t[1]) / 2, -(b[0] + t[0]) / 2);
          pil.rotation.x = Math.atan2(-(t[0] - b[0]), t[1] - b[1]);
          car.add(pil);
        }
      }
    }
  }

  // interior visible through the glass
  if (see) {
    const seatMat = M.seat();
    const floorY = st.ride + 0.35;
    const midU = (st.cabin[0][0] + st.cabin[st.cabin.length - 1][0]) / 2;
    const seats = style === 'super' || style === 'hyper' || st.spoiler ? [[midU + 0.1, 1]] : [[midU + 0.35, 1], [midU - 0.55, 0]];
    for (const [u, front] of seats) {
      for (const s of front ? [-1, 1] : [0]) {
        const w = front ? 0.5 : cabinW * 0.8;
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.5), seatMat);
        cushion.position.set(s * 0.38, floorY + 0.12, -u);
        const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.62, 0.12), seatMat);
        back.position.set(s * 0.38, floorY + 0.45, -u + 0.28);
        back.rotation.x = 0.18;
        car.add(cushion, back);
        if (front) {
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.1), seatMat);
          head.position.set(s * 0.38, floorY + 0.86, -u + 0.33);
          car.add(head);
        }
      }
    }
    const dash = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.9, 0.22, 0.35), trim);
    dash.position.set(0, belt - 0.04, -st.cabin[st.cabin.length - 1][0] + 0.25);
    car.add(dash);
  }

  // ---------------- lights
  const front = st.body[st.body.length - 2];
  const rear = st.body[1];
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 0.6 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0a0a, emissiveIntensity: 0.4 });
  const drlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 });
  const headY = Math.min(front[1] + 0.02, (st.body[st.body.length - 3][1] + front[1]) / 2);
  const frontZ = zFront + 0.02;
  const lampX = bodyW / 2 - (st.bus ? 0.35 : 0.32);
  for (const s of [-1, 1]) {
    if (st.g) {
      // round headlamps with a full LED halo ring
      const x = s * (bodyW / 2 - 0.3), y = front[1] + 0.04;
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.1, 32), trim);
      bucket.rotation.x = Math.PI / 2;
      bucket.position.set(x, y, frontZ + 0.04);
      const lensG = new THREE.Mesh(new THREE.CircleGeometry(0.135, 32), M.lensHead());
      lensG.rotation.y = Math.PI;
      lensG.position.set(x, y, frontZ - 0.012);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.013, 8, 48), drlMat);
      halo.position.set(x, y, frontZ - 0.014);
      const proj = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), headMat);
      proj.rotation.y = Math.PI;
      proj.position.set(x, y, frontZ - 0.016);
      car.add(bucket, lensG, halo, proj);
      const tlg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.06), brakeMat);
      tlg.position.set(s * (bodyW / 2 - 0.14), rear[1] - 0.3, zRear + 0.005);
      car.add(tlg);
      continue;
    }
    // headlight housing with projector lens and LED eyebrow
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.12), M.lensHead());
    housing.position.set(s * lampX, headY, frontZ + 0.07);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), headMat);
    lens.position.set(s * (lampX - 0.08), headY, frontZ + 0.005);
    lens.rotation.y = Math.PI;
    const lens2 = lens.clone();
    lens2.position.x = s * (lampX + 0.08);
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.03), drlMat);
    drl.position.set(s * lampX, headY + 0.06, frontZ + 0.01);
    car.add(housing, lens, lens2, drl);
    // tail light cluster
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), brakeMat);
    tl.position.set(s * lampX, rear[1] - 0.06, zRear - 0.02);
    car.add(tl);
  }
  if (detail && !st.sharp) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 1.0, 0.03, 0.06), brakeMat);
    bar.position.set(0, rear[1] - 0.03, zRear - 0.01);
    car.add(bar);
  }
  // indicators (driven by the game)
  const indMat = { left: M.indicatorLens().clone(), right: M.indicatorLens().clone() };
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), sx < 0 ? indMat.left : indMat.right);
    m.position.set(sx * (bodyW / 2 - 0.1), sz < 0 ? headY - 0.08 : rear[1] - 0.18, sz < 0 ? frontZ - 0.02 : zRear - 0.02);
    car.add(m);
  }

  // grille
  const gW = st.g ? 0.92 : st.style === 'boxy' ? 1.1 : st.bus ? 1.6 : 0.8;
  const gH = st.g ? 0.34 : st.style === 'boxy' ? 0.32 : st.bus ? 0.25 : 0.22;
  const grille = new THREE.Mesh(new THREE.BoxGeometry(gW, gH, 0.06), trim);
  grille.position.set(0, st.g ? front[1] + 0.02 : (st.ride + front[1]) / 2 + 0.05, frontZ);
  car.add(grille);
  if (detail) {
    const vertical = style === 'boxy' || st.g;
    const n = st.g ? 15 : vertical ? 9 : 3;
    for (let i = 0; i < n; i++) {
      const sl = vertical
        ? new THREE.Mesh(new THREE.BoxGeometry(0.02, gH * 0.9, 0.02), chrome)
        : new THREE.Mesh(new THREE.BoxGeometry(gW * 0.92, 0.015, 0.02), chrome);
      if (vertical) sl.position.set(-gW / 2 + ((i + 0.5) * gW) / n, grille.position.y, frontZ - 0.035);
      else sl.position.set(0, grille.position.y - gH / 2 + ((i + 0.5) * gH) / n, frontZ - 0.035);
      car.add(sl);
    }
    // lower intake
    const intake = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.62, 0.1, 0.05), trim);
    intake.position.set(0, st.ride + 0.2, frontZ - 0.01);
    car.add(intake);
  }
  if (st.g) gDetails(car, st, { bodyW, frontZ, front, rear, paint, trim, chrome, grilleY: grille.position.y, gW, gH, belt, detail });
  // number plates
  if (!st.bus) {
    for (const z of [frontZ - 0.02, zRear + 0.02]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.13), M.plate());
      plate.position.set(0, st.ride + (z < 0 ? 0.26 : 0.45), z);
      if (z < 0) plate.rotation.y = Math.PI;
      car.add(plate);
    }
  }
  // exhausts
  if (detail && !st.bus && style !== 'van') {
    for (const s of style === 'super' || style === 'hyper' || style === 'gt' ? [-0.25, 0.25] : [0.55]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12, 1, true), chrome);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(s * (bodyW / 2), st.ride + 0.12, zRear - 0.02);
      car.add(ex);
    }
  }
  // door shut lines and handles
  if (detail && !st.bus && style !== 'van') {
    const doorTop = belt - 0.04, doorBot = st.ride + 0.2;
    const seamH = doorTop - doorBot;
    const cuts = style === 'super' || style === 'hyper' || style === 'gt' || style === 'coupe'
      ? [st.cabin[st.cabin.length - 1][0] - 0.05, st.cabin[0][0] + 0.55]
      : [st.cabin[st.cabin.length - 1][0] - 0.05, (st.cabin[0][0] + st.cabin[st.cabin.length - 1][0]) / 2 - 0.1, st.cabin[0][0] + 0.35];
    for (const s of [-1, 1]) {
      for (const u of cuts) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, seamH, 0.012), trim);
        seam.position.set(s * (bodyW / 2 - 0.02), doorBot + seamH / 2, -u);
        car.add(seam);
      }
      for (let k = 0; k < cuts.length - 1; k++) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.16), chrome);
        handle.position.set(s * (bodyW / 2 - 0.005), doorTop - 0.12, -(cuts[k + 1] + 0.25));
        car.add(handle);
      }
    }
  }
  // sills
  const sillLen = st.axleF - st.axleR - (st.wheelR + 0.1) * 2;
  for (const s of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, sillLen), trim);
    sill.position.set(s * (bodyW / 2 - 0.04), st.ride + 0.12, -(st.axleF + st.axleR) / 2);
    car.add(sill);
  }
  // wheel-arch flares (G-class style)
  if (st.flares) {
    for (const ax of [st.axleF, st.axleR]) {
      for (const s of [-1, 1]) {
        const fl = new THREE.Mesh(new THREE.TorusGeometry(st.wheelR + 0.1, 0.05, 6, 16, Math.PI), trim);
        fl.rotation.y = Math.PI / 2;
        fl.position.set(s * (bodyW / 2 + 0.01), st.wheelR, -ax);
        car.add(fl);
      }
    }
  }
  // mirrors
  if (detail) {
    for (const s of [-1, 1]) {
      const base = st.cabin[st.cabin.length - 1];
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.13), paint);
      mirror.position.set(s * (bodyW / 2 + 0.06), base[1] + 0.1, -base[0] + 0.25);
      const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), chrome);
      glassM.position.set(s * (bodyW / 2 + 0.06), base[1] + 0.1, -base[0] + 0.32);
      car.add(mirror, glassM);
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
      intake.position.set(s * (bodyW / 2 - 0.03), 0.58, 0.5);
      car.add(intake);
    }
  }
  if (st.fin) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 1.3), paint);
    fin.position.set(0, 1.0, 1.1);
    car.add(fin);
  }
  if (st.bed) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.86, 0.05, 1.9), trim);
    bed.position.set(0, 1.08, 1.6);
    car.add(bed);
  }
  if (st.bus) {
    // RTA-style livery band and destination display
    const band = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.02, 0.25, st.L * 0.98), mat('busband', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })));
    band.position.y = 1.05;
    const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.25), mat('busdest', () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa000, emissiveIntensity: 1.2 })));
    dest.position.set(0, 2.95, frontZ - 0.01);
    dest.rotation.y = Math.PI;
    car.add(band, dest);
  }
  if (st.spare) {
    const spare = wheel({ ...st, wheelR: 0.36 }, false, 1);
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0, 1.0, zRear + 0.15);
    car.add(spare);
  }
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.17, 0.24), mat('taxisign', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd24a, emissiveIntensity: 0.7 })));
    sign.position.set(0, roofTop + 0.12, 0);
    car.add(sign);
  }

  const wheels = [];
  for (const [ax, s] of [[st.axleF, -1], [st.axleF, 1], [st.axleR, -1], [st.axleR, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * (st.track / 2), st.wheelR, -ax);
    const w = wheel(st, detail, s);
    pivot.add(w);
    pivot.userData.spin = w.userData.spin;
    car.add(pivot);
    wheels.push(pivot);
  }
  if (st.bus) {
    // twin rear tyres look
    for (const s of [-1, 1]) {
      const inner = wheel(st, false, s);
      inner.position.set(s * (st.track / 2 - 0.3), st.wheelR, -st.axleR);
      car.add(inner);
    }
  }

  // contact shadow
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(st.W * 1.2, st.L * 1.08),
    mat('blob', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16, map: blobTexture() })),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.11;
  blob.userData.isBlob = true;
  car.add(blob);

  car.userData = { wheels, brakeMat, headMat, drlMat, style: st, paint, indicators: indMat };
  car.traverse((o) => {
    if (o.isMesh && !o.userData.isBlob && o.material !== M.glass()) o.castShadow = detail;
  });
  return car;
}

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export function styleDims(style) {
  const st = STYLES[style] || STYLES.sedan;
  const roof = Math.max(...st.cabin.map((p) => p[1]));
  const screenBase = st.cabin[st.cabin.length - 1];
  return { L: st.L, W: st.W, wheelbase: st.axleF - st.axleR, belt: st.cabin[0][1], roof, screenZ: -screenBase[0], screenY: screenBase[1] };
}

// ---- cheap traffic cars: every part merged into one mesh per material ----
const bakedCache = new Map();

function bake(style, taxi, taxiRoof) {
  const key = `${style}-${taxi}-${taxiRoof}`;
  if (bakedCache.has(key)) return bakedCache.get(key);
  const src = buildCar({ style, color: 0xffffff, detail: false, taxi, taxiRoof, quality: 'low' });
  src.updateMatrixWorld(true);
  const groups = new Map();
  src.traverse((o) => {
    if (!o.isMesh) return;
    let matKey = o.material === src.userData.paint ? 'paint' : o.material;
    if (o.material === src.userData.indicators.left || o.material === src.userData.indicators.right) matKey = M.indicatorLens();
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

export function buildTrafficCar(style, color, taxi = false, taxiRoof = 0xc8102e) {
  const { parts } = bake(style, taxi, taxiRoof);
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material === 'paint' ? paintMaterial(color, 'low') : p.material);
    m.matrixAutoUpdate = false;
    m.castShadow = false;
    g.add(m);
  }
  return g;
}
