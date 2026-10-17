/**
 * Primary nav, in one place so the desktop bar, the site's mobile drawer and the DJ
 * console's own hamburger never drift apart.
 */
export interface NavItem {
  to: string
  label: string
  /** Only rendered for moderators/trusted users. */
  reviewOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/browse', label: 'Browse' },
  { to: '/contribute', label: 'Contribute' },
  { to: '/mix', label: 'Mix Finder' },
  { to: '/key', label: 'Key Wheel' },
  { to: '/tool', label: 'Key Tool' },
  { to: '/mix-it', label: 'Mix it!' },
  { to: '/review', label: 'Review', reviewOnly: true },
  { to: '/about', label: 'About' },
]
