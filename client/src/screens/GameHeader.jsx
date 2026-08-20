/** The game header: logo, quarter, room code, menu. Shared by lobby and game. */
import { CAN } from '../components/CanMark';

export default function GameHeader({ quarter, roomCode, onMenu }) {
  return (
    <header className="hdr">
      <div className="logo">
        <img src={CAN} alt="" />
        <span className="wordmark">
          <span className="l1">Shotgun</span>
          <span className="l2">Formation</span>
        </span>
      </div>
      <div className="hdr-mid">
        {quarter ? (
          <div className="qtr"><span className="n">Q{quarter}</span><span className="k">QTR</span></div>
        ) : null}
        {roomCode ? (
          <div className="room"><span className="k">ROOM</span><span className="n">{roomCode}</span></div>
        ) : null}
      </div>
      {onMenu ? (
        <button type="button" className="iconbtn" aria-label="Menu" onClick={onMenu}><span /></button>
      ) : <span />}
    </header>
  );
}
