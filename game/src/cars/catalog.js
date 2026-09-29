// The garage line-up: detailed PBR models (see tools/fetch_cars.sh for the
// sources and licences). Brands and names are fictional: real manufacturer
// names, badges and designs are trademarks and would need a licence.

export const CARS = [
  {
    id: 'helix-ev', name: 'Helix EV Grand Tourer', brand: 'HELIX', cls: 'Electric Saloon', style: 'sedan',
    price: 0, topSpeed: 250, accel: 4.6, handling: 0.8, braking: 0.86, grip: 0.84, mass: 2150,
    paints: [0xd9dcdf, 0x0b0d10, 0x1d2b44, 0x7a0f14, 0x2f4f3a],
    // "FREE Concept Car 003" by Unity Fan (Sketchfab, free licence for use in games)
    model: { url: 'cars/helix.glb', front: '+z', hideFar: true, posedBounds: true, tireMat: '^Material\\.00[23]$', paint: ['Material.005'], glass: 'glass', brake: 'taillight_cover', hideMat: 'shadow' },
  },
  {
    id: 'sable-rs', name: 'Sable RS Coupé', brand: 'SABLE', cls: 'Sports Coupé', style: 'gt',
    price: 9000, topSpeed: 305, accel: 3.6, handling: 0.88, braking: 0.9, grip: 0.9, mass: 1620,
    paints: [0xb3121e, 0x0b0b0c, 0xe8e8ea, 0x1b3a8a, 0xf2b705],
    // "FREE Concept Car 004" by Unity Fan (Sketchfab, free licence for use in games)
    model: { url: 'cars/sable.glb', front: '+z', hideFar: true, pose: { clip: 'AllActions', time: 0 }, tireMat: 'rubber|tire', paint: ['body'], glass: 'glass', brake: 'taillight_cover', hideMat: 'shadow|Material\\.008' },
  },
  {
    id: 'atlas-r', name: 'Atlas R Desert Rover', brand: 'ATLAS', cls: 'Off-road Concept', style: 'suv',
    price: 14000, topSpeed: 250, accel: 4.2, handling: 0.72, braking: 0.8, grip: 0.82, mass: 2300,
    paints: [0xd4001a, 0x0b0b0c, 0xf2f2f2, 0x0a84ff, 0xffb000],
    // "FREE Concept Car 006" by Unity Fan (Sketchfab, free licence for use in games)
    model: { url: 'cars/atlas.glb', front: '+z', pose: { clip: 'Armature|ArmatureAction', time: 0 }, tireMat: 'wheel_nitto|rubber', paint: ['body'], glass: 'glass', head: 'headlights', brake: 'taillights_cover', hideMat: 'shadow' },
  },
  {
    id: 'nova-gt', name: 'Nova GT Coupé', brand: 'NOVA', cls: 'Grand Tourer', style: 'gt',
    price: 16000, topSpeed: 310, accel: 3.4, handling: 0.87, braking: 0.88, grip: 0.88, mass: 1640,
    paints: [0x8fb4e3, 0xe8e8ea, 0x0b0b0c, 0x7a0f14, 0x2f4f3a],
    // "FREE AI based ConceptCar 049" by Unity Fan (Sketchfab, free licence for use in games)
    model: { url: 'cars/nova.glb', front: '+z', tireMat: 'rubber|tire', paint: ['silver'], glass: 'glass', signal: 'turnlights', brake: 'taillights_cover', hideMat: 'shadow' },
  },
  {
    id: 'aurora-vision', name: 'Aurora Vision GT', brand: 'AURORA', cls: 'Electric Hypercar', style: 'super',
    price: 26000, topSpeed: 325, accel: 2.6, handling: 0.93, braking: 0.93, grip: 0.93, mass: 1690,
    paints: [0xa3101c, 0x0b0b0c, 0xe8e8ea, 0x1d3f8f, 0xd9a400],
    // full 3D model: "Car Concept" by Eric Chadwick / Darmstadt Graphics Group, CC BY 4.0 (logos removed)
    model: {
      url: 'cars/concept.glb', front: '+z', wheels: ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'],
      wheelParts: ['Rim', 'BrakeDisc', 'BrakePad'], paint: ['Paint 1 Carmine'], glass: 'Glass',
      head: 'Headlight', brake: 'Brakelight', signal: 'Signallight', plate: 'License', plain: ['Tireside'], hide: ['InteriorSteeringEmblem'], steering: '^InteriorSteering(Wheel|Handle|Emblem)',
    },
  },
  {
    id: 'vortex-s', name: 'Vortex S Silverline', brand: 'VORTEX', cls: 'Hypercar', style: 'super',
    price: 30000, topSpeed: 340, accel: 2.5, handling: 0.94, braking: 0.94, grip: 0.94, mass: 1450,
    paints: [0xc9ccd1, 0x0b0b0c, 0xb3121e, 0x1b3a8a, 0xf2b705],
    // "FREE Concept Car 025" by Unity Fan (Sketchfab, free licence for use in games)
    model: { url: 'cars/vortex.glb', front: '+z', tireMat: 'rubber|tire', paint: ['body_color_supra.002'], head: 'light', brake: 'taillights', hideMat: 'shadow' },
  },
  {
    id: 'zenith-x', name: 'Zenith X Track Edition', brand: 'ZENITH', cls: 'Track Hypercar', style: 'hyper',
    price: 40000, topSpeed: 355, accel: 2.4, handling: 0.95, braking: 0.95, grip: 0.95, mass: 1390,
    paints: [0x2dd4bf, 0xff4d00, 0xe8e8ea, 0x7c3aed, 0x0b0b0c],
    // "FREE AI based ConceptCar 050" by Unity Fan (Sketchfab, free licence for use in games)
    model: { url: 'cars/zenith.glb', front: '+z', tireMat: 'rubber|tire', paint: ['body'], glass: 'glass', head: 'lights', brake: 'taillights', hideMat: 'shadow' },
  },
];

// Traffic: light versions of the garage models (simplified by
// game/scripts/traffic-lods.mjs, see tools/fetch_cars.sh); buses and vans stay
// procedural. `len` is the model's length in metres (for spacing / collisions).
const HERO = {
  aurora: { model: 'traffic/hero-concept.glb', paintMat: 'Paint 1 Carmine', len: 4.36 },
  vortex: { model: 'traffic/hero-vortex.glb', paintMat: 'body_color_supra.002', len: 3.98 },
  nova: { model: 'traffic/hero-nova.glb', paintMat: 'silver', len: 4.4 },
  zenith: { model: 'traffic/hero-zenith.glb', paintMat: 'body', len: 4.37 },
};
const TAXI = { ...HERO.nova, style: 'sedan', paints: [0xf1e3c2] };

export const TRAFFIC_TYPES = [
  // Dubai taxis: cream body, roof colour varies by operator (red, pink = ladies' taxi, blue)
  { ...TAXI, taxi: true, taxiRoof: 0xc8102e, weight: 3, region: 'dubai' },
  { ...TAXI, taxi: true, taxiRoof: 0xe75480, weight: 0.7, region: 'dubai' },
  { ...TAXI, taxi: true, taxiRoof: 0x1f5fbf, weight: 0.8, region: 'dubai' },
  // Abu Dhabi taxis: silver with a yellow roof sign
  { ...TAXI, paints: [0xc7ccd1], taxi: true, taxiRoof: 0xf2c200, weight: 3, region: 'abudhabi' },
  { ...HERO.nova, style: 'gt', paints: [0xffffff, 0xc0c0c0, 0x1c1c1c, 0x8c8c8c, 0x1b2a41, 0x7a0e0e, 0xe8e3d6], weight: 7 },
  { ...HERO.aurora, style: 'super', paints: [0xffffff, 0x1c1c1c, 0xb9bcc0, 0x4a4a4a, 0x0e1a2e, 0x8a1c1c], weight: 5 },
  { ...HERO.vortex, style: 'super', paints: [0xc9ccd1, 0x0b0b0c, 0xb3121e, 0x1b3a8a, 0xffffff], weight: 3 },
  { ...HERO.zenith, style: 'hyper', paints: [0x2dd4bf, 0x0b0b0c, 0xe8e8ea, 0xff4d00], weight: 1.5 },
  { style: 'van', paints: [0xffffff, 0xe6e6e6, 0xf1e3c2], weight: 1.5 },
  { style: 'bus', paints: [0xd6001c], weight: 0.6, big: true },
];

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}
