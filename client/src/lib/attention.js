/**
 * Getting someone's attention without a notification permission.
 *
 * Nothing here asks for anything. No Web Push, no service worker, no
 * permission prompt — if an approach needs one it is the wrong approach.
 *
 * Three cheap signals, each independently feature-detected:
 *
 *   sound      see lib/sounds.js
 *   title      the tab title flashes WHILE THE TAB IS HIDDEN, cleared on focus
 *   vibrate    navigator.vibrate, which is Android only — iOS Safari does not
 *              implement it, so this must be detected and never assumed
 */

/** Android only. iOS Safari has no `vibrate` at all. */
export const canVibrate = (nav = (typeof navigator !== 'undefined' ? navigator : null)) =>
  Boolean(nav && typeof nav.vibrate === 'function');

/** A short double buzz for a round starting. Silent no-op where unsupported. */
export const vibrate = (
  pattern = [60, 50, 60],
  nav = (typeof navigator !== 'undefined' ? navigator : null),
) => {
  if (!canVibrate(nav)) return false;
  try {
    nav.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
};

/**
 * Flash the tab title while the tab is hidden.
 *
 * Only while hidden: a title flickering in front of somebody who is looking at
 * it is just noise. `stop()` restores whatever the title was, which is read at
 * start rather than hardcoded so it survives any future title change.
 */
export const createTitleFlasher = (doc = (typeof document !== 'undefined' ? document : null)) => {
  let timer = null;
  let original = null;
  let flipped = false;

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (doc && original !== null) doc.title = original;
    original = null;
    flipped = false;
  };

  const start = (message, intervalMs = 900) => {
    if (!doc) return false;
    if (doc.hidden === false) return false;   // they are looking at it already
    if (timer) return true;                   // already flashing
    original = doc.title;
    flipped = false;
    timer = setInterval(() => {
      flipped = !flipped;
      doc.title = flipped ? message : original;
    }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    doc.title = message;
    flipped = true;
    return true;
  };

  return { start, stop, get running() { return timer !== null; } };
};

export default { canVibrate, vibrate, createTitleFlasher };
