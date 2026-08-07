import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      APP_ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdef0123456789abcdef',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
    },
  },
});
