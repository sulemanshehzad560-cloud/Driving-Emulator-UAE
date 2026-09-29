// Nationwide data: the UAE major-road graph (GPS across emirates), emirate
// outlines, places, the list of available tiles, and the far terrain that
// shows desert and sea beyond the streamed area.
import { emirateName } from './cities.js';
import * as THREE from 'three';
import { MinHeap } from './graph.js';

export class Overview {
  constructor(data) {
    this.data = data;
    this.tiles = new Set(data.tiles.map(([tx, ty]) => `${tx}_${ty}`));
    // world coords: X = x, Z = -y
    const n = data.nodes.length / 2;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = data.nodes[i * 2];
      this.z[i] = -data.nodes[i * 2 + 1];
    }
    this.adj = Array.from({ length: n }, () => []);
    for (const w of data.ways) {
      for (let k = 1; k < w.n.length; k++) {
        const a = w.n[k - 1], b = w.n[k];
        const len = Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]);
        const cost = len / Math.max(8, (w.maxspeed || 60) / 3.6);
        this.adj[a].push([b, cost, w]);
        if (!w.oneway) this.adj[b].push([a, cost, w]);
      }
    }
    // spatial buckets for nearest-node queries (2 km cells)
    this.cells = new Map();
    for (let i = 0; i < n; i++) {
      if (!this.adj[i].length) continue;
      const k = `${Math.floor(this.x[i] / 2000)}_${Math.floor(this.z[i] / 2000)}`;
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(i);
    }
    this.places = (data.places || []).map((p) => ({ ...p, X: p.x, Z: -p.y }));
    this.emirates = (data.emirates || []).map((e) => ({ ...e, name: emirateName(e.name), X: e.x, Z: -e.y })).filter((e) => e.name);
    // older data sets have no national outline: the emirates together draw the country
    if (!data.outline?.length && this.emirates.length) data.outline = this.emirates.flatMap((e) => e.polys);
  }

  hasTile(key) {
    return this.tiles.has(key);
  }

  nearestNode(X, Z) {
    let best = -1, bd = Infinity;
    const ci = Math.floor(X / 2000), cj = Math.floor(Z / 2000);
    for (let r = 0; r < 8 && best < 0; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          for (const n of this.cells.get(`${i}_${j}`) || []) {
            const d = (this.x[n] - X) ** 2 + (this.z[n] - Z) ** 2;
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
    }
    return best;
  }

  /** Route between two world points over major roads. Returns [[X, Z], ...] or null. */
  route(X0, Z0, X1, Z1) {
    const a = this.nearestNode(X0, Z0), b = this.nearestNode(X1, Z1);
    if (a < 0 || b < 0) return null;
    const h = (i) => Math.hypot(this.x[i] - this.x[b], this.z[i] - this.z[b]) / 34;
    const g = new Float64Array(this.x.length).fill(Infinity);
    const prev = new Int32Array(this.x.length).fill(-1);
    g[a] = 0;
    const heap = new MinHeap();
    heap.push(h(a), a);
    const closed = new Uint8Array(this.x.length);
    while (heap.size) {
      const n = heap.pop();
      if (n === b) break;
      if (closed[n]) continue;
      closed[n] = 1;
      for (const [m, cost] of this.adj[n]) {
        const c = g[n] + cost;
        if (c < g[m]) {
          g[m] = c;
          prev[m] = n;
          heap.push(c + h(m), m);
        }
      }
    }
    if (a !== b && prev[b] < 0) return null;
    const path = [];
    for (let n = b; n >= 0; n = prev[n]) {
      path.push([this.x[n], this.z[n]]);
      if (n === a) break;
    }
    path.reverse();
    return { points: path, seconds: g[b] };
  }

  /** Emirate name for a world position (point in polygon on the overview outlines). */
  emirateAt(X, Z) {
    const y = -Z;
    for (const e of this.emirates) {
      for (const poly of e.polys) {
        let inside = false;
        for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
          if ((poly[i + 1] > y) !== (poly[j + 1] > y) && X < ((poly[j] - poly[i]) * (y - poly[i + 1])) / (poly[j + 1] - poly[i + 1]) + poly[i]) inside = !inside;
        }
        if (inside) return e.name;
      }
    }
    return '';
  }

  nearestPlace(X, Z, kinds = ['suburb', 'town', 'city', 'village', 'island']) {
    let best = null, bd = 4000 ** 2;
    for (const p of this.places) {
      if (!kinds.includes(p.kind)) continue;
      const d = (p.X - X) ** 2 + (p.Z - Z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

/** Huge ground plane under the streamed tiles: sand or sea from the land mask. */
export function farTerrain(maskTex, maskInfo, sandTex) {
  const size = 40000;
  const geo = new THREE.PlaneGeometry(size, size, 64, 64); // small triangles keep depth interpolation stable
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6cfa6, roughness: 1, map: sandTex || null });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: maskTex };
    shader.uniforms.uMaskBox = { value: new THREE.Vector4(maskInfo.minx, maskInfo.miny, maskInfo.maxx, maskInfo.maxy) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFarWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMask;\nuniform vec4 uMaskBox;\nvarying vec3 vFarWorld;')
      .replace('#include <map_fragment>', `
        vec2 mUv = vec2((vFarWorld.x - uMaskBox.x) / (uMaskBox.z - uMaskBox.x), (-vFarWorld.z - uMaskBox.y) / (uMaskBox.w - uMaskBox.y));
        float land = (mUv.x < 0.0 || mUv.x > 1.0 || mUv.y < 0.0 || mUv.y > 1.0) ? 1.0 : texture2D(uMask, mUv).r;
        #ifdef USE_MAP
          vec4 sandTexel = texture2D(map, vFarWorld.xz / 12.0);
        #else
          vec4 sandTexel = vec4(1.0);
        #endif
        vec3 sea = vec3(0.04, 0.26, 0.34);
        diffuseColor.rgb = mix(sea, diffuseColor.rgb * sandTexel.rgb, smoothstep(0.35, 0.65, land));
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.08, roughnessFactor, smoothstep(0.35, 0.65, land));');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.3;
  mesh.receiveShadow = false;
  // drawn first as a backdrop: it never writes depth, so it can never cover roads or tile ground
  mat.depthWrite = false;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return mesh;
}
