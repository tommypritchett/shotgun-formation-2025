/**
 * The socket must actually be CONSTRUCTIBLE, not merely correct.
 *
 * Session 14 moved the client's socket options into a shared module and froze
 * them — right instinct for a shared constant, wrong object to hand to a
 * library. `io(url, opts)` passes the caller's object straight through to the
 * `Manager` constructor, which writes to it:
 *
 *     opts.path = opts.path || "/socket.io";     // socket.io-client manager.js:49
 *
 * On a frozen object, in an ES module (always strict), that is a TypeError:
 * `Cannot add property path, object is not extensible`. It throws at MODULE
 * SCOPE, before React mounts — so production served a white screen.
 *
 * **Why 305 tests were green while the site was down.** Every existing
 * assertion read the options object's CONTENTS — transport order, the value of
 * `tryAllTransports`. All of that is just as true of a frozen object as a live
 * one. Nothing anywhere constructed a socket. The tests were asking "are these
 * the right settings?" when the question that mattered was "does this run?".
 *
 * So these tests build a real `socket.io-client` instance. `autoConnect: false`
 * keeps them from opening a connection: the constructor is the whole test, and
 * the constructor is where it broke.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { SOCKET_OPTIONS } from '../client/src/lib/socket-options.js';

/** Nothing listens here; autoConnect is off, so nothing is dialled either. */
const URL = 'http://127.0.0.1:1';

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'src', 'App.js'),
  'utf8'
);

describe('constructing the client socket', () => {
  it('does not throw when built the way App.js builds it', () => {
    let socket;
    expect(() => {
      socket = io(URL, { ...SOCKET_OPTIONS, autoConnect: false });
    }, 'the app cannot create its socket — this is a white screen, not a warning')
      .not.toThrow();
    socket?.close();
  });

  it('survives being constructed twice, since the copy must be fresh each time', () => {
    // A shallow copy that itself got mutated and reused would fail here.
    const first = io(URL, { ...SOCKET_OPTIONS, autoConnect: false });
    const second = io(`${URL}/other`, { ...SOCKET_OPTIONS, autoConnect: false });
    expect(second).toBeTruthy();
    first.close();
    second.close();
  });

  it('leaves the shared constant unmodified, which is why it is frozen', () => {
    const before = JSON.stringify(SOCKET_OPTIONS);
    const socket = io(URL, { ...SOCKET_OPTIONS, autoConnect: false });
    socket.close();
    expect(JSON.stringify(SOCKET_OPTIONS)).toBe(before);
    expect(SOCKET_OPTIONS.path, 'the library wrote its default onto our constant')
      .toBeUndefined();
  });

  it('throws if handed the frozen constant directly — the bug, pinned', () => {
    // Kept deliberately. It is the reason the spread at the call site is not
    // decoration, and it is the line that documents what the library does to
    // whatever object it is given.
    expect(() => io(URL, SOCKET_OPTIONS)).toThrow(TypeError);
  });
});

describe('the call site', () => {
  it('spreads the options rather than passing the frozen object', () => {
    // The test above proves the PATTERN is safe. This proves App.js uses it.
    // Without both, one of them is testing something nobody runs.
    const at = APP.indexOf('const socket = io(');
    expect(at, 'the socket construction has moved — update this test').toBeGreaterThan(-1);
    const call = APP.slice(at, APP.indexOf(');', at));

    expect(call).toMatch(/\{\s*\.\.\.SOCKET_OPTIONS\s*\}/);
    expect(
      /io\([^)]*,\s*SOCKET_OPTIONS\s*\)/.test(call),
      'App.js passes the frozen constant straight to io(), which throws at '
        + 'module scope and white-screens the app before React mounts'
    ).toBe(false);
  });
});
