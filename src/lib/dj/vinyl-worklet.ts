/**
 * AudioWorklet source for vinyl-style playback.
 *
 * Plays the loaded buffer at an arbitrary *signed* rate with linear
 * interpolation, so the platter can drag the audio backward (scratching),
 * hold it still (silence), and release back to normal speed with a short
 * motor-like ramp.
 *
 * Positions are reported over the message port at display rate rather than at
 * render rate. The UI redraws at 60 Hz, so the old cadence of one report per
 * second render quantum — 187/s per deck at 48 kHz — was posting three times more
 * often than anything can use, and every one of those messages crosses the thread
 * boundary and runs a callback on the main thread, on the device least able to
 * spare either. The rate is set by the caller in the `load` message, so a hand-held
 * device can ask for 30 Hz (see `device-profile.ts`) without a second code path.
 *
 * Jumps in the read head — sync's bar alignment, a seek, a hot cue, a beat jump —
 * are rendered as a ~4 ms equal-power crossfade rather than stepped sample-to-sample.
 * A step is a discontinuity in the waveform and so a click, and sync is exactly when
 * a user is most likely to be listening to both decks at once: the bar alignment can
 * move the read head by most of a bar, which on a sustained bass note is a full-scale
 * step. The crossfade leaves the outgoing stream audible for those 4 ms and puts the
 * read head down at the end of it, so the jump is 4 ms late rather than a pop.
 */

let url: string | null = null

export function getVinylWorkletUrl(): string {
  if (!url) {
    url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }))
  }
  return url
}

const PROCESSOR_SOURCE = /* js */ `
/** Length of the crossfade that hides a read-head jump. */
const DECLICK_MS = 4;

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
    this.jump = null;         // { from, p, elapsed, fade, retarget } while a jump is fading
    this.jumpPending = null;  // target of a jump queued behind that fade
    this.postCounter = 0;
    // Reports per second, from the render quantum (128 frames, fixed by spec) and the
    // context's rate: ~60 Hz at 44.1 or 48 kHz.
    this.postEvery = Math.max(2, Math.round(sampleRate / (128 * 60)));
    this.lastPostS = -1;
    this.lastPostG = -1;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  slipEngaged() {
    return this.slipMode && this.playing && (this.scratching || this.loop !== null || this.cueHeld);
  }

  slipRelease() {
    if (this.slipMode && this.playing) {
      // Back to the ghost is a jump like any other, and a big one: declicked.
      this.jumpTo(this.ghost);
    }
  }

  onMessage(d) {
    switch (d.t) {
      case "load":
        this.channels = d.channels.map((b) => new Float32Array(b));
        this.length = d.length;
        this.bufferRate = d.rate;
        // Reports per second the caller can actually use; see the header note.
        if (d.hz > 0) this.postEvery = Math.max(1, Math.round(sampleRate / (128 * d.hz)));
        this.jump = null;
        this.jumpPending = null;
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
        this.rate = d.rate;
        this.endedSent = false;
        this.port.postMessage({
          t: "debug",
          event: "play-received",
          frame: currentFrame,
          rate: d.rate,
        });
        break;
      case "pause":
        this.playing = false;
        this.cueHeld = false;
        // A stopped platter has nothing to hide: land the pending jump instead of resuming
        // its crossfade on the next play.
        if (this.jump) {
          this.pos = Math.min(this.length - 1, Math.max(0, this.jump.p));
          this.jump = null;
        }
        if (this.jumpPending !== null) {
          this.pos = Math.min(this.length - 1, Math.max(0, this.jumpPending));
          this.jumpPending = null;
        }
        if (d.instant) {
          this.rate = 0;
        }
        this.port.postMessage({
          t: "debug",
          event: "pause-received",
          frame: currentFrame,
          playing: this.playing,
          instant: Boolean(d.instant),
        });
        break;
      case "rate":
        this.pitchRate = d.rate;
        break;
      case "seek":
        this.endedSent = false;
        this.jumpTo(d.s * this.bufferRate);
        break;
      case "slipCueOn": {
        if (!this.slipEngaged()) {
          this.ghost = this.pos;
        }
        this.cueHeld = true;
        this.endedSent = false;
        this.jumpTo(d.s * this.bufferRate);
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
        if (this.loop && this.loop.e > this.loop.s && (this.pos >= this.loop.e || this.pos < this.loop.s)) {
          const loopLen = this.loop.e - this.loop.s;
          const delta = Math.max(0, this.pos - this.loop.s);
          this.pos = this.loop.s + (delta % loopLen);
        }
        if (wasEngaged && !this.slipEngaged()) this.slipRelease();
        break;
      }
      case "slip":
        this.slipMode = d.on;
        if (!d.on) this.ghost = this.pos;
        break;
      case "shift": {
        // Relative to where the deck is *heading*: a shift that arrives while another jump is
        // fading has to compose with that jump's target, not with the position it is leaving.
        const base = this.jump ? this.jump.p : this.pos;
        this.jumpTo(base + d.s * this.bufferRate);
        break;
      }
    }
  }

  /**
   * Moves the read head, crossfading when there is audio to hide the step.
   *
   * A stopped or scratching deck has nothing to crossfade — it is silent or the platter is
   * under the user's hand — so the jump lands immediately there. A jump that arrives while
   * another is fading is queued and starts when that fade finishes, which keeps the outgoing
   * stream continuous instead of cutting it.
   */
  jumpTo(frames) {
    if (this.length <= 0) return;
    const target = Math.max(0, Math.min(frames, this.length - 1));
    if (!this.playing || this.rate === 0) {
      this.jump = null;
      this.pos = target;
      if (!this.slipEngaged()) this.ghost = this.pos;
      this.endedSent = false;
      return;
    }
    if (this.jump) {
      // Queued, not retargeted in place: the outgoing stream of this fade is the audio being
      // heard now, and the next fade has to start from wherever the deck has got to by then.
      this.jump.retarget = target;
      return;
    }
    this.startFade(target);
  }

  /** Begins a crossfade from the current read head to the target frame. */
  startFade(target) {
    this.jump = {
      from: this.pos,
      p: target,
      elapsed: 0,
      fade: Math.max(2, Math.round((DECLICK_MS / 1000) * sampleRate)),
      retarget: null,
    };
    this.endedSent = false;
  }

  postPosition() {
    if (++this.postCounter < this.postEvery) return;
    this.postCounter = 0;
    const s = Math.max(0, Math.min(this.pos, this.length - 1)) / this.bufferRate;
    const g = Math.max(0, Math.min(this.ghost, this.length - 1)) / this.bufferRate;
    // A stopped platter reports the same position every time. Waking the main thread
    // 60 times a second to say "still 42.5" is pure battery; a seek moves pos, and so
    // still gets through.
    if (s === this.lastPostS && g === this.lastPostG) return;
    this.lastPostS = s;
    this.lastPostG = g;
    this.port.postMessage({ t: "pos", s, g, f: currentFrame });
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
    let start = 0;

    // A jump queued behind the previous fade starts here, where the read head really is after
    // the rest of that quantum played on from it.
    if (!this.jump && this.jumpPending !== null) {
      const queued = this.jumpPending;
      this.jumpPending = null;
      if (this.playing && this.rate !== 0) this.startFade(queued);
      else this.jumpTo(queued);
    }

    // Equal-power crossfade over a read-head jump; see jumpTo and the header note.
    if (this.jump) {
      const jump = this.jump;
      while (start < frames && this.jump === jump) {
        const t = Math.min(1, jump.elapsed / jump.fade);
        const fadeOut = Math.cos((t * Math.PI) / 2);
        const fadeIn = Math.sin((t * Math.PI) / 2);

        if (this.loop && step > 0 && jump.from >= this.loop.e) {
          jump.from = this.loop.s + (jump.from - this.loop.e);
        }
        if (jump.from < 0) jump.from = 0;
        if (jump.from > this.length - 1) jump.from = this.length - 1;

        if (this.loop && step > 0 && jump.p >= this.loop.e) {
          jump.p = this.loop.s + (jump.p - this.loop.e);
        }
        if (jump.p < 0) jump.p = 0;
        if (jump.p > this.length - 1) jump.p = this.length - 1;

        const o0 = jump.from | 0;
        const o1 = o0 + 1 < this.length ? o0 + 1 : o0;
        const of = jump.from - o0;
        const n0 = jump.p | 0;
        const n1 = n0 + 1 < this.length ? n0 + 1 : n0;
        const nf = jump.p - n0;

        for (let c = 0; c < nch; c++) {
          const data = this.channels[c < this.channels.length ? c : this.channels.length - 1];
          const gone = data[o0] + (data[o1] - data[o0]) * of;
          const coming = data[n0] + (data[n1] - data[n0]) * nf;
          out[c][start] = gone * fadeOut + coming * fadeIn;
        }

        jump.from += step;
        jump.p += step;
        jump.elapsed++;
        start++;

        if (jump.elapsed >= jump.fade) {
          this.pos = Math.min(this.length - 1, Math.max(0, jump.p));
          this.jump = null;
        }
      }

      if (this.jump) {
        // Out of samples before the fade finished; the next quantum carries on.
        this.postPosition();
        return true;
      }
      if (jump.retarget !== null) this.jumpPending = jump.retarget;
    }

    for (let i = start; i < frames; i++) {
      if (this.loop && step > 0 && this.pos >= this.loop.e) {
        const loopLen = this.loop.e - this.loop.s;
        if (loopLen > 0) {
          const delta = this.pos - this.loop.s;
          this.pos = this.loop.s + (delta % loopLen);
        } else {
          this.pos = this.loop.s;
        }
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
