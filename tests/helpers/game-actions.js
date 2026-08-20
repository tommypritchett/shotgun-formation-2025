/**
 * Game-level actions expressed the way the React client expresses them.
 * Every payload shape here mirrors `client/src/App.js` exactly — if one of
 * these drifts from the client, the tests stop testing the real contract.
 */

/** Real server timer durations (`startTimer` call sites in server.js). */
const ROUND_SECONDS = Object.freeze({ standard: 21, wild: 11, firstDown: 6 });

/**
 * How long to wait for a round to finalize.
 *
 * A round takes `duration + 1` SECONDS on the wire, not `duration`: startTimer
 * decrements once per `setInterval(1000)` tick, and finalizeRound only runs on
 * the tick AFTER the counter reaches zero. So a 21s round needs 22 ticks.
 *
 * The old budget of `duration + 8s` left just 7s of headroom across those 22
 * ticks — about 320ms of drift per tick. setInterval makes no promise of
 * punctuality, and under a parallel suite (12 files, a server process each)
 * that much drift is ordinary. The result was a test that failed roughly one
 * run in ten with a timeout, always in the 21-second rounds, which is exactly
 * what the overnight report predicted would go flaky first.
 *
 * This budgets the real round length plus 12s of drift. It is not a way of
 * making a failure go away: if finalizeRound genuinely never runs, this still
 * fails, just without the false alarms.
 */
const finalizeTimeout = (seconds) => (seconds + 1) * 1000 + 12000;

const createRoom = async (host) => {
  host.emit('createRoom', host.name);
  const roomCode = await host.waitFor('roomCreated');
  return roomCode;
};

const joinRoom = async (player, roomCode) => {
  const since = player.mark();
  player.emit('joinRoom', roomCode, player.name);
  await Promise.race([
    player.waitFor('joinedRoom', { since }),
    player.waitFor('gameStarted', { since }),
  ]);
  return player;
};

/**
 * Wait until `viewer` has been told the room holds at least `count` players.
 * `updatePlayers` is broadcast to every socket separately, so a joiner's own
 * ack can land before the other members' rosters have caught up.
 */
const waitForPlayerCount = (viewer, count, opts = {}) =>
  viewer.waitFor('updatePlayers', {
    ...opts,
    where: (players) => Array.isArray(players) && players.length >= count,
  });

/** The auto-rejoin path the client uses on mount from URL params / localStorage. */
const validateAndJoinRoom = async (player, roomCode) => {
  const since = player.mark();
  player.emit('validateAndJoinRoom', roomCode, player.name);
  return Promise.race([
    player.waitFor('joinedRoom', { since }).then(() => 'lobby'),
    player.waitFor('gameStarted', { since }).then(() => 'game'),
    player.waitFor('roomNotFound', { since }).then(() => 'notFound'),
  ]);
};

const startGame = async (host, roomCode, others = []) => {
  const marks = [host, ...others].map((p) => [p, p.mark()]);
  host.emit('startGame', roomCode);
  await Promise.all(marks.map(([p, since]) => p.waitFor('gameStarted', { since })));
};

/** Host declares one of the five Standard cards. */
const declareStandard = async (host, roomCode, cardType) => {
  const since = host.mark();
  host.emit('playStandardCard', { roomCode, cardType });
  return Promise.race([
    host.waitFor('declaredCard', { since, where: (c) => c === cardType }).then(() => 'declared'),
    host.waitFor('noCard', { since, where: (m) => !!m }).then(() => 'noCard'),
    host.waitFor('actionInProgress', { since }).then(() => 'busy'),
  ]);
};

const declareFirstDown = async (host, roomCode) => {
  const since = host.mark();
  host.emit('firstDownEvent', { roomCode });
  return Promise.race([
    host.waitFor('declaredCard', { since, where: (c) => c === 'First Down' }).then(() => 'declared'),
    host.waitFor('actionInProgress', { since }).then(() => 'busy'),
  ]);
};

/** Player taps a wild card; the host receives it for confirmation. */
const selectWild = async (player, host, roomCode, wildcardtype) => {
  const since = host.mark();
  player.emit('wildCardSelected', { roomCode, playerId: player.id, wildcardtype });
  return host.waitFor('wildCardSelected', { since, where: (p) => p.wildcardtype === wildcardtype });
};

const confirmWild = async (host, roomCode, wildcardtype, playerId) => {
  const since = host.mark();
  host.emit('wildCardConfirmed', { roomCode, wildcardtype, player: playerId });
  return Promise.race([
    host.waitFor('declaredCard', { since, where: (c) => c === wildcardtype }).then(() => 'declared'),
    host.waitFor('actionInProgress', { since }).then(() => 'busy'),
  ]);
};

/**
 * Assign drinks the way the client does: one batched emit carrying per-target
 * counts. `targets` is `[{ player, drinks?, shotguns? }]`.
 */
const assignDrinks = (assigner, roomCode, targets) => {
  const drinksToGive = {};
  const shotgunsToGive = {};
  const selectedPlayerIds = targets.map(({ player, drinks = 0, shotguns = 0 }) => {
    if (drinks) drinksToGive[player.id] = drinks;
    if (shotguns) shotgunsToGive[player.id] = shotguns;
    return player.id;
  });
  assigner.emit('assignDrinks', { roomCode, selectedPlayerIds, drinksToGive, shotgunsToGive });
};

/** Wait for the server to fold the round into totals. */
const waitForRoundFinalized = (player, seconds = ROUND_SECONDS.standard, since = 0) =>
  player.waitFor('updatePlayerStats', {
    since,
    where: (p) => p?.roundFinalized === true,
    timeout: finalizeTimeout(seconds),
  });

const nextQuarter = async (host, roomCode, watchers = []) => {
  const marks = watchers.map((p) => [p, p.mark()]);
  // The host needs its own mark too. Without one, `waitFor` matches the FIRST
  // `quarterUpdated` in the whole log, so the second call to this helper
  // returned a stale 2 instead of 3.
  const hostSince = host.mark();
  host.emit('nextQuarter', { roomCode });
  const quarter = await host.waitFor('quarterUpdated', { since: hostSince });
  await Promise.all(marks.map(([p, since]) => p.waitFor('quarterUpdated', { since })));
  return quarter;
};

const swapWildCard = async (player, roomCode, discardedCard) => {
  const since = player.mark();
  player.emit('wildCardSwap', { roomCode, discardedCard });
  return player.waitFor('updatePlayerHand', { since });
};

/** Read a player's totals out of the last `updatePlayerStats` they received. */
const totalsFor = (viewer, subjectId) => {
  const entry = viewer.view.stats?.[subjectId];
  return {
    totalDrinks: entry?.totalDrinks ?? 0,
    totalShotguns: entry?.totalShotguns ?? 0,
  };
};

/** Find a card in a hand, or throw with a useful message. */
const findCard = (hand, cardName) => {
  const found = hand.find((c) => c.card === cardName);
  if (!found) {
    throw new Error(`Card "${cardName}" not in hand: ${hand.map((c) => c.card).join(', ')}`);
  }
  return found;
};

module.exports = {
  ROUND_SECONDS,
  createRoom,
  joinRoom,
  waitForPlayerCount,
  validateAndJoinRoom,
  startGame,
  declareStandard,
  declareFirstDown,
  selectWild,
  confirmWild,
  assignDrinks,
  waitForRoundFinalized,
  nextQuarter,
  swapWildCard,
  totalsFor,
  findCard,
};
