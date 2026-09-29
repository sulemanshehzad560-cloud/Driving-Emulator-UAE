// Cockpit for the interior camera: sculpted dashboard, digital instrument
// cluster behind a working steering wheel, centre navigation screen, door
// panels, A-pillars and headliner. Left-hand drive, as in the UAE.
import * as THREE from 'three';
import { styleDims } from './carFactory.js';

function canvasTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// stitched soft-touch leather grain, generated once
let grainTex = null;
function grain() {
  if (grainTex) return grainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  grainTex = new THREE.CanvasTexture(c);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.repeat.set(6, 6);
  return grainTex;
}

/** Side-view profile (z back = +, y up) extruded across the cabin width. */
function extrudeX(points, width, mat) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 8 });
  geo.rotateY(Math.PI / 2);
  geo.translate(-width / 2, 0, 0);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

export function buildInterior(style, mapCanvas, paint) {
  const d = styleDims(style);
  const g = new THREE.Group();
  const tall = style === 'suv' || style === 'boxy' || style === 'g63' || style === 'van' || style === 'pickup';
  const soft = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.82, bumpMap: grain(), bumpScale: 0.4 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x232021, roughness: 0.62, bumpMap: grain(), bumpScale: 0.3 });
  const piano = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.08, metalness: 0.2 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.22, metalness: 1 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.35, metalness: 0.15 });
  const lining = new THREE.MeshStandardMaterial({ color: 0x57524d, roughness: 0.95, side: THREE.DoubleSide });

  const W = d.W - 0.16;
  const belt = d.belt;
  const eyeY = belt + (tall ? 0.34 : 0.25);
  const eyeZ = d.screenZ + 1.3; // driver sits ~1.3 m behind the windscreen base
  const lipZ = eyeZ - 0.62; // rear edge of the dashboard
  const dashTopY = belt - 0.02;

  // bonnet seen through the windscreen
  if (paint) {
    const bonnetLen = Math.max(0.8, d.L / 2 + d.screenZ + 0.1);
    const bonnet = extrudeX([[d.screenZ, belt - 0.03], [d.screenZ - bonnetLen * 0.5, belt - 0.07], [d.screenZ - bonnetLen, belt - 0.16], [d.screenZ - bonnetLen, belt - 0.3], [d.screenZ, belt - 0.3]], d.W - 0.2, paint);
    g.add(bonnet);
  }

  // sculpted dashboard: long soft top from the windscreen to a rounded lip, then down to the knee bolster
  const dash = extrudeX([
    [d.screenZ, belt - 0.04], [d.screenZ + 0.25, dashTopY + 0.01], [lipZ - 0.12, dashTopY + 0.03], [lipZ - 0.02, dashTopY - 0.01],
    [lipZ + 0.02, dashTopY - 0.08], [lipZ + 0.01, dashTopY - 0.2], [lipZ + 0.12, dashTopY - 0.36], [lipZ + 0.1, dashTopY - 0.5], [d.screenZ, dashTopY - 0.5],
  ], W, soft);
  g.add(dash);
  // wood / metal accent strip across the dash face
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.035, 0.02), accent);
  strip.position.set(0, dashTopY - 0.13, lipZ + 0.035);
  g.add(strip);
  const stripAlu = new THREE.Mesh(new THREE.BoxGeometry(W, 0.006, 0.022), alu);
  stripAlu.position.set(0, dashTopY - 0.11, lipZ + 0.036);
  g.add(stripAlu);

  // widescreen digital cockpit: cluster behind the wheel + centre screen on one glass panel
  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 512;
  clusterCanvas.height = 200;
  const clusterTex = canvasTex(clusterCanvas);
  const panelY = dashTopY + 0.075;
  const panelZ = lipZ - 0.04;
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.164), new THREE.MeshBasicMaterial({ map: clusterTex, toneMapped: false }));
  cluster.position.set(-0.37, panelY, panelZ);
  cluster.rotation.x = -0.12;
  g.add(cluster);
  let screenTex = null;
  if (mapCanvas) screenTex = canvasTex(mapCanvas);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.21), new THREE.MeshBasicMaterial({ map: screenTex, color: screenTex ? 0xffffff : 0x0c1420, toneMapped: false }));
  screen.position.set(0.1, panelY, panelZ);
  screen.rotation.x = -0.12;
  g.add(screen);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.25, 0.015), piano);
  glass.position.set(-0.13, panelY, panelZ - 0.012);
  glass.rotation.x = -0.12;
  g.add(glass);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.02, 0.16), soft);
  hood.position.set(-0.13, panelY + 0.13, panelZ - 0.06);
  hood.rotation.x = -0.12;
  g.add(hood);

  // turbine air vents
  for (const x of [-0.72, 0.36, 0.62]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 8, 24), alu);
    ring.position.set(x, dashTopY - 0.07, lipZ + 0.03);
    g.add(ring);
    const blades = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), piano);
    blades.position.set(x, dashTopY - 0.07, lipZ + 0.028);
    g.add(blades);
  }
  // climate buttons row
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.016, 0.01), i === 3 ? alu : piano);
    b.position.set(-0.02 + i * 0.045, dashTopY - 0.2, lipZ + 0.1);
    g.add(b);
  }

  // centre console with gear selector and armrest
  const consoleM = extrudeX([[lipZ + 0.1, dashTopY - 0.25], [eyeZ + 0.2, belt - 0.33], [eyeZ + 0.2, belt - 0.6], [lipZ + 0.1, belt - 0.6]], 0.26, leather);
  consoleM.position.x = 0.1;
  g.add(consoleM);
  const selector = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 16), alu);
  selector.position.set(0.1, belt - 0.29, lipZ + 0.45);
  g.add(selector);

  // steering wheel: thick leather rim, three alloy spokes, emblem on the airbag
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.026, 14, 48), leather);
  wheel.add(rim);
  for (const a of [0, 2.2, -2.2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.036, 0.022), a === 0 ? leather : alu);
    const ang = a - Math.PI / 2;
    spoke.position.set(Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, 0);
    spoke.rotation.z = ang;
    wheel.add(spoke);
  }
  const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 28), leather);
  bag.rotation.x = Math.PI / 2;
  wheel.add(bag);
  const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 8, 24), alu);
  emblem.position.z = 0.027;
  wheel.add(emblem);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.025, 0.003), alu);
    arm.position.set(Math.cos(i * 2.094 + Math.PI / 2) * 0.0125, Math.sin(i * 2.094 + Math.PI / 2) * 0.0125, 0.027);
    arm.rotation.z = i * 2.094;
    wheel.add(arm);
  }
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 12), soft);
  column.rotation.x = Math.PI / 2;
  column.position.z = -0.16;
  const wheelMount = new THREE.Group();
  wheelMount.position.set(-0.37, eyeY - 0.3, eyeZ - 0.4);
  wheelMount.rotation.x = -0.42;
  wheelMount.add(wheel, column);
  // indicator / wiper stalks
  for (const s of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), piano);
    stalk.rotation.z = Math.PI / 2;
    stalk.position.set(s * 0.1, 0.02, -0.08);
    wheelMount.add(stalk);
  }
  g.add(wheelMount);

  // doors, pillars, headliner
  const roofY = d.roof - 0.03;
  for (const s of [-1, 1]) {
    const door = extrudeX([[lipZ - 0.1, belt + 0.01], [eyeZ + 0.8, belt + 0.01], [eyeZ + 0.8, belt - 0.6], [lipZ - 0.1, belt - 0.6]], 0.09, leather);
    door.position.x = s * (W / 2 + 0.02);
    g.add(door);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.5), soft);
    arm.position.set(s * (W / 2 - 0.05), belt - 0.2, eyeZ - 0.1);
    g.add(arm);
    const trimLine = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.9), alu);
    trimLine.position.set(s * (W / 2 - 0.03), belt - 0.06, eyeZ - 0.15);
    g.add(trimLine);
    // A-pillar from the windscreen base up to the roof edge, leaning back towards the driver
    const baseZ = d.screenZ + 0.02, topZ = d.screenZ + 0.72;
    const len = Math.hypot(roofY - belt, topZ - baseZ);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.075, len, 0.09), lining);
    pillar.position.set(s * (W / 2 - 0.03), (belt + roofY) / 2, (baseZ + topZ) / 2);
    pillar.rotation.x = Math.atan2(topZ - baseZ, roofY - belt);
    g.add(pillar);
    const pillarB = new THREE.Mesh(new THREE.BoxGeometry(0.07, d.roof - belt, 0.14), lining);
    pillarB.position.set(s * (W / 2 + 0.01), (d.roof + belt) / 2, eyeZ + 0.4);
    g.add(pillarB);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, 1.6), lining);
  head.position.set(0, roofY, d.screenZ + 0.72 + 0.8);
  g.add(head);
  // rear-view mirror
  const rvm = new THREE.Group();
  const rvmBody = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.075, 0.035), piano);
  const rvmStem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8), piano);
  rvmStem.position.y = 0.06;
  rvm.add(rvmBody, rvmStem);
  rvm.position.set(0, roofY - 0.1, d.screenZ + 0.74);
  g.add(rvm);

  g.userData = { wheel, eye: new THREE.Vector3(-0.37, eyeY, eyeZ), screenTex, clusterCanvas, clusterTex, rvm };
  return g;
}

/** Draw the digital instrument cluster (speed, rpm, gear, range, limit). */
export function drawCluster(ud, st) {
  const c = ud.clusterCanvas.getContext('2d');
  const W = 512, H = 200;
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#060b14');
  bg.addColorStop(1, '#0d1726');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const dial = (cx, v, max, color, label, text) => {
    const r = 78, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    c.lineWidth = 9;
    c.strokeStyle = 'rgba(255,255,255,0.1)';
    c.beginPath();
    c.arc(cx, 104, r, a0, a1);
    c.stroke();
    c.strokeStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.beginPath();
    c.arc(cx, 104, r, a0, a0 + (a1 - a0) * Math.min(1, Math.max(0, v / max)));
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.font = 'bold 44px Arial';
    c.fillText(text, cx, 118);
    c.fillStyle = '#8fb3d9';
    c.font = '15px Arial';
    c.fillText(label, cx, 142);
  };
  dial(100, st.kmh, 280, st.over ? '#ff4d5e' : '#38bdf8', 'km/h', String(Math.round(st.kmh)));
  dial(412, st.rpm, 7000, st.rpm > 6000 ? '#ff4d5e' : '#2dd4bf', 'x1000 rpm', (st.rpm / 1000).toFixed(1));
  // centre: gear, limit, road
  c.textAlign = 'center';
  c.fillStyle = '#ffc043';
  c.font = 'bold 40px Arial';
  c.fillText(st.gear, 256, 76);
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(256, 124, 24, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = '#e11d2a';
  c.stroke();
  c.fillStyle = '#111';
  c.font = 'bold 20px Arial';
  c.fillText(String(st.limit), 256, 131);
  c.fillStyle = '#9fb4cc';
  c.font = '13px Arial';
  c.fillText(`${st.temp}°C  ·  ${Math.round(st.fuel * 100)}%`, 256, 180);
  // indicator arrows
  const arrow = (x, dir, on) => {
    c.fillStyle = on ? '#22e06a' : 'rgba(255,255,255,0.12)';
    c.beginPath();
    c.moveTo(x, 30);
    c.lineTo(x - dir * 18, 18);
    c.lineTo(x - dir * 18, 42);
    c.closePath();
    c.fill();
  };
  arrow(206, 1, st.left);
  arrow(306, -1, st.right);
  if (st.lights) {
    c.fillStyle = st.lights === 2 ? '#60a5fa' : '#4ade80';
    c.font = 'bold 14px Arial';
    c.fillText(st.lights === 2 ? 'HIGH' : 'LIGHTS', 256, 160);
  }
  ud.clusterTex.needsUpdate = true;
}
