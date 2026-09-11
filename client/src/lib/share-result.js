/**
 * Getting the result card off the phone and into a group chat.
 *
 * ── Fail open ────────────────────────────────────────────────────────────
 *
 * This sits on the critical path of a stranger's first thirty seconds. Nothing
 * here may become a thing that stands between someone and the game, so every
 * failure degrades to "the standings screen, unchanged" rather than an error.
 *
 * Three outcomes, in order of preference:
 *
 *   'shared'   navigator.share({files}) — the good path on iOS Safari and
 *              Android Chrome, which is most players
 *   'image'    the caller shows the PNG in a visible <img> and tells them to
 *              press and hold. NOT a hidden <a download>, which does nothing
 *              useful on iOS
 *   'none'     the render failed; show no share control at all rather than a
 *              button that does nothing
 */

/**
 * Can this browser share an actual file?
 *
 * `navigator.canShare({files})` is the only reliable test. Checking for
 * `navigator.share` alone is not enough: desktop Chrome has `share` but
 * refuses files, so the good path would throw for a whole class of user.
 */
export const canShareFiles = (nav = (typeof navigator !== 'undefined' ? navigator : null)) => {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    const probe = typeof File === 'function'
      ? new File([new Blob([''], { type: 'image/png' })], 'probe.png', { type: 'image/png' })
      : null;
    if (!probe) return false;
    return Boolean(nav.canShare({ files: [probe] }));
  } catch {
    return false;
  }
};

/**
 * @returns {Promise<'shared'|'image'|'none'>}
 */
export const shareResultCard = async (
  rendered,
  { title = 'Shotgun Formation', text = '' } = {},
  nav = (typeof navigator !== 'undefined' ? navigator : null),
) => {
  if (!rendered || !rendered.blob) return 'none';

  if (canShareFiles(nav)) {
    try {
      const file = new File([rendered.blob], 'shotgun-formation.png', { type: 'image/png' });
      await nav.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      // A cancelled share sheet throws exactly like a broken one. Either way
      // the honest next step is the image, not an error.
      return 'image';
    }
  }
  return 'image';
};

export default { shareResultCard, canShareFiles };
