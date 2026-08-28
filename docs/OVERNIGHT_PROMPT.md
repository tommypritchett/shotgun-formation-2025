# Overnight Session — Run Sheet

Setup is already done: branch `overnight-rebuild` is checked out, and `cards.js`,
`CardIcon.jsx`, and `DESIGN.md` are in place. Do NOT re-run any setup or switch branches.
Start at Phase 1.


You're running unattended overnight. I'm asleep. Work through the phases below in order and
get as far as you can. Efficiency doesn't matter — thoroughness does. I'd rather you spend
two hours on a test suite than rush to the UI.

## Ground rules — these matter more than the work

1. **Never `git push`. Never checkout or modify `main`. Never `--force` anything.**
   Everything stays local on the `overnight-rebuild` branch.
2. **Commit after every meaningful unit of work.** Small commits, clear messages. Never
   leave a commit in a broken state — if it doesn't build or tests are red, either fix it
   or don't commit it.
3. **Tag after each phase** (`phase-1-server`, `phase-2-tests`, …) so I can review each
   chunk with `git diff phase-1-server..phase-2-tests`.
4. **When you need a decision I'd normally make: pick the most conservative option, write
   it to `DECISIONS.md` with your reasoning, and keep going.** Do not stop and wait. Do not
   stall on a question.
5. **When genuinely blocked: write it to `BLOCKED.md`, skip that item, move to the next
   one.** Never spin on the same failure. Three attempts, then log and move on.
6. **If you break the build and can't recover in three attempts**, `git reset --hard` to
   the last green commit, log what happened in `BLOCKED.md`, and continue with the next
   item. Losing an hour of work is fine. Leaving the repo broken is not.
7. **Never delete or weaken a test to make it pass.** If a test fails because the code is
   wrong, fix the code or log it. If a test fails because the test is wrong, fix the test
   and say so in the report.
8. **Never run `npm audit fix`, never upgrade a dependency, never change Node/React
   versions.** New dev-only dependencies for testing are fine.
9. **Keep a running log in `NIGHT_LOG.md`** — timestamp, what you did, what happened.
   Append as you go so I can reconstruct the night if something goes sideways.

## Read first

- `docs/SPEC.md` and `CLAUDE.md` — you wrote these in a previous session.
- `docs/DESIGN.md` — the visual system. New. Read it fully before Phase 3.
- `client/src/data/cards.js` — canonical card data. New.
- `client/src/components/CardIcon.jsx` — the 24-mark icon set. New.

The card data and icons are the same ones going on a physical printed deck. **Do not invent
new icons, rename cards, or change drink values.** The `id` field in `cards.js` is the wire
value and must match `server.js` exactly.

---

# PHASE 1 — Server concurrency fixes

You found in your audit that this server can't run two games at once. I verified your
findings. This is a hard ceiling on the product — it's a football game, so the real usage
pattern is a dozen groups all starting at 1pm on a Sunday.

**`server.js` is in scope for this phase only.**

### 1a. Build the integration harness

`tests/helpers/harness.js` — start the real `server.js` on a random port, connect real
`socket.io-client` instances as fake players, helpers to create a room, join N players,
start a game, declare cards, assign drinks, and read state. Vitest or Jest, your choice,
dev dependency only.

This harness is the foundation for everything after it. Make it good.

### 1b. Write failing tests first

`tests/concurrency.test.js`:
- **Isolated stats.** Room A: 3 players, start, declare Touchdown, assign drinks. Then Room
  B starts a game. Assert Room A's stats are untouched and Room A can still finalize a round.
- **Independent rounds.** Room A declares a card. Assert Room B's Host can declare
  simultaneously without receiving `actionInProgress`.
- **Phantom round.** Declare a card nobody holds. Assert `activeRounds[roomCode]` is clear.

**Run them and show me the failure output in the report.** If any passes before the fix,
the test is wrong — fix the test first.

### 1c. Fix these four, nothing more

1. **`startGame` wipes global `playerStats`** (~line 721):
   `Object.keys(playerStats).forEach(id => delete playerStats[id])` deletes every player on
   the server. Scope it to the current room.
2. **`rooms.isActionInProgress` is global** — set on the `rooms` dictionary rather than
   `rooms[roomCode]`. Move it to the room. Search the whole file; miss none.
3. **Stale `activeRounds`** — set (~line 930) before the `anyPlayerHasCard` check (~line
   946), never cleared on the early return (~line 956).
4. **Timer duration duplication** — real durations are 6 / 21 / 11 (First Down / Standard /
   Wild) but `activeRounds.timeRemaining` is hardcoded to 8 and 30. One
   `ROUND_DURATIONS = { standard: 21, wild: 11, firstDown: 6 }` constant used by both.
   **Do not change the actual durations.**

### Out of scope in Phase 1

- **Do not refactor to stable player UUIDs.** You're right that it would delete most of
  `socketIdMappings`. It's also large and risky and needs its own night.
- **Do not delete the dead `roundState` or `wildCardSelection` emits.** `roundState` has no
  listener, but wiring it up is probably the right fix, not removing it. Note it for Phase 2.
- No client changes. No logging cleanup. No reformatting.

If you find another global-state-that-should-be-room-scoped bug in the same family, fix it
and document it clearly in the report as an addition I need to review.

Green tests → commit → `git tag phase-1-server`.

---

# PHASE 2 — Full gameplay and reconnection testing

This is the most valuable phase. Test the game the way it actually gets played: on phones,
in a loud room, with people wandering off and coming back.

### 2a. Happy path

`tests/gameplay.test.js` — a complete game start to finish:
create → 3 players join → start → assert 5 Standard + 2 Wild dealt → declare each of the 5
Standard cards → declare a Wild (player selects, host confirms) → First Down → assign drinks
including the 10-drinks-becomes-1-shotgun conversion → advance quarter → swap a Wild card →
verify totals, hand refill, and deck replenishment at the ≤12 threshold.

### 2b. Players leaving and rejoining — the important one

`tests/reconnection.test.js`. At minimum:

1. Player leaves the lobby before the game starts
2. Player leaves mid-game via the explicit Leave Game action
3. **Host** leaves mid-game — is a new host assigned, does the game continue
4. Player disconnects mid-round *while a drink-assignment window is open* — do the drinks
   they were assigned survive the round finalizing?
5. Player disconnects and reconnects with the same name — do their totals come back
6. Player disconnects and reconnects *during* an active round — do they see the declared
   card and the correct remaining time
7. Player refreshes the browser mid-round (the URL-param rejoin path)
8. Two players with the same name in one room
9. A player reconnects twice in a row (chained socket ID remapping A→B→C)
10. All players disconnect — what happens to the room, can they all come back
11. Quarter advances while a player is disconnected — do they get their wild-card swap
12. A player leaves and the room drops below 3 players

For each: assert on the *observable outcome* — what the remaining players see, and whether
the score is right. Don't assert on internal structure.

### 2c. Edge cases

`tests/edge-cases.test.js`:
- Declare a card nobody holds → `noCard` fires, `isActionInProgress` clears
- Two declares in rapid succession → second is rejected cleanly
- 13+ players in one room
- Deck replenishment under sustained play (run many rounds, assert the deck never empties)
- Room code collision handling
- Joining a room code that doesn't exist

### 2d. Triage what you find

Split every issue into two tiers:

- **Tier A — fix now.** Provably wrong, the correct behaviour is unambiguous, a test proves
  it. Fix it, commit it, list it in the report.
- **Tier B — needs my approval.** Anything where "correct" is a judgment call about how I
  want the game to behave, anything touching the reconnection identity machinery, anything
  that changes what players experience. **Write a failing or skipped test, document it in
  the report, do not fix it.**

When in doubt, Tier B. I'd rather approve ten things in the morning than find you changed
game behaviour while I was asleep.

Commit → `git tag phase-2-tests`.

---

# PHASE 3 — UI rebuild

Only start this once Phases 1 and 2 are committed and green.

Read `docs/DESIGN.md` fully first. The design system is fixed — your job is to implement it,
not to reinterpret it. The cards on screen must match the cards being printed.

**Client only. `server.js` is off-limits again from here on. Socket events stay frozen.**

### 3a. Wire up the card data
Replace every hardcoded card string and inline drink-value calculation with reads from
`cards.js`. The Declare Action modal currently hardcodes 6 buttons; the shotgun display
threshold is inline around `App.js:2121`. Use `formatValue()` and `DECLARABLE`. Add a test
asserting `cards.js` copy counts match `generateDecks()` in `server.js` so they can't drift.

### 3b. Design tokens and the zoom removal
Introduce the CSS custom properties from `docs/DESIGN.md`. Then remove the three
`document.body.style.zoom = '70%'` calls and re-fit the layout to real viewport units.

**This is the highest-risk change in the whole night.** Its own commit. Verify at 360px,
480px, and desktop before committing. If you can't make it work cleanly, `git reset` it,
log it in `BLOCKED.md`, and skip to 3c — I'd rather have the zoom hack and good components
than a broken layout.

### 3c. Componentize
Extract from `App.js`, moving code without changing behaviour, in this order — commit and
verify after each: `GameCard`, `PlayerTile`, `Scoreboard`, `RoundResults`, `Timer`,
`DrinkAssigner`, `Modal`, `GameMenu`, then the three screens (`JoinScreen`, `LobbyScreen`,
`GameScreen`).

Keep all socket handlers and state in `App.js` for now — pass down via props. Don't
introduce a state library or context. One thing at a time.

While you're in there: the stats-lookup-by-name-then-elimination heuristic is copy-pasted
at roughly `App.js:2033`, `:2141`, and a looser variant at `:2191`. Extract to one function.
Same logic, one copy.

### 3d. Restyle
Against the design system, in the priority order from `docs/DESIGN.md` §3: cards → drink
assignment modal → timer → scoreboard → player tiles → lobby → join screen → motion.

**The card component is the most important thing you'll build tonight.** It must pass the
squint test in `DESIGN.md` §2 — identifiable at 40% scale with the text hidden.

Commit after each screen. Tag `phase-3-ui` when done.

---

# PHASE 4 — Prove it works and show me

### 4a. Everything green
Full test suite passes. `cd client && npm run build` succeeds with no new warnings.

### 4b. Screenshots — I want to see it when I wake up

Install Playwright as a dev dependency, start the server and client, and capture the real
running app to `screenshots/`:

- Join screen, Lobby, Game screen — each at **375×812 (iPhone)**, **390×844**, and desktop
- Drink assignment modal mid-round with several players
- Declare Action modal
- A hand showing both Standard and Wild cards
- The scoreboard with real totals
- Before/after pairs against `main` for the game screen if you can manage it

Drive it through the harness so there's real game state on screen, not empty placeholders.

If Playwright won't cooperate in this environment, don't burn more than 20 minutes — log it
and move on.

---

# PHASE 5 — The report

Write `OVERNIGHT_REPORT.md` at the repo root. This is the only thing I'll read first, so
put the important things at the top. Structure:

```
## TL;DR
   5 bullets. What works now that didn't, what I need to decide, what broke.

## Needs my approval  ← put this second, it's why I'm reading
   Every Tier B item. For each:
     - What the current behaviour is
     - Why I might not want it
     - What you'd change it to
     - What that would cost / risk
   Number them so I can reply "approve 1, 3, 4; skip 2."

## Phase 1 — Server concurrency
   Each fix, before/after line refs. Failing test output, then passing.

## Phase 2 — Gameplay and reconnection findings
   Every scenario tested and its result. Tier A fixes made. Tier B items
   cross-referenced to the approval section above.
   Be explicit about what you could NOT test and why.

## Phase 3 — UI
   What was rebuilt, what wasn't, and why. Screenshot filenames inline.
   Anything in DESIGN.md you couldn't implement and what you'd need.

## Decisions I made without you
   Everything from DECISIONS.md, with reasoning.

## Blocked / abandoned
   Everything from BLOCKED.md.

## What I'd do next
   Your honest read on the highest-value next session.

## Confidence check
   Where are you least sure this is correct? What would you want a human to
   verify by hand before trusting it?
```

Be blunt. If a phase went badly, say so at the top rather than burying it. If you think part
of my plan was wrong, say that too — you were right about the concurrency bugs and I
reordered the whole project because of it.

Finish with the repo committed, tests green, and nothing pushed.
