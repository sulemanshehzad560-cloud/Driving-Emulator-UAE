// Must match tools/uae_tiles.py: sinusoidal projection centred on the UAE.
// World space in the game: X = east (m), Z = -north (m), Y = up.
export const LAT0 = 24.8;
export const LON0 = 54.8;
export const TILE = 1000;
const KY = 110574;
const KX0 = 111320;

export function project(lon, lat) {
  return [(lon - LON0) * KX0 * Math.cos((lat * Math.PI) / 180), (lat - LAT0) * KY];
}

export function unproject(x, y) {
  const lat = y / KY + LAT0;
  return [x / (KX0 * Math.cos((lat * Math.PI) / 180)) + LON0, lat];
}

/** lon/lat -> world X/Z */
export function toWorld(lon, lat) {
  const [x, y] = project(lon, lat);
  return [x, -y];
}

export function tileKey(tx, ty) {
  return `${tx}_${ty}`;
}

/** Tile containing world position (X, Z). */
export function tileAt(X, Z) {
  return [Math.floor(X / TILE), Math.floor(-Z / TILE)];
}
