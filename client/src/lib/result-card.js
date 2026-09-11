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

/** Portrait, the shape every messaging app previews well. */
export const CARD_W = 1080;
export const CARD_H = 1350;
/** Drawn at 2x and scaled down, or the text looks soft. */
export const CARD_SCALE = 2;

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
const rowMetrics = (count) => {
  if (count <= 4) return { h: 108, name: 46, num: 44, avatar: 0 };
  if (count <= 6) return { h: 92, name: 40, num: 38, avatar: 0 };
  if (count <= 8) return { h: 78, name: 34, num: 33, avatar: 0 };
  return { h: 66, name: 29, num: 28, avatar: 0 };
};

/** Top and bottom of the space the list may use, between wordmark and footer. */
const LIST_ZONE_TOP = 330;
const LIST_ZONE_BOTTOM = CARD_H - 190;

/**
 * Where the list starts.
 *
 * Centred in the space it has rather than pinned to the top: a two-player card
 * pinned at 330 left a third of the frame empty in the middle, which reads as
 * a rendering failure at thumbnail size. Never rises above LIST_ZONE_TOP, so a
 * full table still starts directly under the wordmark.
 */
export const listTopFor = (count) => {
  const height = count * rowMetrics(count).h;
  const slack = (LIST_ZONE_BOTTOM - LIST_ZONE_TOP) - height;
  return LIST_ZONE_TOP + Math.max(0, slack / 2);
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
export const drawResultCard = (ctx, { players = [], roomCode = '' } = {}) => {
  const ranked = rankForCard(players);

  // ── background ──────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ── wordmark ────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `700 84px ${DISPLAY}`;
  ctx.fillText('SHOTGUN', CARD_W / 2, 150);
  ctx.fillStyle = AMBER;
  ctx.fillText('FORMATION', CARD_W / 2, 240);

  // ── standings ───────────────────────────────────────────────────────
  const m = rowMetrics(ranked.length);
  const listTop = listTopFor(ranked.length);
  const numRight = CARD_W - PAD;
  const sgX = numRight - 150;
  const nameLeft = PAD + 74;
  const nameMax = sgX - nameLeft - 40;

  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = `600 26px ${BODY}`;
  ctx.fillText('FINAL', PAD, listTop - 34);
  ctx.textAlign = 'right';
  ctx.fillText('SG', sgX + 40, listTop - 34);
  ctx.fillText('DR', numRight, listTop - 34);

  ranked.forEach((p, i) => {
    const y = listTop + i * m.h + m.h * 0.66;

    ctx.textAlign = 'left';
    ctx.fillStyle = i === 0 ? AMBER : MUTED;
    ctx.font = `700 ${m.num}px ${DISPLAY}`;
    ctx.fillText(String(i + 1), PAD, y);

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
  ctx.font = `600 30px ${BODY}`;
  if (roomCode) ctx.fillText(`ROOM ${roomCode}`, CARD_W / 2, CARD_H - 128);
  ctx.fillStyle = INK;
  ctx.font = `700 44px ${DISPLAY}`;
  ctx.fillText(SITE_LABEL.toUpperCase(), CARD_W / 2, CARD_H - 62);
};

/** Where the list ends, so a test can prove ten players still fit. */
export const listBottom = (count) => listTopFor(count) + count * rowMetrics(count).h;

/**
 * Render to a real canvas and hand back a PNG blob.
 *
 * Returns null if fonts are unavailable — drawing without them ships a card in
 * the wrong typeface, which is worse than no card.
 */
export const renderResultCard = async (data, doc = (typeof document !== 'undefined' ? document : null)) => {
  if (!doc || !doc.fonts || typeof doc.fonts.ready?.then !== 'function') return null;
  await doc.fonts.ready;

  const canvas = doc.createElement('canvas');
  canvas.width = CARD_W * CARD_SCALE;
  canvas.height = CARD_H * CARD_SCALE;
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
