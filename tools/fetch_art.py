#!/usr/bin/env python3
"""Download CC0 photographic assets for UAE Drive and prepare them for phones.

* HDR skies (Poly Haven, CC0)       -> art/hdri/<slot>.hdr (1k), <slot>_2k.hdr, <slot>_4k.hdr
* PBR materials (ambientCG, CC0)    -> art/tex/<slot>_{color,normal,rough,ao}.jpg (1K, phones)
                                       art/tex2k/... (High) and art/tex4k/... (Ultra, road/ground)
The game picks the tier that matches the device's graphics preset.
Writes art/manifest.json describing what was obtained (missing items are
skipped; the game falls back to procedural textures for them).
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile

from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art'
UA = {'User-Agent': 'UAEDrive-asset-fetch/1.0 (github actions)'}

HDRIS = {
    'day': ['kloofendal_48d_partly_cloudy_puresky', 'qwantani_puresky', 'kloofendal_43d_clear_puresky', 'syferfontein_1d_clear_puresky'],
    'clear': ['kloofendal_43d_clear_puresky', 'qwantani_noon_puresky', 'syferfontein_0d_clear_puresky', 'qwantani_puresky'],
    'sunset': ['belfast_sunset_puresky', 'qwantani_sunset_puresky', 'kloofendal_misty_morning_puresky', 'spruit_sunrise'],
    'night': ['kloppenheim_02_puresky', 'satara_night', 'moonless_golf', 'dikhololo_night'],
    'overcast': ['kloofendal_overcast_puresky', 'overcast_soil_puresky', 'kloofendal_overcast'],
    # extra times of day
    'dawn': ['spruit_sunrise', 'kloofendal_misty_morning_puresky', 'qwantani_dawn_puresky', 'sunflowers_puresky'],
    'golden': ['qwantani_late_afternoon_puresky', 'kloofendal_48d_partly_cloudy_puresky', 'belfast_sunset_puresky'],
    'dusk': ['qwantani_dusk_2_puresky', 'qwantani_dusk_1_puresky', 'belfast_sunset_puresky', 'spruit_sunrise'],
    'clearnight': ['qwantani_moon_noon_puresky', 'kloppenheim_02_puresky', 'satara_night', 'moonlit_golf'],
}
HDRI_TIERS = ['1k', '2k', '4k']
# materials that cover most of the screen get 4K for Ultra
HD4K = {'asphalt', 'asphalt_worn', 'pavers', 'sand', 'grass', 'concrete'}

# slot: (preferred ambientCG ids, search query, size)
MATERIALS = {
    'asphalt': (['Asphalt026A', 'Asphalt025C', 'Asphalt012', 'Asphalt010'], 'asphalt', 1024),
    'asphalt_worn': (['Asphalt031', 'Asphalt023S', 'Asphalt021'], 'asphalt', 1024),
    'pavers': (['PavingStones130', 'PavingStones092', 'PavingStones126A', 'PavingStones115C'], 'paving stones', 1024),
    'concrete': (['Concrete034', 'Concrete032', 'Concrete022', 'Concrete044A'], 'concrete', 512),
    'sand': (['Ground054', 'Ground037', 'Ground080', 'Ground033'], 'sand', 1024),
    'grass': (['Grass004', 'Grass001', 'Grass005'], 'grass', 512),
    'plaster': (['Plaster001', 'Plaster003', 'Plaster002'], 'plaster', 512),
    'metal': (['Metal032', 'CorrugatedSteel005A', 'Metal009'], 'corrugated', 512),
    'tiles': (['Tiles074', 'Tiles101', 'Tiles012'], 'tiles', 512),
}
FACADES = 20  # take the most popular ambientCG facade materials


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print(f'   retry {i + 1} {url}: {e}', flush=True)
            time.sleep(3 * (i + 1))
    return None


def get_json(url):
    b = get(url)
    return json.loads(b) if b else None


def fetch_hdri(slot, ids, manifest):
    for hid in ids:
        info = get_json(f'https://api.polyhaven.com/files/{hid}')
        try:
            urls = {t: info['hdri'][t]['hdr']['url'] for t in HDRI_TIERS if t in info['hdri']}
        except (TypeError, KeyError):
            continue
        if '1k' not in urls:
            continue
        files = {}
        for tier, url in urls.items():
            data = get(url)
            if not data:
                continue
            name = f'{slot}.hdr' if tier == '1k' else f'{slot}_{tier}.hdr'
            with open(os.path.join(OUT, 'hdri', name), 'wb') as f:
                f.write(data)
            files[tier] = f'hdri/{name}'
            print(f'HDRI {slot} {tier}: {hid} ({len(data) / 1e6:.1f} MB)', flush=True)
        if '1k' not in files:
            continue
        manifest['hdri'][slot] = {'file': files['1k'], 'tiers': files, 'source': f'https://polyhaven.com/a/{hid}', 'id': hid}
        return True
    print(f'HDRI {slot}: none available', flush=True)
    return False


def acg_search(query=None, ids=None, limit=6):
    params = {'type': 'Material', 'include': 'downloadData,tagData', 'limit': str(limit), 'sort': 'Popular'}
    if ids:
        params['id'] = ','.join(ids)
    if query:
        params['q'] = query
    data = get_json('https://ambientcg.com/api/v2/full_json?' + urllib.parse.urlencode(params))
    return (data or {}).get('foundAssets', [])


def acg_zip_link(asset, res='1K'):
    try:
        for d in asset['downloadFolders']['default']['downloadFiletypeCategories']['zip']['downloads']:
            if d.get('attribute') == f'{res}-JPG':
                return d['downloadLink']
    except (KeyError, TypeError):
        pass
    return None


def save_maps(slot, asset_id, zbytes, size, manifest, section, folder='tex', key='files'):
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    names = z.namelist()
    pick = {}
    for n in names:
        low = n.lower()
        if low.endswith('_color.jpg'):
            pick['color'] = n
        elif low.endswith('_normalgl.jpg'):
            pick['normal'] = n
        elif low.endswith('_roughness.jpg'):
            pick['rough'] = n
        elif low.endswith('_ambientocclusion.jpg'):
            pick['ao'] = n
    if 'color' not in pick:
        return False
    files = {}
    for kind, n in pick.items():
        im = Image.open(io.BytesIO(z.read(n)))
        im = im.convert('RGB' if kind in ('color', 'normal') else 'L')
        if max(im.size) > size:
            im = im.resize((size, size), Image.LANCZOS)
        os.makedirs(os.path.join(OUT, folder), exist_ok=True)
        out = os.path.join(OUT, folder, f'{slot}_{kind}.jpg')
        im.save(out, quality=86 if kind != 'normal' else 92, optimize=True)
        files[kind] = f'{folder}/{slot}_{kind}.jpg'
    entry = manifest[section].setdefault(slot, {'source': f'https://ambientcg.com/view?id={asset_id}', 'id': asset_id})
    entry[key] = files
    print(f'material {slot} [{folder}]: {asset_id} {sorted(files)}', flush=True)
    return True


def fetch_tiers(slot, asset, manifest, section):
    """High-detail versions of a chosen material: 2K for High, 4K for Ultra (large surfaces only)."""
    tiers = [('2K', 2048, 'tex2k', 'files2k')]
    if slot in HD4K:
        tiers.append(('4K', 4096, 'tex4k', 'files4k'))
    for res, size, folder, key in tiers:
        link = acg_zip_link(asset, res)
        zb = get(link) if link else None
        if zb:
            save_maps(slot, asset['assetId'], zb, size, manifest, section, folder, key)


def fetch_material(slot, ids, query, size, manifest):
    candidates = acg_search(ids=ids, limit=len(ids)) or []
    order = {i: k for k, i in enumerate(ids)}
    candidates.sort(key=lambda a: order.get(a.get('assetId'), 99))
    if not candidates:
        candidates = acg_search(query=query, limit=4)
    for a in candidates:
        link = acg_zip_link(a)
        if not link:
            continue
        zb = get(link)
        if zb and save_maps(slot, a['assetId'], zb, size, manifest, 'materials'):
            fetch_tiers(slot, a, manifest, 'materials')
            return True
    print(f'material {slot}: none available', flush=True)
    return False


def fetch_facades(manifest):
    found = acg_search(query='facade', limit=40)
    n = 0
    for a in found:
        if n >= FACADES:
            break
        if not a.get('assetId', '').lower().startswith('facade'):
            continue
        link = acg_zip_link(a)
        zb = get(link) if link else None
        if zb and save_maps(f'facade{n}', a['assetId'], zb, 1024, manifest, 'facades'):
            fetch_tiers(f'facade{n}', a, manifest, 'facades')
            n += 1
    print(f'facades: {n}', flush=True)


def main():
    os.makedirs(os.path.join(OUT, 'hdri'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    manifest = {'license': 'CC0 1.0 (Poly Haven, ambientCG)', 'hdri': {}, 'materials': {}, 'facades': {}}
    for slot, ids in HDRIS.items():
        fetch_hdri(slot, ids, manifest)
    for slot, (ids, q, size) in MATERIALS.items():
        fetch_material(slot, ids, q, size, manifest)
    fetch_facades(manifest)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(OUT) for fn in fns)
    print(f'art assets: {len(manifest["hdri"])} HDRIs, {len(manifest["materials"])} materials, '
          f'{len(manifest["facades"])} facades, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
