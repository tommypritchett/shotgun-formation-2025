# Session 9 Report

> **All three tasks done. Committed, tagged `phase-9-logo`, nothing pushed.**
> Branch `overnight-rebuild` · **HEAD `c144cc3`** · `main` `e994b5f`, never checked out.
> Deny rules in `.claude/settings.local.json` untouched.
>
> **Suite: 159 passed (159), 18 files. Unchanged — this session touched no game logic.**

---

## Task 3 first: the run sheet's premises did not match the repo

You asked me to reconcile `docs/SPEC.md` and `PHYSICAL_GAME_PLAN.md`, both said to claim
**156 cards with one First Down card**. Neither claim exists.

- **`PHYSICAL_GAME_PLAN.md` has never existed in this repository.** Not in the working tree,
  not in any commit, not in any object in history.
- **No "156 cards" claim exists in any tracked document, ever.** I searched every markdown
  file across all commits.
- The only physical-deck statement anywhere was one comment in `cards.js`:
  *"`printCopies` is the fixed count for the physical **150**-card deck."*

**And 150 was already right about everything it covered.** `printCopies` sums to
105 Standard + 45 Wild = 150, which matches the box's playing-card lines exactly. There was
no contradiction to resolve — the repo simply never mentioned the other ten cards
(5 First Down, 1 Ref, 2 Rules, 2 blank House Rule) because none of them are event cards.

So the fix was smaller and different than briefed: **document the full 160, don't correct a
wrong number.** `docs/SPEC.md` gains **§3.1**, separating the printed deck from the app deck
— which are genuinely different things and were easy to confuse — with the complete
back-panel breakdown and which lines `cards.js` covers.

If a `PHYSICAL_GAME_PLAN.md` exists somewhere outside this repo, it is still unreconciled
and I could not have seen it.

### The First Down question, stated plainly

**The box says 5 First Down cards. The app has no First Down card at all.**

Today First Down is a Ref-only global action (`firstDownEvent`): the Ref calls it, everyone
drinks one, nobody holds anything. There is no First Down entry in `cards.js` and
`generateDecks()` never produces one.

**Five printed copies implies players hold them, and that is a different game.** It raises
questions the app has no answer for:

- Who plays it — the Ref, or whoever holds one?
- Does holding one let a non-Ref trigger the round?
- Does it follow the Standard rule where *everyone* holding that card pours, or stay a
  single global "everybody drinks one"?
- If players hold them, First Down becomes part of the dealt hand — which changes hand
  composition, the deck ratios, and the 5-Standard-2-Wild deal.

**Nothing has been implemented.** `cards.js` and `generateDecks()` are byte-identical.
This is recorded as **DISCREPANCY 4** in `SPEC.md` and needs your decision before either the
printed deck or the app moves. It is the only item from this session that blocks anything.

---

## Task 1 — Icons

Generated from `art/shotgun-logo-transparent.png`, wordmark-only crop, on opaque chalkboard
(`#0D1017`) so they do not disappear on a dark home screen.

| File | Size |
|---|---|
| `favicon.ico` | 16, 32, 48 in one container |
| `logo192.png` | 192 |
| `logo512.png` | 512 |
| `apple-touch-icon.png` | 180 |

`index.html` repointed off `shotgunning3.png`. `manifest.json` also picked up the real app
name (it still said *"Create React App Sample"* on a white background), portrait orientation,
and the board colour for `theme_color`.

`scripts/make-icons.py` is committed, so this is repeatable and nobody has to re-derive the
crop coordinates. **It only ever crops and scales** — the art is never regenerated.

Deleted `client/src/shotguning.png` and `shotgunning2.png` as instructed (zero references).
`client/public/shotgunning3.png` is now referenced only from the dead `App.css`, so it can go
whenever that does — I left both alone, since neither was in scope.

### ⚠️ Be honest about 16px

The wordmark is **4.1:1**. On a square canvas that means the art occupies about 21% of the
height, and I rendered the small sizes and looked at them:

- **48px** — reads fine.
- **32px** — `SH⬛TGUN` reads; `FORMATION` is a smear.
- **16px** — an amber-and-white smudge. Not legible as anything.

16px is the real browser-tab size on a non-retina display. This is a property of putting a
4:1 wordmark in a square, not something I can fix by cropping differently — cropping to the
`SHOTGUN` line alone makes the ratio *worse* (5.9:1), because the constraint is width.

**The fix, if you want one, is a dedicated small mark** — almost certainly the football-as-O
on its own, which is square, distinctive, and already part of the logo. I have not made one:
you said not to recut the art, and a new lockup variant is your call, not mine.

---

## Task 2 — The lockup on the Join screen

Full lockup, characters and all, on the one screen with room for it. Every other screen keeps
the quiet header treatment, which is what `docs/logo-lockup.html` specifies for anything
below ~150px.

**On "import from `art/`":** CRA cannot import from outside `src/` — `ModuleScopePlugin`
blocks it — so a literal import was not available. It is served from `client/public` as a
plain URL instead, which satisfies what I read as the actual requirement: a separately
fetched file, not another 927 KB of base64 in the bundle. The same script emits a **900px,
360 KB** web derivative; `art/` keeps the print-density original as the source of truth.

**On lazy-loading:** I did not use `loading="lazy"`. The governing requirement was *"it must
not block first paint"*, and an `<img>` never does. Lazy-loading the hero image of the first
screen would make it pop in after paint, which is worse. It carries `decoding="async"` and
explicit `width`/`height` so the layout is reserved and nothing jumps.

**Checked at 360, 390 and desktop.** The lockup has a hard `max-height` and gives up size
before the form does, so the room-code input cannot be pushed below the fold — at 360×780,
the narrowest case, both fields and both buttons sit well above it.

**One thing I fixed that was not in scope:** on desktop the join form was stretching the full
1180px that the game board needs, so `NAME` was a 1180px-wide input. Pre-existing since the
Session 7 port; the new logo just made it impossible to ignore. `.pad` is now capped at 460px
above 900px wide.

---

## Also

`client/src/assets/player-cutouts-clean.zip` (7.4 MB) had reappeared inside `client/src`.
Moved to `art/`, consistent with your Session 8 decision. `client/src` is 3.5 MB.

---

## State

- **159 tests, green.** No game logic changed this session, so the count is unchanged.
- Client build clean, no new warnings.
- Screenshots re-taken; join screen verified at all three widths.
- **Nothing pushed. The merge and deploy remain yours to run** — `DEPLOY.md` is current as of
  `904f9d8` and the commands still apply, with `git log --oneline -1` now expecting `c144cc3`.

## What needs you

1. **The First Down decision.** Five cards on the box versus a Ref-only global in the app.
   Everything else this session is cosmetic; this one changes the game.
2. **Whether you want a dedicated small mark** for the 16px favicon.
3. **The deploy** — still unrun. Production is still on `e994b5f`, where a second room
   starting a game takes the server down.
