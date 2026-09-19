import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viewportHudSource from './vite-plugin-viewport-hud-source.js';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [[viewportHudSource, { root: process.cwd() }]],
      },
    }),
  ],
});
