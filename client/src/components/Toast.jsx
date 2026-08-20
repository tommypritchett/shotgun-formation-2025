/** Transient confirmation, e.g. "Time! 3 pours locked in automatically". */
export default function Toast({ message }) {
  return (
    <div id="toast" role="status" className={message ? 'on' : ''}>
      {message}
    </div>
  );
}
