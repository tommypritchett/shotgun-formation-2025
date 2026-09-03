/**
 * Item 2b — the rejoin dead-end.
 *
 * Three faults stacked into one screen you cannot leave:
 *
 *  1. The 10-second bail-out read `gameState` from inside a `useEffect(…, [])`
 *     closure, so it saw the value from the first render forever. It could
 *     never equal 'connecting', which is the only value that makes it fire.
 *     Dead code that looked like a safety net.
 *  2. The same timeout then removed the ONLY `roomNotFound` listener, so a
 *     late answer from the server had nobody listening.
 *  3. `shotgunFormation_gameState` was written every 15 seconds and removed
 *     nowhere. A stale entry sends you straight back to a room that no longer
 *     exists on the next load, and the one thing that could rescue you is (1).
 *
 * Together: "Rejoining your game…" with no timeout, no error, and no button.
 * Closing the tab did not help — the saved state was still there. This became
 * reachable in ordinary play the moment the idle reaper started actually
 * closing rooms (see tests/room-lifecycle.test.js).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ConnectingScreen from '../../client/src/components/ConnectingScreen.jsx';

afterEach(cleanup);

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
  'utf8'
);

/** Code only. A comment describing the old bug is not the old bug. */
const CODE = APP.split('\n')
  .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
  .join('\n');

/** The auto-rejoin effect, which is where all three faults lived. */
const rejoinEffect = () => {
  const at = CODE.indexOf('APP MOUNT: Starting auto-rejoin logic');
  expect(at, 'the auto-rejoin effect has moved — update this test').toBeGreaterThan(-1);
  return CODE.slice(at, CODE.indexOf('}, []);', at));
};

describe('the connecting screen has a way out', () => {
  it('offers a control that abandons the rejoin', () => {
    const onGiveUp = vi.fn();
    render(<ConnectingScreen onGiveUp={onGiveUp} />);

    const out = screen.getByRole('button');
    expect(out.textContent).toMatch(/start|back|cancel|join another/i);

    fireEvent.click(out);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('says which room it is trying, so the screen is not a mystery', () => {
    render(<ConnectingScreen roomCode="12345" onGiveUp={() => {}} />);
    expect(screen.getByText(/12345/)).toBeTruthy();
  });

  it('still renders without a room code rather than blowing up', () => {
    expect(() => render(<ConnectingScreen onGiveUp={() => {}} />)).not.toThrow();
  });
});

describe('the bail-out actually fires', () => {
  it('reads the live game state, not a frozen copy', () => {
    expect(
      rejoinEffect(),
      "the bail-out compares `gameState` inside a []-deps effect, so it reads "
        + 'the value from the first render and can never be "connecting"'
    ).not.toMatch(/if \(gameState === 'connecting'\)/);
    expect(rejoinEffect()).toMatch(/gameStateRef\.current === 'connecting'/);
  });

  it('keeps the ref in step with the state it mirrors', () => {
    expect(CODE).toMatch(/gameStateRef\.current = gameState;?\s*\}, \[gameState\]\)/);
  });

  it('leaves the roomNotFound listener in place', () => {
    expect(
      rejoinEffect(),
      'the timeout removes the only roomNotFound listener, so a late answer '
        + 'from the server lands on nobody'
    ).not.toMatch(/socket\.off\('roomNotFound'/);
    expect(rejoinEffect()).toMatch(/socket\.once\('roomNotFound'/);
  });
});

describe('the saved game is forgotten when the game ends', () => {
  it('has one place that clears it', () => {
    expect(CODE).toMatch(/localStorage\.removeItem\(SAVED_GAME_KEY\)/);
    expect(CODE, 'the storage key is written out in more than one place')
      .toMatch(/const SAVED_GAME_KEY = 'shotgunFormation_gameState'/);
  });

  it('clears it on every path that ends the game', () => {
    const paths = [
      ['handleLeaveGame', 'const handleLeaveGame'],
      ['the gameOver handler', "socket.on('gameOver'"],
    ];
    for (const [label, anchor] of paths) {
      const at = CODE.indexOf(anchor);
      expect(at, `${label} has moved — update this test`).toBeGreaterThan(-1);
      expect(CODE.slice(at, at + 700), `${label} leaves the saved game behind`)
        .toMatch(/forgetSavedGame\(\)/);
    }
  });

  it('clears it when a rejoin fails, so the next load is not stuck too', () => {
    // Both failure paths — the error handler and the ten-second bail-out — go
    // through abandonRejoin, and that is what forgets the saved game.
    const calls = rejoinEffect().match(/abandonRejoin\([^)]*\)/g) || [];
    expect(
      calls.length,
      'a failed rejoin must route through abandonRejoin, or the next load '
        + 'walks into the same wall'
    ).toBeGreaterThanOrEqual(4);   // two paths x (error handler + timeout)

    // Session 19: landing on a blank join form with no explanation is only
    // marginally better than a spinner. Every bail-out says why.
    for (const call of calls) {
      expect(call, `${call} drops someone on a join screen with no explanation`)
        .toMatch(/abandonRejoin\('[^']{10,}'\)/);
    }

    const at = CODE.indexOf('const abandonRejoin');
    expect(at, 'abandonRejoin has been renamed — update this test').toBeGreaterThan(-1);
    const body = CODE.slice(at, CODE.indexOf('\n};', at));
    expect(body).toMatch(/forgetSavedGame\(\)/);
    expect(body).toMatch(/clearURL\(\)/);
    expect(body).toMatch(/setGameState\('initial'\)/);
    expect(body, 'the reason must reach the join screen').toMatch(/setErrorMessage\(/);
  });
});
