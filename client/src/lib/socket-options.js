/**
 * The socket.io-client options, in one place so they can be tested.
 *
 * Two of these are load-bearing on a phone, and neither is obvious:
 *
 * **Transport order.** This was `['websocket', 'polling']`. socket.io-client is
 * pinned at 4.8.1 (engine.io-client 6.6.2), where `tryAllTransports` has no
 * default at all — it is read once, in `_onError`, and is `undefined` unless
 * you pass it. So if the FIRST transport fails to open, the client does not try
 * the next one; it emits an error and closes. WebSocket-first therefore meant a
 * phone on a network that blocks WebSocket upgrades failed to connect at all,
 * rather than degrading to polling. The server's own order (`server.js`) is
 * polling-first and always was.
 *
 * **`tryAllTransports`.** Reordering alone is not enough, because
 * `rememberUpgrade: true` makes the client start on WebSocket anyway whenever a
 * previous connection upgraded successfully — which is every returning player.
 * Move from home wifi to a network that blocks WebSocket and you are back in
 * the same dead end. This is the option that actually closes it.
 */
export const SOCKET_OPTIONS = Object.freeze({
  // Polling first, matching the server's list, then upgrade.
  transports: ['polling', 'websocket'],
  // If a transport fails to open, try the next one instead of giving up.
  tryAllTransports: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 100, // Even faster initial retry for mobile
  reconnectionDelayMax: 3000, // Shorter max delay for mobile
  timeout: 45000, // Match server connectTimeout
  pingInterval: 8000, // Match server pingInterval
  pingTimeout: 30000, // Match server pingTimeout
  autoConnect: true,
  // Mobile-specific optimizations
  forceNew: false, // Reuse existing connection when possible
  upgrade: true, // Allow transport upgrades
  rememberUpgrade: true, // Remember successful upgrades
});

export default SOCKET_OPTIONS;
