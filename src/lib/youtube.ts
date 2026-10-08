/** Parse a YouTube watch URL / youtu.be / embed / shorts / bare id into an 11-char video id. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'])

export function youtubeId(input: string | null | undefined): string | null {
  if (!input) return null
  const s = input.trim()
  if (VIDEO_ID.test(s)) return s
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && VIDEO_ID.test(id) ? id : null
    }
    if (YT_HOSTS.has(host)) {
      const v = u.searchParams.get('v')
      if (v && VIDEO_ID.test(v)) return v
      const [kind, maybeId] = u.pathname.split('/').filter(Boolean)
      if ((kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') && maybeId && VIDEO_ID.test(maybeId)) {
        return maybeId
      }
    }
  } catch {
    /* not a URL */
  }
  return null
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

/** 320×180 — sharp at table/detail tile sizes, cheap to load. */
export function youtubeThumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

/** Canonical watch URL, or null if `input` isn't a YouTube video. */
export function canonicalYoutube(input: string | null | undefined): string | null {
  const id = youtubeId(input)
  return id ? youtubeWatchUrl(id) : null
}
