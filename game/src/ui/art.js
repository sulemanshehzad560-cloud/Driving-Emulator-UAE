// Menu artwork: the sunset Dubai skyline for the splash screen and the
// interactive, colourful UAE map picker.
import { project } from '../world/projection.js';
import { EMIRATE_COLORS } from '../world/cities.js';

export function skylineSVG() {
  // stylised Dubai skyline: Burj Khalifa, Burj Al Arab, Emirates Towers, Museum of the Future, Frame
  return `
  <svg viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice" class="skyline">
    <defs>
      <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1b1446"/>
        <stop offset="0.45" stop-color="#b8356b"/>
        <stop offset="0.75" stop-color="#ff8a3d"/>
        <stop offset="1" stop-color="#ffd27a"/>
      </linearGradient>
      <radialGradient id="sunG" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fff4c2"/>
        <stop offset="0.6" stop-color="#ffc55a"/>
        <stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cityG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2a1b3d"/>
        <stop offset="1" stop-color="#0e0a1a"/>
      </linearGradient>
      <linearGradient id="seaG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6b3a5a"/>
        <stop offset="1" stop-color="#140d24"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="600" fill="url(#skyG)"/>
    <circle cx="1060" cy="470" r="150" fill="url(#sunG)"/>
    <g fill="url(#cityG)">
      <!-- far towers -->
      <rect x="40" y="380" width="46" height="140"/><rect x="96" y="340" width="36" height="180"/><rect x="140" y="400" width="60" height="120"/>
      <rect x="1250" y="360" width="44" height="160"/><rect x="1300" y="390" width="70" height="130"/><rect x="1380" y="330" width="40" height="190"/>
      <rect x="1430" y="400" width="80" height="120"/><rect x="1520" y="370" width="50" height="150"/>
      <!-- Burj Al Arab -->
      <path d="M250 520 L262 250 C330 300 360 420 370 520 Z"/>
      <path d="M256 250 L258 210 L262 250 Z"/>
      <!-- Emirates Towers -->
      <path d="M470 520 L470 280 L500 230 L500 520 Z"/><path d="M515 520 L515 310 L540 270 L540 520 Z"/>
      <!-- Museum of the Future (torus) -->
      <path d="M600 520 C600 420 700 400 720 470 C735 520 690 520 690 520 C690 480 640 470 640 520 Z"/>
      <!-- Burj Khalifa -->
      <path d="M800 520 L812 400 L822 400 L826 300 L836 300 L840 200 L848 200 L851 120 L856 120 L858 40 L860 120 L865 120 L868 200 L876 200 L880 300 L890 300 L894 400 L904 400 L916 520 Z"/>
      <!-- Dubai Frame -->
      <path d="M960 520 L960 330 L1040 330 L1040 520 L1025 520 L1025 350 L975 350 L975 520 Z"/>
      <rect x="1110" y="360" width="56" height="160"/><rect x="1170" y="310" width="40" height="210"/>
      <rect x="380" y="400" width="70" height="120"/><rect x="560" y="430" width="36" height="90"/><rect x="740" y="410" width="50" height="110"/>
    </g>
    <rect y="520" width="1600" height="80" fill="url(#seaG)"/>
    <g stroke="#ffcf8a" stroke-opacity="0.35" stroke-width="3">
      <path d="M980 540 H1140M1000 556 H1120M1020 572 H1100M1035 588 H1085"/>
    </g>
  </svg>`;
}

// coarse UAE outline (lon, lat) used when the real border is not available
const FALLBACK_OUTLINE = [
  [51.58, 24.26], [51.75, 24.05], [52.2, 24.02], [52.73, 24.11], [53.45, 24.12], [54.0, 24.2], [54.37, 24.48], [54.62, 24.62], [54.85, 24.86],
  [55.03, 25.0], [55.27, 25.25], [55.4, 25.35], [55.45, 25.42], [55.55, 25.57], [55.75, 25.7], [55.94, 25.8], [56.08, 26.05],
  [56.18, 25.85], [56.27, 25.62], [56.33, 25.12], [56.36, 25.0], [56.2, 24.85], [56.05, 24.75], [55.9, 24.4], [55.8, 24.22],
  [55.95, 24.0], [55.5, 23.5], [55.2, 22.7], [52.58, 22.94], [51.8, 23.8],
];

/**
 * Draw the interactive map. Returns { hit(x, y) } in CSS pixels:
 * a city within reach of the tap, or the world position of the tap.
 */
export function drawUaeMap(cv, overview, cities, selectedId) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // bounds in projected metres
  const outline = overview?.data?.outline?.length
    ? overview.data.outline.map((p) => { const out = []; for (let i = 0; i < p.length; i += 2) out.push([p[i], p[i + 1]]); return out; })
    : [FALLBACK_OUTLINE.map(([lon, lat]) => project(lon, lat))];
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const poly of outline) for (const [x, y] of poly) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  const pad = 24;
  const s = Math.min((W - pad * 2) / (maxx - minx), (H - pad * 2) / (maxy - miny));
  const ox = (W - (maxx - minx) * s) / 2, oy = (H - (maxy - miny) * s) / 2;
  const tp = (x, y) => [ox + (x - minx) * s, oy + (maxy - y) * s];

  // sea
  const sea = ctx.createLinearGradient(0, 0, W, H);
  sea.addColorStop(0, '#0a4d6e');
  sea.addColorStop(1, '#063047');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);
  // subtle waves
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let y = 10; y < H; y += 14) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x / 30 + y) * 2);
    ctx.stroke();
  }
  // land
  const landPath = new Path2D();
  for (const poly of outline) {
    poly.forEach(([x, y], i) => {
      const [a, b] = tp(x, y);
      if (i) landPath.lineTo(a, b);
      else landPath.moveTo(a, b);
    });
    landPath.closePath();
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  const land = ctx.createLinearGradient(0, 0, 0, H);
  land.addColorStop(0, '#f4e3c1');
  land.addColorStop(1, '#e2c792');
  ctx.fillStyle = land;
  ctx.fill(landPath);
  ctx.restore();
  // emirates tinted
  if (overview?.emirates?.length) {
    for (const e of overview.emirates) {
      const col = EMIRATE_COLORS[e.name] || '#999';
      for (const poly of e.polys) {
        ctx.beginPath();
        for (let i = 0; i < poly.length; i += 2) {
          const [a, b] = tp(poly[i], poly[i + 1]);
          i ? ctx.lineTo(a, b) : ctx.moveTo(a, b);
        }
        ctx.closePath();
        ctx.save();
        ctx.clip(landPath);
        ctx.fillStyle = `${col}33`;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = `${col}aa`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  // major roads
  if (overview) {
    for (const w of overview.data.ways) {
      const mw = w.type.startsWith('motorway');
      if (!mw && !w.type.startsWith('trunk')) continue;
      ctx.strokeStyle = mw ? 'rgba(232,112,42,0.9)' : 'rgba(200,140,60,0.7)';
      ctx.lineWidth = mw ? 1.8 : 1;
      ctx.beginPath();
      w.n.forEach((n, i) => {
        const [a, b] = tp(overview.x[n], -overview.z[n]);
        i ? ctx.lineTo(a, b) : ctx.moveTo(a, b);
      });
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(90,60,20,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke(landPath);

  // city pins
  const pins = cities.map((c) => {
    const [x, y] = project(c.lon, c.lat);
    const [a, b] = tp(x, y);
    return { c, a, b };
  });
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  // labels: selected first, then the rest, skipping any that would collide
  const placed = [];
  const order = [...pins].sort((p, q) => (q.c.id === selectedId) - (p.c.id === selectedId));
  const labelOf = new Map();
  for (const p of order) {
    const tw = ctx.measureText(p.c.name).width + 8;
    const cands = [[p.a + 10, p.b - 8], [p.a - 10 - tw, p.b - 8], [p.a - tw / 2, p.b - 24], [p.a - tw / 2, p.b + 9]];
    for (const [x, y] of cands) {
      const r = [x, y, x + tw, y + 16];
      if (x < 2 || x + tw > W - 2) continue;
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      placed.push(r);
      labelOf.set(p.c.id, r);
      break;
    }
  }
  for (const { c, a, b } of pins) {
    const sel = c.id === selectedId;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(a + 1, b + 2, sel ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(a, b, sel ? 9 : 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = sel ? 3 : 2;
    ctx.stroke();
    const r = labelOf.get(c.id);
    if (r) {
      ctx.fillStyle = sel ? c.color : 'rgba(20,20,30,0.85)';
      ctx.fillRect(r[0], r[1], r[2] - r[0], 16);
      ctx.fillStyle = sel ? '#111' : '#fff';
      ctx.fillText(c.name, r[0] + 4, r[1] + 12);
    }
  }
  return {
    hit(x, y) {
      let best = null, bd = 22 * 22;
      for (const p of pins) {
        const d = (p.a - x) ** 2 + (p.b - y) ** 2;
        if (d < bd) { bd = d; best = p.c; }
      }
      if (best) return { city: best };
      const X = minx + (x - ox) / s, Y = maxy - (y - oy) / s;
      return { X, Z: -Y, onLand: ctx.isPointInPath(landPath, x * dpr, y * dpr) };
    },
  };
}
