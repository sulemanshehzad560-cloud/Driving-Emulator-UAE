#!/usr/bin/env python3
"""Rebuild an OSM XML file from the bundled city packs so the tile pipeline
and the streaming engine can be tested offline (no Geofabrik download).
Adds a Dubai coastline, a UAE country boundary and two emirate boundaries."""
import json
import math
import os
import sys
from xml.sax.saxutils import quoteattr

HERE = os.path.dirname(os.path.abspath(__file__))
MAPS = os.path.join(HERE, 'fixtures', 'maps')
out = sys.argv[1] if len(sys.argv) > 1 else 'test.osm'

nid = [1_000_000]
wid = [1_000_000]
lines_nodes = []
lines_ways = []
lines_rel = []


def new_node(lat, lon, tags=None):
    nid[0] += 1
    t = ''.join(f'<tag k={quoteattr(k)} v={quoteattr(str(v))}/>' for k, v in (tags or {}).items())
    lines_nodes.append(f'<node id="{nid[0]}" version="1" lat="{lat:.7f}" lon="{lon:.7f}">{t}</node>' if t else f'<node id="{nid[0]}" version="1" lat="{lat:.7f}" lon="{lon:.7f}"/>')
    return nid[0]


def new_way(nodes, tags):
    wid[0] += 1
    nd = ''.join(f'<nd ref="{n}"/>' for n in nodes)
    t = ''.join(f'<tag k={quoteattr(k)} v={quoteattr(str(v))}/>' for k, v in tags.items())
    lines_ways.append(f'<way id="{wid[0]}" version="1">{nd}{t}</way>')
    return wid[0]


def ring(coords):
    ids = [new_node(la, lo) for la, lo in coords]
    return ids + [ids[0]]


for fn in sorted(os.listdir(MAPS)):
    if not fn.endswith('.json') or fn == 'index.json':
        continue
    m = json.load(open(os.path.join(MAPS, fn)))
    lat0, lon0 = m['center']['lat'], m['center']['lon']
    kx = 111320 * math.cos(math.radians(lat0))
    ll = lambda x, y: (lat0 + y / 110574, lon0 + x / kx)
    ids = {}
    sig = set(m.get('signals', []))
    stops = set(m.get('stops', []))
    for i, p in enumerate(m['nodes']):
        if p is None:
            continue
        tags = {'highway': 'traffic_signals'} if i in sig else {'highway': 'stop'} if i in stops else None
        ids[i] = new_node(*ll(*p), tags)
    for r in m['roads']:
        tags = {'highway': r['type'], 'lanes': r['lanes'], 'maxspeed': r['maxspeed']}
        if r['name']:
            tags['name'] = r['name']
        tags['oneway'] = 'yes' if r['oneway'] else 'no'
        new_way([ids[n] for n in r['n'] if n in ids], tags)
    for b in m['buildings']:
        new_way(ring([ll(x, y) for x, y in b['p']]), {'building': 'yes', 'height': b['h']})
    for a in m.get('areas', []):
        new_way(ring([ll(x, y) for x, y in a['p']]), {'natural': 'water'} if a['kind'] == 'water' else {'leisure': 'park'})
    for x, y in m.get('cameras', []):
        new_node(*ll(x, y), {'highway': 'speed_camera', 'maxspeed': '100'})
    for t in m.get('tolls', []):
        new_node(*ll(t['x'], t['y']), {'highway': 'toll_gantry', 'name': t['name'] or 'Salik'})
    for r in m.get('rest', []):
        new_node(*ll(r['x'], r['y']), {'amenity': 'fuel', 'name': r['name'] or 'ENOC'})
    new_node(lat0, lon0, {'place': 'suburb', 'name': m['name']})

# Gulf coastline RAK -> Dubai -> Abu Dhabi, drawn NE to SW (land on the left = south-east)
coast = [(26.400, 56.080), (25.300, 55.320), (25.245, 55.262), (25.205, 55.235), (25.160, 55.200), (25.120, 55.160), (25.085, 55.130), (25.050, 55.090), (25.000, 55.030), (24.560, 54.360), (24.000, 53.500)]
new_way([new_node(la, lo) for la, lo in coast], {'natural': 'coastline'})


def boundary(rel_id, poly, tags):
    w = new_way(ring(poly), {})
    t = ''.join(f'<tag k={quoteattr(k)} v={quoteattr(str(v))}/>' for k, v in tags.items())
    lines_rel.append(f'<relation id="{rel_id}" version="1"><member type="way" ref="{w}" role="outer"/>{t}</relation>')


uae = [(22.6, 51.5), (24.3, 51.5), (26.1, 55.7), (26.1, 56.4), (24.6, 56.4), (22.6, 55.2)]
boundary(1, uae, {'type': 'boundary', 'boundary': 'administrative', 'admin_level': '2', 'ISO3166-1': 'AE', 'name': 'UAE'})
boundary(2, [(24.95, 54.85), (25.40, 55.15), (25.35, 55.60), (24.80, 55.60)], {'type': 'boundary', 'boundary': 'administrative', 'admin_level': '4', 'name:en': 'Dubai'})
boundary(3, [(24.0, 54.0), (24.95, 54.85), (24.80, 55.60), (23.8, 55.9)], {'type': 'boundary', 'boundary': 'administrative', 'admin_level': '4', 'name:en': 'Abu Dhabi'})

with open(out, 'w') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="uaedrive-test">\n')
    f.write('\n'.join(lines_nodes) + '\n' + '\n'.join(lines_ways) + '\n' + '\n'.join(lines_rel) + '\n</osm>\n')
print(f'wrote {out}: {len(lines_nodes)} nodes, {len(lines_ways)} ways')
