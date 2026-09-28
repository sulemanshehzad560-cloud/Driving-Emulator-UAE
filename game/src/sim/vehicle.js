// Arcade vehicle model with speed-sensitive steering, weight transfer feel,
// handbrake drifts and an automatic gearbox for HUD/sound.
import { styleDims } from '../cars/carFactory.js';

const GEARS = [0, 0.18, 0.32, 0.48, 0.64, 0.8, 0.93, 1.05]; // fraction of top speed per gear upper bound

export class Vehicle {
  constructor(spec) {
    this.spec = spec;
    const d = styleDims(spec.style);
    this.length = d.L;
    this.width = d.W;
    this.wheelbase = d.wheelbase;
    this.x = 0;
    this.z = 0;
    this.heading = 0; // radians, 0 = facing north (-Z)
    this.vx = 0;
    this.vz = 0;
    this.speed = 0; // signed forward speed m/s
    this.steer = 0;
    this.yawRate = 0;
    this.gear = 1;
    this.rpm = 900;
    this.slip = 0;
    this.braking = false;
    this.offroad = false;
    this.wheelSpin = 0;
    this.topSpeed = spec.topSpeed / 3.6;
  }

  place(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = this.speed = 0;
  }

  get forward() {
    return [-Math.sin(this.heading), -Math.cos(this.heading)];
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  update(dt, input) {
    const s = this.spec;
    const [fx, fz] = this.forward;
    const rx = -fz, rz = fx;
    let fwd = this.vx * fx + this.vz * fz;
    let lat = this.vx * rx + this.vz * rz;

    // --- longitudinal ---
    const top = this.offroad ? Math.min(this.topSpeed, 70 / 3.6) : this.topSpeed;
    const accel0 = 27.8 / s.accel; // 0-100 km/h time -> m/s^2
    let a = 0;
    this.braking = false;
    if (input.throttle > 0) {
      if (fwd < -0.5) {
        a += 12 * s.braking * input.throttle; // braking out of reverse
      } else {
        const ratio = Math.max(0, fwd) / top;
        a += accel0 * input.throttle * Math.max(0.05, 1 - ratio * ratio) * (1.15 - ratio * 0.3);
      }
    }
    if (input.brake > 0) {
      if (fwd > 0.8) {
        a -= 13 * s.braking * input.brake;
        this.braking = true;
      } else {
        a -= 5 * input.brake; // reverse
        if (fwd < -12) a = Math.max(a, 0);
      }
    }
    // drag, rolling resistance, engine braking
    const drag = 0.00042 * fwd * Math.abs(fwd) + Math.sign(fwd) * (this.offroad ? 1.6 : 0.25);
    a -= drag;
    if (!input.throttle && !input.brake) a -= Math.sign(fwd) * Math.min(Math.abs(fwd) / dt, 0.9);
    const before = fwd;
    fwd += a * dt;
    if (input.brake && before > 0 && fwd < 0 && !input.throttle && before > 0.8) fwd = 0;
    if (input.handbrake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 6 * dt);

    // --- steering ---
    const speedN = Math.min(1, Math.abs(fwd) / 45);
    const maxSteer = 0.62 - 0.48 * speedN * (1 - s.handling * 0.35);
    const target = input.steer * maxSteer;
    const rate = 2.6 + s.handling * 2;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    const grip = (this.offroad ? 0.6 : 1) * s.grip;
    const yawTarget = (fwd * Math.tan(this.steer)) / this.wheelbase;
    const yawResponse = input.handbrake ? 9 : 7 * grip;
    this.yawRate += (yawTarget * (input.handbrake ? 1.25 : 1) - this.yawRate) * Math.min(1, yawResponse * dt);
    this.heading += this.yawRate * dt;

    // --- lateral grip (drift when grip is exceeded or handbrake used) ---
    const latGrip = input.handbrake ? 1.4 : 7 + grip * 7;
    lat -= lat * Math.min(1, latGrip * dt);
    this.slip = Math.min(1, Math.abs(lat) / 6);

    // rebuild velocity in the new heading frame (keeps some lateral slide)
    const [nfx, nfz] = this.forward;
    const nrx = -nfz, nrz = nfx;
    this.vx = nfx * fwd + nrx * lat;
    this.vz = nfz * fwd + nrz * lat;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.speed = fwd;

    // --- gearbox for HUD / audio ---
    const r = Math.abs(fwd) / this.topSpeed;
    if (fwd < -0.3) this.gear = -1;
    else {
      let g = 1;
      while (g < GEARS.length - 1 && r > GEARS[g]) g++;
      this.gear = g;
    }
    const lo = this.gear > 0 ? GEARS[this.gear - 1] : 0;
    const hi = this.gear > 0 ? GEARS[this.gear] : 0.2;
    const inGear = Math.max(0, Math.min(1, (r - lo) / (hi - lo || 1)));
    const targetRpm = 900 + inGear * 6200 + (input.throttle ? 400 : 0);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 8);
    this.wheelSpin += (fwd * dt) / 0.36;
  }

  /** Called after collision resolution moved the car. */
  bounce(nx, nz, restitution = 0.25) {
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= (1 + restitution) * vn * nx;
      this.vz -= (1 + restitution) * vn * nz;
      const [fx, fz] = this.forward;
      this.speed = this.vx * fx + this.vz * fz;
      return -vn;
    }
    return 0;
  }
}
