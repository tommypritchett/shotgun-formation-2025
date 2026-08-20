/**
 * One pour target in the assigner grid.
 *
 * The tile is the whole hit area — 120px minimum, because this is tapped fast,
 * in a loud room, by someone who is not looking carefully.
 */
import { CAN } from './Avatars';


export default function PlayerTile({
  player, given, unit, isShotgun, animation, onGive,
}) {
  const classes = ['ptile', animation].filter(Boolean).join(' ');
  // Raw totals, exactly as the standings show them. The server has already
  // done the conversion; doing it again here invents shotguns that were never
  // drunk. See cards.js `shotgunsFor`.
  const sg = player.totalShotguns || 0;
  const dr = player.totalDrinks || 0;

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
