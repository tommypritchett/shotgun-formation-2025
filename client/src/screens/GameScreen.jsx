/**
 * The one-screen game view.
 *
 * Header, tab board, the whole 7-card hand, and the Declare button, all without
 * vertical scroll at 390x844 with 6 players. Standings scrolls internally past
 * ~6 rows (`.rows { max-height }`) so the hand never gets pushed off.
 *
 * This is what replaced `document.body.style.zoom = "70%"`. The zoom hack was
 * compensating for a layout that did not fit; the layout now fits.
 */
import GameHeader from './GameHeader';
import ScoreBoard from '../components/ScoreBoard';
import HandGrid from '../components/HandGrid';

export default function GameScreen({
  quarter, roomCode, onMenu,
  players, boardTab, onBoardTab, boardPulse,
  lastRoundCardId, lastRoundRows,
  hand, onCardTap,
  isHost, onDeclare,
  noCardMessage,
}) {
  return (
    <div className="app">
      <GameHeader quarter={quarter} roomCode={roomCode} onMenu={onMenu} />

      <div className="body">
        <div className="s1grid">
          <ScoreBoard
            players={players}
            tab={boardTab}
            onTab={onBoardTab}
            pulse={boardPulse}
            lastRoundCardId={lastRoundCardId}
            lastRoundRows={lastRoundRows}
            quarter={quarter}
          />
          <div className="blk-hand">
            <HandGrid standard={hand.standard} wild={hand.wild} onCardTap={onCardTap} />
          </div>
        </div>
      </div>

      {noCardMessage ? <p className="waiting">{noCardMessage}</p> : null}

      <div className="dock">
        {isHost ? (
          <button type="button" className="declare" onClick={onDeclare}>
            <span className="ref">REF</span> Declare Action
          </button>
        ) : (
          <button type="button" className="declare" style={{ opacity: 0.5 }} disabled>
            Waiting on the Ref
          </button>
        )}
      </div>
    </div>
  );
}
