// Live reflection probe around the player's car: a low-resolution cube
// capture of the nearby city (buildings, road, sky) refreshed every few
// frames (one cube face at a time, so there is no frame-time spike) and fed to the car paint, glass and chrome so they reflect the
// actual surroundings instead of only the sky.
import * as THREE from 'three';

export class ReflectionProbe {
  /** every: frames between two face captures (a full cube takes 6 × every frames) */
  constructor(renderer, scene, size = 128, every = 2) {
    this.renderer = renderer;
    this.scene = scene;
    this.every = every;
    this.frame = 0;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.camera = new THREE.CubeCamera(0.5, 450, this.rt);
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
    const face = (this.face = ((this.face ?? -1) + 1) % 6);
    const r = this.renderer;
    const cube = this.camera;
    if (face === 0) {
      cube.position.set(position.x, 1.6, position.z);
      cube.updateMatrixWorld();
    }
    if (cube.coordinateSystem !== r.coordinateSystem) {
      cube.coordinateSystem = r.coordinateSystem;
      cube.updateCoordinateSystem();
    }
    for (const o of hide) o.visible = false;
    const prev = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel();
    const shadows = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false; // reuse this frame's sun shadows instead of re-rendering them per face
    const tex = this.rt.texture;
    const mips = tex.generateMipmaps;
    tex.generateMipmaps = mips && face === 5;
    r.setRenderTarget(this.rt, face);
    r.render(this.scene, cube.children[face]);
    tex.generateMipmaps = mips;
    r.setRenderTarget(prev, prevFace, prevMip);
    r.shadowMap.autoUpdate = shadows;
    for (const o of hide) o.visible = true;
    if (face === 5) tex.needsPMREMUpdate = true;
  }

  dispose() {
    for (const m of this.materials) {
      m.envMap = null;
      m.needsUpdate = true;
    }
    this.rt.dispose();
  }
}
