/**
 * What the server told you to pour.
 *
 * `distributeDrinks` is sent with `io.to(player.id)` — only to players who
 * actually owe something. The client does not need to verify that, and MUST
 * NOT try: the server removes a played card from your hand and deals a
 * replacement the instant the card is played, so by the time any reconnect
 * replay arrives your hand no longer contains it. A client-side "do I hold
 * this card?" check is therefore unsatisfiable after a refresh, which is
 * exactly how a reconnecting player lost the ability to pour (Session 8,
 * item 3).
 *
 * Standard vs Wild is already unambiguous in the payload: `cardType` for
 * Standard, `wildcardtype` for Wild. Read it from there.
 */

/**
 * @returns {null | { card, drinks, shotguns, message }} null if the payload
 *          carries nothing to pour.
 */
export const readPourPrompt = (payload = {}) => {
  const { cardType, wildcardtype } = payload;
  const drinks = Number(payload.drinkCount) || 0;
  const shotguns = Number(payload.shotguns) || 0;
  const card = cardType || wildcardtype || null;

  if (!card) return null;
  if (drinks <= 0 && shotguns <= 0) return null;

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (shotguns > 0) parts.push(plural(shotguns, 'shotgun'));
  if (drinks > 0) parts.push(plural(drinks, 'drink'));

  return {
    card,
    drinks,
    shotguns,
    isWild: !cardType && !!wildcardtype,
    message: `You need to assign ${parts.join(' and ')} for the ${card}!`,
  };
};
