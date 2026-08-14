/**
 * Boots the real `server.js` as a child process on a free port.
 *
 * We deliberately spawn the production entrypoint rather than requiring it:
 * `server.js` calls `server.listen()` at module load and exports nothing, so
 * requiring it would need production code changes purely for testability.
 * Spawning also gives each test file a genuinely isolated process.
 */
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'server.js');
const BOOT_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 5000;

/** Ask the OS for a port nobody is using, then release it. */
const findFreePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/**
 * @param {{ debug?: boolean }} [options] - debug:true streams server logs to stderr.
 * @returns {Promise<{ url: string, port: number, logs: () => string, stop: () => Promise<void> }>}
 */
const startServer = async (options = {}) => {
  const debug = options.debug ?? process.env.HARNESS_DEBUG === '1';
  const port = await findFreePort();

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const captured = [];
  const capture = (chunk) => {
    const text = chunk.toString();
    captured.push(text);
    if (debug) process.stderr.write(text);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const logs = () => captured.join('');

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      child.kill('SIGKILL');
      reject(new Error(`server.js did not boot within ${BOOT_TIMEOUT_MS}ms.\n${logs()}`));
    }, BOOT_TIMEOUT_MS);

    const onData = (chunk) => {
      if (chunk.toString().includes(`Server is running on port ${port}`)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`server.js exited during boot with code ${code}.\n${logs()}`));
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };

    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });

  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const force = setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      child.kill('SIGTERM');
    });

  return { url: `http://127.0.0.1:${port}`, port, logs, stop };
};

module.exports = { startServer, findFreePort };
