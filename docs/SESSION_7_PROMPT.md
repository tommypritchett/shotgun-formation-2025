# Session 7 — Implement the approved UI against the mockup, then prove it

The owner approved the interactive mockup at **`client/public/mockup.html`**. That file is
now **the spec**. When this session ends, the real app's game screen and drink assigner
should be indistinguishable from it, wired to the real server.

**`docs/SESSION_6_PROMPT.md` is superseded by this file — do not execute it.** Its Phase 2
(the mid-round refresh bug) is folded in below as Phase 1. Everything else in it is replaced
by the mockup.

Read first, in order: `client/public/mockup.html` (all of it — markup, CSS, and JS; you are
porting it, not reinterpreting it), `docs/DESIGN.md`, `client/src/data/cards.js`,
`client/src/components/CardIcon.jsx`, `FOLLOW_UPS.md`, `CLAUDE.md`.

## Ground rules

- Branch `overnight-rebuild`, as-is. **No push, no merge, never touch `main`.**
- **All 94 tests stay green after every phase.** `protocol.test.js` pins the socket contract
  so you can move client code freely — it will tell you immediately if you change the wire.
- `server.js` is in scope **only** for Phase 1 and the `roundState` payload. Nothing else.
- Commit per component, tag per phase. If a phase goes sideways, `git reset` to the last
  green commit and log it — never leave the tree broken.
- First commit: the mockup file itself (it's on disk, uncommitted). It is the reference and
  it stays in `client/public/` so the owner can compare app vs. mockup on his phone at
  `http://10.0.0.42:3000/mockup.html`.

---

## Phase 1 — The mid-round refresh bug (server, test-first)

Reproduced by the owner: hold the declared card, get the drink prompt, refresh while the
timer runs → you rejoin but can no longer give out your drinks.

Hypothesis to verify: the reconnect path re-derives assignability from the player's
*current hand* (`server.js:612`, `:1629` — `playerHand.standard.filter(card => card.card
=== declaredCard)`), but `playStandardCard` already removed those cards and drew
replacements when the card was played, so the filter finds nothing and no
`distributeDrinks` is re-sent.

Fix: record the pending distribution per player on `activeRounds[roomCode]` at play time
(who owes what, for which card) and replay *that* on reconnect. Failing test first, in the
existing harness. Tag `phase-7a`.

## Phase 2 — Port the mockup into the real client

The mockup's CSS and component structure are done and approved — **port, don't redesign**.
Extract from `App.js` into components whose markup and classnames come straight from the
mockup:

```
src/styles/tokens.css        ← the :root block from the mockup
src/components/
  GameCard.jsx               ← .card — uses cards.js + CardIcon.jsx (already in repo)
  HandGrid.jsx               ← .handgrid — copies expanded to real tiles, all 7 visible
  ScoreBoard.jsx             ← .boardtabs + .stand + .log — the tab pair
  PlayerRow.jsx / PlayerTile.jsx
  DrinkAssigner.jsx          ← declared banner, timer bar, .pgrid, ammo dock, undo, toast
  Avatars.js                 ← the AV map (8 data URIs) from the mockup
screens/ JoinScreen, LobbyScreen, GameScreen
```

Rules carried over from the mockup, now behavioral requirements:

1. **One-screen game view.** Header, tab board, full 7-card hand, Declare button — no
   vertical scroll at 390×844 with 6 players. Remove all three
   `document.body.style.zoom = "70%"` calls; the mockup layout replaces what the zoom hack
   was compensating for. Standings scroll internally beyond ~6 rows.
2. **Hand shows every card as its own tile** — expand copies, no ×N badges, no side-scroll.
   Grid tiles hide trigger text (squint-test elements only); tapping a card opens the full
   card before play-confirmation.
3. **Avatars**: assign from the 8-avatar map **deterministically by player name** (stable
   hash → index), so the same person is the same football every game, with no two players
   in a room sharing an avatar when ≤8 players (offset on collision). The can mark is the
   header logo and every shotgun icon.
4. Join and Lobby screens: apply tokens, header, and avatar roster — keep them simple.
   The mockup doesn't cover them; don't invent new concepts, just make them belong to the
   same product.

Keep all socket handlers and state in `App.js`, passed down as props — no state library.
While extracting: the stats-lookup heuristic is copy-pasted at ~`App.js:2033`, `:2141`,
`:2191` — extract to one function, and do **not** delete the unnamed-entry fallback
(`FOLLOW_UPS.md` F1 explains why it's live). Tag `phase-7b`.

## Phase 3 — The three behavior changes

These are where the mockup is *better* than the current app, not just prettier:

1. **Pours count without lock-in.** Today the client batches assignments and a player who
   never confirms loses their pours. Change to **emit `assignDrinks` per tap** (the server
   already accumulates round results incrementally, and `finalizeRound` collects them when
   the timer ends). Undo emits a compensating decrement — if the current `assignDrinks`
   payload can't express a negative cleanly, hold taps client-side for at most a short
   debounce (≤1s), flushing on every tick and on `beforeunload`, so an un-flushed tap can
   survive neither a refresh nor the timer. The Lock In button becomes an optional early
   commit ("SENT ✓ · N EXPIRED" states as in the mockup). **Server test:** taps followed by
   timer expiry with no confirm → totals land.
2. **Auto-switch to Round Results.** On `updatePlayerStats` with `roundFinalized: true`,
   the board flips to the Round Results tab with the pulse; Standings is one tap back.
3. **Wire the dead `roundState` listener.** The server already emits it on reconnect
   (`server.js:535`, `:1565`) with the remaining time; the client has no listener — that's
   why the timer is wrong after a refresh. Add the listener, sync the countdown. This
   closes a gap noted since the first audit.

Tag `phase-7c`.

## Phase 4 — Prove it

1. Full suite, twice. All green, report counts (94 + whatever Phases 1/3 added).
2. `cd client && npm run build` — clean.
3. **Playwright screenshots of the real running app** (real server + real client, driven
   through the test harness so there's genuine game state): game screen idle, drink
   assigner mid-round, assigner after auto-lock, Round Results after finalize, lobby, join —
   at 390×844, 360×780, and 1280×900. Save to `screenshots/`, and put each **side by side
   with the mockup's equivalent** where one exists. They should be hard to tell apart.
4. The manual bit the owner will do himself: two phones on
   `http://10.0.0.42:3000` — refresh mid-round while holding the declared card (Phase 1's
   fix), and taps-without-lock-in landing after expiry. Update `MANUAL_TEST.md` with a short
   **Session 7 addendum** covering exactly those two, replacing any steps the new UI made
   stale (the old checklist references UI that no longer exists — fix only what changed).

## Phase 5 — `SESSION_7_REPORT.md`

Worst news first: what doesn't match the mockup and why; what changed on the wire (should
be: nothing renamed, `assignDrinks` cadence only); Phase 1 fix before/after with test
output; screenshot filenames inline; test counts; and your confidence on each behavior
change. Then stop — committed, tagged, nothing pushed.
