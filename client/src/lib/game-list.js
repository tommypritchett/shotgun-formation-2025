/**
 * Turning a scoreboard into something you can pick from.
 *
 * The two leagues are not the same problem. An NFL Sunday has about thirteen
 * games and a flat list is enough. A college Saturday has fifty to a hundred
 * and more, so the list needs sorting, filtering and search or it is unusable
 * on a phone.
 *
 * Pure, so the ordering rules can be tested without rendering anything.
 */

/** No rank at all. Sorts after every real rank, as a tiebreak. */
export const RANK_UNRANKED = 999;

const rankOf = (game) => {
  const home = game?.home?.rank;
  const away = game?.away?.rank;
  const ranks = [home, away].filter((r) => typeof r === 'number' && r > 0);
  return ranks.length ? Math.min(...ranks) : RANK_UNRANKED;
};

/** 'in' beats 'pre' beats 'post': a game you can still watch comes first. */
const stateWeight = (game) => {
  if (game?.state === 'in') return 0;
  if (game?.state === 'pre') return 1;
  return 2;
};

export const isRanked = (game) => rankOf(game) < RANK_UNRANKED;

export const teamNames = (game) => [
  game?.home?.abbreviation, game?.home?.displayName,
  game?.away?.abbreviation, game?.away?.displayName,
].filter(Boolean).join(' ').toLowerCase();

/** Does this game match what was typed? Matches either team, name or code. */
export const matchesSearch = (game, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return teamNames(game).includes(q);
};

/**
 * The default college view: in progress and ranked. Falls back to showing
 * everything rather than an empty screen, because an empty picker looks broken.
 */
export const applyDefaultView = (games, { league, onlyRanked }) => {
  if (league !== 'college-football' || !onlyRanked) return games;
  const ranked = games.filter(isRanked);
  return ranked.length ? ranked : games;
};

/**
 * "12:00" / "3:20" → seconds remaining in the period. Unreadable → null.
 * Used only for ordering, so a bad value must sort last rather than throw.
 */
const clockSeconds = (game) => {
  const raw = String(game?.clock ?? '').trim();
  const m = /^(\d+):([0-5]?\d)$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Kickoff as a number. Missing or unparseable → null, which sorts last. */
const kickoffAt = (game) => {
  const t = Date.parse(String(game?.date ?? ''));
  return Number.isFinite(t) ? t : null;
};

/** null sorts after any real value, without NaN poisoning the comparison. */
const nullsLast = (a, b) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
};

/**
 * Sort for display, for somebody standing at a bar deciding what to watch.
 *
 * The primary question is "what is on right now", not "what is the best game
 * this week", so STATE leads: in progress, then starting soon, then Final.
 * Rank was the primary key until Session 18 and it was the wrong question — a
 * #1 team kicking off in four hours outranked the game on the screen above the
 * bar.
 *
 * Inside each group:
 *   in    — furthest along first (later period, then less clock left), so the
 *           game about to produce a finish is at the top
 *   pre   — nearest kickoff first
 *   post  — nothing more to order by; rank then name
 *
 * Rank is the tiebreak everywhere, and name is the final tiebreak so the order
 * is stable between polls and rows do not jump under a thumb.
 */
export const sortGames = (games) =>
  [...(Array.isArray(games) ? games : [])].sort((a, b) => {
    const state = stateWeight(a) - stateWeight(b);
    if (state) return state;

    if (a?.state === 'in') {
      // Later period first: Q4 is closer to finishing than Q1.
      const period = (Number(b?.period) || 0) - (Number(a?.period) || 0);
      if (period) return period;
      // Then less clock remaining first, within that period.
      const clock = nullsLast(clockSeconds(a), clockSeconds(b));
      if (clock) return clock;
    } else if (a?.state === 'pre') {
      const kickoff = nullsLast(kickoffAt(a), kickoffAt(b));
      if (kickoff) return kickoff;
    }

    const rank = rankOf(a) - rankOf(b);
    if (rank) return rank;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

/** Everything the picker needs, in one call. */
export const prepareGames = (games, { league = 'nfl', query = '', onlyRanked = false } = {}) => {
  const safe = (Array.isArray(games) ? games : []).filter((g) => g && g.id);
  const viewed = applyDefaultView(safe, { league, onlyRanked });
  return sortGames(viewed.filter((g) => matchesSearch(g, query)));
};

/** A short line for the row: "Q2 3:20" or "Final" or the kickoff time. */
export const statusLine = (game) => {
  if (!game) return '';
  if (game.state === 'in') {
    const period = game.period ? `Q${game.period}` : '';
    return [period, game.clock].filter(Boolean).join(' ') || 'Live';
  }
  if (game.state === 'post') return 'Final';
  // ESPN's shortDetail is the nicest form ("9/3 - 6:00 PM EDT"). If it is
  // missing, a kickoff time is still far more use than "Not started".
  if (game.detail) return game.detail;
  const at = Date.parse(String(game.date ?? ''));
  if (Number.isFinite(at)) {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return 'Not started';
};

export default { prepareGames, sortGames, matchesSearch, statusLine, isRanked };
