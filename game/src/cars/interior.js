// Cockpit for the interior camera: dashboard, working steering wheel,
// A-pillars, and a centre infotainment screen that shows the live map.
import * as THREE from 'three';
import { styleDims } from './carFactory.js';

export function buildInterior(style, mapCanvas) {
  const d = styleDims(style);
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.5, metalness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.35, metalness: 0.1 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 1 });
  const tall = style === 'suv' || style === 'boxy' || style === 'van';
  const low = style === 'super' || style === 'hyper' || style === 'gt';
  const eyeY = tall ? 1.55 : low ? 0.98 : 1.18;
  const dashY = eyeY - 0.38;
  const dashZ = -0.55;
  const W = d.W - 0.2;

  const dash = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, 1.1), leather);
  dash.position.set(0, dashY, dashZ - 0.45);
  g.add(dash);
  const woodStrip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.02), wood);
  woodStrip.position.set(0, dashY - 0.03, dashZ + 0.11);
  g.add(woodStrip);
  // instrument binnacle (glowing)
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), new THREE.MeshBasicMaterial({ color: 0x0a1a2e }));
  cluster.position.set(-0.37, dashY + 0.17, dashZ + 0.04);
  cluster.rotation.x = -0.25;
  g.add(cluster);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.25), leather);
  hood.position.set(-0.37, dashY + 0.27, dashZ - 0.03);
  g.add(hood);

  // centre screen with live map
  let screenTex = null;
  if (mapCanvas) {
    screenTex = new THREE.CanvasTexture(mapCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ map: screenTex, color: screenTex ? 0xffffff : 0x0c1420 }));
  screen.position.set(0.12, dashY + 0.2, dashZ + 0.02);
  screen.rotation.x = -0.2;
  g.add(screen);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.23, 0.02), trimMat);
  bezel.position.set(0.12, dashY + 0.2, dashZ + 0.005);
  bezel.rotation.x = -0.2;
  g.add(bezel);
  // AC vents
  for (const x of [-0.05, 0.3, 0.72]) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), alu);
    vent.rotation.x = Math.PI / 2;
    vent.position.set(x, dashY + 0.02, dashZ + 0.12);
    g.add(vent);
  }
  // centre console
  const centre = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.25, 0.9), leather);
  centre.position.set(0.12, dashY - 0.35, dashZ + 0.35);
  g.add(centre);

  // steering wheel (left-hand drive, as in the UAE)
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 10, 36), leather);
  wheel.add(rim);
  for (const a of [0, Math.PI / 2 + 0.3, -Math.PI / 2 - 0.3]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), alu);
    spoke.position.set(Math.cos(a - Math.PI / 2) * 0.09, Math.sin(a - Math.PI / 2) * 0.09, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 20), trimMat);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const wheelMount = new THREE.Group();
  wheelMount.position.set(-0.37, dashY - 0.02, dashZ + 0.3);
  wheelMount.rotation.x = -0.35;
  wheelMount.add(wheel);
  g.add(wheelMount);

  // A-pillars and roof lining frame the view like a real cabin
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const roofY = eyeY + (tall ? 0.35 : 0.25);
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.06), pillarMat);
    pillar.position.set(s * (W / 2 + 0.02), (dashY + roofY) / 2 + 0.05, dashZ - 0.55);
    pillar.rotation.x = -0.55;
    pillar.rotation.z = s * 0.12;
    g.add(pillar);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 1.8), leather);
    door.position.set(s * (W / 2 + 0.04), dashY - 0.12, 0.4);
    g.add(door);
  }
  const lining = new THREE.Mesh(new THREE.BoxGeometry(W, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 0.95, side: THREE.DoubleSide }));
  lining.position.set(0, roofY, 0.25);
  g.add(lining);
  // rear-view mirror housing
  const rvm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.03), pillarMat);
  rvm.position.set(0, roofY - 0.1, dashZ - 0.25);
  g.add(rvm);

  g.userData = { wheel, eye: new THREE.Vector3(-0.37, eyeY, 0.05), screenTex, rvm };
  return g;
}
