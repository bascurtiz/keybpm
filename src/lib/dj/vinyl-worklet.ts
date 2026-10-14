/**
 * AudioWorklet source for vinyl-style playback.
 *
 * Plays the loaded buffer at an arbitrary *signed* rate with linear
 * interpolation, so the platter can drag the audio backward (scratching),
 * hold it still (silence), and release back to normal speed with a short
 * motor-like ramp.
 */

let url: string | null = null

export function getVinylWorkletUrl(): string {
  if (!url) {
    url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }))
  }
  return url
}

const PROCESSOR_SOURCE = /* js */ `
class VinylPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;     // Float32Array per channel
    this.length = 0;          // frames in the buffer
    this.bufferRate = sampleRate;
    this.pos = 0;             // playhead in buffer frames (float)
    this.playing = false;
    this.scratching = false;
    this.pitchRate = 1;       // rate from the pitch fader
    this.scratchRate = 0;     // signed rate from the platter
    this.rate = 0;            // smoothed actual rate
    this.loop = null;         // { s, e } in buffer frames
    this.cueHeld = false;
    this.slipMode = false;
    this.ghost = 0;           // slip ghost playhead (buffer frames)
    this.endedSent = false;
    this.postCounter = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  slipEngaged() {
    return this.slipMode && this.playing && (this.scratching || this.loop !== null || this.cueHeld);
  }

  slipRelease() {
    if (this.slipMode && this.playing) {
      this.pos = Math.max(0, Math.min(this.ghost, this.length - 1));
    }
  }

  onMessage(d) {
    switch (d.t) {
      case "load":
        this.channels = d.channels.map((b) => new Float32Array(b));
        this.length = d.length;
        this.bufferRate = d.rate;
        this.pos = Math.max(0, Math.min((d.initialSec || 0) * this.bufferRate, this.length - 1));
        this.ghost = this.pos;
        this.playing = false;
        this.scratching = false;
        this.rate = 0;
        this.scratchRate = 0;
        this.loop = null;
        this.cueHeld = false;
        this.endedSent = false;
        break;
      case "play":
        this.playing = true;
        this.pitchRate = d.rate;
        this.endedSent = false;
        break;
      case "pause":
        this.playing = false;
        this.cueHeld = false;
        break;
      case "rate":
        this.pitchRate = d.rate;
        break;
      case "seek":
        this.pos = Math.max(0, Math.min(d.s * this.bufferRate, this.length - 1));
        if (!this.slipEngaged()) this.ghost = this.pos;
        this.endedSent = false;
        break;
      case "slipCueOn": {
        if (!this.slipEngaged()) {
          this.ghost = this.pos;
        }
        this.cueHeld = true;
        this.pos = Math.max(0, Math.min(d.s * this.bufferRate, this.length - 1));
        this.endedSent = false;
        break;
      }
      case "slipCueOff": {
        const wasEngaged = this.slipEngaged();
        this.cueHeld = false;
        if (wasEngaged && !this.slipEngaged()) this.slipRelease();
        this.endedSent = false;
        break;
      }
      case "scratchOn":
        this.scratching = true;
        this.scratchRate = 0;
        break;
      case "scratchRate":
        this.scratchRate = d.rate;
        break;
      case "scratchOff": {
        const wasEngaged = this.slipEngaged();
        this.scratching = false;
        if (wasEngaged && !this.slipEngaged()) this.slipRelease();
        this.endedSent = false;
        break;
      }
      case "loop": {
        const wasEngaged = this.slipEngaged();
        this.loop = d.loop
          ? { s: d.loop.start * this.bufferRate, e: d.loop.end * this.bufferRate }
          : null;
        if (wasEngaged && !this.slipEngaged()) this.slipRelease();
        break;
      }
      case "slip":
        this.slipMode = d.on;
        if (!d.on) this.ghost = this.pos;
        break;
      case "shift":
        this.pos = Math.max(0, Math.min(this.pos + d.s * this.bufferRate, this.length - 1));
        if (!this.slipEngaged()) this.ghost = this.pos;
        break;
    }
  }

  postPosition() {
    if (++this.postCounter >= 2) {
      this.postCounter = 0;
      const s = Math.max(0, Math.min(this.pos, this.length - 1)) / this.bufferRate;
      const g = Math.max(0, Math.min(this.ghost, this.length - 1)) / this.bufferRate;
      this.port.postMessage({ t: "pos", s, g, f: currentFrame });
    }
  }

  process(inputs, outputs) {
    if (!this.channels || this.length === 0) return true;

    const target = this.scratching ? this.scratchRate : this.playing ? this.pitchRate : 0;
    const k = this.scratching ? 0.55 : 0.18;
    this.rate += (target - this.rate) * k;
    if (target === 0 && Math.abs(this.rate) < 0.0005) this.rate = 0;

    const quantum = outputs[0][0].length;
    if (this.slipEngaged()) {
      this.ghost += (this.pitchRate * this.bufferRate * quantum) / sampleRate;
      if (this.ghost > this.length - 1) this.ghost = this.length - 1;
    } else {
      this.ghost = this.pos;
    }

    if (this.rate === 0) {
      this.postPosition();
      return true;
    }

    const out = outputs[0];
    const frames = out[0].length;
    const nch = out.length;
    const step = (this.rate * this.bufferRate) / sampleRate;

    for (let i = 0; i < frames; i++) {
      if (this.loop && step > 0 && this.pos >= this.loop.e) {
        this.pos = this.loop.s + (this.pos - this.loop.e);
      }
      if (this.pos < 0) this.pos = 0;
      if (this.pos > this.length - 1) this.pos = this.length - 1;
      const i0 = this.pos | 0;
      const i1 = i0 + 1 < this.length ? i0 + 1 : i0;
      const frac = this.pos - i0;
      for (let c = 0; c < nch; c++) {
        const data = this.channels[c < this.channels.length ? c : this.channels.length - 1];
        out[c][i] = data[i0] + (data[i1] - data[i0]) * frac;
      }
      this.pos += step;
    }

    if (
      !this.loop &&
      this.playing &&
      !this.scratching &&
      step > 0 &&
      this.pos >= this.length - 1 &&
      !this.endedSent
    ) {
      this.endedSent = true;
      this.playing = false;
      this.port.postMessage({ t: "ended" });
    }

    this.postPosition();
    return true;
  }
}

registerProcessor("vinyl-player", VinylPlayer);
`
