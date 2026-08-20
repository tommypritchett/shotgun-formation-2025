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
