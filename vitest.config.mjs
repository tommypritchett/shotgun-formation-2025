import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration tests boot a real server.js child process and run real socket
// rounds, so timeouts are generous: a Standard round takes 21 real seconds.
export default defineConfig({
  // Components are plain JSX with no React import, the same as CRA compiles them.
  esbuild: { jsx: 'automatic' },
  // There are TWO copies of React on disk — one at the root (for
  // @testing-library) and one in client/node_modules (what CRA builds with),
  // both 18.3.1. A component under client/src resolves the client copy while
  // the test renderer uses the root one, and React's hook dispatcher is
  // module-level state: the second copy's is null, so ANY hook inside a
  // client/src component died with "Cannot read properties of null (reading
  // 'useState')". Nothing caught it before because no presentational
  // component had ever used a hook. Pin both to one copy.
  //
  // Test-only: CRA builds from client/ and never reads this file.
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
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
