# Session 9 — Wire in the finished logo, then stop

Small session. The logo art is finished and approved. Three tasks, then hand back.

Rules unchanged: **no push, no merge, never touch `main`.** All 159 tests stay green.
Commit and tag. The deny rules in `.claude/settings.local.json` stay exactly as they are —
you were right not to edit them to unblock yourself.

---

## What's new on disk

| Path | What it is |
|---|---|
| `art/shotgun-logo-transparent.png` | **The finished logo.** Transparent PNG, ~3× density. Box front, packaging, merch, the app. |
| `art/football-cutouts.zip` | All 10 characters, transparent, ~640px. Print-ready. |
| `docs/logo-lockup.html` | The logo system — primary, on-white, wordmark-only, and where each is used |

The lockup is the box mark unchanged — SH⬛TGUN with the football as the O, FORMATION in
amber, chalk play diagram above — with five characters standing on it.

**Do not regenerate, recut, or "clean up" any of this art.** It went through many rounds
and the current cut is correct. Use the files as they are.

## Task 1 — Replace the app's favicon and home-screen icon

`client/public/index.html` currently points `icon` and `apple-touch-icon` at
`shotgunning3.png` — a leftover from the old build.

Generate proper icons **from `art/shotgun-logo-transparent.png`**, using the wordmark-only
crop, not the full lockup — at 32px the characters are mush (that's documented in
`docs/logo-lockup.html`). Standard set: `favicon.ico` (32), `logo192.png`, `logo512.png`,
plus `apple-touch-icon` at 180. Dark background, not transparent, so it doesn't disappear on
a dark home screen.

Delete the two dead images while you're there — `shotguning.png` and `shotgunning2.png`
have zero references anywhere in the client.

## Task 2 — Use the lockup on the Join screen

The Join screen is the only place the full lockup belongs in the app — it's the one screen
with room for it, and it sets the tone before anyone's playing. Everywhere else keeps the
existing header treatment.

Import from `art/`, don't inline another copy as a data URI — `Avatars.js` and `CanMark.js`
already carry ~420 KB between them and this is a single decorative image. Lazy-load it if
that's straightforward; it must not block first paint.

Check it at 360px, 390px and desktop. The lockup must not push the room-code input below
the fold on a phone — if it does, scale it down rather than moving the input.

## Task 3 — Reconcile the deck spec with the printed box

`docs/SPEC.md` and `PHYSICAL_GAME_PLAN.md` say **156 cards with one First Down card**. The
printed box artwork says **160 cards**, and its back-panel breakdown reads: 105 Standard,
45 Wild, 5 First Down, 1 Ref, 2 Rules, 2 blank House Rule — which sums to exactly 160.

**The box is canon.** Update the docs to match, and flag clearly in your report that
**five First Down cards is a rules change, not a typo**: today First Down is a Ref-only
global action. Five copies implies players can hold them. Do **not** implement anything —
`cards.js` and `generateDecks()` in `server.js` stay exactly as they are. This is a
documentation fix plus a decision the owner needs to make for the physical deck.

## Then stop

Short report: what changed, test counts, and the First Down question stated plainly.
Nothing pushed. The merge and deploy stay the owner's to run.
