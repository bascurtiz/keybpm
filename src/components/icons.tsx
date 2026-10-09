/**
 * Small inline stroke icons for action buttons. They inherit `currentColor`
 * and sit inside `.btn`, which already lays children out with `inline-flex
 * gap-2` — so an icon is just the first child of the button.
 *
 * Inline SVGs (no icon dependency) match ThemeToggle and the header marks.
 */
type IconProps = {
  /** Rendered square size in px. */
  size?: number
  className?: string
}

function svgProps({ size = 14, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }
}

/** Magnifier — search / find. */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

/** Two stacked sheets — copy to clipboard. */
export function CopyIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** Play badge — YouTube. */
export function YoutubeIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <path d="m10 9 5 3-5 3z" />
    </svg>
  )
}

/** Pencil — suggest an edit. */
export function PencilIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
