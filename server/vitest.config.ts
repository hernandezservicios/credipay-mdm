import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
