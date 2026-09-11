/**
 * The age gate. 21, self-attested, and nothing is stored but a boolean.
 *
 * ── What is kept ─────────────────────────────────────────────────────────
 *
 * The date of birth is used to compute an age and then DISCARDED. It is never
 * sent to the server, never logged, never persisted. A date of birth is
 * personal data and this app has no business holding one; all that survives is
 * `true` in localStorage.
 *
 * ── Why a date and not a button ──────────────────────────────────────────
 *
 * A yes/no button is one thoughtless tap. Entering a date is a deliberate act.
 * That is the whole difference between the two, legally and ethically, and it
 * is why this asks for a date even though a button would convert better.
 *
 * ── Failing closed, once ─────────────────────────────────────────────────
 *
 * Every other item in this session fails OPEN — if it breaks, the player still
 * gets into the game. This one is the exception: if storage is unavailable the
 * gate shows. Being asked twice is a small cost; not being asked at all is not
 * a thing to be relaxed about.
 *
 * I am not a lawyer. This is the standard shape for the category and better
 * than nothing by a wide margin. Nothing here is a compliance claim.
 */

export const MIN_AGE = 21;
const KEY = 'shotgunFormation_ageOk';

/** localStorage, or null if touching it throws at all. */
export const safeStorage = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Whole years between two dates.
 *
 * Calendar-correct: someone born on 29 February, or whose birthday is
 * tomorrow, must not be rounded up into the answer.
 */
export const ageOn = (dob, today) => {
  if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) return null;
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) return null;
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
};

/**
 * Parse a date from the three inputs.
 * @returns {Date|null} null for anything not a real calendar date.
 */
export const toDate = (y, m, d) => {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Rejects 31 February and friends, which JS would otherwise roll forward.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
};

/** @returns {'ok'|'under'|'invalid'} — and never the date itself. */
export const checkAge = (y, m, d, today = new Date()) => {
  const dob = toDate(y, m, d);
  if (!dob) return 'invalid';
  if (dob.getTime() > today.getTime()) return 'invalid';
  const age = ageOn(dob, today);
  return age >= MIN_AGE ? 'ok' : 'under';
};

/** Has this device already passed? Storage unavailable → no, show the gate. */
export const hasPassed = (store = safeStorage()) => {
  if (!store) return false;
  try {
    return store.getItem(KEY) === 'true';
  } catch {
    return false;
  }
};

/** Remember the BOOLEAN. Never the date. */
export const remember = (store = safeStorage()) => {
  if (!store) return;
  try {
    store.setItem(KEY, 'true');
  } catch {
    // They will be asked again next time. Acceptable.
  }
};

export default { checkAge, hasPassed, remember, ageOn, toDate, MIN_AGE };
