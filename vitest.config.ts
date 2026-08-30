import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.spec.ts'],
    // The suite spins real HTTP/WS servers and temp files. Default fan-out
    // (= 2× cores) oversubscribes a 12-core dev box: real handshakes
    // (ticket WS upgrade) and 5s budgets failed in ROTATING tests under
    // saturation (observed iter-8: timeouts, then an auth-handshake assert).
    // Capping workers keeps contention low; CI's smaller boxes clamp lower
    // anyway, and hangs still fail — just at 15s.
    maxWorkers: 8,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
    },
  },
});
