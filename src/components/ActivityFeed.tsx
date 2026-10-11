import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArtTile } from '@/components/ArtTile'
import { CamelotBadge } from '@/components/badges'
import { useActivity, recentActivity, recentImports } from '@/lib/activity'
import { getTrack, tracks, useCatalog } from '@/lib/data'
import { primarySourceId, sourceMeta } from '@/lib/sources'
import type { ActivityItem } from '@/lib/api'
import type { Track } from '@/types/track'
import { formatBpm, formatRelative, shortKey, trackName } from '@/lib/format'

/**
 * Community activity: what the community added, corrected and had verified
 * lately — one merged, newest-first list, one row per track.
 *
 * Two kinds of entry share the list. A queue row is a contribution that went
 * live, labeled with what it did (`added` / `edited`), who did it and when,
 * plus the reviewer who cleared it. An import row is a track a CSV pipeline
 * brought in (duuzu's sheet, a consensus-engine export): those never went
 * through the queue, so listing them is the only thing that stops thousands of
 * new tracks from appearing with no event attached. Both link to their track
 * and carry its Camelot chip on the right, because the key is what a DJ scans
 * a track list for.
 */

/** A feed entry: one queue row or one imported track. */
type FeedRow =
  | { kind: 'queue'; when: string; item: ActivityItem }
  | { kind: 'import'; when: string; track: Track }

/** Entries shown before the feed stops being scannable, and per "Show more". */
const FEED_LIMIT = 8
const FEED_STEP = 24

/**
 * One imported track, in the same shape as a queue row: what it is, its BPM and
 * key, when its snapshot landed, and which source it came from instead of who
 * submitted it — provenance is the only "by" an import has.
 */
function ImportRow({ track }: { track: Track }) {
  const values = [
    track.bpm !== null ? `${formatBpm(track.bpm)} BPM` : null,
    track.key ? shortKey(track.key) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  // `sourceMeta` also handles the unmapped case (the consensus engine itself),
  // turning the raw string into a readable name.
  const sourceLabel = sourceMeta(primarySourceId(track.source) ?? track.source).name

  return (
    <li>
      <Link to={`/track/${track.id}`} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bg-hover sm:px-4">
        <ArtSlot track={track} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{trackName(track)}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs">
            {values && <span className="font-mono text-text-muted">{values}</span>}
            <span className="text-text-dim" title={track.source}>
              imported {formatRelative(track.lastVerified)} · {sourceLabel}
            </span>
          </span>
        </span>
        <CamelotBadge code={track.camelot} approximate={!!track.mode} className="shrink-0" />
      </Link>
    </li>
  )
}

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
  const version = useCatalog()
  const [limit, setLimit] = useState(FEED_LIMIT)

  // Newest first across both kinds. An imported track sorts at its snapshot
  // date's start — the only time signal a row carries — so a fresh import sits
  // above anything older and below contributions made the same day.
  const rows = useMemo<FeedRow[]>(() => {
    const queue: FeedRow[] = recentActivity(items, limit).map(item => ({
      kind: 'queue',
      when: item.createdAt ?? '',
      item,
    }))
    const imports: FeedRow[] = recentImports(tracks, limit).map(track => ({
      kind: 'import',
      when: `${track.lastVerified}T00:00:00Z`,
      track,
    }))
    return [...queue, ...imports]
      .sort((a, b) => b.when.localeCompare(a.when))
      .slice(0, limit)
  }, [items, version, limit])

  // An import can be thousands of tracks deep, so the list grows on demand
  // instead of burying the rest of the homepage.
  const hasMore = useMemo(
    () =>
      recentActivity(items, limit + 1).length + recentImports(tracks, limit + 1).length > limit,
    [items, version, limit],
  )

  return (
    <section>
      <h2 className="mb-3 mt-10 flex items-baseline justify-between text-lg font-semibold">
        Community activity
        <Link to="/contribute" className="text-xs font-normal text-accent hover:text-text">
          Contribute →
        </Link>
      </h2>

      <p className="mb-3 -mt-1.5 text-xs text-text-dim">
        The newest tracks from the community queue and from the bulk imports that grow the database.
      </p>

      {status === 'loading' && (
        <div className="surface p-4 text-xs text-text-dim">Loading recent activity…</div>
      )}

      {status !== 'loading' && (
        <div className="surface overflow-hidden">
          {status === 'unavailable' && (
            <p className="border-b border-line px-4 py-3 text-xs text-text-muted">
              The contribution queue did not answer — only dataset imports are listed below. The rest of
              the database is unaffected.
            </p>
          )}
          {rows.length > 0 ? (
            <ul className="divide-y divide-line">
              {rows.map(row =>
                row.kind === 'import' ? (
                  <ImportRow key={row.track.id} track={row.track} />
                ) : (
                  <ActivityRow key={row.item.id} item={row.item} />
                ),
              )}
            </ul>
          ) : status === 'ready' ? (
            <p className="px-4 py-4 text-xs text-text-muted">
              Nothing contributed yet — add the first track, or fix a wrong BPM.
            </p>
          ) : null}
          {rows.length > 0 && hasMore && (
            <div className="border-t border-line px-3 py-2 sm:px-4">
              <button
                type="button"
                onClick={() => setLimit(l => l + FEED_STEP)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Show {FEED_STEP} more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
