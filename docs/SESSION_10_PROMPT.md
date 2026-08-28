# Session 10 — Four fixes from live play

Small session. Four items, all found playing the real app. Then hand back.

Rules unchanged: **no push, no merge, never touch `main`.** All tests stay green. Commit and
tag. Leave `.claude/settings.local.json` alone.

---

## 1. Avatars still show white edges — replace the file

`client/src/components/Avatars.js` was cut from the **old white-background sheet**, so every
avatar carries a white fringe on the dark tiles. The logo doesn't, because it was cut from
the transparent source.

**A replacement `Avatars.js` is being handed to you, re-cut from the background-free art.**
Drop it in as-is. Same exports, same API, same ten characters, same ring colours — only the
image data changed, so nothing else should need editing.

**Do not regenerate, re-cut, or "clean up" this art.** Verified before handoff:
`AVATARS.length === 10`, ten unique characters at a ten-player table, `'Tommy'` matches
`' tommy '`.

Check it renders with no white halo at avatar size on the standings rows, the player tiles,
and the drink assigner.

## 2. "Keep my hand" at the end of a quarter doesn't work

At the quarter break each player may swap **one** Wild card — or keep their hand. Choosing to
keep does nothing / doesn't dismiss properly.

Reproduce first, then fix. Worth checking whether the client ever tells the server the player
declined, or just closes the modal locally — the swap guard added in Session 8 tracks a
per-player per-quarter allowance, and a decline that never reaches the server may leave that
allowance in a state the player can't get out of.

Failing test first: a player declines the swap, assert their hand is unchanged, the modal
closes, and the next quarter still offers them a swap.

## 3. The Ref can't back out of Declare Action

Once the Ref opens the Declare Action modal there is no way to close it and return to the
normal screen — no close button, no tap-outside-to-dismiss, no Escape.

Add a close affordance. Match the other modals in the rebuilt UI rather than inventing a new
pattern. Closing must **not** declare anything or start a round.

While you're there, check the same escape route exists on every other modal a player can open
— if any other one traps you, fix it and say which.

## 4. Round Results wording

Already reported: First Down currently reads like someone is about to point at you. It should
read plainly — *"First Down — everyone drinks!"* or similar. Same for any other copy that
describes the mechanic instead of the outcome. (You may already have this in flight; skip if
so and say so.)

---

## Then

Short report: what each bug actually was, test counts, anything that turned out to be a
different problem than described. Nothing pushed.
