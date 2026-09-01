# Session 16 — make the live feed reachable, watch it, then let it call

Continues `live-game-feed`. Read `docs/LIVE_GAME_PLAN.md` and `docs/SESSION_15_REPORT.md` first.

Session 15 built the whole engine and deliberately wired none of it to the game. That was right.
**But `client/src/App.js` was never touched, so none of it is reachable from the running app** —
`GamePicker.jsx` exists, is tested, and is rendered nowhere. A room cannot attach a game today.

This session closes that, in two parts, **with a gate between them.**

Rules unchanged: **no push, no merge.** All 419 tests stay green, and **no existing test may need
modifying** — if one does, you have changed the base game; stop and say so.

---

# PART A — make it reachable, still calling nothing

Everything in Part A ships behind the same guarantee as Session 15: **nothing declares a card.**

## A1. Attach and detach, from the UI

Wire `GamePicker` into `App.js`. Ref-only. Two taps to attach: pick league, pick game.

- League toggle: **NFL / College**.
- NFL: the day's games, flat list.
- College: `groups` conference filter, ranked first, team search. **Note the run-sheet error from
  Session 15 — `groups=50` returns 4 events, not the slate. FBS is `groups=80`.** Use what you
  found, and document the right values in the code.
- Show teams, score, period, clock, and whether the game has started.
- Detach is one tap and always available to the Ref.

A room that never attaches is untouched. Detaching mid-game leaves a normal game of Shotgun
Formation.

## A2. The live score in the header

Score, period and clock for the attached game, in the room header, updating as the feed polls.

Keep it quiet — this sits alongside the existing header treatment, it does not compete with the
round timer or the deck. Check it at 360px, 390px and desktop; it must not push the board down.

Handle the states honestly: game not started, halftime, final, feed unavailable. A feed that dies
should say so rather than silently freezing on a stale score.

## A3. The "would have called" feed — the whole point of Part A

A running list, visible to **everyone**, of what the system detected and would have declared, with
the 45-second delay already applied. Each entry: the card, the time, and one line of why.

Tier B suggestions still go to the Ref only, via the existing `playSuggested` event, and are marked
as suggestions rather than calls.

**This is the deliverable that makes the pacing judgeable.** It has to read like the game would feel
— entries appearing at the moment a round *would* have started, not batched or summarised.

Tag `phase-16-wiring`.

## A4. Replay at 1× against a real room

A command that runs a fixture through a real room at **real speed**, so the rhythm can be watched
rather than inferred.

Session 15's report says this exists in some form — if so, confirm it works end to end with the UI
from A1–A3 and just document the command. If it doesn't, add it. It must be one command naming a
fixture and a room code.

---

# ⛔ THE GATE — stop here and hand back

**Do not start Part B in the same session.** Commit Part A, tag it, report, and stop.

The owner is going to sit and watch a recorded game replay at 1× for a quarter, with the feed
visible and inert, and decide whether ~89 auto-calls a game reads as alive or as relentless. That
decision changes what Part B should do, and it cannot be made from a table of numbers.

Two things to settle before Part B, both in your report:

1. **The first-down count.** Compare the detector's count against **ESPN's own box score for each of
   the three NFL fixtures individually** — not against any league average. Report per game. If they
   match, the counts are right. If not, say by how much.
2. **What the multi-card pairs actually look like in sequence.** 13.7 a game means back-to-back
   rounds are routine, not exceptional. In the A3 feed, do they read as one exciting moment or as a
   backlog?

---

# PART B — let it call (next session, after the gate)

> ⚠️ **SUPERSEDED by `docs/SESSION_17_LIVE_GAME_GO_LIVE.md`.** Same work, expanded after the
> replay findings. Work from Session 17, not from this section — it is kept only so Part A's
> reasoning still reads in context.

Written down now so Part A is built toward it. **Do not implement this yet.**

## B1. The release step declares

The queue's release calls the **same declaration path the Ref uses** — same `isActionInProgress`
guard, same round lifecycle, same `finalizeRound`. Do not fork the game loop.

- A manual Ref declaration always wins and clears anything queued.
- Detach, or the game going final, drains the queue rather than firing it late.
- The stale-drop and depth limits from Session 15 stay exactly as they are.

## B2. Per-card auto / suggest / off

Per room, defaulting to the Session 15 tiering. This is the dial the owner tunes after watching a
real game — it must not require a code change to move a card between modes.

## B3. Whatever Part A's watch-through changes

Left open deliberately.

---

## Also outstanding, not this session

- **The paid Render instance.** A live poller makes it structural — polling keeps the service awake,
  which is what suspended the free tier twice. Needed before Part B goes anywhere near production.
- **Merging `live-game-feed` to `main`.** Not until Part B has been watched working.

---

## Then

Report: what the picker looks like in both leagues, the correct `groups` values, the per-game
first-down comparison, the command to run a 1× replay, and how multi-card pairs read in the feed.

Then stop at the gate.
