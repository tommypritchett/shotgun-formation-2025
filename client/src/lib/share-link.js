/**
 * The share link, read back.
 *
 * `handleShareGame` builds `${window.location.origin}?room=${roomCode}` and
 * hands it to `navigator.share`. Nothing ever read that `room` back into state:
 * `roomCode` initialised to '' and the only code path that called
 * `setRoomCode` from the URL was the rejoin effect, which is gated on a
 * `player` param a share link does not carry. So the recipient got an empty
 * room-code field — and, because the field was `readOnly` whenever the URL had
 * a room, no way to type one either.
 *
 * Pure and separate from the component so the parsing can be tested without
 * mounting the app or faking a socket.
 */

/** Room codes are exactly five digits — see `generateRoomCode` in server.js. */
const ROOM_CODE = /^\d{5}$/;

/**
 * The room code a share link carries, or '' if there is not a usable one.
 *
 * Anything that is not a well-formed room code returns '' rather than being
 * pre-filled. A junk value in the field is worse than an empty one: it looks
 * like the app's own state, and the person has no reason to suspect the link.
 *
 * @param {string} search `window.location.search`, e.g. '?room=12345'
 * @returns {string}
 */
export const roomCodeFromSearch = (search) => {
  let value = null;
  try {
    value = new URLSearchParams(String(search || '')).get('room');
  } catch {
    return '';
  }
  const trimmed = String(value || '').trim();
  return ROOM_CODE.test(trimmed) ? trimmed : '';
};

export default { roomCodeFromSearch };
