// Loads the Rust vehicle-dynamics / particle core (physics/src/lib.rs,
// compiled to WebAssembly). Everything falls back to the JS model if the
// module cannot be loaded, so the game always runs.

export const OFF = {
  P_MASS: 0, P_A: 1, P_B: 2, P_H: 3, P_MU: 4, P_FMAX: 5, P_POWER: 6, P_CAIR: 7, P_ROLL: 8, P_BRAKE: 9,
  P_STEER_LO: 10, P_STEER_HI: 11, P_STEER_RATE: 12, P_TOP: 13, P_AWD: 14,
  I_THROTTLE: 16, I_BRAKE: 17, I_STEER: 18, I_HANDBRAKE: 19, I_OFFROAD: 20,
  S_X: 24, S_Z: 25, S_HEADING: 26, S_U: 27, S_V: 28, S_R: 29, S_DELTA: 30, S_AX: 31, S_SLIP: 32, S_BRAKING: 33, S_STOPPED: 34,
};

let core = null;

export async function loadPhysicsCore(url = 'physics.wasm') {
  if (core) return core;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    const ex = instance.exports;
    const memory = ex.memory;
    const alloc = (n) => {
      const ptr = ex.alloc_f32(n);
      if (!ptr) throw new Error('physics arena exhausted');
      return { ptr, view: new Float32Array(memory.buffer, ptr, n) };
    };
    // particle buffers are allocated once and reused for every weather change
    const MAX_PARTICLES = 5000;
    const particles = { local: alloc(MAX_PARTICLES * 3), out: alloc(MAX_PARTICLES * 6), max: MAX_PARTICLES };
    core = { ex, alloc, particles, blockSize: ex.block_size() };
    console.info('[uaedrive] Rust physics core loaded');
  } catch (e) {
    console.warn('[uaedrive] physics core unavailable, using JS model:', e.message);
    core = null;
  }
  return core;
}

export function physicsCore() {
  return core;
}
