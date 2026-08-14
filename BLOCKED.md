# Blocked / abandoned

Append-only. Nothing here has been silently dropped — every entry says what was tried.

## B1 — Phase 3 (UI rebuild) and Phase 4 (screenshots): cut, not blocked

**When:** 2026-08-14 08:21 CDT.
**Why:** Owner reduced the session to a hard 4-hour budget and instructed:
"do Phase 2 thoroughly and skip Phase 3 entirely rather than doing both badly.
Screenshots are the first thing to cut."
**State:** `client/` is completely untouched. `docs/DESIGN.md`, `client/src/data/cards.js`
and `client/src/components/CardIcon.jsx` are as you left them. Phase 3 can start from a
clean base in a later session.

## B2 — Room code collision: could not be tested honestly

**When:** 2026-08-14 09:30 CDT.
**What:** `generateRoomCode` (`server.js:96`) has no collision check, so `createRoom` can
silently overwrite a live room. Real bug, reported as approval item 4.
**Why not tested:** `Math.random()` has no seam the harness can control, and the server runs
in a separate process. Forcing a collision would need ~1,200 simultaneously-open rooms to be
~99% likely; anything smaller is a coin-flip that would fail randomly in CI. Three attempts
at a deterministic framing, none honest.
**What I did instead:** asserted the code format and small-batch distinctness, and documented
the missing guard by inspection. **This finding is code-reading, not test-proven.**

## B3 — Deck exhaustion at high player counts: not reachable in the time budget

**When:** 2026-08-14 09:35 CDT.
**What:** Observation O4 — `playStandardCard` splices cards out *before* calling
`checkAndReplenishDecks`, and the ≤12 threshold is a fixed number rather than scaled by
player count. With 13 players one declaration can need far more than 12 cards, which would
leave hands short of 5.
**Why not tested:** draining a 13-player standard deck needs ~1,000 cards drawn through
21-second rounds — hours of wall clock. The wild-deck swap trick that made the replenishment
test fast has no standard-deck equivalent, because standard cards can only be drawn by
playing a timed round.
**Status:** unverified, reasoned from the code. Suggested fix in the report.
