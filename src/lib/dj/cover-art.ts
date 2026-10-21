import { useEffect, useState } from 'react'
import { tracks, useCatalog } from '@/lib/data'
import { youtubeId, youtubeThumbUrl } from '@/lib/youtube'

/**
 * Deck artwork resolved from the record itself.
 *
 * A deck only knows the artwork it was handed when it was loaded: the file's
 * embedded picture, or the thumbnail of the link it came in through. A local
 * file with no cover tag therefore draws the `A`/`B` placeholder even when the
 * catalogue knows exactly which recording it is and has a video for it.
 *
 * So: when a loaded track arrives without art, look it up in the catalogue by
 * artist and title and use that row's YouTube thumbnail — the same image the
 * track pages, the table and the load modal already show for that record. This
 * is a lookup over data already in memory; nothing is fetched.
 *
 * Only rows with a video can answer: the thumbnail is the only image the
 * catalogue itself holds (SoundCloud artwork is resolved per track elsewhere,
 * on the pages that show SoundCloud-only records).
 */

/** Case/accent/punctuation-insensitive form used to compare the two names. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** First word of an artist name, for the looser pass. */
function artistToken(value: string): string {
  return normalize(value).split(' ')[0] ?? ''
}

interface ArtCandidate {
  artist: string
  title: string
  art: string
}

let artIndex: { artistTitle: Map<string, string>; byTitle: Map<string, ArtCandidate[]> } | null = null
let indexedRows = -1

/**
 * Built once over the in-memory catalogue (~25k rows, most with a video).
 * Rebuilt only when the catalogue's size changes, which is enough: a newly
 * contributed record has no artwork worth waiting a rebuild for.
 */
function ensureIndex() {
  if (artIndex && indexedRows === tracks.length) return artIndex

  const artistTitle = new Map<string, string>()
  const byTitle = new Map<string, ArtCandidate[]>()

  for (const row of tracks) {
    const id = youtubeId(row.youtube)
    if (!id) continue
    const art = youtubeThumbUrl(id)
    const artist = normalize(row.artist)
    const title = normalize(row.title)
    if (!artist || !title) continue

    const exact = `${artist}\u0000${title}`
    if (!artistTitle.has(exact)) artistTitle.set(exact, art)

    const candidate = { artist, title, art }
    const bucket = byTitle.get(title)
    if (bucket) bucket.push(candidate)
    else byTitle.set(title, [candidate])
  }

  artIndex = { artistTitle, byTitle }
  indexedRows = tracks.length
  return artIndex
}

/**
 * Artwork for an artist + title, or null when the catalogue cannot identify it.
 *
 * Exact artist and title first. Failing that, an exact title whose one catalogue
 * artist starts with the same word — this covers the usual drift between a file's
 * tags and the catalogue row ("Fred again.." against "Fred Again", a trailing
 * ".." or a `feat.` suffix). Then the same with the mix suffix dropped: a file
 * tagged "Push The Feeling On (MK Dub Revisited)" is still that record in the
 * catalogue, which keeps the plain title.
 *
 * Ambiguity resolves to nothing rather than to a possibly-wrong sleeve: two
 * catalogue records with the same title and artist word give no answer.
 */
export function catalogArt(artist: string, title: string): string | null {
  if (!artist || !title) return null
  const { artistTitle, byTitle } = ensureIndex()

  const exact = artistTitle.get(`${normalize(artist)}\u0000${normalize(title)}`)
  if (exact) return exact

  const token = artistToken(artist)
  if (!token) return null

  /** The rows with this title that belong to this artist, if there is only one. */
  const sole = (candidates: ArtCandidate[] | undefined) => {
    if (!candidates) return null
    const matches = candidates.filter(c => artistToken(c.artist) === token)
    return matches.length === 1 ? matches[0].art : null
  }

  const sameTitle = sole(byTitle.get(normalize(title)))
  if (sameTitle) return sameTitle

  // Drop the trailing mix suffix, e.g. "(MK Dub Revisited)" / "[Extended Mix]".
  const base = normalize(title.replace(/[([].*?[)\]]/g, ' '))
  if (!base || base === normalize(title)) return null
  const rows = byTitle.get(base)
  if (!rows) return null
  const plain = rows.filter(r => artistToken(r.artist) === token && r.title === base)
  return plain.length === 1 ? plain[0].art : null
}

/**
 * Artwork to draw for a deck track: what it was loaded with, else its link's
 * thumbnail, else the catalogue's image for the same artist and title.
 *
 * `videoId` is the deck's YouTube bridge video, for decks playing a link
 * directly. The catalogue lookup runs in an effect so the first paint is not
 * held behind it — it resolves to null on that first pass, and the placeholder
 * shows for a frame at most.
 */
export function useCoverArt(
  track: { artist: string; title: string; coverUrl?: string } | null | undefined,
  videoId?: string | null,
): string | null {
  // Re-render when the catalogue refreshes, so a later lookup sees new rows.
  useCatalog()

  const direct = track?.coverUrl ?? (videoId ? youtubeThumbUrl(videoId) : null) ?? null
  const artist = track?.artist
  const title = track?.title
  const [resolved, setResolved] = useState<string | null>(null)

  useEffect(() => {
    if (direct || !artist || !title) {
      setResolved(null)
      return
    }
    setResolved(catalogArt(artist, title))
  }, [direct, artist, title])

  return direct ?? resolved
}
