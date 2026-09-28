#!/usr/bin/env bash
# Build the full-UAE world (tiles + overview + land mask) from OpenStreetMap.
# Requires: curl, osmium-tool, python3 with `pip install osmium shapely`.
# Usage: tools/build_world.sh <output-dir>
set -euo pipefail
OUT="${1:-game/public/world}"
WORK="${WORK:-$(mktemp -d)}"
SRC_URL="${OSM_SRC:-https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf}"
# UAE bounding box (includes a little of Oman/Qatar; the tiler clips to the UAE border)
BBOX="51.45,22.55,56.45,26.15"

echo "Downloading $SRC_URL"
curl -fL --retry 5 --retry-delay 10 -o "$WORK/src.osm.pbf" "$SRC_URL"
ls -la "$WORK/src.osm.pbf"

echo "Cutting the UAE bounding box"
osmium extract --bbox "$BBOX" --strategy smart --overwrite -o "$WORK/uae.osm.pbf" "$WORK/src.osm.pbf"
rm -f "$WORK/src.osm.pbf"

echo "Keeping only what the game needs"
osmium tags-filter --overwrite -o "$WORK/uae-game.osm.pbf" "$WORK/uae.osm.pbf" \
  nw/highway w/building r/building nwr/natural nwr/leisure nwr/landuse nwr/amenity=fuel,parking \
  n/place r/boundary=administrative nwr/water nwr/waterway=riverbank nwr/wetland n/barrier=toll_booth
ls -la "$WORK/uae-game.osm.pbf"

rm -rf "$OUT"
python3 "$(dirname "$0")/uae_tiles.py" "$WORK/uae-game.osm.pbf" "$OUT"
du -sh "$OUT"
