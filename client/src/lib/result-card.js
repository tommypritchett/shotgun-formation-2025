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
  return {
    w, h, padX, safeTop, safeBottom, isStory,
    // The wordmark sits just inside the top safe line.
    markY: isStory ? safeTop + 96 : 150,
    // ...and the footer just inside the bottom one.
    urlY: isStory ? safeBottom - 40 : h - 62,
    roomY: isStory ? safeBottom - 112 : h - 128,
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

/** Rows shrink as the table grows, so ten players fit the same frame as two. */
const rowMetrics = (count, size = 'feed') => {
  // A story frame is 570px taller, so rows can afford to be bigger — which
  // matters because a Story is watched at arm's length for two seconds.
  const k = size === 'story' ? 1.3 : 1;
  const at = (h, name, num) => ({
    h: Math.round(h * k), name: Math.round(name * k), num: Math.round(num * k), avatar: 0,
  });
  if (count <= 4) return at(108, 46, 44);
  if (count <= 6) return at(92, 40, 38);
  if (count <= 8) return at(78, 34, 33);
  return at(66, 29, 28);
};

/** Top and bottom of the space the list may use, between wordmark and footer. */
const listZone = (size) => {
  const L = layoutFor(size);
  return { top: L.markY + 180, bottom: L.roomY - 70 };
};

/**
 * Where the list starts.
 *
 * Centred in the space it has rather than pinned to the top: a two-player card
 * pinned at the top left a third of the frame empty in the middle, which reads
 * as a rendering failure at thumbnail size. Never rises above the zone top, so
 * a full table still starts directly under the wordmark.
 */
export const listTopFor = (count, size = 'feed') => {
  const zone = listZone(size);
  const height = count * rowMetrics(count, size).h;
  const slack = (zone.bottom - zone.top) - height;
  return zone.top + Math.max(0, slack / 2);
};

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

/**
 * Draw the whole card.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{players: Array, roomCode: string}} data
 */
export const drawResultCard = (ctx, { players = [], roomCode = '', size = 'feed', title = null } = {}) => {
  const L = layoutFor(size);
  const ranked = rankForCard(players);

  // ── background ──────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, L.h);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, L.w, L.h);

  // ── wordmark ────────────────────────────────────────────────────────
  const markSize = L.isStory ? 104 : 84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `700 ${markSize}px ${DISPLAY}`;
  ctx.fillText('SHOTGUN', L.w / 2, L.markY);
  ctx.fillStyle = AMBER;
  ctx.fillText('FORMATION', L.w / 2, L.markY + markSize * 1.08);

  // ── standings ───────────────────────────────────────────────────────
  const m = rowMetrics(ranked.length, size);
  const listTop = listTopFor(ranked.length, size);
  const numRight = L.w - L.padX;
  const sgX = numRight - (L.isStory ? 185 : 150);
  const nameLeft = L.padX + (L.isStory ? 92 : 74);
  const nameMax = sgX - nameLeft - 40;
  const headSize = L.isStory ? 32 : 26;

  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${headSize}px ${BODY}`;
  ctx.fillText(title || 'FINAL', L.padX, listTop - headSize * 1.35);
  ctx.textAlign = 'right';
  ctx.fillText('SG', sgX + 40, listTop - headSize * 1.35);
  ctx.fillText('DR', numRight, listTop - headSize * 1.35);

  ranked.forEach((p, i) => {
    const y = listTop + i * m.h + m.h * 0.66;

    ctx.textAlign = 'left';
    ctx.fillStyle = i === 0 ? AMBER : MUTED;
    ctx.font = `700 ${m.num}px ${DISPLAY}`;
    ctx.fillText(String(i + 1), L.padX, y);

    ctx.fillStyle = INK;
    ctx.font = `600 ${m.name}px ${DISPLAY}`;
    ctx.fillText(fitText(ctx, p.name, nameMax), nameLeft, y);

    ctx.textAlign = 'right';
    ctx.font = `700 ${m.num}px ${DISPLAY}`;
    ctx.fillStyle = (p.totalShotguns || 0) > 0 ? NEON : MUTED;
    ctx.fillText(String(p.totalShotguns || 0), sgX + 40, y);
    ctx.fillStyle = (p.totalDrinks || 0) > 0 ? AMBER : MUTED;
    ctx.fillText(String(p.totalDrinks || 0), numRight, y);
  });

  // ── footer ──────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${L.isStory ? 34 : 30}px ${BODY}`;
  if (roomCode) ctx.fillText(`ROOM ${roomCode}`, L.w / 2, L.roomY);
  ctx.fillStyle = INK;
  ctx.font = `700 ${L.isStory ? 52 : 44}px ${DISPLAY}`;
  ctx.fillText(SITE_LABEL.toUpperCase(), L.w / 2, L.urlY);
};

/** Where the list ends, so a test can prove ten players still fit. */
export const listBottom = (count, size = 'feed') =>
  listTopFor(count, size) + count * rowMetrics(count, size).h;

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
