# Session 18 — the share card, the one-tap invite, the announcement slot, the age gate

Everything here is about the **doors into the game and the moment people leave it**. None of it changes
how a round is played.

Read `docs/LIVE_GAME_PLAN.md` only if you need context on the room header; this session does not touch
the feed.

Rules unchanged: all existing tests stay green, and **no existing test may need modifying** — if one
does, you have altered base game behaviour; stop and say so. Commit and tag per item.

**Do not merge or push.** `main` is currently ahead of what is deployed and that is being untangled
separately — adding to the pile makes it worse.

**Branch off `phase-18-demo`, not `main`.** That branch is unmerged and owns the `/how-to-play` route
switch in `client/src/index.js` plus the links in `JoinScreen` and `LobbyScreen`. This session touches
routing and the lobby too, so branching off `main` guarantees a conflict in all three files.

---

## The thing that shapes all four items

Every one of these is on the **critical path of a stranger's first thirty seconds**. A bug in the deck
costs a laugh. A bug here costs the player entirely — they close the tab and nobody ever knows.

So: each item must **fail open**. If the share sheet is unsupported, if the canvas render throws, if
the announcement config is malformed, if the age gate's storage is unavailable — the player still gets
into the game. Nothing in this session may become a thing that stands between someone and a room.

Say in the report where each item falls back to, and prove it with a test.

---

## 1. The end-of-game result card

**The single highest-value item in this session.** People already screenshot the leaderboard. This
gives them something built to be screenshotted, with the URL in it.

### What it contains

- The wordmark
- Final standings: every player, ordered, with **drinks and shotguns**
- The room code
- `shotgunformation.com`

Nothing else. No timestamp, no "powered by", no QR. It has to survive being viewed at thumbnail size
in a group chat, which means large type and few elements.

### Where it appears

At game end, alongside the existing final standings — not replacing them. One clearly-labelled action:
**Share result**. Every player sees it, not just the Ref; the whole point is that six people post it,
not one.

### How to build it

**Draw it with the Canvas 2D API. Do not add `html2canvas` or `dom-to-image`.** Those libraries
re-implement CSS layout approximately, break on the first flexbox edge case, and add ~200KB to a bundle
that phones on cellular are already waiting on. A fixed-layout card of a wordmark and a list is maybe
120 lines of imperative canvas drawing and it renders identically everywhere.

Fixed output size, 1080×1350 (portrait, the shape every messaging app previews well). Render at 2×
and scale, or the text will look soft.

**Fonts are the trap.** Canvas will silently substitute a fallback if the webfont has not finished
loading, and you will not notice on a warm cache. `await document.fonts.ready` before drawing, and
have a test that asserts you waited.

### Sharing it

1. **`navigator.share({ files: [...] })`** where supported — guard with `navigator.canShare({ files })`,
   which is the only reliable feature test. This is the good path on iOS Safari and Android Chrome and
   it is what most players will get.
2. **Fallback: render the canvas into a visible `<img>`** with a line telling them to press and hold to
   save. Do not use a hidden `<a download>` — it does nothing useful on iOS.
3. If the canvas render throws for any reason, the standings screen is unchanged and no share control
   is shown. Never a broken button.

### Tests

- The card renders with 2 players and with 10, and nothing overflows the frame at either.
- A very long player name is truncated rather than running off the edge or overlapping the numbers.
- Zero drinks, and a player with shotguns but no leftover drinks, both render sensibly.
- Fonts-not-ready path does not draw.
- `canShare` false → the `<img>` fallback appears; canvas throw → neither appears and standings are
  intact.

Tag `phase-18-result-card`.

---

## 2. The invite has to be one tap

Today the host reads a code out loud. That is where players are lost.

### The share action

Ref-facing, on the lobby screen, prominent. Uses `navigator.share({ text })`, falling back to
**copy to clipboard with visible confirmation** — the confirmation matters, a silent copy reads as a
dead button.

### The message

It has to read correctly when it lands in iMessage with no editing. Draft:

```
Shotgun Formation — join my room

Code: ABCD
https://shotgunformation.com/?room=ABCD

No app, no signup. Just open the link.
```

Two things about that:

- **The link already carries the room code** and, since the share-link fix, the join screen reads it
  back and prefills. The code is written out as well on purpose — for the person who retypes it, and
  for the person whose client mangles the URL.
- **`shotgunformation.com` may not be serving yet.** The domain is registered but DNS/Render
  verification is in progress. Put the host in **one exported constant** so it is a one-line change,
  and until it verifies, that constant holds the `onrender.com` host. Do not scatter the domain through
  the codebase.

### Verify the round trip

Not by unit test — by actually opening the produced URL in a real browser and confirming a second
player lands on a prefilled, **editable** join screen and gets in. The read-only-field bug from an
earlier session came from exactly this path being assumed rather than walked.

Tag `phase-18-invite`.

---

## 3. "No app, no signup" on the join screen

One line, quiet, under the join form. Not a banner, not a badge, not a callout.

It is doing real work — a stranger handed a link by a friend does not yet know this isn't going to ask
them to install something — but it does that work by being present, not by being loud.

Fold this into the `phase-18-invite` commit.

---

## 4. The returning-player announcement slot

**Deliberately unglamorous, and the reason it exists is worth writing down:** there is no email list by
design, so on the day the physical deck ships, the app is the *only* channel to the people who played.
This banner is that channel. It costs almost nothing now and cannot be retrofitted later, because the
players will already be gone.

### Shape

- A **dismissible banner on the join screen**. Never over the game.
- Content comes from **server config, not a deploy** — an environment variable read at boot is enough,
  and it is what Render makes easy. Server sends it to the client on connect; the client renders it if
  present.
- Fields: an id, a short line of text, and an optional link. **Text only — no HTML.** Anything that
  renders server-supplied markup in a client is a hole, and this one would be reachable by anyone who
  ever gets at the config.
- Dismissal is **per announcement id**, stored in `localStorage`. A new id shows again; the same id
  stays dismissed. Storage unavailable → banner shows every time, which is the harmless failure.
- Absent, empty, or malformed config → **nothing renders, no error, no gap in the layout.** Default
  state is invisible.

### Tests

- No config → join screen is byte-identical to today.
- Config present → banner shows; dismiss → gone; reload → still gone.
- New id after a dismissal → shows again.
- Malformed config (not JSON, missing fields, wrong types) → nothing renders and the server still boots.
- Text with HTML/script in it is rendered as literal text.

Tag `phase-18-announcement`.

---

## 5. Age gate

Before the join form, on first visit.

**21, not 18.** This is a US drinking game and 21 is the number that matters here.

### Shape

- Self-attestation. **Ask for date of birth**, not a yes/no button — a yes/no is one thoughtless tap and
  a date entry is a deliberate act, which is the entire legal and ethical difference between the two.
- **Store nothing.** Compute the age client-side, keep a boolean in `localStorage`, discard the date.
  Never send it to the server, never log it. A date of birth is personal data and this app has no
  business holding one.
- Under 21 → a plain, non-punitive screen. No retry loop that teaches them to enter a different year;
  no shaming.
- One-time per device. It must not appear again for a returning player, and it must not appear
  mid-game — a gate that fires on a reconnect at 11pm is a bug that loses a player permanently.
- Storage unavailable → **show the gate**. Failing closed is correct on this one, and it is the only
  item in this session where that is true.

### Where it sits — read this twice

The gate goes in front of **entering a room**. It does **not** go in front of the site.

Those two read identically in prose and are not the same thing, and getting it wrong is the most
damaging mistake available in this session.

- **`/how-to-play` must never show the gate** — in any variant (`?clean=1`, `?vertical`, `?beat=`).
  That route is a public marketing page reached cold from social by people who have never joined a
  room and may never join one. A date-of-birth wall in front of it destroys the only thing it is for.
- **The landing page: no gate.**
- The gate fires when someone **acts to enter a room** — including arriving on a `?room=` link, which
  lands on a prefilled join screen rather than entering directly.
- The `?room=` param must **survive** the gate. Someone tapping a friend's link passes the gate once
  and lands on the prefilled join screen, not an empty one. That is the regression most likely to come
  out of this item.

`index.js` already has `isDemoRoute(window.location.pathname)`, matching regardless of query string.
A gate placed around `<App />` there leaves the demo untouched by construction. A gate placed inside
`JoinScreen` would also miss the `?room=` arrival path. Neither position is obviously right — say
which you chose and why.

### Tests

- `/how-to-play?clean=1&vertical` on a **first visit with storage cleared** renders the demo with no
  interstitial. Same for `/how-to-play`, `?clean=1`, `?beat=8`, and the landing page.
- First visit → gate. Pass → join screen. Reload → no gate.
- Under-21 date → blocked, and no route around it by reloading.
- `?room=ABCD` + first visit → gate → join screen **still prefilled with ABCD**.
- Gate never appears during an active game or on reconnect.
- No date of birth in any socket payload, any log line, or anything persisted server-side.

Tag `phase-18-age-gate`.

**I am not a lawyer and neither are you.** This is the standard shape for the category, and it is
better than nothing by a wide margin, but do not let anything in the report read as a compliance
claim. It is a good-faith gate.

---

## What this session is not

- Not analytics. No counters, no tracking, no third-party script. If it turns out shares need
  measuring, that is a separate decision made deliberately.
- Not a signup, an account, or an email capture, in any form, anywhere. That is the owner's explicit
  standing decision and item 4 exists precisely so it can stay that way.
- Not a change to round flow, the deck, scoring, or the live feed.

---

## Then

Report:

- What the result card actually looks like — **attach a rendered PNG at 2 players and at 10.** A
  description is not sufficient for this item; it is a visual deliverable and this project has been
  bitten three sessions running by things that passed tests and looked wrong.
- The exact invite text produced, pasted verbatim.
- The fallback path taken on each of the four items and how each was proven.
- Whether the `?room=` param survives the age gate, walked in a real browser, not asserted in a test.
- Test counts before and after.
- Anything above that turned out to be wrong.

Then stop.
