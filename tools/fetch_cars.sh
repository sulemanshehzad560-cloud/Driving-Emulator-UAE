#!/usr/bin/env bash
# Downloads the licensed hero-car models and packs them for phones:
# textures resized to 2048 px WebP, geometry meshopt-compressed.
# These licences allow use inside the game but not re-hosting the raw files,
# so CI fetches them from their public sources on every build.
# Also builds light traffic versions next to it (<out-dir>/../traffic).
# Usage: tools/fetch_cars.sh <out-dir>   (needs curl, python3, node/npx)
set -euo pipefail
OUT="${1:-game/public/cars}"
WORK="$(mktemp -d)"
mkdir -p "$OUT"
GT="npx --yes @gltf-transform/cli@4"

pack() { # in out
  $GT resize "$1" "$WORK/a.glb" --width 2048 --height 2048 >/dev/null
  $GT webp "$WORK/a.glb" "$WORK/b.glb" >/dev/null
  $GT dedup "$WORK/b.glb" "$WORK/c.glb" >/dev/null
  $GT meshopt "$WORK/c.glb" "$2" >/dev/null
  echo "$(basename "$2"): $(du -h "$2" | cut -f1)"
}

# Khronos "Car Concept" — CC BY 4.0 (Eric Chadwick / Darmstadt Graphics Group)
curl -fsSL --retry 4 -o "$WORK/concept.glb" \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb
pack "$WORK/concept.glb" "$OUT/concept.glb"

# Unity Fan concept cars (Sketchfab, published as free/public-domain; licence file: Sketchfab Standard)
MIRROR="https://raw.githubusercontent.com/darkyboys/Drunk-Driving-Simulator/HEAD/assets/models/otherCC0/models/cars"
fetch_gltf() { # folder name -> local dir with scene.gltf + resources
  local d="$1" dst="$WORK/$1"
  mkdir -p "$dst"
  curl -fsSL --retry 4 -o "$dst/scene.gltf" "$MIRROR/$d/scene.gltf"
  python3 - "$dst" "$MIRROR/$d" <<'PY'
import json, os, subprocess, sys, urllib.parse
dst, base = sys.argv[1], sys.argv[2]
g = json.load(open(f'{dst}/scene.gltf'))
uris = [b['uri'] for b in g.get('buffers', []) if 'uri' in b] + [i['uri'] for i in g.get('images', []) if 'uri' in i]
for u in uris:
    p = os.path.join(dst, urllib.parse.unquote(u))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    subprocess.run(['curl', '-fsSL', '--retry', '4', '-o', p, f'{base}/{u}'], check=True)
PY
}
for pair in "vortex:free_concept_car_025__-_public_domain_cc0" "nova:free_ai_based_conceptcar_049_public_domain_cc0" \
            "zenith:free_ai_based_conceptcar_050_public_domain_cc0" "atlas:free_concept_car_006_-_public_domain_cc0" \
            "helix:free_concept_car_003_-_public_domain_cc0" "sable:free_concept_car_004_-_public_domain_cc0"; do
  name="${pair%%:*}"; folder="${pair#*:}"
  if fetch_gltf "$folder"; then pack "$WORK/$folder/scene.gltf" "$OUT/$name.glb" || echo "::warning::$name not packed"
  else echo "::warning::$name not downloaded — the game falls back to the procedural car"; fi
done

# traffic versions of the non-rigged models: simplified to ~45k triangles,
# 1024 px textures (needs `npm ci` in game/ for the gltf-transform libraries)
TRAFFIC="$(dirname "$OUT")/traffic"
mkdir -p "$TRAFFIC"
for name in concept vortex nova zenith; do
  [ -f "$OUT/$name.glb" ] || continue
  if node "$(dirname "$0")/../game/scripts/traffic-lods.mjs" "$OUT/$name.glb" "$WORK/lod.glb" 45000 +z \
    && $GT resize "$WORK/lod.glb" "$WORK/lod-a.glb" --width 1024 --height 1024 >/dev/null \
    && $GT webp "$WORK/lod-a.glb" "$WORK/lod-b.glb" >/dev/null \
    && $GT meshopt "$WORK/lod-b.glb" "$TRAFFIC/hero-$name.glb" >/dev/null; then
    echo "traffic/hero-$name.glb: $(du -h "$TRAFFIC/hero-$name.glb" | cut -f1)"
  else
    echo "::warning::traffic version of $name not built — procedural traffic car used instead"
  fi
done
rm -rf "$WORK"
