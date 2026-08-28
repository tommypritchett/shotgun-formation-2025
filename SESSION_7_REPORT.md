# Session 7 Report

> **Status: all five phases run. Committed, tagged, nothing pushed.**
> Branch `overnight-rebuild`, `main` never checked out, `.git/hooks/pre-push` still blocking.
> Tags: `phase-7a`, `phase-7b`, `phase-7c`.
>
> **Full suite, twice, after every change was in: 102 passed (102), 12 files — clean both
> times (159.0s, 160.3s).** Client build clean. 30 screenshots of the real running app.

**Every issue found is in this report, including the ones I caused and fixed.**

---

## 1. Worst news first

### I. A test started failing intermittently, and it took real work to clear

Partway through verification, `gameplay.test.js` began failing about **one run in ten** with
`timed out after 29000ms waiting for "updatePlayerStats"` — the round never appeared to
finalize. It had been green all session before that, and green all of Sessions 3–6.

**It is not a Phase 7 regression.** Evidence, in the order I got it:

| Experiment | Result |
|---|---|
| New server, full suite ×5 | 4 clean, 1 failed (2 tests in `gameplay`) |
| New server, `gameplay.test.js` alone ×5 | 4 clean, 1 failed |
| Old server (`c33a114`), `gameplay.test.js` alone ×3 | 3 clean |
| **Old server, FULL suite under identical load** | **`gameplay` passed.** Only the 3 `mid-round-refresh` tests failed — which is correct, that is the Phase 7a fix they are testing |

That last row is suggestive but on its own it is 4 samples against a ~10% rate, which proves
very little. What actually settles it is the mechanism:

- **Phases 2 and 3 cannot possibly affect this.** They are client-only, and the suite never
  loads a line of client code — every test drives raw sockets.
- **Phase 1 is the only server change**, and it touches `playStandardCard`,
  `wildCardConfirmed` and the two reconnect blocks. `startTimer` and `finalizeRound` are
  untouched.

**The real cause is arithmetic in the test helper.** `startTimer` decrements once per
`setInterval(1000)` tick and finalizes on the tick *after* the counter hits zero, so a 21s
round takes **22 seconds**, not 21. The budget was `duration + 8s` = 29s — about 320ms of
allowable drift per tick across 22 ticks. `setInterval` makes no punctuality promise, and
under a 12-file parallel suite with a server process each, that much drift is ordinary.

**After the fix, the full suite ran clean twice back to back** (102/102, 159.0s and 160.3s),
and the widened budget still leaves the assertion intact.

**What I changed, so you can reverse it:** `finalizeTimeout` in
`tests/helpers/game-actions.js` is now `(seconds + 1) * 1000 + 12000`, with the arithmetic
written down in a comment. **This is a test-only change and it does not weaken the
assertion** — if `finalizeRound` genuinely never runs, it still fails, just without the
false alarms. I am flagging it prominently because "widen a timeout until the flake stops"
is exactly how a real bug gets buried, and you should be able to see that I did it and why.

The overnight report predicted this test would be the first to go flaky under load. It was
right. I hit it because I ran the suite far more often this session than any before it.

### II. Where the app does NOT match the mockup

The mockup is the spec, so every gap is listed, with the reason.

| # | Mockup | App | Why |
|---|---|---|---|
| 1 | Round Results reads **"X gave Y"** | Reads **"X drank N"** | **The wire cannot support the mockup.** `updatePlayerStats.roundResults` is keyed by RECIPIENT only and carries no record of who poured, and the socket contract is frozen this session. Inventing an attribution the server never sent would be worse than showing less. |
| 2 | Passive screen shows watchers as **"N still pouring · M locked in"**, with armed dots | Shows **"N at the table"**, all dots plain | Same cause: the server never broadcasts who has locked in. The mockup was faking it with `i % 2`. |
| 3 | Menu has a **Sound** row | Dropped | The app has no sound. A dead toggle is worse than no toggle. |
| 4 | `.rail` side-scrolling hand, `×N` copy badges | Unused | Deliberate — your rule 2: expand copies into real tiles, no side-scroll. The CSS is still present but inert. |
| 5 | Grid sized from a JS-measured `--abtop` on every resize | Sized with flex | Same result, declaratively, with no measurement pass. |
| 6 | Two `.screen`s toggled by demo chrome | Assigner is a fixed overlay | In the real app a round *opens over* the board. Without this the board's sticky Declare dock showed above the timer bar (see IV). |

Everything else — tokens, card object, hand grid, standings, tab pair, declared banner,
timer bar, panic frame, pour tiles with tallies, ammo readout, undo, Lock In / SENT ✓ ·
N EXPIRED, toast, menu sheet, all three breakpoints — is a direct port.

### III. The app was never loading its own fonts

Caught only because I rendered the screenshots and looked at them.

`client/public/index.html` had **no webfont link**. The mockup loads Oswald + Inter from
Google Fonts; the app did not. So `--sf-display` was falling through to `'Arial Narrow'`,
which exists on macOS and iOS and **does not exist on Android** — where the entire UI would
have silently rendered in a non-condensed system face. It would have looked "a bit off" on
one of your two test phones and correct on the other, which is the worst way to find a bug.

Fixed: the same `<link>` tags the mockup uses. Screenshots re-taken with real Oswald.

### IV. Three layout bugs the screenshots caught, all mine, all fixed

None of these would have shown up in the test suite, because the suite never renders anything.

1. **The assigner rendered *below* the game screen instead of over it.** The
   `.assigner-overlay` element I introduced had no CSS at all, so both screens stacked and
   the Declare dock sat above the timer bar.
2. **The pour grid did not hug the dock** — targets floated mid-screen instead of sitting in
   thumb reach.
3. **The toast covered the Declare button.**

### V. Undo is local-only — a deliberate deviation from the run sheet

The run sheet's first option was a compensating negative. **That is not safe here.**
`assignDrinks` folds every 10 drinks into a shotgun *as it accumulates*, so a `-1` arriving
after a fold leaves the recipient on **1 shotgun and minus one drinks** instead of 9 drinks.

I took your pre-approved fallback: a 700ms debounce. Undo reaches only taps still inside
that window; past it the button reports "Too late to undo that one" rather than corrupting a
score. Manual test B.5 covers it.

### VI. Two premises in the run sheet were wrong

- **"A player who never confirms loses their pours."** Not quite. The old client *did* emit
  at timer expiry, so the clock was never the problem. What lost pours was **leaving** — the
  whole round's assignments sat in local state, so a refresh or a backgrounded tab threw
  everything away. That is the bug you actually hit, and it is what got fixed.
- **"Remove all three `document.body.style.zoom` calls."** There were **four**, at the old
  lines 933, 1396, 1429 and 1582. All four are gone.

### VII. Smaller things, logged not fixed

- **`client/src/App.css` is now dead** — 1,007 lines, imported by nothing since the port. I
  left it rather than delete it, so you can diff the old UI against the new one. It should
  go once you are happy.
- **Playwright is a new root devDependency.** Same footing as vitest (DECISIONS.md D1):
  Render sets `NODE_ENV=production` so `npm install` skips it, and nothing at runtime
  imports it. I re-verified separately that a build with `client/.env.local` moved aside
  still falls back to the production Render URL, so the deploy path is untouched.
- **`screenshots/` adds ~9 MB of PNGs to the repo.** They are the deliverable you asked for,
  at 2x so fidelity is judgeable, but it is permanent weight in git history.

---

## 2. What changed on the wire

**Nothing renamed. No payload shape changed. One cadence change, as scoped.**

| | |
|---|---|
| Events renamed | none |
| Events added | none |
| Payload shapes changed | none |
| `distributeDrinks` | same fields; replayed on reconnect instead of re-derived |
| `assignDrinks` | **cadence only** — many small emits during the round instead of one at expiry. Identical payload shape. |

`protocol.test.js` (11 tests pinning the contract) passed throughout, which is what let the
client be rewritten this aggressively.

---

## 3. Phase 7a — before and after

**Before** (three identical runs of the new tests against the unfixed server):

```
run 1   × re-sends the drink prompt … 8412ms  → timed out waiting for "distributeDrinks"
        × URL-param rejoin path      8444ms  → timed out waiting for "distributeDrinks"
run 2   × re-sends the drink prompt … 8379ms  → timed out
        × URL-param rejoin path       444ms  → expected 2 to be 6      (WRONG AMOUNT)
run 3   × re-sends the drink prompt …  393ms  → expected 1 to be 4      (WRONG AMOUNT)
        ✓ URL-param rejoin path
```

Two distinct failure modes, and which one you got was down to the shuffle: usually **no
prompt at all**, but when the replacement draw happened to redeal the same card type, **a
prompt for an amount you never played**.

**After** — three consecutive runs, all four tests green, replay arriving in ~400ms instead
of timing out:

```
run 1   ✓ ✓ ✓ ✓    Tests  4 passed (4)
run 2   ✓ ✓ ✓ ✓    Tests  4 passed (4)
run 3   ✓ ✓ ✓ ✓    Tests  4 passed (4)
```

---

## 4. Screenshots

Real `server.js`, real production build served by Express, real Chromium joining over a real
socket as the host, reading its own dealt hand out of the DOM and declaring a card it is
actually holding. No mocks, no hand-fed state. `scripts/screenshots.mjs`, 30 files.

| Screen | 390×844 | 360×780 | 1280×900 |
|---|---|---|---|
| Join | `join-iphone-390x844.png` | `join-android-360x780.png` | `join-desktop-1280x900.png` |
| Lobby | `lobby-iphone-390x844.png` | `lobby-android-360x780.png` | `lobby-desktop-1280x900.png` |
| Game, idle | `game-idle-iphone-390x844.png` | `game-idle-android-360x780.png` | `game-idle-desktop-1280x900.png` |
| Assigner | `assigner-iphone-390x844.png` | `assigner-android-360x780.png` | `assigner-desktop-1280x900.png` |
| Assigner, mid-pour | `assigner-poured-iphone-390x844.png` | `assigner-poured-android-360x780.png` | `assigner-poured-desktop-1280x900.png` |
| Assigner, after auto-lock | `assigner-autolock-iphone-390x844.png` | `assigner-autolock-android-360x780.png` | `assigner-autolock-desktop-1280x900.png` |
| Round Results | `round-results-iphone-390x844.png` | `round-results-android-360x780.png` | `round-results-desktop-1280x900.png` |
| Standings | `standings-iphone-390x844.png` | `standings-android-360x780.png` | `standings-desktop-1280x900.png` |

Side by side with the mockup at the same sizes:
`MOCKUP-game-*.png` and `MOCKUP-assigner-*.png`.

**Compare `game-idle-iphone-390x844.png` against `MOCKUP-game-iphone-390x844.png` first** —
that is the one-screen rule, and it holds: header, tab board, all seven cards and the
Declare button with no vertical scroll at 390×844 with 6 players.

---

## 5. Test counts

(Session 6's run sheet was superseded and never executed, so the baseline is Session 4's,
which Session 5 left untouched.)

| | Before | After |
|---|---|---|
| Test files | 10 | **12** |
| Tests | 94 | **102** |

| New file | Tests | Covers |
|---|---|---|
| `mid-round-refresh.test.js` | 4 | Phase 7a — the refresh bug, both failure modes |
| `incremental-pours.test.js` | 4 | Phase 7c.1 — the server really does accumulate across calls |

No test was deleted or weakened. Two helper corrections, both disclosed: the `finalizeTimeout`
arithmetic (§I) and, in Session 6, the `nextQuarter` stale-mark bug.

`client/src`: **15 new files** — 10 components, 4 screens and `Avatars.js` — plus the
pre-existing `CardIcon.jsx` and `data/cards.js`, which are reused rather than reimplemented.
`App.js` went 2,480 → 2,464 lines with its entire render replaced; all socket handlers and
state stayed in it, passed down as props, exactly as scoped.

---

## 6. Confidence, per change

**Phase 7a — mid-round refresh replay. HIGH.** Four tests, RED first and demonstrably
nondeterministic before the fix, deterministic after across three runs. The fix removes a
whole class of bug (deriving past state from present state) rather than patching a symptom.
The residual risk is that a real phone's reconnect takes a path my tests do not — which is
why manual test A exists.

**Phase 7b — the port. HIGH on fidelity, MEDIUM on the long tail.** The screenshots are
against the real stack and they match. What they cannot tell me: how it feels under a
thumb, whether the 44px targets are big enough in a loud room, and whether anything breaks
on a real Android browser — which is exactly where the missing-font bug would have bitten.

**Phase 7c.1 — pours land without Lock In. HIGH on the server contract, MEDIUM on the
client.** Four tests pin the assumption the change rests on. Tap-at-a-time also folds every
tenth drink correctly, which a single batch does **not** (observation O2), so the new cadence
is more correct than the old one, not merely safer. The medium is the 700ms window: I have
not measured what a real phone does when it is backgrounded mid-flush.

**Phase 7c.2 — auto-switch to Round Results. HIGH.** Small, and visible in
`round-results-*.png` with the toast firing and the tab pulsed.

**Phase 7c.3 — `roundState` listener. MEDIUM.** The wiring is trivially correct and the
event has been on the wire since before the first audit. But this is the first time anything
has ever consumed it, so its payload has never been exercised by a client. Manual test 2.3
is the check.

---

## 7. What to do next

1. **Run `MANUAL_TEST.md`, starting with the Session 7 addendum** — sections A and B are the
   two things the suite cannot reach.
2. **Look at `game-idle-*.png` next to `MOCKUP-game-*.png`** and tell me if anything is off.
   That is a five-minute review and it is the cheapest way to catch a port mistake.
3. **`FOLLOW_UPS.md` F1 is still the first server task after the deploy** — `gameStarted`
   still ships every room's `playerStats`. Untouched this session, as agreed.
4. **Delete `client/src/App.css`** once you are satisfied with the new UI.
