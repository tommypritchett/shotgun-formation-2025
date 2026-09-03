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
import LiveScore from '../components/LiveScore';
import CallFeed from '../components/CallFeed';
import SuggestionPrompt from '../components/SuggestionPrompt';

export default function GameScreen({
  quarter, roomCode, onMenu,
  players, boardTab, onBoardTab, boardPulse,
  lastRoundCardId, lastRoundRows,
  hand, onCardTap, selfId,
  isHost, onDeclare,
  noCardMessage,
  // Live game tracking. All optional: a room with no game attached renders
  // exactly what it rendered before any of this existed.
  watching = null, onWatchGame, onDetachGame,
  callEntries = [], callFeedOpen = false, onCallFeedToggle,
  autoCallPaused = false, feedNotice = '', onOpenDial,
  suggestion = null, suggestionLeft = 0, onAcceptSuggestion, onDismissSuggestion,
}) {
  return (
    <div className="app">
      <GameHeader quarter={quarter} roomCode={roomCode} onMenu={onMenu} />

      {watching ? (
        <LiveScore watching={watching} onDetach={onDetachGame} canDetach={Boolean(onDetachGame)} />
      ) : null}

      {/* Said once, when the feed starts calling. */}
      {feedNotice ? <p className="feednotice">{feedNotice}</p> : null}
      {watching && autoCallPaused ? (
        <p className="feednotice paused">Auto-calling is paused. You are calling by hand.</p>
      ) : null}

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
            selfId={selfId}
          />
          <div className="blk-hand">
            <HandGrid standard={hand.standard} wild={hand.wild} onCardTap={onCardTap} />
          </div>
        </div>
      </div>

      {suggestion ? (
        <SuggestionPrompt
          suggestion={suggestion}
          secondsLeft={suggestionLeft}
          onAccept={onAcceptSuggestion}
          onDismiss={onDismissSuggestion}
        />
      ) : null}

      {watching ? (
        <CallFeed entries={callEntries} open={callFeedOpen} onToggle={onCallFeedToggle} />
      ) : null}

      {noCardMessage ? <p className="waiting">{noCardMessage}</p> : null}

      <div className="dock">
        {isHost && onWatchGame && !watching ? (
          <button type="button" className="watchbtn primary" onClick={onWatchGame}>
            <span className="ref">REF</span> Select a game
          </button>
        ) : null}
        {isHost && watching && onOpenDial ? (
          <button type="button" className="watchbtn" onClick={onOpenDial}>What the feed calls</button>
        ) : null}
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
