/**
 * A round finalizes exactly once.
 *
 * `finalizeRound` had no idempotency guard. That was harmless only because it
 * had exactly ONE caller — the else branch of startTimer's interval. Adding a
 * second caller (ending a round early once everyone has poured) creates the
 * race: the last player settles at t=20.9 while the timer fires at t=21.0, the
 * round finalizes twice, every total doubles and two results screens go out.
 *
 * The guard therefore lands BEFORE the early-end path exists. These tests lift
 * it out of server.js source and drive it directly, which is the only way to
 * exercise a second caller that does not exist yet.
 */
import { describe, expect, it } from 'vitest';
import { liftFromServer } from './helpers/lift-from-server.js';

const THIS_FILE = 'tests/finalize-once.test.js';

const claimRoundFinalize = liftFromServer(
  /const claimRoundFinalize = \(roomCode\) => \{[\s\S]*?\n\};/,
  'claimRoundFinalize',
  THIS_FILE
);

/** The lifted function closes over `activeRounds`; give it one. */
const withRounds = (rounds) => {
  // eslint-disable-next-line no-new-func
  const factory = new Function('activeRounds', 'console', `
    ${claimRoundFinalize.toString().replace(/^[^{]*/, 'const claimRoundFinalize = (roomCode) => ')}
    return claimRoundFinalize;
  `);
  return factory(rounds, { log() {} });
};

describe('claiming the right to finalize', () => {
  it('lets the first caller through and refuses the second', () => {
    const rounds = { '12345': { declaredCard: 'Touchdown' } };
    const claim = withRounds(rounds);
    expect(claim('12345'), 'the first caller was refused').toBe(true);
    expect(claim('12345'), 'the round would have finalized twice').toBe(false);
    expect(claim('12345')).toBe(false);
  });

  it('marks the round, so the flag dies with it', () => {
    const rounds = { '12345': { declaredCard: 'Touchdown' } };
    withRounds(rounds)('12345');
    expect(rounds['12345'].finalized).toBe(true);
  });

  it('does not block a different room', () => {
    const rounds = { a: { declaredCard: 'X' }, b: { declaredCard: 'Y' } };
    const claim = withRounds(rounds);
    expect(claim('a')).toBe(true);
    expect(claim('b'), 'one room finalizing blocked another').toBe(true);
  });

  it('does not block the NEXT round in the same room', () => {
    const rounds = { '12345': { declaredCard: 'Touchdown' } };
    const claim = withRounds(rounds);
    expect(claim('12345')).toBe(true);
    // finalizeRound deletes activeRounds[roomCode]; the next declaration makes
    // a fresh object with no flag on it.
    rounds['12345'] = { declaredCard: 'Penalty' };
    expect(claim('12345'), 'the room could never finalize again').toBe(true);
  });

  it('lets the timer path through when no round is tracked', () => {
    // finalizeRound is also reached for rounds that were never registered.
    expect(withRounds({})('nope')).toBe(true);
  });
});
