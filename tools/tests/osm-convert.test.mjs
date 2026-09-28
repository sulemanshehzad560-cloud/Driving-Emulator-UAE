// Unit test for the OSM -> game map converter using a synthetic Overpass reply.
import assert from 'node:assert/strict';
import { convertOsm, parseMaxspeed, overpassQuery } from '../../game/src/world/osm.js';
import { RoadGraph } from '../../game/src/world/roadGraph.js';

const lat = 25.2, lon = 55.27;
const d = (m) => m / 111320; // metres -> degrees (approx)
let id = 1;
const el = [];
const node = (dx, dy, tags) => {
  const n = { type: 'node', id: id++, lat: lat + d(dy), lon: lon + d(dx) / Math.cos((lat * Math.PI) / 180) };
  if (tags) n.tags = tags;
  el.push(n);
  return n.id;
};
// a cross junction with signals, a motorway with a camera and a toll gantry
const a = node(-300, 0), c = node(0, 0, { highway: 'traffic_signals' }), b = node(300, 0);
const n1 = node(0, -300), n2 = node(0, 300);
const m1 = node(-400, 200), cam = node(0, 200, { highway: 'speed_camera' }), m2 = node(400, 200);
const toll = node(100, 200, { highway: 'toll_gantry', name: 'Salik Al Barsha' });
const fuel = node(50, 50, { amenity: 'fuel', name: 'ENOC' });
const far = node(5000, 5000);
el.push({ type: 'way', id: 900, nodes: [a, c, b], tags: { highway: 'primary', name: 'Al Wasl Road', maxspeed: '80', lanes: '4' } });
el.push({ type: 'way', id: 901, nodes: [n1, c, n2], tags: { highway: 'residential', name: '2nd Street' } });
el.push({ type: 'way', id: 902, nodes: [m1, cam, toll, m2], tags: { highway: 'motorway', name: 'Sheikh Zayed Road', maxspeed: '100 km/h' } });
el.push({ type: 'way', id: 903, nodes: [a, far], tags: { highway: 'secondary' } });
el.push({ type: 'way', id: 904, nodes: [n1, n2], tags: { highway: 'service', service: 'parking_aisle' } });
const b1 = node(50, -50), b2 = node(80, -50), b3 = node(80, -80), b4 = node(50, -80);
el.push({ type: 'way', id: 905, nodes: [b1, b2, b3, b4, b1], tags: { building: 'yes', 'building:levels': '10' } });

const map = convertOsm({ elements: el }, { id: 't', name: 'Test', lat, lon, radius: 1000 });
assert.equal(map.roads.length, 4, 'parking aisle skipped, far way clipped to its in-radius part');
const wasl = map.roads.find((r) => r.name === 'Al Wasl Road');
assert.equal(wasl.maxspeed, 80);
assert.equal(wasl.lanes, 4);
assert.equal(map.roads.find((r) => r.name === '2nd Street').maxspeed, 40, 'UAE residential default');
const szr = map.roads.find((r) => r.name === 'Sheikh Zayed Road');
assert.equal(szr.maxspeed, 100);
assert.equal(szr.oneway, true, 'motorways are one-way carriageways');
assert.equal(map.signals.length, 1);
assert.equal(map.cameras.length, 1);
assert.equal(map.tolls.length, 1);
assert.equal(map.rest.length, 1);
assert.equal(map.buildings.length, 1);
assert.equal(map.buildings[0].h, 34);
assert.ok(Math.abs(map.nodes[map.roads[0].n[1]][0]) < 1, 'junction node near origin');
assert.equal(parseMaxspeed('50 mph'), 80);
assert.ok(overpassQuery(lat, lon, 1000).includes('speed_camera'));

const g = new RoadGraph(map);
assert.ok(g.isJunction(map.roads[0].n[1]), 'shared node is a junction');
const route = g.route(wasl.n[0], wasl.n[2]);
assert.deepEqual(route, wasl.n);
const near = g.nearest(0, 0);
assert.ok(near && near.dist < 1);
console.log('osm-convert tests passed');
