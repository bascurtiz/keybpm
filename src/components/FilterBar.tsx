import { DualRange } from '@/components/DualRange'
import { allCamelots, allGenres, allKeys, allLabels, allModes, allYears, bpmBounds, yearBounds } from '@/lib/data'
import { ALL_OPEN_KEYS, camelotToOpenKey, openKeyToCamelot } from '@/lib/camelot'

export interface FilterState {
  bpmMin: number | null
  bpmMax: number | null
  key: string | null
  camelot: string | null
  mode: string | null
  genre: string | null
  label: string | null
  yearMin: number | null
  yearMax: number | null
}

export const EMPTY_FILTERS: FilterState = {
  bpmMin: null, bpmMax: null, key: null, camelot: null, mode: null,
  genre: null, label: null, yearMin: null, yearMax: null,
}

const FILTER_KEYS = ['bpmMin', 'bpmMax', 'key', 'camelot', 'mode', 'genre', 'label', 'yearMin', 'yearMax'] as const

export function hasActiveFilters(f: FilterState): boolean {
  // Check only filter fields — callers pass a wider state object (q/sort/dir).
  return FILTER_KEYS.some(k => f[k] !== null)
}

/** "major/minor" is the plain-key choice; everything else is a listed mode. */
export const PLAIN_MODE = 'plain'

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: { value: string; label: string }[]
  onChange: (v: string | null) => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="input w-full"
      >
        <option value="">All</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

/**
 * Sidebar filter panel: BPM range, key, Camelot, Open Key, mode, genre, label, year.
 * Facets the dataset doesn't fill are hidden rather than shown empty.
 * All state is lifted — the Browse page owns it and reflects it in the URL.
 */
export function FilterBar({
  filters,
  onChange,
  onClear,
  hasQuery = false,
}: {
  filters: FilterState
  onChange: (patch: Partial<FilterState>) => void
  onClear: () => void
  /** When true, the Clear button also clears the search query. */
  hasQuery?: boolean
}) {
  const yearOpts = { min: yearBounds.min, max: yearBounds.max }
  const canClear = hasActiveFilters(filters) || hasQuery

  return (
    <div className="surface p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Filters</h2>
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          className="text-xs text-text-muted underline-offset-2 transition-colors hover:text-text hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="space-y-5">
        <DualRange
          label="BPM"
          min={bpmBounds.min}
          max={bpmBounds.max}
          step={0.5}
          low={filters.bpmMin ?? bpmBounds.min}
          high={filters.bpmMax ?? bpmBounds.max}
          onChange={(lo, hi) =>
            onChange({
              bpmMin: lo <= bpmBounds.min ? null : lo,
              bpmMax: hi >= bpmBounds.max ? null : hi,
            })
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Select
            label="Key"
            value={filters.key}
            options={allKeys.map(k => ({ value: k, label: k }))}
            onChange={v => onChange({ key: v })}
          />
          <Select
            label="Camelot"
            value={filters.camelot}
            options={allCamelots.map(c => ({ value: c, label: c }))}
            onChange={v => onChange({ camelot: v })}
          />
          <Select
            label="Open Key"
            value={filters.camelot ? camelotToOpenKey(filters.camelot) : null}
            options={ALL_OPEN_KEYS.map(o => ({ value: o, label: o }))}
            onChange={v => onChange({ camelot: v ? openKeyToCamelot(v) : null })}
          />
        </div>

        {allModes.length > 0 && (
          <Select
            label="Mode"
            value={filters.mode}
            options={[
              { value: PLAIN_MODE, label: 'Plain major / minor' },
              ...allModes.map(m => ({ value: m, label: m[0].toUpperCase() + m.slice(1) })),
            ]}
            onChange={v => onChange({ mode: v })}
          />
        )}

        {(allGenres.length > 0 || allLabels.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {allGenres.length > 0 && (
              <Select
                label="Genre"
                value={filters.genre}
                options={allGenres.map(g => ({ value: g, label: g }))}
                onChange={v => onChange({ genre: v })}
              />
            )}
            {allLabels.length > 0 && (
              <Select
                label="Label"
                value={filters.label}
                options={allLabels.map(l => ({ value: l, label: l }))}
                onChange={v => onChange({ label: v })}
              />
            )}
          </div>
        )}

        {allYears.length > 1 && (
          <DualRange
            label="Year"
            min={yearOpts.min}
            max={yearOpts.max}
            low={filters.yearMin ?? yearOpts.min}
            high={filters.yearMax ?? yearOpts.max}
            onChange={(lo, hi) =>
              onChange({
                yearMin: lo <= yearOpts.min ? null : lo,
                yearMax: hi >= yearOpts.max ? null : hi,
              })
            }
          />
        )}
      </div>
    </div>
  )
}
