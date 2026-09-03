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

/**
 * ESPN's short summary, made to read like something a person would say.
 *
 * `shortText` is already a clean one-liner for a simple play — "Tyler Allgeier
 * 1 Yd Rush", "Alec Pierce 37 Yd pass from Daniel Jones". (`shortAlternativeText`
 * is byte-identical, so there is no better field to reach for.)
 *
 * Compound plays are the problem: ESPN concatenates the events, repeating the
 * player, and the result reads as nonsense when cut —
 *
 *   "Michael Penix Jr. Sacked Michael Penix Jr. Fumble Germaine Pratt 8 Yd
 *    Fumble Recovery by Cam Bynum For 8 Yd Loss"
 *
 * naively truncated became "Michael Penix Jr. Sacked Michael Penix Jr. Fumble…",
 * which reads as Penix sacking himself. The repetition is the seam between two
 * events, so cutting THERE gives the first clause and a sentence that is true:
 * "Michael Penix Jr. Sacked".
 *
 * This line is read ~70 times a game on every phone in the room, so it is worth
 * the care.
 */

/**
 * The clause that IS the card, where ESPN's wording makes it findable.
 *
 * A kick return reads "Bradley Pinion 60 Yd Kickoff Ashton Dulin 20 Yd Kickoff
 * Return" — the kicker first, the returner second — and the card is about the
 * RETURN, so the first clause is the wrong half to keep. A penalty reads
 * "...Intended For Darnell Mooney Mekhi Blackmon 20 Yd Pnlty", where the
 * penalty is again last.
 */
// Anchored at the end and counted backwards, because a forward "capitalised
// word run" also matches football nouns — `\w` happily reads "Yd" as a name.
/** Name suffixes ESPN appends: "Michael Penix Jr.", "Jessie Bates III". */
const NAME_SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV|V)$/;
/** A team abbreviation. The offender on a team penalty — one word, not two. */
const TEAM_ABBR = /^[A-Z]{2,4}$/;

/**
 * Who the clause immediately after this text belongs to.
 *
 * Taking the two words in front is right for "Mekhi Blackmon" and wrong in both
 * directions for everything else: a team is ONE word, and a name with a suffix
 * is THREE. Two produced "Jr. ATL 5 Yd penalty" — the tail of the receiver's
 * name followed by the offending team, describing nobody — and "Penix Jr. 15 Yd
 * penalty", which quietly drops a first name.
 *
 * Suffix is checked before team because "II" and "III" satisfy both.
 */
const actorBefore = (head) => {
  const words = String(head || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words[words.length - 1];
  if (NAME_SUFFIX.test(last)) return words.slice(-3).join(' ');
  if (TEAM_ABBR.test(last)) return last;
  return words.slice(-2).join(' ');
};

/** The clause, with whoever it belongs to and nothing of the clause before it. */
const withActor = (match) => {
  const actor = actorBefore(match[1]);
  return actor ? `${actor} ${match[2]}` : match[2];
};

const RETURN_CLAUSE = /^(.*?)\s*(-?\d+\s+Yd\s+(?:Kickoff|Punt)\s+Return)\s*$/;
const PENALTY_CLAUSE = /^(.*?)\s*(-?\d+\s+Yd\s+Pnlty)\s*$/;
// A strip sack reads "Penix Sacked Penix Fumble Germaine Pratt 8 Yd Fumble
// Recovery": the sack first, the turnover second. Cutting at the seam keeps the
// sack, which is right for the Sacks card and wrong for the Turnover one.
const TURNOVER_CLAUSE = /^(.*?)\s*(-?\d+\s+Yd\s+(?:Fumble|Interception)\s+(?:Recovery|Return))/;

const preferClause = (text, cardId) => {
  if (/Big Play|Special Teams TD/.test(cardId || '')) {
    const ret = RETURN_CLAUSE.exec(text);
    if (ret) return withActor(ret);
  }
  if (cardId === 'Penalty') {
    const pen = PENALTY_CLAUSE.exec(text);
    if (pen) return withActor(pen);
  }
  if (cardId === 'Turnover' || cardId === 'Defensive TD') {
    const turn = TURNOVER_CLAUSE.exec(text);
    if (turn) return withActor(turn);
  }
  return text;
};

/**
 * ESPN's house style is wordy. "Pass Complete for 17 Yds to Darnell Mooney" is
 * sixteen characters longer than "17 Yd pass to Darnell Mooney" and says the
 * same thing, and the difference decides whether the line wraps.
 */
const tighten = (text) => text
  .replace(/\bPass Complete for (\d+) Yds? to\b/i, '$1 Yd pass to')
  .replace(/\bIncomplete Pass, Intended For\b/i, 'incomplete to')
  .replace(/\bPnlty\b/i, 'penalty')
  .replace(/\s{2,}/g, ' ')
  // ESPN leaves trailing commas where it stitched clauses together.
  .replace(/[\s,;:]+$/, '')
  .trim();

/**
 * Cut where a phrase repeats — that is the seam between two events in a
 * compound play, and everything after it belongs to the next one.
 *
 * Matched on repeated WORD RUNS rather than on names, because ESPN capitalises
 * the verbs too ("Sacked", "Fumble", "Pass Complete"), so nothing in the string
 * distinguishes a name from an action.
 */
export const cutAtRepeat = (text) => {
  const words = text.split(' ');
  for (let len = 4; len >= 2; len -= 1) {
    for (let i = 0; i + len <= words.length; i += 1) {
      const phrase = words.slice(i, i + len).join(' ');
      if (phrase.length < 9) continue;
      const first = text.indexOf(phrase);
      const second = text.indexOf(phrase, first + phrase.length);
      if (second > 0) return text.slice(0, second).trim();
    }
  }
  return text;
};

/** Trailing "(Zane Gonzalez Kick)" is about the extra point, not the play. */
const dropKickParenthetical = (text, cardId) => {
  if (cardId === 'Missed PAT' || cardId === '2 PT Conversion') return text;
  return text.replace(/\s*\((?:[^)]*\b(?:Kick|PAT)\b[^)]*)\)\s*$/i, '').trim();
};

/** Trim on a word boundary. The last resort, not the default. */
const shorten = (text) => {
  if (!text || text.length <= MAX_REASON) return text;
  const cut = text.slice(0, MAX_REASON);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 30 ? cut.slice(0, boundary) : cut).replace(/[.,;:]$/, '')}…`;
};

/**
 * Does this text actually support the card?
 *
 * ESPN's summary describes the PLAY, and a play can produce a card the summary
 * says nothing about. Two real examples from the fixtures:
 *
 *   Blocked Kicks   "Luke Farrell 9 Yd pass from Mac Jones"
 *   2 PT Conversion "Tyler Allgeier 1 Yd Rush (Michael Penix Jr. Pass to Drake…"
 *
 * The first never mentions a block; the second leads with the touchdown and the
 * try was truncated away. Both describe the wrong play.
 *
 * A blank subtitle is clean. One that contradicts the card name is actively
 * misleading, and the room is reading it while deciding whether to drink — so
 * when nothing corroborates, show nothing. Inventing a description from the
 * detector's own type name is not an option either: "Sack Opp Fumble Recovery"
 * is not English.
 */
const EVIDENCE = {
  // The summary of a scoring play describes the score itself, so a play
  // happening at all is the corroboration here.
  'Touchdown': /\bTD\b|touchdown|\d+\s*Yd\s*(?:Rush|pass|Run|Reception|Return)/i,
  'Defensive TD': /\bTD\b|touchdown|interception|fumble/i,
  'Special Teams TD': /\bTD\b|touchdown|Return/i,
  'Field Goal': /field goal|\bFG\b/i,
  'Missed FG': /miss|no good|blocked|wide|short/i,
  'Missed PAT': /\bPAT\b|extra point/i,
  '2 PT Conversion': /two[- ]?point|\b2\s*pt\b|conversion|attempt/i,
  'Safety': /safety/i,
  'Sacks': /sack/i,
  'Turnover': /intercept|fumble|turnover|recovery/i,
  'Turnover on Downs': /downs/i,
  'Penalty': /penalt|pnlty|flag|offside|holding|interference/i,
  'Penalty Calls TD Back': /penalt|pnlty/i,
  'First Down': /\d+\s*Yds?\b|rush|pass|reception|scramble|penalt/i,
  'Blocked Kicks': /block/i,
  'Onside Attempt': /onside/i,
  'Onside Recovered': /onside/i,
  'Disqualified': /targeting|disqualif|eject/i,
  '3 n Out': /punt/i,
};

/** Big Play needs the number in the text to actually reach the threshold. */
const yardageSupports = (text, threshold) => {
  const numbers = [...text.matchAll(/(\d+)\s*Yds?\b/gi)].map((m) => Number(m[1]));
  return numbers.some((n) => n >= threshold);
};

export const corroborates = (text, cardId) => {
  if (!text) return false;
  if (cardId === 'Big Play 20+') return yardageSupports(text, 20);
  if (cardId === 'Big Play 50+') return yardageSupports(text, 50);
  const evidence = EVIDENCE[cardId];
  // An unknown card gets the benefit of the doubt rather than being silenced.
  return evidence ? evidence.test(text) : true;
};

/** The whole pipeline, in the order that keeps the most meaning. */
export const formatReason = (raw, cardId = null) => {
  const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!text) return '';
  const line = shorten(tighten(dropKickParenthetical(cutAtRepeat(preferClause(text, cardId)), cardId)));
  // Last gate: if the line does not support the card, say nothing.
  return corroborates(line, cardId) ? line : '';
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
  const reason = formatReason(source.reason, source.cardId);
  return reason ? `The game called it · ${reason}` : 'The game called it';
};

export default { sourceLine, refWording, formatReason, cutAtRepeat, corroborates };
