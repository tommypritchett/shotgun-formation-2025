# Session 6 — Two bugs, then the UI rebuild

I ran the app. Two things are broken, and then it's time for Phase 3 — the rebuild that got
cut on night one.

**Both bugs below are pre-existing and live on `main` today. Neither is a regression from our
changes.** The server work still stands on its own.

Read `docs/DESIGN.md`, `client/src/data/cards.js`, and `client/src/components/CardIcon.jsx`
before Phase 3.

## Rules

- `client/` is now **in scope**. `server.js` is **not** — except where Phase 2 proves it must
  be, and then only the minimum, flagged to me.
- **All 94 tests stay green.** `protocol.test.js` pins the socket contract specifically so
  client code can be moved freely — run the suite after every phase and it will tell you
  immediately if you changed what goes over the wire.
- Do not push. Do not merge. Do not touch `main`.
- Commit and tag per phase.

---

## Phase 1 — The scoreboard and round results aren't visible

Playing on a phone, the bottom section — `Room: {code}`, the running totals, and the Round
Results panel — is not on screen.

Diagnose before fixing. Candidates I'd check in this order:

1. **`document.body.style.zoom = "70%"`.** Set in three places. It's non-standard, Firefox
   ignores it entirely, and it interacts badly with mobile viewport height. The whole grid is
   implicitly sized around it. This is my prime suspect and it's already slated for removal in
   Phase 3 — if it's the cause, say so and let Phase 3 fix it properly rather than patching
   around it here.
2. **`.stats-row` is simply below the fold** and there's no scroll — a layout bug, not a data
   bug.
3. **`roundDrinkResults` is empty when it shouldn't be.** The panel is gated on
   `Object.keys(roundDrinkResults).length > 0`, so it renders nothing rather than an empty
   state. Check whether results survive long enough to be read after a round finalizes.

Tell me which it actually was. If it's (1), note it and move on — don't hack it.

## Phase 2 — Refresh mid-round and you can no longer give out drinks

Reproduce: be a player holding the declared card, get the drink-assignment prompt, refresh the
browser while the timer is still running. You come back into the game but the ability to
assign your drinks is gone.

**My hypothesis — verify it, don't trust it.** The server's reconnect path re-derives whether
you can assign drinks from your *current hand* (`server.js:612` and `:1629`,
`playerHand.standard.filter(card => card.card === declaredCard)`). But `playStandardCard`
already **removed those cards and drew replacements** at `server.js:~1128` the moment the card
was played. So by the time you reconnect, the filter matches nothing, no `distributeDrinks` is
re-sent, and the client never re-enters distribution mode.

If that's right, the fix is to stop re-deriving it. Record the pending distribution per player
on `activeRounds[roomCode]` when the card is played — who owes what, and for which card — and
replay *that* on reconnect. It's the same shape as the `roundState` payload that already
exists.

Two things to be careful about:

- **This is a `server.js` change**, which is otherwise out of scope. Keep it minimal and tell
  me exactly what you touched.
- **`roundState` is emitted and has no client listener** (`server.js:535`, `:1565`; zero
  `socket.on('roundState')` in `App.js`). It carries the remaining time. Wiring it up would
  also fix the wrong-timer-after-refresh gap we've been noting since night one. Do it if it
  falls out naturally; if it turns into its own project, log it and move on.

Write a test that fails first. This is exactly the kind of thing the harness is for.

## Phase 3 — The UI rebuild

### The logo — I looked at your art, and you're right

**Keep the green can with the shotgun** (`shotgun_icon.png`). It's a better mark than the
abstract chalk formation diagram in the design doc, and there's a happy accident in it: the
can is already the same green as the Wild deck accent. The brand mark and the colour system
were the same idea by coincidence. Lean into it.

- The can becomes the **primary brand mark** — join screen, lobby, loading states. Replace the
  chalk formation diagram in `docs/DESIGN.md` with it and note why.
- It stays the **shotgun-count icon** it already is, everywhere a shotgun total appears.
- `introimage.png` (the footballs drinking in front of the TV) stays as **splash art on the
  join screen only**. It's funny and it sets the tone, but it's 430KB and it should not be
  anywhere near the game screen.
- The "Playbook Chalk" colour and type system in `DESIGN.md` is unchanged — it's the layout
  language the mark sits inside.
- **Do not redraw, restyle, or "clean up" either image.** They're his.

### Order of work — commit and verify after each

1. **Card data.** Replace every hardcoded card string and inline drink calculation with reads
   from `cards.js`. The Declare Action modal hardcodes six buttons; the shotgun-display
   threshold is inline near `App.js:2121`. Use `DECLARABLE` and `formatValue()`.
2. **Design tokens.** The CSS custom properties from `DESIGN.md`. No component changes yet.
3. **Kill the zoom.** Remove all three `document.body.style.zoom` calls and re-fit the layout
   to real viewport units. **Highest-risk change in the session — its own commit**, verified at
   360px, 390px, and desktop. If it can't be done cleanly, revert it, log it, and continue with
   4 onward rather than shipping a broken layout.
4. **Componentize.** Extract in this order, moving code without changing behaviour:
   `GameCard`, `PlayerTile`, `Scoreboard`, `RoundResults`, `Timer`, `DrinkAssigner`, `Modal`,
   `GameMenu`, then `JoinScreen` / `LobbyScreen` / `GameScreen`. Socket handlers and state stay
   in `App.js` — no state library, no context.
5. **Restyle**, in the priority order in `DESIGN.md` §3: cards → drink assigner → timer →
   scoreboard → player tiles → lobby → join → motion.

**`GameCard` is the most important thing you'll build.** It has to render as the same object
that's being printed on the physical deck: `CardIcon`, the solid filled value chip, the name,
the trigger text. It must pass the squint test in `DESIGN.md` §2 — identifiable at 40% scale
with the text hidden.

The **drink assigner** is second and it's where the game is won or lost. Twenty-one seconds,
drunk, one-handed, racing a timer. A grid of player tiles with live counters and a big
"N left to assign" number, not a stack of full-width buttons.

While you're in there: the stats-lookup heuristic is copy-pasted at roughly `App.js:2033`,
`:2141` and a looser variant at `:2191`. Extract to one function. Do **not** delete the
unnamed-entry fallback — see `FOLLOW_UPS.md` F1 for why it's still live.

## Phase 4 — Show me

Screenshots to `screenshots/`, driven through the harness so there's real game state on screen:
join, lobby, game screen, drink assigner mid-round, declare-action modal, a hand with both
Standard and Wild cards, scoreboard with real totals. At 375×812, 390×844, and desktop.
Before/after against `main` for the game screen if you can manage it.

## Phase 5 — `SESSION_6_REPORT.md`

What each bug actually was, what the fix was, what got rebuilt, what didn't and why, test
counts, and anything in `DESIGN.md` you couldn't implement. Screenshot filenames inline.
Blunt, worst news first.
