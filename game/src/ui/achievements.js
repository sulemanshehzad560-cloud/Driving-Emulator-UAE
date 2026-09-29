// Achievements shown on the profile tab.
export const ACHIEVEMENTS = [
  { id: 'first', name: 'First drive', desc: 'Drive your first kilometre', icon: 'drive', test: (p) => p.stats.km >= 1 },
  { id: 'fifty', name: 'Road tripper', desc: 'Drive 50 km in total', icon: 'map', test: (p) => p.stats.km >= 50 },
  { id: 'e11', name: 'Seven emirates', desc: 'Drive 300 km in total', icon: 'flag', test: (p) => p.stats.km >= 300 },
  { id: 'fast', name: 'Autobahn spirit', desc: 'Reach 250 km/h', icon: 'signal', test: (p) => p.stats.topSpeed >= 250 },
  { id: 'mission', name: 'Chauffeur', desc: 'Complete a mission', icon: 'trophy', test: (p) => p.stats.missions >= 1 },
  { id: 'licence', name: 'Licensed', desc: 'Pass the driving test', icon: 'check', test: (p) => p.stats.tests >= 1 },
  { id: 'clean', name: 'Clean record', desc: '20 km driven with zero fines', icon: 'star', test: (p) => p.stats.km >= 20 && p.stats.finesCount === 0 },
  { id: 'collector', name: 'Collector', desc: 'Own four cars', icon: 'garage', test: (p) => p.owned.length >= 4 },
  { id: 'rich', name: 'Millionaire mindset', desc: 'Hold AED 50,000', icon: 'coins', test: (p) => p.balance >= 50000 },
];
