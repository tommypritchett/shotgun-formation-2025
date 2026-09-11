import { useEffect, useState } from 'react';
import { renderResultCard } from '../lib/result-card';
import { shareResultCard } from '../lib/share-result';
import { SITE_LABEL } from '../lib/site';

/**
 * "Share result" — the card, and the one action that gets it into a group chat.
 *
 * ── Fails open, always ───────────────────────────────────────────────────
 *
 * This sits next to the standings at the end of a game, which is a moment
 * people already screenshot. It must never become a thing between a player and
 * the game, so:
 *
 *   render fails  -> NOTHING renders. No button, no message, no gap. The
 *                    standings screen is exactly what it was.
 *   share works   -> the OS sheet opens; nothing else changes
 *   share refused -> the card appears as a visible <img> with "press and hold
 *                    to save", which is the only thing that works on iOS. A
 *                    hidden <a download> does nothing there.
 *
 * The card is rendered once on mount rather than on tap, so a button is only
 * ever shown when there is definitely something behind it.
 */
export default function ShareResult({ players = [], roomCode = '', size = 'feed', title = null, label = 'Share result' }) {
  const [card, setCard] = useState(null);
  const [mode, setMode] = useState('idle');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out = await renderResultCard({ players, roomCode, size, title });
        if (alive && out) setCard(out);
      } catch {
        // Deliberately silent. A card that cannot be drawn is not an error the
        // player can do anything about, and the standings are unaffected.
      }
    })();
    return () => { alive = false; };
    // Rendered once for the standings as they are when this mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!card) return null;

  const onShare = async () => {
    const result = await shareResultCard(card, {
      title: 'Shotgun Formation',
      text: `Final standings — ${SITE_LABEL}`,
    });
    setMode(result === 'shared' ? 'idle' : 'image');
  };

  return (
    <section className="shareres" aria-label="Share the result">
      <button type="button" className="btn ghost shareres-btn" onClick={onShare}>
        {label}
      </button>
      {mode === 'image' ? (
        <div className="shareres-img">
          <img src={card.dataUrl} alt="Final standings" />
          <p className="waiting">Press and hold the image to save or share it.</p>
        </div>
      ) : null}
    </section>
  );
}
