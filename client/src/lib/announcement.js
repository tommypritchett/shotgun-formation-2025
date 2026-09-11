/**
 * The returning-player announcement slot.
 *
 * ── Why this exists, which is worth writing down ─────────────────────────
 *
 * There is no email list, by the owner's standing decision. So on the day the
 * physical deck ships, the app is the ONLY channel to the people who played.
 * This banner is that channel. It costs almost nothing now and cannot be
 * retrofitted later, because by then the players are already gone.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * Content comes from server config read at boot, not a deploy. Text only —
 * never HTML. Anything that renders server-supplied markup in a client is a
 * hole, and this one would be reachable by whoever ever gets at the config.
 *
 * Absent, empty or malformed config renders NOTHING: no banner, no error, no
 * gap in the layout. The default state is invisible.
 */

const MAX_ID = 64;
const MAX_TEXT = 280;

/** A link we are willing to render. http(s) only — no javascript:, no data:. */
const safeLink = (value) => {
  const s = String(value || '').trim();
  if (!s) return null;
  try {
    const url = new URL(s);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * Validate whatever the server sent.
 *
 * @returns {{id: string, text: string, link: string|null} | null}
 *
 * Returns null for anything it does not fully understand, rather than trying to
 * salvage a partial announcement. A half-rendered banner is worse than none.
 */
export const parseAnnouncement = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!id || !text) return null;
  if (id.length > MAX_ID || text.length > MAX_TEXT) return null;
  return { id, text, link: safeLink(raw.link) };
};

const KEY = 'shotgunFormation_dismissedAnnouncement';

/**
 * Dismissal is per ID: a NEW announcement shows again, the same one stays gone.
 *
 * Storage unavailable (Safari private mode, blocked cookies) → the banner shows
 * every time. That is the harmless failure, and the right one: this item may
 * never stand between anyone and the game.
 */
export const isDismissed = (id, store = safeStorage()) => {
  if (!store) return false;
  try {
    return store.getItem(KEY) === id;
  } catch {
    return false;
  }
};

export const dismiss = (id, store = safeStorage()) => {
  if (!store) return;
  try {
    store.setItem(KEY, id);
  } catch {
    // Nothing to do and nothing to tell the player. They see it again; fine.
  }
};

/** localStorage, or null if touching it throws at all. */
export function safeStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export default { parseAnnouncement, isDismissed, dismiss, safeStorage };
