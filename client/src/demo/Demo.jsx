/**
 * "Follow a game" — the walkthrough, and How to Play.
 *
 * One build, two audiences:
 *
 *   /how-to-play          self-paced, with controls, linked from the app
 *   /how-to-play?clean=1  autoplays, every control hidden — this is the URL
 *                         that gets screen-recorded and the one that gets sent
 *                         to people who will judge the project on it
 *
 * ── No server, no socket, no feed ────────────────────────────────────────
 *
 * Everything here is scripted in `script.js` and rendered locally. The route
 * mounts and runs to completion with the game server switched off, on a
 * Tuesday in July, with no fixture file and no network at all. That is a
 * requirement rather than a nicety: it will be opened by strangers on bad wifi,
 * and reliability matters more than fidelity.
 *
 * ── Determinism ──────────────────────────────────────────────────────────
 *
 * The clock is a frame loop accumulating `elapsed` from rAF deltas, and every
 * visible thing is a pure function of `elapsed`. No Math.random, no Date.now.
 * Stepping to beat 8 shows exactly what playing to beat 8 shows, which is what
 * makes `?beat=8` usable for re-shooting the climax without replaying the top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BEATS, SLATE, PLAYERS, HANDS, FOLLOWED_ID, END_CARD, TOTAL_MS } from './script';
import { assignAvatars } from '../lib/avatars';
import { pourDrinks } from './lines';
import { DRINKS_PER_SHOTGUN } from '../data/cards';
import DemoPicker from './DemoPicker';
import DemoPlayer from './DemoPlayer';
import DemoFeed from './DemoFeed';
import './demo.css';

const SPEEDS = [0.5, 1, 2];

/** Cumulative start time of each beat, so elapsed -> beat is a lookup. */
const STARTS = BEATS.reduce((acc, b) => {
  acc.push((acc[acc.length - 1] || 0) + b.ms);
  return acc;
}, []);
const beatStart = (i) => (i === 0 ? 0 : STARTS[i - 1]);

/**
 * The whole stage, derived from a single number.
 *
 * Rebuilt from beat 1 every time rather than mutated forwards, which is what
 * makes stepping BACKWARDS work without a separate undo path — there is only
 * one way state is computed, so there is only one way it can be wrong.
 */
const stageAt = (elapsed) => {
  const state = {
    screen: 'picker',
    pickedId: null,
    hovering: null,
    dealt: false,
    declared: null,
    showStandings: false,
    score: { away: 14, home: 10 },
    scoreDetail: 'Q2 8:41',
    lines: [],
    caption: null,
    caption2: null,
    totals: {},
    incoming: {},
    pouring: null,
  };
  PLAYERS.forEach((p) => { state.totals[p.name] = { drinks: 0, shotguns: 0 }; });

  let key = 0;
  for (let i = 0; i < BEATS.length; i += 1) {
    const beat = BEATS[i];
    const start = beatStart(i);
    if (elapsed < start) break;
    const into = elapsed - start;
    const done = into >= beat.ms;

    Object.assign(state, beat.set || {});
    if (beat.caption) { state.caption = beat.caption; state.caption2 = beat.caption2 || null; }

    // Beat 1's cursor lands on the followed game part-way through.
    if (beat.pickAt !== undefined) {
      state.hovering = FOLLOWED_ID;
      state.pickedId = into >= beat.pickAt ? FOLLOWED_ID : null;
    }

    for (const entry of (beat.feed || [])) {
      key += 1;
      if (into < entry.at) continue;
      state.lines.push({ ...entry, key: `l${key}` });

      if (entry.kind === 'pour') {
        const drinks = pourDrinks(entry);
        const to = state.totals[entry.to];
        if (to) {
          // Fold exactly once, the way the server does, so the demo can never
          // display a total the real game would not produce.
          const raw = to.drinks + drinks;
          to.shotguns += Math.floor(raw / DRINKS_PER_SHOTGUN);
          to.drinks = raw % DRINKS_PER_SHOTGUN;
        }
        // A brief landing flash, only while the beat is still on this line.
        if (!done && into < entry.at + 1400) {
          state.incoming[entry.to] = entry.shotguns
            ? `${entry.shotguns} SG` : `${entry.drinks}`;
          state.pouring = entry.from;
        }
      }
    }

    // First Down is global: everyone, once, no card.
    const ge = state.declared && state.declared.globalEvent;
    if (ge && into >= 900 && !state[`ge_${i}`]) {
      state[`ge_${i}`] = true;
      PLAYERS.forEach((p) => {
        const t = state.totals[p.name];
        const raw = t.drinks + 1;
        t.shotguns += Math.floor(raw / DRINKS_PER_SHOTGUN);
        t.drinks = raw % DRINKS_PER_SHOTGUN;
      });
    }
  }
  return state;
};

const clampBeat = (n) => Math.min(BEATS.length, Math.max(1, n || 1));

export default function Demo() {
  const params = useMemo(
    () => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );
  const clean = params.get('clean') === '1';
  const startBeat = params.has('beat') ? clampBeat(Number(params.get('beat'))) : 1;
  const startVertical = params.has('vertical') || params.get('aspect') === '9:16';

  const [elapsed, setElapsed] = useState(() => beatStart(startBeat - 1));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [vertical, setVertical] = useState(startVertical);
  const [captionsOn, setCaptionsOn] = useState(true);

  const raf = useRef(0);
  const last = useRef(null);

  useEffect(() => {
    if (!playing) { last.current = null; return undefined; }
    const tick = (now) => {
      if (last.current === null) last.current = now;
      const delta = now - last.current;
      last.current = now;
      setElapsed((e) => {
        const next = e + delta * speed;
        if (next >= TOTAL_MS) { setPlaying(false); return TOTAL_MS; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]);

  const stage = useMemo(() => stageAt(elapsed), [elapsed]);
  const beatIndex = useMemo(() => {
    let i = 0;
    for (let k = 0; k < BEATS.length; k += 1) if (elapsed >= beatStart(k)) i = k;
    return i;
  }, [elapsed]);

  const goToBeat = useCallback((n) => {
    const i = clampBeat(n) - 1;
    last.current = null;
    setElapsed(beatStart(i));
  }, []);

  const avatars = useMemo(() => assignAvatars(PLAYERS), []);
  const players = useMemo(
    () => PLAYERS.map((p) => {
      const a = avatars[p.name] || {};
      return { ...p, avatar: a.src, avatarRing: a.ring };
    }),
    [avatars],
  );

  const followed = SLATE.find((g) => g.id === FOLLOWED_ID);
  const atEnd = stage.screen === 'end';

  return (
    <div className={`demo${vertical ? ' vertical' : ''}${clean ? ' clean' : ''}`}>
      {/* Header: the game being followed, score and clock. */}
      {stage.screen !== 'picker' && !atEnd ? (
        <header className="dhead">
          <span className="dh-follow">Following</span>
          <span className="dh-teams">
            {followed.away.name} <span className="at">@</span> {followed.home.name}
          </span>
          <span className="dh-score">{stage.score.away}–{stage.score.home}</span>
          <span className="dh-clock">{stage.scoreDetail}</span>
        </header>
      ) : null}

      <main className="dbody">
        {stage.screen === 'picker' ? (
          <DemoPicker games={SLATE} pickedId={stage.pickedId} hovering={stage.hovering} />
        ) : null}

        {stage.screen === 'board' ? (
          <>
            {stage.declared ? (
              <div className="ddeclared" aria-live="polite">
                <span className="dd-what">
                  {stage.declared.globalEvent || stage.declared.cardId}
                </span>
                {stage.declared.holder ? (
                  <span className="dd-who">{stage.declared.holder} is holding it</span>
                ) : (
                  <span className="dd-who">Everyone drinks 1</span>
                )}
              </div>
            ) : null}

            <div className="dplayers">
              {players.map((p) => (
                <DemoPlayer
                  key={p.id}
                  player={p}
                  hand={HANDS[p.name] || { standard: [], wild: [] }}
                  declared={stage.declared}
                  totals={stage.totals[p.name]}
                  incoming={stage.incoming[p.name]}
                  pouring={stage.pouring === p.name}
                  compact={vertical}
                />
              ))}
            </div>

            {stage.showStandings ? (
              <section className="dstand" aria-label="Standings">
                <h2>Standings</h2>
                <ol>
                  {[...players]
                    .sort((a, b) => {
                      const A = stage.totals[a.name]; const B = stage.totals[b.name];
                      return (B.shotguns * DRINKS_PER_SHOTGUN + B.drinks)
                           - (A.shotguns * DRINKS_PER_SHOTGUN + A.drinks);
                    })
                    .map((p) => (
                      <li key={p.id}>
                        <span className="ds-n">{p.name}</span>
                        <span className="ds-v">
                          {stage.totals[p.name].shotguns} SG · {stage.totals[p.name].drinks} DR
                        </span>
                      </li>
                    ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : null}

        {atEnd ? (
          <section className="dend" aria-label="Play Shotgun Formation">
            <h1>{END_CARD.title}</h1>
            <p className="de-line">{END_CARD.line}</p>
            <p className="de-url">{END_CARD.url}</p>
            <p className="de-sub">{END_CARD.sub}</p>
            {!clean ? <a className="de-cta" href="/">{END_CARD.cta}</a> : null}
          </section>
        ) : null}
      </main>

      {stage.screen === 'board' ? <DemoFeed lines={stage.lines} /> : null}

      {captionsOn && stage.caption && !atEnd ? (
        <div className="dcap">
          <p>{stage.caption}</p>
          {stage.caption2 ? <p className="dcap2">{stage.caption2}</p> : null}
        </div>
      ) : null}

      {/* Clean mode hides every control. This is the recording URL. */}
      {!clean ? (
        <footer className="dctl">
          <button type="button" onClick={() => goToBeat(1)}>Restart</button>
          <button type="button" onClick={() => goToBeat(beatIndex)}>‹ Beat</button>
          <button type="button" onClick={() => { last.current = null; setPlaying((p) => !p); }}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => goToBeat(beatIndex + 2)}>Beat ›</button>

          <span className="dctl-rail" aria-label="Progress">
            {BEATS.map((b, i) => (
              <button
                type="button"
                key={b.id}
                className={`rail-b${i === beatIndex ? ' on' : ''}`}
                aria-label={`Beat ${b.n}`}
                aria-current={i === beatIndex ? 'true' : undefined}
                onClick={() => goToBeat(b.n)}
              >
                {b.n}
              </button>
            ))}
          </span>

          <span className="dctl-grp">
            {SPEEDS.map((s) => (
              <button
                type="button" key={s}
                className={speed === s ? 'on' : ''}
                onClick={() => setSpeed(s)}
              >{s}×</button>
            ))}
          </span>

          <button type="button" onClick={() => setVertical((v) => !v)}>
            {vertical ? '9:16' : '16:9'}
          </button>
          <button type="button" onClick={() => setCaptionsOn((c) => !c)}>
            {captionsOn ? 'Captions on' : 'Captions off'}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
