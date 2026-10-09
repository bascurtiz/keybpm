import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { tracks, allGenres, allLabels, getTrack } from '@/lib/data'
import { findMixes, DEFAULT_MIX_OPTIONS } from '@/lib/mix'
import type { MixOptions } from '@/lib/mix'
import { BpmBadge, CamelotBadge, KeyBadge } from '@/components/badges'
import { ArtTile } from '@/components/ArtTile'
import { EmptyState } from '@/components/EmptyState'
import { formatCount, formatDelta } from '@/lib/format'
import { CAMELOT_TO_KEY } from '@/types/track'
import { readWheelMode, writeWheelMode } from '@/lib/wheelMode'

const TOLERANCES = [1, 2, 4, 6]

/** Mix Finder only toggles Camelot ↔ Open Key (musical labels stay in the Key column). */
type MixNotation = 'camelot' | 'openkey'

function readMixNotation(): MixNotation {
  return readWheelMode() === 'openkey' ? 'openkey' : 'camelot'
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-line bg-bg-subtle accent-accent"
      />
      {label}
    </label>
  )
}

/**
 * /mix — Mix Finder.
 * Source track is selected via ?track=<id> (from a track detail page or the picker).
 * Controls mirror AGENTS.md §12; results show understandable reasons, not a black-box score.
 */
export function MixFinder() {
  const [params, setParams] = useSearchParams()
  const { camelot: urlCamelot, bpm: urlBpmRaw } = useParams()
  const sourceTrack = getTrack(params.get('track') ?? undefined)

  const [opts, setOpts] = useState<MixOptions>(DEFAULT_MIX_OPTIONS)
  const [picker, setPicker] = useState('')
  const [notation, setNotation] = useState<MixNotation>(readMixNotation)

  useEffect(() => {
    document.title = 'Mix Finder — KeyBPM'
  }, [])

  function setKeyNotation(next: MixNotation) {
    setNotation(next)
    writeWheelMode(next)
  }

  // Deep link support: /mix/11A/128 → source becomes a synthetic key/BPM origin.
  const camelotPreset = urlCamelot && /^\d{1,2}[AB]$/i.test(urlCamelot) ? urlCamelot.toUpperCase() : null
  const urlBpm = urlBpmRaw && !Number.isNaN(Number(urlBpmRaw)) ? Number(urlBpmRaw) : null

  const source = sourceTrack
    ? sourceTrack
    : camelotPreset
      ? {
          id: '__origin__',
          artist: '—',
          title: 'Preset origin',
          bpm: urlBpm,
          key: CAMELOT_TO_KEY[camelotPreset] ?? '',
          camelot: camelotPreset,
          genre: null,
          label: null,
          release: null,
          year: null,
          duration: null,
          source: 'url',
          confidence: null,
          lastVerified: null,
        }
      : null

  const results = useMemo(() => {
    if (!source) return []
    return findMixes(source, tracks, opts)
  }, [source, opts])

  // Track picker: cheap substring match over the static dataset.
  const matches = useMemo(() => {
    const words = picker.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const out = []
    for (const t of tracks) {
      const hay = `${t.artist} ${t.title}`.toLowerCase()
      if (words.every(w => hay.includes(w))) out.push(t)
      if (out.length === 8) break
    }
    return out
  }, [picker])

  const set = (patch: Partial<MixOptions>) => setOpts(o => ({ ...o, ...patch }))

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Mix Finder</h1>
        <p className="text-xs text-text-muted">Deterministic compatibility: key rules + BPM proximity{allGenres.length || allLabels.length ? ' + genre/label' : ''}.</p>
      </div>

      {/* minmax(0,1fr): long track titles are `truncate` (nowrap), so an `auto`
          column would be inflated by their min-content width. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[320px_1fr]">
        {/* ---- Controls ---- */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Source */}
          <div className="surface p-4">
            <h2 className="mb-3 text-base font-semibold">Current track</h2>

            {source ? (
              <div>
                <div className="flex items-center gap-3">
                  <ArtTile track={source} size={48} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-dim">{source.artist}</div>
                    <div className="truncate text-lg font-semibold leading-tight">{source.title}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xl font-semibold tabular-nums">
                    {source.bpm !== null ? source.bpm : '—'}
                    <span className="ml-1 text-xs font-normal text-text-muted">BPM</span>
                  </span>
                  <span className="text-base"><KeyBadge keyName={source.key} mode={'mode' in source ? source.mode : undefined} short /></span>
                  <CamelotBadge
                    code={source.camelot}
                    approximate={'mode' in source && !!source.mode}
                    notation={notation}
                  />
                </div>
                {sourceTrack && (
                  <div className="mt-3 flex gap-2">
                    <Link to={`/track/${sourceTrack.id}`} className="btn-ghost px-3 py-1.5 text-xs">View track</Link>
                    <button
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => {
                        const p = new URLSearchParams(params)
                        p.delete('track')
                        setParams(p)
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <input
                  type="search"
                  value={picker}
                  onChange={e => setPicker(e.target.value)}
                  placeholder="Search a track to mix from…"
                  aria-label="Select source track"
                  className="input w-full"
                />
                {picker.trim() && (
                  <ul className="mt-2 max-h-64 overflow-y-auto">
                    {matches.length === 0 && (
                      <li className="px-2 py-3 text-sm text-text-muted">No matches.</li>
                    )}
                    {matches.map(t => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const p = new URLSearchParams()
                            p.set('track', t.id)
                            setParams(p)
                            setPicker('')
                          }}
                          className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-bg-hover"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{t.artist}</span>
                            <span className="block truncate text-xs text-text-muted">{t.title}</span>
                          </span>
                          <span className="shrink-0 font-mono text-xs text-text-dim">
                            {t.bpm ?? '—'} · {t.camelot ?? '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!picker.trim() && (
                  <p className="mt-3 text-xs text-text-muted">
                    …or pick a track from its detail page via <span className="font-mono text-text">Find Mixes</span>.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="surface space-y-4 p-4">
            <div>
              <div className="mb-2 text-xs font-medium text-text-muted">BPM tolerance</div>
              <div className="flex gap-1.5">
                {TOLERANCES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set({ bpmTolerance: t })}
                    aria-pressed={opts.bpmTolerance === t}
                    className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-xs transition-colors ${
                      opts.bpmTolerance === t
                        ? 'border-accent bg-accent/15 text-accent-hover'
                        : 'border-line text-text-muted hover:border-line-hover hover:text-text'
                    }`}
                  >
                    ±{t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-text-muted">Notation</div>
              <div
                className="flex gap-1 rounded-lg border border-line bg-bg p-1"
                role="group"
                aria-label="Key notation"
              >
                <button
                  type="button"
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    notation === 'camelot' ? 'bg-bg-hover text-text' : 'text-text-muted hover:text-text'
                  }`}
                  aria-pressed={notation === 'camelot'}
                  onClick={() => setKeyNotation('camelot')}
                >
                  Camelot
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    notation === 'openkey' ? 'bg-bg-hover text-text' : 'text-text-muted hover:text-text'
                  }`}
                  aria-pressed={notation === 'openkey'}
                  onClick={() => setKeyNotation('openkey')}
                >
                  Open Key
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-text-muted">Key compatibility</div>
              <div className="space-y-2">
                <Checkbox label="Same key" checked={opts.sameKey} onChange={v => set({ sameKey: v })} />
                <Checkbox
                  label={notation === 'openkey' ? 'Adjacent Open Key (±1)' : 'Adjacent Camelot (±1)'}
                  checked={opts.adjacentKey}
                  onChange={v => set({ adjacentKey: v })}
                />
                <Checkbox label="Relative major/minor" checked={opts.relativeKey} onChange={v => set({ relativeKey: v })} />
              </div>
            </div>

            {allGenres.length > 0 && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">Genre</span>
                <select value={opts.genre ?? ''} onChange={e => set({ genre: e.target.value || null })} className="input w-full">
                  <option value="">Any</option>
                  {allGenres.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
            )}

            {allLabels.length > 0 && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">Label</span>
                <select value={opts.label ?? ''} onChange={e => set({ label: e.target.value || null })} className="input w-full">
                  <option value="">Any</option>
                  {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>

        {/* ---- Results ---- */}
        <section>
          {!source ? (
            <EmptyState
              title="No source track"
              hint="Search for a track above, or open one's detail page and press Find Mixes."
              action={<Link to="/browse" className="btn-ghost">Browse tracks</Link>}
            />
          ) : !source.camelot ? (
            <EmptyState
              title="No single key"
              hint="This track doesn't sit in one key, so there are no harmonic matches to suggest. Pick another source track."
            />
          ) : results.length === 0 ? (
            <EmptyState
              title="No matches"
              hint={<>Nothing within ±{opts.bpmTolerance} BPM matching the enabled key rules. Try widening the tolerance or enabling more key relations.</>}
            />
          ) : (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-xs text-text-muted">
                  <span className="font-mono text-text">{formatCount(results.length)}</span> compatible tracks
                </p>
                <p className="text-xs text-text-dim">
                  {results.length > 100 ? 'Top 100 · ' : ''}Sorted by explainable fit score
                </p>
              </div>

              {/* Desktop table */}
              <div className="surface hidden overflow-hidden md:block">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Tracks compatible with the current source track</caption>
                  <thead>
                    <tr className="border-b border-line bg-bg-subtle text-xs font-medium text-text-muted">
                      <th scope="col" className="px-3 py-2 text-left">Track</th>
                      <th scope="col" className="px-3 py-2 text-right">BPM</th>
                      <th scope="col" className="px-3 py-2 text-right">Key</th>
                      <th scope="col" className="px-3 py-2 text-right">
                        {notation === 'openkey' ? 'Open' : 'Cam'}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">Δ BPM</th>
                      <th scope="col" className="px-3 py-2 text-left">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.slice(0, 100).map(m => (
                      <tr
                        key={m.track.id}
                        onClick={() => {
                          const p = new URLSearchParams()
                          p.set('track', m.track.id)
                          setParams(p)
                        }}
                        className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-bg-hover"
                        title="Use as new source track"
                      >
                        <td className="max-w-[240px] px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <ArtTile track={m.track} size={28} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{m.track.artist}</span>
                              <span className="block truncate text-xs text-text-muted">{m.track.title}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right"><BpmBadge bpm={m.track.bpm} raw={m.track.bpmRaw} className="text-text-muted" /></td>
                        <td className="px-3 py-2 text-right"><KeyBadge keyName={m.track.key} mode={m.track.mode} short className="font-medium text-text" /></td>
                        <td className="px-3 py-2 text-right">
                          <CamelotBadge code={m.track.camelot} approximate={!!m.track.mode} notation={notation} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          <span className={m.deltaBpm !== null && Math.abs(m.deltaBpm) <= 1 ? 'text-ok' : 'text-text-muted'}>
                            {formatDelta(m.deltaBpm)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            {m.reasons.map(r => (
                              <span key={r} className="tag py-0.5 text-[11px]">{r}</span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <ul className="surface divide-y divide-line overflow-hidden md:hidden">
                {results.slice(0, 100).map(m => (
                  <li key={m.track.id}>
                    {/* Art tile sits outside the button: an anchor nested in a
                        button is invalid, and the tile links out to YouTube. */}
                    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-hover">
                      <ArtTile track={m.track} />
                      <button
                        type="button"
                        onClick={() => {
                          const p = new URLSearchParams()
                          p.set('track', m.track.id)
                          setParams(p)
                        }}
                        className="min-w-0 flex-1 text-left"
                        title="Use as new source track"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{m.track.artist}</span>
                          <CamelotBadge
                            code={m.track.camelot}
                            approximate={!!m.track.mode}
                            notation={notation}
                            className="shrink-0"
                          />
                        </div>
                        <div className="truncate text-sm text-text-muted">{m.track.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-dim">
                          <BpmBadge bpm={m.track.bpm} className="text-text-muted" />
                          <KeyBadge keyName={m.track.key} mode={m.track.mode} short />
                          <span>Δ {formatDelta(m.deltaBpm)}</span>
                          {m.reasons.slice(0, 2).map(r => (
                            <span key={r} className="tag py-0.5 text-[11px]">{r}</span>
                          ))}
                        </div>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
