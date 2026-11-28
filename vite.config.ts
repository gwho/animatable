import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The repository root still hosts the legacy static "Animatable" demo
// (index.html / index.js / style.css). The workbench uses its own HTML entry
// so the two never collide.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'workbench.html'),
    },
  },
  server: {
    open: '/workbench.html',
  },
});
