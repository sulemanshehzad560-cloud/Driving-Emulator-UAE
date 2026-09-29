// Builds light traffic versions of the hero car models:
//   hero GLB -> drop ground shadows -> merge draw calls -> simplify to a
//   triangle budget -> normalise (front = -Z, ground at y = 0, centred).
// Textures are resized and the result meshopt-compressed by the gltf-transform
// CLI afterwards (see tools/fetch_cars.sh).
// Usage: node scripts/traffic-lods.mjs <in.glb> <out.glb> <triangles> <front: +z|-z>
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [input, output, budget = '14000', front = '+z'] = process.argv.slice(2);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(input);
const root = doc.getRoot();

// traffic cars are never rigged: drop skins/animations and baked ground shadows
for (const a of root.listAnimations()) a.dispose();
for (const s of root.listSkins()) s.dispose();
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  if (mesh.listPrimitives().every((p) => /shadow/i.test(p.getMaterial()?.getName() || ''))) node.setMesh(null);
}
// the extension's compressed buffers are decoded on read; write plain buffers
for (const ext of root.listExtensionsUsed()) if (/meshopt/.test(ext.extensionName)) ext.dispose();

/**
 * Each vertex gets the area-weighted average of the (new) faces around its
 * position whose normal lies within 60 degrees of the vertex's original
 * normal: smooth panels become smooth again, hard edges stay hard.
 */
function resmooth(prim) {
  const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL'), idx = prim.getIndices();
  if (!pos || !nrm || !idx) return;
  const P = pos.getArray(), N = nrm.getArray(), I = idx.getArray();
  const faces = new Float32Array(I.length); // area-weighted face normal per corner triangle (x,y,z per face)
  const byPos = new Map();
  const key = (v) => `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
  for (let f = 0; f < I.length / 3; f++) {
    const [a, b, c] = [I[f * 3], I[f * 3 + 1], I[f * 3 + 2]];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    faces[f * 3] = uy * vz - uz * vy;
    faces[f * 3 + 1] = uz * vx - ux * vz;
    faces[f * 3 + 2] = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const k = key(v);
      if (!byPos.has(k)) byPos.set(k, []);
      byPos.get(k).push(f);
    }
  }
  const out = new Float32Array(N.length);
  const cos = Math.cos((60 * Math.PI) / 180);
  for (let v = 0; v < P.length / 3; v++) {
    const on = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    let sx = 0, sy = 0, sz = 0;
    for (const f of byPos.get(key(v)) || []) {
      const fx = faces[f * 3], fy = faces[f * 3 + 1], fz = faces[f * 3 + 2];
      const l = Math.hypot(fx, fy, fz) || 1;
      if ((fx * on[0] + fy * on[1] + fz * on[2]) / l < cos) continue;
      sx += fx; sy += fy; sz += fz;
    }
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) { out.set(on, v * 3); continue; }
    out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l;
  }
  nrm.setArray(out);
}

const tris = () => {
  let n = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
};
const before = tris();
// tangent-space normal maps no longer line up once the mesh is simplified
// (panels look crumpled); at traffic distance the smooth normals read better
for (const m of root.listMaterials()) m.setNormalTexture(null);
await doc.transform(prune(), dedup(), flatten(), join({ keepNamed: false }), weld());
const ratio = Math.min(1, +budget / tris());
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0015, lockBorder: false }), prune());
// collapsed vertices keep their old normals, which shades the panels as if
// crumpled: re-smooth over the simplified faces, keeping designed creases
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) resmooth(prim);

// normalise: wrap the scene in one node that centres, grounds and turns it
const scene = root.listScenes()[0];
const b = getBounds(scene);
const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
const wrap = doc.createNode('traffic-root');
for (const child of scene.listChildren()) {
  scene.removeChild(child);
  wrap.addChild(child);
}
const turn = front === '+z'; // game cars face -Z
wrap.setRotation(turn ? [0, 1, 0, 0] : [0, 0, 0, 1]);
wrap.setTranslation(turn ? [cx, -b.min[1], cz] : [-cx, -b.min[1], -cz]);
scene.addChild(wrap);

await io.write(output, doc);
const size = [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(2));
console.log(`${output}: ${before} -> ${tris()} triangles, ${root.listMaterials().length} materials, size ${size.join(' x ')} m`);
