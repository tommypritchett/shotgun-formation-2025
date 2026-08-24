/**
 * A round can owe you BOTH shotguns and drinks, and they are poured in order.
 *
 * The server sends both buckets — a player holding 4x Turnover owes 16, which
 * it splits into `{shotguns: 1, drinkCount: 6}`. The client had ONE pool
 * (`isShotgunRound ? shotgunsToGive : drinksToGive`) and no way to switch, and
 * because `shotgunsToGive` was never decremented `isShotgunRound` stayed true
 * all round. Once the shotgun was poured every further tap was refused and the
 * six drinks could not be assigned at all.
 *
 * The tell that the server was right and the client wrong: `settlePendingPour`
 * correctly left `{drinkCount: 6, shotguns: 0}` outstanding, so the ONLY way to
 * pour those six was to disconnect and come back.
 *
 * Shotguns first, then the assigner rolls over to the drinks. One debt, two
 * phases — so undo has to be able to walk back across the boundary.
 */

export const SHOTGUNS = 'shotguns';
export const DRINKS = 'drinks';

/**
 * Which phase the assigner is in, and what is left in it.
 *
 * @param {number} shotgunsOwed  from the server
 * @param {number} drinksOwed    from the server
 * @param {object} given         { shotguns: {id:n}, drinks: {id:n} } poured so far
 */
export const pourPhase = (shotgunsOwed = 0, drinksOwed = 0, given = {}) => {
  const total = (bucket) =>
    Object.values(given[bucket] || {}).reduce((acc, n) => acc + (n || 0), 0);

  const shotgunsPoured = total(SHOTGUNS);
  const drinksPoured = total(DRINKS);
  const shotgunsLeft = Math.max(0, shotgunsOwed - shotgunsPoured);
  const drinksLeft = Math.max(0, drinksOwed - drinksPoured);

  // Shotguns first. Roll over only once they are all out.
  const inShotgunPhase = shotgunsLeft > 0;
  const bucket = inShotgunPhase ? SHOTGUNS : DRINKS;

  return {
    bucket,
    isShotgun: inShotgunPhase,
    unit: inShotgunPhase ? 'shotgun' : 'drink',
    pool: inShotgunPhase ? shotgunsOwed : drinksOwed,
    poured: inShotgunPhase ? shotgunsPoured : drinksPoured,
    remaining: inShotgunPhase ? shotgunsLeft : drinksLeft,
    /** Everything owed, across both phases, is out. */
    settled: shotgunsLeft === 0 && drinksLeft === 0,
    /** True once shotguns are done AND there are drinks still to pour. */
    rolledOver: !inShotgunPhase && shotgunsOwed > 0 && drinksOwed > 0,
    shotgunsOwed,
    drinksOwed,
    shotgunsLeft,
    drinksLeft,
  };
};

/**
 * Which bucket an undo should take from: the last one actually poured into.
 * Undo walks back across the phase boundary, because it is one debt.
 */
export const undoBucket = (given = {}, stack = []) => {
  const last = stack[stack.length - 1];
  if (!last) return null;
  return last.bucket || DRINKS;
};
