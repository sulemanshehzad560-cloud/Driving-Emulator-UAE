//! UAE Drive physics core (Rust -> WebAssembly).
//!
//! * Dynamic bicycle vehicle model with a Pacejka "magic formula" tyre curve,
//!   longitudinal weight transfer, friction circle, RWD/AWD drive, brake bias,
//!   handbrake drifts and a kinematic blend at parking speeds. Integrated in
//!   fixed 240 Hz sub-steps for stability regardless of the frame rate.
//! * Weather particle integrator (rain streaks / dust) writing straight into
//!   the GPU vertex buffer layout used by the renderer.
//!
//! The JS side shares one f32 block per vehicle (see the `P_*`, `I_*`, `S_*`
//! offsets) so there is no per-frame allocation or marshalling.

#![cfg_attr(target_arch = "wasm32", no_std)]

use core::f32::consts::PI;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

// ---- parameter offsets (set once per car) ----
pub const P_MASS: usize = 0;
pub const P_A: usize = 1; // CG -> front axle (m)
pub const P_B: usize = 2; // CG -> rear axle (m)
pub const P_H: usize = 3; // CG height (m)
pub const P_MU: usize = 4; // tyre peak friction
pub const P_FMAX: usize = 5; // max tractive force (N)
pub const P_POWER: usize = 6; // engine power at the wheels (W)
pub const P_CAIR: usize = 7; // aero drag coefficient (N / (m/s)^2)
pub const P_ROLL: usize = 8; // rolling resistance (N)
pub const P_BRAKE: usize = 9; // max brake force (N)
pub const P_STEER_LO: usize = 10; // max road-wheel angle at walking pace (rad)
pub const P_STEER_HI: usize = 11; // max road-wheel angle at 40 m/s (rad)
pub const P_STEER_RATE: usize = 12; // rad/s
pub const P_TOP: usize = 13; // top speed (m/s)
pub const P_AWD: usize = 14; // 1 = all-wheel drive
// ---- inputs (every frame) ----
pub const I_THROTTLE: usize = 16;
pub const I_BRAKE: usize = 17;
pub const I_STEER: usize = 18; // -1..1, positive = steer right
pub const I_HANDBRAKE: usize = 19;
pub const I_OFFROAD: usize = 20;
// ---- state ----
pub const S_X: usize = 24;
pub const S_Z: usize = 25;
pub const S_HEADING: usize = 26; // 0 = facing -Z (north), positive = turned left
pub const S_U: usize = 27; // forward speed (m/s)
pub const S_V: usize = 28; // lateral speed, positive = sliding left (m/s)
pub const S_R: usize = 29; // yaw rate (rad/s), positive = turning left
pub const S_DELTA: usize = 30; // road-wheel angle, positive = left
pub const S_AX: usize = 31; // longitudinal acceleration (for weight transfer)
pub const S_SLIP: usize = 32; // 0..1 drift amount (for tyre squeal)
pub const S_BRAKING: usize = 33; // 1 when brake lights should be on
pub const S_STOPPED: usize = 34; // seconds held stationary on the brake (engages reverse)
pub const BLOCK: usize = 48;

const G: f32 = 9.81;
const SUBSTEP: f32 = 1.0 / 240.0;

#[inline]
fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo { lo } else if v > hi { hi } else { v }
}

#[inline]
fn sign(v: f32) -> f32 {
    if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { 0.0 }
}

// libm-free approximations are good enough for game physics and keep the
// wasm tiny (no std).
#[inline]
fn sqrt(x: f32) -> f32 {
    if x <= 0.0 { return 0.0; }
    let mut y = f32::from_bits((x.to_bits() >> 1) + 0x1fbd_1df5);
    y = 0.5 * (y + x / y);
    y = 0.5 * (y + x / y);
    0.5 * (y + x / y)
}

fn atan(x: f32) -> f32 {
    // range reduction + minimax polynomial, |err| < 1e-5
    let (inv, x) = if x.abs() > 1.0 { (true, 1.0 / x) } else { (false, x) };
    let x2 = x * x;
    let r = x * (0.999_866 + x2 * (-0.330_299_5 + x2 * (0.180_141 + x2 * (-0.085_133 + x2 * 0.020_835_1))));
    if inv { sign(x) * PI / 2.0 - r } else { r }
}

fn atan2(y: f32, x: f32) -> f32 {
    if x > 0.0 {
        atan(y / x)
    } else if x < 0.0 {
        atan(y / x) + if y >= 0.0 { PI } else { -PI }
    } else if y > 0.0 {
        PI / 2.0
    } else if y < 0.0 {
        -PI / 2.0
    } else {
        0.0
    }
}

fn sin(x: f32) -> f32 {
    // wrap to [-pi, pi] then Bhaskara-style polynomial refined
    let mut x = x % (2.0 * PI);
    if x > PI { x -= 2.0 * PI; }
    if x < -PI { x += 2.0 * PI; }
    let y = (4.0 / PI) * x - (4.0 / (PI * PI)) * x * x.abs();
    0.225 * (y * y.abs() - y) + y
}

#[inline]
fn cos(x: f32) -> f32 {
    sin(x + PI / 2.0)
}

fn tan(x: f32) -> f32 {
    let c = cos(x);
    if c.abs() < 1e-4 { 1e4 * sign(sin(x)) } else { sin(x) / c }
}

/// Pacejka magic formula (lateral), normalised: returns force / (mu * Fz).
#[inline]
fn magic(alpha: f32) -> f32 {
    const B: f32 = 9.0;
    const C: f32 = 1.75;
    sin(C * atan(B * alpha))
}

/// Advance one vehicle by `dt` seconds. `s` is the shared f32 block.
pub fn step_vehicle(s: &mut [f32], dt: f32) {
    let dt = clamp(dt, 0.0, 0.1);
    let mut left = dt;
    while left > 1e-6 {
        let h = if left > SUBSTEP { SUBSTEP } else { left };
        substep(s, h);
        left -= h;
    }
}

fn substep(s: &mut [f32], dt: f32) {
    let m = s[P_MASS].max(500.0);
    let a = s[P_A];
    let b = s[P_B];
    let l = a + b;
    let hcg = s[P_H];
    let offroad = s[I_OFFROAD] > 0.5;
    let mu = s[P_MU] * if offroad { 0.62 } else { 1.0 };
    let iz = m * a * b * 1.15;
    let throttle = clamp(s[I_THROTTLE], 0.0, 1.0);
    let brake = clamp(s[I_BRAKE], 0.0, 1.0);
    let hand = s[I_HANDBRAKE] > 0.5;

    let mut u = s[S_U];
    let mut v = s[S_V];
    let mut r = s[S_R];

    // --- steering (rate limited, speed sensitive) ---
    let k = clamp(u.abs() / 40.0, 0.0, 1.0);
    let max_steer = s[P_STEER_LO] + (s[P_STEER_HI] - s[P_STEER_LO]) * k;
    let target = -clamp(s[I_STEER], -1.0, 1.0) * max_steer;
    let rate = s[P_STEER_RATE] * dt;
    let delta = s[S_DELTA] + clamp(target - s[S_DELTA], -rate, rate);
    s[S_DELTA] = delta;

    // --- loads with longitudinal weight transfer ---
    let ax = s[S_AX];
    let fzf = clamp(m * G * b / l - m * ax * hcg / l, 0.15 * m * G, 0.85 * m * G);
    let fzr = m * G - fzf;

    // --- longitudinal forces ---
    let mut braking = false;
    let mut f_drive = 0.0;
    let mut f_brake_f = 0.0;
    let mut f_brake_r = 0.0;
    if throttle > 0.0 {
        if u < -0.5 {
            f_brake_f = 0.65 * s[P_BRAKE] * throttle;
            f_brake_r = 0.35 * s[P_BRAKE] * throttle;
        } else {
            let top = s[P_TOP] * if offroad { 0.45 } else { 1.0 };
            let limiter = if u > top { 0.0 } else { 1.0 };
            f_drive = throttle * limiter * s[P_FMAX].min(s[P_POWER] / u.max(1.0));
        }
    }
    if brake > 0.0 {
        if u > 0.05 {
            f_brake_f += 0.65 * s[P_BRAKE] * brake;
            f_brake_r += 0.35 * s[P_BRAKE] * brake;
            braking = true;
        } else {
            // like an automatic gearbox: come to a halt first, then select reverse
            s[S_STOPPED] += dt;
            if s[S_STOPPED] > 0.35 && u > -9.0 {
                f_drive -= 0.35 * s[P_FMAX] * brake;
            } else {
                braking = true;
            }
        }
    }
    if brake == 0.0 || u > 0.05 {
        s[S_STOPPED] = 0.0;
    }
    if hand {
        f_brake_r += 0.5 * s[P_BRAKE];
    }
    let awd = s[P_AWD] > 0.5;
    let (mut fxf, mut fxr) = if awd { (0.4 * f_drive, 0.6 * f_drive) } else { (0.0, f_drive) };
    // brakes oppose motion (never push the car backwards once stopped)
    let dir = sign(u);
    fxf -= f_brake_f * dir;
    fxr -= f_brake_r * dir;
    // traction limits
    fxf = clamp(fxf, -mu * fzf, mu * fzf);
    fxr = clamp(fxr, -mu * fzr, mu * fzr);

    let mut roll = s[P_ROLL] * if offroad { 6.0 } else { 1.0 };
    if throttle == 0.0 && brake == 0.0 && u.abs() < 3.0 {
        roll += 0.25 * m; // engine braking / creep damping brings the car to rest
    }
    let drag = s[P_CAIR] * u * u.abs() + roll * dir;

    // --- lateral forces (dynamic model above walking pace) ---
    let blend = clamp((u - 2.0) / 3.0, 0.0, 1.0);
    let (mut fyf, mut fyr) = (0.0, 0.0);
    if blend > 0.0 {
        let uu = u.max(0.5);
        let alpha_f = delta - atan2(v + a * r, uu);
        let alpha_r = -atan2(v - b * r, uu);
        let rear_mu = if hand { mu * 0.38 } else { mu };
        fyf = mu * fzf * magic(alpha_f);
        let fyr_max = sqrt((rear_mu * fzr) * (rear_mu * fzr) - fxr * fxr);
        fyr = clamp(rear_mu * fzr * magic(alpha_r), -fyr_max, fyr_max);
    }

    let (sd, cd) = (sin(delta), cos(delta));
    let fx_body = fxr + fxf * cd - fyf * sd - drag;
    let du = fx_body / m + v * r * blend;
    let dv = (fyr + fyf * cd + fxf * sd) / m - u * r;
    let dr = (a * (fyf * cd + fxf * sd) - b * fyr) / iz;

    let u_before = u;
    u += du * dt;
    // come to rest instead of oscillating around zero under braking / drag
    if (u_before > 0.0 && u < 0.0 && throttle == 0.0) || (u_before < 0.0 && u > 0.0 && brake == 0.0) {
        u = 0.0;
    }
    let v_dyn = v + dv * dt;
    let r_dyn = r + dr * dt;
    // kinematic model for parking speeds / reversing
    let r_kin = u * tan(delta) / l;
    v = v_dyn * blend;
    r = r_dyn * blend + r_kin * (1.0 - blend);

    s[S_AX] = s[S_AX] + (du - s[S_AX]) * clamp(dt * 8.0, 0.0, 1.0);
    s[S_U] = u;
    s[S_V] = v;
    s[S_R] = r;
    s[S_SLIP] = clamp(v.abs() / 5.0, 0.0, 1.0);
    s[S_BRAKING] = if braking { 1.0 } else { 0.0 };

    let heading = s[S_HEADING] + r * dt;
    s[S_HEADING] = heading;
    let (sh, ch) = (sin(heading), cos(heading));
    // forward = (-sin h, -cos h); left = (-cos h, sin h)
    s[S_X] += (-sh * u - ch * v) * dt;
    s[S_Z] += (-ch * u + sh * v) * dt;
}

/// Weather particles. `local` holds xyz per particle (relative to the camera
/// focus), `out` receives world positions: 2 vertices per particle for rain
/// streaks (kind 0), 1 vertex for dust (kind 1).
pub fn step_particles(local: &mut [f32], out: &mut [f32], n: usize, dt: f32, kind: u32, fx: f32, fz: f32, wind: f32) {
    let rain = kind == 0;
    for i in 0..n {
        let (mut x, mut y, mut z) = (local[i * 3], local[i * 3 + 1], local[i * 3 + 2]);
        if rain {
            y -= dt * 28.0;
            x += dt * wind * 0.3;
        } else {
            y -= dt * 0.8;
            x += dt * (8.0 + wind);
            z += dt * 3.0 * sin(i as f32);
        }
        if y < 0.0 { y += 40.0; }
        if x > 60.0 { x -= 120.0; }
        if x < -60.0 { x += 120.0; }
        local[i * 3] = x;
        local[i * 3 + 1] = y;
        local[i * 3 + 2] = z;
        let (wx, wz) = (fx + x, fz + z);
        if rain {
            let o = i * 6;
            out[o] = wx;
            out[o + 1] = y;
            out[o + 2] = wz;
            out[o + 3] = wx + 0.1;
            out[o + 4] = y + 0.9;
            out[o + 5] = wz;
        } else {
            out[i * 3] = wx;
            out[i * 3 + 1] = y * 0.3;
            out[i * 3 + 2] = wz;
        }
    }
}

// ------------------------------------------------------------------ wasm ABI

/// Allocate `n` f32s inside wasm memory and return a pointer to them.
#[no_mangle]
pub extern "C" fn alloc_f32(n: usize) -> *mut f32 {
    // simple bump allocator over a static arena: the game allocates a handful
    // of long-lived buffers at start-up only
    static mut ARENA: [f32; 1 << 16] = [0.0; 1 << 16];
    static mut TOP: usize = 0;
    unsafe {
        let arena = &mut *core::ptr::addr_of_mut!(ARENA);
        let top = &mut *core::ptr::addr_of_mut!(TOP);
        if *top + n > arena.len() {
            return core::ptr::null_mut();
        }
        let p = arena.as_mut_ptr().add(*top);
        *top += n;
        p
    }
}

#[no_mangle]
pub extern "C" fn vehicle_step(block: *mut f32, dt: f32) {
    if block.is_null() { return; }
    let s = unsafe { core::slice::from_raw_parts_mut(block, BLOCK) };
    step_vehicle(s, dt);
}

#[no_mangle]
pub extern "C" fn particles_step(local: *mut f32, out: *mut f32, n: usize, dt: f32, kind: u32, fx: f32, fz: f32, wind: f32) {
    if local.is_null() || out.is_null() { return; }
    let l = unsafe { core::slice::from_raw_parts_mut(local, n * 3) };
    let o = unsafe { core::slice::from_raw_parts_mut(out, n * if kind == 0 { 6 } else { 3 }) };
    step_particles(l, o, n, dt, kind, fx, fz, wind);
}

#[no_mangle]
pub extern "C" fn block_size() -> usize {
    BLOCK
}

// ------------------------------------------------------------------ tests

#[cfg(test)]
mod tests {
    use super::*;

    fn car() -> [f32; BLOCK] {
        let mut s = [0.0f32; BLOCK];
        let m = 1800.0;
        s[P_MASS] = m;
        s[P_A] = 1.4;
        s[P_B] = 1.6;
        s[P_H] = 0.5;
        s[P_MU] = 1.05;
        s[P_FMAX] = m * 27.8 / 4.5 * 1.15;
        s[P_POWER] = s[P_FMAX] * 17.0;
        let top: f32 = 250.0 / 3.6;
        s[P_ROLL] = 180.0;
        s[P_CAIR] = (s[P_POWER] / top - s[P_ROLL]) / (top * top);
        s[P_BRAKE] = m * 10.0;
        s[P_STEER_LO] = 0.6;
        s[P_STEER_HI] = 0.09;
        s[P_STEER_RATE] = 3.0;
        s[P_TOP] = top;
        s
    }

    #[test]
    fn math_approximations() {
        for i in -30..30 {
            let x = i as f32 * 0.2;
            assert!((sin(x) - x.sin()).abs() < 2e-3, "sin {x}");
            assert!((cos(x) - x.cos()).abs() < 2e-3, "cos {x}");
            assert!((atan(x) - x.atan()).abs() < 1e-4, "atan {x}");
        }
        assert!((sqrt(2.0) - 2f32.sqrt()).abs() < 1e-5);
        assert!((atan2(-1.0, -1.0) - (-1f32).atan2(-1.0)).abs() < 1e-4);
    }

    #[test]
    fn accelerates_0_100_close_to_spec() {
        let mut s = car();
        s[I_THROTTLE] = 1.0;
        let mut t = 0.0;
        while s[S_U] < 100.0 / 3.6 && t < 20.0 {
            step_vehicle(&mut s, 1.0 / 60.0);
            t += 1.0 / 60.0;
        }
        assert!(t > 3.0 && t < 7.0, "0-100 took {t}s");
    }

    #[test]
    fn reaches_but_does_not_exceed_top_speed() {
        let mut s = car();
        s[I_THROTTLE] = 1.0;
        for _ in 0..(60 * 120) {
            step_vehicle(&mut s, 1.0 / 60.0);
        }
        let kmh = s[S_U] * 3.6;
        assert!(kmh > 200.0 && kmh < 262.0, "top speed {kmh}");
    }

    #[test]
    fn brakes_to_a_stop_and_stays_stopped() {
        let mut s = car();
        s[S_U] = 100.0 / 3.6;
        s[I_BRAKE] = 1.0;
        let x0 = s[S_Z];
        for _ in 0..(60 * 5) {
            step_vehicle(&mut s, 1.0 / 60.0);
            if s[S_U].abs() < 0.01 { break; }
        }
        s[I_BRAKE] = 0.0;
        for _ in 0..60 { step_vehicle(&mut s, 1.0 / 60.0); }
        let dist = (s[S_Z] - x0).abs();
        assert!(s[S_U].abs() < 0.05, "still moving {}", s[S_U]);
        assert!(dist > 30.0 && dist < 60.0, "100-0 braking distance {dist}m");
    }

    #[test]
    fn steering_right_turns_right() {
        let mut s = car();
        s[S_U] = 15.0;
        s[I_THROTTLE] = 0.3;
        s[I_STEER] = 1.0;
        for _ in 0..60 { step_vehicle(&mut s, 1.0 / 60.0); }
        // heading decreases when turning right, and the car drifts towards +X
        assert!(s[S_HEADING] < -0.2, "heading {}", s[S_HEADING]);
        assert!(s[S_X] > 0.5, "x {}", s[S_X]);
    }

    #[test]
    fn stable_at_motorway_speed_with_small_input() {
        let mut s = car();
        s[S_U] = 120.0 / 3.6;
        s[I_THROTTLE] = 0.5;
        s[I_STEER] = 0.3;
        for _ in 0..(60 * 5) { step_vehicle(&mut s, 1.0 / 60.0); }
        assert!(s[S_R].abs() < 1.0, "spinning: yaw rate {}", s[S_R]);
        assert!(s[S_V].abs() < 2.0, "sliding: {}", s[S_V]);
        s[I_STEER] = 0.0;
        for _ in 0..(60 * 3) { step_vehicle(&mut s, 1.0 / 60.0); }
        assert!(s[S_R].abs() < 0.05, "does not straighten: {}", s[S_R]);
    }

    #[test]
    fn handbrake_turn_makes_the_rear_slide() {
        let mut s = car();
        s[S_U] = 20.0;
        s[I_STEER] = 1.0;
        s[I_HANDBRAKE] = 1.0;
        let mut max_slip: f32 = 0.0;
        for _ in 0..60 {
            step_vehicle(&mut s, 1.0 / 60.0);
            max_slip = max_slip.max(s[S_SLIP]);
        }
        assert!(max_slip > 0.3, "no drift, slip {max_slip}");
    }

    #[test]
    fn reverses_slowly() {
        let mut s = car();
        s[I_BRAKE] = 1.0;
        for _ in 0..(60 * 6) { step_vehicle(&mut s, 1.0 / 60.0); }
        assert!(s[S_U] < -2.0 && s[S_U] > -10.0, "reverse speed {}", s[S_U]);
    }

    #[test]
    fn frame_rate_independent() {
        let mut a = car();
        let mut b = car();
        a[I_THROTTLE] = 1.0;
        b[I_THROTTLE] = 1.0;
        a[I_STEER] = 0.4;
        b[I_STEER] = 0.4;
        for _ in 0..(30 * 4) { step_vehicle(&mut a, 1.0 / 30.0); }
        for _ in 0..(120 * 4) { step_vehicle(&mut b, 1.0 / 120.0); }
        assert!((a[S_X] - b[S_X]).abs() < 0.5 && (a[S_Z] - b[S_Z]).abs() < 0.5);
    }
}
