// Lighting & atmosphere: HDR sky photos (Poly Haven, CC0) or a physical sky,
// sun aligned with the sky photo, image-based lighting, auto exposure from
// sky luminance, height-attenuated haze (tall towers rise above it), UAE
// seasons / weather and graphics quality presets.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { glowTexture } from './textures.js';
import { physicsCore } from '../sim/physicsCore.js';

export const QUALITY = {
  low: { name: 'Low', tex: '1k', hdri: '1k', hdCars: false, post: false, msaa: 0, ao: false, flare: false, probe: false, shadows: false, propShadows: false, shadowMap: 0, tileRadius: 1100, nearRadius: 160, propRadius: 380, maxBuildingsPerTile: 1200, traffic: 10, far: 1400, bloom: false, mirrorEvery: 3, mirrorScale: 0.5, parkedCars: false },
  medium: { name: 'Medium', tex: '1k', hdri: '1k', hdCars: false, post: false, msaa: 2, ao: false, flare: false, probe: false, shadows: true, propShadows: false, shadowMap: 1024, tileRadius: 1400, nearRadius: 220, propRadius: 550, maxBuildingsPerTile: 2500, traffic: 18, far: 1900, bloom: false, mirrorEvery: 2, mirrorScale: 0.75, parkedCars: true },
  high: { name: 'High', tex: '2k', hdri: '2k', hdCars: true, post: false, msaa: 2, ao: false, flare: true, probe: true, shadows: true, propShadows: true, shadowMap: 2048, tileRadius: 1700, nearRadius: 280, propRadius: 700, maxBuildingsPerTile: 4000, traffic: 26, far: 2400, bloom: true, mirrorEvery: 1, mirrorScale: 1, parkedCars: true },
  ultra: { name: 'Ultra', shadowCache: false, tex: '4k', hdri: '4k', hdCars: true, post: true, msaa: 4, ao: true, flare: true, probe: true, shadows: true, propShadows: true, shadowMap: 4096, tileRadius: 2100, nearRadius: 360, propRadius: 900, maxBuildingsPerTile: 6000, traffic: 34, far: 3000, bloom: true, mirrorEvery: 1, mirrorScale: 1.25, parkedCars: true },
};

export const RESOLUTIONS = {
  auto: { name: 'Auto', height: 0 },
  '540p': { name: '540p', height: 540 },
  '720p': { name: '720p HD', height: 720 },
  '1080p': { name: '1080p Full HD', height: 1080 },
  '1440p': { name: '1440p QHD', height: 1440 },
};

export const SEASONS = {
  summer: { name: 'Summer (hazy)', hdri: 'clear', haze: [0.9, 0.86, 0.78], fogDensity: 1.45, sunBoost: 1.1, particles: null, wet: false },
  winter: { name: 'Winter (clear)', hdri: 'day', haze: [0.78, 0.86, 0.95], fogDensity: 0.55, sunBoost: 1.0, particles: null, wet: false },
  rain: { name: 'Winter rain', hdri: 'overcast', haze: [0.62, 0.65, 0.7], fogDensity: 2.2, sunBoost: 0.4, particles: 'rain', wet: true },
  sandstorm: { name: 'Sandstorm (shamal)', hdri: 'overcast', haze: [0.8, 0.62, 0.4], fogDensity: 5, sunBoost: 0.55, particles: 'dust', wet: false },
  fog: { name: 'Morning fog', hdri: 'overcast', haze: [0.85, 0.86, 0.87], fogDensity: 5.5, sunBoost: 0.65, particles: null, wet: false },
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
  // High only on known flagship GPUs; everything else starts on Medium and the
  // in-game frame-rate governor scales further down if a phone still struggles
  const flagship = /adreno \(tm\) (7[3-9]\d|[89]\d\d)|mali-g7[1-9]\d|mali-g[89]\d\d|immortalis|xclipse|apple/.test(gpu);
  if (flagship && mem >= 6) return 'high';
  return 'medium';
}

export function pixelRatioFor(resolution, quality) {
  const dpr = window.devicePixelRatio || 1;
  const res = RESOLUTIONS[resolution] || RESOLUTIONS.auto;
  const h = Math.min(window.innerHeight, window.innerWidth) || 720;
  if (res.height) return Math.min(res.height / h, 3);
  // Auto: a real vertical resolution per preset, never above the screen's own
  // pixels and never below 480p (lower looks broken/blocky on a phone)
  const target = { low: 540, medium: 720, high: 900, ultra: 1080 }[quality] || 720;
  return Math.min(Math.max(dpr, 480 / h), Math.max(target, 480) / h);
}

// ---- height fog: haze thins out with altitude so skylines rise above it ----
let fogPatched = false;
export function patchFog() {
  if (fogPatched) return;
  fogPatched = true;
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogHeight;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world height without a per-vertex matrix inverse (the view matrix is a rigid transform)
  vFogHeight = dot( viewMatrix[1].xyz, mvPosition.xyz - viewMatrix[3].xyz );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogHeight;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    fogFactor *= mix(1.0, exp( - max( vFogHeight, 0.0 ) * 0.0045 ), 0.85);
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Analyse an equirect HDR: sun direction/elevation, average & horizon colour. */
function analyseHdr(tex) {
  const { data: raw, width: w, height: h } = tex.image;
  // half-float skies arrive as Uint16 bit patterns: decode (sampling every 2nd pixel keeps this cheap)
  const half = raw instanceof Uint16Array;
  const data = half ? { length: raw.length } : raw;
  const px = half ? (i) => THREE.DataUtils.fromHalfFloat(raw[i]) : (i) => raw[i];
  const stride = data.length / (w * h);
  let best = -1, bx = 0, by = 0;
  let avg = 0, n = 0;
  const hor = [0, 0, 0];
  let hn = 0;
  const st = Math.max(2, Math.floor(w / 512)); // same work for 1K, 2K and 4K skies
  for (let y = 0; y < h; y += st) {
    for (let x = 0; x < w; x += st) {
      const i = (y * w + x) * stride;
      const L = luminance(px(i), px(i + 1), px(i + 2));
      const v = 1 - (y + 0.5) / h;
      if (v > 0.5) {
        avg += Math.min(L, 50);
        n++;
        if (L > best) { best = L; bx = x; by = y; }
      }
      if (v > 0.5 && v < 0.56) {
        hor[0] += px(i); hor[1] += px(i + 1); hor[2] += px(i + 2);
        hn++;
      }
    }
  }
  const u = (bx + 0.5) / w, v = 1 - (by + 0.5) / h;
  return {
    sunAz: (u - 0.5) * Math.PI * 2,
    sunEl: (v - 0.5) * Math.PI,
    sunPeak: best,
    avgLum: avg / Math.max(1, n),
    horizon: hor.map((c) => c / Math.max(1, hn)),
  };
}

export class Environment {
  constructor(scene, renderer, quality, art) {
    patchFog();
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.art = art;
    this.hdr = new Map();
    this.loading = new Map();
    this.loader = new HDRLoader().setDataType(THREE.HalfFloatType); // half the GPU memory of float, plenty for skies
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.hemi = new THREE.HemisphereLight(0xdbe8ff, 0xc9a877, 0.35);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    if (quality.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
      const d = 120;
      Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 900 });
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 0.05;
      this.sun.shadow.radius = 3;
    }
    scene.add(this.sun, this.sun.target);
    this.cityGlow = new THREE.AmbientLight(0xffb070, 0);
    scene.add(this.cityGlow);
    scene.fog = new THREE.FogExp2(0xd9c7a6, 0.0006);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.particles = null;
    this.night = 0;
    this.exposure = 0.6;
    if (quality.flare) {
      const glow = glowTexture();
      this.flare = new Lensflare();
      this.flare.addElement(new LensflareElement(glow, 200, 0, new THREE.Color(1, 0.95, 0.8)));
      this.flare.addElement(new LensflareElement(glow, 60, 0.4, new THREE.Color(1, 0.7, 0.4)));
      this.flare.addElement(new LensflareElement(glow, 90, 0.65, new THREE.Color(0.6, 0.8, 1)));
      this.flare.addElement(new LensflareElement(glow, 130, 0.9, new THREE.Color(1, 0.85, 0.6)));
      scene.add(this.flare);
    }
  }

  async loadHdr(slot) {
    if (this.hdr.has(slot)) return this.hdr.get(slot);
    if (this.loading.has(slot)) return this.loading.get(slot);
    const entry = this.art?.manifest?.hdri?.[slot];
    if (!entry || this.quality.name === 'Low') return null;
    const job = (async () => {
      try {
        // sky resolution follows the preset: 1K phones, 2K High, 4K Ultra
        const t = entry.tiers || {};
        const file = t[this.quality.hdri] || (this.quality.hdri === '4k' && t['2k']) || entry.file;
        const tex = await this.loader.loadAsync(`${this.art.base}/${file}`);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const info = analyseHdr(tex);
        const env = this.pmrem.fromEquirectangular(tex).texture;
        const rec = { tex, env, info, used: performance.now() };
        this.hdr.set(slot, rec);
        this.evictSkies(slot);
        return rec;
      } catch (e) {
        console.warn('[env] HDR failed', slot, e.message);
        this.hdr.set(slot, null);
        return null;
      } finally {
        this.loading.delete(slot);
      }
    })();
    this.loading.set(slot, job);
    return job;
  }

  /** Keep GPU memory bounded: few skies resident at once (2K/4K skies are large). */
  evictSkies(keep) {
    const max = this.quality.hdri === '1k' ? 6 : 3;
    const pinned = new Set([keep, this.currentSlot]);
    const spare = [...this.hdr.entries()].filter(([k, r]) => r && !pinned.has(k)).sort((a, b) => a[1].used - b[1].used);
    let resident = [...this.hdr.values()].filter(Boolean).length;
    for (const [k, r] of spare) {
      if (resident <= max) break;
      r.tex.dispose();
      r.env.dispose();
      this.hdr.delete(k);
      resident--;
    }
  }

  /** Which sky photo suits this hour and weather. */
  slotFor(hour, seasonKey) {
    const season = SEASONS[seasonKey] || SEASONS.summer;
    if (season.wet || seasonKey === 'sandstorm' || seasonKey === 'fog') return hour >= 19 || hour < 5.6 ? 'night' : 'overcast';
    if (hour >= 19.3 || hour < 5.2) return seasonKey === 'winter' ? 'clearnight' : 'night';
    if (hour < 6.6) return 'dawn';
    if (hour < 8.2) return 'sunset'; // low morning sun
    if (hour >= 18.3) return 'dusk';
    if (hour >= 16.8) return 'sunset';
    if (hour >= 15.2) return 'golden';
    return season.hdri;
  }

  /** Load the sky needed at start so the first frame is right. */
  async preload(hour = 12.5, seasonKey = 'summer') {
    await this.loadHdr(this.slotFor(hour, seasonKey));
    if (!this.hdr.get(this.slotFor(hour, seasonKey))) await this.loadHdr(SEASONS[seasonKey]?.hdri || 'clear');
  }

  /** hour: 0..24, season key */
  set(hour, seasonKey) {
    this.shadowDirty = true;
    this.shadowAge = 1;
    const season = SEASONS[seasonKey] || SEASONS.summer;
    this.season = season;
    this.hour = hour;
    const dayT = (hour - 6) / 12;
    const maxEl = seasonKey === 'winter' || seasonKey === 'rain' ? 48 : 82;
    let elevation = Math.sin(Math.PI * dayT) * maxEl;
    const azimuth = 90 + dayT * 180;
    const night = THREE.MathUtils.clamp((-elevation + 4) / 10, 0, 1);
    const low = THREE.MathUtils.clamp(1 - elevation / 25, 0, 1) * (1 - night);
    this.night = night;

    // wanted sky; while it streams in, use the closest one already loaded
    const want = this.slotFor(hour, seasonKey);
    const fallbacks = { dawn: ['sunset'], golden: ['clear', 'day'], dusk: ['sunset', 'night'], clearnight: ['night'], sunset: ['golden', 'dawn'] }[want] || [];
    let slot = [want, ...fallbacks, season.hdri, night > 0.6 ? 'night' : 'clear', 'day'].find((k) => this.hdr.get(k)) || want;
    if (!this.hdr.has(want) && this.art?.manifest?.hdri?.[want]) {
      this.loadHdr(want).then((rec) => { if (rec && this.onSkyReady) this.onSkyReady(); });
    }
    const hdr = this.hdr.get(slot);
    if (hdr) { hdr.used = performance.now(); this.currentSlot = slot; }

    const theta = THREE.MathUtils.degToRad(180 - azimuth);
    if (hdr && night < 0.6 && slot !== 'overcast') elevation = THREE.MathUtils.radToDeg(hdr.info.sunEl);
    const lightEl = night > 0.6 ? 35 : Math.max(elevation, 3);
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - lightEl), theta);
    const sunWorldAz = Math.atan2(this.sunDir.z, this.sunDir.x);

    const dayI = (1 - night) * season.sunBoost;
    if (hdr) {
      this.sky.visible = false;
      this.scene.background = hdr.tex;
      this.scene.environment = hdr.env;
      const rot = hdr.info.sunAz - sunWorldAz;
      this.scene.backgroundRotation.set(0, rot, 0);
      this.scene.environmentRotation.set(0, rot, 0);
      const key = night > 0.6 ? 0.12 : 0.24;
      // night: never brighten the sky photo past ~1x, or light-polluted night skies wash the city out
      this.exposure = THREE.MathUtils.clamp(key / Math.max(0.02, hdr.info.avgLum), 0.05, night > 0.6 ? 0.9 : 6);
      this.scene.backgroundIntensity = night > 0.6 ? 0.8 : 1;
      this.scene.environmentIntensity = night > 0.6 ? 0.35 : 0.8;
      const hc = hdr.info.horizon;
      const fog = new THREE.Color(hc[0], hc[1], hc[2]).multiplyScalar(0.85);
      const hz = new THREE.Color(...season.haze).multiplyScalar(fog.r * 0.3 + fog.g * 0.5 + fog.b * 0.2);
      fog.lerp(hz, 0.35);
      if (night > 0.6) fog.multiplyScalar(0.3).lerp(new THREE.Color(0x0b1224), 0.5); // dark blue night haze
      this.scene.fog.color.copy(fog);
      this.sun.intensity = night > 0.6 ? 0.25 / this.exposure : Math.max(0.1, (2.2 + 1.2 * (1 - low)) * dayI) / Math.max(0.35, this.exposure * 0.9);
    } else {
      this.sky.visible = night < 0.98;
      for (const s of [this.sky, this.envSky]) {
        const u = s.material.uniforms;
        u.turbidity.value = seasonKey === 'summer' ? 6 : season.wet ? 12 : seasonKey === 'sandstorm' ? 20 : 3;
        u.rayleigh.value = 1.2 + low * 1.5 + (season.wet ? 2 : 0);
        u.mieCoefficient.value = 0.005 + (season.wet ? 0.02 : 0);
        u.mieDirectionalG.value = 0.85;
        u.sunPosition.value.copy(this.sunDir);
      }
      this.scene.background = night > 0.98 ? new THREE.Color(0x05070d) : null;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.12 + dayI * 0.28;
      this.exposure = 0.42 + dayI * 0.12 + night * 0.35;
      const fogCol = new THREE.Color(...season.haze);
      if (low > 0) fogCol.lerp(new THREE.Color(0xf0a060), low * 0.45);
      fogCol.lerp(new THREE.Color(0x0a0f1c), night * 0.92);
      this.scene.fog.color.copy(fogCol);
      this.sun.intensity = Math.max(0.05, dayI * (2.8 - low * 1.4));
    }
    this.renderer.toneMappingExposure = this.exposure;
    this.sun.color.setHSL(0.09 + (1 - low) * 0.04, 0.55 * low + 0.1, 0.55 + (1 - low) * 0.4);
    if (night > 0.6) this.sun.color.set(0x9db4ff);
    this.hemi.intensity = hdr ? (0.08 + dayI * 0.1) / Math.max(0.3, this.exposure) : 0.3 + dayI * 0.45;
    this.hemi.color.set(night > 0.5 ? 0x4a5f8c : 0xdbe8ff);
    this.cityGlow.intensity = night * (hdr ? 0.35 / Math.max(0.3, this.exposure) : 0.55);
    this.scene.fog.density = 0.00055 * season.fogDensity * (2000 / this.quality.far);
    this.setParticles(season.particles);
    if (this.flare) this.flare.visible = night < 0.3 && elevation > 2 && !season.particles && season.fogDensity < 2;
    return { night, wet: season.wet, sunset: low, slot, hdr: !!hdr };
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
    const pos = this.particleCore ? this.particleCore.particles.out.view.subarray(0, n * stride) : new Float32Array(n * stride);
    this.particleData = this.particleCore ? this.particleCore.particles.local.view.subarray(0, n * 3) : new Float32Array(n * 3);
    this.particleCount = n;
    for (let i = 0; i < n; i++) this.particleData.set([(Math.random() - 0.5) * 120, Math.random() * 40, (Math.random() - 0.5) * 120], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = kind === 'rain'
      ? new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.45 }))
      : new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd1a56a, size: 0.35, transparent: true, opacity: 0.6, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  /** Something that casts shadows changed (new buildings / props streamed in). */
  invalidateShadows() {
    this.shadowDirty = true;
  }

  update(dt, focus, wind = 0) {
    const d = 350;
    let tx = focus.x, tz = focus.z;
    if (this.sun.castShadow) {
      const sm = this.renderer.shadowMap;
      if (this.quality.shadowCache !== false) {
        // Cached sun shadows: only the static city casts into the shadow map
        // (cars use contact shadows), so it is re-rendered when the player has
        // moved on ~30 m, the sun has moved, or new geometry streamed in
        // (at most twice a second) – not every frame.
        sm.autoUpdate = false;
        this.shadowAge = (this.shadowAge || 0) + dt;
        const f = focus.forward || [0, 0];
        const lead = Math.min(40, (Math.abs(focus.kmh || 0) / 3.6) * 1.5);
        const wx = focus.x + f[0] * lead, wz = focus.z + f[1] * lead;
        const a = this.shadowAnchor;
        const moved = !a || Math.hypot(wx - a.x, wz - a.z) > 30;
        if (moved || (this.shadowDirty && this.shadowAge > 0.5)) {
          this.shadowAnchor = { x: wx, z: wz };
          this.shadowDirty = false;
          this.shadowAge = 0;
          sm.needsUpdate = true;
        }
        tx = this.shadowAnchor.x;
        tz = this.shadowAnchor.z;
      } else sm.autoUpdate = true;
      // snap the shadow camera to whole texels to stop shadow shimmer while driving
      const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
      tx = Math.round(tx / texel) * texel;
      tz = Math.round(tz / texel) * texel;
    }
    this.sun.position.set(tx + this.sunDir.x * d, Math.max(30, this.sunDir.y * d), tz + this.sunDir.z * d);
    this.sun.target.position.set(tx, 0, tz);
    if (this.flare) this.flare.position.set(focus.x + this.sunDir.x * 8000, this.sunDir.y * 8000, focus.z + this.sunDir.z * 8000);
    if (!this.particles) return;
    if (this.particleCore) {
      const p = this.particleCore.particles;
      this.particleCore.ex.particles_step(p.local.ptr, p.out.ptr, this.particleCount, dt, this.particleKind === 'rain' ? 0 : 1, focus.x, focus.z, wind);
      this.particles.geometry.attributes.position.needsUpdate = true;
      return;
    }
    const data = this.particleData;
    const pos = this.particles.geometry.attributes.position.array;
    const rain = this.particleKind === 'rain';
    for (let i = 0; i < this.particleCount; i++) {
      let x = data[i * 3], y = data[i * 3 + 1];
      const z = data[i * 3 + 2];
      if (rain) y -= dt * 28;
      else { y -= dt * 0.8; x += dt * (8 + wind); }
      if (y < 0) y += 40;
      if (x > 60) x -= 120;
      data[i * 3] = x;
      data[i * 3 + 1] = y;
      const wx = focus.x + x, wz = focus.z + z;
      if (rain) pos.set([wx, y, wz, wx + 0.1, y + 0.9, wz], i * 6);
      else pos.set([wx, y * 0.3, wz], i * 3);
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}
