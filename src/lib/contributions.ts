/**
 * Local contributions (prototype's "Add a new track" / suggest-correction flow).
 * Stored in localStorage, merged into the dataset at load time, and clearly
 * marked `source: 'Community'`. A static site can't persist server-side
 * (AGENTS §18): the UI also offers "Copy JSON" so a submission can become a
 * GitHub issue/PR downstream.
 */
import type { Track } from '@/types/track'

const STORAGE_KEY = 'keydb:contributions'

interface ContributionFile {
  added: Track[]
  /** Corrections keyed by existing track id. */
  corrected: Record<string, Track>
}

const EMPTY: ContributionFile = { added: [], corrected: {} }

function isTrack(v: unknown): v is Track {
  if (!v || typeof v !== 'object') return false
  const t = v as Partial<Track>
  return (
    typeof t.id === 'string' &&
    typeof t.artist === 'string' &&
    typeof t.title === 'string' &&
    typeof t.key === 'string' &&
    typeof t.camelot === 'string'
  )
}

export function loadContributions(): ContributionFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<ContributionFile>
    return {
      added: Array.isArray(parsed.added) ? parsed.added.filter(isTrack) : [],
      corrected:
        parsed.corrected && typeof parsed.corrected === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.corrected).filter(([, v]) => isTrack(v)),
            )
          : {},
    }
  } catch {
    return EMPTY
  }
}

/** Broadcast so the data layer can re-merge without a full page reload. */
export const DATA_CHANGED = 'keydb:data-changed'

function save(file: ContributionFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file))
  } catch {
    /* quota/private mode — contribution just won't persist */
  }
  window.dispatchEvent(new CustomEvent(DATA_CHANGED))
}

export function addTrack(track: Track): void {
  const file = loadContributions()
  file.added = [track, ...file.added.filter(t => t.id !== track.id)]
  save(file)
}

export function correctTrack(originalId: string, track: Track): void {
  const file = loadContributions()
  file.corrected[originalId] = track
  save(file)
}

export function removeContribution(id: string): void {
  const file = loadContributions()
  file.added = file.added.filter(t => t.id !== id)
  delete file.corrected[id]
  save(file)
}

/**
 * Merge stored contributions over the seed dataset.
 * Deterministic: corrections apply in place (to seed *and* community tracks),
 * additions prepend.
 */
export function mergeContributions<T extends Track>(base: T[]): Track[] {
  const file = loadContributions()
  const corrected = base.map(t => file.corrected[t.id] ?? t) as Track[]
  const baseIds = new Set(corrected.map(t => t.id))
  const added = file.added.map(t => file.corrected[t.id] ?? t)
  return [...added.filter(t => !baseIds.has(t.id)), ...corrected]
}

/** Stable slug id: "Fred again.." + "adore u" -> "fred-again-adore-u". */
export function slugId(artist: string, title: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return `${slug(artist)}-${slug(title)}`.replace(/^-+|-+$/g, '') || 'untitled'
}
