// Driving controls: on-screen arrows, a touch steering wheel, gyroscope tilt
// steering and keyboard (for desktop testing). Pedals are shared.

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
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    window.removeEventListener('deviceorientation', this._onOrient);
    this.root.innerHTML = '';
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
    r.innerHTML = `
      <div class="ctl-left">
        <div class="steer-arrows">
          <button class="ctl-btn arrow" data-k="left">◀</button>
          <button class="ctl-btn arrow" data-k="right">▶</button>
        </div>
        <div class="steer-wheel"><div class="wheel-rim"><div class="wheel-spoke"></div><div class="wheel-hub">✦</div></div></div>
        <div class="steer-tilt"><div class="tilt-ind"><div class="tilt-bar"></div></div><button class="ctl-mini" data-a="calibrate">Re-centre</button></div>
      </div>
      <div class="ctl-right">
        <button class="ctl-btn hand" data-k="hand">HAND<br>BRAKE</button>
        <button class="pedal brake" data-k="brake"><span>BRAKE</span></button>
        <button class="pedal gas" data-k="gas"><span>GAS</span></button>
      </div>`;
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
    this.root.dataset.mode = mode;
    if (mode === 'tilt' && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  }

  onOrientation(e) {
    if (e.beta == null) return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    // In landscape the "steering" rotation of the phone shows up in beta.
    let v = angle === 90 ? e.beta : angle === -90 || angle === 270 ? -e.beta : e.gamma;
    if (this.tiltZero === null) this.tiltZero = v;
    this.tilt = v - this.tiltZero;
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
      steer = Math.max(-1, Math.min(1, (this.tilt / 28) * this.sensitivity));
    } else {
      steer = ramp(s.steer, 0, 3, 4);
    }
    s.steer = steer;
    if (this.rimEl) this.rimEl.style.transform = `rotate(${(this.mode === 'wheel' ? this.wheelAngle : steer * 2.4)}rad)`;
    if (this.tiltBar) this.tiltBar.style.transform = `translateX(${steer * 50}%)`;
    return s;
  }
}
