import { useState } from 'react';

/**
 * The Ref takes somebody out of the game.
 *
 * For the case this exists to solve — a person left the bar without leaving
 * the game, and their cards are still in play with nobody to pour them.
 *
 * Two deliberate choices:
 *
 *  - **A confirm step.** Removing somebody is not recoverable from their side;
 *    they land back on the join screen and have to be re-invited. A single tap
 *    on a phone in a dark bar is too easy to get wrong.
 *  - **Disconnected players are listed, not hidden.** They are the most likely
 *    target: somebody who dropped and is not coming back is exactly who the
 *    Ref wants to remove. Hiding them would defeat the feature.
 *
 * State-free apart from the confirm target, so it can be tested without the
 * app around it — the same shape as the other sheets in this client.
 */
export default function RemovePlayerSheet({
  open = false, players = [], selfId = null,
  onClose = () => {}, onRemove = () => {},
}) {
  const [pending, setPending] = useState(null);

  const others = players.filter((p) => p && p.id !== selfId);
  const close = () => { setPending(null); onClose(); };

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={close} />
      <div
        className={`sheet${open ? ' on' : ''}`}
        role="dialog"
        aria-label="Remove a player"
        aria-modal={open}
      >
        <div className="sheet-head">
          <span className="t">Remove a player</span>
          <button type="button" className="x" onClick={close} aria-label="Close">×</button>
        </div>

        {pending ? (
          <>
            <p className="waiting">
              {pending.name} loses their cards and their drinks, and goes back to
              the start screen. They can rejoin with the room code.
            </p>
            <button
              type="button"
              className="mi mi-remove"
              onClick={() => { onRemove(pending.id); setPending(null); }}
            >
              Remove {pending.name}
            </button>
            <button type="button" className="mi" onClick={() => setPending(null)}>
              Keep them in
            </button>
          </>
        ) : (
          <>
            {others.length === 0 ? (
              <p className="waiting">Nobody else is in the game.</p>
            ) : (
              others.map((player) => (
                <button
                  type="button"
                  className={`mi${player.disconnected ? ' away' : ''}`}
                  key={player.id}
                  onClick={() => setPending(player)}
                >
                  {player.name}
                  {player.disconnected ? <span className="k">AWAY</span> : null}
                </button>
              ))
            )}
            <button type="button" className="mi" onClick={close}>Cancel</button>
          </>
        )}
      </div>
    </>
  );
}
