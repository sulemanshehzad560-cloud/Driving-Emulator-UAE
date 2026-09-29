// Real 3D car models (glTF/GLB) for the player's car and the showroom.
// A catalog entry with `model` points at a GLB plus a small map of node and
// material names; this module scales and orients the model onto the game's
// car frame (faces -Z, ground at y = 0, origin between the axles) and exposes
// the same userData as the procedural cars: spinning/steering wheels, head,
// brake and indicator lamps and a repaintable body.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { styleDims, plateMaterial } from './carFactory.js';

const templates = new Map();
const loader = new GLTFLoader();

/** Load (once) and return the parsed glTF scene for a model spec, or null if unavailable. */
export function loadCarModel(model) {
  if (!templates.has(model.url)) {
    templates.set(model.url, loader.loadAsync(model.url).then((g) => g.scene).catch((e) => {
      console.warn('[cars] model unavailable, using the procedural car:', model.url, e.message);
      return null;
    }));
  }
  return templates.get(model.url);
}

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false });

function worldBox(obj, root) {
  const b = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
  });
  return b;
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
  const scene = template.clone(true);
  holder.add(scene);
  car.add(holder);
  if (cfg.front === '+z') holder.rotation.y = Math.PI;
  car.updateMatrixWorld(true);

  // wheel centres (car space) to scale and place the model
  const names = cfg.wheels; // [FL, FR, RL, RR] node names
  const wheelNodes = names.map((n) => scene.getObjectByName(n));
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
    const parts = [wheelNodes[i], ...(cfg.wheelParts || []).map((suffix) => scene.getObjectByName(n + suffix)).filter(Boolean)];
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
