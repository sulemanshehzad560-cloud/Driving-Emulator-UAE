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
  owned: ['kaiser-s'],
  selected: 'kaiser-s',
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
