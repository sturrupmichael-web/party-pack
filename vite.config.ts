import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Served from michaelsturrup.com/party-pack/. Override with VITE_BASE if needed.
//   /party-pack/        the TV (host screen)
//   /party-pack/join/   the phone controller
export default defineConfig({
  base: process.env.VITE_BASE ?? '/party-pack/',
  // Build time: the TV and phones compare it so they never mix versions.
  define: { __BUILD__: JSON.stringify(Date.now()) },
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        join: resolve(__dirname, 'join/index.html'),
      },
    },
  },
  server: { host: true },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
