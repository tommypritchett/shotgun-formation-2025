# Playtest checklist — run this once Cursor reports green

Everything here needs **real devices and real people**. The 159-test suite covers the socket
contract; it has never opened a browser. These are the checks only you can do.

**Two phones + the laptop.** Tests 4, 6, 7 and 9 cannot be done with one device.

---

## 0. Pre-flight — 30 seconds, do not skip

If this is wrong, every test below is meaningless and test 9 hammers **production**.

- [ ] Laptop and both phones on the **same Wi-Fi**, **VPN off on all three**.
- [ ] Both servers running: `PORT=3002 npm start` and, in `client/`, `HOST=0.0.0.0 npm start`.
- [ ] **If the client dev server was running before `client/.env.local` existed, restart it.**
      CRA reads env files only at boot.
- [ ] Laptop → `http://10.0.0.42:3000` → DevTools → Network → **WS** filter → reload.
      The one WebSocket URL must start with `ws://10.0.0.42:3002/socket.io/`.
      **If it says `wss://shotgunformation.onrender.com`, stop and restart the client.**

Everything, every device: `http://10.0.0.42:3000`. Never `localhost`.

---

## The three you said you still need

### 1. Rejoin logic — the two separate bugs

**1a — a rejoining player must not blank everyone else's hand.**

4 players. Host declares a card so a round is live. Mid-round, close the tab on **phone B**
and rejoin with the same name.

- [ ] Phone A and the laptop **still show their cards** the whole time — no blank flash.
- [ ] Phone A can **still tap a card and assign a drink** while B is away.
      *(A hand that renders but can't be played is the actual symptom — check the tap, not
      just the picture.)*
- [ ] Phone B comes back with **its own** cards, not someone else's.
- [ ] Round ends normally, totals include drinks poured while B was away.

**1b — refresh mid-round and you can still pour.** This is the one that kept failing.

You are mid-round with the drink prompt on screen. **Refresh the browser.**

- [ ] The pour prompt **comes back** after reload.
- [ ] You can still assign your drinks, and they land in Round Results.
- [ ] Do it on a **phone** too, not just the laptop — arrival order differs on mobile.

### 2. Standings math — conversion happens once

- [ ] Pour someone exactly **9 drinks** in one round → Round Results reads **9 drinks**,
      no shotgun.
- [ ] Pour exactly **10** in one round → **1 shotgun, 0 drinks**.
- [ ] Pour exactly **11** in one round → **1 shotgun, 1 drink**.
- [ ] Now play a second round and pour that same player **5** more. Standings must read
      **1 shotgun, 6 drinks** — *not* re-converted, *not* "0 shotguns 16 drinks".
- [ ] Cross-check: the number on the **player tile** matches the number in **Standings**
      matches **Round Results**. All three, same player, same moment.
      *(This is the exact regression from before — two components each re-running the
      conversion on an already-converted total.)*

### 3. Ref handoff

- [ ] Hand the Ref to an **active** player → works, they get the Declare Action control,
      you lose it.
- [ ] Try to hand the Ref to a player who has **disconnected** (close their tab first) →
      **refused**, with a message. It must not silently succeed.
- [ ] The **current Ref disconnects** → the Ref moves to someone active automatically.
      **There is always a Ref** — at no point does the table have none.
- [ ] Ref leaves the game entirely (not just refresh) → same result.
- [ ] After a handoff, the **old** Ref can no longer declare.

---

## The Session 10 fixes

### 4. Avatars — no white boxes

The file was re-cut from the transparent art. What you're checking is that it actually shipped.

- [ ] **Full table, 10 players.** Ten **different** characters, nobody shares one.
- [ ] Zero white rectangles or halos behind any avatar, on **Standings rows**, **player
      tiles**, and the **drink assigner**. Check on a phone, dark screen — that's where the
      fringe showed.
- [ ] Leave and rejoin with the same name → **same character**. Different name → different one.

### 5. "Keep my hand" at the quarter break

- [ ] Quarter ends, swap modal appears. Choose **keep my hand**.
- [ ] The modal **closes**.
- [ ] Your hand is **unchanged** — same cards, same count.
- [ ] Play on normally; nothing is stuck waiting on you.
- [ ] **At the next quarter break you are offered a swap again.** *(If declining burned your
      allowance, this is where it shows.)*
- [ ] Also test the other branch: actually **swap** a card, confirm you get exactly one, and
      that you're offered another next quarter.

### 6. The Ref can back out of Declare Action

- [ ] Ref opens **Declare Action**, then closes it — X, tap outside, or Escape.
- [ ] Nothing was declared. No round started. Board is normal.
- [ ] Ref can then open it again and declare for real.
- [ ] Open **every other modal** a player can hit and confirm none of them trap you.

### 7. Round Results wording + undo

- [ ] First Down reads plainly — *"First Down — everyone drinks!"*. No copy that sounds like
      someone is about to point at you.
- [ ] Assign a drink, then **immediately** undo it → the drink is removed.
- [ ] Wait a couple of seconds, then try to undo → **refused**. Confirm the cutoff feels
      right in real play, not just that it exists.
- [ ] Undo then re-assign to a different player → only the second one counts in Round Results.

---

## Whole-game sanity

### 8. Play one full game, 4+ players, start to finish

- [ ] All cards visible **at once** — no sideways scrolling on a phone.
- [ ] A round that ends **without Lock In** still counts the pours you made.
- [ ] Standings auto-return after the results screen sits idle (~20s), and a new round or a
      manual tab tap cancels that.
- [ ] Host leaves mid-game → host moves on, game continues.
- [ ] Round Results stays **anonymous**: *"Marcus drank 2"*, never *"Shannon gave Marcus 2."*
      **This is deliberate — if it names the pourer, that's the bug.**
- [ ] 11th player is refused with a message, not a crash.

### 9. Two concurrent games — the reason you're deploying

Two rooms, both with a game **actually started**, on the same server at the same time.

- [ ] Start game in room A. Start game in room B. **The server stays up.**
- [ ] Room A's standings contain **nobody from room B**, and vice versa.
- [ ] Play a round in each. Both finish clean.

*(This is the crash that's live on production right now.)*

---

## 10. After you deploy — 60 seconds

Don't skip this; the LAN URL nearly shipped once already.

- [ ] Open the **live** site → DevTools → Network → **WS** → reload.
      The URL must be `wss://shotgunformation.onrender.com/...` and **must not** contain
      `10.0.0.42`.
- [ ] Join from a **phone on cellular**, off your Wi-Fi entirely.
- [ ] Repeat test 9 on production — two rooms, both started, server survives.
- [ ] Favicon and home-screen icon are the new mark, not the old football.

---

## If something fails

Write down: **which test, what you saw, what you expected, and how many players were in.**
That's what makes it reproducible in a test. A screenshot of the screen plus the server log
line at that moment is worth more than a description.

## Known and intentional — do not report these

- Round Results never names who poured. Product decision.
- Missing your wild-card swap because you were away at the quarter change. Intended cost.
- The 16px favicon is a smudge. Known — needs a dedicated small mark, which is your call.
