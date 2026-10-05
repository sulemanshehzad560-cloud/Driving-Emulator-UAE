#!/usr/bin/env bash
# Downloads the licensed hero-car models and packs each one twice:
#   <out>/<car>.glb     phones (Low/Medium): textures 1024 px WebP, meshopt geometry
#   <out>/hd/<car>.glb  High/Ultra: original full-resolution textures, meshopt geometry
# These licences allow use inside the game but not re-hosting the raw files,
# so CI fetches them from their public sources on every build.
# Usage: tools/fetch_cars.sh <out-dir>   (needs curl, python3, node/npx)
set -euo pipefail
OUT="${1:-game/public/cars}"
WORK="$(mktemp -d)"
mkdir -p "$OUT"
GT="npx --yes @gltf-transform/cli@4"

mkdir -p "$OUT/hd"
pack() { # in out
  $GT resize "$1" "$WORK/a.glb" --width 1024 --height 1024 >/dev/null
  $GT webp "$WORK/a.glb" "$WORK/b.glb" >/dev/null
  $GT dedup "$WORK/b.glb" "$WORK/c.glb" >/dev/null
  $GT meshopt "$WORK/c.glb" "$2" >/dev/null
  echo "$(basename "$2"): $(du -h "$2" | cut -f1)"
  # HD: keep every texture at its original resolution
  local hd="$(dirname "$2")/hd/$(basename "$2")"
  $GT dedup "$1" "$WORK/h.glb" >/dev/null
  $GT meshopt "$WORK/h.glb" "$hd" >/dev/null
  echo "hd/$(basename "$2"): $(du -h "$hd" | cut -f1)"
}

# Khronos "Car Concept" — CC BY 4.0 (Eric Chadwick / Darmstadt Graphics Group)
curl -fsSL --retry 4 -o "$WORK/concept.glb" \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb
pack "$WORK/concept.glb" "$OUT/concept.glb"

# Unity Fan concept cars (Sketchfab, published as free/public-domain; licence file: Sketchfab Standard)
MIRROR="https://raw.githubusercontent.com/darkyboys/Drunk-Driving-Simulator/HEAD/assets/models/otherCC0/models/cars"
fetch_gltf() { # folder name [base url] -> local dir with scene.gltf + resources
  local d="$1" base="${2:-$MIRROR/$1}" dst="$WORK/$1"
  mkdir -p "$dst"
  curl -fsSL --retry 4 -o "$dst/scene.gltf" "$base/scene.gltf"
  python3 - "$dst" "$base" <<'PY'
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
            "zenith:free_ai_based_conceptcar_050_public_domain_cc0" "atlas:free_concept_car_006_-_public_domain_cc0"; do
  name="${pair%%:*}"; folder="${pair#*:}"
  if fetch_gltf "$folder"; then pack "$WORK/$folder/scene.gltf" "$OUT/$name.glb" || echo "::warning::$name not packed"
  else echo "::warning::$name not downloaded — the game falls back to the procedural car"; fi
done
# more Unity Fan cars from other public mirrors (Concept Car 037: CC BY 4.0; 038 / 040: Sketchfab free licence)
for spec in "meridian|c037|https://raw.githubusercontent.com/captain-woof/threejs-tutorial-2022/HEAD/public/models/car" \
            "orion|c038|https://raw.githubusercontent.com/PassiDel/cgvr-track/HEAD/web-view/js/img/car" \
            "corsa|c040|https://raw.githubusercontent.com/Nitesh-K1/Car-Render/HEAD/public/models/car"; do
  IFS='|' read -r name folder base <<<"$spec"
  if fetch_gltf "$folder" "$base"; then pack "$WORK/$folder/scene.gltf" "$OUT/$name.glb" || echo "::warning::$name not packed"
  else echo "::warning::$name not downloaded — the game falls back to the procedural car"; fi
done
du -sh "$OUT" "$OUT/hd"
rm -rf "$WORK"
