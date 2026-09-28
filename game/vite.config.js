import { defineConfig } from 'vite';

// Relative base so the build works inside the Android WebView asset loader
// (https://appassets.androidplatform.net/assets/www/index.html).
export default defineConfig({
  base: './',
  build: {
    outDir: '../android/app/src/main/assets/www',
    emptyOutDir: true,
    target: 'es2019',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
