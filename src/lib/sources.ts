import { CAMELOT_TO_KEY, type Track, type TrackSource } from '@/types/track'
import { isMajorKey, keyRelation } from '@/lib/camelot'
import { shortKey } from '@/lib/format'

/**
 * Metadata for the third-party key services the consensus engine aggregates.
 * Kept in one place (like Camelot logic, AGENTS §35) so a chip, a tooltip and
 * a detail row always agree on a source's code, name and colour.
 *
 * Codes mirror the Key Consensus Engine's palette; the hex colours are tuned
 * for this UI, where a chip's border and tint sit on both the dark and the
 * light theme's surfaces and the code lettering has to stay legible on them.
 */
export interface SourceMeta {
  /** Two-letter chip label, e.g. "SG". */
  code: string
  name: string
  /** Brand colour — used for the chip border/tint. Decorative only (§25). */
  color: string
  /** Canonical page for the source, used as the chip's link when a track has none. */
  url?: string
  /**
   * What the source publishes — shown on its `/source/<id>` page header.
   * Only set for sources whose key listings ship with the app.
   */
  description?: string
  /**
   * The source's own key listing is published in-app at `/source/<id>` (built
   * by `scripts/import_source_keys.mjs`), so chips deep-link there instead of
   * leaving the site.
   */
  listing?: boolean
}

/** duuzu's sheet — the dataset's original source (also linked on About/Contribute). */
const DUUZU_URL =
  'https://docs.google.com/document/d/1WcHNaTo6KHNG88yUWxrCULuwHPuQCGQ8UtItgzzK50Q/edit?tab=t.0'

export const SOURCE_META: Record<string, SourceMeta> = {
  duuzu: { code: 'DZ', name: "duuzu's key & bpm database", color: '#23DC67', url: DUUZU_URL },
  camelotsound: {
    code: 'CS',
    name: 'CamelotSound',
    color: '#EFD279',
    url: 'http://www.camelotsound.com/',
    listing: true,
    description:
      'A long-running DJ harmonic-mixing index: artist, title, tempo and a Camelot keycode per record, made to chain tracks by key. Listed here are the entries that also reached the consensus export — the tracks that carry a CS chip in this database.',
  },
  hooktheory: { code: 'HT', name: 'HookTheory', color: '#00A3CF' },
  karaoke_version: { code: 'KV', name: 'Karaoke-Version', color: '#D3007D' },
  musicnotes: { code: 'MN', name: 'MusicNotes', color: '#4E6D8D' },
  songgalaxy: { code: 'SG', name: 'SongGalaxy', color: '#E43F5A' },
  songkeyfinder: { code: 'SK', name: 'SongKeyFinder', color: '#A8B2C1' },
  isolated_tracks: { code: 'IT', name: 'Isolated Tracks', color: '#4CB6CB' },
  harmonickeys: {
    code: 'HK',
    name: 'Harmonic Keys',
    color: '#1D51C4',
    url: 'https://ultramaroon.net/category/harmonic-keys/',
    listing: true,
    description:
      'Harmonic Keys was a 1986 print magazine of key and speed listings for dance and R&B records, archived by the Dance Music Report collection. The entries whose tracks are also in this database are listed here.',
  },
  keyfinder_pdf: {
    code: 'KF',
    name: 'KeyFinder',
    color: '#228822',
    url: 'https://www.ibrahimshaath.co.uk/keyfinder/KeyFinderV2Dataset.pdf',
    listing: true,
    description:
      "The KeyFinder V2 dataset: tracks analysed with Ibrahim Sha'ath's open-source key-detection software, each with the musical key it reported — shown here as the Camelot position of that key. Only its tracks that are also in this database are listed.",
  },
  fmak_v2: {
    code: 'FM',
    name: 'FMAK v2',
    color: '#317DF7',
    url: 'https://zenodo.org/records/12759100',
    listing: true,
    description:
      'FMAKv2 annotates tracks from the Free Music Archive with a musical key and mode (CC BY 4.0, produced with the STONE key estimator). A research dataset rather than a DJ catalogue — only the few whose tracks are also in this database are listed.',
  },
}

/**
 * Imported rows keep their provenance in `source` as a string, not a `sources`
 * array. Mapping that string to a source id lets those rows render a chip like
 * the consensus rows do — without rewriting 19k records into the dataset.
 */
const PRIMARY_SOURCE_IDS: Record<string, string> = {
  "duuzu's key & bpm database v10": 'duuzu',
}

/**
 * Source id for a row's `source` string, when it maps to a known source.
 * `null` for anything else — callers fall back to the string itself, which
 * `sourceMeta` turns into a generic chip rather than inventing metadata.
 */
export function primarySourceId(source: string): string | null {
  return PRIMARY_SOURCE_IDS[source] ?? null
}

/**
 * Sources that key a *section* of a song rather than the whole of it: their
 * page anchors each section separately, so "Intro and Verse" can be in C major
 * while the "Chorus" is in A minor — two keys, one source, both correct.
 *
 * The exports carry the section *name* as the URL fragment
 * (`…#Intro%20and%20Verse`), but the sites' own anchors are the slug of that
 * name (`#intro-and-verse`) — verified against live pages: with the raw
 * fragment the Zedd track above opens on its Chorus (A minor), with the slug it
 * opens on Intro and Verse (C major). A fragment the page cannot resolve is
 * silently ignored and the site's default section is shown instead, which is
 * how a source stating `8B` ends up displaying `8A`. Only sources whose anchor
 * scheme has been checked are listed here; nothing is guessed.
 */
const SECTION_ANCHOR_SOURCES = new Set(['hooktheory'])

/** The section a source URL points at ("Intro and Verse"), or null when none. */
export function sourceSection(url: string | null | undefined): string | null {
  if (!url) return null
  const hash = url.indexOf('#')
  if (hash < 0) return null
  const raw = url.slice(hash + 1).trim()
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Lowercase, hyphenated form of a section name — the shape these sites use as ids. */
function anchorSlug(section: string): string {
  return section
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A source URL whose section anchor can actually be followed. A section-keyed
 * source gets the slug its site uses, so clicking a row opens the section that
 * states the key the row prints; for every other source the URL is untouched.
 */
export function repairSectionAnchor(id: string, url: string | null | undefined): string | null {
  if (!url || !SECTION_ANCHOR_SOURCES.has(id)) return url ?? null
  const section = sourceSection(url)
  if (!section) return url
  const slug = anchorSlug(section)
  if (!slug || slug === section) return url
  return `${url.slice(0, url.indexOf('#'))}#${slug}`
}

/**
 * The other keys a source lists for the track, beyond its primary one — empty
 * for the usual single-key source. A section-keyed source can state several.
 */
export function sourceOtherKeys(source: TrackSource): string[] {
  if (!source.keys?.length) return []
  return source.keys.filter(k => k !== source.key)
}

/**
 * "also lists 9B, 7B +5" — the other keys a multi-key source lists, capped so
 * one source cannot push a track page's Sources list out of shape. The full list
 * is always available in the tooltip.
 */
export function sourceOtherKeysLabel(source: TrackSource, max = 3): string | null {
  const others = sourceOtherKeys(source)
  if (!others.length) return null
  const shown = others.slice(0, max).join(', ')
  const extra = others.length - Math.min(max, others.length)
  return extra > 0 ? `also lists ${shown} +${extra}` : `also lists ${shown}`
}

/**
 * Why a source's key is not the track's key — or null when it agrees (or when
 * either key is unknown), because then there is nothing to explain.
 *
 * A relative major/minor is the common case and the least alarming one: `8A`
 * and `8B` are the same seven notes with a different tonal centre, so a source
 * that reports one for a track keyed in the other is not contradicting it. The
 * wording says that instead of flatly reading as a conflict (§17).
 */
export function sourceDissentNote(
  source: TrackSource,
  trackCamelot: string | null | undefined,
): string | null {
  if (!trackCamelot || !source.key || source.key === trackCamelot) return null
  if (keyRelation(trackCamelot, source.key) === 'relative') {
    return `relative ${isMajorKey(source.key) ? 'major' : 'minor'}, same seven notes as this track's ${trackCamelot}`
  }
  return `differs from this track's ${trackCamelot}`
}

/**
 * The chips to show for a track: its per-source key reports when the record
 * carries them, otherwise its own primary `source` as a single report (duuzu's
 * rows state a key just like any consensus source does).
 */
export function trackSources(track: Track): TrackSource[] {
  if (track.sources?.length) return track.sources
  const id = primarySourceId(track.source)
  if (!id) return []
  return [{ id, key: track.camelot, url: sourceMeta(id).url ?? null }]
}

/** Fallback so an unrecognised source id still renders a sane chip. */
export function sourceMeta(id: string): SourceMeta {
  const known = SOURCE_META[id]
  if (known) return known
  const label = id.replace(/[_-]+/g, ' ').trim()
  return {
    code: label.slice(0, 2).toUpperCase() || '??',
    name: label ? label.replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown source',
    color: '#94A3B8',
  }
}

/** Human label for a source: "SongGalaxy". */
export function sourceLabel(id: string): string {
  return sourceMeta(id).name
}

/** "11B (A)" — Camelot code plus the musical key it maps to; null when unknown. */
export function sourceStatedKey(camelot: string | null): string | null {
  if (!camelot) return null
  const key = CAMELOT_TO_KEY[camelot]
  return key ? `${camelot} (${shortKey(key)})` : camelot
}

/**
 * Search URL used when the export carried no direct link for a source. Ported
 * from the consensus engine's dashboard so a chip is always worth clicking.
 */
export function sourceSearchUrl(id: string, artist: string, title: string): string | null {
  const track = `${artist} ${title}`.trim()
  if (!track) return null
  const q = encodeURIComponent(track)
  switch (id) {
    case 'musicnotes':
      return `https://www.musicnotes.com/search/go?w=${q}`
    case 'karaoke_version':
      return `https://www.karaoke-version.com/quicksearch.html?query=${q}`
    case 'songgalaxy':
      return `https://songgalaxy.com/multi.php?search=${q}`
    case 'hooktheory':
      return `https://www.hooktheory.com/theorytab/common-chord-progressions?q=${q}`
    case 'songkeyfinder':
      return `https://www.google.com/search?q=site:songkeyfinder.com+${q}`
    case 'camelotsound':
      return `https://www.google.com/search?q=site:camelotsound.com+${q}`
    case 'harmonickeys':
      return `https://www.google.com/search?q=${encodeURIComponent(`Harmonic Keys ${track}`)}`
    case 'keyfinder_pdf':
      return 'https://www.ibrahimshaath.co.uk/keyfinder/KeyFinderV2Dataset.pdf'
    case 'fmak_v2':
      return 'https://zenodo.org/records/12759100'
    default:
      return `https://www.google.com/search?q=${q}`
  }
}

/** Whether the source's own key listing is published in-app. */
export function hasSourcePage(id: string): boolean {
  return SOURCE_META[id]?.listing === true
}

/**
 * Where a source's chip should go.
 *
 * When the source publishes its listing in-app, the chip deep-links to that
 * page anchored on this track's row (`/source/camelotsound#the-beatles-in-my-life`),
 * so a click answers "what does this source state for this track?" without
 * leaving the database. Otherwise it opens the source's own page for the track
 * — the export's direct link, or the source's search page when it had none.
 */
export function sourceHref(
  source: TrackSource,
  track: { id?: string; artist: string; title: string },
): string | null {
  if (hasSourcePage(source.id) && track.id) {
    return `/source/${source.id}#${track.id}`
  }
  return repairSectionAnchor(source.id, source.url) ?? sourceSearchUrl(source.id, track.artist, track.title)
}

/**
 * Hover text: "SongGalaxy — Stated Key: 11B (A)". When the source's own key
 * disagrees with the track's consensus key, that is part of the tooltip — the
 * row must never present a conflicted key as unanimous (§17).
 */
export function sourceTooltip(source: TrackSource, consensusCamelot?: string | null): string {
  const stated = sourceStatedKey(source.key)
  const section = sourceSection(source.url)
  const parts = [
    sourceLabel(source.id),
    stated ? `Stated Key: ${stated}` : 'Stated Key: not given',
  ]
  if (section) parts.push(`section: ${section}`)
  const others = sourceOtherKeys(source)
  if (others.length) parts.push(`also lists ${others.join(', ')}`)
  const note = sourceDissentNote(source, consensusCamelot)
  if (note) parts.push(note)
  return parts.join(' — ')
}
