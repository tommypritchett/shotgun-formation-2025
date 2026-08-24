# Session 11 — Ref handoff to away players, and pours lost on reconnect

Two real defects from live testing, plus two bits of tidying. Then hand back.

Rules unchanged: **no push, no merge, never touch `main`.** All tests stay green. Commit and
tag. Leave `.claude/settings.local.json` alone.

**Naming from here on:** session files carry what they fixed, not just a number.

---

## What passed, so you don't re-litigate it

Owner ran the checklist. **Rejoin mid-round, standings math, avatars, keep-my-hand, Declare
Action close, First Down wording, and undo-pour all verified good on real devices.** Your
Session 10 work is confirmed. Two things failed; they are items 1 and 2 below.

---

## 1. The Ref can still hand the whistle to a player who isn't there

**Reproduced by the owner:** phone left the game ~3 minutes. Laptop, as Ref, opened the
handoff sheet, the phone was **listed**, and selecting it appeared to work.

The guards you'd expect are already in place — `server.js:913` refuses a disconnected
target, `App.js:2334` filters the sheet to `!p.disconnected`. **Do not add a third check.**
The checks are fine; the data reaching them is not. There are three separate defects here.

### 1a — the client's roster is stale, because the server deliberately says nothing

`server.js:1879-1882`, in the `disconnect` handler, game-started, non-host branch:

```js
// ✅ FIXED: If a non-host player disconnects, minimal notification (no heavy state updates)
console.log(`📡 Non-host player ${leavingPlayer.name} (${socket.id}) disconnected...`);
// Don't broadcast playerDisconnected - causes unnecessary UI churn for other players
```

It sets `players[playerIndex].disconnected = true` in server memory and broadcasts nothing.
Every other client keeps a roster where that player is `disconnected: undefined` — for the
rest of the game, unless some unrelated event happens to trigger an `updatePlayers`.

So `!p.disconnected` passed on stale data. **The tell:** the sheet currently *filters away
players out entirely*, and the owner still saw the phone listed. That is only possible if
the laptop never learned it had gone.

Fix the broadcast. The comment's worry about "UI churn" was about heavy state payloads —
`updatePlayers` is the roster, it is already sent from eleven other sites, and the roster
genuinely changed. Send it. If you believe a lighter targeted event is better, say why in
the report rather than deciding silently.

Check the same hole on the **reconnect** side: when that player comes back, does everyone
else learn they are `disconnected: false` again? If that broadcast is missing too, the row
stays greyed forever, which is the same bug wearing a different hat.

### 1b — the client assumes the handoff succeeded

`handleSelectNewHost` in `App.js`:

```js
socket.emit('assignNewHost', { roomCode, newHostId: playerId });
setIsHost(false);   // ← before the server has answered
setIsHostSelection(false);
```

If the server refuses, the Ref's own screen still drops the whistle. Now nobody at the table
believes they are Ref, only the Ref can declare, and the game stops — from a path whose whole
purpose was to prevent exactly that.

Host status must change **only** on the server's `newHost` event. On refusal the sheet should
stay open with the error, and the Ref keeps the whistle. This may well be what the owner
actually observed, so fix it even though 1a alone explains the listing.

### 1c — show away players, don't hide them

**Owner's decision, and it changes current behaviour:** the sheet should list *everyone*,
with away players rendered greyed, labelled **AWAY**, and not clickable. Today they are
filtered out, which reads as "they left the game" when they haven't.

Keep the empty state you added for when nobody is available.

**Explicitly out of scope: do not change any leave, rejoin, or disconnect-timing logic.**
A player who drops still holds their seat and their drinks. This item is about what the
handoff sheet is allowed to offer, nothing else.

### Tests

- Non-host disconnects mid-game → every other client's roster shows them `disconnected: true`.
- They reconnect → every other client's roster shows them `disconnected: false`.
- Handoff to a disconnected player is refused **and** the refusing Ref still has `isHost`.
- Handoff to an active player succeeds and the old Ref loses it only after `newHost` lands.

Tag `phase-11-ref-handoff`.

---

## 2. Pours already given are wiped on reconnect

**Reproduced by the owner.** Pour nothing, refresh mid-round → prompt returns, you can pour.
Pour **two of four**, refresh → the outstanding drinks are gone, reported as zero.

Refresh is not the point. It is the cheap way to simulate a phone dying, and that is the case
that matters: drop out with drinks outstanding and those drinks never get poured.

### The structural cause

`server.js:207-208` writes the pour record **once**, when the card is played:

```js
if (!round.pending) round.pending = {};
round.pending[playerName] = payload;
```

Nothing mutates it afterwards — not `assignDrinks`, not undo. Meanwhile the running count of
what has actually been poured lives **only in the browser**, in `localPoursRef` /
`sentPoursRef`.

Two numbers, one of which survives a reconnect. Pour nothing and they agree — which is
exactly why that case works. Pour some and they diverge, and nothing anywhere reconciles them.

### The fix

**Make `round.pending[playerName]` mean *what you still owe*, not *what you were originally
told*.** Decrement it in `assignDrinks` as pours land; increment it back on undo. Then the
replay at `server.js:670` and `:1698` sends the truth, and both cases fall out of one path.

Mind the shotgun fold. `assignDrinks` folds every ten drinks into a shotgun as it
accumulates, and undo borrows a shotgun back — the remainder bookkeeping has to survive both
without going negative or double-counting. That interaction is where this will break if it
breaks.

### Reproduce before you fix

**I can explain why the two numbers diverge. I cannot explain from the code why the result is
specifically zero rather than the full original amount being replayed.** Something else is
involved — most likely the client rebuilding pour state on reconnect, or arrival order
against `gameStarted`, which fires right after the replay at `server.js:695`.

Run it with the server log open. The `🎯 REPLAY:` line states exactly what was sent. If it
says *"owes nothing this round"*, the cause is server-side and my account above is incomplete
— say so plainly rather than making the fix fit the story.

### Tests

- Told to pour 4, pour 2, disconnect, reconnect → prompted for **2**, and can pour them.
- Those 2 land in Round Results and in the recipients' totals.
- Pour 0, disconnect, reconnect → prompted for **4**. (Regression guard: this works today.)
- Pour all 4, disconnect, reconnect → prompted for **nothing**, and no double-count.
- Pour 2, undo 1, disconnect, reconnect → prompted for **3**.
- One that crosses the fold: enough drinks to trigger a shotgun, disconnect mid-pour,
  reconnect, finish. Recipient totals must be correct and never negative.

Tag `phase-11-pour-persistence`.

---

## 3. Escape on all six modals

**Owner's answer to your question: yes, add it to all six.** Escape working on four sheets
and not the other two is its own bug.

**Do not add scrim-click-to-dismiss.** On a phone an accidental edge tap during drink
assignment would throw away a half-finished pour — worse than the trap you just fixed.
Explicit Cancel plus Escape is the pattern.

---

## 4. Remove two junk files that were committed by accident

`_to_delete/git-index.lock.stale` and `_to_delete/git-next-index-14.lock.stale` were swept
into `eabde5e`. They are stale git lock files from a failed write through the file bridge,
32KB of binary with no purpose. `git rm` both and drop the folder.

While you're there: `Avatars.js` **did** land last session and you committed it yourself in
`eabde5e` (415,759 → 425,109 bytes). Your 0.6% near-white measurement was of the new cut, so
it confirmed the art rather than contradicting it. Owner has verified no fringe on device.
Note it in the report so nobody re-opens it.

Also confirm there is exactly **one** implementation of the name→avatar hash. You added
`client/src/lib/avatars.js` in the same commit while `Avatars.js` already exported
`hashName`, `assignAvatars` and `avatarFor`. A shadowed second copy would silently break
"same name, same character every game" — which is hard to notice and annoying to diagnose.

---

## Then

Short report: what each bug actually was, what the `🎯 REPLAY:` log showed, test counts, and
anything that turned out to differ from the account above — including where I was wrong.
Nothing pushed. The merge and deploy stay the owner's to run.
