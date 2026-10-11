/**
 * The per-source key listings behind `/source/:id`.
 *
 * A published source ships a compact JSON in `data/source-keys/<id>.json`,
 * built by `scripts/import_source_keys.mjs` from the consensus engine's own
 * CSV for that source. Rows are `[artist, title, camelot, trackId?]`, with
 * `trackId` the database record the entry matches — that is what makes a chip
 * deep-linkable (`/source/camelotsound#the-beatles-in-my-life`).
 *
 * They are loaded lazily through `import.meta.glob`, so a 200 KB listing is
 * only downloaded when its page is actually opened; the main bundle stays as it
 * was.
 */
export type SourceKeyRow = [
  artist: string,
  title: string,
  camelot: string,
  /** Matching record in data/tracks.json, when the dataset has one. */
  trackId?: string,
]

export interface SourceListing {
  source: string
  /** Canonical page of the source itself, shown in the page header. */
  url: string
  /** Snapshot date of the source CSV the listing was built from. */
  generated: string
  rows: SourceKeyRow[]
}

const listings = import.meta.glob<{ default: SourceListing }>('../../data/source-keys/*.json')

/** Ids that have a listing in this build, e.g. `['camelotsound', …]`. */
export function listingIds(): string[] {
  return Object.keys(listings)
    .map(path => path.replace(/^.*\//, '').replace(/\.json$/, ''))
    .sort()
}

/** One listing, or `null` when this build has none for that source. */
export async function loadListing(id: string): Promise<SourceListing | null> {
  const load = listings[`../../data/source-keys/${id}.json`]
  if (!load) return null
  try {
    const module = await load()
    return module.default
  } catch {
    return null
  }
}
