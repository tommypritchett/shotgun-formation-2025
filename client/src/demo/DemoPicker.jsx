/**
 * The "pick the game you're watching" slate.
 *
 * A NEW component rather than a reuse of `components/GamePicker`, for a reason
 * that is not stylistic: GamePicker renders a hardcoded league tab reading
 * "NFL", and this route may not carry those letters. Reusing it would mean
 * changing its markup, which is out of bounds this session.
 *
 * Every club and city on this slate is invented — see the note at the top of
 * script.js for why that matters more here than in the real app.
 */
export default function DemoPicker({ games = [], pickedId = null, hovering = null }) {
  return (
    <section className="dpicker" aria-label="Pick a game">
      <h2 className="dpicker-h">Pick a game</h2>
      <ul className="dpicker-list">
        {games.map((g) => {
          const live = g.state === 'in';
          const chosen = pickedId === g.id;
          const cursor = hovering === g.id;
          return (
            <li key={g.id}>
              <div
                className={`dgame${live ? ' live' : ''}${chosen ? ' picked' : ''}${cursor ? ' hover' : ''}`}
                aria-current={chosen ? 'true' : undefined}
              >
                <span className="dg-teams">
                  {g.away.code} <span className="at">@</span> {g.home.code}
                </span>
                <span className="dg-score">
                  {g.state === 'pre' ? '' : `${g.away.score}–${g.home.score}`}
                </span>
                <span className="dg-when">{g.detail}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
