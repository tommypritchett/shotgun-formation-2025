# Shotgun Formation — Design System ("Playbook Chalk")

The app and the printed deck are the same product in two formats. A card on
screen and a card in your hand should be recognisably the same object: same
mark, same value chip, same colour, same layout.

`src/components/CardIcon.jsx` and `src/data/cards.js` are the shared source of
truth. **Do not invent new icons, card names, or drink values.**

---

## 1. Tokens

Declare these once as CSS custom properties on `:root`. Nothing in the app
should contain a raw hex value after the rebuild.

```css
:root {
  /* surfaces */
  --sf-board:        #0D1017;  /* app background — chalkboard */
  --sf-board-2:      #151A23;  /* raised panels, modals */
  --sf-card-std:     #1D232E;  /* standard card field, top of gradient */
  --sf-card-std-2:   #0B0E14;  /* standard card field, bottom */
  --sf-card-wild:    #12301C;  /* wild card field, top */
  --sf-card-wild-2:  #050F09;  /* wild card field, bottom */
  --sf-card-field:   #0A0D12;  /* icon knockout colour */

  /* ink */
  --sf-chalk:        #F2EFE7;  /* all primary type — never pure white */
  --sf-muted:        #89909F;
  --sf-line:         rgba(242,239,231,.13);

  /* accents — these carry the whole system */
  --sf-amber:        #FFB020;  /* STANDARD deck */
  --sf-amber-ink:    #1A1002;  /* type on amber */
  --sf-neon:         #8AFF3D;  /* WILD deck — already canon in this app */
  --sf-neon-ink:     #08160B;
  --sf-blood:        #FF4A33;  /* 40-drink cards only. Scarcity is the point. */
  --sf-blood-ink:    #FFFFFF;

  /* type */
  --sf-display: 'Oswald', 'Arial Narrow', system-ui, sans-serif;
  --sf-body:    'Inter', system-ui, -apple-system, sans-serif;

  /* rhythm */
  --sf-r-sm: 8px;  --sf-r-md: 12px;  --sf-r-lg: 16px;  --sf-r-pill: 999px;
}
```

**Colour law:** amber means Standard, neon means Wild, red means four shotguns.
Never use an accent decoratively. A player should be able to tell what deck a
card belongs to from across a dark room, and colour is doing that job.

**Type scale:** display type (card names, headers, timers, values) is Oswald
700, uppercase, tight leading. Everything else is Inter. Two families, no more.

---

## 2. Card anatomy

Aspect ratio **2.5 : 3.5** — the real poker card proportion. Do not deviate;
these are the printed cards.

```
┌──────────────────────────┐
│ WILD              [🥫 1] │  ← deck label (accent) + corner value
│                          │
│                          │
│          ICON            │  ← CardIcon, ~34% of card width
│                          │
│                          │
│    ┌──────────────┐      │
│    │ 🥫 1 SHOTGUN │      │  ← SOLID filled pill, accent background
│    └──────────────┘      │
│      BIG PLAY 50+        │  ← Oswald 700 caps
│  ──────────────────────  │
│  Any single play gaining │  ← trigger text, Inter, muted
│     50 or more yards     │
└──────────────────────────┘
```

Rules:

1. **The value chip is a solid filled pill**, accent background with dark ink —
   not outlined text. This is the single most important legibility decision in
   the system. It survives being shrunk, photographed, and looked at drunk.
2. **Values ≥ 10 render as shotguns**, not drinks. Use `formatValue()` from
   `cards.js`. Never re-implement that math.
3. **The corner value mirrors playing-card convention** so a fanned hand is
   readable without spreading it.
4. **Trigger text always prints.** In the app it can be smaller or revealed on
   press, but it must exist — it's what makes the card self-documenting.
5. **Icons are solid fills, never thin outlines.** Outlines disappear at small
   sizes. This is why v1 of the design was thrown out.

### The squint test

Any card component must stay identifiable at **40% scale with the text hidden**.
Three signals have to survive: the icon silhouette, the chip colour, and the
number in it. Check this before calling a card component done.

---

## 3. What each screen needs

### Join / Initial
Currently plain inputs on a dark field. Should feel like a stadium gate: big
condensed type, the wordmark, one obvious primary action. Room code input wants
large tap targets and numeric keyboard (`inputMode="numeric"`).

### Lobby
Currently a `<ul>` of names. Should be a roster: player tiles filling in as
people join, the room code displayed large enough to read aloud across a room,
and a Start button that clearly communicates the 3-player minimum rather than
silently not appearing.

### Game screen — priority order for the rebuild

1. **Cards.** Highest impact. They're divs with a name and "3 drinks" today.
   Make them the real card object. Do this first.

2. **The drink assignment modal.** This is the most important 21 seconds of the
   game and it's currently a stack of full-width buttons reading "🍺 Give Drink
   to Steve (0)". It should be a grid of player tiles with a live count badge
   and a large "N left to assign" number. People are drunk and racing a timer —
   tap target size and the remaining count are everything. Keep the
   `onAssign(playerId, 'drink'|'shotgun')` interface exactly.

3. **The timer.** "⏰ Time Remaining: 7 seconds" should become a radial or bar
   countdown that shifts to `--sf-blood` under 5 seconds. It needs to be felt
   peripherally while you're watching the TV, not read.

4. **The scoreboard.** Two `<ul>`s today. This is a competitive drinking game —
   standings are the point. Make it the spine of the screen: ranked, with the
   leader visually distinct, drinks and shotguns as separate columns.

5. **Player tiles.** Currently an empty `.player-image` div. Give each player a
   generated identity — a colour and a jersey number derived deterministically
   from their name, so the same person looks the same every game.

6. **Motion.** Nothing moves today, so it's easy to miss that a round happened
   while you were watching the game. Card played, drinks landed, shotgun
   assigned — each needs a beat. Respect `prefers-reduced-motion`.

---

## 4. Layout constraints

- **Mobile first, one-handed.** Everyone is holding a beer. Nothing interactive
  below 44×44px. Primary actions in thumb reach.
- **Portrait phone is the design target.** Existing breakpoints at 480px and
  360px are real and used — keep coverage at both.
- **Dark only.** No light mode. This is played in a dim room with a TV on.
- **The layout must survive 3 to 13+ players.** The existing player-count class
  switches (`players-1-2` … `players-13-plus`) encode real requirements —
  replace the mechanism if you like, but keep the behaviour.

### ⚠️ `document.body.style.zoom = '70%'`

The current layout depends on this. It is non-standard, unsupported in Firefox,
and the entire grid is implicitly sized around it. **Removing it is required**
and it will visibly break layout until the grid is re-fitted to real viewport
units. Treat this as its own commit, verified at 360px and 480px, not as a
side-effect of another change.

---

## 5. Non-negotiables

1. Socket event names and payload shapes are frozen. Visual layer only.
2. Card values come from `cards.js`. Never hardcode a drink value.
3. Icons come from `CardIcon.jsx`. Never draw a new one without asking.
4. `formatValue()` owns the drinks-vs-shotguns rule. One implementation.
5. No light mode, no theming system, no component library. This is one product
   with one look.
