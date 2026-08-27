import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 9000,
    proxy: {
      '/api': { target: 'http://localhost:1000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:1000', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
