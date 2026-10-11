import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArtTile } from '@/components/ArtTile'
import { CamelotBadge } from '@/components/badges'
import { useActivity, recentActivity, importBatches, type ImportBatch } from '@/lib/activity'
import { getTrack, tracks, useCatalog } from '@/lib/data'
import { sourceMeta } from '@/lib/sources'
import type { ActivityItem } from '@/lib/api'
import { formatBpm, formatCount, formatRelative, shortKey, trackName } from '@/lib/format'

/**
 * Community activity: what the community added, corrected and had verified
 * lately — one merged, newest-first list.
 *
 * Two kinds of entry share the list. A queue row is a contribution that went
 * live, labeled with what it did (`added` / `edited`), who did it and when,
 * plus the reviewer who cleared it; it links to the track it is about and
 * carries the track's Camelot chip on the right, because the key is what a DJ
 * scans a track list for. A batch row is a dataset import (duuzu's sheet, a
 * consensus-engine export): those rows never went through the queue, so
 * showing them here is the only thing that stops thousands of new tracks from
 * appearing out of nowhere.
 */

/** A feed entry: one queue row or one imported batch. */
type FeedRow =
  | { kind: 'queue'; when: string; item: ActivityItem }
  | { kind: 'import'; when: string; batch: ImportBatch }

/** How many entries the feed shows before it stops being scannable. */
const FEED_LIMIT = 8

/**
 * One imported batch. The chip is the source's, so a duuzu import shows the
 * same green `DZ` the table uses, and an unmapped source gets a generic chip.
 */
function ImportRow({ batch }: { batch: ImportBatch }) {
  const meta = sourceMeta(batch.sourceId)
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-bold leading-none"
        style={{ backgroundColor: `${meta.color}26`, borderColor: meta.color }}
      >
        {meta.code}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{formatCount(batch.count)} tracks imported</span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-mono text-text-muted" title={batch.source}>
            {batch.name}
          </span>
          <span className="text-text-dim">imported {formatRelative(batch.date)}</span>
        </span>
      </span>
      {/* Keeps the right edge aligned with the Camelot chips of the rows above. */}
      <span aria-hidden className="min-w-[3.25rem] shrink-0" />
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

  // Newest first across both kinds. A batch is stamped at the end of its
  // snapshot day: a fresh import is a big event, and it would be buried by
  // same-day queue rows if it sorted at midnight.
  const rows = useMemo<FeedRow[]>(() => {
    const queue: FeedRow[] = recentActivity(items, FEED_LIMIT).map(item => ({
      kind: 'queue',
      when: item.createdAt ?? '',
      item,
    }))
    const imports: FeedRow[] = importBatches(tracks, 3).map(batch => ({
      kind: 'import',
      when: `${batch.date}T23:59:59Z`,
      batch,
    }))
    return [...queue, ...imports]
      .sort((a, b) => b.when.localeCompare(a.when))
      .slice(0, FEED_LIMIT)
  }, [items, version])

  return (
    <section>
      <h2 className="mb-3 mt-10 flex items-baseline justify-between text-lg font-semibold">
        Community activity
        <Link to="/contribute" className="text-xs font-normal text-accent hover:text-text">
          Contribute →
        </Link>
      </h2>

      <p className="mb-3 -mt-1.5 text-xs text-text-dim">
        The newest additions, corrections and reviews from the community queue, plus the bulk imports
        that grow the database.
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
                  <ImportRow key={row.batch.id} batch={row.batch} />
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
        </div>
      )}
    </section>
  )
}
