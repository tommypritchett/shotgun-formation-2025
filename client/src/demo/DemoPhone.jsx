/**
 * One player's actual screen, at the moment the script says.
 *
 * This renders the REAL `GameScreen` and `DrinkAssigner` — the same components
 * the game ships — rather than a simplified stand-in. That is the point of the
 * rewrite: a mock-up of the UI teaches the mock-up. Somebody watching this and
 * then opening the game should see the screen they were just shown.
 *
 * Both components are already presentational (props in, markup out), so nothing
 * had to be extracted and neither was modified. Everything below is prop
 * construction from the script.
 *
 * ── The three states a round puts you in ─────────────────────────────────
 *
 * The demo has to show all three, because "what happens when I DON'T have the
 * card" is most of the game and the thing a new player asks about first:
 *
 *   holding it   DrinkAssigner with a pool > 0 — tap people to hand out drinks
 *   not holding  DrinkAssigner in `passive` mode — you are drinking, sit tight
 *   First Down   DrinkAssigner in `firstDown` mode — everyone, once, no card
 *
 * Between rounds everyone is back on `GameScreen` with their hand.
 *
 * The phone is a real 380px-wide viewport scaled with a transform, so the
 * layout inside is the genuine mobile layout rather than a squeezed desktop
 * one. Scaling the whole frame keeps every proportion honest.
 */
import GameScreen from '../screens/GameScreen';
import DrinkAssigner from '../components/DrinkAssigner';
import { getCard, tierFor, ROUND_DURATIONS } from '../data/cards';
import { pourPhase } from '../lib/phases';

const NOOP = () => {};

export default function DemoPhone({ player, view, players, label }) {
  const {
    declared, secondsLeft, given, hand, quarter, watching, boardTab,
    lastRoundCardId, lastRoundRows,
  } = view;

  const card = declared && declared.cardId ? getCard(declared.cardId) : null;
  const isFirstDown = Boolean(declared && declared.globalEvent === 'First Down');
  const inRound = Boolean(declared);

  // What this player owes, exactly as the server would have worked it out:
  // copies x the card's value, folded ten-to-one into shotguns.
  const owed = view.owed || { shotguns: 0, drinks: 0 };
  const phase = pourPhase(owed.shotguns, owed.drinks, given || {});
  const pool = phase.pool;
  const isPassive = !isFirstDown && pool <= 0;

  const targets = players.filter((p) => p.id !== player.id);
  const pourCount = Object.values((given || {})[phase.bucket] || {})
    .reduce((n, v) => n + (v || 0), 0);
  const givenMap = (given || {})[phase.bucket] || {};

  const duration = isFirstDown
    ? ROUND_DURATIONS.firstDown
    : (card && card.deck === 'wild' ? ROUND_DURATIONS.wild : ROUND_DURATIONS.standard);

  return (
    <div className="dphone-wrap">
      <div className="dphone-label">{label || player.name}</div>
      <div className="dphone-frame">
        <div className="dphone">
          {inRound ? (
            <DrinkAssigner
              card={card}
              copies={declared.copies || 1}
              source={view.source || null}
              watching={watching}
              secondsLeft={secondsLeft}
              fraction={secondsLeft / duration}
              tier={card ? tierFor(card) : 'amber'}
              passive={isPassive}
              firstDown={isFirstDown}
              targets={targets}
              given={givenMap}
              pourCount={pourCount}
              pool={pool}
              isShotgun={phase.isShotgun}
              unit={phase.unit}
              rolledOver={phase.rolledOver}
              shotgunsOwed={phase.shotgunsOwed}
              drinksOwed={phase.drinksOwed}
              sent={Boolean(view.sent)}
              animations={view.animations || {}}
              onGive={NOOP}
              onUndo={NOOP}
              onLockIn={NOOP}
            />
          ) : (
            <GameScreen
              quarter={quarter}
              roomCode={view.roomCode}
              onMenu={NOOP}
              players={players}
              boardTab={boardTab || 'stand'}
              onBoardTab={NOOP}
              boardPulse={false}
              lastRoundCardId={lastRoundCardId}
              lastRoundRows={lastRoundRows || []}
              hand={hand}
              onCardTap={NOOP}
              selfId={player.id}
              isHost={Boolean(player.isRef)}
              onDeclare={NOOP}
              noCardMessage={view.noCardMessage || ''}
              watching={watching}
            />
          )}
        </div>
      </div>
    </div>
  );
}
