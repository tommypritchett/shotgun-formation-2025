/**
 * Merging the server's roster with what the client already knows.
 *
 * The server's `updatePlayers` payload is `[{ id, name, disconnected }]` — it
 * carries NO cards, because hands live in `playerStats` server-side. The client
 * keeps each player's hand on the player object, so every roster update has to
 * re-attach the cards it already had or the whole table goes blank.
 *
 * This is extracted from App.js so it can be tested without a DOM, and because
 * getting it wrong is expensive: a bug here cost every player at the table a
 * full round (Session 8, item 2).
 */

/**
 * @param {Array} serverPlayers  the `updatePlayers` payload
 * @param {Array} knownPlayers   the roster the client currently holds
 * @param {Object} pendingCards  cards stashed by `gameStarted` before the
 *                               roster existed, keyed by socket id
 */
export const mergePlayerCards = (serverPlayers = [], knownPlayers = [], pendingCards = {}) => {
  const withCards = serverPlayers.map((serverPlayer) => {
    const known = knownPlayers.find((p) => p.id === serverPlayer.id);
    if (known && known.cards) {
      return { ...serverPlayer, cards: known.cards };
    }
    if (pendingCards && pendingCards[serverPlayer.id]) {
      return { ...serverPlayer, cards: pendingCards[serverPlayer.id] };
    }
    return serverPlayer;
  });

  // The roster can legitimately arrive with a duplicate id mid-reconnect; keep
  // whichever copy carries the most complete data.
  return withCards.reduce((acc, player) => {
    const at = acc.findIndex((p) => p.id === player.id);
    if (at === -1) {
      acc.push(player);
      return acc;
    }
    const existing = acc[at];
    const better =
      (player.cards && !existing.cards) ||
      (player.name && !existing.name) ||
      (player.cards && player.cards.standard && player.cards.wild);
    if (better) acc[at] = player;
    return acc;
  }, []);
};

/** Ids consumed from `pendingCards`, so the caller can clear them. */
export const consumedPendingIds = (serverPlayers = [], knownPlayers = [], pendingCards = {}) =>
  serverPlayers
    .filter((sp) => {
      const known = knownPlayers.find((p) => p.id === sp.id);
      return !(known && known.cards) && pendingCards && pendingCards[sp.id];
    })
    .map((sp) => sp.id);
