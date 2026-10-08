import { useState } from 'react'
import type { Track } from '@/types/track'
import { trackName } from '@/lib/format'
import { youtubeId, youtubeThumbUrl, youtubeWatchUrl } from '@/lib/youtube'

/**
 * Track art: YouTube thumbnail when the record has a video, otherwise the
 * KeyBPM mark in grayscale. Clicking a thumbnail opens the video without
 * following the surrounding row/link.
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

export function ArtTile({ track, size = 44 }: { track: Track; size?: number }) {
  const id = youtubeId(track.youtube)
  const [broken, setBroken] = useState(false)

  if (!id || broken) {
    return <PlaceholderMark size={size} />
  }

  return (
    <a
      href={youtubeWatchUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      title="Watch on YouTube"
      aria-label={`Watch ${trackName(track)} on YouTube`}
      onClick={e => e.stopPropagation()}
      className="relative z-[1] block shrink-0 overflow-hidden rounded-lg outline-none ring-offset-2 ring-offset-bg transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      style={{ width: size, height: size }}
    >
      <img
        src={youtubeThumbUrl(id)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </a>
  )
}
