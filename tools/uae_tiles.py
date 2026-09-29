#!/usr/bin/env python3
"""Build the UAE Drive world from an OpenStreetMap extract.

Input : an .osm.pbf covering the UAE (e.g. Geofabrik GCC states, cut to the
        UAE bounding box with `osmium extract`).
Output: <out>/tiles/<tx>_<ty>.json   1 km x 1 km world tiles
        <out>/overview.json          nationwide data (major-road graph for
                                     GPS, emirates, places, tile index)
        <out>/landmask.png           200 m land/sea raster for far terrain

Coordinates are metres in a sinusoidal projection centred on the UAE
(x = east, y = north). Roads keep their OSM node ids; where a road crosses a
tile border a synthetic node (negative id) is inserted at exactly the same
position in both tiles, so neighbouring tiles join seamlessly when streamed.

Map data (c) OpenStreetMap contributors, ODbL 1.0.
"""
import argparse
import gzip
import json
import math
import os
import re
import struct
import sys
import time
import zlib
from collections import defaultdict

import osmium
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import polygonize, unary_union
from shapely.prepared import prep

LAT0, LON0 = 24.8, 54.8
TILE = 1000.0
KY = 110574.0
KX0 = 111320.0

ROAD_TYPES = {
    'motorway': (9, 4, 120), 'trunk': (8, 3, 100), 'primary': (7, 3, 80), 'secondary': (6, 2, 60),
    'tertiary': (5, 2, 60), 'motorway_link': (4, 1, 80), 'trunk_link': (4, 1, 60), 'primary_link': (4, 1, 60),
    'secondary_link': (4, 1, 40), 'tertiary_link': (4, 1, 40), 'unclassified': (3, 1, 40),
    'residential': (3, 1, 40), 'living_street': (2, 1, 25), 'service': (1, 1, 25),
}
MAJOR = {'motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'secondary'}

AREA_KINDS = [
    ('water', lambda t: t.get('natural') == 'water' or 'water' in t or t.get('waterway') == 'riverbank' or t.get('landuse') in ('reservoir', 'basin')),
    ('mangrove', lambda t: t.get('wetland') == 'mangrove' or (t.get('natural') == 'wetland')),
    ('beach', lambda t: t.get('natural') == 'beach'),
    ('golf', lambda t: t.get('leisure') == 'golf_course'),
    ('pitch', lambda t: t.get('leisure') in ('pitch', 'stadium', 'track')),
    ('park', lambda t: t.get('leisure') in ('park', 'garden', 'playground') or t.get('landuse') in ('grass', 'recreation_ground', 'village_green', 'meadow', 'cemetery')),
    ('farm', lambda t: t.get('landuse') in ('farmland', 'orchard', 'plant_nursery', 'forest') or t.get('natural') == 'wood'),
    ('parking', lambda t: t.get('amenity') == 'parking' and t.get('parking', 'surface') == 'surface'),
    ('sand', lambda t: t.get('natural') in ('sand', 'scrub', 'bare_rock')),
]


def project(lon, lat):
    return ((lon - LON0) * KX0 * math.cos(math.radians(lat)), (lat - LAT0) * KY)


def unproject(x, y):
    lat = y / KY + LAT0
    return (x / (KX0 * math.cos(math.radians(lat))) + LON0, lat)


def parse_speed(v):
    if not v:
        return 0
    m = re.match(r'\s*(\d+(?:\.\d+)?)\s*(mph)?', v, re.I)
    if not m:
        return 0
    n = float(m.group(1))
    return round(n * 1.609 if m.group(2) else n)


def r1(v):
    return round(v, 1)


def tile_of(x, y):
    return (math.floor(x / TILE), math.floor(y / TILE))


# ----------------------------------------------------------------- reading

EMIRATE_KEYS = [('abu dhabi', 'Abu Dhabi'), ('dubai', 'Dubai'), ('sharjah', 'Sharjah'), ('ajman', 'Ajman'),
                ('umm', 'Umm Al Quwain'), ('ras', 'Ras Al Khaimah'), ('fujair', 'Fujairah')]


def emirate_name(raw):
    """Canonical English name of one of the seven emirates ('' for anything else, e.g. Oman's governorates)."""
    low = raw.lower().replace('-', ' ')
    if 'governorate' in low:
        return ''
    for key, name in EMIRATE_KEYS:
        if key in low:
            return name
    return ''


class Data:
    def __init__(self):
        self.roads = []  # (way_id, tags, [(node_id, x, y)])
        self.points = []  # (kind, x, y, node_id, extra)
        self.buildings = []  # (id, polygon, height, min_height, colour, kind)
        self.areas = []  # (kind, polygon)
        self.coast = []  # LineString
        self.places = []  # (name, kind, x, y)
        self.country = None
        self.emirates = []  # (name, polygon)


def area_polygons(a):
    polys = []
    for outer in a.outer_rings():
        try:
            shell = [project(n.lon, n.lat) for n in outer]
            holes = [[project(n.lon, n.lat) for n in inner] for inner in a.inner_rings(outer)]
            p = Polygon(shell, holes)
            if not p.is_valid:
                p = p.buffer(0)
            if not p.is_empty:
                polys.append(p)
        except (osmium.InvalidLocationError, ValueError):
            continue
    return polys


def building_height(t, oid):
    h = parse_speed(t.get('height')) or 0
    if not h and t.get('building:levels'):
        try:
            h = float(t.get('building:levels').split(';')[0]) * 3.3 + 1.5
        except ValueError:
            h = 0
    if not h:
        kind = t.get('building')
        rnd = ((oid * 2654435761) % 1000) / 1000
        h = {'house': 7, 'villa': 8, 'detached': 7, 'residential': 12, 'apartments': 24, 'commercial': 14,
             'retail': 8, 'industrial': 10, 'warehouse': 10, 'mosque': 14, 'hotel': 40, 'office': 30,
             'school': 10, 'hospital': 18, 'garage': 4, 'roof': 5, 'hut': 4, 'shed': 4}.get(kind, 0)
        if not h:
            h = 6 + rnd * 18
        else:
            h *= 0.85 + rnd * 0.3
    return min(h, 830)


def read(pbf, log):
    d = Data()
    t0 = time.time()
    fp = osmium.FileProcessor(pbf).with_locations().with_areas()
    count = 0
    for o in fp:
        count += 1
        if count % 2_000_000 == 0:
            log(f'  {count:,} objects, {time.time() - t0:.0f}s')
        if o.is_node():
            t = o.tags
            if not t:
                continue
            hw = t.get('highway')
            kind = None
            extra = {}
            if hw in ('traffic_signals', 'stop', 'give_way'):
                kind = 'signal' if hw == 'traffic_signals' else 'stop'
            elif hw == 'speed_camera':
                kind = 'camera'
                extra['ms'] = parse_speed(t.get('maxspeed'))
            elif hw == 'toll_gantry' or (t.get('barrier') == 'toll_booth'):
                kind = 'toll'
                extra['name'] = t.get('name:en') or t.get('name') or t.get('operator') or ''
            elif t.get('amenity') == 'fuel' or hw in ('services', 'rest_area'):
                kind = 'fuel' if t.get('amenity') == 'fuel' else 'rest'
                extra['name'] = t.get('name:en') or t.get('brand') or t.get('name') or ''
            elif hw == 'bus_stop':
                kind = 'bus'
            elif hw == 'street_lamp':
                kind = 'lamp'
            elif t.get('natural') == 'tree' or t.get('natural') == 'palm':
                kind = 'tree'
            elif t.get('place') in ('city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter', 'island'):
                x, y = project(o.location.lon, o.location.lat)
                d.places.append((t.get('name:en') or t.get('name') or '', t.get('place'), r1(x), r1(y)))
                continue
            if kind:
                x, y = project(o.location.lon, o.location.lat)
                d.points.append((kind, x, y, o.id, extra))
        elif o.is_way():
            t = o.tags
            hw = t.get('highway')
            if hw in ROAD_TYPES and t.get('area') != 'yes':
                if hw == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through', 'emergency_access'):
                    continue
                if t.get('access') in ('private', 'no') or t.get('construction') or t.get('disused'):
                    continue
                try:
                    pts = [(n.ref, *project(n.lon, n.lat)) for n in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                if len(pts) >= 2:
                    tags = {k: t.get(k) for k in ('name', 'name:en', 'ref', 'lanes', 'oneway', 'maxspeed', 'junction', 'bridge', 'tunnel', 'layer', 'surface') if t.get(k)}
                    tags['highway'] = hw
                    d.roads.append((o.id, tags, pts))
            elif t.get('natural') == 'coastline':
                try:
                    pts = [project(n.lon, n.lat) for n in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                if len(pts) >= 2:
                    d.coast.append(LineString(pts))
        elif o.is_area():
            t = o.tags
            if 'building' in t and t.get('building') not in ('no',) and not t.get('building:part'):
                h = building_height(t, o.id)
                mh = parse_speed(t.get('min_height')) or 0
                colour = t.get('building:colour') or t.get('colour') or ''
                for p in area_polygons(o):
                    if p.area >= 15:
                        d.buildings.append((o.id, p, h, mh, colour, t.get('building')))
                continue
            if t.get('boundary') == 'administrative':
                lvl = t.get('admin_level')
                if lvl == '2' and (t.get('ISO3166-1') == 'AE' or t.get('ISO3166-1:alpha2') == 'AE'):
                    d.country = unary_union(area_polygons(o))
                elif lvl == '4' and o.from_way() is False:
                    name = emirate_name(t.get('name:en') or t.get('name') or '')
                    polys = area_polygons(o) if name else None
                    if polys:
                        d.emirates.append((name, unary_union(polys)))
                continue
            for kind, test in AREA_KINDS:
                if test(t):
                    for p in area_polygons(o):
                        if p.area > 50:
                            d.areas.append((kind, p))
                    break
    log(f'read {count:,} objects in {time.time() - t0:.0f}s: {len(d.roads):,} roads, {len(d.buildings):,} buildings, '
        f'{len(d.areas):,} areas, {len(d.points):,} points, {len(d.coast):,} coastline ways, {len(d.emirates)} emirates')
    return d


# ----------------------------------------------------------------- sea

def build_sea(coast, bounds, log):
    """Polygonise coastline + bounding box; faces on the right of the
    coastline (OSM convention: land on the left) are sea."""
    if not coast:
        return []
    t0 = time.time()
    frame = box(*bounds)
    lines = [c for c in coast if c.intersects(frame)]
    merged = unary_union(lines + [frame.exterior])
    faces = list(polygonize(merged))
    segs = []
    for c in lines:
        cs = list(c.coords)
        for i in range(len(cs) - 1):
            segs.append((cs[i], cs[i + 1]))
    seg_lines = [LineString(s) for s in segs]
    tree = STRtree(seg_lines)
    sea = []
    for f in faces:
        if not frame.contains(f.representative_point()):
            continue
        p = f.representative_point()
        idx = tree.nearest(p)
        (ax, ay), (bx, by) = segs[idx]
        # which side of the nearest coastline segment is the face on?
        cross = (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)
        if cross < 0:  # right-hand side -> water
            sea.append(f)
    log(f'sea: {len(faces)} faces, {len(sea)} sea polygons ({time.time() - t0:.0f}s)')
    return sea


# ----------------------------------------------------------------- tiling

class Tile:
    __slots__ = ('nodes', 'node_ids', 'roads', 'points', 'buildings', 'areas', 'sea', 'land', 'emirate')

    def __init__(self):
        self.nodes = {}  # id -> (x, y)
        self.roads = []
        self.points = []
        self.buildings = []
        self.areas = []
        self.sea = []
        self.emirate = ''


def split_road(way_id, pts):
    """Insert nodes where the polyline crosses tile borders and split it into
    per-tile pieces. Returns [(tile, [(id, x, y), ...]), ...]."""
    dense = [pts[0]]
    for i in range(len(pts) - 1):
        (ida, ax, ay), (idb, bx, by) = pts[i], pts[i + 1]
        cuts = []
        for axis, a, b in ((0, ax, bx), (1, ay, by)):
            lo, hi = min(a, b), max(a, b)
            k = math.floor(lo / TILE) + 1
            while k * TILE < hi:
                t = (k * TILE - a) / (b - a)
                if 0 < t < 1:
                    cuts.append(t)
                k += 1
        cuts.sort()
        for j, t in enumerate(cuts[:15]):
            nid = -(((way_id * 2048) + min(i, 2047)) * 16 + j)
            dense.append((nid, ax + (bx - ax) * t, ay + (by - ay) * t))
        dense.append(pts[i + 1])
    pieces = []
    cur_tile, cur = None, []
    for i in range(len(dense) - 1):
        a, b = dense[i], dense[i + 1]
        tl = tile_of((a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
        if tl != cur_tile:
            if len(cur) >= 2:
                pieces.append((cur_tile, cur))
            cur_tile, cur = tl, [a]
        cur.append(b)
    if len(cur) >= 2:
        pieces.append((cur_tile, cur))
    return pieces


def road_record(way_id, tags, node_idx):
    hw = tags['highway']
    rank, def_lanes, def_speed = ROAD_TYPES[hw]
    ow = tags.get('oneway')
    oneway = ow in ('yes', '1', 'true', '-1') or tags.get('junction') in ('roundabout', 'circular') or \
        ((hw == 'motorway' or hw.endswith('_link')) and ow != 'no')
    try:
        lanes = int(float(str(tags.get('lanes', '0')).split(';')[0]))
    except ValueError:
        lanes = 0
    if not lanes:
        lanes = max(1, math.ceil(def_lanes / 1.5)) if oneway else def_lanes
    rec = {
        'w': way_id,
        'name': tags.get('name:en') or tags.get('name') or tags.get('ref') or '',
        'type': hw,
        'lanes': min(lanes, 7),
        'oneway': oneway,
        'maxspeed': parse_speed(tags.get('maxspeed')) or def_speed,
        'n': node_idx if ow != '-1' else list(reversed(node_idx)),
    }
    if tags.get('ref'):
        rec['ref'] = tags['ref']
    if tags.get('bridge') and tags['bridge'] != 'no':
        rec['bridge'] = 1
    if tags.get('tunnel') and tags['tunnel'] != 'no':
        rec['tunnel'] = 1
    if tags.get('junction') == 'roundabout':
        rec['rb'] = 1
    return rec


def ring_coords(ring, ox, oy):
    cs = list(ring.coords)[:-1]
    return [v for x, y in cs for v in (r1(x - ox), r1(y - oy))]


def poly_record(p, ox, oy):
    rec = {'p': ring_coords(p.exterior, ox, oy)}
    holes = [ring_coords(h, ox, oy) for h in p.interiors if len(h.coords) >= 4]
    if holes:
        rec['ho'] = holes
    return rec


def iter_polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]


def clip_to_tiles(poly, simplify=0.0):
    minx, miny, maxx, maxy = poly.bounds
    out = []
    for tx in range(math.floor(minx / TILE), math.floor(maxx / TILE) + 1):
        for ty in range(math.floor(miny / TILE), math.floor(maxy / TILE) + 1):
            cell = box(tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE)
            if not poly.intersects(cell):
                continue
            part = poly if cell.contains(poly) else poly.intersection(cell)
            for p in iter_polys(part):
                if simplify:
                    p = p.simplify(simplify, preserve_topology=True)
                if p.area > 20:
                    out.append(((tx, ty), p))
    return out


def build(d, out, log, keep_outside=False):
    t0 = time.time()
    tiles = defaultdict(Tile)
    country = prep(d.country.buffer(2500)) if d.country is not None else None
    inside = (lambda x, y: country.contains(Point(x, y))) if (country is not None and not keep_outside) else (lambda x, y: True)

    # roads
    overview_ways = []
    for way_id, tags, pts in d.roads:
        mid = pts[len(pts) // 2]
        if not inside(mid[1], mid[2]):
            continue
        for tl, piece in split_road(way_id, pts):
            T = tiles[tl]
            idx = []
            for nid, x, y in piece:
                T.nodes[nid] = (x, y)
                idx.append(nid)
            T.roads.append(road_record(way_id, tags, idx))
        if tags['highway'] in MAJOR:
            overview_ways.append((way_id, tags, pts))
    log(f'roads tiled: {len(tiles):,} tiles ({time.time() - t0:.0f}s)')

    # points (signals etc. keep their node id so they attach to roads)
    for kind, x, y, nid, extra in d.points:
        if not inside(x, y):
            continue
        tl = tile_of(x, y)
        if kind in ('signal', 'stop'):
            # attach to whichever tile(s) use this node
            if nid in tiles[tl].nodes:
                tiles[tl].points.append((kind, x, y, nid, extra))
            continue
        tiles[tl].points.append((kind, x, y, nid, extra))

    # buildings -> tile of centroid (not clipped: a building belongs to one tile)
    for bid, p, h, mh, colour, kind in d.buildings:
        c = p.centroid
        if not inside(c.x, c.y):
            continue
        tl = tile_of(c.x, c.y)
        tiles[tl].buildings.append((bid, p.simplify(0.25, preserve_topology=True), h, mh, colour, kind))
    log(f'buildings placed ({time.time() - t0:.0f}s)')

    content = set(tiles.keys())
    # areas clipped to tiles that already have content (or neighbours)
    near = set()
    for tx, ty in content:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                near.add((tx + dx, ty + dy))
    for kind, p in d.areas:
        c = p.representative_point()
        if not inside(c.x, c.y):
            continue
        for tl, part in clip_to_tiles(p, 0.5):
            if tl in near:
                tiles[tl].areas.append((kind, part))
    log(f'areas clipped ({time.time() - t0:.0f}s)')

    # sea
    all_x = [t[0] for t in content] or [0]
    all_y = [t[1] for t in content] or [0]
    bounds = ((min(all_x) - 20) * TILE, (min(all_y) - 20) * TILE, (max(all_x) + 21) * TILE, (max(all_y) + 21) * TILE)  # same frame as the land mask
    sea_polys = build_sea(d.coast, bounds, log)
    sea_tiles = set()
    for tx, ty in content:
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                sea_tiles.add((tx + dx, ty + dy))
    for sp in sea_polys:
        for tl, part in clip_to_tiles(sp, 1.0):
            if tl in sea_tiles:
                tiles[tl].sea.append(part)
    log(f'sea clipped ({time.time() - t0:.0f}s)')

    # emirate of each tile
    em_tree = STRtree([p for _, p in d.emirates]) if d.emirates else None
    for (tx, ty), T in tiles.items():
        if em_tree is None:
            continue
        c = Point((tx + 0.5) * TILE, (ty + 0.5) * TILE)
        hits = em_tree.query(c, predicate='intersects')
        if len(hits):
            T.emirate = d.emirates[int(hits[0])][0]

    # write tiles
    tdir = os.path.join(out, 'tiles')
    os.makedirs(tdir, exist_ok=True)
    index = []
    total = 0
    for (tx, ty), T in sorted(tiles.items()):
        ox, oy = tx * TILE, ty * TILE
        ids = list(T.nodes.keys())
        pos = {nid: i for i, nid in enumerate(ids)}
        rec = {
            't': [tx, ty],
            'e': T.emirate,
            'ids': ids,
            'np': [v for nid in ids for v in (r1(T.nodes[nid][0] - ox), r1(T.nodes[nid][1] - oy))],
            'roads': [{**r, 'n': [pos[n] for n in r['n']]} for r in T.roads],
            'signals': [pos[nid] for k, x, y, nid, e in T.points if k == 'signal' and nid in pos],
            'stops': [pos[nid] for k, x, y, nid, e in T.points if k == 'stop' and nid in pos],
            'cameras': [[r1(x - ox), r1(y - oy), e.get('ms', 0)] for k, x, y, nid, e in T.points if k == 'camera'],
            'tolls': [{'x': r1(x - ox), 'y': r1(y - oy), 'name': e.get('name', '')} for k, x, y, nid, e in T.points if k == 'toll'],
            'rest': [{'x': r1(x - ox), 'y': r1(y - oy), 'kind': k, 'name': e.get('name', '')} for k, x, y, nid, e in T.points if k in ('fuel', 'rest')],
            'bus': [[r1(x - ox), r1(y - oy)] for k, x, y, nid, e in T.points if k == 'bus'],
            'trees': [[r1(x - ox), r1(y - oy)] for k, x, y, nid, e in T.points if k == 'tree'][:400],
            'buildings': [],
            'areas': [],
            'sea': [poly_record(p, ox, oy) for p in T.sea],
        }
        for bid, p, h, mh, colour, kind in T.buildings:
            for part in iter_polys(p):
                b = poly_record(part, ox, oy)
                b['h'] = round(h, 1)
                if mh:
                    b['mh'] = mh
                if colour:
                    b['c'] = colour
                if kind and kind != 'yes':
                    b['k'] = kind
                b['id'] = bid
                rec['buildings'].append(b)
        for kind, p in T.areas:
            a = poly_record(p, ox, oy)
            a['k'] = kind
            rec['areas'].append(a)
        path = os.path.join(tdir, f'{tx}_{ty}.json')
        with open(path, 'w') as f:
            json.dump(rec, f, separators=(',', ':'))
        size = os.path.getsize(path)
        total += size
        index.append([tx, ty, len(T.roads), len(T.buildings), size])
    log(f'wrote {len(index):,} tiles, {total / 1e6:.1f} MB ({time.time() - t0:.0f}s)')
    return tiles, index, overview_ways, sea_polys


def write_overview(d, tiles, index, overview_ways, sea_polys, out, log):
    # major-road graph for nationwide GPS: keep junction nodes, simplify the rest
    use = defaultdict(int)
    for _, _, pts in overview_ways:
        for nid, _, _ in pts:
            use[nid] += 1
        use[pts[0][0]] += 1
        use[pts[-1][0]] += 1
    nodes = {}
    ways = []
    for way_id, tags, pts in overview_ways:
        line = LineString([(x, y) for _, x, y in pts])
        keep = [0]
        last = pts[0]
        for i in range(1, len(pts) - 1):
            nid, x, y = pts[i]
            if use[nid] > 1 or math.hypot(x - last[1], y - last[2]) > 250:
                keep.append(i)
                last = pts[i]
        keep.append(len(pts) - 1)
        seq = []
        for i in keep:
            nid, x, y = pts[i]
            nodes[nid] = (r1(x), r1(y))
            seq.append(nid)
        rec = road_record(way_id, tags, seq)
        ways.append({'name': rec['name'], 'type': rec['type'], 'oneway': rec['oneway'], 'maxspeed': rec['maxspeed'], 'n': rec['n'], 'ref': tags.get('ref', '')})
    ids = list(nodes.keys())
    pos = {nid: i for i, nid in enumerate(ids)}
    places = [{'name': n, 'kind': k, 'x': x, 'y': y} for n, k, x, y in d.places if n and k in ('city', 'town', 'suburb', 'village', 'island')]
    outline = []
    if d.country is not None:
        for p in iter_polys(d.country.simplify(300)):
            outline.append([v for x, y in list(p.exterior.coords)[:-1] for v in (round(x), round(y))])
    emirates = []
    for name, p in d.emirates:
        polys = [[v for x, y in list(q.exterior.coords)[:-1] for v in (round(x), round(y))] for q in iter_polys(p.simplify(400))]
        c = p.representative_point()
        emirates.append({'name': name, 'polys': polys, 'x': round(c.x), 'y': round(c.y)})
    ov = {
        'projection': {'lat0': LAT0, 'lon0': LON0, 'tile': TILE, 'type': 'sinusoidal'},
        'tiles': index,
        'nodes': [v for nid in ids for v in nodes[nid]],
        'ways': [{**w, 'n': [pos[n] for n in w['n']]} for w in ways],
        'places': places,
        'outline': outline,
        'emirates': emirates,
    }
    with open(os.path.join(out, 'overview.json'), 'w') as f:
        json.dump(ov, f, separators=(',', ':'))
    log(f'overview: {len(ways):,} major ways, {len(ids):,} nodes, {len(places)} places, '
        f'{os.path.getsize(os.path.join(out, "overview.json")) / 1e6:.1f} MB')
    write_landmask(d, sea_polys, index, out, log)


def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def write_landmask(d, sea_polys, index, out, log):
    """Greyscale raster (white = land, black = sea) at 200 m for far terrain."""
    if not index:
        return
    cell = 200.0
    xs = [t[0] for t in index]
    ys = [t[1] for t in index]
    minx, miny = (min(xs) - 20) * TILE, (min(ys) - 20) * TILE
    maxx, maxy = (max(xs) + 21) * TILE, (max(ys) + 21) * TILE
    w = int((maxx - minx) / cell)
    h = int((maxy - miny) / cell)
    scale = 1
    while w / scale > 4096 or h / scale > 4096:
        scale += 1
    w, h, cell = int(w / scale), int(h / scale), cell * scale
    sea = unary_union(sea_polys) if sea_polys else None
    rows = []
    for j in range(h):
        y = maxy - (j + 0.5) * cell  # row 0 = north
        row = bytearray(b'\xff' * w)
        if sea is not None:
            # scanline: intersect the row with the sea and paint the covered cells
            hit = sea.intersection(LineString([(minx, y), (minx + w * cell, y)]))
            for seg in getattr(hit, 'geoms', [hit]):
                if seg.is_empty or seg.geom_type != 'LineString':
                    continue
                xs_ = [c[0] for c in seg.coords]
                i0 = max(0, int(math.ceil((min(xs_) - minx) / cell - 0.5)))
                i1 = min(w - 1, int(math.floor((max(xs_) - minx) / cell - 0.5)))
                for i in range(i0, i1 + 1):
                    row[i] = 0
        rows.append(row)
    write_png(os.path.join(out, 'landmask.png'), w, h, rows)
    with open(os.path.join(out, 'landmask.json'), 'w') as f:
        json.dump({'minx': minx, 'miny': miny, 'maxx': minx + w * cell, 'maxy': maxy, 'w': w, 'h': h, 'cell': cell}, f)
    log(f'landmask {w}x{h} at {cell:.0f} m')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pbf')
    ap.add_argument('out')
    ap.add_argument('--keep-outside', action='store_true', help='do not clip to the UAE border (tests)')
    args = ap.parse_args()
    log = lambda m: print(m, flush=True)
    os.makedirs(args.out, exist_ok=True)
    d = read(args.pbf, log)
    if d.country is None and d.emirates:
        # national boundary missing from the extract: the seven emirates together are the country
        d.country = unary_union([p for _, p in d.emirates]).buffer(0)
        log('country outline rebuilt from the emirates')
    tiles, index, overview_ways, sea = build(d, args.out, log, args.keep_outside or d.country is None)
    write_overview(d, tiles, index, overview_ways, sea, args.out, log)


if __name__ == '__main__':
    main()
