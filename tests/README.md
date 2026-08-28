# Server tests

Integration tests for `server.js`. They boot the **real** server in a child process on a
free port and drive it with **real** `socket.io-client` players. No mocks, no stubs — if a
test passes, the actual socket contract works.

```bash
npm test                                  # everything (~2.5 min)
npm run test:watch                        # re-run on change
npx vitest run tests/reconnection.test.js  # one file
npx vitest run -t "phantom round"          # one test by name

HARNESS_DEBUG=1 npx vitest run tests/gameplay.test.js   # stream server logs to stderr
```

Most of the runtime is real round timers: a Standard round is 21 real seconds and cannot be
faked, because the server is a separate process. Prefer **First Down** (6s) in new tests
unless the test is specifically about Standard or Wild rounds.

## Files

| File | What it covers |
|---|---|
| `harness.test.js` | the harness itself — if these fail, nothing else means anything |
| `concurrency.test.js` | room isolation, phantom rounds, six games at once |
| `gameplay.test.js` | a complete game start to finish |
| `reconnection.test.js` | all 12 leave/rejoin scenarios |
| `edge-cases.test.js` | no-card, double declare, 13 players, deck replenishment |
| `protocol.test.js` | the remaining socket events |
| `card-data.test.js` | `client/src/data/cards.js` vs the server deck (no server needed) |

## Writing a test

```js
import { createHarness } from './helpers/harness.js';

const h = await createHarness();
const room = await h.newGame(['Ava', 'Ben', 'Cy']);   // created, joined, started

const since = room.host.mark();                        // remember where we are in the log
expect(await room.declareFirstDown()).toBe('declared');
room.assignDrinks(room.host, [{ player: room.guests[0], drinks: 4 }]);
await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

expect(h.totalsFor(room.host, room.guests[0].id).totalDrinks).toBe(5);
await h.teardown();
```

Always `await h.teardown()` in `afterEach`, and re-throw `h.crashed()` — a dead server makes
every socket go quiet, which otherwise reads as a passing test:

```js
afterEach(async () => {
  const crash = h.crashed();
  await h.teardown();
  if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
});
```

## Two rules that cost me time

**1. Assert on observable outcomes, never on server internals.** The server is another
process; you cannot read `activeRounds` or `playerStats`. That is deliberate. Ask "what would
the other players see?" — a phantom round is observable as a reconnecting player being shown
a card that was never played.

**2. Every broadcast is per-socket, so never assert immediately after an action.** The player
who triggered something gets their ack before the others get theirs. Use `waitFor` on the
socket you are asserting about, not a bare `expect` on `.view`:

```js
// flaky — the guest's broadcast may not have landed yet
expect(room.guests[0].view.declaredCard).toBe('First Down');

// correct
await room.guests[0].waitFor('declaredCard', { since, where: (c) => c === 'First Down' });
```

Three of my early failures were this, not server bugs.

## `it.fails` means a known, unfixed bug

Three tests use `it.fails`. They assert the behaviour we *want* and are expected to fail
today, which keeps the suite green while recording the gap. See the "Needs my approval"
section of `OVERNIGHT_REPORT.md`.

**If you fix one of those bugs, the test will start failing** — flip it from `it.fails` to
`it`. That inversion is a deliberate tripwire, not a mistake.

## Helpers

- `helpers/server-process.js` — boots/stops `server.js`, captures logs, detects crashes.
- `helpers/fake-player.js` — one socket; records every event, derives the client view-model
  (`.view`), and provides `waitFor` / `mark` / `received` / `saw` / `disconnect`.
- `helpers/game-actions.js` — event payloads **identical to `client/src/App.js`**. If the
  client changes a payload, change it here too or the tests stop testing the real contract.
- `helpers/harness.js` — composes the above into `newRoom` / `newGame` / `room.*`.
