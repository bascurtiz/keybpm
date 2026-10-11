/**
 * Ordering for the homepage's Community activity feed.
 *
 * Two kinds of row share that one list and each carries its own clock: a
 * reviewed queue row has a SQLite timestamp ("2026-10-11 10:45:00", UTC),
 * while an imported track has only the date of the snapshot it arrived in
 * ("2026-10-11"). Comparing those strings directly is wrong, not merely
 * imprecise: 'T' (0x54) sorts after ' ' (0x20), so *every* import of a day
 * outranked *every* contribution made that day. A bulk import is thousands of
 * rows, so the feed opened with imported tracks and the entries a moderator
 * had just approved fell off the end of the list entirely.
 *
 * Both shapes are parsed to a UTC instant instead — a date-only value being
 * that day's midnight — and compared numerically. That is the order the feed
 * documents: a fresh import sits above anything older, and below contributions
 * made the same day.
 *
 * The import below names the `.ts` extension deliberately: it keeps this
 * module loadable by plain `node` (type stripping), which is how
 * `scripts/test-activity-order.mjs` exercises the real rule instead of a copy.
 */
import { parseUtc } from './format.ts'

/** One row's sort key: epoch ms, UTC. Unusable input sorts last. */
function instant(when: string | null | undefined): number {
  return (when ? parseUtc(when) : null) ?? 0
}

/** Newest first, keeping at most `limit` rows. */
export function orderFeed<T extends { when: string | null }>(rows: T[], limit: number): T[] {
  return [...rows].sort((a, b) => instant(b.when) - instant(a.when)).slice(0, limit)
}
