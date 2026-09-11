/**
 * Where this app lives, in ONE place.
 *
 * `shotgunformation.com` is registered but DNS/Render verification is still in
 * progress, so the live host is the onrender.com one. Every user-visible URL —
 * the invite message, the result card, the end card — reads from here, so the
 * switch is a one-line change the day DNS verifies rather than a grep.
 *
 * Two constants on purpose:
 *
 *   SITE_ORIGIN  where links must actually WORK today. Used to build the
 *                invite URL, because a link to a domain that does not resolve
 *                is worse than an ugly one.
 *   SITE_LABEL   what a human reads. Safe to show the pretty domain before it
 *                serves, since nobody is clicking it.
 *
 * Collapsing these into one would mean either shipping dead links or printing
 * onrender.com on a card people screenshot.
 */

/** Flip this to true the day shotgunformation.com serves the app. */
export const CUSTOM_DOMAIN_LIVE = false;

const RENDER_HOST = 'https://shotgunformation.onrender.com';
const CUSTOM_HOST = 'https://shotgunformation.com';

/** Origin for links that must resolve right now. */
export const SITE_ORIGIN = CUSTOM_DOMAIN_LIVE ? CUSTOM_HOST : RENDER_HOST;

/** The domain as printed for humans. */
export const SITE_LABEL = 'shotgunformation.com';

/** The join URL for a room, with the code the join screen reads back. */
export const roomUrl = (roomCode) =>
  `${SITE_ORIGIN}/?room=${encodeURIComponent(String(roomCode || '').trim())}`;

export default { SITE_ORIGIN, SITE_LABEL, CUSTOM_DOMAIN_LIVE, roomUrl };
