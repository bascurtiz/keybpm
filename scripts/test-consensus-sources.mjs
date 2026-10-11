/**
 * Regression tests for scripts/lib/consensus_sources.mjs — run with `npm test`.
 *
 * The bugs this guards, both seen on live records: the `Glee – Santa Baby` row
 * was imported with provenance claiming its sources contradicted its key, when
 * three of them state it — the export's per-source columns had simply carried
 * the key those sources give to a different song (`Glee – Baby`). And HookTheory
 * appeared to state one key per track, when it keys each section separately.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  consensusProvenance,
  isAttributable,
  normalizeTrack,
  readCsvTable,
  readSourceIndex,
  statementForTrack,
} from './lib/consensus_sources.mjs'
import { findMatchDetails, readMatchDetails } from './lib/match_details.mjs'

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

const HEADER = 'artist,title,artist_title,key_raw,key_camelot,key_musical,bpm,source,url,track_norm'
const row = (artist, title, raw, camelot, source, url, norm) =>
  [artist, title, `${artist} - ${title}`, raw, camelot, '', '', source, url, norm].join(',')

const dir = mkdtempSync(join(tmpdir(), 'keybpm-consensus-'))
writeFileSync(join(dir, 'isolated_tracks.csv'), [
  HEADER,
  row('Glee', 'Santa Baby', 'Db', '3B', 'isolated_tracks', 'https://isolated-tracks.com/glee/santa-baby-2', 'glee santa baby'),
  row('Glee', 'Baby', 'Bb', '6B', 'isolated_tracks', 'https://isolated-tracks.com/glee/baby-2', 'glee baby'),
].join('\n') + '\n')
writeFileSync(join(dir, 'hooktheory.csv'), [
  HEADER,
  row('zedd feat selena gomez', 'I Want You to Know', 'C', '8B', 'hooktheory', 'https://www.hooktheory.com/theorytab/view/zedd-feat-selena-gomez/i-want-you-to-know#Intro%20and%20Verse', 'zedd i want you to know'),
  row('zedd feat selena gomez', 'I Want You to Know', 'Am', '8A', 'hooktheory', 'https://www.hooktheory.com/theorytab/view/zedd-feat-selena-gomez/i-want-you-to-know#Chorus', 'zedd i want you to know'),
  row('Buddy Holly', 'Peggy Sue', ' Ab', '11B', 'hooktheory', '', 'buddy holly peggy sue'),
].join('\n') + '\n')
// A file that is not a source listing must be ignored, not misread.
writeFileSync(join(dir, 'songgalaxy_scraped.csv'), 'Artist,Title,Key,BPM,URL\nX,Y,C,120,\n')

const index = readSourceIndex(dir)

it('normalisation matches the engine\'s track_norm', () => {
  assert.equal(normalizeTrack('zedd feat selena gomez', 'I Want You to Know'), 'zedd i want you to know')
  assert.equal(normalizeTrack('The Beatles', 'In My Life (Remastered)'), 'beatles in my life')
})

it('only real source listings are indexed', () => {
  assert.deepEqual(index.files.sort(), ['hooktheory.csv', 'isolated_tracks.csv'])
})

it('a source is asked by name for what it states about a track', () => {
  const statement = statementForTrack(index, { artist: 'Glee', title: 'Santa Baby', sourceId: 'isolated_tracks' })
  assert.deepEqual(statement.keys, ['3B'])
  assert.equal(statement.urls['3B'], 'https://isolated-tracks.com/glee/santa-baby-2')
})

it('a track a source does not list states nothing', () => {
  assert.equal(statementForTrack(index, { artist: 'Glee', title: 'Santa Baby', sourceId: 'hooktheory' }), null)
})

it('the engine\'s url for a source finds its row when the spelling differs', () => {
  // The export's representative artist/title need not match the listing's own.
  const statement = statementForTrack(index, {
    artist: 'Glee Cast',
    title: 'Santa Baby (Glee Cast Version)',
    sourceId: 'isolated_tracks',
    url: 'https://isolated-tracks.com/glee/santa-baby-2',
  })
  assert.deepEqual(statement.keys, ['3B'])
})

it('a cluster sibling\'s url does not graft another song\'s key onto the track', () => {
  // The export's url_isolated_tracks for Glee – Santa Baby points at its row for
  // Glee – Baby. That row's key is not this track's, so it must not appear.
  const statement = statementForTrack(index, {
    artist: 'Glee',
    title: 'Santa Baby',
    sourceId: 'isolated_tracks',
    url: 'https://isolated-tracks.com/glee/baby-2',
  })
  assert.deepEqual(statement.keys, ['3B'])
})

it('every key a source lists for a track is kept', () => {
  const statement = statementForTrack(index, { artist: 'Zedd feat Selena Gomez', title: 'I Want You to Know', sourceId: 'hooktheory' })
  assert.deepEqual(statement.keys, ['8B', '8A'], 'one source, two sections')
})

it('a source that states the consensus key is credited with it, not with a sibling\'s key', () => {
  // The Glee – Santa Baby regression: Isolated Tracks also has "Glee – Baby" at
  // 6B, and the export's key_isolated_tracks column carried that instead.
  const { sources, agree, dissent, notes, confidence } = consensusProvenance(index, {
    artist: 'Glee',
    title: 'Santa Baby',
    camelot: '3B',
    reporting: ['isolated_tracks', 'hooktheory'],
    urlFor: () => '',
  })
  assert.deepEqual(sources, [{ id: 'isolated_tracks', key: '3B', url: 'https://isolated-tracks.com/glee/santa-baby-2' }])
  assert.equal(agree, 1)
  assert.equal(dissent, 0)
  assert.equal(notes, 'Key agreed by 1 of 1 reporting sources.')
  assert.equal(confidence, 1)
})

it('a source that states another key is called a dissenter, with the value it states', () => {
  const { sources, agree, dissent, notes, confidence } = consensusProvenance(index, {
    artist: 'Zedd feat Selena Gomez',
    title: 'I Want You to Know',
    camelot: '11A',
    reporting: ['hooktheory'],
    urlFor: () => '',
  })
  assert.deepEqual(sources, [{
    id: 'hooktheory',
    key: '8B',
    url: 'https://www.hooktheory.com/theorytab/view/zedd-feat-selena-gomez/i-want-you-to-know#Intro%20and%20Verse',
    keys: ['8B', '8A'],
  }])
  assert.equal(agree, 0)
  assert.equal(dissent, 1)
  assert.match(notes, /not corroborated/)
  assert.equal(confidence, undefined)
})

it('a multi-key source that states the consensus key is credited with that key', () => {
  const { sources, agree } = consensusProvenance(index, {
    artist: 'Zedd feat Selena Gomez',
    title: 'I Want You to Know',
    camelot: '8A',
    reporting: ['hooktheory'],
    urlFor: () => '',
  })
  assert.equal(agree, 1)
  assert.equal(sources[0].key, '8A', 'the key it agreed on')
  assert.equal(sources[0].url, 'https://www.hooktheory.com/theorytab/view/zedd-feat-selena-gomez/i-want-you-to-know#Chorus', 'the section that states it')
  assert.deepEqual(sources[0].keys, ['8B', '8A'])
})

it('quoted commas in a listing do not shift its columns', () => {
  const table = readCsvTable('a,b,c\n"Earth, Wind & Fire",September,C,120\n')
  assert.equal(table[1][0], 'Earth, Wind & Fire')
  assert.equal(table[1][3], '120')
})

// ---- the engine's per-record evidence (export_match_details.py) -------------

const DETAILS = join(dir, 'match_details.csv')
writeFileSync(DETAILS, [
  'track_norm;artist;title;camelot;source;record_artist;record_title;record_key_camelot;record_raw;record_url',
  // Semicolon-separated, so a comma inside a field is literal content.
  '10 000 maniacs these are days;10,000 Maniacs;These Are Days;5B;karaoke_version;10,000 Maniacs;These Are Days;5B;E♭;https://example.test/these-are-days',
  // A source whose record is spelled differently from the export's name.
  'gigi d agostino lamour toujours;Gigi D\'Agostino;lamour toujours;10B;songkeyfinder;Gigi D’Agostino;L’amour toujours;10B;d-major;https://example.test/lamour-toujours',
].join('\n') + '\n')
const details = readMatchDetails(DETAILS)

it('match details read as a semicolon file, commas and all', () => {
  assert.equal(details.records, 2)
  assert.equal(details.byNorm.get('10 000 maniacs these are days').artist, '10,000 Maniacs')
})

it('the engine\'s evidence is found by the record url it matched', () => {
  const found = findMatchDetails(details, {
    artist: 'Gigi D’Agostino',
    title: 'L’amour toujours (single version)',
    urls: ['https://example.test/lamour-toujours'],
  })
  assert.equal(found.camelot, '10B')
  assert.equal(found.sources.get('songkeyfinder').title, 'L’amour toujours')
})

it('a source is credited from the engine\'s evidence when its listing cannot be joined', () => {
  // Gigi D'Agostino's listing rows are spelled `L'amour Toujours`, which none of
  // the name/url/title joins reach — the evidence file names them outright.
  const found = findMatchDetails(details, {
    artist: "Gigi D'Agostino",
    title: 'lamour toujours',
    urls: ['https://example.test/lamour-toujours'],
  })
  const { sources, agree, dissent, notes } = consensusProvenance(index, {
    artist: "Gigi D'Agostino",
    title: 'lamour toujours',
    camelot: '10B',
    reporting: ['songkeyfinder'],
    urlFor: () => '',
    match: found,
  })
  assert.deepEqual(sources, [{
    id: 'songkeyfinder',
    key: '10B',
    url: 'https://example.test/lamour-toujours',
  }])
  assert.equal(agree, 1)
  assert.equal(dissent, 0)
  assert.equal(notes, 'Key agreed by 1 of 1 reporting sources.')
})

it('a row whose key no source accounts for is not attributable', () => {
  // The engine can accept a key no source of ours can be named for: three of its
  // cluster's records stated it, but none of them is this track in any listing
  // and there is no evidence record either. Such a row is not imported.
  const unattributable = consensusProvenance(index, {
    artist: '2Pac & Snoop Dogg',
    title: "2 Of Americaz Most Wanted (Lp)",
    camelot: '2A',
    reporting: ['camelotsound', 'hooktheory', 'karaoke_version', 'musicnotes'],
    urlFor: () => '',
  })
  assert.deepEqual(unattributable.sources, [])
  assert.equal(isAttributable(unattributable), false, 'dropped, not annotated')

  const attributable = consensusProvenance(index, {
    artist: 'Glee',
    title: 'Santa Baby',
    camelot: '3B',
    reporting: ['isolated_tracks'],
    urlFor: () => '',
  })
  assert.equal(isAttributable(attributable), true)
})

it('evidence for another key does not override the listings', () => {
  const found = findMatchDetails(details, {
    artist: "Gigi D'Agostino",
    title: 'lamour toujours',
    urls: ['https://example.test/lamour-toujours'],
  })
  // Details and dataset disagree about the key: the listings decide, and they
  // have nothing for this track — so nothing is credited, and the note says so
  // instead of claiming a conflict nobody stated.
  const { sources, agree, notes } = consensusProvenance(index, {
    artist: "Gigi D'Agostino",
    title: 'lamour toujours',
    camelot: '11A',
    reporting: ['songkeyfinder'],
    urlFor: () => '',
    match: found,
  })
  assert.deepEqual(sources, [])
  assert.equal(agree, 0)
  assert.match(notes, /No source listing accounts for this key/)
})

console.log(`\n${suite} tests passed`)
