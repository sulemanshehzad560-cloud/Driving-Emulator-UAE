// Player profile + settings persisted in localStorage.
const KEY = 'uaedrive.profile.v1';

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
  owned: ['nova-gt'],
  selected: 'nova-gt',
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
  // v2 garage: the free starter is the Nova GT; cars retired from the showroom are refunded
  const RETIRED = { 'kaiser-s': 0, 'kaiser-c': 3500, 'kaiser-g': 6000, 'kaiser-gle': 5000, 'kaiser-gt': 12000, 'falcon-gt': 20000, 'arrow-rs': 32000, 'nitro-hyper': 55000 };
  const before = JSON.stringify([profile.owned, profile.selected]);
  for (const id of profile.owned) if (id in RETIRED) profile.balance += RETIRED[id];
  profile.owned = profile.owned.filter((id) => !(id in RETIRED));
  if (!profile.owned.includes('nova-gt')) profile.owned.unshift('nova-gt');
  if (!profile.owned.includes(profile.selected)) profile.selected = 'nova-gt';
  if (JSON.stringify([profile.owned, profile.selected]) !== before) saveProfile(); // migrate (and refund) once
  return profile;
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
