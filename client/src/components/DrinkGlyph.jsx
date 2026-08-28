/**
 * The drink unit mark: a solid filled cup, never an outline (docs/DESIGN.md §2.5).
 * A shotgun is never drawn with this — a shotgun is the can (see Avatars.CAN).
 */
export default function DrinkGlyph({ className = 'dg', ...rest }) {
  return (
    <svg className={className} viewBox="0 0 14 18" aria-hidden="true" {...rest}>
      <path
        fill="currentColor"
        d="M1.7 1.5h10.6a.6.6 0 0 1 .6.66l-1.1 12.5a2.7 2.7 0 0 1-2.7 2.44H5.9a2.7 2.7 0 0 1-2.7-2.44L2.1 2.16a.6.6 0 0 1 .6-.66z"
      />
    </svg>
  );
}
