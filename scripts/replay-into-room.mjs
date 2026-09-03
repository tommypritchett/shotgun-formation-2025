/**
 * Run a recorded game into a real room, at real speed.
 *
 * This is the point of Part A. The frequency table says ~71 auto-calls a game;
 * only watching a quarter of one at 1x tells you whether that reads as alive or
 * as relentless, and that is a judgement nobody can make from a table.
 *
 * Nothing declares a card. The room sees the score in its header and a running
 * feed of what the system WOULD have called, with the 45-second broadcast delay
 * already applied — so the rhythm on screen is the rhythm the room would feel.
 *
 * Usage:
 *
 *   # 1. start the server with the replay seam on
 *   ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
 *
 *   # 2. open the app, make a room, start a game, note the room code
 *
 *   # 3. run a fixture into it
 *   node scripts/replay-into-room.mjs 12345 fixtures/nfl/401772879.json
 *
 *   # ...or faster, to check it end to end without sitting through a game
 *   node scripts/replay-into-room.mjs 12345 fixtures/nfl/401772879.json --speed 20
 *
 *   # ...or start at the two-minute drill rather than the opening kickoff
 *   node scripts/replay-into-room.mjs 12345 fixtures/nfl/401772879.json --from 150
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const positional = args.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const [roomCode, fixturePath] = positional;
const url = flag('url', process.env.REPLAY_SERVER_URL || 'http://127.0.0.1:3002');
const speed = Number(flag('speed', '1')) || 1;
const from = Number(flag('from', '0')) || 0;

if (!roomCode || !fixturePath) {
  console.error('usage: replay-into-room.mjs <roomCode> <fixture.json> [--speed N] [--from N] [--url URL]');
  process.exit(2);
}

const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));
const plays = Array.isArray(fixture.plays) ? fixture.plays : [];
if (from > 0) {
  fixture.plays = [...plays].sort((a, b) => a.sequence - b.sequence).slice(from);
}

const minutes = plays.length && fixture.plays.length
  ? Math.round((fixture.plays.length * 25) / speed / 60)
  : 0;

console.log(`▶ ${fixture.name || fixture.gameId} (${fixture.league})`);
console.log(`  ${fixture.plays.length} plays at ${speed}x into room ${roomCode} — roughly ${minutes} min`);
console.log(`  nothing will be declared; watch the room's feed for what it WOULD have called\n`);

const socket = io(url, { transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: false });

socket.on('connect_error', (error) => {
  console.error(`✖ could not reach ${url}: ${error.message}`);
  console.error('  is the server running, and started with ALLOW_REPLAY_ATTACH=1 ?');
  process.exit(1);
});

socket.on('connect', () => {
  socket.emit('attachGame', {
    roomCode,
    league: fixture.league || 'nfl',
    gameId: String(fixture.gameId || 'replay'),
    replayFixture: fixture,
    speed,
  });
});

socket.on('gameAttached', (payload) => {
  console.log(`✔ attached to room ${roomCode}: ${payload.league}/${payload.gameId}`);
});

let calls = 0;
socket.on('playAutoCalled', ({ cardId, reason }) => {
  calls += 1;
  const stamp = new Date().toLocaleTimeString();
  console.log(`  ${stamp}  ${String(calls).padStart(3)}  ${cardId.padEnd(20)} ${reason || ''}`);
});

socket.on('gameFeedEnded', ({ reason }) => {
  console.log(`\n■ feed ended (${reason}). ${calls} calls in total.`);
  socket.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`\n■ stopped. ${calls} calls so far.`);
  socket.emit('detachGame', { roomCode });
  setTimeout(() => process.exit(0), 200);
});
