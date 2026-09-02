# Session 17 — Part B: let it call

The detector is done and verified against ten real games. This is the session where it starts
declaring cards.

Read `docs/LIVE_GAME_PLAN.md`, `docs/SESSION_16_LIVE_GAME_WIRING_AND_GO_LIVE.md` (Part B section)
and `docs/REPLAY_WATCH_REPORT.md` first.

Continue on `live-game-feed`. Rules unchanged: **no push, no merge.** All 495 tests stay green, and
**no existing test may need modifying** — if one does, the base game changed; stop and say so.

---

## 0. Fake Punt/FG → Ref-only

**Owner's decision.** It cannot fire from this feed — the word "fake" appears in 0 of 111 games
scanned, and a fake reads as an ordinary fourth-down rush with no structural marker.

Move it to `NEVER`, alongside Doink and Record Broken, and make sure the UI says plainly that these
are Ref-only rather than leaving cards that silently never appear. Update the gap list in
`card-coverage.test.js` and the tiering in `docs/LIVE_GAME_PLAN.md` — the plan's claim that the text
"sometimes says fake" was wrong and should be corrected rather than left to mislead someone later.

---

## 1. The release step declares

The queue's release calls **the same declaration path a Ref uses**. Not a parallel one.

- Same `isActionInProgress` guard, same round lifecycle, same `finalizeRound`, same events to
  clients. If a round starts, nothing downstream should be able to tell whether a human or the feed
  started it.
- **A manual Ref declaration always wins.** It clears anything queued for that moment rather than
  stacking behind it.
- **Detach, game final, or feed failure drains the queue** rather than firing it late.
- The 45-second delay, the 90-second stale drop and the depth limit all stay exactly as they are.
- Multi-card plays run **sequentially**, in the existing priority order — bigger event first, so a
  stale drop loses the smaller one.

The room must be told, once, that the feed is now calling — people should not have to work out why
rounds are starting on their own.

Tag `phase-17-release`.

## 2. Per-card auto / suggest / off

Per room, defaulting to the current tiering. Ref-only control.

This is the dial that gets tuned after a real game night, so **moving a card between modes must
never require a code change.** Group it so it is readable at a glance rather than a list of 24
switches — the owner will be reaching for this on a phone, half a beer in, while nine people wait.

Suggestions need an **accept** action now, not just a display. Accepting declares; ignoring lets it
expire quietly. A suggestion that expires must not linger on screen.

Tag `phase-17-dial`.

## 3. What happens when it goes wrong, in front of people

The feature now affects live play, so the failure modes matter more than the happy path.

- **Feed dies mid-game** — say so plainly in the room, stop calling, and leave the Ref able to
  declare by hand. Do not silently go quiet; that is indistinguishable from a dull patch of football.
- **A wrong call fires.** There is no undo for a declared round and it is not worth building one —
  but the Ref should be able to **pause auto-calling instantly**, one tap, without detaching the game
  or losing the score header. That is the escape hatch when something starts misbehaving at a party.
- **The game goes final** while a round is live — finish the round, then detach cleanly.

Tag `phase-17-failure-modes`.

---

## Then: a manual test list

This is the first time the feature touches real play, so end with a checklist the owner can run
against a replay — not against a live game. Cover: a round actually starting from a detection, the
manual override winning, a suggestion accepted and a suggestion ignored, the pause control, the feed
dying, and a full game replayed end to end with the queue counters at zero.

Nothing pushed. The merge and the deploy remain the owner's.

---

## Still outstanding, not this session

- **The paid Render instance.** Polling keeps the service awake, which is what suspended the free
  tier twice. Needed before any of this reaches production.
- **Merging `live-game-feed` into `main`**, once Part B has been watched working.
