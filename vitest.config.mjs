import { defineConfig } from 'vitest/config';

// Integration tests boot a real server.js child process and run real socket
// rounds, so timeouts are generous: a Standard round takes 21 real seconds.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    teardownTimeout: 20_000,
    pool: 'forks',
    fileParallelism: true,
    reporters: ['verbose'],
  },
});
