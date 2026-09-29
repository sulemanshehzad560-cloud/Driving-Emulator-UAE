// Fictional vehicles inspired by German luxury saloons/SUVs and supercars.
// Names are deliberately generic: real manufacturer names, badges and designs
// are trademarks and would need a licence before they can ship in a game.

export const CARS = [
  {
    id: 'kaiser-s', name: 'Kaiser S-Line Executive', brand: 'KAISER', cls: 'Luxury Saloon', style: 'sedan',
    price: 0, topSpeed: 250, accel: 5.2, handling: 0.72, braking: 0.8, grip: 0.8, mass: 2100,
    paints: [0x0b0d10, 0xc7ccd1, 0x1d2b44, 0xf2f2f0, 0x5b1320],
  },
  {
    id: 'kaiser-c', name: 'Kaiser C-Coupé', brand: 'KAISER', cls: 'Sports Coupé', style: 'coupe',
    price: 3500, topSpeed: 270, accel: 4.3, handling: 0.8, braking: 0.85, grip: 0.84, mass: 1750,
    paints: [0xb3b8bd, 0x0c2a66, 0xd4001a, 0x101010, 0xe8e3d6],
  },
  {
    id: 'kaiser-g', name: 'Kaiser G-Line 4x4', brand: 'KAISER', cls: 'Off-road Icon', style: 'boxy',
    price: 6000, topSpeed: 220, accel: 4.8, handling: 0.6, braking: 0.72, grip: 0.76, mass: 2560,
    paints: [0x151515, 0xf4f4f4, 0x4e5a3a, 0x7d7f80, 0xc9b08a],
  },
  {
    id: 'kaiser-g63', name: 'Kaiser G 63 Night Edition', brand: 'KAISER', cls: 'Performance 4x4', style: 'g63',
    price: 9000, topSpeed: 240, accel: 4.5, handling: 0.64, braking: 0.76, grip: 0.8, mass: 2560,
    paints: [0x0b0b0c, 0x2b2e31, 0xf2f2f2, 0x4a5a3c, 0x7a0f14],
  },
  {
    id: 'kaiser-gle', name: 'Kaiser GL Grand SUV', brand: 'KAISER', cls: 'Luxury SUV', style: 'suv',
    price: 5000, topSpeed: 240, accel: 5.4, handling: 0.66, braking: 0.76, grip: 0.78, mass: 2400,
    paints: [0x2f3439, 0xffffff, 0x0e1a2e, 0x8a1c1c, 0xa7a9ac],
  },
  {
    id: 'kaiser-gt', name: 'Kaiser GT Black Edition', brand: 'KAISER', cls: 'Grand Tourer', style: 'gt',
    price: 12000, topSpeed: 318, accel: 3.2, handling: 0.88, braking: 0.9, grip: 0.9, mass: 1650,
    paints: [0x0a0a0a, 0xf7c600, 0x3a4a5c, 0xe8e8e8, 0x16632f],
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
    id: 'falcon-gt', name: 'Falcon Desert GT', brand: 'FALCON', cls: 'Supercar', style: 'super',
    price: 20000, topSpeed: 330, accel: 2.9, handling: 0.9, braking: 0.92, grip: 0.92, mass: 1480,
    paints: [0xff5a00, 0x0f5132, 0xffffff, 0x101820, 0x9b111e],
  },
  {
    id: 'arrow-rs', name: 'Arrow RS Superveloce', brand: 'ARROW', cls: 'V12 Supercar', style: 'super',
    price: 32000, topSpeed: 350, accel: 2.7, handling: 0.92, braking: 0.94, grip: 0.94, mass: 1520,
    paints: [0x9bd000, 0xffd400, 0x1a1a1a, 0xe10600, 0x6e7b8b],
  },
  {
    id: 'nitro-hyper', name: 'Nitro Hypercar X', brand: 'NITRO', cls: 'Hypercar', style: 'hyper',
    price: 55000, topSpeed: 400, accel: 2.3, handling: 0.95, braking: 0.97, grip: 0.96, mass: 1380,
    paints: [0x0047ab, 0xc0c0c0, 0x000000, 0xff2d55, 0xffffff],
  },
];

export const TRAFFIC_TYPES = [
  // Dubai taxis: cream body, roof colour varies by operator (red, pink = ladies' taxi, blue)
  { style: 'sedan', paints: [0xf1e3c2], taxi: true, taxiRoof: 0xc8102e, weight: 3, region: 'dubai' },
  { style: 'sedan', paints: [0xf1e3c2], taxi: true, taxiRoof: 0xe75480, weight: 0.7, region: 'dubai' },
  { style: 'sedan', paints: [0xf1e3c2], taxi: true, taxiRoof: 0x1f5fbf, weight: 0.8, region: 'dubai' },
  // Abu Dhabi taxis: silver with a yellow roof sign
  { style: 'sedan', paints: [0xc7ccd1], taxi: true, taxiRoof: 0xf2c200, weight: 3, region: 'abudhabi' },
  { style: 'sedan', paints: [0xffffff, 0xc0c0c0, 0x222222, 0x8c8c8c, 0x1b2a41, 0x7a0e0e, 0xe8e3d6], weight: 7 },
  { style: 'suv', paints: [0xffffff, 0x1c1c1c, 0xb9bcc0, 0x4a4a4a, 0x6b5b45, 0x0e1a2e], weight: 6 },
  { style: 'boxy', paints: [0xffffff, 0x151515, 0x4e5a3a], weight: 1 },
  { style: 'g63', paints: [0x0b0b0c, 0xf2f2f2, 0x2b2e31], weight: 1 },
  { style: 'pickup', paints: [0xffffff, 0xd9d9d9, 0x8a8a8a], weight: 2 },
  { style: 'van', paints: [0xffffff, 0xe6e6e6, 0xf1e3c2], weight: 2 },
  { style: 'coupe', paints: [0xd4001a, 0x0c2a66, 0x101010, 0xffd400], weight: 1 },
  { style: 'bus', paints: [0xd6001c], weight: 0.6, big: true },
];

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}
