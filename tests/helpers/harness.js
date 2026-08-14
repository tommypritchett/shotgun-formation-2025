/**
 * Integration harness for Shotgun Formation.
 *
 *   const h = await createHarness();
 *   const room = await h.newGame(['Ava', 'Ben', 'Cy']);   // created + joined + started
 *   await room.declareStandard('Touchdown');
 *   ...
 *   await h.teardown();
 *
 * One real `server.js` process, real `socket.io-client` players, no mocks.
 */
const { startServer } = require('./server-process');
const { connectPlayer } = require('./fake-player');
const actions = require('./game-actions');

const { ROUND_SECONDS } = actions;

/**
 * @param {{ debug?: boolean }} [options]
 */
const createHarness = async (options = {}) => {
  const server = await startServer(options);
  /** @type {Array<import('./fake-player').FakePlayer>} */
  const players = [];

  /** Connect a player without putting them in a room. */
  const connect = async (name) => {
    const player = await connectPlayer(server.url, name);
    players.push(player);
    return player;
  };

  /**
   * Create a room. `names[0]` is the host; the rest join the lobby.
   * @returns {Promise<Room>}
   */
  const newRoom = async (names) => {
    if (!names.length) throw new Error('newRoom needs at least one name');
    const [hostName, ...guestNames] = names;
    const host = await connect(hostName);
    const roomCode = await actions.createRoom(host);

    const guests = [];
    for (const name of guestNames) {
      const marks = [host, ...guests].map((p) => [p, p.mark()]);
      const guest = await connect(name);
      await actions.joinRoom(guest, roomCode);
      guests.push(guest);
      // Settle every member's roster before the next join, so tests never race
      // the per-socket `updatePlayers` broadcast.
      const expected = guests.length + 1;
      await Promise.all([
        ...marks.map(([p, since]) => actions.waitForPlayerCount(p, expected, { since })),
        actions.waitForPlayerCount(guest, expected),
      ]);
    }
    return makeRoom(roomCode, host, guests);
  };

  /** Create a room and immediately start the game. */
  const newGame = async (names) => {
    const room = await newRoom(names);
    await room.start();
    return room;
  };

  /**
   * A room binds the room code + its members to the action helpers so tests
   * read like the game rather than like socket plumbing.
   */
  function makeRoom(roomCode, host, guests) {
    const room = {
      code: roomCode,
      host,
      guests,
      get all() {
        return [room.host, ...room.guests];
      },
      /** Everyone currently connected in the room. */
      get connected() {
        return room.all.filter((p) => p.socket.connected);
      },

      /** Add a player to an existing room (lobby or mid-game). */
      add: async (name) => {
        const marks = room.connected.map((p) => [p, p.mark()]);
        const player = await connect(name);
        await actions.joinRoom(player, roomCode);
        room.guests.push(player);
        const expected = room.all.length;
        await Promise.all(
          marks.map(([p, since]) => actions.waitForPlayerCount(p, expected, { since }))
        );
        return player;
      },

      start: () => actions.startGame(room.host, roomCode, room.guests),

      declareStandard: (cardType) => actions.declareStandard(room.host, roomCode, cardType),
      declareFirstDown: () => actions.declareFirstDown(room.host, roomCode),
      selectWild: (player, wildcardtype) =>
        actions.selectWild(player, room.host, roomCode, wildcardtype),
      confirmWild: (wildcardtype, playerId) =>
        actions.confirmWild(room.host, roomCode, wildcardtype, playerId),
      assignDrinks: (assigner, targets) => actions.assignDrinks(assigner, roomCode, targets),
      nextQuarter: () => actions.nextQuarter(room.host, roomCode, room.connected),
      swapWildCard: (player, discardedCard) => actions.swapWildCard(player, roomCode, discardedCard),

      /**
       * Play a full standard round: declare, let holders assign, wait for finalize.
       * `assign` is `(holders) => [[assigner, targets], ...]` or omitted for none.
       */
      playStandardRound: async (cardType, assign) => {
        const watcher = room.host;
        const since = watcher.mark();
        const outcome = await room.declareStandard(cardType);
        if (outcome !== 'declared') return { outcome };
        if (assign) await assign();
        await actions.waitForRoundFinalized(watcher, ROUND_SECONDS.standard, since);
        return { outcome };
      },

      waitForFinalize: (player = room.host, seconds = ROUND_SECONDS.standard, since = 0) =>
        actions.waitForRoundFinalized(player, seconds, since),
    };
    return room;
  }

  const teardown = async () => {
    await Promise.all(players.map((p) => p.close().catch(() => {})));
    players.length = 0;
    await server.stop();
  };

  return {
    server,
    url: server.url,
    logs: server.logs,
    crashed: server.crashed,
    assertAlive: server.assertAlive,
    connect,
    newRoom,
    newGame,
    teardown,
    ...actions,
  };
};

module.exports = { createHarness, ...actions };
