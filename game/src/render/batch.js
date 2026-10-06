// Draw-call batching for phones.
//
// Every draw call costs CPU time in the browser's GPU process, and a phone
// WebView can only afford a few hundred per frame. Cars and street furniture
// used to be dozens of small meshes each (one per material). Here they are
// baked into single meshes that carry their look per vertex:
//
//   color  – base colour (material colour, or the texture sampled at the vertex)
//   aRmp   – roughness, metalness, paint mask (paint takes the instance colour)
//   aEmi   – light class: 1 head/day-running lamp, 2 tail/brake lamp
//
// and are drawn with one shared physically based material whose shader reads
// those attributes. A traffic car becomes one draw call, a block of parked
// cars one per car style, a 250 m block of street furniture a handful.
import * as THREE from 'three';
import { shared } from './materials.js';

const GLASS = new THREE.Color(0.02, 0.025, 0.032);

/**
 * The shared batched material. `lights` adds per-car head/brake lamp
 * uniforms (traffic); without it lamps are just their colour (parked cars,
 * props). Materials made here share one shader program.
 */
export function bakedMaterial({ lights = false } = {}) {
  const u = { uBrake: { value: 0 }, uLamps: { value: lights ? 1 : 0 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.userData.u = u;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBrake = u.uBrake;
    shader.uniforms.uLamps = u.uLamps;
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRmp;\nattribute float aEmi;\nvarying vec3 vRmp;\nvarying float vEmi;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        vRmp = aRmp;
        vEmi = aEmi;
        #if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR )
          vColor.rgb = color.rgb * mix( vec3( 1.0 ), instanceColor.rgb, aRmp.z );
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRmp;\nvarying float vEmi;\nuniform float uBrake;\nuniform float uLamps;\nuniform float uNight;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRmp.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRmp.y;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if ( uLamps > 0.5 && vEmi > 0.5 ) {
          if ( vEmi < 1.5 ) totalEmissiveRadiance += vec3( 1.0, 0.94, 0.82 ) * ( 0.35 + uNight * 2.6 );
          else totalEmissiveRadiance += vec3( 1.0, 0.04, 0.02 ) * ( 0.2 + max( uNight * 0.9, uBrake * 3.2 ) );
        }`);
  };
  m.customProgramCacheKey = () => 'uae-baked-1';
  return m;
}

// ---------------------------------------------------------------- texture sampling
const pixelCache = new WeakMap();
function texturePixels(tex) {
  if (pixelCache.has(tex)) return pixelCache.get(tex);
  let out = null;
  const img = tex.image;
  try {
    if (img && img.width && img.height) {
      const w = Math.min(256, img.width), h = Math.min(256, img.height);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      out = { w, h, d: ctx.getImageData(0, 0, w, h).data, flipY: tex.flipY };
    }
  } catch (e) {
    out = null;
  }
  pixelCache.set(tex, out);
  return out;
}

const tmpC = new THREE.Color();
function sampleTexture(tex, u, v, target) {
  const px = texturePixels(tex);
  if (!px) return target.setRGB(1, 1, 1);
  const uu = ((u % 1) + 1) % 1, vv = ((v % 1) + 1) % 1;
  const x = Math.min(px.w - 1, Math.floor(uu * px.w));
  const y = Math.min(px.h - 1, Math.floor((px.flipY ? 1 - vv : vv) * px.h));
  const i = (y * px.w + x) * 4;
  return target.setRGB(px.d[i] / 255, px.d[i + 1] / 255, px.d[i + 2] / 255, THREE.SRGBColorSpace);
}

// ---------------------------------------------------------------- vertex accumulation
class Acc {
  constructor(uv = false) {
    this.p = [];
    this.n = [];
    this.c = [];
    this.rmp = [];
    this.emi = [];
    this.uv = uv ? [] : null;
  }
  get count() {
    return this.p.length / 3;
  }
  geometry() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    else {
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute('aRmp', new THREE.Float32BufferAttribute(this.rmp, 3));
      g.setAttribute('aEmi', new THREE.Float32BufferAttribute(this.emi, 1));
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const v3 = new THREE.Vector3();
const n3 = new THREE.Vector3();
const nm = new THREE.Matrix3();

/**
 * Append a geometry (any layout: indexed, interleaved, quantized) transformed
 * by `matrix`. `look(vertexIndex)` returns {color, rmp:[r,m,p], emi} or null
 * for geometry-only accumulators.
 */
function append(acc, geo, matrix, look, range) {
  const pos = geo.attributes.position;
  if (!pos) return;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const index = geo.index;
  nm.getNormalMatrix(matrix);
  const flip = matrix.determinant() < 0;
  const start = range ? range.start : 0;
  const end = range ? Math.min(range.start + range.count, index ? index.count : pos.count) : index ? index.count : pos.count;
  for (let k = start; k < end; k += 3) {
    for (let j = 0; j < 3; j++) {
      const kk = k + (flip ? 2 - j : j);
      const i = index ? index.getX(kk) : kk;
      v3.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      acc.p.push(v3.x, v3.y, v3.z);
      if (nor) n3.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      else n3.set(0, 1, 0);
      acc.n.push(n3.x, n3.y, n3.z);
      if (acc.uv) acc.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      else {
        const s = look(i, uv);
        acc.c.push(s.color.r, s.color.g, s.color.b);
        acc.rmp.push(s.rmp[0], s.rmp[1], s.rmp[2]);
        acc.emi.push(s.emi);
      }
    }
  }
}

/** Lamp class from a material: 1 head / DRL, 2 tail / brake, 0 none. */
function lampClass(m) {
  const name = (m.name || '').toLowerCase();
  if (/head/.test(name)) return 1;
  if (/tail|brake/.test(name)) return 2;
  const e = m.emissive;
  if (!e || e.r + e.g + e.b < 0.05) return 0;
  if (e.r > 0.5 && e.g < 0.2) return 2;
  if (e.r > 0.5 && e.g > 0.7) return 1;
  return 0;
}

function isGlass(m) {
  return m.transparent || /glass|window/i.test(m.name || '');
}

/**
 * Bake a car (procedural group or model) into one geometry in the car's own
 * space. paint: a colour to bake in, or null to leave paint white and masked
 * for an instance colour. isPaint(material) identifies the body colour.
 */
export function bakeVehicle(root, { paint = null, isPaint = (m) => m.userData?.isPaint } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const acc = new Acc();
  const paintCol = paint === null ? new THREE.Color(1, 1, 1) : new THREE.Color(paint);
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.visible || o.userData.isBlob) return;
    let hidden = false;
    for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    rel.multiplyMatrices(inv, o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex] || mats[0];
      if (!m) continue;
      const paintPart = isPaint(m);
      const glass = !paintPart && isGlass(m);
      const emi = lampClass(m);
      const base = paintPart ? paintCol : glass ? GLASS : (m.color || new THREE.Color(1, 1, 1));
      const rmp = paintPart
        ? [0.3, 0.5, paint === null ? 1 : 0]
        : glass ? [0.06, 0.55, 0] : [m.roughness ?? 0.6, m.metalness ?? 0, 0];
      const textured = !paintPart && !glass && m.map;
      const sample = { color: new THREE.Color(), rmp, emi };
      const look = (i, uv) => {
        if (textured && uv) sample.color.copy(sampleTexture(m.map, uv.getX(i), uv.getY(i), tmpC)).multiply(base);
        else sample.color.copy(base);
        return sample;
      };
      append(acc, o.geometry, rel, look, grp.count === Infinity ? null : grp);
    }
  });
  return acc.geometry();
}

/**
 * Bake a group of street furniture (Meshes and InstancedMeshes, already in
 * the group's space) into a few merged meshes: everything plain-coloured
 * goes into one batched mesh, textured / glowing / see-through parts are
 * merged per material.
 */
export function bakeStatic(group, { castShadow = false, plainMaterial } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const plain = new Acc();
  const byMat = new Map();
  const shadowMats = new Set();
  const local = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const full = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const m = o.material;
    if (Array.isArray(m)) return;
    local.multiplyMatrices(inv, o.matrixWorld);
    const isPlain = m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.map && !m.transparent && !m.alphaTest
      && !(m.emissive && m.emissive.getHex() !== 0) && m.side === THREE.FrontSide && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
    const sample = { color: m.color, rmp: [m.roughness ?? 0.6, m.metalness ?? 0, 0], emi: 0 };
    const look = () => sample;
    let acc = plain;
    if (!isPlain) {
      if (!byMat.has(m)) byMat.set(m, new Acc(true));
      acc = byMat.get(m);
    }
    if (o.castShadow) shadowMats.add(isPlain ? 'plain' : m);
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, inst);
        full.multiplyMatrices(local, inst);
        append(acc, o.geometry, full, look);
      }
    } else append(acc, o.geometry, local, look);
  });
  const out = new THREE.Group();
  const add = (geo, mat, cast) => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = castShadow && cast;
    out.add(mesh);
  };
  add(plain.geometry(), plainMaterial, shadowMats.has('plain'));
  for (const [m, acc] of byMat) add(acc.geometry(), m, shadowMats.has(m));
  return out;
}
