// Quick-start places across all seven emirates (lat/lon; the game snaps to
// the nearest road). Any other point can be picked on the UAE map.
const C = { dubai: '#ff9f0a', abudhabi: '#30d158', sharjah: '#64d2ff', ajman: '#bf5af2', uaq: '#ff375f', rak: '#ffd60a', fujairah: '#0a84ff' };

export const CITIES = [
  { id: 'downtown', name: 'Downtown Dubai', emirate: 'Dubai', lat: 25.1972, lon: 55.2744, blurb: 'Burj Khalifa & Sheikh Zayed Road', color: C.dubai },
  { id: 'marina', name: 'Dubai Marina', emirate: 'Dubai', lat: 25.0805, lon: 55.1403, blurb: 'Towers, JBR and the Palm', color: C.dubai },
  { id: 'burjalarab', name: 'Jumeirah', emirate: 'Dubai', lat: 25.1412, lon: 55.1853, blurb: 'Burj Al Arab & Jumeirah Beach Road', color: C.dubai },
  { id: 'palm', name: 'Palm Jumeirah', emirate: 'Dubai', lat: 25.1124, lon: 55.139, blurb: 'The famous palm-shaped island', color: C.dubai },
  { id: 'deira', name: 'Deira', emirate: 'Dubai', lat: 25.2697, lon: 55.3095, blurb: 'Old Dubai and the Creek', color: C.dubai },
  { id: 'dxb', name: 'Dubai Airport', emirate: 'Dubai', lat: 25.2528, lon: 55.3644, blurb: 'Airport Road and Garhoud', color: C.dubai },
  { id: 'hatta', name: 'Hatta', emirate: 'Dubai', lat: 24.8, lon: 56.12, blurb: 'Mountain roads near Oman', color: C.dubai },
  { id: 'e11', name: 'E11 Ghantoot', emirate: 'Abu Dhabi', lat: 24.86, lon: 54.86, blurb: 'The Dubai – Abu Dhabi highway', color: C.abudhabi },
  { id: 'abudhabi', name: 'Abu Dhabi City', emirate: 'Abu Dhabi', lat: 24.487, lon: 54.36, blurb: 'Corniche and the capital grid', color: C.abudhabi },
  { id: 'mosque', name: 'Grand Mosque', emirate: 'Abu Dhabi', lat: 24.4128, lon: 54.475, blurb: 'Sheikh Zayed Grand Mosque', color: C.abudhabi },
  { id: 'yas', name: 'Yas Island', emirate: 'Abu Dhabi', lat: 24.489, lon: 54.606, blurb: 'Yas Marina and theme parks', color: C.abudhabi },
  { id: 'saadiyat', name: 'Saadiyat', emirate: 'Abu Dhabi', lat: 24.535, lon: 54.434, blurb: 'Museums and beaches', color: C.abudhabi },
  { id: 'alain', name: 'Al Ain', emirate: 'Abu Dhabi', lat: 24.2075, lon: 55.7447, blurb: 'The Garden City', color: C.abudhabi },
  { id: 'liwa', name: 'Liwa Oasis', emirate: 'Abu Dhabi', lat: 23.133, lon: 53.771, blurb: 'Dunes of the Empty Quarter', color: C.abudhabi },
  { id: 'ruwais', name: 'Ruwais', emirate: 'Abu Dhabi', lat: 24.11, lon: 52.73, blurb: 'The western region', color: C.abudhabi },
  { id: 'sharjah', name: 'Sharjah', emirate: 'Sharjah', lat: 25.324, lon: 55.385, blurb: 'Al Majaz waterfront', color: C.sharjah },
  { id: 'khorfakkan', name: 'Khor Fakkan', emirate: 'Sharjah', lat: 25.339, lon: 56.356, blurb: 'East-coast bay', color: C.sharjah },
  { id: 'ajman', name: 'Ajman', emirate: 'Ajman', lat: 25.4052, lon: 55.4453, blurb: 'Corniche and downtown', color: C.ajman },
  { id: 'uaq', name: 'Umm Al Quwain', emirate: 'Umm Al Quwain', lat: 25.5647, lon: 55.5552, blurb: 'Quiet coastal streets', color: C.uaq },
  { id: 'rak', name: 'Ras Al Khaimah', emirate: 'Ras Al Khaimah', lat: 25.7895, lon: 55.9432, blurb: 'Al Nakheel and the creek', color: C.rak },
  { id: 'jebeljais', name: 'Jebel Jais', emirate: 'Ras Al Khaimah', lat: 25.95, lon: 56.13, blurb: 'Road to the highest peak', color: C.rak },
  { id: 'fujairah', name: 'Fujairah', emirate: 'Fujairah', lat: 25.1288, lon: 56.3265, blurb: 'Between mountains and sea', color: C.fujairah },
  { id: 'dibba', name: 'Dibba', emirate: 'Fujairah', lat: 25.619, lon: 56.273, blurb: 'Northern east coast', color: C.fujairah },
];

export const EMIRATE_COLORS = {
  Dubai: C.dubai, 'Abu Dhabi': C.abudhabi, Sharjah: C.sharjah, Ajman: C.ajman, 'Umm Al Quwain': C.uaq,
  'Ras Al Khaimah': C.rak, Fujairah: C.fujairah,
};

const EMIRATE_KEYS = [['abu dhabi', 'Abu Dhabi'], ['dubai', 'Dubai'], ['sharjah', 'Sharjah'], ['ajman', 'Ajman'], ['umm', 'Umm Al Quwain'], ['ras', 'Ras Al Khaimah'], ['fujair', 'Fujairah']];

/** Canonical emirate name ('' for anything outside the seven emirates). */
export function emirateName(raw) {
  const low = String(raw || '').toLowerCase().replace(/-/g, ' ');
  if (!low || low.includes('governorate')) return '';
  for (const [k, n] of EMIRATE_KEYS) if (low.includes(k)) return n;
  return '';
}
