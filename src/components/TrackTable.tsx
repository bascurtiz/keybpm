import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Track } from '@/types/track'
import { BpmBadge, CamelotBadge, KeyBadge, SourceBadges } from '@/components/badges'
import { ArtTile } from '@/components/ArtTile'
import { allGenres, allLabels, allYears, stats } from '@/lib/data'
import { trackSources } from '@/lib/sources'
import { useMediaQuery } from '@/lib/useMediaQuery'
import type { WheelMode } from '@/lib/wheelMode'

export type SortKey = 'artist' | 'title' | 'bpm' | 'key' | 'camelot' | 'genre' | 'label' | 'year'
export type SortDir = 'asc' | 'desc'

/** `sources` is rendered but not sortable — it is a provenance column, not a facet. */
type ColumnKey = SortKey | 'sources'

interface Column {
  key: ColumnKey
  label: string
  width: string
  align?: 'right'
}

const COLUMNS: Column[] = [
  { key: 'artist', label: 'Artist', width: '22%' },
  { key: 'title', label: 'Title', width: '28%' },
  { key: 'bpm', label: 'BPM', width: '80px', align: 'right' },
  { key: 'key', label: 'Key', width: '104px', align: 'right' },
  { key: 'camelot', label: 'Cam', width: '72px', align: 'right' },
  { key: 'sources', label: 'Sources', width: '156px' },
  { key: 'genre', label: 'Genre', width: '12%' },
  { key: 'label', label: 'Label', width: '12%' },
  { key: 'year', label: 'Year', width: '60px', align: 'right' },
]

function columnsForNotation(notation: WheelMode): Column[] {
  return COLUMNS.map(c =>
    c.key === 'camelot' && notation === 'openkey' ? { ...c, label: 'Open' } : c,
  )
}

const ROW_H = 44
const MOBILE_ROW_H = 78

/** Columns that the dataset actually fills — an all-dash column is noise. */
function visibleColumns(notation: WheelMode = 'camelot'): Column[] {
  return columnsForNotation(notation).filter(c =>
    (c.key !== 'genre' || allGenres.length > 0) &&
    (c.key !== 'label' || allLabels.length > 0) &&
    (c.key !== 'year' || allYears.length > 0) &&
    (c.key !== 'sources' || stats.withSources > 0),
  )
}

/** Document-relative top of `el`, kept current as content above it changes height. */
function useScrollMargin(ref: React.RefObject<HTMLElement>): number {
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setMargin(el.getBoundingClientRect().top + window.scrollY)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [ref])
  return margin
}

/**
 * Dense, professional track table (desktop) with a compact list on mobile.
 * Window-virtualized: only the rows in view are in the DOM, so 20k tracks scroll like 20.
 */
export function TrackTable({
  tracks,
  sort,
  dir,
  onSort,
  caption,
  keyNotation = 'camelot',
}: {
  tracks: Track[]
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  caption?: string
  /** When `openkey`, Cam column becomes Open and shows 1m/1d labels. */
  keyNotation?: WheelMode
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  return isDesktop ? (
    <DesktopTable
      tracks={tracks}
      sort={sort}
      dir={dir}
      onSort={onSort}
      caption={caption}
      keyNotation={keyNotation}
    />
  ) : (
    <MobileList tracks={tracks} keyNotation={keyNotation} />
  )
}

function DesktopTable({
  tracks,
  sort,
  dir,
  onSort,
  caption,
  keyNotation,
}: {
  tracks: Track[]
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  caption?: string
  keyNotation: WheelMode
}) {
  const navigate = useNavigate()
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const scrollMargin = useScrollMargin(bodyRef)
  const columns = visibleColumns(keyNotation)

  const virtualizer = useWindowVirtualizer({
    count: tracks.length,
    estimateSize: () => ROW_H,
    overscan: 12,
    scrollMargin,
  })
  const items = virtualizer.getVirtualItems()
  const padTop = items.length ? items[0].start - scrollMargin : 0
  const padBottom = items.length ? virtualizer.getTotalSize() - (items[items.length - 1].end - scrollMargin) : 0

  const ariaSort = (key: ColumnKey): 'ascending' | 'descending' | 'none' =>
    sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <div className="surface overflow-clip">
      <table className="w-full table-fixed border-collapse text-sm" aria-rowcount={tracks.length + 1}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>
          {columns.map(c => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <thead className="sticky top-[var(--header-h,0px)] z-10">
          <tr className="border-b border-line bg-bg-subtle" aria-rowindex={1}>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                aria-sort={col.key === 'sources' ? 'none' : ariaSort(col.key)}
                className={`px-3 py-2 text-xs font-medium text-text-muted ${col.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {col.key === 'sources' ? (
                  <span>{col.label}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSort(col.key as SortKey)}
                    className="inline-flex items-center gap-1 transition-colors hover:text-text"
                  >
                    {col.label}
                    <span aria-hidden className={sort === col.key ? 'text-accent' : 'text-transparent'}>
                      {dir === 'asc' ? '▲' : '▼'}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {padTop > 0 && <tr aria-hidden style={{ height: padTop }}><td colSpan={columns.length} /></tr>}
          {items.map(item => {
            const t = tracks[item.index]
            return (
              <tr
                key={t.id}
                aria-rowindex={item.index + 2}
                onClick={() => navigate(`/track/${t.id}`)}
                style={{ height: ROW_H }}
                className="cursor-pointer border-b border-line/60 transition-colors hover:bg-bg-hover"
              >
                {columns.map(col => <Cell key={col.key} col={col} t={t} keyNotation={keyNotation} />)}
              </tr>
            )
          })}
          {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}><td colSpan={columns.length} /></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ col, t, keyNotation }: { col: Column; t: Track; keyNotation: WheelMode }) {
  switch (col.key) {
    case 'artist':
      return (
        <td className="px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-2.5">
            <ArtTile track={t} size={28} />
            <span className="truncate font-medium" title={t.artist}>{t.artist}</span>
          </span>
        </td>
      )
    case 'title':
      return (
        <td className="truncate px-3 py-1.5" title={t.title}>
          <Link
            to={`/track/${t.id}`}
            onClick={e => e.stopPropagation()}
            className="text-text-muted transition-colors hover:text-accent-hover"
          >
            {t.title || '—'}
          </Link>
        </td>
      )
    case 'bpm':
      return <td className="px-3 py-1.5 text-right"><BpmBadge bpm={t.bpm} raw={t.bpmRaw} className="text-text-muted" /></td>
    case 'key':
      return <td className="truncate px-3 py-1.5 text-right"><KeyBadge keyName={t.key} mode={t.mode} short className="font-medium text-text" /></td>
    case 'camelot':
      return (
        <td className="px-3 py-1.5 text-right">
          <CamelotBadge code={t.camelot} approximate={!!t.mode} notation={keyNotation} />
        </td>
      )
    case 'sources':
      return (
        <td className="px-3 py-1.5">
          <SourceBadges sources={trackSources(t)} track={t} max={4} />
        </td>
      )
    case 'genre':
      return <td className="truncate px-3 py-1.5 text-text-muted">{t.genre ?? '—'}</td>
    case 'label':
      return <td className="truncate px-3 py-1.5 text-text-muted">{t.label ?? '—'}</td>
    case 'year':
      return <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-muted">{t.year ?? '—'}</td>
  }
}

function MobileList({ tracks, keyNotation }: { tracks: Track[]; keyNotation: WheelMode }) {
  const listRef = useRef<HTMLUListElement>(null)
  const scrollMargin = useScrollMargin(listRef)
  const virtualizer = useWindowVirtualizer({
    count: tracks.length,
    estimateSize: () => MOBILE_ROW_H,
    overscan: 8,
    scrollMargin,
  })

  return (
    <ul
      ref={listRef}
      className="surface relative overflow-clip"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map(item => {
        const t = tracks[item.index]
        const sources = trackSources(t)
        return (
          <li
            key={t.id}
            className="absolute inset-x-0 border-b border-line"
            style={{ height: MOBILE_ROW_H, transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <div className="flex h-full items-center gap-3 px-4 transition-colors hover:bg-bg-hover">
              <ArtTile track={t} />
              <Link to={`/track/${t.id}`} className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{t.artist}</span>
                  <BpmBadge bpm={t.bpm} raw={t.bpmRaw} className="shrink-0 text-text-muted" />
                </div>
                <div className="truncate text-sm text-text-muted">{t.title || '—'}</div>
                <div className="mt-1 flex items-center gap-x-2 overflow-hidden whitespace-nowrap text-xs text-text-dim">
                  <KeyBadge keyName={t.key} mode={t.mode} short className="font-medium text-text" />
                  <CamelotBadge code={t.camelot} approximate={!!t.mode} notation={keyNotation} />
                  {t.year && <span>· {t.year}</span>}
                  {t.label && <span className="truncate">· {t.label}</span>}
                  {sources.length > 0 && (
                    <SourceBadges sources={sources} track={t} max={4} className="ml-auto shrink-0" />
                  )}
                </div>
              </Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Sort comparator used by Browse and Mix Finder. Nulls/empties sort last, always. */
export function compareTracks(a: Track, b: Track, key: SortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  if (key === 'camelot') {
    const av = a.camelot
    const bv = b.camelot
    if (!av || !bv) return av === bv ? 0 : av ? -1 : 1
    const d = parseInt(av, 10) - parseInt(bv, 10) || av.localeCompare(bv)
    return d * mul
  }
  const av = a[key]
  const bv = b[key]
  const aEmpty = av === null || av === ''
  const bEmpty = bv === null || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
  return collator.compare(String(av), String(bv)) * mul
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
