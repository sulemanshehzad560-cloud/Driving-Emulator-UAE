// Driving controls: on-screen arrows, a touch steering wheel, gyroscope tilt
// steering and keyboard (for desktop testing). Pedals are shared.

// Racing wheel: flat-bottom carbon rim with alcantara grips, 12 o'clock
// marker, three brushed spokes, LED shift lights and a glowing hub.
const LEDS = Array.from({ length: 9 }, (_, i) => {
  const a = (-58 + i * 14.5) * (Math.PI / 180);
  const cls = i < 3 ? 'g' : i < 6 ? 'y' : 'r';
  return `<circle class="w-led ${cls}" cx="${(100 + Math.sin(a) * 72).toFixed(1)}" cy="${(100 - Math.cos(a) * 72).toFixed(1)}" r="4.2"/>`;
}).join('');
const WHEEL_SVG = `<svg viewBox="0 0 200 200" class="wheel-svg">
  <defs>
    <linearGradient id="wRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3340"/><stop offset=".5" stop-color="#11151c"/><stop offset="1" stop-color="#232a35"/></linearGradient>
    <linearGradient id="wGrip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1a1d22"/><stop offset=".5" stop-color="#34383f"/><stop offset="1" stop-color="#1a1d22"/></linearGradient>
    <linearGradient id="wMetal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9c3cf"/><stop offset=".45" stop-color="#5d6773"/><stop offset="1" stop-color="#9aa5b2"/></linearGradient>
    <radialGradient id="wHub" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#1d2a3a"/><stop offset="1" stop-color="#070a0f"/></radialGradient>
    <pattern id="wCarbon" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#141920"/><rect width="3" height="3" fill="#1e252f"/><rect x="3" y="3" width="3" height="3" fill="#1e252f"/></pattern>
  </defs>
  <!-- rim: round top, flat bottom -->
  <path class="w-rim" d="M100 14a86 86 0 0 1 80 116l-14 24c-4 7-10 10-18 10H52c-8 0-14-3-18-10l-14-24A86 86 0 0 1 100 14Z" fill="none" stroke="url(#wRim)" stroke-width="20" stroke-linejoin="round"/>
  <path d="M100 14a86 86 0 0 1 80 116l-14 24c-4 7-10 10-18 10H52c-8 0-14-3-18-10l-14-24A86 86 0 0 1 100 14Z" fill="none" stroke="rgba(39,225,255,.55)" stroke-width="1.4"/>
  <!-- grips at 9 and 3 o'clock -->
  <path d="M22 70a86 86 0 0 0 0 58" fill="none" stroke="url(#wGrip)" stroke-width="22" stroke-linecap="round"/>
  <path d="M178 70a86 86 0 0 1 0 58" fill="none" stroke="url(#wGrip)" stroke-width="22" stroke-linecap="round"/>
  <!-- 12 o'clock marker -->
  <rect x="95" y="3" width="10" height="21" rx="2" fill="#27e1ff"/>
  ${LEDS}
  <!-- spokes -->
  <path d="M28 104 74 94l6 24-50 6Z" fill="url(#wMetal)"/>
  <path d="M172 104 126 94l-6 24 50 6Z" fill="url(#wMetal)"/>
  <path d="M86 128h28l8 34H78Z" fill="url(#wCarbon)" stroke="#2c3440"/>
  <!-- hub -->
  <circle cx="100" cy="106" r="31" fill="url(#wHub)" stroke="#2c3440" stroke-width="2"/>
  <circle class="w-glow" cx="100" cy="106" r="24" fill="none" stroke="#27e1ff" stroke-width="2.4"/>
  <text x="100" y="104" text-anchor="middle" class="w-brand">UAE</text>
  <text x="100" y="118" text-anchor="middle" class="w-sub">DRIVE</text>
  <!-- paddle shifters peeking out behind the rim -->
  <rect x="52" y="60" width="14" height="30" rx="4" fill="#3a4250" transform="rotate(-28 59 75)"/>
  <rect x="134" y="60" width="14" height="30" rx="4" fill="#3a4250" transform="rotate(28 141 75)"/>
</svg>`;

export class Input {
  constructor(root, mode = 'arrows', sensitivity = 1) {
    this.root = root;
    this.mode = mode;
    this.sensitivity = sensitivity;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.raw = { left: false, right: false, gas: false, brake: false, hand: false };
    this.keys = new Set();
    this.wheelAngle = 0;
    this.tiltZero = null;
    this.tilt = 0;
    this.actions = {}; // name -> callback, fired on button taps
    this.build();
    this._onKey = (e) => this.onKey(e);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    this._onOrient = (e) => this.onOrientation(e);
    window.addEventListener('deviceorientation', this._onOrient);
    this._onMotion = (e) => this.onMotion(e);
    window.addEventListener('devicemotion', this._onMotion);
    this.hasMotion = false;
    // a key or touch released while the app was in the background never sends its
    // "up" event: clear everything so the car does not keep steering by itself
    this._release = () => this.releaseAll();
    window.addEventListener('blur', this._release);
    document.addEventListener('visibilitychange', this._release);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    window.removeEventListener('deviceorientation', this._onOrient);
    window.removeEventListener('devicemotion', this._onMotion);
    window.removeEventListener('blur', this._release);
    document.removeEventListener('visibilitychange', this._release);
    this.root.innerHTML = '';
  }

  releaseAll() {
    this.keys.clear();
    for (const k of Object.keys(this.raw)) this.raw[k] = false;
    this.root.querySelectorAll('.down').forEach((el) => el.classList.remove('down'));
  }

  hold(el, key) {
    const on = (e) => {
      e.preventDefault();
      this.raw[key] = true;
      el.classList.add('down');
    };
    const off = (e) => {
      e.preventDefault();
      this.raw[key] = false;
      el.classList.remove('down');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  build() {
    const r = this.root;
    const chevron = (dir) => `<svg viewBox="0 0 100 100" class="chev"><g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <path d="${dir < 0 ? 'M58 22 30 50l28 28' : 'M42 22l28 28-28 28'}"/><path d="${dir < 0 ? 'M80 30 60 50l20 20' : 'M20 30l20 20-20 20'}" opacity=".45"/></g></svg>`;
    const pedal = (kind, label) => `<button class="pedal ${kind}" data-k="${kind}">
        <span class="pedal-plate"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="pedal-meter"><span class="pedal-fill"></span></span>
        <span class="pedal-label">${label}</span></button>`;
    r.innerHTML = `
      <div class="ctl-left">
        <div class="steer-arrows">
          <button class="ctl-btn arrow" data-k="left" aria-label="Steer left">${chevron(-1)}<span class="hud-corners"></span></button>
          <button class="ctl-btn arrow" data-k="right" aria-label="Steer right">${chevron(1)}<span class="hud-corners"></span></button>
        </div>
        <div class="steer-wheel"><div class="wheel-rim">${WHEEL_SVG}</div><div class="wheel-angle"></div></div>
        <div class="steer-tilt"><div class="tilt-ind"><div class="tilt-bar"></div></div><button class="ctl-mini" data-a="calibrate">Re-centre</button></div>
      </div>
      <div class="ctl-right">
        <button class="ctl-btn hand" data-k="hand" aria-label="Handbrake"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width="3"/><text x="24" y="31" text-anchor="middle" font-size="20" font-weight="800" fill="currentColor">P</text><path d="M7 12a22 22 0 0 0 0 24M41 12a22 22 0 0 1 0 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><small>HAND</small></button>
        ${pedal('brake', 'BRAKE')}
        ${pedal('gas', 'THROTTLE')}
      </div>`;
    this.leds = [...r.querySelectorAll('.w-led')];
    this.gasFill = r.querySelector('.gas .pedal-fill');
    this.brakeFill = r.querySelector('.brake .pedal-fill');
    this.angleEl = r.querySelector('.wheel-angle');
    r.querySelectorAll('[data-k]').forEach((el) => this.hold(el, el.dataset.k));
    r.querySelector('[data-a="calibrate"]').addEventListener('click', () => (this.tiltZero = null));

    // touch steering wheel: rotate by dragging around its centre
    const wheel = r.querySelector('.steer-wheel');
    const rim = r.querySelector('.wheel-rim');
    let startAng = 0, startWheel = 0, active = null;
    const ang = (e) => {
      const b = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
    };
    wheel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = e.pointerId;
      wheel.setPointerCapture(e.pointerId);
      startAng = ang(e);
      startWheel = this.wheelAngle;
    });
    wheel.addEventListener('pointermove', (e) => {
      if (active !== e.pointerId) return;
      let d = ang(e) - startAng;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.wheelAngle = Math.max(-2.4, Math.min(2.4, startWheel + d));
      startAng = ang(e);
      startWheel = this.wheelAngle;
    });
    const release = (e) => {
      if (active !== e.pointerId) return;
      active = null;
    };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);
    this.wheelActive = () => active !== null;
    this.rimEl = rim;
    this.tiltBar = r.querySelector('.tilt-bar');
    this.setMode(this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    this.tiltZero = null; // re-centre on the way the phone is held right now
    this.root.dataset.mode = mode;
    if (mode === 'tilt' && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  }

  /**
   * Tilt from gravity: the roll of the screen like a steering wheel, measured
   * in the screen plane, so it does not change when the phone is tipped
   * forwards/backwards (Euler beta/gamma do, which made the car wander).
   */
  onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    const a = (((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI) / 180;
    const sx = g.x * Math.cos(a) - g.y * Math.sin(a);
    const sy = g.x * Math.sin(a) + g.y * Math.cos(a);
    if (Math.hypot(sx, sy) < 2.5) return; // phone lying flat: roll is undefined, keep the last value
    if (!this.hasMotion) {
      this.hasMotion = true;
      this.tiltZero = null; // switch from the orientation fallback: re-centre
    }
    this.feedTilt((-Math.atan2(sx, sy) * 180) / Math.PI);
  }

  feedTilt(v) {
    if (this.tiltZero === null) {
      this.tiltZero = v;
      this.tiltSmooth = 0;
    }
    let d = v - this.tiltZero;
    d = ((d + 540) % 360) - 180; // wrap: works for either sensor sign convention
    this.tiltSmooth += (d - this.tiltSmooth) * 0.35; // low-pass sensor noise
    this.tilt = this.tiltSmooth;
  }

  onOrientation(e) {
    if (this.hasMotion || e.beta == null) return; // gravity-based tilt is preferred
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    // In landscape the "steering" rotation of the phone shows up in beta.
    let v = angle === 90 ? e.beta : angle === -90 || angle === 270 ? -e.beta : e.gamma;
    this.feedTilt(v);
  }

  onKey(e) {
    const down = e.type === 'keydown';
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (down && !e.repeat) {
      const map = { h: 'lights', q: 'indLeft', e: 'indRight', z: 'hazard', c: 'camera', m: 'map', r: 'radio', n: 'horn', escape: 'pause', p: 'pause' };
      if (map[k] && this.actions[map[k]]) this.actions[map[k]]();
    }
  }

  update(dt) {
    const k = this.keys;
    const left = this.raw.left || k.has('arrowleft') || k.has('a');
    const right = this.raw.right || k.has('arrowright') || k.has('d');
    const gas = this.raw.gas || k.has('arrowup') || k.has('w');
    const brake = this.raw.brake || k.has('arrowdown') || k.has('s');
    const hand = this.raw.hand || k.has(' ');
    const s = this.state;
    const ramp = (v, target, up, down) => (target > v ? Math.min(target, v + up * dt) : Math.max(target, v - down * dt));
    s.throttle = ramp(s.throttle, gas ? 1 : 0, 3, 6);
    s.brake = ramp(s.brake, brake ? 1 : 0, 5, 8);
    s.handbrake = hand;

    const keyboardSteer = (right ? 1 : 0) - (left ? 1 : 0);
    let steer;
    if (keyboardSteer) {
      steer = ramp(s.steer, keyboardSteer, 3.2 * this.sensitivity, 3.2 * this.sensitivity);
    } else if (this.mode === 'wheel') {
      if (!this.wheelActive()) this.wheelAngle *= Math.max(0, 1 - dt * 4); // self-centering
      steer = this.wheelAngle / 2.4;
    } else if (this.mode === 'tilt') {
      // dead zone so a phone held not-quite-level does not steer on its own
      const DEAD = 3, FULL = 28;
      const t = Math.max(0, Math.abs(this.tilt) - DEAD) * Math.sign(this.tilt);
      steer = Math.max(-1, Math.min(1, (t / (FULL - DEAD)) * this.sensitivity));
    } else {
      steer = ramp(s.steer, 0, 3, 4);
    }
    s.steer = steer;
    const wheelRad = this.mode === 'wheel' ? this.wheelAngle : steer * 2.4;
    if (this.rimEl) this.rimEl.style.transform = `rotate(${wheelRad}rad)`;
    if (this.angleEl) this.angleEl.textContent = `${Math.round((wheelRad * 180) / Math.PI)}°`;
    if (this.gasFill) this.gasFill.style.transform = `scaleY(${s.throttle})`;
    if (this.brakeFill) this.brakeFill.style.transform = `scaleY(${s.brake})`;
    // shift lights follow the engine (set by the game every frame)
    const lit = Math.round(Math.max(0, (this.rpm || 0) - 0.35) / 0.6 * this.leds.length);
    if (lit !== this.litLeds) {
      this.litLeds = lit;
      this.leds.forEach((l, i) => l.classList.toggle('on', i < lit));
      this.root.classList.toggle('redline', lit >= this.leds.length);
    }
    if (this.tiltBar) this.tiltBar.style.transform = `translateX(${steer * 50}%)`;
    return s;
  }
}
