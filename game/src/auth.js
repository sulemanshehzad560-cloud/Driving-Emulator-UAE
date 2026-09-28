// Sign-in bridge. Inside the Android app the native layer provides
// window.AndroidBridge (Google Play Games Services v2 and Facebook Login).
// In a desktop browser only guest play is available.

const pending = new Map();
let seq = 0;

window.__nativeCallback = (id, json) => {
  const cb = pending.get(id);
  if (!cb) return;
  pending.delete(id);
  try {
    cb.resolve(typeof json === 'string' ? JSON.parse(json) : json);
  } catch (e) {
    cb.reject(e);
  }
};

export function hasNative() {
  return typeof window.AndroidBridge !== 'undefined';
}

export function providers() {
  if (!hasNative()) return { google: false, facebook: false };
  try {
    return JSON.parse(window.AndroidBridge.providers());
  } catch (e) {
    return { google: false, facebook: false };
  }
}

export function signIn(provider) {
  if (!hasNative()) return Promise.reject(new Error('Sign-in with ' + provider + ' is available in the Android app.'));
  return new Promise((resolve, reject) => {
    const id = `cb${++seq}`;
    pending.set(id, { resolve, reject });
    window.AndroidBridge.signIn(provider, id);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Sign-in timed out'));
      }
    }, 120000);
  }).then((r) => {
    if (!r || r.error) throw new Error(r?.error || 'Sign-in cancelled');
    return r; // {provider, id, name, avatar}
  });
}

export function signOut(provider) {
  if (hasNative()) window.AndroidBridge.signOut(provider || '');
}

export function nativeCall(method, ...args) {
  if (hasNative() && typeof window.AndroidBridge[method] === 'function') return window.AndroidBridge[method](...args);
  return null;
}
