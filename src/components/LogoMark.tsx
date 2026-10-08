/**
 * KeyBPM mark in the top bar — loads public/favicon.svg so updating that
 * file updates the header (the old equalizer bars were inlined here).
 */
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}favicon.svg?v=2`}
      alt=""
      width={28}
      height={28}
      className={className}
      aria-hidden
      decoding="async"
    />
  )
}
