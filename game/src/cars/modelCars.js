// Real 3D car models (glTF/GLB) for the player's car and the showroom.
// A catalog entry with `model` points at a GLB plus a small map of node and
// material names; this module scales and orients the model onto the game's
// car frame (faces -Z, ground at y = 0, origin between the axles) and exposes
// the same userData as the procedural cars: spinning/steering wheels, head,
// brake and indicator lamps and a repaintable body.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { styleDims, plateMaterial } from './carFactory.js';

const templates = new Map();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // car models are meshopt-compressed

/** Load (once) and return the parsed glTF scene for a model spec, or null if unavailable. */
export function loadCarModel(model) {
  if (!templates.has(model.url)) {
    templates.set(model.url, loader.loadAsync(model.url).then((g) => { g.scene.userData.animations = g.animations; return g.scene; }).catch((e) => {
      console.warn('[cars] model unavailable, using the procedural car:', model.url, e.message);
      return null;
    }));
  }
  return templates.get(model.url);
}

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false });

function worldBox(obj, root) {
  if (obj.userData.box) {
    // proxy wheel: box kept in the model holder's frame, follows its scale/offset
    const h = obj.userData.holder;
    h.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(h.matrixWorld);
    return obj.userData.box.clone().applyMatrix4(m);
  }
  const b = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  obj.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
  });
  return b;
}

/**
 * Find the four wheels of a model without named wheel nodes: tyre meshes (by
 * material) grouped into corners, plus every small part (rim, disc, caliper)
 * sitting inside each tyre. Returns [FL, FR, RL, RR] proxies in car space.
 */
/** Split a mesh that holds parts of several wheels into one mesh per corner (by triangle centroid). */
function splitByCorner(mesh, car, mid) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index ? g.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.count / 3;
  const m = new THREE.Matrix4().copy(car.matrixWorld).invert().multiply(mesh.matrixWorld);
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  const lists = [[], [], [], []];
  for (let t = 0; t < triCount; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx ? idx[t * 3 + k] : t * 3 + k));
    c.multiplyScalar(1 / 3).applyMatrix4(m);
    const q = (c.z < mid.z ? 0 : 2) + (c.x < mid.x ? 0 : 1);
    for (let k = 0; k < 3; k++) lists[q].push(idx ? idx[t * 3 + k] : t * 3 + k);
  }
  const out = [];
  lists.forEach((list) => {
    if (!list.length) return;
    // compact: copy only this corner's vertices so its bounds (and memory) are its own
    const remap = new Map();
    const newIdx = list.map((i) => {
      if (!remap.has(i)) remap.set(i, remap.size);
      return remap.get(i);
    });
    const part = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      // getComponent decodes interleaved / quantised (meshopt) layouts to plain values
      const n = attr.itemSize;
      const arr = new Float32Array(remap.size * n);
      for (const [oldI, newI] of remap) for (let k = 0; k < n; k++) arr[newI * n + k] = attr.getComponent(oldI, k);
      part.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    part.setIndex(newIdx);
    const mm = new THREE.Mesh(part, mesh.material);
    mm.name = mesh.name;
    mm.position.copy(mesh.position);
    mm.quaternion.copy(mesh.quaternion);
    mm.scale.copy(mesh.scale);
    mesh.parent.add(mm);
    out.push(mm);
  });
  mesh.parent.remove(mesh);
  mesh.parent?.updateMatrixWorld(true);
  out.forEach((o) => o.updateMatrixWorld(true));
  return out;
}

function autoWheels(scene, car, holder, tireRe) {
  let tires = [];
  scene.traverse((o) => { if (o.isMesh && o.visible && tireRe.test(o.material?.name || '')) tires.push(o); });
  if (!tires.length) return [null];
  if (tires.length < 4) {
    // tyres merged into one mesh: split every wheel-assembly mesh (tyres, rims, discs, calipers) by corner
    const box = new THREE.Box3();
    for (const t of tires) box.union(worldBox(t, car));
    const mid = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const zone = box.clone().expandByScalar(0.15);
    const assembly = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const b = worldBox(o, car);
      const sz = b.getSize(new THREE.Vector3());
      // spans both axles and both sides but sits inside the tyre envelope -> a merged wheel part
      if (zone.containsBox(b) && sz.x > size.x * 0.6 && sz.z > size.z * 0.6 && sz.y < size.y * 1.2) assembly.push(o);
    });
    for (const o of assembly) splitByCorner(o, car, mid);
    tires = [];
    scene.traverse((o) => { if (o.isMesh && o.visible && tireRe.test(o.material?.name || '')) tires.push(o); });
    if (tires.length < 4) return [null];
  }
  // split the tyres around their own centre (stray helper geometry can skew the scene's box)
  const centres = tires.map((t) => worldBox(t, car).getCenter(new THREE.Vector3()));
  const mid = centres.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / centres.length);
  const corners = [[], [], [], []]; // car space: front = -z, left = -x
  for (const [i, t] of tires.entries()) {
    const c = centres[i]; // classify in car space
    corners[(c.z < mid.z ? 0 : 2) + (c.x < mid.x ? 0 : 1)].push(t);
  }
  if (corners.some((c) => !c.length)) return [null];
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  return corners.map((list) => {
    const box = new THREE.Box3(); // holder frame
    for (const t of list) box.union(worldBox(t, holder));
    const centre = box.getCenter(new THREE.Vector3());
    const size0 = box.getSize(new THREE.Vector3());
    const r = Math.max(size0.y, Math.min(size0.x, size0.z)) / 2;
    const parts = meshes.filter((m) => {
      const b = worldBox(m, holder);
      const size = b.getSize(new THREE.Vector3());
      return b.getCenter(new THREE.Vector3()).distanceTo(centre) < r * 0.9 && Math.max(size.x, size.y, size.z) < r * 2.3;
    });
    const proxy = new THREE.Group(); // stands in for a named wheel node: its box is the tyre box
    proxy.userData.parts = parts;
    proxy.userData.box = box;
    proxy.userData.holder = holder;
    return proxy;
  });
}

/**
 * Build a drivable car from a loaded template.
 * spec: catalog entry (style for physics dimensions, model config); color: body paint.
 */
export function instantiateModelCar(spec, template, color) {
  const cfg = spec.model;
  const st = styleDims(spec.style);
  const car = new THREE.Group();
  const holder = new THREE.Group(); // model space -> car space
  const scene = cloneSkinned(template);
  holder.add(scene);
  // rigged parts (e.g. doors): freeze the clip at a chosen time, e.g. doors shut
  if (cfg.pose) {
    const clip = (template.userData.animations || []).find((c) => c.name === cfg.pose.clip) || template.userData.animations?.[0];
    if (clip) {
      const mixer = new THREE.AnimationMixer(scene);
      mixer.clipAction(clip).play();
      mixer.setTime(cfg.pose.time || 0);
    }
  }
  scene.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  car.add(holder);
  if (cfg.front === '+z') holder.rotation.y = Math.PI;
  car.updateMatrixWorld(true);

  // hide baked ground shadows and helper geometry before measuring anything
  const hideMat = cfg.hideMat ? new RegExp(cfg.hideMat, 'i') : null;
  if (hideMat) scene.traverse((o) => { if (o.isMesh && hideMat.test(o.material?.name || '')) o.visible = false; });
  car.updateMatrixWorld(true);

  // wheel centres (car space) to scale and place the model
  let wheelNodes;
  if (cfg.tireMat) wheelNodes = autoWheels(scene, car, holder, new RegExp(cfg.tireMat, 'i'));
  else wheelNodes = cfg.wheels.map((n) => scene.getObjectByName(n));
  const names = cfg.wheels || ['FL', 'FR', 'RL', 'RR'];
  if (wheelNodes.some((w) => !w)) throw new Error('model wheels not found');
  const centres = wheelNodes.map((w) => worldBox(w, car).getCenter(new THREE.Vector3()));
  const radius = worldBox(wheelNodes[0], car).getSize(new THREE.Vector3()).y / 2;
  const wheelbase = Math.abs(((centres[0].z + centres[1].z) - (centres[2].z + centres[3].z)) / 2);
  const s = (cfg.scale || 1) * (st.wheelbase / wheelbase);
  holder.scale.setScalar(s);
  const frontZ = (centres[0].z + centres[1].z) / 2;
  // front axle on the physics car's front axle, tyres on the ground, centred left/right
  holder.position.set(-((centres[0].x + centres[1].x) / 2) * s, (radius - centres[0].y) * s, -st.axleF - frontZ * s);
  car.updateMatrixWorld(true);

  // materials: paint, glass, lamps, logo clean-up
  const paintKey = new Set(cfg.paint || []);
  const paints = new Map();
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 0.6 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0a0a, emissiveIntensity: 0.4, transparent: true, opacity: 0.95 });
  const indicators = {
    left: new THREE.MeshStandardMaterial({ color: 0x663300, emissive: 0xff8a00, emissiveIntensity: 0 }),
    right: new THREE.MeshStandardMaterial({ color: 0x663300, emissive: 0xff8a00, emissiveIntensity: 0 }),
  };
  let bodyPaint = null;
  const hide = new Set(cfg.hide || []);
  scene.traverse((o) => {
    if (hide.has(o.name)) o.visible = false;
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      const n = m.name || '';
      if (paintKey.has(n)) {
        if (!paints.has(n)) {
          const p = m.clone();
          p.color.set(color);
          if ('iridescence' in p) p.iridescence = 0;
          if ('clearcoat' in p) { p.clearcoat = 1; p.clearcoatRoughness = 0.04; }
          p.userData.isPaint = true;
          paints.set(n, p);
          bodyPaint = bodyPaint || p;
        }
        return paints.get(n);
      }
      if (n === cfg.glass || (m.transmission && m.transmission > 0)) return glassMat; // no transmission pass on phones
      if (n === cfg.head) return headMat;
      if (n === cfg.brake) return brakeMat;
      if (n === cfg.signal) {
        const p = new THREE.Vector3();
        o.getWorldPosition(p);
        car.worldToLocal(p);
        return p.x < 0 ? indicators.left : indicators.right;
      }
      if (n === cfg.plate) return plateMaterial();
      if ((cfg.plain || []).includes(n)) {
        const c = m.clone();
        c.map = null; // artwork with third-party logos
        c.color.set(cfg.plainColor || 0x1a1a1a);
        return c;
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });

  // wheels: steering pivot + spinning group, brake pads stay still
  const wheels = [];
  names.forEach((n, i) => {
    const pivot = new THREE.Group();
    car.add(pivot);
    const c = new THREE.Vector3();
    worldBox(wheelNodes[i], car).getCenter(c);
    pivot.position.copy(c);
    pivot.updateMatrixWorld(true);
    const spin = new THREE.Group();
    pivot.add(spin);
    spin.updateMatrixWorld(true);
    const parts = wheelNodes[i].userData.parts || [wheelNodes[i], ...(cfg.wheelParts || []).map((suffix) => scene.getObjectByName(n + suffix)).filter(Boolean)];
    for (const p of parts) {
      const still = /pad|caliper/i.test(p.name);
      (still ? pivot : spin).attach(p);
    }
    pivot.userData.spin = spin;
    wheels.push(pivot);
  });

  // real interior: driver's eye from the steering wheel, and a turning wheel
  let eye = null, steer = null;
  const steerRe = cfg.steering ? new RegExp(cfg.steering) : null;
  const steerParts = [];
  if (steerRe) scene.traverse((o) => { if (steerRe.test(o.name)) steerParts.push(o); });
  const top = steerParts.filter((o) => !steerParts.includes(o.parent));
  if (top.length) {
    const box = new THREE.Box3();
    for (const o of top) box.union(worldBox(o, car));
    const c = box.getCenter(new THREE.Vector3());
    eye = new THREE.Vector3(c.x, c.y + (cfg.eyeUp ?? 0.28), c.z + (cfg.eyeBack ?? 0.45));
    const axis = eye.clone().sub(c).normalize();
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    car.add(pivot);
    pivot.updateMatrixWorld(true);
    const inner = new THREE.Group();
    pivot.add(inner);
    inner.updateMatrixWorld(true);
    for (const o of top) inner.attach(o);
    const q = new THREE.Quaternion();
    steer = (a) => inner.quaternion.copy(q.setFromAxisAngle(axis, a));
  }

  car.userData = { eye, steer, wheels, brakeMat, headMat, drlMat: headMat, style: st, paint: bodyPaint, indicators, model: true, radius: radius * s };
  return car;
}

const trafficPaint = new Map();
/** Light traffic car from a small model (one draw call per material, no shadows). */
export function modelTrafficCar(template, paintMat, color) {
  const g = new THREE.Group();
  const h = template.clone(true);
  h.rotation.y = Math.PI; // models face +z, cars face -z
  g.add(h);
  h.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const n = o.material?.name || '';
    if (paintMat && n === paintMat) {
      const key = `${template.uuid}-${color}`;
      if (!trafficPaint.has(key)) {
        const m = o.material.clone();
        m.color.set(color);
        m.metalness = 0.45;
        m.roughness = 0.32;
        m.userData.isPaint = true;
        trafficPaint.set(key, m);
      }
      o.material = trafficPaint.get(key);
    } else if (n === 'Windows' && !o.material.userData.tuned) {
      o.material.color.set(0x0c1118);
      o.material.metalness = 0.3;
      o.material.roughness = 0.08;
      o.material.userData.tuned = true;
    }
  });
  return g;
}

/**
 * Best available version of a car model: the full-resolution HD file on
 * High/Ultra (cars/hd/...), else the phone version. Resolves to null if neither loads.
 */
export async function loadBestCarModel(model, hd) {
  if (hd) {
    const tpl = await loadCarModel({ ...model, url: model.url.replace(/^cars\//, 'cars/hd/') });
    if (tpl) return tpl;
  }
  return loadCarModel(model);
}
