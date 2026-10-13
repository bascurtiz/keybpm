/** Shared DSP helpers for audio analysis. */

/** Iterative radix-2 FFT (in place, forward). */
export function makeFft(n: number) {
  const levels = Math.round(Math.log2(n))
  const cosT = new Float32Array(n / 2)
  const sinT = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n)
    sinT[i] = Math.sin((2 * Math.PI * i) / n)
  }
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1)
    rev[i] = r
  }
  return (re: Float32Array, im: Float32Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cosT[k]
          const s = sinT[k]
          const tre = re[j + half] * c + im[j + half] * s
          const tim = im[j + half] * c - re[j + half] * s
          re[j + half] = re[j] - tre
          im[j + half] = im[j] - tim
          re[j] += tre
          im[j] += tim
        }
      }
    }
  }
}

/** Downmix (a slice of) an AudioBuffer to mono, optionally decimated 2x. */
export function downmixMono(
  buffer: AudioBuffer,
  start: number,
  length: number,
  decimate: boolean
): Float32Array {
  const outLen = decimate ? Math.floor(length / 2) : length
  const mono = new Float32Array(outLen)
  const tmp = new Float32Array(length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    buffer.copyFromChannel(tmp, ch, start)
    if (decimate) {
      for (let i = 0; i < outLen; i++) {
        mono[i] += (tmp[2 * i] + tmp[2 * i + 1]) / (2 * buffer.numberOfChannels)
      }
    } else {
      for (let i = 0; i < outLen; i++) mono[i] += tmp[i] / buffer.numberOfChannels
    }
  }
  return mono
}

export function positiveMod(v: number, m: number): number {
  return ((v % m) + m) % m
}
