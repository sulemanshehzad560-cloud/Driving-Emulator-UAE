// Live reflection probe around the player's car: a low-resolution cube
// capture of the nearby city (buildings, road, sky) refreshed every few
// frames and fed to the car paint, glass and chrome so they reflect the
// actual surroundings instead of only the sky.
import * as THREE from 'three';

export class ReflectionProbe {
  constructor(renderer, scene, size = 128, every = 6) {
    this.renderer = renderer;
    this.scene = scene;
    this.every = every;
    this.frame = 0;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.camera = new THREE.CubeCamera(0.5, 900, this.rt);
    this.materials = new Set();
  }

  get texture() {
    return this.rt.texture;
  }

  /** Use the probe as the environment map of these materials. */
  apply(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
        if (m.metalness < 0.3 && !m.clearcoat && !m.transparent) continue;
        m.envMap = this.rt.texture;
        m.needsUpdate = true;
        this.materials.add(m);
      }
    });
  }

  update(position, hide = []) {
    if (this.frame++ % this.every !== 0) return;
    for (const o of hide) o.visible = false;
    this.camera.position.set(position.x, 1.6, position.z);
    this.camera.update(this.renderer, this.scene);
    this.rt.texture.needsPMREMUpdate = true;
    for (const o of hide) o.visible = true;
  }

  dispose() {
    for (const m of this.materials) {
      m.envMap = null;
      m.needsUpdate = true;
    }
    this.rt.dispose();
  }
}
