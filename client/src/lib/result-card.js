/**
 * The end-of-game result card — the thing people post.
 *
 * Drawn with the Canvas 2D API on purpose. `html2canvas` and `dom-to-image`
 * re-implement CSS layout approximately, break on the first flexbox edge case,
 * and add ~200 KB to a bundle phones on cellular are already waiting on. A
 * fixed-layout card of a wordmark and a list is a few dozen lines of imperative
 * drawing and renders identically everywhere.
 *
 * ── The font trap ────────────────────────────────────────────────────────
 *
 * Canvas silently substitutes a fallback if the webfont has not finished
 * loading, and you will not notice on a warm cache — the card just quietly
 * ships in Helvetica. `renderResultCard` awaits `document.fonts.ready` before
 * drawing and refuses to draw if fonts are unavailable, and a test asserts the
 * wait happened.
 *
 * ── Why the drawing is separate from the canvas ──────────────────────────
 *
 * `drawResultCard` takes a context-like object rather than reaching for a
 * canvas itself, so the layout can be tested by recording every call — which
 * is how "nothing overflows the frame with ten players" is asserted without a
 * headless browser, and jsdom has no canvas at all.
 */
import { SITE_LABEL } from './site';

/**
 * Two shapes, one drawing routine.
 *
 *   feed   1080x1350 (4:5) — a feed post
 *   story  1080x1920 (9:16) — Instagram and Snapchat Stories
 *
 * Story is the default and the only one the app offers, because that is where
 * this gets shared. A 4:5 image in a Story gets cropped and padded and looks
 * like something posted somewhere else first.
 *
 * ── Safe margins ────────────────────────────────────────────────────────
 *
 * Instagram and Snapchat both overlay chrome on a Story: profile row and close
 * button at the top, reply bar at the bottom. Anything in the top or bottom
 * ~10% sits under a UI element on somebody's phone. So everything meaningful —
 * and the URL especially, which is the only part doing commercial work — stays
 * inside the middle 80% vertically and 90% horizontally.
 */
export const SIZES = {
  feed: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

/** Fraction of the height reserved for app chrome at each end of a Story. */
export const STORY_SAFE = 0.10;

/** Kept for callers that predate the size parameter. */
export const CARD_W = SIZES.feed.w;
export const CARD_H = SIZES.feed.h;
/** Drawn at 2x and scaled down, or the text looks soft. */
export const CARD_SCALE = 2;

/** Geometry for one size: where the bands sit, and what is safe. */
export const layoutFor = (size = 'story') => {
  const { w, h } = SIZES[size] || SIZES.story;
  const isStory = size === 'story';
  // Horizontal safety is 5% a side on a story; the feed card has no chrome.
  const padX = isStory ? Math.round(w * 0.05) + 30 : 72;
  const safeTop = isStory ? Math.round(h * STORY_SAFE) : 0;
  const safeBottom = isStory ? Math.round(h * (1 - STORY_SAFE)) : h;
  /**
   * The footer is four stacked lines now, not two, and they are anchored
   * UPWARD from the bottom safe line so the URL keeps its position:
   *
   *   legend   SHOTGUNS / DRINKS, with the drawn icons
   *   room     ROOM 48213
   *   url      SHOTGUNFORMATION.COM   <- unchanged, still the lowest big thing
   *   tag      NO APP · NO SIGNUP
   *
   * The URL does not get smaller, dimmer or moved for the sake of the two new
   * lines; the tag sits under it and the legend above the room code.
   */
  const urlY = isStory ? safeBottom - 62 : h - 84;
  const markY = isStory ? safeTop + 96 : 150;
  const markSize = isStory ? 104 : 84;
  // The gold rule under the wordmark, then the FINAL STANDINGS heading. Both
  // are published because the list has to start BELOW the heading — deriving
  // the list zone from a guessed offset put the winner block on top of it.
  const ruleY = markY + markSize * 1.08 + (isStory ? 42 : 34);
  const headingY = ruleY + (isStory ? 66 : 56);
  return {
    w, h, padX, safeTop, safeBottom, isStory,
    markSize, ruleY, headingY,
    // The wordmark sits just inside the top safe line.
    markY,
    // ...and the footer just inside the bottom one.
    urlY,
    roomY: urlY - (isStory ? 68 : 56),
    legendY: urlY - (isStory ? 132 : 108),
    tagY: urlY + (isStory ? 44 : 38),
  };
};

const PAD = 72;
const INK = '#F2EFE7';
const AMBER = '#FFB020';
const NEON = '#8AFF3D';
const MUTED = '#8A9099';
const BG_TOP = '#141922';
const BG_BOTTOM = '#0D1017';

const DISPLAY = '"Oswald", system-ui, sans-serif';
const BODY = '"Inter", system-ui, sans-serif';

/**
 * ── Drawing on a context that may not be a canvas ────────────────────────
 *
 * `drawResultCard` is handed a context-like object so the layout can be
 * asserted by recording calls, and that recorder implements only the five
 * methods the original text-only card used: fillRect, fillText, measureText,
 * createLinearGradient and scale.
 *
 * Everything added for the podium — rounded blocks, medals, drawn icons, the
 * winner glow — needs path APIs that recorder does not have. So every one of
 * them is capability-checked and degrades to nothing, or to a plain rect. The
 * card's MEANING lives entirely in its text, and the text draws on any
 * context; the shapes are enrichment on top.
 *
 * This is not defensive noise. It is what lets the layout stay testable
 * without a headless browser, and it means a context missing a modern API
 * (roundRect is recent) loses a corner radius rather than throwing.
 */
const can = (ctx, ...fns) => fns.every((f) => typeof ctx[f] === 'function');

/** A rounded rectangle path, by whatever route the context supports. */
const roundedPath = (ctx, x, y, w, h, r) => {
  if (can(ctx, 'beginPath', 'roundRect')) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return true;
  }
  if (can(ctx, 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath')) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    return true;
  }
  return false;
};

const fillRounded = (ctx, x, y, w, h, r, style) => {
  ctx.fillStyle = style;
  if (roundedPath(ctx, x, y, w, h, r) && can(ctx, 'fill')) ctx.fill();
  else if (can(ctx, 'fillRect')) ctx.fillRect(x, y, w, h);
};

const strokeRounded = (ctx, x, y, w, h, r, style, width) => {
  if (!can(ctx, 'stroke')) return;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  if (roundedPath(ctx, x, y, w, h, r)) ctx.stroke();
};

const fillCircle = (ctx, cx, cy, r, style) => {
  if (!can(ctx, 'beginPath', 'arc', 'fill')) return false;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  return true;
};

/**
 * A shotgun can, drawn as paths.
 *
 * NOT an emoji. Canvas renders emoji with the SHARER's platform font, so the
 * same card comes out with a different can on an iPhone, an Android and a Mac,
 * and matches the brand on none of them. A rounded body and a pull-tab is a
 * handful of path commands and renders identically everywhere.
 */
const drawCan = (ctx, cx, cy, h, colour) => {
  const w = h * 0.62;
  const x = cx - w / 2;
  const y = cy - h / 2;
  fillRounded(ctx, x, y, w, h, Math.max(2, w * 0.22), colour);
  // The lid, a shade darker, so it reads as a can and not a lozenge.
  if (can(ctx, 'fillRect')) {
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x + w * 0.18, y - h * 0.06, w * 0.64, h * 0.10);
    ctx.globalAlpha = 1;
  }
};

/** A drinking cup: a tapered body, wider at the lip. */
const drawCup = (ctx, cx, cy, h, colour) => {
  const top = h * 0.66;
  const bot = h * 0.44;
  const y = cy - h / 2;
  if (can(ctx, 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill')) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(cx - top / 2, y);
    ctx.lineTo(cx + top / 2, y);
    ctx.lineTo(cx + bot / 2, y + h);
    ctx.lineTo(cx - bot / 2, y + h);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (can(ctx, 'fillRect')) {
    ctx.fillStyle = colour;
    ctx.fillRect(cx - top / 2, y, top, h);
  }
};

/**
 * Row geometry, responding to how many people played.
 *
 * One fixed row height cannot serve both ends: at three players it leaves a
 * void under the list, at ten it overflows. So the first three places get
 * weighted taller than the rest — a podium, not a table — and the base height
 * is solved from the space actually available, then capped so a two-player
 * card does not render two 360px slabs.
 */
const WEIGHT = (i) => (i === 0 ? 1.45 : i <= 2 ? 1.15 : 1);

const maxBaseFor = (count, isStory) => {
  const k = isStory ? 1 : 0.74;
  // Tuned by rendering, not derived: at 240 a three-player winner block was
  // 348px of mostly empty amber. These fill 82-100% of the zone at every size
  // while keeping the block proportionate to the type inside it.
  if (count <= 2) return 280 * k;
  if (count === 3) return 190 * k;
  if (count <= 4) return 170 * k;
  if (count <= 6) return 145 * k;
  if (count <= 8) return 116 * k;
  return 96 * k;
};

const gapFor = (count, isStory) => Math.round((count <= 3 ? 26 : count <= 6 ? 20 : 14) * (isStory ? 1 : 0.8));

/** Top and bottom of the space the list may use, between wordmark and footer. */
const listZone = (size) => {
  const L = layoutFor(size);
  return {
    top: L.headingY + (L.isStory ? 62 : 52),
    bottom: L.legendY - (L.isStory ? 56 : 46),
  };
};

/** Everything the list needs: per-row heights, gaps and total extent. */
export const listPlan = (count, size = 'feed') => {
  const L = layoutFor(size);
  const zone = listZone(size);
  const n = Math.max(0, count);
  const gap = gapFor(n, L.isStory);
  const gaps = Math.max(0, n - 1) * gap;
  const weights = Array.from({ length: n }, (_, i) => WEIGHT(i));
  const W = weights.reduce((a, b) => a + b, 0) || 1;
  const available = Math.max(0, zone.bottom - zone.top);
  const base = Math.min(maxBaseFor(n, L.isStory), (available - gaps) / W);
  // FLOOR, not round. Rounding each row independently can push the total past
  // the space it was solved for — six players overflowed the zone by a quarter
  // of a percent, which is invisible on screen and still a list that does not
  // fit the box it claims to.
  const heights = weights.map((w) => Math.max(1, Math.floor(base * w)));
  const total = heights.reduce((a, b) => a + b, 0) + gaps;
  const top = zone.top + Math.max(0, (available - total) / 2);
  return { heights, gap, total, top, zone, base };
};

/**
 * Kept for callers and tests that predate the podium.
 *
 * Reports the FIRST row's height, which is what "a row" meant when every row
 * was the same size.
 */
const rowMetrics = (count, size = 'feed') => {
  const plan = listPlan(count, size);
  const h = plan.heights[0] || 0;
  return { h, name: Math.round(h * 0.32), num: Math.round(h * 0.30), avatar: 0 };
};

export const listTopFor = (count, size = 'feed') => listPlan(count, size).top;

/**
 * Trim a name to fit `maxWidth`, with an ellipsis.
 *
 * Measured, not counted: "WWWWWW" and "iiiiii" are not the same width, and a
 * character limit would either clip a wide name or waste space on a narrow one.
 */
export const fitText = (ctx, text, maxWidth) => {
  const s = String(text == null ? '' : text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
};

/**
 * Order for the card: most drunk first, shotguns counted as ten.
 *
 * Same comparison the in-game standings use, so the card cannot disagree with
 * the screen it was generated from.
 */
export const rankForCard = (players = [], drinksPerShotgun = 10) =>
  [...players].sort((a, b) =>
    ((b.totalShotguns || 0) * drinksPerShotgun + (b.totalDrinks || 0))
    - ((a.totalShotguns || 0) * drinksPerShotgun + (a.totalDrinks || 0)));

/** Total drunk, shotguns counted as ten — the number the ranking sorts on. */
const scoreOf = (p, drinksPerShotgun = 10) =>
  (p.totalShotguns || 0) * drinksPerShotgun + (p.totalDrinks || 0);

/**
 * Is the top score shared?
 *
 * A tie at the top is NOT an edge case — two First Down rounds give every
 * player the same total, so it happens routinely. Session 19 settled that a
 * tie gets no winner treatment, and the podium must not quietly reintroduce
 * one: crowning whichever name sorted first would be inventing a result.
 */
export const isTied = (ranked = []) =>
  ranked.length > 1 && scoreOf(ranked[0]) === scoreOf(ranked[1]);

/** Medal colours for the first three places. Null means no medal. */
const MEDALS = ['#FFC24A', '#C9D2DC', '#CD8B4E'];

/**
 * A faint field: yard lines and hash marks.
 *
 * Drawn with fillRect so it survives a context with no path API, and kept
 * around 4-5% opacity. The test is whether you notice it — if you can see it
 * as texture rather than feel it as depth, it is too strong.
 */
const drawField = (ctx, L) => {
  if (!can(ctx, 'fillRect')) return;
  const step = Math.round(L.h / 22);
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = INK;
  for (let y = step; y < L.h; y += step) ctx.fillRect(0, y, L.w, 2);
  ctx.globalAlpha = 0.07;
  const hashStep = Math.round(L.w / 7);
  for (let y = Math.round(step / 2); y < L.h; y += step) {
    for (let x = hashStep; x < L.w; x += hashStep) ctx.fillRect(x, y, 26, 2);
  }
  ctx.globalAlpha = 1;
};

/**
 * Draw the whole card.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{players: Array, roomCode: string}} data
 */
export const drawResultCard = (ctx, { players = [], roomCode = '', size = 'feed', title = null } = {}) => {
  const L = layoutFor(size);
  const ranked = rankForCard(players);
  const tied = isTied(ranked);

  // ── background ──────────────────────────────────────────────────────
  // Must be the FIRST fillRect: a test reads calls.rect[0] to prove the frame
  // is the size it claims to be.
  const bg = ctx.createLinearGradient(0, 0, 0, L.h);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, L.w, L.h);
  drawField(ctx, L);

  // ── wordmark ────────────────────────────────────────────────────────
  const markSize = L.isStory ? 104 : 84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `700 ${markSize}px ${DISPLAY}`;
  ctx.fillText('SHOTGUN', L.w / 2, L.markY);
  ctx.fillStyle = AMBER;
  ctx.fillText('FORMATION', L.w / 2, L.markY + markSize * 1.08);

  // The short gold rule under the wordmark.
  const ruleY = L.ruleY;
  if (can(ctx, 'fillRect')) {
    ctx.fillStyle = AMBER;
    ctx.fillRect(L.w / 2 - (L.isStory ? 44 : 36), ruleY, L.isStory ? 88 : 72, 6);
  }

  const headSize = L.isStory ? 34 : 28;
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${headSize}px ${BODY}`;
  ctx.fillText(title || 'FINAL STANDINGS', L.w / 2, L.headingY);

  // ── standings ───────────────────────────────────────────────────────
  const plan = listPlan(ranked.length, size);
  const blockX = L.padX;
  const blockW = L.w - L.padX * 2;
  const numRight = L.w - L.padX - (L.isStory ? 34 : 26);
  const iconH = (h) => Math.min(h * 0.30, L.isStory ? 46 : 36);

  // Column geometry, fixed so the numbers line up down the card.
  const sgIconX = numRight - (L.isStory ? 286 : 220);
  const sgNumRight = numRight - (L.isStory ? 190 : 146);
  const drIconX = numRight - (L.isStory ? 96 : 74);

  let y = plan.top;
  ranked.forEach((p, i) => {
    const h = plan.heights[i];
    const mid = y + h / 2;
    const isWinner = i === 0 && !tied;
    /**
     * A tie at the top removes EVERY medal, not just the gold one.
     *
     * Neutralising first place while second still wore silver read as the
     * leader having done worse than the runner-up — which is a worse lie than
     * the crown it was trying to avoid. If the result is that nobody won, the
     * card says nobody won and the numbers speak for themselves.
     */
    const medal = tied ? null : MEDALS[i] || null;

    // The winner's glow — the thing that makes the eye land in the right place.
    if (isWinner && can(ctx, 'createRadialGradient')) {
      /**
       * The falloff has to finish INSIDE the rect it is painted into.
       *
       * Filling a band shorter than the gradient's radius clips the fade
       * part-way and leaves a hard horizontal edge across the full width —
       * which reads as a lit band, not as depth, and the brief's test for this
       * is whether you notice it at all. So the rect is the gradient's own
       * diameter, clamped to the frame.
       */
      const r = blockW * 0.62;
      const top = Math.max(0, mid - r);
      const bot = Math.min(L.h, mid + r);
      const g = ctx.createRadialGradient(L.w / 2, mid, 0, L.w / 2, mid, r);
      g.addColorStop(0, 'rgba(255,176,32,0.17)');
      g.addColorStop(0.55, 'rgba(255,176,32,0.05)');
      g.addColorStop(1, 'rgba(255,176,32,0)');
      ctx.fillStyle = g;
      if (can(ctx, 'fillRect')) ctx.fillRect(0, top, L.w, bot - top);
    }

    // The block.
    fillRounded(ctx, blockX, y, blockW, h, L.isStory ? 26 : 20,
      isWinner ? 'rgba(255,176,32,0.10)' : i <= 2 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.022)');
    strokeRounded(ctx, blockX, y, blockW, h, L.isStory ? 26 : 20,
      isWinner ? AMBER : i <= 2 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)',
      isWinner ? 4 : 2);

    // Medal, or a bare numeral further down the table.
    const medalR = Math.min(h * 0.30, L.isStory ? 56 : 44);
    const medalX = blockX + (L.isStory ? 86 : 68);
    if (medal) {
      fillCircle(ctx, medalX, mid, medalR, medal);
      ctx.fillStyle = '#10131A';
    } else if (tied && i <= 2) {
      // Still a position, just not a placing.
      fillCircle(ctx, medalX, mid, medalR, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = MUTED;
    } else {
      ctx.fillStyle = MUTED;
    }
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(medalR * 0.86)}px ${DISPLAY}`;
    ctx.fillText(String(i + 1), medalX, mid + medalR * 0.30);

    // Name, and WINNER beneath it.
    const nameLeft = medalX + medalR + (L.isStory ? 34 : 26);
    const nameMax = sgIconX - nameLeft - (L.isStory ? 28 : 22);
    /**
     * Type is CAPPED, not purely proportional to the row.
     *
     * A two-player card gives each block ~435px, and 34% of that is a 148px
     * name — which looks broken, and truncated a long name so hard it stopped
     * being recognisable: "Bartholomew Fitzgerald-Wellington III" came out as
     * "Bartholo…". The row grows; the type stops growing.
     */
    const nameSize = Math.min(
      Math.round(h * (isWinner ? 0.34 : i <= 2 ? 0.31 : 0.36)),
      L.isStory ? 64 : 52,
    );
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = `600 ${nameSize}px ${DISPLAY}`;
    const nameY = isWinner ? mid + nameSize * 0.18 : mid + nameSize * 0.34;
    ctx.fillText(fitText(ctx, p.name, nameMax), nameLeft, nameY);
    if (isWinner) {
      ctx.fillStyle = AMBER;
      ctx.font = `700 ${Math.round(nameSize * 0.36)}px ${BODY}`;
      ctx.fillText('WINNER', nameLeft, nameY + Math.round(nameSize * 0.60));
    }

    // Totals, with drawn icons instead of SG / DR.
    const sg = p.totalShotguns || 0;
    const dr = p.totalDrinks || 0;
    const numSize = Math.min(Math.round(h * 0.34), L.isStory ? 60 : 48);
    const ih = iconH(h);

    drawCan(ctx, sgIconX, mid, ih, sg > 0 ? NEON : 'rgba(138,255,61,0.22)');
    ctx.textAlign = 'right';
    ctx.font = `700 ${numSize}px ${DISPLAY}`;
    ctx.fillStyle = sg > 0 ? INK : MUTED;
    ctx.fillText(String(sg), sgNumRight, mid + numSize * 0.34);

    drawCup(ctx, drIconX, mid, ih, dr > 0 ? AMBER : 'rgba(255,176,32,0.22)');
    ctx.fillStyle = dr > 0 ? INK : MUTED;
    ctx.fillText(String(dr), numRight, mid + numSize * 0.34);

    y += h + plan.gap;
  });

  // ── footer ──────────────────────────────────────────────────────────
  // A legend, because SG and DR meant nothing to anybody who had not played.
  const legendSize = L.isStory ? 30 : 26;
  const legendIcon = L.isStory ? 34 : 28;
  ctx.font = `700 ${legendSize}px ${BODY}`;
  const sgLabel = 'SHOTGUNS';
  const drLabel = 'DRINKS';
  const gapL = L.isStory ? 46 : 38;
  const wSg = ctx.measureText(sgLabel).width;
  const wDr = ctx.measureText(drLabel).width;
  const unit = legendIcon + 14;
  const totalW = unit + wSg + gapL + unit + wDr;
  let lx = L.w / 2 - totalW / 2;

  drawCan(ctx, lx + legendIcon / 2, L.legendY - legendSize * 0.34, legendIcon, NEON);
  lx += unit;
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.fillText(sgLabel, lx, L.legendY);
  lx += wSg + gapL;
  drawCup(ctx, lx + legendIcon / 2, L.legendY - legendSize * 0.34, legendIcon, AMBER);
  lx += unit;
  ctx.fillText(drLabel, lx, L.legendY);

  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${L.isStory ? 34 : 30}px ${BODY}`;
  if (roomCode) ctx.fillText(`ROOM ${roomCode}`, L.w / 2, L.roomY);
  ctx.fillStyle = INK;
  ctx.font = `700 ${L.isStory ? 52 : 44}px ${DISPLAY}`;
  ctx.fillText(SITE_LABEL.toUpperCase(), L.w / 2, L.urlY);

  // The one line that answers a stranger's only objection.
  ctx.fillStyle = AMBER;
  ctx.font = `700 ${L.isStory ? 28 : 24}px ${BODY}`;
  ctx.fillText('NO APP · NO SIGNUP', L.w / 2, L.tagY);
};

/** Where the list ends, so a test can prove ten players still fit. */
export const listBottom = (count, size = 'feed') => {
  const plan = listPlan(count, size);
  return plan.top + plan.total;
};

/**
 * Render to a real canvas and hand back a PNG blob.
 *
 * Returns null if fonts are unavailable — drawing without them ships a card in
 * the wrong typeface, which is worse than no card.
 */
export const renderResultCard = async (data, doc = (typeof document !== 'undefined' ? document : null)) => {
  if (!doc || !doc.fonts || typeof doc.fonts.ready?.then !== 'function') return null;
  await doc.fonts.ready;

  const L = layoutFor((data && data.size) || 'feed');
  const canvas = doc.createElement('canvas');
  canvas.width = L.w * CARD_SCALE;
  canvas.height = L.h * CARD_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(CARD_SCALE, CARD_SCALE);
  drawResultCard(ctx, data);

  const blob = await new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') canvas.toBlob(resolve, 'image/png');
    else resolve(null);
  });
  if (!blob) return null;
  return { blob, dataUrl: canvas.toDataURL('image/png') };
};

export default { drawResultCard, renderResultCard, fitText, rankForCard, CARD_W, CARD_H };
