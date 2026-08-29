import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server. In production the backend serves the built dist/ directory
// (see aether-backend static server), so the dev server uses a proxy to the
// backend API + realtime hub for a painless local workflow.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
