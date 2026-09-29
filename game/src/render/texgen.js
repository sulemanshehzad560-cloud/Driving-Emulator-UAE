// Procedural PBR texture generator (albedo / normal / roughness / emissive).
// Used for everything that has no photographic CC0 texture, and as the
// fallback when the art pack is not installed.
import * as THREE from 'three';

export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---- tileable value noise ----
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function makeNoise(seed = 1) {
  return (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const p = period || 1e9;
    const w = (a) => ((a % p) + p) % p;
    const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
    const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Tileable fractal noise field of size n x n (Float32Array, 0..1). */
export function fbm(n, { scale = 8, octaves = 5, seed = 1, gain = 0.5 } = {}) {
  const noise = makeNoise(seed);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let amp = 1, f = scale, sum = 0, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += noise((x / n) * f, (y / n) * f, f) * amp;
        norm += amp;
        amp *= gain;
        f *= 2;
      }
      out[y * n + x] = sum / norm;
    }
  }
  return out;
}

/** Convert a height field to a tangent-space normal map canvas. */
export function normalFromHeight(h, n, strength = 2) {
  const c = canvas(n);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  const at = (x, y) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fieldToCanvas(n, fn) {
  const c = canvas(n);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * n + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function toTexture(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- asphalt
export function asphalt(n = 512, seed = 3) {
  const big = fbm(n, { scale: 4, octaves: 4, seed });
  const fine = fbm(n, { scale: 64, octaves: 3, seed: seed + 7 });
  const grain = fbm(n, { scale: 256, octaves: 1, seed: seed + 11 });
  const crackField = fbm(n, { scale: 6, octaves: 5, seed: seed + 19 });
  const height = new Float32Array(n * n);
  const color = fieldToCanvas(n, (x, y) => {
    const i = y * n + x;
    // aggregate: bright stones in dark binder
    const stone = grain[i] > 0.72 ? (grain[i] - 0.72) * 3 : 0;
    const crack = Math.abs(crackField[i] - 0.5) < 0.006 && big[i] > 0.55 ? 1 : 0;
    const patch = big[i] > 0.7 ? 0.08 : 0;
    let v = 58 + big[i] * 22 + fine[i] * 18 + stone * 70 - crack * 35 - patch * 60;
    height[i] = fine[i] * 0.6 + stone * 0.8 - crack * 1.5;
    return [v * 0.97, v * 0.97, v];
  });
  const rough = fieldToCanvas(n, (x, y) => {
    const i = y * n + x;
    const r = 205 + fine[i] * 40 - (big[i] > 0.7 ? 30 : 0);
    return [r, r, r];
  });
  return { color, normal: normalFromHeight(height, n, 3), rough };
}

// ---------------------------------------------------------------- interlocking pavers
export function pavers(n = 512, seed = 5, tint = [176, 150, 128]) {
  const noise = fbm(n, { scale: 32, octaves: 3, seed });
  const brickW = n / 8, brickH = n / 16;
  const height = new Float32Array(n * n);
  const color = fieldToCanvas(n, (x, y) => {
    const row = Math.floor(y / brickH);
    const off = (row % 2) * brickW * 0.5;
    const bx = (x + off) % brickW, by = y % brickH;
    const edge = Math.min(bx, brickW - bx, by, brickH - by);
    const joint = edge < 1.6;
    const id = Math.floor((x + off) / brickW) + row * 31;
    const shade = 0.88 + (((id * 2654435761) >>> 0) % 100) / 100 * 0.2;
    const k = noise[y * n + x];
    height[y * n + x] = joint ? 0 : Math.min(1, edge / 4) * 0.8 + k * 0.2;
    if (joint) return [90, 84, 76];
    return [tint[0] * shade * (0.9 + k * 0.2), tint[1] * shade * (0.9 + k * 0.2), tint[2] * shade * (0.9 + k * 0.2)];
  });
  const rough = fieldToCanvas(n, (x, y) => {
    const v = 190 + noise[y * n + x] * 50;
    return [v, v, v];
  });
  return { color, normal: normalFromHeight(height, n, 2.5), rough };
}

// ---------------------------------------------------------------- desert sand
export function sand(n = 512, seed = 9) {
  const big = fbm(n, { scale: 3, octaves: 4, seed });
  const fine = fbm(n, { scale: 96, octaves: 2, seed: seed + 3 });
  const noise = makeNoise(seed + 5);
  const height = new Float32Array(n * n);
  const color = fieldToCanvas(n, (x, y) => {
    const i = y * n + x;
    // wind ripples
    const warp = noise((x / n) * 6, (y / n) * 6, 6) * 6;
    const ripple = Math.sin((y / n) * Math.PI * 2 * 22 + warp) * 0.5 + 0.5;
    height[i] = ripple * 0.5 + fine[i] * 0.5;
    const v = 0.86 + big[i] * 0.18 + ripple * 0.04 + fine[i] * 0.05;
    return [226 * v, 196 * v, 150 * v];
  });
  const rough = fieldToCanvas(n, () => [238, 238, 238]);
  return { color, normal: normalFromHeight(height, n, 1.2), rough };
}

export function grass(n = 256, seed = 12) {
  const f = fbm(n, { scale: 48, octaves: 3, seed });
  const big = fbm(n, { scale: 4, octaves: 3, seed: seed + 1 });
  const height = new Float32Array(n * n);
  const color = fieldToCanvas(n, (x, y) => {
    const i = y * n + x;
    height[i] = f[i];
    const v = 0.75 + f[i] * 0.35;
    return [lerp(62, 92, big[i]) * v, lerp(120, 138, big[i]) * v, lerp(44, 52, big[i]) * v];
  });
  return { color, normal: normalFromHeight(height, n, 2), rough: fieldToCanvas(n, () => [230, 230, 230]) };
}

// ---------------------------------------------------------------- water normal
export function waterNormal(n = 256, seed = 21) {
  const h = fbm(n, { scale: 8, octaves: 5, seed, gain: 0.55 });
  return normalFromHeight(h, n, 6);
}

// ---------------------------------------------------------------- facades
// Every facade covers 9.9 m x 9.9 m: 3 floors x 3 bays. Channels:
//   color, normal, rough, emissive-mask (white where windows are).
const FLOORS = 3, BAYS = 3;

function facadeBase(n, draw) {
  const color = canvas(n), rough = canvas(n), mask = canvas(n), height = canvas(n);
  const cc = color.getContext('2d'), rc = rough.getContext('2d'), mc = mask.getContext('2d'), hc = height.getContext('2d');
  mc.fillStyle = '#000';
  mc.fillRect(0, 0, n, n);
  draw({ cc, rc, mc, hc, n, cell: n / BAYS, floor: n / FLOORS });
  // height -> normal
  const hd = hc.getImageData(0, 0, n, n).data;
  const h = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) h[i] = hd[i * 4] / 255;
  return { color, rough, emissive: mask, normal: normalFromHeight(h, n, 4) };
}

export function facadeGlass(n = 512, tint = '#3d6f8f', seed = 1) {
  const rnd = makeNoise(seed);
  return facadeBase(n, ({ cc, rc, hc, mc, cell, floor }) => {
    const g = cc.createLinearGradient(0, 0, n, n);
    g.addColorStop(0, tint);
    g.addColorStop(0.5, shade(tint, 1.35));
    g.addColorStop(1, shade(tint, 0.85));
    cc.fillStyle = g;
    cc.fillRect(0, 0, n, n);
    rc.fillStyle = '#1a1a1a'; // glossy glass
    rc.fillRect(0, 0, n, n);
    hc.fillStyle = '#404040';
    hc.fillRect(0, 0, n, n);
    for (let f = 0; f < FLOORS; f++) {
      for (let b = 0; b < BAYS * 2; b++) {
        const x = (b * cell) / 2, y = f * floor;
        // individual panes with slightly different reflectivity
        const v = rnd(b * 1.7, f * 2.3) * 0.25;
        cc.fillStyle = `rgba(255,255,255,${v * 0.35})`;
        cc.fillRect(x + 2, y + 2, cell / 2 - 4, floor - 10);
        mc.fillStyle = '#fff';
        mc.fillRect(x + 4, y + 6, cell / 2 - 8, floor - 18);
      }
      // spandrel band + mullions
      cc.fillStyle = shade(tint, 0.45);
      cc.fillRect(0, f * floor + floor - 9, n, 9);
      rc.fillStyle = '#707070';
      rc.fillRect(0, f * floor + floor - 9, n, 9);
      hc.fillStyle = '#9a9a9a';
      hc.fillRect(0, f * floor + floor - 9, n, 9);
    }
    cc.fillStyle = '#2a3036';
    rc.fillStyle = '#808080';
    hc.fillStyle = '#c0c0c0';
    for (let b = 0; b <= BAYS * 2; b++) {
      const x = (b * cell) / 2 - 2;
      cc.fillRect(x, 0, 4, n);
      rc.fillRect(x, 0, 4, n);
      hc.fillRect(x, 0, 4, n);
    }
  });
}

export function facadeApartment(n = 512, wall = '#e8dcc6', seed = 2) {
  const noise = fbm(128, { scale: 8, octaves: 3, seed });
  return facadeBase(n, ({ cc, rc, hc, mc, cell, floor }) => {
    cc.fillStyle = wall;
    cc.fillRect(0, 0, n, n);
    // plaster stain variation
    for (let i = 0; i < 600; i++) {
      const v = noise[(i * 37) % noise.length];
      cc.fillStyle = `rgba(80,60,40,${v * 0.05})`;
      cc.fillRect(((i * 97) % n), ((i * 53) % n), 20, 20);
    }
    rc.fillStyle = '#e0e0e0';
    rc.fillRect(0, 0, n, n);
    hc.fillStyle = '#808080';
    hc.fillRect(0, 0, n, n);
    for (let f = 0; f < FLOORS; f++) {
      const y = f * floor;
      // floor slab line
      cc.fillStyle = shade(wall, 0.82);
      cc.fillRect(0, y + floor - 6, n, 6);
      for (let b = 0; b < BAYS; b++) {
        const x = b * cell;
        const balcony = (b + f) % 2 === 0;
        // window
        cc.fillStyle = '#26323c';
        cc.fillRect(x + cell * 0.22, y + floor * 0.18, cell * 0.56, floor * 0.52);
        cc.fillStyle = 'rgba(160,200,230,0.35)';
        cc.fillRect(x + cell * 0.22, y + floor * 0.18, cell * 0.56, floor * 0.16);
        rc.fillStyle = '#2a2a2a';
        rc.fillRect(x + cell * 0.22, y + floor * 0.18, cell * 0.56, floor * 0.52);
        hc.fillStyle = '#303030';
        hc.fillRect(x + cell * 0.22, y + floor * 0.18, cell * 0.56, floor * 0.52);
        mc.fillStyle = '#fff';
        mc.fillRect(x + cell * 0.24, y + floor * 0.2, cell * 0.52, floor * 0.48);
        // frame
        cc.strokeStyle = shade(wall, 0.7);
        cc.lineWidth = 4;
        cc.strokeRect(x + cell * 0.22, y + floor * 0.18, cell * 0.56, floor * 0.52);
        if (balcony) {
          // balcony slab + railing
          cc.fillStyle = shade(wall, 0.9);
          cc.fillRect(x + cell * 0.12, y + floor * 0.7, cell * 0.76, floor * 0.08);
          cc.fillStyle = 'rgba(40,50,60,0.7)';
          for (let k = 0; k < 10; k++) cc.fillRect(x + cell * 0.12 + (k * cell * 0.76) / 10, y + floor * 0.5, 3, floor * 0.2);
          cc.fillRect(x + cell * 0.12, y + floor * 0.5, cell * 0.76, 3);
          hc.fillStyle = '#d0d0d0';
          hc.fillRect(x + cell * 0.12, y + floor * 0.7, cell * 0.76, floor * 0.08);
        } else {
          // split AC unit under the window (very common in the UAE)
          cc.fillStyle = '#d8d8d8';
          cc.fillRect(x + cell * 0.62, y + floor * 0.74, cell * 0.22, floor * 0.14);
          cc.fillStyle = '#9a9a9a';
          cc.fillRect(x + cell * 0.64, y + floor * 0.77, cell * 0.12, floor * 0.08);
          hc.fillStyle = '#e0e0e0';
          hc.fillRect(x + cell * 0.62, y + floor * 0.74, cell * 0.22, floor * 0.14);
        }
      }
    }
  });
}

export function facadeOffice(n = 512, stone = '#cfc6b8', glass = '#34566e') {
  return facadeBase(n, ({ cc, rc, hc, mc, cell, floor }) => {
    cc.fillStyle = stone;
    cc.fillRect(0, 0, n, n);
    rc.fillStyle = '#c8c8c8';
    rc.fillRect(0, 0, n, n);
    hc.fillStyle = '#a0a0a0';
    hc.fillRect(0, 0, n, n);
    for (let f = 0; f < FLOORS; f++) {
      const y = f * floor;
      // continuous ribbon window
      cc.fillStyle = glass;
      cc.fillRect(0, y + floor * 0.2, n, floor * 0.55);
      cc.fillStyle = 'rgba(200,225,240,0.25)';
      cc.fillRect(0, y + floor * 0.2, n, floor * 0.12);
      rc.fillStyle = '#202020';
      rc.fillRect(0, y + floor * 0.2, n, floor * 0.55);
      hc.fillStyle = '#404040';
      hc.fillRect(0, y + floor * 0.2, n, floor * 0.55);
      mc.fillStyle = '#fff';
      mc.fillRect(0, y + floor * 0.23, n, floor * 0.49);
      for (let b = 0; b <= BAYS * 3; b++) {
        cc.fillStyle = shade(stone, 0.6);
        cc.fillRect((b * n) / (BAYS * 3) - 2, y + floor * 0.2, 4, floor * 0.55);
      }
    }
  });
}

export function facadeVilla(n = 512, wall = '#efe6d4', seed = 3) {
  return facadeBase(n, ({ cc, rc, hc, mc, cell, floor }) => {
    cc.fillStyle = wall;
    cc.fillRect(0, 0, n, n);
    rc.fillStyle = '#e6e6e6';
    rc.fillRect(0, 0, n, n);
    hc.fillStyle = '#808080';
    hc.fillRect(0, 0, n, n);
    for (let f = 0; f < FLOORS; f++) {
      const y = f * floor;
      for (let b = 0; b < BAYS; b++) {
        if ((b * 7 + f * 3 + seed) % 3 === 0) continue;
        const x = b * cell + cell * 0.3, w = cell * 0.4, top = y + floor * 0.22, h = floor * 0.5;
        // arched window with a stone surround
        cc.fillStyle = shade(wall, 0.82);
        cc.beginPath();
        cc.moveTo(x - 6, top + h + 6);
        cc.lineTo(x - 6, top + w / 2);
        cc.arc(x + w / 2, top + w / 2, w / 2 + 6, Math.PI, 0);
        cc.lineTo(x + w + 6, top + h + 6);
        cc.fill();
        cc.fillStyle = '#2d3844';
        cc.beginPath();
        cc.moveTo(x, top + h);
        cc.lineTo(x, top + w / 2);
        cc.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
        cc.lineTo(x + w, top + h);
        cc.fill();
        cc.fillStyle = 'rgba(255,255,255,0.8)';
        cc.fillRect(x + w / 2 - 1.5, top, 3, h);
        mc.fillStyle = '#fff';
        mc.fillRect(x + 3, top + w / 2, w - 6, h - w / 2 - 3);
        hc.fillStyle = '#303030';
        hc.fillRect(x, top + w / 2, w, h - w / 2);
      }
      cc.fillStyle = shade(wall, 0.88);
      cc.fillRect(0, y + floor - 8, n, 8);
    }
  });
}

export function facadeStorefront(n = 512) {
  const signs = ['#c8102e', '#0a4f9e', '#f2a900', '#00843d', '#6a1b9a', '#e65100'];
  return facadeBase(n, ({ cc, rc, hc, mc, cell, floor }) => {
    // one tall shop floor stretched over the whole texture height
    cc.fillStyle = '#d9d2c5';
    cc.fillRect(0, 0, n, n);
    rc.fillStyle = '#c0c0c0';
    rc.fillRect(0, 0, n, n);
    hc.fillStyle = '#909090';
    hc.fillRect(0, 0, n, n);
    for (let b = 0; b < BAYS; b++) {
      const x = b * cell;
      cc.fillStyle = signs[b % signs.length];
      cc.fillRect(x + 8, n * 0.08, cell - 16, n * 0.12);
      cc.fillStyle = '#fff';
      cc.fillRect(x + cell * 0.2, n * 0.12, cell * 0.6, n * 0.04);
      cc.fillStyle = '#1e2a33';
      cc.fillRect(x + 10, n * 0.28, cell - 20, n * 0.66);
      cc.fillStyle = 'rgba(255,240,200,0.18)';
      cc.fillRect(x + 10, n * 0.28, cell - 20, n * 0.2);
      rc.fillStyle = '#181818';
      rc.fillRect(x + 10, n * 0.28, cell - 20, n * 0.66);
      mc.fillStyle = '#fff';
      mc.fillRect(x + 12, n * 0.3, cell - 24, n * 0.62);
      mc.fillRect(x + 8, n * 0.08, cell - 16, n * 0.12);
    }
  });
}

export function facadeIndustrial(n = 256, tint = '#b9bec4') {
  return facadeBase(n, ({ cc, rc, hc }) => {
    for (let x = 0; x < n; x += 8) {
      const g = cc.createLinearGradient(x, 0, x + 8, 0);
      g.addColorStop(0, shade(tint, 0.85));
      g.addColorStop(0.5, shade(tint, 1.1));
      g.addColorStop(1, shade(tint, 0.85));
      cc.fillStyle = g;
      cc.fillRect(x, 0, 8, n);
      const hg = hc.createLinearGradient(x, 0, x + 8, 0);
      hg.addColorStop(0, '#303030');
      hg.addColorStop(0.5, '#d0d0d0');
      hg.addColorStop(1, '#303030');
      hc.fillStyle = hg;
      hc.fillRect(x, 0, 8, n);
    }
    rc.fillStyle = '#8a8a8a';
    rc.fillRect(0, 0, n, n);
  });
}

// ---------------------------------------------------------------- decals & details
/** Worn lane paint: white where paint remains. */
export function paintWear(n = 256, seed = 31) {
  const f = fbm(n, { scale: 16, octaves: 4, seed });
  return fieldToCanvas(n, (x, y) => {
    const v = f[y * n + x] > 0.36 ? 255 : 0;
    return [v, v, v];
  });
}

/** Black/yellow painted kerb stripes (1 m each). */
export function kerbStripes(n = 128) {
  return fieldToCanvas(n, (x, y) => (y < n / 2 ? [240, 190, 20] : [30, 30, 30]));
}

/**
 * Date-palm frond: a strip texture (u across the frond, v from base to tip)
 * with a tapering midrib and ~70 pairs of narrow, pointed leaflets in varied
 * greens, sun-bleached/dry tips and the odd missing leaflet. Alpha = shape.
 */
export function palmLeaf(w = 512, h = 1024) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cx = w / 2;
  const pairs = 70;
  for (let i = 0; i < pairs; i++) {
    const t = (i + 0.5) / pairs; // 0 base .. 1 tip
    if (t < 0.12) continue; // bare petiole with spines at the base
    const y = h - t * h;
    const len = (Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.46 + 0.04) * w;
    for (const s of [-1, 1]) {
      if (rnd() < 0.05) continue; // missing / broken leaflet
      const l = len * (0.85 + rnd() * 0.3);
      const ang = 0.55 + rnd() * 0.12; // leaflets point towards the tip
      const ex = cx + s * l * Math.cos(ang), ey = y - l * Math.sin(ang);
      const base = 5 + (1 - t) * 4;
      const hue = 78 + rnd() * 18, sat = 38 + rnd() * 18, lum = 24 + rnd() * 12;
      const g = ctx.createLinearGradient(cx, y, ex, ey);
      g.addColorStop(0, `hsl(${hue},${sat}%,${lum - 6}%)`);
      g.addColorStop(0.7, `hsl(${hue},${sat}%,${lum + 4}%)`);
      g.addColorStop(1, rnd() < 0.35 ? `hsl(42,45%,${48 + rnd() * 12}%)` : `hsl(${hue - 6},${sat - 10}%,${lum + 12}%)`); // dry tips
      ctx.fillStyle = g;
      ctx.beginPath();
      // narrow blade: widest near the rib, pointed tip, slight curve
      const mx = cx + s * l * 0.5 * Math.cos(ang - 0.06), my = y - l * 0.5 * Math.sin(ang - 0.06);
      ctx.moveTo(cx, y - base * 0.5);
      ctx.quadraticCurveTo(mx, my - base * 0.7, ex, ey);
      ctx.quadraticCurveTo(mx, my + base * 0.7, cx, y + base * 0.5);
      ctx.closePath();
      ctx.fill();
      // fold line down the leaflet
      ctx.strokeStyle = 'rgba(20,35,10,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
    }
  }
  // midrib (rachis): thick at the base, yellow-green
  const rib = ctx.createLinearGradient(0, h, 0, 0);
  rib.addColorStop(0, '#9c8a4a');
  rib.addColorStop(0.3, '#8a8f45');
  rib.addColorStop(1, '#6d8235');
  ctx.fillStyle = rib;
  ctx.beginPath();
  ctx.moveTo(cx - 9, h);
  ctx.lineTo(cx - 1.5, 0);
  ctx.lineTo(cx + 1.5, 0);
  ctx.lineTo(cx + 9, h);
  ctx.closePath();
  ctx.fill();
  // spines on the petiole
  ctx.strokeStyle = '#8c7a40';
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const y = h - (i / 10) * h * 0.12;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 8, y);
      ctx.lineTo(cx + s * (26 + rnd() * 10), y - 18);
      ctx.stroke();
    }
  }
  return c;
}

/**
 * Date-palm trunk: rows of diamond-shaped leaf-base "boots" left by old
 * fronds, fibrous between them. Tiles horizontally around the trunk.
 */
export function palmTrunk(n = 512) {
  const f = fbm(n, { scale: 48, octaves: 4, seed: 44 });
  const fibre = fbm(n, { scale: 160, octaves: 2, seed: 9 });
  const height = new Float32Array(n * n);
  const rows = 16, cols = 8;
  const cw = n / cols, rh = n / rows;
  const color = fieldToCanvas(n, (x, y) => {
    const row = Math.floor(y / rh);
    const off = (row % 2) * cw * 0.5;
    const u = (((x + off) % cw) / cw) * 2 - 1; // -1..1 across a boot
    const v = ((y % rh) / rh) * 2 - 1; // -1..1 up a boot
    // diamond boot, stub end cut flat at the top
    const d = Math.abs(u) * 0.9 + Math.abs(v) * 0.75;
    const boot = Math.max(0, 1 - d);
    const cut = v < -0.55 ? 0.35 : 1;
    const hgt = boot ** 0.6 * cut + fibre[y * n + x] * 0.15;
    height[y * n + x] = hgt;
    const tone = 0.55 + f[y * n + x] * 0.35 + boot * 0.25 - (boot < 0.05 ? 0.2 : 0) + fibre[y * n + x] * 0.12;
    const cutFace = v < -0.55 && boot > 0.1; // fresh cut ends are paler
    return cutFace ? [178 * tone, 150 * tone, 108 * tone] : [120 * tone, 92 * tone, 62 * tone];
  });
  return { color, normal: normalFromHeight(height, n, 5) };
}

export function glow(n = 64, stops = [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]) {
  const c = canvas(n);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  return c;
}

export function dubaiPlate(text = 'A 12345') {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 12px Arial';
  ctx.fillText('DUBAI', 12, 20);
  ctx.fillText('دبي', 18, 40);
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 150, 34);
  return c;
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}
