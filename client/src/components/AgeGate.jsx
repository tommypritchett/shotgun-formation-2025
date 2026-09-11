import { useState } from 'react';
import { checkAge, MIN_AGE } from '../lib/age-gate';

/**
 * "How old are you?" — asked once per device, before entering a room.
 *
 * Asks for a DATE, not a yes/no. A button is one thoughtless tap; typing a
 * date is a deliberate act, and that is the entire difference between the two.
 * It converts worse. That is the point.
 *
 * The date never leaves this component. `checkAge` returns 'ok' | 'under' |
 * 'invalid' and the numbers are dropped on the floor — nothing is sent to the
 * server, logged, or stored except a boolean.
 *
 * Under age gets a plain, non-punitive screen with NO retry. A form that
 * re-offers itself teaches people to enter a different year, which makes the
 * gate theatre.
 */
export default function AgeGate({ onPass = () => {} }) {
  const [y, setY] = useState('');
  const [m, setM] = useState('');
  const [d, setD] = useState('');
  const [state, setState] = useState('asking');   // asking | under
  const [error, setError] = useState('');

  if (state === 'under') {
    return (
      <div className="app agegate">
        <div className="pad">
          <h1 className="ag-h">Sorry — you need to be {MIN_AGE}.</h1>
          <p className="ag-p">
            Shotgun Formation is a drinking game, so we can&apos;t let you in.
            Thanks for stopping by.
          </p>
        </div>
      </div>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    const result = checkAge(y, m, d);
    if (result === 'invalid') { setError('That is not a date we recognise.'); return; }
    if (result === 'under') { setState('under'); return; }
    onPass();
  };

  return (
    <div className="app agegate">
      <form className="pad" onSubmit={submit}>
        <h1 className="ag-h">How old are you?</h1>
        <p className="ag-p">
          Shotgun Formation is a drinking game. You need to be {MIN_AGE} or over to play.
        </p>

        <fieldset className="ag-dob">
          <legend className="k">Date of birth</legend>
          <label>
            <span className="k">Month</span>
            <input inputMode="numeric" maxLength={2} value={m} placeholder="MM"
              onChange={(e) => { setM(e.target.value.replace(/\D/g, '')); setError(''); }} />
          </label>
          <label>
            <span className="k">Day</span>
            <input inputMode="numeric" maxLength={2} value={d} placeholder="DD"
              onChange={(e) => { setD(e.target.value.replace(/\D/g, '')); setError(''); }} />
          </label>
          <label>
            <span className="k">Year</span>
            <input inputMode="numeric" maxLength={4} value={y} placeholder="YYYY"
              onChange={(e) => { setY(e.target.value.replace(/\D/g, '')); setError(''); }} />
          </label>
        </fieldset>

        <button type="submit" className="btn">Continue</button>
        {error ? <p className="err">{error}</p> : null}
        <p className="ag-fine">
          We work out your age and forget the date. It is never sent anywhere.
        </p>
      </form>
    </div>
  );
}
