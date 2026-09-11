/**
 * The invite message, and getting it out of the host's phone in one tap.
 *
 * Today the host reads a code out loud. That is where players are lost — in a
 * loud room, to someone who mishears one digit and gives up.
 *
 * ── The message ──────────────────────────────────────────────────────────
 *
 * It has to read correctly when it lands in iMessage with no editing, so it is
 * plain text with the link on its own line.
 *
 * The code is written out AS WELL as being in the link, deliberately. The link
 * carries it and the join screen reads it back and prefills — but some clients
 * mangle URLs, some people retype rather than tap, and a code costs one line.
 */
import { SITE_ORIGIN, roomUrl } from './site';

export const inviteText = (roomCode) => {
  const code = String(roomCode || '').trim();
  return [
    'Shotgun Formation — join my room',
    '',
    `Code: ${code}`,
    roomUrl(code),
    '',
    'No app, no signup. Just open the link.',
  ].join('\n');
};

/**
 * Share the invite, or copy it.
 *
 * @returns {Promise<'shared'|'copied'|'failed'>}
 *
 * `copied` must be reported back to the UI and SHOWN. A silent clipboard write
 * reads as a dead button, which is the same lost player the feature exists to
 * prevent.
 */
export const shareInvite = async (
  roomCode,
  nav = (typeof navigator !== 'undefined' ? navigator : null),
) => {
  const text = inviteText(roomCode);
  if (!nav) return 'failed';

  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'Shotgun Formation', text });
      return 'shared';
    } catch {
      // Cancelled or unsupported — fall through to the clipboard rather than
      // leaving the host with nothing.
    }
  }

  if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
};

export { SITE_ORIGIN, roomUrl };
export default { inviteText, shareInvite };
