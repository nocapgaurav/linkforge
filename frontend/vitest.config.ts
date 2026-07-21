import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // jsdom's localStorage is origin-scoped and stays undefined without an
    // explicit URL — needed for token-storage.ts's refresh-token persistence.
    environmentOptions: { jsdom: { url: 'http://localhost:3001' } },
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
  },
});
