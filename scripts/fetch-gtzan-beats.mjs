#!/usr/bin/env node
/**
 * Prepare a GTZAN-beats corpus for the benchmark.
 *
 * GTZAN is the one corpus where the published Beat This! checkpoints can be
 * scored honestly: the default `final0` weights were trained on Ballroom, SMC and
 * Harmonix, so a number on those corpora measures memorisation as much as
 * tracking. GTZAN is the authors' held-out set — see bench/README.md.
 *
 * What this downloads: the annotations only, from CPJKU's
 * `beat_this_annotations` repository, which is the annotation set the Beat This!
 * paper used. The audio is not downloadable from here, and pretending otherwise
 * would mean shipping a scraper for copyrighted recordings: GTZAN's audio is no
 * longer distributed by its authors. So `--audio` points at a copy you already
 * have, and the script lays the two halves out in the layout the benchmark
 * expects:
 *
 *   bench/corpus/gtzan/audio/<genre>/<name>.wav
 *   bench/corpus/gtzan/annotations/<name>.beats
 *
 * Without `--audio` it still downloads and reports the annotations, so the
 * coverage of the set is known before any audio is fetched.
 *
 * The archive is read directly (gzip + tar, both in Node's standard library) so
 * the script needs no unzip tool, no dependency, and works the same on Windows,
 * macOS and Linux.
 *
 * Usage:
 *   node scripts/fetch-gtzan-beats.mjs [--audio DIR] [--out DIR] [--tag v1.1] [--force]
 */

import { copyFileSync, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'
import { basename, dirname, join } from 'node:path'

const ANNOTATIONS_REPO = 'CPJKU/beat_this_annotations'

function parseArgs(argv) {
  const args = { audio: null, out: 'bench/corpus/gtzan', tag: 'v1.1', force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--audio') args.audio = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--tag') args.tag = argv[++i]
    else if (arg === '--force') args.force = true
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^#![^\n]*\n\/\*\*/, ''))
      process.exit(0)
    } else if (arg.startsWith('--')) {
      console.error(`unknown flag ${arg}`)
      process.exit(2)
    }
  }
  return args
}

/** Recursive listing of files under `root`, relative to it. */
function listFiles(root) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const name = prefix ? `${prefix}/${entry}` : entry
      if (statSync(full).isDirectory()) walk(full, name)
      else out.push(name)
    }
  }
  walk(root, '')
  return out
}

/**
 * Files from a gzipped tar, as `{ path, bytes }`.
 *
 * A tar is a sequence of 512-byte headers followed by that entry's bytes, padded
 * to 512 — small enough to parse without a dependency, and the only archive the
 * annotations are published in that every platform can read the same way.
 */
function readTarGz(buffer) {
  const tar = gunzipSync(buffer)
  const entries = []
  let at = 0
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512)
    // Two zero blocks end the archive.
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const type = String.fromCharCode(header[156] || 48)
    const path = prefix ? `${prefix}/${name}` : name
    const body = at + 512
    if (type === '0' || type === '\0' || header[156] === 0) {
      entries.push({ path, bytes: tar.subarray(body, body + size) })
    }
    at = body + Math.ceil(size / 512) * 512
  }
  return entries
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${url} -> HTTP ${response.status}`)
  mkdirSync(dirname(target), { recursive: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
  return response
}

/**
 * GTZAN's annotation names look like `gtzan_blues_00000`, its audio like
 * `blues.00000.wav`. Candidates are tried in order before falling back to a
 * normalised comparison, so an audio copy whose names differ only in punctuation
 * still matches.
 */
function audioCandidates(stem) {
  const stripped = stem.replace(/^gtzan[_-]?/, '')
  const dotted = stripped.replace(/_(\d{5})$/, '.$1')
  return [stem, stripped, dotted]
}

function normalise(stem) {
  return stem.replace(/^gtzan[_-]?/i, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outRoot = args.out
  const archive = join(outRoot, '.download', `annotations-${args.tag}.tar.gz`)
  const url = `https://codeload.github.com/${ANNOTATIONS_REPO}/tar.gz/refs/tags/${args.tag}`

  console.log(`GTZAN-beats preparation\n  annotations: ${ANNOTATIONS_REPO} ${args.tag}\n  output:      ${outRoot}`)
  if (!existsSync(archive) || args.force) {
    console.log(`  downloading ${url}`)
    await download(url, archive)
  }
  const entries = readTarGz(readFileSync(archive))
  const annotations = entries.filter(entry => /\/gtzan\/annotations\/beats\/[^/]+\.beats$/.test(entry.path))
  if (annotations.length === 0) throw new Error(`no gtzan annotations in ${archive}; the archive layout may have changed`)

  const annotationDir = join(outRoot, 'annotations')
  mkdirSync(annotationDir, { recursive: true })

  if (!args.audio) {
    for (const entry of annotations) {
      const stem = basename(entry.path).replace(/\.beats$/, '')
      writeFileSync(join(annotationDir, `${stem}.beats`), entry.bytes)
    }
    console.log(`  wrote ${annotations.length} annotation(s) to ${annotationDir}`)
    console.log(
      [
        '',
        'No --audio given, so only the annotations are in place.',
        'GTZAN audio is no longer distributed by its authors; point --audio at a copy you have',
        '(the set is 1000 x 30 s mono WAV named <genre>/<genre>.NNNNN.wav). Re-run with:',
        `  node scripts/fetch-gtzan-beats.mjs --audio <GTZAN audio root> --out ${outRoot}`,
      ].join('\n')
    )
    return
  }

  let audioFiles
  try {
    audioFiles = listFiles(args.audio).filter(name => /\.wav$/i.test(name))
  } catch {
    throw new Error(`--audio ${args.audio} is not a readable directory`)
  }
  if (audioFiles.length === 0) throw new Error(`no .wav files under ${args.audio}`)

  const byStem = new Map()
  const byNormalised = new Map()
  for (const name of audioFiles) {
    const stem = basename(name).replace(/\.wav$/i, '')
    byStem.set(stem, name)
    if (!byNormalised.has(normalise(stem))) byNormalised.set(normalise(stem), name)
  }

  const audioDir = join(outRoot, 'audio')
  mkdirSync(audioDir, { recursive: true })
  const unmatched = []
  let linked = 0
  for (const entry of annotations) {
    const stem = basename(entry.path).replace(/\.beats$/, '')
    let source = null
    for (const candidate of audioCandidates(stem)) {
      if (byStem.has(candidate)) {
        source = byStem.get(candidate)
        break
      }
    }
    if (!source) source = byNormalised.get(normalise(stem)) ?? null
    if (!source) {
      unmatched.push(stem)
      continue
    }
    const audioStem = basename(source).replace(/\.wav$/i, '')
    // The annotation is named after the audio the benchmark pairs it with: GTZAN
    // annotation stems carry a `gtzan_` prefix the audio does not have, and
    // `pairCorpusFiles` keys a track by the audio file's stem.
    writeFileSync(join(annotationDir, `${audioStem}.beats`), entry.bytes)
    const target = join(audioDir, source)
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target)) {
      // A hard link costs no space and no time; a copy is the fallback when the
      // audio lives on another volume.
      try {
        linkSync(join(args.audio, source), target)
      } catch {
        copyFileSync(join(args.audio, source), target)
      }
    }
    linked++
  }

  console.log(`  matched audio for ${linked}/${annotations.length} annotation(s)`)
  if (unmatched.length > 0) {
    console.log(`  ${unmatched.length} annotation(s) have no audio here, e.g. ${unmatched.slice(0, 3).join(', ')}`)
  }
  if (linked === 0) {
    console.error('\nno annotation found its audio — check that --audio points at the GTZAN audio root')
    process.exit(1)
  }
  console.log(`\ncorpus ready: node scripts/bench-beats.mjs --corpus ${outRoot} --trackers bench/trackers/out --no-gate`)
}

main().catch(error => {
  console.error(`fetch failed: ${error.message}`)
  process.exit(1)
})
