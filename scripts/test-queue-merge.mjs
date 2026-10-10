/**
 * Regression test for scripts/lib/merge_queue.mjs — run with `npm test`.
 *
 * The bug this guards: a moderator approved a contributed track whose BPM was
 * empty, then approved a correction filling in 114. The queue is served newest
 * first, and the merge processed rows in that order, so the correction found no
 * track to patch (it existed only as a queue add) and was dropped — then the
 * add wrote its empty BPM back. Live track showed "—".
 */
import assert from 'node:assert/strict'
import { mergeQueue } from './lib/merge_queue.mjs'

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

const t = {
  add: (id, payload, created_at) => ({ id, kind: 'add', track_id: null, payload, created_at }),
  correct: (id, track_id, payload, created_at) => ({
    id,
    kind: 'correct',
    track_id,
    payload,
    created_at,
  }),
}

const track = (over = {}) => ({
  id: 'depeche-mode-policy-of-truth',
  artist: 'Depeche Mode',
  title: 'Policy of Truth',
  bpm: null,
  key: 'C minor',
  camelot: '5A',
  genre: null,
  label: null,
  release: null,
  year: null,
  duration: null,
  source: 'Community',
  confidence: null,
  lastVerified: null,
  ...over,
})

it('a correction to a queue-only add wins, even though the queue serves it first', () => {
  // Newest first, exactly as the API returned them before the fix.
  const submissions = [
    t.correct('c1', 'depeche-mode-policy-of-truth', { id: 'depeche-mode-policy-of-truth', artist: 'Depeche Mode', title: 'Policy of Truth', bpm: 114, key: 'C minor', camelot: '5A', source: 'Community' }, '2026-10-10 11:53:23'),
    t.add('a1', { id: 'depeche-mode-policy-of-truth', artist: 'Depeche Mode', title: 'Policy of Truth', bpm: null, key: 'C minor', camelot: '5A', genre: null, year: null, source: 'Community' }, '2026-10-10 01:13:46'),
  ]
  const { tracks, added, corrected, appliedIds, skipped } = mergeQueue([], submissions)
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].bpm, 114)
  assert.equal(tracks[0].artist, 'Depeche Mode')
  assert.equal(added, 1)
  assert.equal(corrected, 1)
  assert.deepEqual(skipped, [])
  assert.deepEqual(appliedIds.sort(), ['a1', 'c1'])
})

it('the newest of several corrections is the final word', () => {
  const submissions = [
    t.add('a1', track({ bpm: null }), '2026-10-10 01:00:00'),
    t.correct('c2', 'depeche-mode-policy-of-truth', track({ bpm: 120 }), '2026-10-10 12:00:00'),
    t.correct('c1', 'depeche-mode-policy-of-truth', track({ bpm: 114 }), '2026-10-10 11:00:00'),
  ]
  const { tracks } = mergeQueue([], submissions)
  assert.equal(tracks[0].bpm, 120)
})

it('a correction never blanks a field it does not state', () => {
  const base = track({ bpm: 124, genre: 'Synth-pop', label: 'Mute', year: 1990, bpmRaw: '~124' })
  const submissions = [
    t.correct('c1', base.id, { id: base.id, artist: 'Depeche Mode', title: 'Policy of Truth', bpm: 128, key: 'C minor', camelot: '5A', genre: null, label: null, year: null, source: 'Community' }, '2026-10-10 11:00:00'),
  ]
  const { tracks } = mergeQueue([base], submissions)
  assert.equal(tracks[0].bpm, 128)
  assert.equal(tracks[0].genre, 'Synth-pop')
  assert.equal(tracks[0].label, 'Mute')
  assert.equal(tracks[0].year, 1990)
  assert.equal(tracks[0].bpmRaw, '~124')
})

it('corrections apply to tracks already in tracks.json, in place', () => {
  const base = track({ bpm: 124, source: 'Beatport' })
  const submissions = [
    t.correct('c1', base.id, { id: base.id, artist: 'Depeche Mode', title: 'Policy of Truth', bpm: 126, key: 'C minor', camelot: '5A' }, '2026-10-10 11:00:00'),
  ]
  const { tracks, added } = mergeQueue([base], submissions)
  assert.equal(added, 0)
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].bpm, 126)
  assert.equal(tracks[0].source, 'Beatport', 'unstated source keeps the existing one')
})

it('an add for an existing id is skipped, not duplicated', () => {
  const base = track({ bpm: 124 })
  const { tracks, added, skipped } = mergeQueue([base], [t.add('a1', base, '2026-10-10 01:00:00')])
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].bpm, 124)
  assert.equal(added, 0)
  assert.match(skipped[0].reason, /already exists/)
})

it('a correction for an unknown track is skipped without throwing', () => {
  const { tracks, corrected, skipped, appliedIds } = mergeQueue([], [t.correct('c1', 'nope', track(), '2026-10-10 11:00:00')])
  assert.deepEqual(tracks, [])
  assert.equal(corrected, 0)
  assert.deepEqual(appliedIds, [])
  assert.match(skipped[0].reason, /not found/)
})

it('an add without an id is skipped', () => {
  const { tracks, skipped } = mergeQueue([], [t.add('a1', { artist: 'X', title: 'Y', bpm: 120 }, '2026-10-10 01:00:00')])
  assert.deepEqual(tracks, [])
  assert.match(skipped[0].reason, /missing id/)
})

it('a moderator correcting a contributed track keeps the original submitter', () => {
  const submissions = [
    t.add('a1', { ...track({ bpm: null }), submittedBy: 'TheHolyT-Bo', submittedByDiscordId: '111' }, '2026-10-10 01:13:46'),
    t.correct('c1', 'depeche-mode-policy-of-truth', { ...track({ bpm: 114 }), submittedBy: 'Bas Curtiz', submittedByDiscordId: '390110399048974337' }, '2026-10-10 11:53:23'),
  ]
  const { tracks } = mergeQueue([], submissions)
  assert.equal(tracks[0].bpm, 114)
  assert.equal(tracks[0].submittedBy, 'TheHolyT-Bo', 'the contributor keeps the credit')
  assert.equal(tracks[0].submittedByDiscordId, '111')
  assert.equal(tracks[0].lastEditedBy, 'Bas Curtiz', 'the editor is recorded separately')
  assert.equal(tracks[0].lastEditedByDiscordId, '390110399048974337')
})

it('a correction to a sheet row records the editor instead of claiming the contribution', () => {
  const base = { ...track({ bpm: 124, source: "duuzu's key & bpm database v10" }) }
  delete base.submittedBy
  const submissions = [
    t.correct('c1', base.id, { ...track({ bpm: 126 }), source: base.source, submittedBy: 'Bas Curtiz', submittedByDiscordId: '390110399048974337' }, '2026-10-10 11:00:00'),
  ]
  const { tracks } = mergeQueue([base], submissions)
  assert.equal(tracks[0].bpm, 126)
  assert.equal(tracks[0].submittedBy, undefined)
  assert.equal(tracks[0].source, "duuzu's key & bpm database v10", 'source is not relabelled')
  assert.equal(tracks[0].lastEditedBy, 'Bas Curtiz')
})

it('editing your own submission does not add a redundant editor', () => {
  const submissions = [
    t.add('a1', { ...track({ bpm: null }), submittedBy: 'TheHolyT-Bo' }, '2026-10-10 01:00:00'),
    t.correct('c1', 'depeche-mode-policy-of-truth', { ...track({ bpm: 114 }), submittedBy: 'TheHolyT-Bo' }, '2026-10-10 11:00:00'),
  ]
  const { tracks } = mergeQueue([], submissions)
  assert.equal(tracks[0].submittedBy, 'TheHolyT-Bo')
  assert.equal(tracks[0].lastEditedBy, undefined)
})

it('new tracks are prepended and existing order is preserved', () => {
  const a = track({ id: 'a', bpm: 100 })
  const b = track({ id: 'b', bpm: 200 })
  const submissions = [
    t.add('a1', track({ id: 'new', artist: 'New', title: 'Track', bpm: 128 }), '2026-10-10 01:00:00'),
  ]
  const { tracks } = mergeQueue([a, b], submissions)
  assert.deepEqual(tracks.map(x => x.id), ['new', 'a', 'b'])
})

console.log(`\n${suite} tests passed`)
