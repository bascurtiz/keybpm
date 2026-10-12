/**
 * Constant-Q Transform (CQT) preprocessor in pure TypeScript / JavaScript.
 *
 * Implements the exact recursive sub-sampling / multi-octave filterbank CQT
 * as computed by `librosa.cqt` for MusicalKeyCNN:
 *   - sr = 44100
 *   - hop_length = 11025
 *   - n_bins = 136
 *   - bins_per_octave = 24
 *   - fmin = 40 Hz
 *   - filter_scale = 1, norm = 1, window = 'hann'
 *   - log-magnitude: log1p(|CQT|)
 *
 * Precomputed sparse filter banks are loaded from `/model/cqt_filters.json`
 * (compressed to ~41 KB), matching librosa 0.11.0 filter responses bit-for-bit.
 */

export interface CqtFilterOctave {
  n_fft: number
  n_filters: number
  indptr: number[]
  indices: number[]
  data_real: number[]
  data_imag: number[]
}

export interface CqtFilterData {
  sr: number
  hop_length: number
  n_bins: number
  lengths: number[]
  octaves: CqtFilterOctave[]
}

let cachedFilterData: CqtFilterData | null = null

/**
 * Fetch and cache the precomputed CQT filter bank parameters.
 */
export async function loadCqtFilters(baseUrl = ''): Promise<CqtFilterData> {
  if (cachedFilterData) return cachedFilterData
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const url = `${cleanBase}/model/cqt_filters.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load CQT filter definitions from ${url}: ${res.statusText}`)
  }
  const data = (await res.json()) as CqtFilterData
  cachedFilterData = data
  return data
}

/**
 * Radix-2 Cooley-Tukey Real-input FFT.
 *
 * Takes a real input array of length `n_fft` (must be a power of 2)
 * and returns the first `n_fft / 2 + 1` complex frequency bins (rfft).
 */
export class FastRfft {
  readonly n: number
  readonly half: number
  private readonly bitRev: Uint32Array
  private readonly cosTable: Float64Array
  private readonly sinTable: Float64Array
  private readonly xr: Float64Array
  private readonly xi: Float64Array

  constructor(n: number) {
    this.n = n
    this.half = n >> 1
    this.bitRev = new Uint32Array(n)
    this.xr = new Float64Array(n)
    this.xi = new Float64Array(n)

    // Precompute bit reversal
    let j = 0
    for (let i = 0; i < n; i++) {
      this.bitRev[i] = j
      let m = n >> 1
      while (m >= 1 && j >= m) {
        j -= m
        m >>= 1
      }
      j += m
    }

    // Precompute twiddle factor tables for each stage length
    this.cosTable = new Float64Array(n)
    this.sinTable = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const angle = (-2.0 * Math.PI * i) / n
      this.cosTable[i] = Math.cos(angle)
      this.sinTable[i] = Math.sin(angle)
    }
  }

  /**
   * Run forward real FFT on audio segment `sig`.
   * Outputs real and imaginary parts into provided float arrays `outReal` and `outImag`.
   */
  transform(sig: Float32Array | Float64Array, outReal: Float32Array, outImag: Float32Array): void {
    const n = this.n
    const xr = this.xr
    const xi = this.xi
    const bitRev = this.bitRev

    // Bit-reverse copy real input, zero out imaginary part
    const sigLen = sig.length
    for (let i = 0; i < n; i++) {
      const rev = bitRev[i]
      xr[rev] = i < sigLen ? sig[i] : 0.0
      xi[rev] = 0.0
    }

    // Cooley-Tukey butterflies
    for (let length = 2; length <= n; length <<= 1) {
      const half = length >> 1
      const step = n / length

      for (let i = 0; i < n; i += length) {
        let twiddleIdx = 0
        for (let k = 0; k < half; k++) {
          const w_r = this.cosTable[twiddleIdx]
          const w_i = this.sinTable[twiddleIdx]
          twiddleIdx += step

          const ik = i + k
          const ikh = ik + half

          const vr = xr[ikh] * w_r - xi[ikh] * w_i
          const vi = xr[ikh] * w_i + xi[ikh] * w_r

          const ur = xr[ik]
          const ui = xi[ik]

          xr[ik] = ur + vr
          xi[ik] = ui + vi
          xr[ikh] = ur - vr
          xi[ikh] = ui - vi
        }
      }
    }

    // Copy the first half + 1 bins (Hermitian symmetry for real signals)
    const outBins = this.half + 1
    for (let k = 0; k < outBins; k++) {
      outReal[k] = xr[k]
      outImag[k] = xi[k]
    }
  }
}

const rfftCache = new Map<number, FastRfft>()

function getRfft(n: number): FastRfft {
  let inst = rfftCache.get(n)
  if (!inst) {
    inst = new FastRfft(n)
    rfftCache.set(n, inst)
  }
  return inst
}

/**
 * Compute the CQT log-magnitude spectrogram for a mono audio buffer at 44100 Hz.
 *
 * @param audio Mono audio samples at sr=44100
 * @param filterData Precomputed filter bank definition
 * @param onProgress Optional callback (progress: 0.0 to 1.0)
 * @returns 2D Float32Array with shape [136, n_frames] flattened in row-major order:
 *          index = (bin * n_frames) + frame
 */
export async function computeCqt(
  audio: Float32Array,
  filterData: CqtFilterData,
  onProgress?: (ratio: number) => void,
): Promise<{ data: Float32Array; nBins: number; nFrames: number }> {
  const { hop_length, n_bins, lengths, octaves } = filterData
  const audioLen = audio.length

  // Calculate number of frames matching librosa centered STFT
  // pad_width for each octave STFT is n_fft // 2, so n_frames is:
  // 1 + Math.floor(audioLen / hop_length)
  const nFrames = Math.max(1, 1 + Math.floor(audioLen / hop_length))

  // Output storage: n_bins x nFrames
  const output = new Float32Array(n_bins * nFrames)

  // Precompute normalization scale: 1 / sqrt(lengths[b])
  const normScale = new Float32Array(n_bins)
  for (let b = 0; b < n_bins; b++) {
    normScale[b] = 1.0 / Math.sqrt(lengths[b])
  }

  // Iterate down the 6 octaves:
  // Octave 0..4 have 24 bins each (24 * 5 = 120 bins), Octave 5 has 16 bins (136 total).
  // In librosa:
  // Octave 0 is the highest frequencies (bins 112..135),
  // Octave 5 is the lowest frequencies (bins 0..15).
  let binEnd = n_bins // 136

  for (let octIdx = 0; octIdx < octaves.length; octIdx++) {
    const oct = octaves[octIdx]
    const nFft = oct.n_fft
    const nFilters = oct.n_filters
    const padWidth = nFft >> 1

    const fft = getRfft(nFft)
    const frameBuffer = new Float32Array(nFft)
    const fftReal = new Float32Array(padWidth + 1)
    const fftImag = new Float32Array(padWidth + 1)

    // Range in global bins:
    // Highest octave occupies [binEnd - nFilters, binEnd]
    const binStart = binEnd - nFilters

    // Process each frame across the audio
    for (let f = 0; f < nFrames; f++) {
      const center = f * hop_length
      const segStart = center - padWidth
      const segEnd = segStart + nFft

      // Extract window with zero-padding (matching 'constant' pad mode)
      frameBuffer.fill(0)
      const srcStart = Math.max(0, segStart)
      const srcEnd = Math.min(audioLen, segEnd)
      if (srcEnd > srcStart) {
        const dstStart = srcStart - segStart
        frameBuffer.set(audio.subarray(srcStart, srcEnd), dstStart)
      }

      // Compute RFFT
      fft.transform(frameBuffer, fftReal, fftImag)

      // Sparse matrix multiplication: oct_basis * STFT_frame
      // row r corresponds to bin: binStart + r
      for (let r = 0; r < nFilters; r++) {
        const rowStart = oct.indptr[r]
        const rowEnd = oct.indptr[r + 1]

        let sumReal = 0.0
        let sumImag = 0.0

        for (let idx = rowStart; idx < rowEnd; idx++) {
          const col = oct.indices[idx]
          const br = oct.data_real[idx]
          const bi = oct.data_imag[idx]

          const dr = fftReal[col]
          const di = fftImag[col]

          // Complex multiplication: (br + j*bi) * (dr + j*di)
          sumReal += br * dr - bi * di
          sumImag += br * di + bi * dr
        }

        // Magnitude: |CQT| = sqrt(sumReal^2 + sumImag^2)
        const mag = Math.sqrt(sumReal * sumReal + sumImag * sumImag)
        const globalBin = binStart + r

        // Normalize and apply log1p
        const normalized = mag * normScale[globalBin]
        const logVal = Math.log1p(normalized)

        output[globalBin * nFrames + f] = logVal
      }
    }

    binEnd -= nFilters

    if (onProgress) {
      onProgress((octIdx + 1) / octaves.length)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  return { data: output, nBins: n_bins, nFrames }
}
