/**
 * Regression test for src/lib/activityOrder.ts — run with `npm test`.
 *
 * The bug this guards: the Community activity feed merged two kinds of row and
 * sorted them by comparing their time strings. A queue row carries a SQLite
 * timestamp ("2026-10-11 10:45:00"), an imported track only the date of its
 * snapshot ("2026-10-11"), which the feed padded to "2026-10-11T00:00:00Z".
 * 'T' (0x54) sorts after ' ' (0x20), so every import outranked every
 * contribution from the same day — and a bulk import is thousands of rows, so
 * three tracks approved the day of an import never appeared in the feed at all.
 */
import assert from 'node:assert/strict'

/**
 * Imported with `node` type stripping (Node ≥ 23.6). On an older runtime the
 * module cannot be loaded at all, so say so rather than reporting a pass —
 * `npm run typecheck` still covers the file there.
 */
let orderFeed
try {
  ;({ orderFeed } = await import('../src/lib/activityOrder.ts'))
} catch (err) {
  if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
    console.log(
      '1..0 # skip: Node < 23.6 cannot import TypeScript; run `npm run typecheck` instead',
    )
    process.exit(0)
  }
  throw err
}

let suite = 0
function it(name, fn) {
  suite++
  try {
    fn()
    console.log(`ok ${suite} - ${name}`)
  } catch (err) {
    console.error(`not ok ${suite} - ${name}`)
    throw err
  }
}

/** A reviewed queue row: created_at is "2026-10-11 10:45:00" (UTC). */
const queue = (id, createdAt) => ({ kind: 'queue', when: createdAt, item: { id } })

/** An imported track: lastVerified is a bare date, "2026-10-11". */
const imported = (id, lastVerified) => ({ kind: 'import', when: lastVerified, track: { id } })

const kinds = rows => rows.map(r => r.kind)

it('a same-day contribution outranks a same-day import', () => {
  const rows = orderFeed([imported('i1', '2026-10-11'), queue('q1', '2026-10-11 10:45:00')], 10)
  assert.deepEqual(kinds(rows), ['queue', 'import'])
})

it('a fresh import still outranks a contribution from an earlier day', () => {
  const rows = orderFeed([queue('q1', '2026-10-10 20:57:39'), imported('i1', '2026-10-11')], 10)
  assert.deepEqual(kinds(rows), ['import', 'queue'])
})

it('approvals are not buried by a bulk import that landed the same day', () => {
  const imports = Array.from({ length: 40 }, (_, i) => imported(`i${i}`, '2026-10-11'))
  const approvals = [
    queue('ismfof', '2026-10-11 10:45:00'),
    queue('2pac', '2026-10-11 10:45:01'),
    queue('flaming-lips', '2026-10-11 10:45:02'),
  ]
  const rows = orderFeed([...approvals, ...imports], 8)
  assert.deepEqual(
    rows.slice(0, 3).map(r => r.item.id),
    ['flaming-lips', '2pac', 'ismfof'],
  )
})

it('newest first within one kind', () => {
  const rows = orderFeed(
    [queue('a', '2026-10-11 09:00:00'), queue('b', '2026-10-11 11:30:00')],
    10,
  )
  assert.deepEqual(rows.map(r => r.item.id), ['b', 'a'])
})

it('a row with no usable time sorts last instead of throwing', () => {
  const rows = orderFeed([queue('q1', ''), imported('i1', '2026-10-11')], 10)
  assert.deepEqual(kinds(rows), ['import', 'queue'])
})

it('keeps at most `limit` rows', () => {
  const rows = orderFeed(
    Array.from({ length: 30 }, (_, i) => imported(`i${i}`, '2026-10-11')),
    8,
  )
  assert.equal(rows.length, 8)
})
