import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: {
      '@colis/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
