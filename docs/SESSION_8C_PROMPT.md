# Session 8C — the real avatars are on disk now

Follow-on to `docs/SESSION_8B_PROMPT.md`. That prompt told you a replacement `Avatars.js`
was coming. **It has arrived and is already in the repo.** Run this after 8B's item 2, or
now if you've reached 8B's avatar section — this supersedes it.

Same rules: **no push, no merge, never touch `main`**. All tests stay green. Commit and tag.

---

## The files are already written. Wire them up; do not create or regenerate them.

| Path | What it is |
|---|---|
| **`client/src/components/Avatars.js`** | **Written and verified. 10 avatars as inlined data URIs. Do not overwrite.** |
| `docs/avatars-contact-sheet.png` | All 10 at avatar size, for eyeballing |
| `client/src/assets/players-sheet-source.png` | Original 10-character source art |
| `client/src/assets/logo-reference-source.png` | Logo reference — design track, not app |
| `client/src/assets/player-cutouts.zip` | Head + full-body cutouts, for future design work |

The ten: Shotgun, Beer Bong, Double Fist, Keg Stand, Party Bucket, Chugger, Tailgate Toast,
Beer Splash, Funnel Force, Victory Pour.

`Avatars.js` exports:

```js
AVATARS        // [{ id, label, ring, src }] — ten entries
RING_COLORS    // ring colour per avatar
hashName(name) // stable FNV hash, case- and whitespace-insensitive
assignAvatars(players)  // name -> { ...avatar, index, ring }; no duplicates while supply lasts
avatarFor(name)         // single lookup when the roster isn't to hand
```

Verified on this machine before handoff: `AVATARS.length === 10`, ten unique characters at a
ten-player table, `'Tommy'` and `' tommy '` resolve identically, module parses clean.

## What to do

1. **Replace the old 8-avatar map** everywhere an avatar renders — `PlayerRow`, `PlayerTile`,
   `ScoreBoard`, `DrinkAssigner`, and anywhere else. Prefer one `assignAvatars(players)` per
   roster render over per-player `avatarFor`, so the no-duplicates guarantee actually holds.
2. **Nothing hardcodes the count.** No literal `8`, no literal `10`, no `% 8`. Derive from
   `AVATARS.length`, so a future sheet drops in with zero other edits.
3. **Render the accent ring.** Each assigned avatar carries `ring` — use it as the avatar
   border. It's what separates two players if they ever share a character. Do **not**
   substitute amber, neon or red; those are reserved for deck semantics.
4. The images are transparent-background and head-framed, sized to sit on the dark tile.
   Don't add a white plate behind them.

If 8B already landed a generic refactor, this should be mostly deletion — confirm the count
comes from the map and the ring renders, and move on.

Test: 13 players. Assert assignment is deterministic by name, the first 10 are unique
characters, and ring colours differ wherever a character repeats.

Tag `phase-8c-avatars`.

---

## Two things to flag in the report, not fix

**A. The box says 3–10 players; the app allows up to 13.** The printed box artwork reads
"3–10 PLAYERS · 160 CARDS". The server has no upper bound and the UI carries layout classes
up to `players-13-plus`. Change nothing — just say whether capping the app at 10 would break
anything, so the owner can decide whether app and box should agree.

**B. Repo weight.** `client/src/assets/` adds ~9.6 MB on top of ~9 MB of `screenshots/`. The
avatars are inlined in `Avatars.js`, so the app never needs those source files at runtime.
Recommend only: gitignore them, keep them, or move them out of `client/` so CRA stops walking
them every build.
