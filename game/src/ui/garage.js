// 3D showroom behind the menus: the car on a gold-lit turntable in a dark
// motorsport studio. The car's reflections come from a studio environment of
// softbox panels (long white highlights along the paint, gold and red rims).
import * as THREE from 'three';
import { buildCar } from '../cars/carFactory.js';
import { loadBestCarModel, instantiateModelCar } from '../cars/modelCars.js';

/** Studio lighting environment: black room with softboxes and coloured rim strips. */
function studioEnvironment(renderer) {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x020203);
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    sc.add(m);
  };
  for (const z of [-3, 0, 3]) panel(16, 1.1, [0, 9, z], 7); // overhead softbox strips
  panel(1.2, 7, [-10, 3.5, 0], 3.2); // side strip boxes
  panel(1.2, 7, [10, 3.5, 0], 3.2);
  panel(12, 0.7, [0, 1.6, -11], 4.5, 0xffb000); // gold rim behind
  panel(12, 0.7, [0, 1.6, 11], 3.2, 0xff2d46); // red rim in front
  panel(30, 30, [0, -6, 0], 0.08); // faint floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(sc, 0.02).texture;
  pmrem.dispose();
  return tex;
}

function backdropTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#0b0d12');
  g.addColorStop(0.55, '#07080b');
  g.addColorStop(0.8, '#120d08');
  g.addColorStop(1, '#050608');
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
    this.scene.environment = studioEnvironment(renderer);
    this.scene.environmentIntensity = 1;
    this.scene.fog = new THREE.Fog(0x06070a, 16, 42);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 300);
    this.angle = 0.7;
    this.mode = 'home';
    this.previewId = null;

    // glossy black studio floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), new THREE.MeshStandardMaterial({ color: 0x0b0c10, metalness: 0.35, roughness: 0.32 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // turntable with a gold LED ring and a thin white outer ring
    this.turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.65, 3.72, 0.1, 96), new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.85, roughness: 0.26 }));
    this.turntable.position.y = 0.05;
    this.turntable.receiveShadow = true;
    this.scene.add(this.turntable);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.74, 3.86, 128), new THREE.MeshBasicMaterial({ color: 0xffb000, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    this.scene.add(ring);
    this.ring = ring;
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.5, 4.53, 128), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.35 }));
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.012;
    this.scene.add(ring2);
    // floor guide lines radiating from the turntable
    const lines = new THREE.Group();
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
    for (let i = 0; i < 24; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 14), lineMat);
      const a = (i / 24) * Math.PI * 2;
      l.rotation.x = -Math.PI / 2;
      l.rotation.z = a;
      l.position.set(Math.sin(a) * 11.5, 0.008, Math.cos(a) * 11.5);
      lines.add(l);
    }
    this.scene.add(lines);

    // curved back wall with vertical LED strips
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 14, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x0d0f13, roughness: 0.92, side: THREE.BackSide }));
    wall.position.y = 7;
    this.scene.add(wall);
    const ledGold = new THREE.MeshBasicMaterial({ color: 0xffb000, toneMapped: false, fog: false });
    const ledWhite = new THREE.MeshBasicMaterial({ color: 0xdfe6f0, toneMapped: false, fog: false });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, i % 3 === 0 ? 7 : 4.5, 0.12), i % 3 === 0 ? ledGold : ledWhite);
      strip.position.set(Math.cos(a) * 23.6, i % 3 === 0 ? 4.2 : 3.4, Math.sin(a) * 23.6);
      this.scene.add(strip);
    }
    // overhead light bars (seen in the floor and the paint)
    for (const z of [-3, 0, 3]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      bar.position.set(0, 9, z);
      this.scene.add(bar);
    }

    const key = new THREE.SpotLight(0xffffff, 520, 40, 0.62, 0.55, 1.5);
    key.position.set(4, 11, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const gold = new THREE.SpotLight(0xffb000, 300, 40, 0.8, 0.6, 1.5);
    gold.position.set(-8, 4, -6);
    this.scene.add(gold);
    const red = new THREE.SpotLight(0xff2d46, 110, 40, 0.8, 0.6, 1.5);
    red.position.set(8, 3.5, -7);
    this.scene.add(red);
    this.scene.add(new THREE.HemisphereLight(0xc8d2e0, 0x0a0a0c, 0.35));
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
    const procedural = () => put(buildCar({ style: spec.style, color, detail: true, quality: 'high' }));
    if (!spec.model) return procedural();
    // model cars: keep the turntable empty for the moment it takes to load (no crude stand-in)
    if (this.car) { this.turntable.remove(this.car); this.car = null; }
    loadBestCarModel(spec.model, this.hd).then((tpl) => {
      if (this.carKey !== key) return;
      if (!tpl) return procedural();
      try { put(instantiateModelCar(spec, tpl, color)); } catch (e) { console.warn('[garage]', e.message); procedural(); }
    });
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.turntable.rotation.y += dt * (this.mode === 'showroom' ? 0.18 : 0.25);
    this.angle += dt * 0.02;
    this.ring.material.color.setHSL(0.11, 1, 0.45 + Math.sin(performance.now() / 700) * 0.06); // breathing gold LED
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
      this.renderer.setClearColor(0x06070a);
      this.renderer.clear();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
