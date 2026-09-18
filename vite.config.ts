import { defineConfig } from 'vite';

// base './' makes the build work both on the GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) and from any plain static folder.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
  preview: { host: true },
});
