// Web Worker: downloads a tile and builds its geometry off the main thread.
import { buildTile } from './tileBuild.js';

function transferables(obj, out = []) {
  if (!obj) return out;
  if (ArrayBuffer.isView(obj)) {
    out.push(obj.buffer);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) if (v && typeof v === 'object') transferables(v, out);
    return out;
  }
  if (typeof obj === 'object') for (const v of Object.values(obj)) if (v && typeof v === 'object') transferables(v, out);
  return out;
}

self.onmessage = async (e) => {
  const { id, url, opts } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tile = await res.json();
    const built = buildTile(tile, opts);
    const list = [...new Set(transferables(built))];
    self.postMessage({ id, ok: true, tile: built }, list);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
