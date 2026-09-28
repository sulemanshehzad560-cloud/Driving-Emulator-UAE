// Cockpit for the interior camera: dashboard, working steering wheel,
// A-pillars, and a centre infotainment screen that shows the live map.
import * as THREE from 'three';
import { styleDims } from './carFactory.js';

export function buildInterior(style, mapCanvas, paint) {
  const d = styleDims(style);
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.5, metalness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.35, metalness: 0.1 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 1 });
  const tall = style === 'suv' || style === 'boxy' || style === 'van';
  // eye point sits between the beltline and the roof, like a real seating position
  // the exterior shell is hidden in cockpit view, so the cabin is modelled here
  const eyeY = d.belt + (tall ? 0.3 : 0.22);
  const dashY = d.belt - 0.14; // dashboard top sits just under the beltline
  const eyeZ = d.screenZ + 1.25; // driver sits ~1.25 m behind the windscreen base
  const dashZ = eyeZ - 0.45; // rear edge of the dashboard
  const W = d.W - 0.2;

  const dashDepth = Math.max(0.5, dashZ - d.screenZ);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, dashDepth), leather);
  dash.position.set(0, dashY, dashZ - dashDepth / 2);
  // bonnet seen through the windscreen
  if (paint) {
    const bonnetLen = d.L / 2 + d.screenZ + 0.1;
    const bonnet = new THREE.Mesh(new THREE.BoxGeometry(d.W - 0.1, 0.06, Math.max(0.6, bonnetLen)), paint);
    bonnet.position.set(0, d.belt - 0.06, d.screenZ - Math.max(0.6, bonnetLen) / 2);
    bonnet.rotation.x = -0.035;
    g.add(bonnet);
  }
  // soft dash top that meets the windscreen
  const dashTop = new THREE.Mesh(new THREE.BoxGeometry(W, 0.04, 0.55), trimMat);
  dashTop.position.set(0, dashY + 0.11, dashZ - 0.6);
  g.add(dashTop);
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
  const roofY = d.roof - 0.04;
  for (const s of [-1, 1]) {
    // A-pillar from the windscreen base up to the roof edge
    const baseZ = d.screenZ + 0.05, topZ = d.screenZ + 0.75;
    const len = Math.hypot(roofY - d.belt, topZ - baseZ);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.07), pillarMat);
    pillar.position.set(s * (W / 2 - 0.02), (d.belt + roofY) / 2, (baseZ + topZ) / 2);
    pillar.rotation.x = Math.atan2(topZ - baseZ, roofY - d.belt); // lean the top back towards the driver
    g.add(pillar);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 2.0), leather);
    door.position.set(s * (W / 2 + 0.04), d.belt - 0.27, eyeZ - 0.2);
    g.add(door);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 2.0), alu);
    sill.position.set(s * (W / 2 + 0.03), d.belt + 0.01, eyeZ - 0.2);
    g.add(sill);
    const pillarB = new THREE.Mesh(new THREE.BoxGeometry(0.06, d.roof - d.belt, 0.12), pillarMat);
    pillarB.position.set(s * (W / 2 + 0.03), (d.roof + d.belt) / 2, eyeZ + 0.45);
    g.add(pillarB);
  }
  const lining = new THREE.Mesh(new THREE.BoxGeometry(W * 0.95, 0.03, 1.2), new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.95, side: THREE.DoubleSide }));
  lining.position.set(0, roofY, d.screenZ + 1.05 + 0.6);
  g.add(lining);
  // rear-view mirror housing
  const rvm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.03), pillarMat);
  rvm.position.set(0, roofY - 0.08, d.screenZ + 0.72);
  g.add(rvm);

  g.userData = { wheel, eye: new THREE.Vector3(-0.37, eyeY, eyeZ), screenTex, rvm };
  return g;
}
