# Source art

Kept in the repo, deliberately **outside `client/`**.

The app never loads any of this at runtime — the ten avatars are inlined as data
URIs in `client/src/components/Avatars.js`, and the can mark in
`client/src/components/CanMark.js`. These are the originals they were cut from.

They used to live in `client/src/assets/`, which meant CRA walked ~9 MB of PNGs
and a zip on every build and every hot reload, for files no bundle has ever
referenced. Moving them here costs nothing and keeps the history.

| File | What it is |
|---|---|
| `players-sheet-source.png` | The ten-character source art |
| `avatars-contact-sheet.png` | All ten at avatar size, for eyeballing |
| `player-cutouts.zip` | Head and full-body cutouts, for future design work |
| `logo-reference-source.png` | Logo reference — design track, not the app |

**If you regenerate the avatars, regenerate `Avatars.js` — not these.** And note
that `Avatars.js` must keep exporting `AVATARS`, `RING_COLORS`, `hashName`,
`assignAvatars` and `avatarFor`; a previous drop-in removed the can mark and
broke the build, which is why the can now lives in its own module.

---

## ⚠️ If you regenerate `client/src/components/Avatars.js`

That file is **DATA ONLY**: the `AVATARS` array. Nothing else may live in it,
because a drop-in replacement silently reverts whatever does. It has happened
twice:

| Drop | What it silently removed | Where that code lives now |
|---|---|---|
| First | the `CAN` export — the header logo and every shotgun icon; eight files import it and the build broke | `client/src/components/CanMark.js` |
| Second | the ring-collision fix, so two players could share a character **and** a ring | `client/src/lib/avatars.js` |

Both were moved out rather than re-patched, and both then survived the next
drop. So:

- **Regenerate freely.** Replacing `Avatars.js` wholesale is safe now.
- **Keep exporting `AVATARS`** as `[{ id, label, ring, src }]`. That is the only
  contract.
- `hashName`, `assignAvatars`, `avatarFor` and `RING_COLORS` are in
  `client/src/lib/avatars.js`. Do not put them back in the generated file.
- `tests/ui/avatars.test.jsx` guards the rules and will fail loudly if a drop
  breaks them.
