// Player profile + settings persisted in localStorage.
import { CARS } from './cars/catalog.js';

const KEY = 'uaedrive.profile.v1';
// cars retired from the garage -> what the player paid, refunded on load
const RETIRED = { 'kaiser-s': 0, 'kaiser-c': 3500, 'kaiser-g': 6000, 'kaiser-g63': 9000, 'kaiser-gle': 5000, 'kaiser-gt': 12000, 'falcon-gt': 20000, 'arrow-rs': 32000, 'nitro-hyper': 55000 };

export const DEFAULT_SETTINGS = {
  quality: 'auto', // auto | low | medium | high | ultra
  resolution: 'auto', // auto | 540p | 720p | 1080p | 1440p
  controls: 'arrows', // arrows | wheel | tilt
  sensitivity: 1,
  camera: 'chase',
  mirrors: 'all', // all | rear | off
  time: 'noon',
  season: 'summer',
  dynamicTime: false,
  volume: 0.8,
  trafficDensity: 1,
  units: 'kmh',
  showFps: false,
};

const DEFAULT_PROFILE = {
  name: 'Guest Driver',
  provider: 'guest',
  avatar: '',
  balance: 2500,
  owned: ['helix-ev'],
  selected: 'helix-ev',
  paints: {},
  blackPoints: 0,
  stats: { km: 0, fines: 0, finesCount: 0, missions: 0, tests: 0, topSpeed: 0, playSeconds: 0 },
  disclaimerAccepted: false,
  signedInOnce: false,
  tutorialDone: false,
  lastCity: 'downtown',
  lastDaily: '',
  settings: { ...DEFAULT_SETTINGS },
};

let profile = null;

export function loadProfile() {
  if (profile) return profile;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) { /* storage unavailable */ }
  profile = { ...structuredClone(DEFAULT_PROFILE), ...(saved || {}) };
  profile.settings = { ...DEFAULT_SETTINGS, ...(saved && saved.settings) };
  profile.stats = { ...DEFAULT_PROFILE.stats, ...(saved && saved.stats) };
  migrateGarage(profile);
  return profile;
}

/** Drop cars that are no longer sold (refunding them) and keep a valid selection. */
function migrateGarage(p) {
  const ids = new Set(CARS.map((c) => c.id));
  let refund = 0;
  for (const id of p.owned || []) if (!ids.has(id)) refund += RETIRED[id] || 0;
  p.owned = (p.owned || []).filter((id) => ids.has(id));
  if (!p.owned.includes(CARS[0].id)) p.owned.unshift(CARS[0].id);
  if (!ids.has(p.selected)) p.selected = CARS[0].id;
  if (refund) {
    p.balance += refund;
    p.garageRefund = (p.garageRefund || 0) + refund;
  }
}

export function saveProfile() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch (e) { /* storage unavailable */ }
}

export function resetProfile() {
  profile = structuredClone(DEFAULT_PROFILE);
  saveProfile();
  return profile;
}

export function level(p) {
  const xp = p.stats.km * 10 + p.stats.missions * 150 + p.stats.tests * 400;
  const lvl = Math.floor(Math.sqrt(xp / 100)) + 1;
  const cur = (lvl - 1) ** 2 * 100, next = lvl ** 2 * 100;
  return { lvl, progress: (xp - cur) / (next - cur) };
}
