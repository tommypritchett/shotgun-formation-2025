/**
 * Reading the scoreboard out of what the server actually sends.
 *
 * These live outside App.js so they can be tested without a DOM: App.js is JSX
 * under a .js extension, which only CRA's build knows how to parse.
 */
import { DRINKS_PER_SHOTGUN } from '../data/cards';

/**
 * Rows for the Round Results tab.
 *
 * NOTE, and this is a real deviation from the mockup: the mockup shows
 * "X gave Y", but the wire does not carry who gave what. `updatePlayerStats`
 * sends `roundResults` keyed by RECIPIENT only, and the socket contract is
 * frozen this session, so the log shows who drank rather than who poured.
 * See SESSION_7_REPORT.md.
 */
export const buildRoundRows = (roundResults, players) => {
  if (!roundResults) return [];
  const byId = {};
  players.forEach((p) => { byId[p.id] = p; });
  return Object.entries(roundResults)
    .map(([id, result]) => ({ id, result: result || {} }))
    .filter(({ result }) => (result.drinks || 0) > 0 || (result.shotguns || 0) > 0)
    .map(({ id, result }) => {
      const player = byId[id];
      return {
        id,
        name: player ? player.name : 'Someone',
        // Kept SEPARATE and raw. Flattening these into one number and running
        // formatValue over it rendered a 1-shotgun-plus-1-drink round as just
        // "1 shotgun" and silently dropped the drink (Session 8, issue 1).
        drinks: result.drinks || 0,
        shotguns: result.shotguns || 0,
      };
    })
    // Order by what was actually drunk, counting a shotgun as ten.
    .sort((a, b) => (b.drinks + b.shotguns * DRINKS_PER_SHOTGUN)
                  - (a.drinks + a.shotguns * DRINKS_PER_SHOTGUN));
};

export const resolvePlayerStats = (player, playerStats, players) => {
  if (!player) return null;
  const direct = playerStats[player.id];
  if (direct) return direct;

  // Strategy 1 — by name, taking the highest total (a reconnect can leave two).
  const named = Object.values(playerStats).filter((s) => s && s.name === player.name);
  if (named.length > 0) {
    return named.reduce((best, cur) => ((cur.totalDrinks > best.totalDrinks) ? cur : best));
  }

  // Strategy 2 — process of elimination over entries with no name at all.
  const unnamed = Object.values(playerStats).filter((s) => s && !s.name);
  if (unnamed.length > 0) {
    return [...unnamed].sort((a, b) => (b.totalDrinks || 0) - (a.totalDrinks || 0))[0];
  }
  return null;
};
