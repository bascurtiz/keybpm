/** Parse a SoundCloud track URL (`soundcloud.com/user/track`, `on.soundcloud.com/…`,
 * `m.soundcloud.com/…`) into its canonical `https://soundcloud.com/user/track` form.
 * Playlists/sets and bare profiles are not tracks. */
const SC_HOSTS = new Set(['soundcloud.com', 'm.soundcloud.com', 'api.soundcloud.com', 'on.soundcloud.com'])

export function canonicalSoundcloud(input: string | null | undefined): string | null {
  if (!input) return null
  const s = input.trim()
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\./, '')
    if (!SC_HOSTS.has(host)) return null
    // on.soundcloud.com/<code> is a share short-link; it is its own canonical form.
    if (host === 'on.soundcloud.com') {
      const code = u.pathname.split('/').filter(Boolean)[0]
      return code ? `https://on.soundcloud.com/${code}` : null
    }
    const segs = u.pathname.split('/').filter(Boolean)
    // Track permalinks are exactly /user/track-slug; sets/albums/profiles are not.
    if (segs.length !== 2 || segs[0] === 'sets' || segs[1] === 'sets') return null
    return `https://soundcloud.com/${segs[0]}/${segs[1]}`
  } catch {
    /* not a URL */
  }
  return null
}

/**
 * Rewrite a SoundCloud CDN artwork URL to a smaller rendition.
 * oEmbed returns `…-t500x500.jpg`; the CDN also serves t250x250 / t120x120 /
 * t67x67 under the same artwork id. URLs that don't match are returned as-is.
 */
export function soundcloudThumbUrl(
  thumbnailUrl: string,
  variant: 't67x67' | 't120x120' | 't250x250' | 't500x500' = 't250x250',
): string {
  return thumbnailUrl
    .replace(/-t\d+x\d+(\.\w+)$/, `-${variant}$1`)
    .replace(/_large(\.\w+)$/, `-${variant}$1`)
}

import { apiUrl } from '@/lib/api'

/** Artwork thumbnail per track URL, memoized in-session and persisted in
 * localStorage (bounded) so each SoundCloud track is looked up once per
 * browser. Failures are not persisted — they retry next session. */
const inflight = new Map<string, Promise<string | null>>()
const LS_KEY = 'keybpm:sc-art'
const MAX_ENTRIES = 500

type ArtStore = Record<string, string>

let store: ArtStore | null = null

function artStore(): ArtStore {
  if (store) return store
  const next: ArtStore = {}
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') next[k] = v
      }
    }
  } catch {
    /* corrupt/absent — start fresh */
  }
  store = next
  return next
}

function persist(): void {
  try {
    const entries = Object.entries(store ?? {})
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* quota/private mode — in-memory cache still works */
  }
}

/** Resolve the artwork image URL for a SoundCloud track, or null when
 * unavailable.
 *
 * 1. KeyBPM API — the Worker reads the track page's og:image server-side.
 *    Needed because SoundCloud's oEmbed endpoint returns 403 for many
 *    networks/VPNs and track pages have no CORS headers.
 * 2. Direct oEmbed fallback, for static-only deployments without the API.
 */
async function resolveArtwork(trackUrl: string): Promise<string | null> {
  try {
    const res = await fetch(apiUrl(`/api/artwork?url=${encodeURIComponent(trackUrl)}`), {
      credentials: 'omit',
    })
    if (res.ok) {
      const data = (await res.json()) as { artwork?: unknown }
      if (typeof data.artwork === 'string' && data.artwork.startsWith('https://')) return data.artwork
    }
  } catch {
    /* API unreachable — fall back to oEmbed */
  }

  try {
    const res = await fetch(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(trackUrl)}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as { thumbnail_url?: unknown }
    return typeof data.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://')
      ? data.thumbnail_url
      : null
  } catch {
    return null
  }
}

export function fetchSoundcloudArtwork(trackUrl: string): Promise<string | null> {
  const memo = inflight.get(trackUrl)
  if (memo) return memo

  const p = (async () => {
    const cached = artStore()[trackUrl]
    if (cached) return cached
    const thumb = await resolveArtwork(trackUrl)
    if (thumb) {
      artStore()[trackUrl] = thumb
      persist()
    }
    return thumb
  })()

  inflight.set(trackUrl, p)
  return p
}
