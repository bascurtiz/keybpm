import { useEffect, useState } from 'react'
import type { Track } from '@/types/track'
import { trackName } from '@/lib/format'
import { youtubeId, youtubeThumbUrl, youtubeWatchUrl } from '@/lib/youtube'
import { fetchSoundcloudArtwork, soundcloudThumbUrl } from '@/lib/soundcloud'

/**
 * Track art: YouTube thumbnail when the record has a video, otherwise the
 * SoundCloud artwork for a SoundCloud-only record (resolved once per track
 * via oEmbed, then cached), otherwise the KeyBPM mark in grayscale.
 * Clicking a thumbnail opens the source page without following the
 * surrounding row/link.
 */
function PlaceholderMark({ size }: { size: number }) {
  const mark = Math.round(size * 0.62)
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-hover"
      style={{ width: size, height: size }}
    >
      <img
        src={`${import.meta.env.BASE_URL}favicon.svg?v=2`}
        alt=""
        width={mark}
        height={mark}
        className="object-contain opacity-40 grayscale"
        decoding="async"
      />
    </span>
  )
}

/** Small tiles need only the tiny CDN rendition; larger tiles get t500x500. */
function artVariantFor(size: number): 't120x120' | 't500x500' {
  return size <= 48 ? 't120x120' : 't500x500'
}

export function ArtTile({ track, size = 44 }: { track: Track; size?: number }) {
  const id = youtubeId(track.youtube)
  const [broken, setBroken] = useState(false)
  const [scArt, setScArt] = useState<string | null>(null)

  // SoundCloud-only record: resolve artwork once per track URL (cached).
  const sc = track.soundcloud
  useEffect(() => {
    if (id || !sc) return
    let alive = true
    void fetchSoundcloudArtwork(sc).then(url => {
      if (alive) setScArt(url)
    })
    return () => {
      alive = false
    }
  }, [id, sc])

  if (broken) return <PlaceholderMark size={size} />
  if (!id && !scArt) return <PlaceholderMark size={size} />

  const href = id ? youtubeWatchUrl(id) : sc!
  const src = id
    ? youtubeThumbUrl(id)
    : soundcloudThumbUrl(scArt!, artVariantFor(size))
  const label = id
    ? `Watch ${trackName(track)} on YouTube`
    : `Open ${trackName(track)} on SoundCloud`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={id ? 'Watch on YouTube' : 'Open on SoundCloud'}
      aria-label={label}
      onClick={e => e.stopPropagation()}
      className="relative z-[1] block shrink-0 overflow-hidden rounded-lg outline-none ring-offset-2 ring-offset-bg transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </a>
  )
}
