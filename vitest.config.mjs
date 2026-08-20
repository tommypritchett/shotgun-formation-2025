import { defineConfig } from 'vitest/config';

// Integration tests boot a real server.js child process and run real socket
// rounds, so timeouts are generous: a Standard round takes 21 real seconds.
export default defineConfig({
  // Components are plain JSX with no React import, the same as CRA compiles them.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
    // Component tests need a DOM; the socket integration tests must NOT have
    // one (they boot a real server child process and talk over real sockets).
    // Per-file environment keeps both in the same suite without compromise.
    environmentMatchGlobs: [['tests/ui/**', 'jsdom']],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    teardownTimeout: 20_000,
    pool: 'forks',
    fileParallelism: true,
    reporters: ['verbose'],
  },
});
