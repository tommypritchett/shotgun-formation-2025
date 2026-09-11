/**
 * The age gate.
 *
 * The most damaging mistake available in this session is putting it in the
 * wrong place: /how-to-play is a public marketing page reached cold from
 * social by people who have never joined a room and may never join one. A
 * date-of-birth wall in front of it destroys the only thing it is for.
 *
 * "Before the join screen" and "before the app" read identically in prose and
 * are not the same thing. Most of this file is about that distinction.
 *
 * Not a compliance claim. A good-faith gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AgeGate from '../../client/src/components/AgeGate.jsx';
import {
  checkAge, ageOn, toDate, hasPassed, remember, MIN_AGE,
} from '../../client/src/lib/age-gate.js';
import { isDemoRoute } from '../../client/src/demo/index.js';

afterEach(cleanup);

const store = ({ broken = false } = {}) => {
  const map = new Map();
  return {
    getItem: (k) => { if (broken) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (broken) throw new Error('denied'); map.set(k, v); },
  };
};

describe('twenty-one, counted properly', () => {
  const today = new Date(2026, 8, 11);   // 11 Sep 2026

  it('lets through someone who is exactly 21 today', () => {
    expect(checkAge(2005, 9, 11, today)).toBe('ok');
  });

  it('blocks someone whose 21st is tomorrow', () => {
    expect(checkAge(2005, 9, 12, today)).toBe('under');
  });

  it('uses 21, not 18', () => {
    expect(MIN_AGE).toBe(21);
    expect(checkAge(2008, 1, 1, today)).toBe('under');   // 18
  });

  it('handles a 29 February birthday', () => {
    expect(ageOn(new Date(2004, 1, 29), new Date(2026, 1, 28))).toBe(21);
    expect(checkAge(2004, 2, 29, today)).toBe('ok');
  });

  it('rejects dates that are not real', () => {
    expect(toDate(2005, 2, 31), '31 February was accepted').toBeNull();
    expect(checkAge(2005, 13, 1, today)).toBe('invalid');
    expect(checkAge('', '', '', today)).toBe('invalid');
    expect(checkAge('abc', 'x', 'y', today)).toBe('invalid');
  });

  it('rejects a date in the future', () => {
    expect(checkAge(2030, 1, 1, today)).toBe('invalid');
  });
});

describe('nothing is stored but a boolean', () => {
  it('remembers only a flag', () => {
    const s = store();
    expect(hasPassed(s)).toBe(false);
    remember(s);
    expect(hasPassed(s)).toBe(true);
  });

  it('never puts a date of birth anywhere', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const root = path.resolve(here, '..', '..');
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

    // No socket payload, no server field, no persisted date.
    const server = strip(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));
    expect(/dateOfBirth|dob\b|birthDate/i.test(server),
      'the server knows about a date of birth').toBe(false);

    const gate = strip(fs.readFileSync(
      path.join(root, 'client/src/lib/age-gate.js'), 'utf8'));
    expect(/socket|emit|fetch/i.test(gate),
      'the age module talks to the network').toBe(false);
    // The stored value is a flag, not a date.
    expect(gate).toMatch(/setItem\([^,]+,\s*'true'\)/);
  });

  it('FAILS CLOSED when storage is unavailable', () => {
    // The one item in this session that does. Being asked twice is a small
    // cost; not being asked at all is not.
    expect(hasPassed(store({ broken: true }))).toBe(false);
    expect(hasPassed(null)).toBe(false);
    expect(() => remember(store({ broken: true }))).not.toThrow();
  });
});

describe('the screen', () => {
  it('asks for a date, not a yes/no button', () => {
    render(<AgeGate />);
    expect(screen.getByLabelText(/month/i)).toBeTruthy();
    expect(screen.getByLabelText(/day/i)).toBeTruthy();
    expect(screen.getByLabelText(/year/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /yes|i am 21|over 21/i }),
      'a one-tap confirm defeats the point').toBeNull();
  });

  it('passes a valid over-21 date through', () => {
    const onPass = vi.fn();
    render(<AgeGate onPass={onPass} />);
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '1990' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onPass).toHaveBeenCalled();
  });

  it('blocks under 21 with no retry loop', () => {
    const onPass = vi.fn();
    render(<AgeGate onPass={onPass} />);
    const yr = String(new Date().getFullYear() - 15);
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: yr } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onPass).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/year/i),
      'the form re-offered itself, which teaches people to try another year')
      .toBeNull();
    expect(screen.getByText(/need to be 21/i)).toBeTruthy();
  });

  it('says a bad date is a bad date, without blocking them', () => {
    const onPass = vi.fn();
    render(<AgeGate onPass={onPass} />);
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: '13' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '1990' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onPass).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/year/i), 'a typo was treated as under-age').toBeTruthy();
  });
});

describe('WHERE it does and does not appear', () => {
  const appSource = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    return {
      app: fs.readFileSync(path.resolve(here, '..', '..', 'client/src/App.js'), 'utf8'),
      index: fs.readFileSync(path.resolve(here, '..', '..', 'client/src/index.js'), 'utf8'),
    };
  };

  it('/how-to-play is exempt BY CONSTRUCTION — it never mounts App', () => {
    // index.js picks by pathname, regardless of query string, so no variant of
    // the demo route can reach the gate.
    const { index } = appSource();
    expect(index).toMatch(/isDemoRoute\(window\.location\.pathname\)/);
    for (const p of ['/how-to-play', '/how-to-play/', '/How-To-Play']) {
      expect(isDemoRoute(p), `${p} would have mounted the app`).toBe(true);
    }
  });

  it('the gate lives in App, not around it', () => {
    // Around <App/> in index.js would gate the LANDING PAGE too.
    const { app, index } = appSource();
    expect(index, 'the gate was placed around <App/>, which walls off the front door')
      .not.toMatch(/AgeGate/);
    expect(app).toMatch(/<AgeGate/);
  });

  it('is scoped to the join screen, so it cannot fire mid-game', () => {
    // A gate firing on a reconnect at 11pm loses that player permanently.
    const { app } = appSource();
    expect(app).toMatch(/gameState === 'initial' && !ageOk/);
  });

  it('fires on a ?room= arrival, which IS an act to enter a room', () => {
    const { app } = appSource();
    expect(app).toMatch(/arrivedOnRoomLink/);
    expect(app).toMatch(/roomCodeFromSearch\(/);
  });
});
