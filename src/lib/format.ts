/** Display formatting helpers — keep BPM/key presentation consistent everywhere. */

/** "F# minor" -> "F#m", "B major" -> "B". Used in dense table cells. */
export function shortKey(key: string): string {
  const m = key.match(/^([A-G][#b]?)\s+(minor|major)$/i)
  if (!m) return key
  return m[2].toLowerCase() === 'minor' ? `${m[1]}m` : m[1]
}

const MODE_ABBR: Record<string, string> = {
  dorian: 'dor', phrygian: 'phr', 'phrygian dominant': 'phr dom', lydian: 'lyd',
  mixolydian: 'mix', 'harmonic minor': 'harm', 'picardy third': 'pic', locrian: 'loc', blues: 'blues',
}

/** "dorian" -> "dor" for dense table cells. */
export function modeAbbr(mode: string): string {
  return MODE_ABBR[mode] ?? mode
}

/** "Artist – Title", tolerating entries that have no separate title. */
export function trackName(t: { artist: string; title: string }): string {
  return t.title ? `${t.artist} – ${t.title}` : t.artist
}

/** BPM as displayed: integers without decimals, halves keep ".5". */
export function formatBpm(bpm: number | null): string {
  if (bpm === null) return '—'
  return Number.isInteger(bpm) ? String(bpm) : String(Math.round(bpm * 100) / 100)
}

/** Seconds -> "5:42". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "2026-10-06" -> "06 Oct 2026"; safe for malformed input. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${m[3]} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`
}

/**
 * Timestamps come from two places: SQLite `datetime('now')` ("2026-10-10 18:02:53",
 * always UTC) and plain `YYYY-MM-DD` dates. Parse both as UTC.
 */
function parseUtc(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

/**
 * "3 minutes ago" style recency for the activity feed: minutes, then hours,
 * then days, and the plain date once it is older than a week ("10 Oct 2026").
 * Dates show a day, not a moment, so they never read as seconds-old.
 */
export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const ts = parseUtc(iso)
  if (ts === null) return iso
  const minutes = Math.floor((now - ts) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return formatDate(iso.slice(0, 10))
}

/** 0.98 -> "98%". */
export function formatConfidence(c: number | null): string {
  if (c === null) return '—'
  return `${Math.round(c * 100)}%`
}

/** +2 / -1 / 0 delta formatting for mix results. */
export function formatDelta(d: number | null): string {
  if (d === null) return '—'
  if (d === 0) return '0'
  return `${d > 0 ? '+' : ''}${d}`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}
