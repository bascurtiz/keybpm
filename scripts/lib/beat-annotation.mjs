/**
 * Corpus I/O for the beat benchmark: WAV decoding and beat-annotation parsing.
 *
 * Annotated beat corpora (Ballroom, SMC, Harmonix, GTZAN-beats) ship WAV audio
 * plus a plain-text beat list, so this reads the two formats those datasets
 * actually use and nothing else. No audio dependency: the harness must run in CI
 * and on a machine with no network.
 */

/**
 * Decodes a RIFF/WAVE file to planar Float32.
 *
 * Handles the two encodings real corpora use: integer PCM (16/24/32-bit) and
 * 32-bit IEEE float. Chunk walking (rather than fixed offsets) is deliberate:
 * dataset WAVs carry LIST/INFO metadata before `data`, and reading `data` at a
 * fixed offset silently returns metadata bytes as audio.
 */
export function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = offset =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') throw new Error('not a WAV file')

  let format = 1
  let channels = 1
  let sampleRate = 44100
  let bitDepth = 16
  let dataOffset = -1
  let dataBytes = 0

  let at = 12
  while (at + 8 <= bytes.length) {
    const id = ascii(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitDepth = view.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 40) {
        // WAVE_FORMAT_EXTENSIBLE: the real format lives in the first two bytes of
        // the sub-format GUID.
        format = view.getUint16(body + 24, true)
      }
    } else if (id === 'data') {
      dataOffset = body
      dataBytes = Math.min(size, bytes.length - body)
    }
    at = body + size + (size % 2)
  }

  if (dataOffset < 0) throw new Error('WAV has no data chunk')
  const bytesPerSample = Math.ceil(bitDepth / 8)
  const frames = Math.floor(dataBytes / (bytesPerSample * channels))
  const planar = []
  for (let channel = 0; channel < channels; channel++) planar.push(new Float32Array(frames))

  const readSample = offset => {
    if (format === 3 && bitDepth === 32) return view.getFloat32(offset, true)
    if (bitDepth === 16) return view.getInt16(offset, true) / 32768
    if (bitDepth === 24) {
      const b0 = view.getUint8(offset)
      const b1 = view.getUint8(offset + 1)
      const b2 = view.getUint8(offset + 2)
      let value = (b2 << 16) | (b1 << 8) | b0
      if (value & 0x800000) value |= -16777216
      return value / 8388608
    }
    if (bitDepth === 32) return view.getInt32(offset, true) / 2147483648
    throw new Error(`unsupported WAV bit depth ${bitDepth} (format ${format})`)
  }

  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = dataOffset + (frame * channels + channel) * bytesPerSample
      planar[channel][frame] = readSample(offset)
    }
  }
  return { sampleRate, channels: planar, length: frames }
}

/**
 * Beat times from an annotation file, in seconds, ascending.
 *
 * Accepts the plain "one time per line" layout (Ballroom `.beats`, mir_eval
 * reference beat files) and the "time beat-number" two-column variant; ignores
 * blank lines and `#` comments; tolerates a stray CRLF. A `.beats` file may also
 * carry a tempo on a `# tempo` comment line, which is ignored here — the tempo is
 * re-derived from the annotation so the harness never mixes its own reference.
 */
export function parseBeatAnnotation(text) {
  const times = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const first = line.split(/[\s,;]+/)[0]
    const value = Number(first)
    if (Number.isFinite(value) && value >= 0) times.push(value)
  }
  times.sort((a, b) => a - b)
  return times
}

/**
 * Pairs audio files with their annotations in a corpus directory.
 *
 * Layout A (one flat directory): `name.wav` + `name.beats`.
 * Layout B (Ballroom/SMC style): `audio/*.wav` + `annotations/*.beats`.
 * Layout C: a Ballroom download folder where the annotation is
 * `annotations/*.beats` and audio is `*.wav` — same as A and B combined.
 *
 * Returns `{ pairs, missing }` so the caller can fail loudly instead of silently
 * benchmarking three tracks out of a hundred.
 */
export function pairCorpusFiles(listing) {
  const audio = listing.filter(name => /\.(wav|WAV)$/.test(name))
  const annotations = listing.filter(name => /\.(beats|txt|bpm)$/i.test(name))
  const byBase = new Map()
  for (const name of audio) {
    const base = name.replace(/^.*\//, '').replace(/\.(wav|WAV)$/, '')
    byBase.set(base, { base, audio: name })
  }
  for (const name of annotations) {
    const base = name.replace(/^.*\//, '').replace(/\.(beats|txt|bpm)$/i, '')
    const entry = byBase.get(base)
    if (entry) entry.annotation = name
  }
  const pairs = [...byBase.values()].filter(entry => entry.annotation)
  const missing = [...byBase.values()].filter(entry => !entry.annotation).map(entry => entry.base)
  return { pairs, missing }
}
