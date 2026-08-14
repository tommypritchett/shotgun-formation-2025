/**
 * A fake player: a real `socket.io-client` connection that records every
 * server->client event and derives the same view-model the React client builds.
 *
 * Tests assert on this recorded view, never on server internals.
 */
const { io } = require('socket.io-client');

const DEFAULT_WAIT_MS = 5000;

/**
 * Fold a server event into the derived client-side view.
 * @param {string} selfId - this player's socket id; `gameStarted.hands` is keyed
 *   by socket id and carries EVERY player's hand on the initial deal, so we must
 *   pick our own rather than the first entry.
 */
const applyToView = (view, event, payload, selfId) => {
  switch (event) {
    case 'roomCreated':
      return { ...view, roomCode: payload, isHost: true };
    case 'joinedRoom':
      return { ...view, roomCode: payload };
    case 'updatePlayers':
      return { ...view, players: payload };
    case 'gameStarted': {
      const hands = payload?.hands;
      const hand = hands ? hands[selfId] : undefined;
      return {
        ...view,
        gameStarted: true,
        hand: hand ? { standard: hand.standard, wild: hand.wild } : view.hand,
        stats: payload?.playerStats ?? view.stats,
      };
    }
    case 'updatePlayerHand':
      return { ...view, hand: { standard: payload.standard, wild: payload.wild } };
    case 'declaredCard':
      return { ...view, declaredCard: payload };
    case 'noCard':
      return { ...view, noCardMessage: payload };
    case 'updateTimer':
      return { ...view, timeRemaining: payload };
    case 'quarterUpdated':
      return { ...view, quarter: payload };
    case 'newHost':
      return { ...view, hostId: payload?.newHostId };
    case 'updatePlayerStats':
      return {
        ...view,
        stats: payload?.players ?? view.stats,
        roundResults: payload?.roundResults ?? view.roundResults,
      };
    default:
      return view;
  }
};

const EMPTY_VIEW = Object.freeze({
  roomCode: null,
  isHost: false,
  hostId: null,
  gameStarted: false,
  quarter: 1,
  hand: { standard: [], wild: [] },
  declaredCard: null,
  noCardMessage: '',
  timeRemaining: 0,
  players: [],
  stats: {},
  roundResults: {},
});

/**
 * @param {string} url - server base url
 * @param {string} name - display name used by the game
 */
const connectPlayer = async (url, name) => {
  const socket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 10000,
  });

  /** @type {Array<{ event: string, payload: any, at: number, socketId: string }>} */
  const log = [];
  const waiters = new Set();
  let view = { ...EMPTY_VIEW };

  socket.onAny((event, payload) => {
    const entry = { event, payload, at: Date.now(), socketId: socket.id };
    log.push(entry);
    view = applyToView(view, event, payload, socket.id);
    for (const waiter of [...waiters]) {
      if (waiter.matches(entry)) {
        waiters.delete(waiter);
        waiter.resolve(entry);
      }
    }
  });

  const connectOnce = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name}: connect timed out`)), 10000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      if (socket.connected) {
        clearTimeout(timer);
        resolve();
      } else {
        socket.connect();
      }
    });

  await connectOnce();

  const api = {
    name,
    get socket() {
      return socket;
    },
    get id() {
      return socket.id;
    },
    get view() {
      return view;
    },
    get log() {
      return log;
    },

    emit: (event, ...args) => {
      socket.emit(event, ...args);
      return api;
    },

    /** Index into the event log; pass to `waitFor({ since })` to ignore history. */
    mark: () => log.length,

    /** All payloads received for `event` (optionally after a mark). */
    received: (event, since = 0) =>
      log.slice(since).filter((e) => e.event === event).map((e) => e.payload),

    /** Whether `event` arrived at all (optionally after a mark). */
    saw: (event, since = 0) => log.slice(since).some((e) => e.event === event),

    /**
     * Resolve with the payload of the next (or already-recorded) matching event.
     * @param {string} event
     * @param {{ where?: (payload:any)=>boolean, timeout?: number, since?: number }} [opts]
     */
    waitFor: (event, opts = {}) => {
      const { where, timeout = DEFAULT_WAIT_MS, since = 0 } = opts;
      const matches = (entry) => entry.event === event && (!where || where(entry.payload));

      const existing = log.slice(since).find(matches);
      if (existing) return Promise.resolve(existing.payload);

      return new Promise((resolve, reject) => {
        const waiter = {
          matches,
          resolve: (entry) => {
            clearTimeout(timer);
            resolve(entry.payload);
          },
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          const seen = [...new Set(log.slice(since).map((e) => e.event))].join(', ') || '(none)';
          reject(new Error(`${name}: timed out after ${timeout}ms waiting for "${event}". Saw: ${seen}`));
        }, timeout);
        waiters.add(waiter);
      });
    },

    /** Close the transport the way a phone going to sleep would. */
    disconnect: async () => {
      if (!socket.connected) return;
      await new Promise((resolve) => {
        socket.once('disconnect', () => resolve());
        socket.disconnect();
      });
    },

    /** Reopen the same client socket. The server assigns a NEW socket.id. */
    reconnect: async () => {
      await connectOnce();
      return socket.id;
    },

    close: async () => {
      waiters.clear();
      if (socket.connected) await api.disconnect();
      socket.removeAllListeners();
      socket.close();
    },
  };

  return api;
};

module.exports = { connectPlayer, EMPTY_VIEW };
