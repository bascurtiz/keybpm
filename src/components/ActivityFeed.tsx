import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArtTile } from '@/components/ArtTile'
import { CamelotBadge } from '@/components/badges'
import { useActivity, recentActivity } from '@/lib/activity'
import { getTrack } from '@/lib/data'
import type { ActivityItem } from '@/lib/api'
import { formatBpm, formatRelative, shortKey, trackName } from '@/lib/format'

/**
 * Community activity: what the community added, corrected and had verified
 * lately — one merged, newest-first list.
 *
 * The imported dataset has no per-row dates, so this is the review queue's
 * `/api/activity`: every entry is a contribution that went live, labeled with
 * what it did (`added` / `edited`), who did it and when, plus the reviewer who
 * cleared it. Each entry links to the track it is about and carries the track's
 * Camelot chip on the right — the key is what a DJ scans a track list for.
 */

/**
 * Artwork for a feed row — or a placeholder of the same size when the track
 * left the catalogue. `link={false}`: the row itself is the link, and a nested
 * anchor is invalid.
 */
function ArtSlot({ track }: { track: ReturnType<typeof getTrack> }) {
  if (track) return <ArtTile track={track} size={36} link={false} />
  return <span aria-hidden className="h-9 w-9 shrink-0 rounded-lg bg-bg-hover" />
}

function ActivityRow({ item }: { item: ActivityItem }) {
  // Prefer the live record: it carries the post-overlay values, art and mode,
  // and stays correct after a correction was folded in.
  const track = item.trackId ? getTrack(item.trackId) : undefined
  const name =
    (track ? trackName(track) : [item.artist, item.title].filter(Boolean).join(' – ')) || 'Unknown track'
  const bpm = track?.bpm ?? item.bpm
  const key = track?.key ?? item.key
  const camelot = track?.camelot ?? item.camelot
  // BPM and key only — the Camelot code rides the chip on the right.
  const values = [bpm !== null ? `${formatBpm(bpm)} BPM` : null, key ? shortKey(key) : null]
    .filter(Boolean)
    .join(' · ')

  // A review is what verification means in KeyBPM, so every row here was
  // verified — only add the reviewer's name when it is not the same person.
  const by = [item.by, item.reviewer && item.reviewer !== item.by ? `✓ ${item.reviewer}` : null]
    .filter(Boolean)
    .join(' · ')

  const body = (
    <>
      <ArtSlot track={track} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs">
          {values && <span className="font-mono text-text-muted">{values}</span>}
          <span className="text-text-dim" title={item.createdAt ? `${item.createdAt} UTC` : undefined}>
            {item.kind === 'add' ? 'added' : 'edited'} {formatRelative(item.createdAt)}
            {by && <> · {by}</>}
          </span>
        </span>
      </span>
      <CamelotBadge
        code={camelot}
        approximate={!!track?.mode}
        className="shrink-0"
      />
    </>
  )

  const shell = 'flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4'
  return (
    <li>
      {track ? (
        <Link to={`/track/${track.id}`} className={`${shell} hover:bg-bg-hover`}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  )
}

export function ActivityFeed() {
  const { status, items } = useActivity()
  const rows = useMemo(() => recentActivity(items, 6), [items])

  return (
    <section>
      <h2 className="mb-3 mt-10 flex items-baseline justify-between text-lg font-semibold">
        Community activity
        <Link to="/contribute" className="text-xs font-normal text-accent hover:text-text">
          Contribute →
        </Link>
      </h2>

      <p className="mb-3 -mt-1.5 text-xs text-text-dim">
        The newest additions, corrections and reviews from the community queue.
      </p>

      {status === 'loading' && (
        <div className="surface p-4 text-xs text-text-dim">Loading recent activity…</div>
      )}

      {status === 'unavailable' && (
        <div className="surface p-4 text-xs text-text-muted">
          Recent contributions are unavailable right now — the contribution API did not answer. The rest of
          the database is unaffected.
        </div>
      )}

      {status === 'ready' && (
        <div className="surface overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-4 py-4 text-xs text-text-muted">
              Nothing contributed yet — add the first track, or fix a wrong BPM.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map(item => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
