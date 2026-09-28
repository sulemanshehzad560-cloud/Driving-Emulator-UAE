// 3D showroom behind the menus: the selected car on a turntable under
// studio lights with a glossy floor and the Dubai skyline silhouette.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar } from '../cars/carFactory.js';

export class Garage {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.Fog(0x07090d, 18, 60);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
    this.angle = 0.6;

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.3, roughness: 0.32 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.75, 96), new THREE.MeshBasicMaterial({ color: 0xd4af37 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    this.scene.add(ring);
    this.turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.6, 0.1, 96), new THREE.MeshStandardMaterial({ color: 0x15181e, metalness: 0.8, roughness: 0.25 }));
    this.turntable.position.y = 0.05;
    this.turntable.receiveShadow = true;
    this.scene.add(this.turntable);

    // skyline silhouette
    const sky = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x131a26 });
    const winMat = new THREE.MeshBasicMaterial({ color: 0x3a3020 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const h = 4 + Math.random() * 14 + (i === 7 ? 22 : 0);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2 + Math.random() * 2, h, 2), i % 5 === 0 ? winMat : mat);
      b.position.set(Math.cos(a) * 45, h / 2, Math.sin(a) * 45);
      b.lookAt(0, h / 2, 0);
      sky.add(b);
    }
    this.scene.add(sky);

    const key = new THREE.SpotLight(0xffffff, 400, 30, 0.6, 0.5, 1.5);
    key.position.set(4, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.SpotLight(0xd4af37, 250, 30, 0.7, 0.6, 1.5);
    rim.position.set(-6, 5, -6);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x111111, 0.4));
    this.car = null;
  }

  show(style, color) {
    if (this.car) {
      this.turntable.remove(this.car);
      this.car.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.car = buildCar({ style, color, detail: true, quality: 'high' });
    this.car.position.y = 0.05;
    this.car.userData.headMat.emissiveIntensity = 2.5;
    this.car.userData.brakeMat.emissiveIntensity = 1.2;
    this.turntable.add(this.car);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.turntable.rotation.y += dt * 0.25;
    this.angle += dt * 0.02;
    const r = innerWidth < innerHeight ? 13 : 11;
    const cx = Math.cos(this.angle) * r, cz = Math.sin(this.angle) * r;
    this.camera.position.set(cx, 3, cz);
    // keep the car in the right-hand part of the screen, clear of the menu
    const shift = innerWidth > innerHeight * 1.3 ? 3.2 : 0;
    // camera right vector is (sin a, 0, -cos a); look left of the car so it sits right of centre
    this.camera.lookAt(-Math.sin(this.angle) * shift, 0.7, Math.cos(this.angle) * shift);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
