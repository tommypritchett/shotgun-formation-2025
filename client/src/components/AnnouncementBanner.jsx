/**
 * A dismissible line on the join screen. Never over the game.
 *
 * Text only, always. `text` is rendered as a text node and `link` is validated
 * to http(s) before it becomes an href, because this content comes from server
 * config — the one place in the app where a string arrives from outside and is
 * shown to everybody.
 */
export default function AnnouncementBanner({ announcement, onDismiss = () => {} }) {
  if (!announcement) return null;
  const { text, link } = announcement;

  return (
    <aside className="annbar" role="status">
      <p className="annbar-t">{text}</p>
      {link ? (
        <a className="annbar-a" href={link} rel="noopener noreferrer" target="_blank">
          Find out more
        </a>
      ) : null}
      <button type="button" className="annbar-x" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </aside>
  );
}
