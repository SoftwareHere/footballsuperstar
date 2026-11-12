import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built game works from any sub-path (e.g. a static host).
  base: './',
  server: { host: true },
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.js'] },
});
