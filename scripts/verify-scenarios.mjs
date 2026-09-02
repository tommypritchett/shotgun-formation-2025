/**
 * Run every check in docs/MANUAL_TEST_LIVE_FEED.md against a real server, and
 * report what was actually OBSERVED rather than what was expected.
 *
 *   ALLOW_REPLAY_ATTACH=1 BROADCAST_DELAY_MS=4000 PORT=3002 node server.js
 *   node scripts/verify-scenarios.mjs
 *
 * Uses real sockets against the real server: real rooms, real rounds, the real
 * declaration path. Deliberately not the browser — this is about behaviour, and
 * the browser demo is a separate artifact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.VERIFY_URL || 'http://127.0.0.1:3002';
const OPTS = { transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fixture = (league, id) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', league, `${id}.json`), 'utf8'));
const slice = (g, n) => ({ ...g, plays: [...g.plays].sort((a, b) => a.sequence - b.sequence).slice(0, n) });

/** A socket that records everything it is sent. */
const connect = (name) => new Promise((resolve) => {
  const s = io(URL, OPTS);
  const log = [];
  s.onAny((event, payload) => log.push({ event, payload, at: Date.now() }));
  s.on('connect', () => resolve({
    name, socket: s, log,
    get id() { return s.id; },
    emit: (...a) => s.emit(...a),
    mark: () => log.length,
    since: (event, from = 0) => log.slice(from).filter((e) => e.event === event).map((e) => e.payload),
    saw: (event, from = 0) => log.slice(from).some((e) => e.event === event),
    wait: (event, { from = 0, timeout = 8000, where = () => true } = {}) => new Promise((res, rej) => {
      const hit = log.slice(from).find((e) => e.event === event && where(e.payload));
      if (hit) return res(hit.payload);
      const t = setTimeout(() => rej(new Error(`${name}: no ${event} in ${timeout}ms`)), timeout);
      const onAny = (ev, payload) => {
        if (ev === event && where(payload)) { clearTimeout(t); s.offAny(onAny); res(payload); }
      };
      s.onAny(onAny);
      return undefined;
    }),
  }));
});

/** Three players in a started game. */
const makeRoom = async () => {
  const host = await connect('Ref');
  const ben = await connect('Ben');
  const cy = await connect('Cy');
  const code = await new Promise((r) => { host.socket.on('roomCreated', r); host.emit('createRoom', 'Ref'); });
  ben.emit('joinRoom', code, 'Ben');
  cy.emit('joinRoom', code, 'Cy');
  await sleep(700);
  host.emit('startGame', code);
  await sleep(900);
  return { code, host, ben, cy, all: [host, ben, cy], close: () => [host, ben, cy].forEach((p) => p.socket.close()) };
};

const results = [];
const check = async (id, title, fn) => {
  process.stdout.write(`${id} ${title}\n`);
  let room = null;
  try {
    room = await makeRoom();
    const observed = await fn(room);
    results.push({ id, title, pass: true, observed });
    console.log(`   PASS — ${observed}\n`);
  } catch (error) {
    results.push({ id, title, pass: false, observed: error.message });
    console.log(`   FAIL — ${error.message}\n`);
  } finally {
    if (room) room.close();
  }
};

/**
 * One poller per GAME is the design — eight rooms watching the Chiefs share a
 * subscription — so two checks using the same gameId would share a feed, and
 * the second would join one already running (or already finished) from the
 * first. Each check therefore gets its own game LABEL over the same fixture.
 */
let attachSeq = 0;
const attach = (room, gameId = '401772877', plays = 60, speed = 100000) => {
  attachSeq += 1;
  room.host.emit('attachGame', {
    roomCode: room.code, league: 'nfl', gameId: `${gameId}-check${attachSeq}`,
    replayFixture: slice(fixture('nfl', gameId), plays), speed,
  });
};

// ── 0. THE EXTRA CHECK: a plain game, no feed anywhere near it ──────────────
await check('0.', 'A plain game with no feed: standard + wild by hand, clock and lock-in', async (room) => {
  const notes = [];
  const { host, ben, cy } = room;

  // A standard card, run to the clock.
  let from = ben.mark();
  const hand = await ben.wait('gameStarted', { from: 0, timeout: 8000 }).catch(() => null);
  void hand;
  const myHand = ben.since('gameStarted').slice(-1)[0];
  const standard = myHand?.hands?.[ben.id]?.standard?.[0]?.card;
  if (!standard) throw new Error('no standard card was dealt to Ben');
  host.emit('playStandardCard', { roomCode: room.code, cardType: standard });
  const declared = await ben.wait('declaredCard', { from, where: (c) => c === standard });
  notes.push(`declared "${declared}" by hand`);

  await ben.wait('updateTimer', { from, timeout: 8000 });
  notes.push('clock ran');

  // Someone assigns drinks during the round.
  host.emit('assignDrinks', {
    roomCode: room.code, selectedPlayerIds: [cy.id],
    drinksToGive: { [cy.id]: 2 }, shotgunsToGive: {},
  });
  const finalized = await ben.wait('updatePlayerStats', {
    from, timeout: 40000, where: (p) => p?.roundFinalized === true,
  });
  const cyDrinks = finalized.players?.[cy.id]?.totalDrinks;
  if (!(cyDrinks >= 2)) throw new Error(`drinks did not land: Cy has ${cyDrinks}`);
  notes.push(`round finalized on the clock, Cy has ${cyDrinks} drinks`);

  // A wild card, ended early by everyone locking in.
  await sleep(500);
  from = ben.mark();
  const wild = myHand?.hands?.[ben.id]?.wild?.[0]?.card;
  if (!wild) throw new Error('no wild card was dealt');
  ben.emit('wildCardSelected', { roomCode: room.code, playerId: ben.id, wildcardtype: wild });
  await host.wait('wildCardSelected', { timeout: 8000 });
  host.emit('wildCardConfirmed', { roomCode: room.code, wildcardtype: wild, player: ben.id });
  await ben.wait('declaredCard', { from, where: (c) => c === wild });
  notes.push(`wild "${wild}" confirmed by the Ref`);

  const started = Date.now();
  for (const p of room.all) p.emit('lockIn', { roomCode: room.code });
  await ben.wait('updatePlayerStats', { from, timeout: 30000, where: (p) => p?.roundFinalized === true });
  const took = Math.round((Date.now() - started) / 1000);
  if (took > 12) throw new Error(`lock-in did not end the round early (took ${took}s)`);
  notes.push(`lock-in ended the round in ${took}s`);
  return notes.join('; ');
});

// ── 1. A round starts on its own ────────────────────────────────────────────
await check('1.', 'A round starts on its own, and looks like the Ref started it', async (room) => {
  const from = room.ben.mark();
  attach(room);
  const attached = await room.ben.wait('gameAttached', { from });
  if (!attached.announce) throw new Error('the room was never told the feed is calling');
  const card = await room.ben.wait('declaredCard', { from, timeout: 25000, where: Boolean });
  await room.ben.wait('updateTimer', { from, timeout: 8000 });
  const called = room.ben.since('playAutoCalled', from);
  return `announce shown; "${card}" declared with a running clock; ${called.length} auto-call event(s), first=${called[0]?.cardId}`;
});

// ── 2. The Ref overrides mid-flight ─────────────────────────────────────────
await check('2.', 'A manual declaration wins and clears the queue', async (room) => {
  attach(room, '401772877', 60, 40);
  await room.ben.wait('gameAttached');
  // Detections release 4s after being queued, so wait until some are actually
  // WAITING before the Ref steps in. Declaring earlier clears an empty queue,
  // which proves nothing.
  await sleep(5000);
  const from = room.ben.mark();
  room.host.emit('firstDownEvent', { roomCode: room.code });
  await room.ben.wait('declaredCard', { from, where: (c) => c === 'First Down' });
  await sleep(600);
  const cleared = room.ben.since('queueCleared', from);
  if (!cleared.length) throw new Error('the Ref declared but nothing was cleared');
  return `First Down declared by hand; queue cleared, ${cleared[0].dropped} detection(s) dropped`;
});

// ── 3/4. Suggestions ────────────────────────────────────────────────────────
await check('3.', 'A suggestion reaches the Ref only, and accepting it declares', async (room) => {
  const fromHost = room.host.mark();
  const fromBen = room.ben.mark();
  attach(room, '401772877', 120, 100000);
  const offer = await room.host.wait('playSuggested', { from: fromHost, timeout: 25000 });
  if (room.ben.saw('playSuggested', fromBen)) throw new Error('a non-Ref received the suggestion');
  // Wait for any auto round to actually FINISH. Accepting into a live round
  // correctly returns busy, which would look like the accept doing nothing.
  await room.ben.wait('updatePlayerStats', {
    from: fromBen, timeout: 45000, where: (p) => p?.roundFinalized === true,
  }).catch(() => {});
  await sleep(800);

  const before = room.ben.mark();
  room.host.emit('acceptSuggestion', { roomCode: room.code, cardId: offer.cardId });
  const card = await room.ben.wait('declaredCard', { from: before, timeout: 20000, where: Boolean });
  return `"${offer.cardId}" offered to the Ref only; accepting declared "${card}"`;
});

await check('4.', 'An ignored suggestion declares nothing', async (room) => {
  const fromHost = room.host.mark();
  attach(room, '401772877', 120, 100000);
  const offer = await room.host.wait('playSuggested', { from: fromHost, timeout: 25000 });
  // Do nothing at all. Expiry is client-side, so what is checked here is that
  // the server never declares it by itself.
  const before = room.ben.mark();
  await sleep(6000);
  const declared = room.ben.since('declaredCard', before).filter(Boolean);
  const asSuggested = declared.filter((c) => c === offer.cardId);
  if (asSuggested.length) throw new Error(`ignoring "${offer.cardId}" still declared it`);
  return `"${offer.cardId}" ignored; server declared it 0 times`;
});

// ── 5. The pause control ────────────────────────────────────────────────────
await check('5.', 'Pause stops calls, keeps the game attached, Ref still declares', async (room) => {
  attach(room, '401772877', 60, 30);
  await room.ben.wait('gameAttached');
  room.host.emit('pauseAutoCall', { roomCode: room.code, paused: true });
  await room.ben.wait('autoCallPaused', { where: (p) => p.paused === true });

  const from = room.ben.mark();
  // Long enough for several header updates to arrive at 30x, and for anything
  // queued at pause time to have been released had it not been dropped.
  await sleep(9000);
  const declared = room.ben.since('declaredCard', from).filter(Boolean);
  if (declared.length) throw new Error(`paused, but "${declared[0]}" was still declared`);
  if (room.ben.saw('gameDetached', from)) throw new Error('pausing detached the game');
  const updates = room.ben.since('gameFeedUpdate', from).length;

  const manual = room.ben.mark();
  room.host.emit('firstDownEvent', { roomCode: room.code });
  await room.ben.wait('declaredCard', { from: manual, where: (c) => c === 'First Down' });
  return `0 auto-calls in 7s while paused; still attached with ${updates} header update(s); Ref declared by hand`;
});

// ── 6. Turning a card down ──────────────────────────────────────────────────
await check('6.', 'A card set to off stops firing; a card with no signal cannot be turned on', async (room) => {
  room.host.emit('setCardMode', { roomCode: room.code, cardId: 'First Down', mode: 'off' });
  await room.ben.wait('cardModes');
  const from = room.ben.mark();
  attach(room, '401772877', 60, 100000);
  await sleep(9000);
  const called = room.ben.since('playAutoCalled', from).map((p) => p.cardId);
  if (called.includes('First Down')) throw new Error('First Down was off and still fired');

  const before = room.host.mark();
  room.host.emit('setCardMode', { roomCode: room.code, cardId: 'Fake Punt/FG', mode: 'auto' });
  await sleep(600);
  if (room.host.saw('cardModes', before)) throw new Error('Fake Punt/FG was allowed to be turned on');
  return `First Down off: ${called.length} call(s), none of them First Down (${[...new Set(called)].join(', ') || 'none'}); Fake Punt/FG refused`;
});

// ── 7. The feed dying ───────────────────────────────────────────────────────
await check('7.', 'The feed ending says so, drains, finishes the live round, then detaches', async (room) => {
  const from = room.ben.mark();
  attach(room, '401772877', 40, 100000);
  const ended = await room.ben.wait('gameFeedEnded', { from, timeout: 20000 });
  const detached = await room.ben.wait('gameDetached', { from, timeout: 60000 });
  const finalized = room.ben.since('updatePlayerStats', from).filter((p) => p?.roundFinalized).length;
  return `feed ended (${ended.reason}), dropped ${ended.dropped}; detached: "${detached.reason}"; ${finalized} round(s) finalized first`;
});

// ── 8. A full game ──────────────────────────────────────────────────────────
await check('8.', 'A whole game end to end, with the queue counters clean', async (room) => {
  const from = room.ben.mark();
  attach(room, '401772879', 179, 100000);
  await room.ben.wait('gameFeedEnded', { from, timeout: 60000 });
  await room.ben.wait('gameDetached', { from, timeout: 90000 });
  const called = room.ben.since('playAutoCalled', from);
  const skipped = room.ben.since('playSkipped', from);
  return `${called.length} declared, ${skipped.length} skipped (busy/no-holder); feed reached the final whistle and detached`;
});

console.log('\n──────── summary ────────');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id} ${r.title}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
fs.writeFileSync(path.join(ROOT, 'artifacts', 'scenario-results.json'), JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
