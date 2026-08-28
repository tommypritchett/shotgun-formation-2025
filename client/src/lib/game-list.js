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

/** Ranked games first, then in-progress, then by kickoff. */
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
 * Sort for display: ranked first (best rank first), then live games, then the
 * rest alphabetically so the order is stable between polls.
 */
export const sortGames = (games) =>
  [...(Array.isArray(games) ? games : [])].sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    if (rank) return rank;
    const state = stateWeight(a) - stateWeight(b);
    if (state) return state;
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
  return game.detail || 'Not started';
};

export default { prepareGames, sortGames, matchesSearch, statusLine, isRanked };
