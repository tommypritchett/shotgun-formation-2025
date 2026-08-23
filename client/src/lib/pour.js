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

/**
 * What still needs sending: the difference between what this phone has recorded
 * and what the server already knows.
 *
 * Entries can be NEGATIVE — that is a pour being taken back. The server borrows
 * a shotgun back rather than leaving a negative drink count, so sending one is
 * safe, and sending deltas is what lets undo work for a whole round instead of
 * only inside the flush window.
 *
 * @param {{drinks:Object, shotguns:Object}} local  what the player has tapped
 * @param {{drinks:Object, shotguns:Object}} sent   what the server has already
 * @returns {null | {selectedPlayerIds:string[], drinksToGive:Object, shotgunsToGive:Object}}
 *          null when there is nothing to send.
 */
export const pourDeltas = (local = {}, sent = {}) => {
  const bucket = (name) => {
    const mine = local[name] || {};
    const theirs = sent[name] || {};
    const out = {};
    new Set([...Object.keys(mine), ...Object.keys(theirs)]).forEach((id) => {
      const delta = (mine[id] || 0) - (theirs[id] || 0);
      if (delta !== 0) out[id] = delta;
    });
    return out;
  };

  const drinksToGive = bucket('drinks');
  const shotgunsToGive = bucket('shotguns');
  const selectedPlayerIds = [
    ...new Set([...Object.keys(drinksToGive), ...Object.keys(shotgunsToGive)]),
  ];
  if (selectedPlayerIds.length === 0) return null;
  return { selectedPlayerIds, drinksToGive, shotgunsToGive };
};
