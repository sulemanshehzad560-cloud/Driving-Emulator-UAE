// 3D showroom behind the menus: the car on a glowing turntable in a warm,
// colourful studio (sunset backdrop, teal and amber accent lights).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar } from '../cars/carFactory.js';
import { loadCarModel, instantiateModelCar } from '../cars/modelCars.js';

function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#1a1340');
  g.addColorStop(0.45, '#4a1f5c');
  g.addColorStop(0.7, '#b8456b');
  g.addColorStop(0.86, '#f08a4b');
  g.addColorStop(1, '#2a1a2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Garage {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = backdropTexture();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 300);
    this.angle = 0.7;
    this.mode = 'home';
    this.previewId = null;

    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), new THREE.MeshStandardMaterial({ color: 0x1a1022, metalness: 0.4, roughness: 0.28 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 3.9, 128), new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    this.scene.add(ring);
    this.ring = ring;
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.3, 4.36, 128), new THREE.MeshBasicMaterial({ color: 0x40e0d0, toneMapped: false, transparent: true, opacity: 0.7 }));
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.012;
    this.scene.add(ring2);
    this.turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.65, 3.7, 0.1, 96), new THREE.MeshStandardMaterial({ color: 0x241a2e, metalness: 0.8, roughness: 0.22 }));
    this.turntable.position.y = 0.05;
    this.turntable.receiveShadow = true;
    this.scene.add(this.turntable);

    // city skyline silhouette around the studio
    const sky = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x241634, fog: false });
    const lit = new THREE.MeshBasicMaterial({ color: 0xffb870, fog: false });
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const h = 6 + ((i * 37) % 17) + (i % 9 === 0 ? 24 : 0);
      const b = new THREE.Mesh(new THREE.BoxGeometry(3 + (i % 3), h, 3), mat);
      b.position.set(Math.cos(a) * 70, h / 2, Math.sin(a) * 70);
      b.lookAt(0, h / 2, 0);
      sky.add(b);
      if (i % 4 === 0) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.1), lit);
        w.position.set(b.position.x * 0.98, h * 0.6, b.position.z * 0.98);
        sky.add(w);
      }
    }
    this.scene.add(sky);

    const key = new THREE.SpotLight(0xfff1e0, 500, 40, 0.6, 0.5, 1.5);
    key.position.set(5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const teal = new THREE.SpotLight(0x40e0d0, 300, 40, 0.8, 0.6, 1.5);
    teal.position.set(-8, 5, -4);
    this.scene.add(teal);
    const amber = new THREE.SpotLight(0xff8c42, 260, 40, 0.8, 0.6, 1.5);
    amber.position.set(7, 4, -7);
    this.scene.add(amber);
    this.scene.add(new THREE.HemisphereLight(0xb9a0ff, 0x221133, 0.5));
    this.car = null;
  }

  setMode(m) {
    this.mode = m;
  }

  /** Show a car on the turntable: the real 3D model when the catalog has one, else the procedural car. */
  show(spec, color) {
    const key = `${spec.id}-${color}`;
    if (this.car && this.carKey === key) return;
    this.carKey = key;
    const put = (car) => {
      if (this.carKey !== key) return; // the player already moved on to another car
      if (this.car) this.turntable.remove(this.car);
      this.car = car;
      car.position.y = 0.05;
      car.userData.headMat.emissiveIntensity = 2.5;
      car.userData.brakeMat.emissiveIntensity = 1.2;
      this.turntable.add(car);
    };
    put(buildCar({ style: spec.style, color, detail: true, quality: 'high' }));
    if (spec.model) {
      loadCarModel(spec.model).then((tpl) => {
        if (!tpl) return;
        try { put(instantiateModelCar(spec, tpl, color)); } catch (e) { console.warn('[garage]', e.message); }
      });
    }
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.turntable.rotation.y += dt * (this.mode === 'showroom' ? 0.18 : 0.25);
    this.angle += dt * 0.02;
    this.ring.material.color.setHSL(0.08 + Math.sin(performance.now() / 2000) * 0.02, 1, 0.6);
    const portrait = innerWidth < innerHeight;
    const showroom = this.mode === 'showroom';
    const r = portrait ? 14 : showroom ? 10 : 11.5;
    this.camera.position.set(Math.cos(this.angle) * r, showroom ? 2.4 : 3, Math.sin(this.angle) * r);
    // home: car sits right of centre (menu on the left); showroom: slightly left (info on the right)
    const shift = portrait ? 0 : showroom ? -1.8 : 3.0;
    this.camera.lookAt(-Math.sin(this.angle) * shift, 0.8, Math.cos(this.angle) * shift);
  }

  render() {
    if (this.mode === 'hidden') {
      this.renderer.setClearColor(0x0b1020);
      this.renderer.clear();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
