/**
 * The drink assigner — the screen where the round is actually played.
 *
 * Three states:
 *   ACTIVE     — a grid of pour targets, an ammo readout, undo, and the dock.
 *   PASSIVE    — you hold none of the declared card, so there is nothing to
 *                tap. The screen says so instead of showing a dead grid, and
 *                tells you to watch your own phone: the game is anonymous by
 *                design (FOLLOW_UPS.md P1), so nobody points at anybody. You
 *                find out what you were given when the round lands.
 *   FIRST DOWN — a GLOBAL event. Everyone drinks one and nobody holds anything.
 *                It gets its own screen because the passive copy is about
 *                waiting to receive drinks, which is not what is happening
 *                here — everyone drinks, right now. Reported by a player.
 *
 * Presentational: every tap is reported upward. The decision about what goes on
 * the wire lives in App.js, next to the socket.
 */
import GameCard from './GameCard';
import PlayerTile from './PlayerTile';
import { CAN } from './CanMark';

export default function DrinkAssigner({
  card,
  copies,
  source,
  secondsLeft,
  fraction,
  tier,
  passive,
  firstDown,
  targets,
  given,
  pourCount,
  pool,
  isShotgun,
  unit,
  sent,
  rolledOver,
  shotgunsOwed,
  drinksOwed,
  animations,
  onGive,
  onUndo,
  onLockIn,
}) {
  // The red frame means "hurry, you still have drinks to hand out". On First
  // Down, and on the passive screen, there is nothing to hurry — the only
  // action is to drink. Flashing an alarm at someone the app has just told to
  // sit tight is the same contradiction as the old First Down wording.
  const canAct = !firstDown && !passive;
  const panic = canAct && secondsLeft <= 5 && secondsLeft > 0;
  const remaining = Math.max(0, pool - pourCount);
  const classes = ['assign', panic ? 'panic' : '', sent || remaining === 0 ? 'spent' : '']
    .filter(Boolean).join(' ');

  const gridClasses = [
    'pgrid',
    targets.length > 6 ? 'cols3' : '',
    targets.length <= 4 ? 'big' : '',
  ].filter(Boolean).join(' ');

  const unitWord = isShotgun
    ? (remaining === 1 ? 'Shotgun' : 'Shotguns')
    : (remaining === 1 ? 'Drink' : 'Drinks');

  return (
    <div className={classes} data-tier={tier}>
      <div className="danger" aria-hidden="true" />

      <div className="timerbar" aria-hidden="true">
        <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, fraction))})` }} />
      </div>

      <div className="declared">
        <div className="mini">{card ? <GameCard card={card} mini /> : null}</div>
        <div className="dmeta">
          <span className="src">{source}</span>
          <span className="cname">{card ? card.label : ''}</span>
          <span className="hold">
            {firstDown ? (
              <>Everyone at the table drinks <b>1</b>.</>
            ) : passive ? (
              <>You hold <b>0</b> of this card.</>
            ) : (
              <>
                You hold <b>×{copies}</b> · worth{' '}
                {shotgunsOwed > 0 && drinksOwed > 0 ? (
                  <b>
                    {shotgunsOwed} {shotgunsOwed === 1 ? 'shotgun' : 'shotguns'}
                    {' + '}{drinksOwed} {drinksOwed === 1 ? 'drink' : 'drinks'}
                  </b>
                ) : (
                  <b>{pool} {isShotgun ? (pool === 1 ? 'shotgun' : 'shotguns') : (pool === 1 ? 'drink' : 'drinks')}</b>
                )}
              </>
            )}
          </span>
        </div>
        <div className="clockbox" role="timer" aria-live="off">
          <span className="cd num">{secondsLeft}</span>
          <span className="cu">SEC</span>
        </div>
      </div>

      {firstDown ? (
        <>
          <div className="passive firstdown">
            <img className="mark" src={CAN} alt="" />
            <h2>First Down</h2>
            <p className="lede">Everyone drinks one.</p>
            <p>The Ref called it — no card needed, nobody to pick. Drink up.</p>
          </div>
          <div className="passive-dock">
            <div className="in">
              <span>Next call in</span>
              <span className="c num">{secondsLeft}</span>
            </div>
          </div>
        </>
      ) : passive ? (
        <>
          <div className="passive">
            <img className="mark" src={CAN} alt="" />
            <h2>You don&apos;t<br />hold this card</h2>
            <p>Nothing to give this round. Keep an eye on your phone — you&apos;ll see if you picked any up.</p>
            <div className="hr" />
            <div className="sec" style={{ justifyContent: 'center' }}>
              <span className="tag">{targets.length} at the table</span>
            </div>
            <div className="watchers">
              {targets.map((p) => (
                <span className="watcher" key={p.id}>
                  <img src={p.avatar} alt="" style={{ '--ring': p.avatarRing }} />
                  <span className="n">{p.name}</span>
                  <span className="st" />
                </span>
              ))}
            </div>
          </div>
          <div className="passive-dock">
            <div className="in">
              <span>Round ends in</span>
              <span className="c num">{secondsLeft}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="abody">
            <div className="gridhead">
              {/* The header changes with the phase, so nobody thinks they are
                  pouring the same thing twice. */}
              <span className="tag">
                {rolledOver ? 'Now your drinks' : `Tap to pour${isShotgun ? ' shotguns' : ''}`}
              </span>
              <span className="hint">One tap = one {unit}</span>
            </div>
            <div className={gridClasses}>
              {targets.map((p) => (
                <PlayerTile
                  key={p.id}
                  player={p}
                  given={given[p.id] || 0}
                  unit={unit}
                  isShotgun={isShotgun}
                  animation={animations[p.id]}
                  onGive={onGive}
                />
              ))}
            </div>
          </div>

          <div className="adock">
            <div className="adock-in">
              <button type="button" className="undo" onClick={onUndo} disabled={pourCount === 0 || sent}>
                <svg
                  width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                >
                  <path d="M3 8h11a6 6 0 0 1 0 12H8" />
                  <path d="M7 4L3 8l4 4" />
                </svg>
                <span>UNDO</span>
              </button>
              <div id="ammoSlot">
                {sent ? (
                  <button type="button" className="lockin sent" disabled>
                    SENT ✓ &nbsp;{pourCount} POUR{pourCount === 1 ? '' : 'S'}
                    {remaining > 0 ? ` · ${remaining} EXPIRED` : ''}
                  </button>
                ) : remaining > 0 ? (
                  <div className="ammo" role="status" aria-live="polite">
                    <span className="big num">{remaining}</span>
                    <span className="lbl">
                      <span className="u">{unitWord}</span>
                      <span className="s">LEFT TO ASSIGN</span>
                    </span>
                    {isShotgun ? <img src={CAN} alt="" /> : null}
                  </div>
                ) : (
                  <button type="button" className="lockin" onClick={onLockIn}>LOCK IN</button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
