/**
 * When the score board should fall back to Standings.
 *
 * Round Results is a bulletin, not a home screen: the board flips there when a
 * round lands, because that is the moment everyone looks down. It is the wrong
 * thing to be staring at while waiting for the next call.
 */

/** Idle time before Round Results gives way to Standings. */
export const BOARD_IDLE_REVERT_MS = 20_000;

/**
 * @param {object} s
 * @param {'stand'|'last'} s.boardTab   which tab is showing
 * @param {boolean} s.boardPinned       the player opened a tab themselves
 * @param {string|null} s.declaredCard  a card is on the table
 * @param {number} s.timeRemaining      seconds left in the round
 */
export const shouldRevertToStandings = ({
  boardTab, boardPinned, declaredCard, timeRemaining,
} = {}) => {
  if (boardTab !== 'last') return false;      // already home
  if (boardPinned) return false;              // they opened it on purpose
  if (declaredCard) return false;             // a round is live
  if ((timeRemaining || 0) > 0) return false; // ...or still running down
  return true;
};
