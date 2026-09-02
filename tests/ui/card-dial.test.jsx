/**
 * The per-card dial, and suggestions that need an answer.
 *
 * The dial is reached for on a phone, mid-game, while nine people wait — so the
 * thing under test is not "can every card be set" but "can the owner find the
 * card that is making the night too loud". It is grouped by how often a card
 * fires, and every card carries its real per-game frequency from ten games.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CardDial from '../../client/src/components/CardDial.jsx';
import SuggestionPrompt from '../../client/src/components/SuggestionPrompt.jsx';
import { GROUPS, REF_ONLY, frequencyLabel } from '../../client/src/lib/card-groups.js';

afterEach(cleanup);

describe('what the dial shows', () => {
  it('leads with the cards that make the volume', () => {
    // "This is too much, what do I turn down?" is the question, so the loud
    // cards come first rather than being sorted alphabetically among 24.
    expect(GROUPS[0].cards).toContain('First Down');
    expect(GROUPS[0].cards).toContain('Big Play 20+');
  });

  it('tells you how often each card actually fires', () => {
    expect(frequencyLabel('First Down')).toMatch(/about 30 a game/);
    expect(frequencyLabel('Safety')).toBe('rare');
  });

  it('names the Ref-only cards instead of hiding them', () => {
    render(<CardDial />);
    const note = screen.getByText(/No feed can see them/);
    for (const card of REF_ONLY) expect(note.textContent).toContain(card);
  });

  it('offers auto, suggest and off for a card, and reports the choice', () => {
    const onMode = vi.fn();
    render(<CardDial modes={{ 'First Down': 'auto' }} onMode={onMode} />);

    const row = screen.getByText('First Down').closest('.dialrow');
    const suggest = [...row.querySelectorAll('.dc-modes button')]
      .find((b) => b.textContent === 'suggest');
    fireEvent.click(suggest);
    expect(onMode).toHaveBeenCalledWith('First Down', 'suggest');
  });

  it('shows which mode a card is currently in', () => {
    render(<CardDial modes={{ 'First Down': 'off' }} />);
    const row = screen.getByText('First Down').closest('.dialrow');
    const on = [...row.querySelectorAll('.dc-modes button')].find((b) => b.className === 'on');
    expect(on.textContent).toBe('off');
  });

  it('puts the pause control at the top, where it is wanted', () => {
    // When this is wanted it is wanted immediately, in front of people.
    const { container } = render(<CardDial />);
    const first = container.querySelector('.sheet-head + button');
    expect(first.className).toContain('pausebtn');
  });

  it('says plainly what pausing does', () => {
    const onPause = vi.fn();
    const { rerender } = render(<CardDial paused={false} onPause={onPause} />);
    fireEvent.click(screen.getByText('Pause auto-calling'));
    expect(onPause).toHaveBeenCalledWith(true);

    rerender(<CardDial paused onPause={onPause} />);
    expect(screen.getByText(/still call anything by hand/)).toBeTruthy();
  });
});

describe('a suggestion is a question', () => {
  const offer = { cardId: '3 n Out', reason: '3 offensive plays, punt', playId: 'p1' };

  it('shows the card, the reason and how long is left', () => {
    render(<SuggestionPrompt suggestion={offer} secondsLeft={12} onAccept={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText('3 n Out')).toBeTruthy();
    expect(screen.getByText('3 offensive plays, punt')).toBeTruthy();
    expect(screen.getByText('12s')).toBeTruthy();
  });

  it('declares when accepted', () => {
    const onAccept = vi.fn();
    render(<SuggestionPrompt suggestion={offer} secondsLeft={9} onAccept={onAccept} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Call it'));
    expect(onAccept).toHaveBeenCalledWith(offer);
  });

  it('can be ignored', () => {
    const onDismiss = vi.fn();
    render(<SuggestionPrompt suggestion={offer} secondsLeft={9} onAccept={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Ignore'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders nothing once it has expired', () => {
    // An expired suggestion must not linger looking live.
    const { container } = render(<SuggestionPrompt suggestion={null} secondsLeft={0} />);
    expect(container.innerHTML).toBe('');
  });
});
