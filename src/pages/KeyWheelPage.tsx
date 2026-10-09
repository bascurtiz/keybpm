import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { KeyWheel } from '@/components/KeyWheel'
import { TrackTable, compareTracks } from '@/components/TrackTable'
import type { SortKey, SortDir } from '@/components/TrackTable'
import { EmptyState } from '@/components/EmptyState'
import { tracks, useCatalog } from '@/lib/data'
import { getCompatibleKeys, camelotColor, camelotToOpenKey } from '@/lib/camelot'
import { CamelotBadge } from '@/components/badges'
import { CAMELOT_TO_KEY } from '@/types/track'
import { formatCount } from '@/lib/format'
import { readWheelMode, type WheelMode } from '@/lib/wheelMode'

/**
 * /key and /key/:camelot — the Camelot wheel plus the selected key's tracks.
 * /camelot/:camelot redirects here via App routes.
 */
export function KeyWheelPage() {
  const { camelot } = useParams()
  const navigate = useNavigate()
  const [sort, setSort] = useState<SortKey>('bpm')
  const [dir, setDir] = useState<SortDir>('asc')
  const [wheelMode, setWheelMode] = useState<WheelMode>(readWheelMode)
  // Re-derive key tracks when the catalog changes (approved-queue overlay).
  const catalogVersion = useCatalog()

  const selected = camelot && CAMELOT_TO_KEY[camelot] ? camelot.toUpperCase() : null
  const keyName = selected ? CAMELOT_TO_KEY[selected] : null
  const selectedLabel =
    selected && wheelMode === 'openkey' ? (camelotToOpenKey(selected) ?? selected) : selected

  useEffect(() => {
    document.title = selected
      ? `${selectedLabel} ${keyName} — Key Wheel — KeyBPM`
      : 'Key Wheel — KeyBPM'
  }, [selected, selectedLabel, keyName])

  const keyTracks = useMemo(() => {
    if (!selected) return []
    const rows = tracks.filter(t => t.camelot === selected)
    rows.sort((a, b) => compareTracks(a, b, sort, dir))
    return rows
  }, [selected, sort, dir, catalogVersion])

  // Count tracks per compatible key, for the sidebar chips.
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tracks) if (t.camelot) map.set(t.camelot, (map.get(t.camelot) ?? 0) + 1)
    return map
  }, [catalogVersion])

  function onSort(key: SortKey) {
    if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir('asc') }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Key Wheel</h1>
        <p className="text-xs text-text-muted">
          Camelot, musical, or Open Key notation. Click a position for tracks and neighbours.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[440px_minmax(0,1fr)]">
        <div>
          <KeyWheel
            selected={selected}
            onSelect={code => navigate(`/key/${code}`)}
            mode={wheelMode}
            onModeChange={setWheelMode}
          />
        </div>

        <div className="space-y-5">
          {selected && keyName ? (
            <>
              <div className="surface p-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-3xl font-bold" style={{ color: camelotColor(selected) }}>
                    {selectedLabel}
                  </span>
                  <span className="text-xl">{keyName}</span>
                </div>
                <p className="mt-1 font-mono text-xs text-text-dim">
                  {counts.get(selected) ?? 0} tracks in this key
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to={`/browse?camelot=${selected}`} className="btn-primary px-3 py-1.5 text-xs">
                    Open in Browse
                  </Link>
                  <Link to={`/mix/${selected}`} className="btn-ghost px-3 py-1.5 text-xs">
                    Find mixes from {selectedLabel}
                  </Link>
                </div>

                <div className="mt-4 border-t border-line/60 pt-3">
                  <div className="mb-2 text-xs font-medium text-text-muted">Compatible</div>
                  <div className="flex flex-wrap gap-1.5">
                    {getCompatibleKeys(selected).map(code => {
                      const isSelf = code === selected
                      const inner = (
                        <>
                          <CamelotBadge code={code} notation={wheelMode} />
                          <span className="text-xs text-text">{CAMELOT_TO_KEY[code]}</span>
                        </>
                      )
                      const chip = 'inline-flex items-center gap-2 rounded-lg border bg-bg py-1 pl-1 pr-3'
                      return isSelf ? (
                        <span
                          key={code}
                          className={chip}
                          style={{ borderColor: camelotColor(code) }}
                          title={`${code} · ${CAMELOT_TO_KEY[code]} (this key)`}
                        >
                          {inner}
                        </span>
                      ) : (
                        <Link
                          key={code}
                          to={`/key/${code}`}
                          className={`${chip} border-line transition-colors hover:border-line-hover hover:bg-bg-hover`}
                          title={`${code} · ${CAMELOT_TO_KEY[code]} — ${formatCount(counts.get(code) ?? 0)} tracks`}
                        >
                          {inner}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold">Tracks in {selectedLabel}</h2>
                  <span className="font-mono text-xs tabular-nums text-text-dim">{keyTracks.length}</span>
                </div>
                <TrackTable
                  tracks={keyTracks}
                  sort={sort}
                  dir={dir}
                  onSort={onSort}
                  caption={`Tracks in ${selectedLabel}`}
                  keyNotation={wheelMode}
                />
              </div>
            </>
          ) : (
            <EmptyState
              title={camelot ? 'Unknown key' : 'Select a key'}
              hint={
                camelot
                  ? <><code className="font-mono">{camelot}</code> is not a valid Camelot code (1A–12B).</>
                  : 'Pick any position on the wheel to explore its tracks and harmonic neighbours.'
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
