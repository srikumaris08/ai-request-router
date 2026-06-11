import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,              // expose describe, it, expect, vi globally
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/server.js'], // entry point, not unit-testable
    },
    // Silence noisy console logs from the app during test runs
    silent: false,
    testTimeout: 10_000,
  },
});
