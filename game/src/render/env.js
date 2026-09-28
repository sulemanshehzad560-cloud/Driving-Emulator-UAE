// Sky, sun, time of day, UAE seasons / weather and graphics quality presets.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { physicsCore } from '../sim/physicsCore.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { glowTexture } from './textures.js';

export const QUALITY = {
  low: { name: 'Low', post: false, msaa: 0, ao: false, flare: false, shadows: false, shadowMap: 0, maxBuildings: 2500, maxPalms: 600, maxLamps: 300, traffic: 8, far: 650, bloom: false, mirrorEvery: 3, mirrorScale: 0.5 },
  medium: { name: 'Medium', post: true, msaa: 2, ao: false, flare: false, shadows: true, shadowMap: 1024, maxBuildings: 5000, maxPalms: 1800, maxLamps: 800, traffic: 14, far: 1000, bloom: false, mirrorEvery: 2, mirrorScale: 0.75 },
  high: { name: 'High', post: true, msaa: 4, ao: false, flare: true, shadows: true, shadowMap: 2048, maxBuildings: 7000, maxPalms: 3500, maxLamps: 1500, traffic: 22, far: 1500, bloom: true, mirrorEvery: 1, mirrorScale: 1 },
  ultra: { name: 'Ultra', post: true, msaa: 4, ao: true, flare: true, shadows: true, shadowMap: 4096, maxBuildings: 9000, maxPalms: 5000, maxLamps: 2500, traffic: 30, far: 2200, bloom: true, mirrorEvery: 1, mirrorScale: 1.25 },
};

export const RESOLUTIONS = {
  auto: { name: 'Auto', height: 0 },
  '540p': { name: '540p', height: 540 },
  '720p': { name: '720p HD', height: 720 },
  '1080p': { name: '1080p Full HD', height: 1080 },
  '1440p': { name: '1440p QHD', height: 1440 },
};

export const SEASONS = {
  summer: { name: 'Summer (hazy)', fog: 0xcdbb9a, fogDensity: 1.0, sunBoost: 1.1, turbidity: 6, clouds: 0, particles: null, wet: false },
  winter: { name: 'Winter (clear)', fog: 0xbfd3e6, fogDensity: 0.55, sunBoost: 1.0, turbidity: 3, clouds: 0, particles: null, wet: false },
  rain: { name: 'Winter rain', fog: 0x8b929a, fogDensity: 2.2, sunBoost: 0.45, turbidity: 12, clouds: 1, particles: 'rain', wet: true },
  sandstorm: { name: 'Sandstorm (shamal)', fog: 0xc79a5e, fogDensity: 4.5, sunBoost: 0.6, turbidity: 20, clouds: 0, particles: 'dust', wet: false },
  fog: { name: 'Morning fog', fog: 0xd7dadd, fogDensity: 5, sunBoost: 0.7, turbidity: 10, clouds: 0, particles: null, wet: false },
};

export const TIMES = {
  dawn: { name: 'Dawn', hour: 6.4 },
  morning: { name: 'Morning', hour: 9 },
  noon: { name: 'Noon', hour: 12.5 },
  sunset: { name: 'Sunset', hour: 17.5 },
  night: { name: 'Night', hour: 22 },
};

export function autoQuality(renderer) {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch (e) { /* ignore */ }
  const weakGpu = /mali-4|mali-t|adreno \(tm\) [34]\d\d|powervr|sgx|swiftshader|llvmpipe/.test(gpu);
  if (weakGpu || mem <= 2 || cores <= 4) return 'low';
  if (mem <= 4 || /adreno \(tm\) 5|mali-g5|mali-g7[12]/.test(gpu)) return 'medium';
  return 'high';
}

export function pixelRatioFor(resolution, quality) {
  const dpr = window.devicePixelRatio || 1;
  const res = RESOLUTIONS[resolution] || RESOLUTIONS.auto;
  const h = Math.min(window.innerHeight, window.innerWidth) || 720;
  if (res.height) return Math.min(res.height / h, 3);
  const caps = { low: 0.75, medium: 1.25, high: 1.75, ultra: 2.5 };
  return Math.min(dpr, caps[quality] || 1.25);
}

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    this.sunDir = new THREE.Vector3();
    this.hemi = new THREE.HemisphereLight(0xdbe8ff, 0xc9a877, 0.6);
    scene.add(this.hemi);
    // sodium-orange glow of a lit city at night (street lamps, billboards)
    this.cityGlow = new THREE.AmbientLight(0xffb070, 0);
    scene.add(this.cityGlow);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    if (quality.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
      const d = 90;
      Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 600 });
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.FogExp2(0xd9c7a6, 0.0012);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.stars = this.makeStars();
    scene.add(this.stars);
    this.particles = null;
    this.night = 0;
    if (quality.flare) {
      // cinematic sun flare with ghosts along the lens axis
      const glow = glowTexture();
      this.flare = new Lensflare();
      this.flare.addElement(new LensflareElement(glow, 220, 0, new THREE.Color(1, 0.95, 0.8)));
      this.flare.addElement(new LensflareElement(glow, 60, 0.4, new THREE.Color(1, 0.7, 0.4)));
      this.flare.addElement(new LensflareElement(glow, 90, 0.65, new THREE.Color(0.6, 0.8, 1)));
      this.flare.addElement(new LensflareElement(glow, 140, 0.9, new THREE.Color(1, 0.85, 0.6)));
      this.flare.addElement(new LensflareElement(glow, 50, 1.1, new THREE.Color(0.7, 1, 0.8)));
      scene.add(this.flare);
    }
  }

  makeStars() {
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 0.45 + 0.05;
      const r = 9000;
      pos.set([Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 18, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    pts.frustumCulled = false;
    return pts;
  }

  /** hour: 0..24, season key */
  set(hour, seasonKey) {
    const season = SEASONS[seasonKey] || SEASONS.summer;
    this.season = season;
    this.hour = hour;
    // sun path for ~25° N latitude
    const dayT = (hour - 6) / 12; // 0 at sunrise, 1 at sunset
    const elevation = Math.sin(Math.PI * dayT) * (seasonKey === 'winter' || seasonKey === 'rain' ? 48 : 82);
    const azimuth = 90 + dayT * 180; // east -> west through the south
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(180 - azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const night = THREE.MathUtils.clamp((-elevation + 4) / 10, 0, 1);
    this.night = night;
    const low = THREE.MathUtils.clamp(1 - elevation / 25, 0, 1) * (1 - night);

    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = season.turbidity;
      u.rayleigh.value = 1.2 + low * 1.5 + season.clouds * 2;
      u.mieCoefficient.value = 0.005 + season.clouds * 0.02;
      u.mieDirectionalG.value = 0.85;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.sky.visible = night < 0.98;
    const dayI = (1 - night) * season.sunBoost;
    this.sun.intensity = Math.max(0.05, dayI * (2.8 - low * 1.4));
    this.sun.color.setHSL(0.09 + (1 - low) * 0.04, 0.6 * low + 0.1, 0.55 + (1 - low) * 0.4);
    this.hemi.intensity = 0.3 + dayI * 0.45;
    this.hemi.color.set(night > 0.5 ? 0x4a5f8c : 0xdbe8ff);
    this.stars.material.opacity = night;
    this.cityGlow.intensity = night * 0.55;

    const fogCol = new THREE.Color(season.fog);
    if (low > 0) fogCol.lerp(new THREE.Color(0xf0a060), low * 0.45);
    fogCol.lerp(new THREE.Color(0x0a0f1c), night * 0.92);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.0009 * season.fogDensity * (700 / this.quality.far + 0.5);
    this.scene.background = night > 0.98 ? new THREE.Color(0x05070d) : null;
    this.renderer.toneMappingExposure = 0.42 + dayI * 0.12 + night * 0.35;

    // reflections for car paint & glass
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.12 + dayI * 0.28;

    this.setParticles(season.particles);
    if (this.flare) this.flare.visible = night < 0.3 && elevation > 2 && !season.particles && season.fogDensity < 2;
    return { night, wet: season.wet, sunset: low };
  }

  setParticles(kind) {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      this.particles = null;
    }
    this.particleKind = kind;
    if (!kind) return;
    const n = kind === 'rain' ? 5000 : 3000;
    const stride = kind === 'rain' ? 6 : 3;
    const core = physicsCore();
    this.particleCore = core && core.particles.max >= n ? core : null;
    // with the Rust core the vertex buffer lives in WebAssembly memory
    const pos = this.particleCore ? this.particleCore.particles.out.view.subarray(0, n * stride) : new Float32Array(n * stride);
    this.particleData = this.particleCore ? this.particleCore.particles.local.view.subarray(0, n * 3) : new Float32Array(n * 3);
    this.particleCount = n;
    for (let i = 0; i < n; i++) {
      this.particleData.set([(Math.random() - 0.5) * 120, Math.random() * 40, (Math.random() - 0.5) * 120], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (kind === 'rain') {
      this.particles = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.45 }));
    } else {
      this.particles = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd1a56a, size: 0.35, transparent: true, opacity: 0.6, depthWrite: false }));
    }
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  update(dt, focus, wind = 0) {
    // keep the sun shadow camera centred on the player
    this.sun.position.set(focus.x + this.sunDir.x * 300, Math.max(20, this.sunDir.y * 300), focus.z + this.sunDir.z * 300);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.stars.position.set(focus.x, 0, focus.z);
    if (this.flare) this.flare.position.set(focus.x + this.sunDir.x * 8000, this.sunDir.y * 8000, focus.z + this.sunDir.z * 8000);
    if (!this.particles) return;
    if (this.particleCore) {
      const p = this.particleCore.particles;
      this.particleCore.ex.particles_step(p.local.ptr, p.out.ptr, this.particleCount, dt, this.particleKind === 'rain' ? 0 : 1, focus.x, focus.z, wind);
      this.particles.geometry.attributes.position.needsUpdate = true;
      return;
    }
    const d = this.particleData;
    const pos = this.particles.geometry.attributes.position.array;
    const n = d.length / 3;
    const rain = this.particleKind === 'rain';
    for (let i = 0; i < n; i++) {
      let x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      if (rain) y -= dt * 28;
      else { y -= dt * 0.8; x += dt * (8 + wind); z += dt * 3 * Math.sin(i); }
      if (y < 0) y += 40;
      if (x > 60) x -= 120;
      d[i * 3] = x; d[i * 3 + 1] = y; d[i * 3 + 2] = z;
      const wx = focus.x + x, wz = focus.z + z;
      if (rain) {
        pos[i * 6] = wx; pos[i * 6 + 1] = y; pos[i * 6 + 2] = wz;
        pos[i * 6 + 3] = wx + 0.1; pos[i * 6 + 4] = y + 0.9; pos[i * 6 + 5] = wz;
      } else {
        pos[i * 3] = wx; pos[i * 3 + 1] = y * 0.3; pos[i * 3 + 2] = wz;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}
