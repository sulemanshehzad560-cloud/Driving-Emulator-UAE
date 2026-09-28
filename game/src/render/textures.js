// Procedurally generated textures (no image assets needed -> tiny APK).
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function noise(ctx, w, h, base, variance, count) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * variance;
    const l = Math.max(0, Math.min(255, 128 + v));
    ctx.fillStyle = `rgba(${l},${l},${l},${0.05 + Math.random() * 0.08})`;
    const s = 1 + Math.random() * 2.5;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

function tex(c, repeat = true, anisotropy = 4) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = {};

export function asphaltTexture() {
  if (cache.asphalt) return cache.asphalt;
  const [c, ctx] = canvas(256, 256);
  noise(ctx, 256, 256, '#3a3c40', 180, 9000);
  // subtle tyre tracks
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(40, 0, 50, 256);
  ctx.fillRect(166, 0, 50, 256);
  return (cache.asphalt = tex(c));
}

export function sandTexture() {
  if (cache.sand) return cache.sand;
  const [c, ctx] = canvas(512, 512);
  noise(ctx, 512, 512, '#d9b98a', 120, 30000);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(160,120,70,${0.04 + Math.random() * 0.05})`;
    ctx.lineWidth = 4 + Math.random() * 10;
    ctx.beginPath();
    const y = Math.random() * 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + 30 * Math.random(), 340, y - 30 * Math.random(), 512, y);
    ctx.stroke();
  }
  return (cache.sand = tex(c));
}

export function pavementTexture() {
  if (cache.pavement) return cache.pavement;
  const [c, ctx] = canvas(128, 128);
  noise(ctx, 128, 128, '#b8b2a6', 80, 2500);
  ctx.strokeStyle = 'rgba(90,85,80,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  return (cache.pavement = tex(c));
}

export function grassTexture() {
  if (cache.grass) return cache.grass;
  const [c, ctx] = canvas(256, 256);
  noise(ctx, 256, 256, '#4f8a3a', 160, 14000);
  return (cache.grass = tex(c));
}

/** Facade for regular buildings: warm stone with window grid. u = 1 per 12 m, v = 1 per 3.5 m floor. */
export function facadeTextures() {
  if (cache.facade) return cache.facade;
  const W = 256, H = 64;
  const [c, ctx] = canvas(W, H);
  noise(ctx, W, H, '#e9e1d2', 60, 1200);
  const [e, ex] = canvas(W, H);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 64;
    ctx.fillStyle = '#2d3a44';
    ctx.fillRect(x, 16, 44, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, 16, 44, 6);
    ctx.fillStyle = '#cfc6b5';
    ctx.fillRect(x - 2, 50, 48, 4);
    if (Math.random() < 0.55) {
      ex.fillStyle = Math.random() < 0.5 ? '#ffd9a0' : '#fff1d0';
      ex.fillRect(x, 16, 44, 34);
    }
  }
  return (cache.facade = { map: tex(c), emissive: tex(e) });
}

/** Glass curtain wall for towers. */
export function glassTextures() {
  if (cache.glass) return cache.glass;
  const W = 256, H = 64;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#5f8fae');
  g.addColorStop(0.5, '#9cc3d8');
  g.addColorStop(1, '#46708e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#20303c';
  for (let i = 0; i < W; i += 32) ctx.fillRect(i, 0, 3, H);
  ctx.fillRect(0, H - 6, W, 6);
  const [e, ex] = canvas(W, H);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i += 32) {
    if (Math.random() < 0.45) {
      ex.fillStyle = Math.random() < 0.3 ? '#6f8aa6' : '#a8885a';
      ex.fillRect(i + 5, 10, 22, H - 24);
    }
  }
  return (cache.glass = { map: tex(c), emissive: tex(e) });
}

export function speedSignTexture(speed) {
  const key = 'speed' + speed;
  if (cache[key]) return cache[key];
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d0121b';
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = `bold ${speed >= 100 ? 44 : 54}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(speed), 64, 68);
  return (cache[key] = tex(c, false));
}

export function stopSignTexture() {
  if (cache.stop) return cache.stop;
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#c8101a';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
  }
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('STOP', 64, 60);
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText('قف', 64, 92);
  return (cache.stop = tex(c, false));
}

export function salikTexture() {
  if (cache.salik) return cache.salik;
  const [c, ctx] = canvas(512, 64);
  ctx.fillStyle = '#0a4f9e';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TOLL GATE  •  بوابة تعرفة', 256, 34);
  return (cache.salik = tex(c, false));
}

export function roadNameTexture(text) {
  const key = 'name:' + text;
  if (cache[key]) return cache[key];
  const [c, ctx] = canvas(512, 96);
  ctx.fillStyle = '#0b6b3a';
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 84);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.length > 26 ? text.slice(0, 25) + '…' : text, 256, 50);
  return (cache[key] = tex(c, false));
}

/** Soft radial glow sprite for lights / headlight flares. */
export function glowTexture() {
  if (cache.glow) return cache.glow;
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (cache.glow = tex(c, false));
}
