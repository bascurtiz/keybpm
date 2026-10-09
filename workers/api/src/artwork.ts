/**
 * SoundCloud artwork resolution, server-side.
 *
 * The browser cannot do this reliably: SoundCloud's oEmbed endpoint returns
 * 403 for many networks/VPNs, and track pages are served without
 * `Access-Control-Allow-Origin`, so a client fetch cannot read the og:image
 * meta tag. The Worker has neither restriction.
 */

const SC_HOSTS = new Set(['soundcloud.com', 'm.soundcloud.com', 'api.soundcloud.com', 'on.soundcloud.com'])

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

/** Canonical `https://soundcloud.com/user/track` (or `on.soundcloud.com/<code>`
 * share link). Mirrors the client's canonicalSoundcloud rules; null when the
 * input is not a SoundCloud *track* URL. */
export function canonicalSoundcloud(input: string): string | null {
  if (!input) return null
  let u: URL
  try {
    u = new URL(input.trim().includes('://') ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, '')
  if (!SC_HOSTS.has(host)) return null
  if (host === 'on.soundcloud.com') {
    const code = u.pathname.split('/').filter(Boolean)[0]
    return code ? `https://on.soundcloud.com/${code}` : null
  }
  const segs = u.pathname.split('/').filter(Boolean)
  if (segs.length !== 2 || segs[0] === 'sets' || segs[1] === 'sets') return null
  return `https://soundcloud.com/${segs[0]}/${segs[1]}`
}

/** Fetch the track page and pull its og:image (the CDN artwork, t500x500).
 * Returns null on any failure — never throws. */
export async function fetchSoundcloudArtwork(trackUrl: string): Promise<string | null> {
  try {
    const res = await fetch(trackUrl, {
      headers: {
        'User-Agent': UA,
        // SoundCloud serves HTML or JS depending on Accept; either contains og:image.
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    const match =
      html.match(/property="og:image"\s+content="([^"]+)"/) ??
      html.match(/content="([^"]+)"\s+property="og:image"/)
    const img = match?.[1]
    return img && img.startsWith('https://') ? img : null
  } catch {
    return null
  }
}
