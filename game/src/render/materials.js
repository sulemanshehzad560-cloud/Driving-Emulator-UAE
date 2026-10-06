// World materials. Photographic CC0 PBR textures (Poly Haven / ambientCG,
// downloaded by CI into art/) are used when available; everything falls back
// to procedural textures from texgen.js. Custom shader code adds tyre-worn
// lanes, kerb dirt, drifting sand, wet-road puddles, ground-level ambient
// occlusion and lit windows at night.
import * as THREE from 'three';
import * as TG from './texgen.js';

export const shared = {
  uNight: { value: 0 },
  uWet: { value: 0 },
  uTime: { value: 0 },
  uSand: { value: new THREE.Color(0xd8c29a) },
  // world size of one screen pixel per metre of view distance: 2·tan(fov/2) / viewport height
  uPxScale: { value: 0.002 },
};

/**
 * Lane paint that never breaks up: each stripe is widened in the vertex shader
 * to at least ~0.9 px on screen, and the extra width is faded through
 * alpha-to-coverage (with the canvas' MSAA), so distant lines read as thin,
 * continuous, slightly fainter lines instead of crawling dashes of pixels.
 */
function paintShader(mat) {
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPxScale = shared.uPxScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSide;\nuniform float uPxScale;\nvarying float vCover;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float hw = abs(aSide.z);
          vCover = 1.0;
          if (hw > 0.0) {
            float dist = max(0.5, -(modelViewMatrix * vec4(transformed, 1.0)).z);
            float want = max(hw, dist * uPxScale * 0.45);
            transformed.xz += aSide.xy * sign(aSide.z) * (want - hw);
            vCover = hw / want;
          }
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCover;')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= vCover;');
  };
}

const GLSL_NOISE = /* glsl */ `
  float uaeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float uaeNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(uaeHash(i), uaeHash(i + vec2(1, 0)), u.x), mix(uaeHash(i + vec2(0, 1)), uaeHash(i + vec2(1, 1)), u.x), u.y);
  }
  float uaeFbm(vec2 p) { return uaeNoise(p) * 0.5 + uaeNoise(p * 2.03) * 0.3 + uaeNoise(p * 4.1) * 0.2; }
`;

function addWorldPos(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vUaeWorld;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 uaeWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          uaeWp = instanceMatrix * uaeWp;
        #endif
        vUaeWorld = (modelMatrix * uaeWp).xyz;
      }`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vUaeWorld;\n${GLSL_NOISE}`);
}

/** Road surface: tyre tracks per lane, dirty/sandy edges, wet puddles. */
function roadShader(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = shared.uWet;
    shader.uniforms.uSand = shared.uSand;
    addWorldPos(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad;\nvarying vec2 vRoad;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nuniform vec3 uSand;\nvarying vec2 vRoad;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float lane = fract(vRoad.x);
          // polished, darker wheel paths in every lane
          float tyre = smoothstep(0.1, 0.0, abs(lane - 0.26)) + smoothstep(0.1, 0.0, abs(lane - 0.74));
          diffuseColor.rgb *= 1.0 - 0.13 * tyre;
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, tyre);
          // oil drips in the middle of the lane
          float oil = smoothstep(0.12, 0.0, abs(lane - 0.5)) * uaeFbm(vUaeWorld.xz * 0.35);
          diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.55, 0.8, oil);
          // dirt and wind-blown sand against the kerbs
          float edge = 1.0 - smoothstep(0.0, 1.4, vRoad.y);
          float drift = edge * smoothstep(0.35, 0.75, uaeFbm(vUaeWorld.xz * 0.6));
          diffuseColor.rgb = mix(diffuseColor.rgb, uSand * 0.85, drift * 0.75);
          diffuseColor.rgb *= 1.0 - edge * 0.12;
          roughnessFactor = mix(roughnessFactor, 1.0, drift);
          // rain: darker asphalt and mirror-like puddles
          float puddle = smoothstep(0.52, 0.7, uaeFbm(vUaeWorld.xz * 0.08)) * uWet;
          diffuseColor.rgb *= 1.0 - 0.35 * uWet - 0.25 * puddle;
          roughnessFactor = mix(roughnessFactor, 0.35, uWet * 0.6);
          roughnessFactor = mix(roughnessFactor, 0.04, puddle);
        }`);
  };
  mat.customProgramCacheKey = () => 'uae-road';
}

/** Buildings: ground-level occlusion, dust at the base, lit windows at night. */
function facadeShader(mat, { photo = false, key = 'facade' } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    addWorldPos(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLocalH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalH = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLocalH;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          #ifdef USE_MAP
            vec2 cellUv = vMapUv * vec2(${photo ? '6.0, 6.0' : '6.0, 3.0'});
          #else
            vec2 cellUv = vUaeWorld.xz;
          #endif
          vec2 cellId = floor(cellUv) + floor(vUaeWorld.xz / 37.0) * 13.0;
          float lit = step(0.52, uaeHash(cellId));
          float warm = uaeHash(cellId + 7.0);
          vec3 lightCol = mix(vec3(1.0, 0.78, 0.45), vec3(0.75, 0.88, 1.0), step(0.7, warm));
          #ifdef USE_EMISSIVEMAP
            float mask = emissiveColor.r;
          #else
            vec2 f = fract(cellUv);
            float mask = step(0.18, f.x) * step(f.x, 0.82) * step(0.2, f.y) * step(f.y, 0.75);
          #endif
          totalEmissiveRadiance = lightCol * mask * lit * uNight * 1.6;
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float groundAO = mix(0.5, 1.0, smoothstep(0.0, 3.0, vLocalH));
          reflectedLight.indirectDiffuse *= groundAO;
          reflectedLight.directDiffuse *= mix(0.8, 1.0, smoothstep(0.0, 1.5, vLocalH));
        }`);
  };
  mat.customProgramCacheKey = () => `uae-facade-${photo}`; // one program for all facades (only the photo flag changes the code)
}

/** Ground / sand / grass: large-scale colour variation hides tiling. */
function groundShader(mat, key) {
  mat.onBeforeCompile = (shader) => {
    addWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float v = uaeFbm(vUaeWorld.xz * 0.012);
        float v2 = uaeFbm(vUaeWorld.xz * 0.09 + 13.0);
        diffuseColor.rgb *= 0.86 + v * 0.22 + v2 * 0.08;
      }`);
  };
  mat.customProgramCacheKey = () => 'uae-ground';
}

function layered(mat, layer) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -layer;
  mat.polygonOffsetUnits = -layer * 4;
  return mat;
}

/** Analyse a facade photo: floors/bays per texture and whether it is a night shot. */
function analyseFacade(img) {
  const n = 128;
  const c = TG.canvas(n);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  const lum = new Float32Array(n * n);
  let mean = 0;
  for (let i = 0; i < n * n; i++) {
    lum[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    mean += lum[i];
  }
  mean /= n * n;
  const period = (axis) => {
    const prof = new Float32Array(n);
    for (let a = 0; a < n; a++) {
      let s = 0;
      for (let b = 0; b < n; b++) s += axis ? lum[b * n + a] : lum[a * n + b];
      prof[a] = s / n;
    }
    const m = prof.reduce((s, v) => s + v, 0) / n;
    let best = 16, bestScore = -Infinity;
    for (let lag = 5; lag <= 64; lag++) {
      if (n % lag > lag * 0.35 && lag > 10) continue; // prefer lags that tile the texture
      let s = 0;
      for (let a = 0; a < n; a++) s += (prof[a] - m) * (prof[(a + lag) % n] - m);
      if (s > bestScore) { bestScore = s; best = lag; }
    }
    return Math.max(1, Math.round(n / best));
  };
  return { floors: period(false), bays: period(true), dark: mean < 55 };
}

export class WorldMaterials {
  constructor(quality, art) {
    this.q = quality;
    this.art = art; // { manifest, base } or null
    this.loader = new THREE.TextureLoader();
    this.maxAniso = 8;
    this.cache = {};
  }

  tex(canvasOrUrl, { srgb = true, repeat = true } = {}) {
    let t;
    if (typeof canvasOrUrl === 'string') {
      t = this.loader.load(canvasOrUrl);
      t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = this.maxAniso;
    } else {
      t = TG.toTexture(canvasOrUrl, { srgb, repeat, aniso: this.maxAniso });
    }
    return t;
  }

  /** Texture files at the detail tier of the current preset (1K / 2K High / 4K Ultra). */
  tierFiles(entry) {
    const t = this.q.tex || '1k';
    if (t === '4k' && entry.files4k) return entry.files4k;
    if ((t === '2k' || t === '4k') && entry.files2k) return entry.files2k;
    return entry.files;
  }

  /** Photographic material set if the art pack has it, else null. */
  photo(slot) {
    const m = this.art?.manifest?.materials?.[slot];
    if (!m || this.q.name === 'Low') return null;
    const f = this.tierFiles(m);
    const url = (k) => `${this.art.base}/${f[k]}`;
    return {
      map: this.tex(url('color')),
      normalMap: f.normal ? this.tex(url('normal'), { srgb: false }) : null,
      roughnessMap: f.rough ? this.tex(url('rough'), { srgb: false }) : null,
    };
  }

  async init() {
    const q = this.q;
    const hi = q.name === 'High' || q.name === 'Ultra';
    const N = hi ? 1024 : 512;
    const M = {};
    this.shared = shared;

    // ---------------- road surface
    const asp = this.photo('asphalt') || (() => {
      const g = TG.asphalt(N);
      return { map: this.tex(g.color), normalMap: this.tex(g.normal, { srgb: false }), roughnessMap: this.tex(g.rough, { srgb: false }) };
    })();
    M.road = layered(new THREE.MeshStandardMaterial({ ...asp, color: 0x9c9c9c, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9) }), 2);
    roadShader(M.road);
    const worn = this.photo('asphalt_worn') || asp;
    // junction patches use exactly the road surface so they blend in (no visible discs)
    M.junction = layered(new THREE.MeshStandardMaterial({ ...asp, color: 0x9c9c9c, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9) }), 3);
    roadShader(M.junction);
    M.shoulder = layered(new THREE.MeshStandardMaterial({ ...worn, color: 0x8a8580, roughness: 1 }), 1);

    // ---------------- lane paint (worn)
    // solid paint with a soft wear tint (a cut-out alpha mask aliased into ragged, broken lines at a distance)
    const wear = this.tex(TG.paintWear(256));
    M.markW = layered(new THREE.MeshStandardMaterial({ color: 0xf4f4f0, map: wear, roughness: 0.6, emissive: 0x141414 }), 5);
    M.markY = layered(new THREE.MeshStandardMaterial({ color: 0xf2b800, map: wear, roughness: 0.6, emissive: 0x141000 }), 5);
    paintShader(M.markW);
    paintShader(M.markY);

    // ---------------- pavement & kerbs
    const pv = this.photo('pavers') || (() => {
      const g = TG.pavers(N);
      return { map: this.tex(g.color), normalMap: this.tex(g.normal, { srgb: false }), roughnessMap: this.tex(g.rough, { srgb: false }) };
    })();
    M.sidewalk = layered(new THREE.MeshStandardMaterial({ ...pv, color: 0xe8ddd0, roughness: 1 }), 1);
    groundShader(M.sidewalk, 'pave');
    const conc = this.photo('concrete');
    M.kerb = new THREE.MeshStandardMaterial({ ...(conc || {}), color: 0xd6d3cc, roughness: 0.9 });
    M.kerbStriped = new THREE.MeshStandardMaterial({ map: this.tex(TG.kerbStripes()), roughness: 0.7 });
    M.barrier = new THREE.MeshStandardMaterial({ ...(conc || {}), color: 0xe4e1da, roughness: 0.85 });
    M.guardrail = new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.85, roughness: 0.35 });

    // ---------------- ground & land use
    const sandSet = this.photo('sand') || (() => {
      const g = TG.sand(N);
      return { map: this.tex(g.color), normalMap: this.tex(g.normal, { srgb: false }), roughnessMap: this.tex(g.rough, { srgb: false }) };
    })();
    M.ground = new THREE.MeshStandardMaterial({ ...sandSet, color: 0xf2dcb4, roughness: 1 });
    groundShader(M.ground, 'sand');
    M.beach = layered(new THREE.MeshStandardMaterial({ ...sandSet, color: 0xfff0d2, roughness: 1 }), 1);
    groundShader(M.beach, 'beach');
    const grassSet = this.photo('grass') || (() => {
      const g = TG.grass(512);
      return { map: this.tex(g.color), normalMap: this.tex(g.normal, { srgb: false }) };
    })();
    M.park = layered(new THREE.MeshStandardMaterial({ ...grassSet, color: 0xb8d89a, roughness: 1 }), 1);
    groundShader(M.park, 'park');
    M.golf = layered(new THREE.MeshStandardMaterial({ ...grassSet, color: 0xa8e08a, roughness: 0.9 }), 1);
    groundShader(M.golf, 'golf');
    M.pitch = layered(new THREE.MeshStandardMaterial({ ...grassSet, color: 0x8fd07a, roughness: 0.9 }), 1);
    M.farm = layered(new THREE.MeshStandardMaterial({ ...grassSet, color: 0x8a9a5a, roughness: 1 }), 1);
    groundShader(M.farm, 'farm');
    M.mangrove = layered(new THREE.MeshStandardMaterial({ ...grassSet, color: 0x4f6d3c, roughness: 1 }), 1);
    M.parking = layered(new THREE.MeshStandardMaterial({ ...worn, color: 0x8e8e8e, roughness: 1 }), 1);
    M.sandArea = layered(new THREE.MeshStandardMaterial({ ...sandSet, color: 0xe8cfa2, roughness: 1 }), 1);

    // ---------------- water (sea, creek, lakes)
    const wn = this.tex(TG.waterNormal(256), { srgb: false });
    this.waterNormal = wn;
    M.water = layered(new THREE.MeshStandardMaterial({ color: 0x0f5a73, roughness: 0.06, metalness: 0.15, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.4 }), 1);
    M.sea = M.water;

    // ---------------- buildings
    M.roof = new THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.95, vertexColors: true });
    M.rooftop = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.7, metalness: 0.3 });
    const facade = (gen, opts = {}) => {
      const mat = new THREE.MeshStandardMaterial({
        map: this.tex(gen.color),
        normalMap: this.tex(gen.normal, { srgb: false }),
        roughnessMap: this.tex(gen.rough, { srgb: false }),
        emissiveMap: this.tex(gen.emissive, { srgb: false }),
        emissive: 0xffffff,
        vertexColors: true,
        roughness: 1,
        metalness: opts.metalness ?? 0,
        envMapIntensity: opts.env ?? 1,
      });
      facadeShader(mat, { key: opts.key });
      return mat;
    };
    const F = hi ? 512 : 256;
    M.glass = [
      facade(TG.facadeGlass(F, '#3f7392', 1), { metalness: 0.55, env: 1.6, key: 'glass0' }),
      facade(TG.facadeGlass(F, '#5d8a7c', 2), { metalness: 0.55, env: 1.6, key: 'glass1' }),
      facade(TG.facadeGlass(F, '#8a95a0', 3), { metalness: 0.65, env: 1.8, key: 'glass2' }),
      facade(TG.facadeGlass(F, '#a88b58', 4), { metalness: 0.7, env: 1.8, key: 'glass3' }),
    ];
    M.office = facade(TG.facadeOffice(F), { metalness: 0.2, key: 'office' });
    M.apartment = [
      facade(TG.facadeApartment(F, '#ece2cf', 2), { key: 'apt0' }),
      facade(TG.facadeApartment(F, '#e6d3b3', 5), { key: 'apt1' }),
      facade(TG.facadeApartment(F, '#f3f0ea', 7), { key: 'apt2' }),
    ];
    M.villa = facade(TG.facadeVilla(F), { key: 'villa' });
    M.storefront = facade(TG.facadeStorefront(F), { metalness: 0.2, key: 'shop' });
    M.industrial = facade(TG.facadeIndustrial(256), { metalness: 0.6, key: 'ind' });
    M.mosque = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.6 });
    M.dome = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.35, metalness: 0.1 });
    M.domeGold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 1 });

    // photographic facades from the art pack
    M.photoFacades = [];
    const facs = this.art?.manifest?.facades || {};
    if (this.q.name !== 'Low') {
      await Promise.all(Object.values(facs).map(async (f) => {
        try {
          const base = this.art.base;
          const files = this.tierFiles(f);
          const img = await this.loader.loadAsync(`${base}/${files.color}`);
          const info = analyseFacade(img.image);
          if (info.dark) return; // night photos are not usable as daytime albedo
          img.wrapS = img.wrapT = THREE.RepeatWrapping;
          img.colorSpace = THREE.SRGBColorSpace;
          img.anisotropy = this.maxAniso;
          const mat = new THREE.MeshStandardMaterial({
            map: img,
            normalMap: files.normal ? this.tex(`${base}/${files.normal}`, { srgb: false }) : null,
            roughnessMap: files.rough ? this.tex(`${base}/${files.rough}`, { srgb: false }) : null,
            vertexColors: true,
            roughness: 1,
            metalness: 0.15,
            envMapIntensity: 1.3,
          });
          facadeShader(mat, { photo: true, key: f.id });
          mat.userData.facade = { floors: info.floors, bays: info.bays, id: f.id };
          M.photoFacades.push(mat);
        } catch (e) { /* skip broken asset */ }
      }));
    }

    // ---------------- props
    const trunk = TG.palmTrunk(128);
    M.palmTrunk = new THREE.MeshStandardMaterial({ map: this.tex(trunk.color), normalMap: this.tex(trunk.normal, { srgb: false }), roughness: 1 });
    M.palmLeaf = new THREE.MeshStandardMaterial({ map: this.tex(TG.palmLeaf(256), { repeat: false }), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
    M.palmLeaf.alphaToCoverage = true; // soft, stable frond edges with MSAA instead of sparkling cut-outs
    M.pole = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.75, roughness: 0.35 });
    M.darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.6, roughness: 0.45 });
    M.lampHead = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0xffd6a0, emissiveIntensity: 0 });
    M.lightPool = new THREE.MeshBasicMaterial({
      map: this.tex(TG.glow(128, [[0, 'rgba(255,214,150,0.55)'], [0.5, 'rgba(255,190,120,0.2)'], [1, 'rgba(255,180,100,0)']]), { repeat: false }),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16,
    });
    M.bench = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 });
    M.bin = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6 });
    M.utility = new THREE.MeshStandardMaterial({ color: 0xc9c7bd, roughness: 0.6, metalness: 0.2 });
    M.shelterGlass = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.45 });
    M.shelterFrame = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.8, roughness: 0.3 });
    M.signBack = new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.5, roughness: 0.5 });
    M.gantryGreen = new THREE.MeshStandardMaterial({ color: 0x0b6b3a, roughness: 0.5 });

    this.M = M;
    return this;
  }

  update(dt) {
    shared.uTime.value += dt;
    if (this.waterNormal) {
      this.waterNormal.offset.x += dt * 0.004;
      this.waterNormal.offset.y += dt * 0.0027;
    }
  }

  setNight(n) {
    shared.uNight.value = n;
    this.M.lampHead.emissiveIntensity = n * 4;
    this.M.lightPool.opacity = n;
  }

  setWet(w) {
    shared.uWet.value = w ? 1 : 0;
  }
}

export async function loadArtManifest(base = 'art') {
  try {
    const res = await fetch(`${base}/manifest.json`);
    if (!res.ok) return null;
    return { manifest: await res.json(), base };
  } catch (e) {
    return null;
  }
}
