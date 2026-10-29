import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'none'; worker-src 'self'";
const csp = (): Plugin => ({ name: 'inject-csp', apply: 'build', transformIndexHtml: (h) => h.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`) });

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), csp()],
  resolve: { alias: { '@core': path.resolve(import.meta.dirname, '../core') } },
  define: { __PUBLIC_SHELL__: 'true', __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { outDir: path.resolve(import.meta.dirname, '../dist'), emptyOutDir: true, sourcemap: false, modulePreload: { polyfill: false }, chunkSizeWarningLimit: 1500 },
});
