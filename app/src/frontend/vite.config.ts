import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: Number(process.env.VITE_PORT) || 3007,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.BFF_URL ?? process.env.VITE_BFF_URL ?? 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth': {
        target: process.env.BFF_URL ?? process.env.VITE_BFF_URL ?? 'http://localhost:3006',
        changeOrigin: true,
      },
    },
  },
});
