# Session 19 — the game ends somewhere, and it's worth posting

Session 18 built a result card and discovered it has nowhere to live: `gameOver` announces and returns
everyone to the join screen. The most postable moment in the product currently evaporates.

This session builds that moment, and makes it shareable in the format people actually share in.

Branch off `session-18` — it owns the share module, the invite, the announcement slot and the age
gate, and this session extends all but the last of them.

Rules unchanged: 783 tests stay green, **no existing test may need modifying** — if one does, base
game behaviour changed; stop and say so. Commit and tag per item.

**Do not push.** Item 0 of Session 18 is still open and pushing more onto an undeployed `main` makes
the eventual untangling worse.

---

## The thing that shapes this session

**There is no web API that posts to Instagram Stories or Snapchat.** Those require a native app and a
registered app id. Do not go looking for one, and do not add a library that claims to have one.

What the web can do is hand the operating system a finished image file via `navigator.share({ files })`.
Instagram, Snapchat, Messages and everything else appear in that sheet **if the user has them
installed**. So the entire job is:

1. produce an image good enough that someone wants to post it, in the shape Stories expects
2. get it into the share sheet in **one tap**

That is it. Any design that involves a second screen, a preview step with a confirm button, or a
"choose where to share" menu of our own has already lost — the OS sheet is the menu.

---

## 1. The Game Over screen

Right now `gameOver` fires an announcement and drops everyone on the join screen. Replace that with a
real terminal screen.

### What it shows

- **Final standings**, all players, ordered — drinks and shotguns, the same numbers the result card
  carries. The winner should be unmistakable at a glance without needing to read the numbers.
- **The room code.**
- Two actions: **Share result** and **Play again**.

Nothing else. No stats breakdown, no round history, no "best moment." It is a curtain call, not a
report.

### Behaviour

- **Everyone** sees it, not just the Ref. Every player is a potential poster.
- It **persists** — it does not time out, auto-advance, or dismiss on a tap. Someone will be reading
  it while their friend is still pouring a drink. The existing announcement modal's no-auto-close
  discipline is the right precedent.
- **Play again** returns to the lobby with the same room and the same players where that is possible;
  otherwise the join screen with the code prefilled. Say which you implemented and why.
- **Reconnecting into a finished game** lands on this screen, not on an empty join form. Someone whose
  phone died in the fourth quarter should still see how it ended — and still be able to share it.
- If a live game is attached, **detach cleanly** here.

### Where the result card goes

The Session 18 card currently sits alongside the standings as a fallback. It belongs here. **Share
result** on this screen produces it.

Tag `phase-19-game-over`.

---

## 2. The story card — 1080×1920

The existing card is 1080×1350, which is right for a feed post and wrong for a Story. A Story crops
and pads a 4:5 image, and the result looks like something that was posted somewhere else first.

Extend the **existing** canvas module — do not fork it. Same drawing primitives, same font-loading
discipline, same fallbacks. A size parameter, and a layout that reflows for the taller frame.

### What changes at 9:16

- **Vertical room.** The wordmark can breathe at the top, the standings sit in the optical centre, the
  URL anchors the bottom.
- **Safe margins matter.** Instagram and Snapchat both overlay chrome — profile, reply bar, close
  button. Keep everything meaningful inside roughly the middle 80% vertically and 90% horizontally.
  Anything in the top or bottom 10% will sit under a UI element on someone's phone.
- **The URL must survive the crop.** It is the only part of the image doing commercial work.

### Which one to produce

**Produce the 9:16 card. One card, one tap, no picker.** Offering a choice of formats is a decision
the sharer does not want to make, and Stories is where this gets shared.

If you disagree after seeing both rendered, say so with the PNGs attached rather than building a
toggle.

Tag `phase-19-story-card`.

---

## 3. Sharing mid-game

A game runs long. The best moment is often not the end — it is someone taking ten drinks in a round.

### Where it lives

In the existing menu, **available to every player at any time during a game.** Not a new button
competing with the round controls; the round screen is already the busiest thing in the app and
nothing may make pouring harder.

### What it produces

A 9:16 card showing the game **as it stands right now**: current standings, the room code, the URL.
Same module, live numbers instead of final ones.

**It must respect the anonymity rule.** Round Results are anonymous by deliberate product decision —
"X drank N", never "X gave Y" — and a share card is the most public surface in the product. It shows
standings. It does not show who gave what to whom, ever, and a test should make that structurally
true rather than a thing to remember.

### One honest constraint

Mid-game numbers are a snapshot. Do not put a timestamp or a quarter label on the card implying
otherwise — it will be posted five minutes later either way, and a stale clock on the image is worse
than no clock.

Tag `phase-19-midgame-share`.

---

## 4. Getting someone's attention without notifications

**Owner's decision: no Web Push.** It does not work in an ordinary iOS Safari tab — it requires the
site be added to the Home Screen first — so it would mean asking a stranger to install a pseudo-app
and grant a permission, at the door, in a product whose promise is "no app, no signup." Not worth it.

Do the cheap version instead, which covers the actual case — someone flicked to another app for ten
seconds and a round started.

### Two sounds, and they must be distinguishable across a noisy room

**Owner wants these audible this week, so they ship on by default at low volume** — not muted. That
reverses the usual caution deliberately: a sound nobody has heard cannot be tuned, and the first real
party is the test.

| When | Character |
|---|---|
| **Round starts** | A **buzz** — short, low, insistent. The "look at your phone" sound. |
| **Round ends** | A distinctly different **resolving tone**. Higher, softer, falling. The "that's done" sound. |

The two must be **unmistakable from each other** when heard from a pocket, once, over a television and
nine people talking. If they are close in pitch or length, they read as one sound and the feature is
pointless. Play them back to back and check this yourself before committing.

Keep them **short — around 150–400ms.** A long sound in a room of nine phones slightly out of sync is
a mess.

### Generate them, do not ship audio files

Use the **Web Audio API** — an oscillator, a gain envelope, done. No `.mp3` or `.wav` assets.

Three reasons, and the third is the one that matters:

- Nothing added to a bundle that phones on cellular are already waiting on.
- No decode latency and no first-play stall.
- **Pitch, length and volume become constants you can tune in one line** after the first real game
  night, which is exactly what is going to happen.

Put those constants together at the top of the module, named, with a comment saying they are expected
to be tuned after a live test.

### Volume and the toggle

- **Default volume low** — start around `0.15` gain and say what you chose. It should be audible from
  a pocket and not startling in a quiet room.
- An obvious **on/off toggle** in the menu, remembered per device. Someone whose phone is the party
  speaker will want it off within about four seconds.
- No volume slider. One toggle. This is a drinking game, not a mixing desk.

### The autoplay unlock — the part that will silently not work

Browsers block audio until the user has interacted with the page, and **iOS Safari is the strictest**.
An `AudioContext` created before a gesture starts `suspended` and every sound fails silently — no
error, no console warning, nothing to debug.

So: **create or resume the `AudioContext` on the first real user gesture** — joining the room or
tapping through the age gate both qualify, and both happen before any round starts. Do not create it
at module load.

Verify by actually hearing it, on a real iPhone, with the phone locked and the tab backgrounded. This
is the single most likely thing in this session to pass every test and be silent in your hand.

### The rest

- **A flashing tab title** while the tab is hidden, cleared on focus. `document.hidden` and the
  `visibilitychange` event, nothing more.
- **`navigator.vibrate`** where supported — Android only, iOS Safari does not implement it.
  Feature-detect, do not assume.
- **No permission prompt.** None of the above needs one. If an approach needs one, it is the wrong
  approach for this session.

Tag `phase-19-attention`.

---

## What this session is not

- Not Web Push, service workers, or a PWA manifest. Explicitly out.
- Not a native Instagram or Snapchat integration. Not possible from the web; see the top of this file.
- Not analytics on shares. If share volume needs measuring that is a separate, deliberate decision.
- Not a change to rounds, pouring, scoring, the deck, or the live feed.

---

## Then

Report:

- **The Game Over screen as a rendered screenshot**, at 390px and desktop, with 3 players and with 10.
  This is a visual deliverable and a description will not do — this project has lost three sessions to
  things that passed tests and looked wrong.
- **The 9:16 story card as a PNG**, and say plainly whether it survives Instagram's chrome. If you can,
  mock the overlay rectangles onto a copy to check.
- What "Play again" actually does, and what a reconnect into a finished game lands on.
- Whether the anonymity constraint on the mid-game card is structural or merely implemented.
- **The two sounds: their frequencies, envelopes, lengths and the default gain**, so they can be tuned
  from the report without reading the code. And confirmation that you heard both on a real phone —
  backgrounded — not just that the code path ran.
- Test counts before and after.
- Anything above that turned out to be wrong.

Then stop. And note the deploy status — none of this is reachable by a stranger until Render builds.
