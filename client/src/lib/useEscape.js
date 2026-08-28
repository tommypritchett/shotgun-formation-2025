/**
 * Escape closes the topmost open sheet.
 *
 * Every modal in the rebuilt UI now honours it. Four already had an explicit
 * Cancel and two were outright traps; Escape working on some and not others was
 * its own bug.
 *
 * Deliberately NOT paired with scrim-click-to-dismiss. On a phone an accidental
 * edge tap during drink assignment would throw away a half-finished pour, which
 * is worse than the trap it would be fixing. Explicit Cancel plus Escape is the
 * pattern.
 */
import { useEffect } from 'react';

/**
 * @param {boolean} open   whether this sheet is showing
 * @param {Function} close what to run on Escape
 */
export default function useEscape(open, close) {
  useEffect(() => {
    if (!open || typeof close !== 'function') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    // Capture phase, so the innermost open sheet wins when two overlap.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);
}
