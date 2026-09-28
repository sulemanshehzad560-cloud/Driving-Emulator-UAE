// Synthesised car sounds (no audio files needed) + the in-car radio / music
// player. Music sources:
//   • Online radio – thousands of free internet stations via the public
//     radio-browser.info directory (Bollywood, Hollywood hits, Arabic, …)
//   • My Music     – songs the player picks from their own phone storage
// No copyrighted songs are bundled with the game.

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    // engine: two detuned oscillators through a low-pass filter
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 3;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.sub.connect(this.filter);
    this.filter.connect(this.engineGain).connect(this.master);
    [this.osc1, this.osc2, this.sub].forEach((o) => o.start());

    // noise buffer for tyres / wind / rain
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = (freq, type = 'bandpass', q = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.skid = noise(1800, 'bandpass', 4);
    this.wind = noise(500, 'lowpass', 0.5);
    this.rain = noise(3500, 'highpass', 0.3);
    this.fan = noise(900, 'lowpass', 0.4);
  }

  setMaster(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  update(vehicle, throttle, opts = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = vehicle.rpm;
    const f = 28 + rpm / 60;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 1.005, t, 0.05);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.filter.frequency.setTargetAtTime(500 + throttle * 1600 + rpm / 5, t, 0.08);
    const muffle = opts.cockpit ? 0.6 : 1;
    this.engineGain.gain.setTargetAtTime((0.05 + throttle * 0.1) * muffle, t, 0.1);
    this.skid.gain.setTargetAtTime(vehicle.slip > 0.35 && vehicle.kmh > 20 ? vehicle.slip * 0.25 : 0, t, 0.05);
    this.wind.gain.setTargetAtTime(Math.min(0.25, (vehicle.kmh / 250) ** 2 * 0.25) * muffle, t, 0.2);
    this.rain.gain.setTargetAtTime(opts.rain ? 0.06 : 0, t, 0.5);
    this.fan.gain.setTargetAtTime(opts.acFan ? 0.012 * opts.acFan : 0, t, 0.3);
  }

  beep(freq, dur, type = 'sine', vol = 0.15) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + dur * 0.6, dur * 0.2);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  tick(on) {
    this.beep(on ? 1400 : 1000, 0.03, 'square', 0.05);
  }

  horn(on) {
    if (!this.ctx) return;
    if (on && !this.hornOsc) {
      const g = this.ctx.createGain();
      g.gain.value = 0.18;
      const a = this.ctx.createOscillator();
      const b = this.ctx.createOscillator();
      a.type = b.type = 'square';
      a.frequency.value = 415;
      b.frequency.value = 494;
      a.connect(g);
      b.connect(g);
      g.connect(this.master);
      a.start();
      b.start();
      this.hornOsc = [a, b, g];
    } else if (!on && this.hornOsc) {
      this.hornOsc.forEach((n) => (n.stop ? n.stop() : n.disconnect()));
      this.hornOsc = null;
    }
  }

  crash(strength) {
    this.beep(90, 0.3, 'sawtooth', Math.min(0.4, strength * 0.05));
    this.beep(60, 0.4, 'square', Math.min(0.3, strength * 0.04));
  }

  cameraFlash() {
    this.beep(2200, 0.08, 'sine', 0.1);
  }

  chime() {
    this.beep(880, 0.15, 'sine', 0.12);
    setTimeout(() => this.beep(1320, 0.2, 'sine', 0.12), 140);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }
}

export const RADIO_GENRES = [
  { id: 'bollywood', name: 'Bollywood', tags: ['bollywood', 'hindi'] },
  { id: 'hollywood', name: 'Hollywood Hits', tags: ['top 40', 'pop', 'hits'] },
  { id: 'arabic', name: 'Arabic', tags: ['arabic', 'khaleeji'] },
  { id: 'uae', name: 'UAE Stations', country: 'AE' },
  { id: 'punjabi', name: 'Desi / Punjabi', tags: ['punjabi', 'bhangra'] },
  { id: 'rnb', name: 'Hip-Hop & R&B', tags: ['hip-hop', 'rnb'] },
  { id: 'rock', name: 'Rock', tags: ['rock', 'classic rock'] },
  { id: 'chill', name: 'Chill / Lounge', tags: ['chillout', 'lounge'] },
  { id: 'edm', name: 'EDM / Dance', tags: ['dance', 'edm'] },
];

const RB_HOSTS = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];

export class Radio {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'none';
    this.el.crossOrigin = null;
    this.stations = [];
    this.index = -1;
    this.source = 'radio'; // 'radio' | 'music'
    this.tracks = [];
    this.trackIndex = -1;
    this.status = 'Off';
    this.onchange = () => {};
    this.el.addEventListener('playing', () => this.setStatus('Playing'));
    this.el.addEventListener('waiting', () => this.setStatus('Buffering…'));
    this.el.addEventListener('error', () => {
      this.setStatus('Station unavailable – skipping');
      setTimeout(() => this.next(), 800);
    });
    this.el.addEventListener('ended', () => this.next());
    this.volume = 0.7;
    this.el.volume = this.volume;
  }

  setStatus(s) {
    this.status = s;
    this.onchange();
  }

  get nowPlaying() {
    if (this.source === 'music') return this.tracks[this.trackIndex]?.name || 'No songs added';
    return this.stations[this.index]?.name || 'Choose a genre';
  }

  async loadGenre(genreId) {
    const genre = RADIO_GENRES.find((g) => g.id === genreId) || RADIO_GENRES[0];
    this.source = 'radio';
    this.genre = genre;
    this.setStatus('Tuning…');
    const found = [];
    const queries = genre.country
      ? [`countrycode=${genre.country}`]
      : genre.tags.map((t) => `tag=${encodeURIComponent(t)}`);
    for (const host of RB_HOSTS) {
      try {
        for (const q of queries) {
          const res = await fetch(`${host}/json/stations/search?${q}&hidebroken=true&order=clickcount&reverse=true&limit=40`);
          if (!res.ok) throw new Error(res.status);
          const list = await res.json();
          for (const s of list) {
            const url = s.url_resolved || s.url;
            if (!url || !/^https:/.test(url) || /\.m3u8|\.pls|\.m3u$/i.test(url)) continue;
            if (found.some((f) => f.url === url || f.name === s.name.trim())) continue;
            found.push({ name: s.name.trim(), url, country: s.countrycode, codec: s.codec });
          }
        }
        break;
      } catch (e) {
        /* try the next mirror */
      }
    }
    this.stations = found.slice(0, 40);
    this.index = -1;
    if (!this.stations.length) {
      this.setStatus('No connection – check internet');
      return;
    }
    this.play(0);
  }

  addFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('audio') && !/\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i.test(f.name)) continue;
      this.tracks.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) });
    }
    if (this.tracks.length) {
      this.source = 'music';
      if (this.trackIndex < 0) this.play(0);
      else this.onchange();
    }
  }

  play(i) {
    if (this.source === 'music') {
      if (!this.tracks.length) return;
      this.trackIndex = (i + this.tracks.length) % this.tracks.length;
      this.el.src = this.tracks[this.trackIndex].url;
    } else {
      if (!this.stations.length) return;
      this.index = (i + this.stations.length) % this.stations.length;
      this.el.src = this.stations[this.index].url;
    }
    this.setStatus('Buffering…');
    this.el.play().catch(() => this.setStatus('Tap ▶ to play'));
  }

  toggle() {
    if (!this.el.src) {
      if (this.source === 'music' && this.tracks.length) this.play(0);
      else this.loadGenre(this.genre?.id || 'bollywood');
      return;
    }
    if (this.el.paused) this.el.play().catch(() => {});
    else {
      this.el.pause();
      this.setStatus('Paused');
    }
  }

  next() {
    this.play((this.source === 'music' ? this.trackIndex : this.index) + 1);
  }

  prev() {
    this.play((this.source === 'music' ? this.trackIndex : this.index) - 1);
  }

  setSource(src) {
    this.source = src;
    this.onchange();
  }

  setVolume(v) {
    this.volume = v;
    this.el.volume = v;
  }

  stop() {
    this.el.pause();
    this.setStatus('Off');
  }
}
