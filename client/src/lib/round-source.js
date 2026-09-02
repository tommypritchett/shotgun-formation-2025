/**
 * The line above the card: who called this round, and why.
 *
 * An automatic round used to read "The Ref declared", which is wrong twice
 * over — it credits the Ref for something they did not do, and it hides the
 * whole feature from everyone who is not holding the whistle. A player watching
 * their phone should be able to tell that the game itself called this.
 *
 * A suggestion the Ref accepted IS a Ref declaration, and reads as one: the
 * feed offered it, the Ref chose it.
 */

/** Card ids that come from the Wild deck take the "confirmed" wording. */
export const refWording = (isWild) => (isWild ? 'Called · Ref confirmed' : 'The Ref declared');

/** Longest reason the banner can carry without pushing the card name down. */
export const MAX_REASON = 58;

/** Trim on a word boundary, so it reads as a clipped phrase not a cut string. */
const shorten = (text) => {
  if (!text || text.length <= MAX_REASON) return text;
  const cut = text.slice(0, MAX_REASON);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 30 ? cut.slice(0, boundary) : cut).replace(/[.,;:]$/, '')}…`;
};

/**
 * @param {{by: 'ref'|'feed', reason?: string}|null} source  what the server said
 * @param {boolean} isWild                                   wild-deck card
 * @returns {string} the banner line
 */
export const sourceLine = (source, isWild = false) => {
  if (!source || source.by === 'ref') return refWording(isWild);

  // Worth carrying: it tells the room WHY they are drinking, not just that they
  // are. But it has to stay on one or two lines — a compound play like
  // "Michael Penix Jr. Sacked Michael Penix Jr. Fumble Germaine Pratt 8 Yd
  // Fumble Recovery by Cam Bynum For 8 Yd Loss" runs to four lines and shoves
  // the card name off the top of the banner.
  const reason = shorten(typeof source.reason === 'string' ? source.reason.trim() : '');
  return reason ? `The game called it · ${reason}` : 'The game called it';
};

export default { sourceLine, refWording };
