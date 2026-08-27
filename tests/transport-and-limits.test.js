/**
 * Item 4 — the two config values.
 *
 * **Transports.** The client asked for `['websocket', 'polling']`. In
 * socket.io-client 4.8.1 / engine.io-client 6.6.2 — the pinned versions —
 * `tryAllTransports` has no default: it is read exactly once, in `_onError`,
 * and is `undefined` unless passed. So when the FIRST transport fails to open
 * the client emits an error and closes rather than trying the next. A phone on
 * a network that blocks WebSocket upgrades did not degrade to polling; it
 * failed to connect at all.
 *
 * The first test here is the real one: a server that accepts polling and
 * nothing else, and the app's own option object, taken from the same module the
 * app imports.
 *
 * **`maxHttpBufferSize`.** Was 1e8 — 100 MB per message, 100x the default. On a
 * 512 MB instance a couple of oversized messages are an OOM kill.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { createHarness } from './helpers/harness.js';
import { SOCKET_OPTIONS } from '../client/src/lib/socket-options.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stand up a socket.io server that only accepts the transports given. */
const serverAccepting = async (transports) => {
  const http = createServer();
  const server = new Server(http, { transports, cors: { origin: '*' } });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => { server.close(() => http.close(resolve)); }),
  };
};

/** Try to connect with the app's options; resolve to 'connected' or 'failed'. */
const tryConnect = (url, options) =>
  new Promise((resolve) => {
    const socket = connect(url, { ...options, reconnection: false, timeout: 4000 });
    const done = (outcome) => { socket.close(); resolve(outcome); };
    socket.on('connect', () => done('connected'));
    socket.on('connect_error', () => done('failed'));
    setTimeout(() => done('failed'), 6000);
  });

describe('the client can still connect where WebSocket is blocked', () => {
  it('connects to a polling-only server with the app\'s own options', async () => {
    const s = await serverAccepting(['polling']);
    try {
      expect(await tryConnect(s.url, SOCKET_OPTIONS)).toBe('connected');
    } finally {
      await s.close();
    }
  }, 20_000);

  it('is the option set that makes the difference, not luck', async () => {
    // The EXACT configuration this app shipped with, against the same server.
    // Verified by hand as well: it fails with "websocket error" — it does not
    // fall through to the polling entry sitting right there in its own list.
    // If this ever starts connecting, the library changed and the reasoning in
    // socket-options.js is stale; go and re-read it before relaxing anything.
    const s = await serverAccepting(['polling']);
    try {
      const shipped = { ...SOCKET_OPTIONS };
      delete shipped.tryAllTransports;
      shipped.transports = ['websocket', 'polling'];
      expect(await tryConnect(s.url, shipped)).toBe('failed');
    } finally {
      await s.close();
    }
  }, 20_000);

  it('rescues a returning player whose client starts on WebSocket anyway', async () => {
    // `rememberUpgrade: true` makes the client open on WebSocket whenever a
    // previous connection upgraded — every returning player. Reordering the
    // list does not help them; `tryAllTransports` does.
    const s = await serverAccepting(['polling']);
    try {
      const remembered = { ...SOCKET_OPTIONS, transports: ['websocket', 'polling'] };
      expect(await tryConnect(s.url, remembered)).toBe('connected');
    } finally {
      await s.close();
    }
  }, 20_000);

  it('still connects normally where WebSocket is available', async () => {
    const s = await serverAccepting(['polling', 'websocket']);
    try {
      expect(await tryConnect(s.url, SOCKET_OPTIONS)).toBe('connected');
    } finally {
      await s.close();
    }
  }, 20_000);

  it('asks for polling first, like the server does', () => {
    expect(SOCKET_OPTIONS.transports[0]).toBe('polling');
    expect(SOCKET_OPTIONS.tryAllTransports).toBe(true);
  });
});

describe('message size', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); });

  it('survives a message far larger than anything the app sends', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    const junk = 'x'.repeat(2 * 1024 * 1024);   // 2 MB, over the 1 MB ceiling

    room.host.emit('playStandardCard', { roomCode: room.code, cardType: junk });
    await sleep(800);

    // The connection may be dropped — that is the point of a ceiling — but the
    // process must not be, and the room must still be playable.
    expect(h.crashed(), 'an oversized message took the server down').toBeNull();

    const dee = await h.connect('Dee');
    const since = dee.mark();
    dee.emit('joinRoom', room.code, 'Dee');
    await dee.waitFor('joinedRoom', { since, timeout: 6000 });
  }, 30_000);
});
