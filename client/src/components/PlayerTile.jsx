/**
 * One pour target in the assigner grid.
 *
 * The tile is the whole hit area — 120px minimum, because this is tapped fast,
 * in a loud room, by someone who is not looking carefully.
 */
import { CAN } from './Avatars';
import { DRINKS_PER_SHOTGUN, shotgunsFor } from '../data/cards';

export default function PlayerTile({
  player, given, unit, isShotgun, animation, onGive,
}) {
  const classes = ['ptile', animation].filter(Boolean).join(' ');
  const total = player.totalDrinks || 0;
  const sg = (player.totalShotguns || 0) + shotgunsFor(total);
  const dr = total % DRINKS_PER_SHOTGUN;

  return (
    <button
      type="button"
      className={classes}
      data-p={player.id}
      data-given={given}
      onClick={() => onGive(player.id)}
      aria-label={
        given > 0
          ? `Give one ${unit} to ${player.name}. ${given} ${unit}${given === 1 ? '' : 's'} given.`
          : `Give one ${unit} to ${player.name}`
      }
    >
      <span className="tally" aria-hidden="true">
        {isShotgun ? <img src={CAN} alt="" /> : null}
        {given}
      </span>
      <span className="fx" aria-hidden="true">+1</span>
      <img className="pav" src={player.avatar} alt="" />
      <span className="pnm">{player.name}</span>
      <span className="ptot">{sg} SG · {dr} DR</span>
    </button>
  );
}
