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
import SuggestionModal from '../../client/src/components/SuggestionModal.jsx';
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

  it('falls back to the shipped tiering, not to "off"', () => {
    // With no per-room override the dial must show what the card ACTUALLY does.
    // Drawing everything as "off" is worse than wrong: it invites the Ref to
    // switch on something that is already on.
    render(<CardDial modes={{}} defaults={{ 'First Down': 'auto', '3 n Out': 'suggest' }} />);
    for (const [cardId, mode] of [['First Down', 'auto'], ['3 n Out', 'suggest']]) {
      const row = screen.getByText(cardId).closest('.dialrow');
      const on = [...row.querySelectorAll('.dc-modes button')].find((b) => b.className === 'on');
      expect(on?.textContent, `${cardId} should show as ${mode}`).toBe(mode);
    }
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
  /**
   * Session 20 replaced the countdown strip with a modal that does not expire.
   *
   * These tests changed with it, because the behaviour they pinned is the
   * behaviour that was wrong: an offer that ran out on its own made "the Ref
   * ignored it" and "the Ref never saw it" the same event. The rule they were
   * really protecting — a suggestion must be answerable and must not linger
   * once answered — is still here, now expressed against two real buttons.
   */
  const offer = { cardId: '3 n Out', reason: '3 offensive plays, punt', playId: 'p1' };

  it('shows the card and the reason', () => {
    render(<SuggestionModal suggestion={offer} onCall={() => {}} onSkip={() => {}} />);
    expect(screen.getByText('3 n Out')).toBeTruthy();
    expect(screen.getByText('3 offensive plays, punt')).toBeTruthy();
  });

  it('shows no countdown at all', () => {
    const { container } = render(<SuggestionModal suggestion={offer} />);
    expect(container.textContent, 'the modal still counts down').not.toMatch(/\d+\s*s\b/);
  });

  it('declares when called', () => {
    const onCall = vi.fn();
    render(<SuggestionModal suggestion={offer} onCall={onCall} onSkip={() => {}} />);
    fireEvent.click(screen.getByText('Call it'));
    expect(onCall).toHaveBeenCalledWith(offer);
  });

  it('is skipped by an explicit answer, not by inaction', () => {
    const onSkip = vi.fn();
    render(<SuggestionModal suggestion={offer} onCall={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('Skip'));
    expect(onSkip).toHaveBeenCalledWith(offer);
  });

  it('interrupts, like the announcement modal does', () => {
    render(<SuggestionModal suggestion={offer} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('cannot be dismissed by tapping the scrim', () => {
    // The scrim dims. It is not a way out — same rule as Announcement.
    const onSkip = vi.fn();
    const { container } = render(<SuggestionModal suggestion={offer} onSkip={onSkip} />);
    const scrim = container.querySelector('.scrim');
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim);
    expect(onSkip, 'tapping the scrim answered the question').not.toHaveBeenCalled();
  });

  it('says how many more are waiting behind it', () => {
    render(<SuggestionModal suggestion={offer} queued={2} />);
    expect(screen.getByText(/2 more waiting/)).toBeTruthy();
  });

  it('stays quiet about the queue when it is the only one', () => {
    render(<SuggestionModal suggestion={offer} queued={0} />);
    expect(screen.queryByText(/more waiting/)).toBeNull();
  });

  it('renders nothing when there is nothing to ask', () => {
    const { container } = render(<SuggestionModal suggestion={null} />);
    expect(container.innerHTML).toBe('');
  });
});
