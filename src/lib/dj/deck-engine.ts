import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import { createRubberBandNode, type RubberBandNode } from './rubberband-node'
import { measureLevel, TARGET_RMS } from './autogain'
import {
  audiblePosition as audiblePositionOf,
  keyLockLatencySeconds as keyLockLatencyOf,
  keyLockTransform,
  type KeyLockEngine,
} from './keylock-transform'
import { HOT_CUE_COUNT, type BeatGrid, type FxType, type LoopRegion, type Track } from './types'
import {
  barLengthAt,
  barPhaseAt,
  beatIndexAt,
  beatLengthAt,
  beatTimeAt,
  bpmAt,
  collapseGridToConstant,
  isVariableGrid,
  normalizeGrid,
  reanchorBar,
  scaleGridBeats,
  shiftBars,
  shiftGridBeats,
  snapToBeat as snapToGridBeat,
} from './grid'

/**
 * Which realtime engine holds the key. Defined with the keylock maths so that module can
 * name the engine it is reasoning about; re-exported here, where callers look for it.
 */
export type { KeyLockEngine }

/**
 * How long a deck will play dry while a newly selected Rubber Band engine settles.
 * The output tap normally resolves this in a few hundred ms; the cap is what stops
 * a deck that happens to be silent at the moment of the switch from waiting forever.
 */
const RB_KEYLOCK_KERNEL_TIMEOUT_MS = 1500

/** How often the output tap is read while waiting for the engine. */
const RB_KEYLOCK_PROBE_INTERVAL_MS = 20

/** Peak sample that counts as "this engine is producing audio". */
const RB_KEYLOCK_SIGNAL_FLOOR = 1e-3

/**
 * Consecutive polls of real signal required before the wet path is engaged. One is
 * not enough: a kernel that is still building can emit a burst and then starve
 * again. Both voices are fed from the moment they exist, so by the time the engine
 * is selected the audible one has been producing audio all along and this resolves
 * in a couple of polls.
 */
const RB_KEYLOCK_READY_STREAK = 3

/**
 * A Rubber Band keylock voice: one realtime kernel plus the tap and gain that let it
 * be checked and faded. A deck keeps {@link RB_VOICE_COUNT} of them; see
 * {@link DeckEngine.setKeyLockEngine} for why.
 */
interface RubberBandVoice {
  node: RubberBandNode
  /** Taps this voice so the deck can tell whether it is producing audio right now. */
  probe: AnalyserNode
  /** Crossfade weight into the wet keylock bus. */
  gain: GainNode
  /** The ratio this kernel was last tuned to. */
  pitch: number
}

/** Audible voice plus a second one, tuned and primed ready for the next ratio change. */
const RB_VOICE_COUNT = 2

/**
 * A Rubber Band keylock voice is expensive (this machine sustains about six of them at 48 kHz
 * before the render thread stops keeping up), so a deck keeps only the audible one while
 * SoundTouch holds the key and creates the spare when Rubber Band is selected.
 */
const RB_SPARE_VOICE = 1

/**
 * An idle voice is held at this rather than 0: inaudible (-80 dB, below the deck's own
 * noise), but it keeps the voice in the render graph so its kernel stays primed and a
 * handover never has to wait for one to be built or re-fed from cold.
 */
const RB_IDLE_VOICE_GAIN = 1e-4

/**
 * Retune a voice only once the audible key is this far out. Below it the difference is
 * inaudible, and skipping it is what stops a resting deck from churning voices.
 */
const RB_KEYLOCK_SWAP_CENTS = 8

/**
 * A retuned kernel emits a last burst of its *old* ratio (measured ~20 ms), then goes
 * silent for ~100 ms while it re-primes, then settles on the new one. A handover waits
 * for that hole and for signal to come back through it, which is what makes a ratio
 * change inaudible instead of a click into silence.
 */
const RB_KEYLOCK_PRIME_STREAK = 4

/** Cap on that wait, so a voice that never goes quiet cannot block a handover forever. */
const RB_KEYLOCK_PRIME_TIMEOUT_MS = 700

/** How long a handover takes to fade from one voice to the other. */
const RB_KEYLOCK_FADE_S = 0.008

/** Cost of a handover, used to aim a retune at where a moving fader is heading. */
const RB_KEYLOCK_PRIME_LEAD_MS = 170

/**
 * How long the aim trusts a slew estimate after the last change to the wanted ratio.
 * Without this a fader that stopped would keep steering handovers past its own value.
 */
const RB_KEYLOCK_VELOCITY_DECAY_S = 0.25

/** Ceiling on that aim, so one abrupt jump cannot throw a handover a semitone away. */
const RB_KEYLOCK_AIM_MAX_CENTS = 40

/** Once the fader has been still this long, the key is worth one more handover. */
const RB_KEYLOCK_SETTLE_MS = 350

/** ...and "exact" then means within this, which is what a resting deck should hold. */
const RB_KEYLOCK_SETTLE_CENTS = 2

interface WorkletMessage {
  t: string
  s?: number
  g?: number
  f?: number
}

/**
 * Deck audio graph:
 * vinyl worklet -> [KeyLock Stage (SoundTouch / Rubber Band / Bypass)] ->
 * autoGain -> trim -> 3-band EQ -> filter -> channel fader -> crossfader -> master.
 *
 * KEYLOCK:
 * Keylock (Master Tempo) preserves original pitch when tempo/playbackRate changes.
 * The vinyl worklet does the resampling, so the keylock stage is a pure pitch
 * shift of an already-time-compressed stream. Both engines are realtime
 * AudioWorklets — nothing here needs an offline render — and both are wired up:
 *
 *  - SoundTouch is the live default, because a deck changes pitch constantly
 *    (fader, nudge, sync PLL, key shift) and its pitch is an AudioParam, so those
 *    changes ramp smoothly. Measured on a 220 Hz tone at 1.30x it lands 1.1
 *    cents high.
 *  - Rubber Band's RealtimeRubberBand kernel is the accurate one — 0 cents on the
 *    same tone, exact on a key shift — but its WASM binding calls `reset()` before
 *    it applies any new ratio, so a `setPitch` on a kernel that is being heard
 *    flushes its stretch pipeline: measured ~20 ms of the old ratio, ~100 ms of
 *    silence, then an unsettled tail, then exact pitch. A single kernel therefore
 *    cannot follow a fader (a sweep measured silent in 95 % of 10 ms windows, and
 *    0 cents only once the fader stopped).
 *
 *    So a deck keeps two of them. The audible voice is never retuned: a new ratio is
 *    prepared on the idle voice and faded in once that voice is producing audio again
 *    (`RB_KEYLOCK_SWAP_CENTS` decides when a change is big enough to be worth it), and
 *    the retune is aimed at where a moving fader is heading. Measured through the real
 *    deck over a 3 s, 8 % sweep: 0 silent windows out of 304, the key held to a median of
 *    7.7 cents while the fader moved, and under 2.5 cents once it stopped.
 *
 * When active, pitch is compensated proportionally (1 / rate) to lock key.
 * When keyShift is adjusted, pitch is transposed by +/- 12 semitones.
 * When scratching, bypassing or rate == 1.0, clean direct path is used.
 */

/**
 * The SCR cutter is a *recorded* drum loop rather than a synthesis: the button
 * fires `public/sounds/cutter.audio` (a copy of "Phat Drum 1.wav") once, at the
 * deck's tempo, so the chop stays in time with the music instead of drifting
 * against it. See {@link DeckEngine.triggerCutter}.
 */

/** Tempo the cutter loop was recorded at; `playbackRate` = deck tempo / this. */
const CUTTER_SAMPLE_BPM = 120

/**
 * Level of the chop relative to the track it is scratching over. `1` puts the
 * chop at the same RMS as the auto-gained track; lower values tuck it under.
 * This is the one number to turn if the chop reads too loud or too quiet
 * across the board — see {@link DeckEngine.cutterLevel}.
 */
const CUTTER_TRACK_LEVEL = 1

/**
 * Used only when the track or the sample has no measured loudness (a buffer too
 * short to analyse, or a track loaded from a cache written before loudness was
 * recorded). Roughly what `CUTTER_TRACK_LEVEL` resolves to on typical material.
 */
const CUTTER_LEVEL_FALLBACK = 1.4

/** Guard rails on the derived level, so a mis-measured buffer can't blow up the mix. */
const CUTTER_GAIN_MIN = 0.25
const CUTTER_GAIN_MAX = 4

/**
 * Rate clamps. The deck's 20–300 BPM range maps to 0.17–2.5x; these keep a
 * mis-detected tempo from turning the chop into a squeak or a sub-bass crawl.
 */
const CUTTER_MIN_RATE = 0.5
const CUTTER_MAX_RATE = 2

/**
 * A re-press restarts the chop, and the outgoing one is faded over this instead
 * of being cut dead — a hard `stop()` mid-waveform clicks.
 */
const CUTTER_RETRIGGER_FADE_S = 0.008

/**
 * Pressing this close to a grid beat counts as "on the beat" and fires at once,
 * rather than waiting a whole beat. Matches the hot-cue quantiser's window.
 */
const CUTTER_QUANT_GRACE_S = 0.035

/**
 * Cap on the output-latency allowance added to that window. A driver that
 * reports something absurd should not be able to swallow half a beat.
 */
const CUTTER_MAX_LATENCY_ALLOWANCE_S = 0.08

/** A chop, either already sounding or scheduled for the next grid beat. */
type CutterVoice = {
  source: AudioBufferSourceNode
  gain: GainNode
  /** Context time the source will sound at. */
  startAt: number
}

export class DeckEngine {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode

  private readonly autoGain: GainNode
  private readonly trim: GainNode
  private readonly eqLow: BiquadFilterNode
  private readonly eqMid: BiquadFilterNode
  private readonly eqHigh: BiquadFilterNode
  private readonly filter: BiquadFilterNode
  private readonly fader: GainNode
  private readonly xfade: GainNode

  // KeyLock / Master Tempo nodes
  private _keyLock = true
  private _keyLockEngine: KeyLockEngine = 'soundtouch'
  private stNode: SoundTouchNode | null = null
  /** Rubber Band voices, one audible and one kept primed for the next ratio change. */
  private rbVoices: RubberBandVoice[] = []
  /** Index into {@link rbVoices} of the voice currently feeding the wet bus. */
  private rbAudibleVoice = 0
  /** Non-null while an idle voice is being retuned for a handover. */
  private rbHandover: {
    index: number
    tunedAt: number
    sawSilence: boolean
    streak: number
  } | null = null
  private rbHandoverTimer: number | null = null
  /** The ratio the deck wants right now, in the audible voice's units. */
  private rbTargetPitch = 1
  /** Recent slew of that target in cents per second, used to aim a retune ahead of it. */
  private rbPitchVelocity = 0
  /** When the wanted ratio last actually changed, which is how "the fader is still" is read. */
  private rbTargetChangedAt = 0
  private rbSettleTimer: number | null = null
  private readonly rbProbeBuffer = new Float32Array(256)
  private readonly keyLockDryGain: GainNode
  private readonly keyLockWetGain: GainNode
  /** True while the deck plays dry, waiting for a newly selected engine to wake. */
  private keyLockAwaitingKernel = false
  private keyLockKernelTimer: number | null = null
  /** True while the wet keylock path is actually carrying the audio. */
  private _keyLockActive = false

  // Continuous Zero-Drift Sync Lock (PLL)
  private _syncLocked = false
  private _syncTargetDeck: DeckEngine | null = null
  private _pllCorrection = 1.0

  // FX sends (post-filter, pre-fader)
  private readonly echoSend: GainNode
  private readonly echoDelay: DelayNode
  private readonly echoFeedback: GainNode
  private readonly echoWet: GainNode
  private readonly reverbSend: GainNode
  private readonly reverb: ConvolverNode
  private readonly reverbWet: GainNode
  private readonly flangerSend: GainNode
  private readonly flangerDelay: DelayNode
  private readonly flangerFeedback: GainNode
  private readonly flangerWet: GainNode

  private _fxType: FxType = 'off'
  private _fxWet = 0.5
  private _fxBeats = 0.5
  private _slipMode = false

  // ----- SCR cutter sample -----
  /**
   * Bus the chop enters the channel strip on. Tapped in ahead of the EQ so the
   * chop is shaped by the same EQ / filter / fader / crossfader as the track,
   * but after autoGain/trim: those two nodes belong to the *track's* level, and
   * the chop is a separate recording with its own loudness, so it normalises
   * itself instead ({@link DeckEngine.cutterLevel}) rather than riding the
   * track's gain — which would scale the chop by however much that particular
   * track happened to need, and bury it under a loud one.
   */
  private readonly cutterGain: GainNode
  /** Decoded cutter loop, kept for the session. */
  private cutterBuffer: AudioBuffer | null = null
  /** Loudness of the loop, measured once on decode. See {@link cutterLevel}. */
  private cutterLoudness: number | null = null
  /** In-flight fetch/decode, so a double-press does not decode the file twice. */
  private cutterLoad: Promise<AudioBuffer | null> | null = null
  /**
   * The chop currently sounding — or, under QUANT, the one already scheduled for
   * the next grid beat. `startAt` is the context time it will sound at, which is
   * what tells a re-press whether to fade it out or cancel it outright.
   */
  private cutterVoice: CutterVoice | null = null
  /**
   * Top-level Master Tempo, mirrored here by {@link AudioEngine.setMasterBpm}.
   * The cutter follows this deck's own tempo first (see
   * {@link DeckEngine.cutterPlaybackRate}); this is the fallback for a deck that
   * has no track of its own to read a tempo from.
   */
  private _masterBpm = 128

  private vinylNode: AudioWorkletNode | null = null
  private pendingMessages: { msg: unknown; transfer?: Transferable[] }[] = []

  track: Track | null = null
  hotCues: (number | null)[] = Array(HOT_CUE_COUNT).fill(null)
  cuePoint = 0
  loop: LoopRegion | null = null

  // Snap & Quantize modes (Default ON as required for DJ performance)
  snapMode = true
  quantMode = true
  private quantizeTimer: number | null = null
  private pendingQuantizedCue: number | null = null
  private pendingQuantizedIndex: number | null = null

  get isWaitingQuantizedCue(): boolean {
    return this.pendingQuantizedCue !== null
  }

  get waitingCueIndex(): number | null {
    return this.pendingQuantizedIndex
  }

  setSnapMode(on: boolean) {
    this.snapMode = on
    this.emit()
  }

  toggleSnapMode() {
    this.setSnapMode(!this.snapMode)
  }

  setQuantMode(on: boolean) {
    this.quantMode = on
    this.emit()
  }

  toggleQuantMode() {
    this.setQuantMode(!this.quantMode)
  }

  private _playing = false
  private _scratching = false
  private _cuePreviewing = false
  /** Set when a hot cue is held in momentary-play mode (CDJ behavior). Null otherwise. */
  private _hotCueHoldIndex: number | null = null
  private _rate = 1
  private _nudgeFactor = 1.0
  private posSeconds = 0
  private posFrame = 0

  version = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    vinylWorkletReady: Promise<unknown>,
    rubberbandReady?: Promise<unknown>,
    soundTouchReady?: Promise<unknown>
  ) {
    this.ctx = ctx
    this.autoGain = ctx.createGain()
    this.trim = ctx.createGain()

    // Keylock splitting gains
    this.keyLockDryGain = ctx.createGain()
    this.keyLockWetGain = ctx.createGain()
    this.keyLockDryGain.gain.value = 1
    this.keyLockWetGain.gain.value = 0

    this.keyLockDryGain.connect(this.autoGain)
    this.keyLockWetGain.connect(this.autoGain)

    this.eqLow = ctx.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = 320

    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = 1000
    this.eqMid.Q.value = 0.9

    this.eqHigh = ctx.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = 3200

    this.filter = ctx.createBiquadFilter()
    this.setFilter(0)

    this.fader = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.xfade = ctx.createGain()

    this.autoGain.connect(this.trim)
    this.trim.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.filter)
    this.filter.connect(this.fader)
    this.fader.connect(this.analyser)
    this.analyser.connect(this.xfade)
    this.xfade.connect(destination)

    // SCR cutter sample: built up front (but silent until triggered) so
    // `triggerCutter` never has to touch the graph while the deck is playing.
    this.cutterGain = ctx.createGain()
    this.cutterGain.gain.value = 1
    this.cutterGain.connect(this.eqLow)

    // ----- FX chains -----
    this.echoSend = ctx.createGain()
    this.echoSend.gain.value = 0
    this.echoDelay = ctx.createDelay(2)
    this.echoFeedback = ctx.createGain()
    this.echoFeedback.gain.value = 0
    const echoTone = ctx.createBiquadFilter()
    echoTone.type = 'lowpass'
    echoTone.frequency.value = 4000
    this.echoWet = ctx.createGain()
    this.echoWet.gain.value = 0
    this.filter.connect(this.echoSend)
    this.echoSend.connect(this.echoDelay)
    this.echoDelay.connect(this.echoWet)
    this.echoDelay.connect(echoTone)
    echoTone.connect(this.echoFeedback)
    this.echoFeedback.connect(this.echoDelay)
    this.echoWet.connect(this.fader)

    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0
    this.reverb = ctx.createConvolver()
    this.reverbWet = ctx.createGain()
    this.reverbWet.gain.value = 0
    this.filter.connect(this.reverbSend)
    this.reverbSend.connect(this.reverb)
    this.reverb.connect(this.reverbWet)
    this.reverbWet.connect(this.fader)

    this.flangerSend = ctx.createGain()
    this.flangerSend.gain.value = 0
    this.flangerDelay = ctx.createDelay(0.05)
    this.flangerDelay.delayTime.value = 0.0025
    this.flangerFeedback = ctx.createGain()
    this.flangerFeedback.gain.value = 0
    this.flangerWet = ctx.createGain()
    this.flangerWet.gain.value = 0
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.25
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0.0018
    lfo.connect(lfoDepth)
    lfoDepth.connect(this.flangerDelay.delayTime)
    lfo.start()
    this.filter.connect(this.flangerSend)
    this.flangerSend.connect(this.flangerDelay)
    this.flangerDelay.connect(this.flangerWet)
    this.flangerDelay.connect(this.flangerFeedback)
    this.flangerFeedback.connect(this.flangerDelay)
    this.flangerWet.connect(this.fader)

    // Initialize Vinyl player AudioWorklet
    vinylWorkletReady
      .then(() => {
        const node = new AudioWorkletNode(ctx, 'vinyl-player', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        })
        node.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.onWorkletMessage(e.data)

        // Connect vinylNode to both dry bypass and wet keylock paths
        node.connect(this.keyLockDryGain)
        this.vinylNode = node

        for (const p of this.pendingMessages) {
          node.port.postMessage(p.msg, p.transfer ?? [])
        }
        this.pendingMessages = []

        // Rubber Band's realtime kernel, created eagerly so that selecting it is
        // only ever a graph change: it is fed from here on (so its kernel builds
        // and primes in the background), and setKeyLockEngine only has to move it
        // into the wet path once the output tap hears it.
        if (rubberbandReady) {
          rubberbandReady
            .then(() => {
              const voice = this.createRubberBandVoice()
              if (!voice) return
              this.rbVoices = [voice]
              this.setAudibleVoice(0)
              this.wireKeyLockEngines()
              this.updateKeyLockRouting()
            })
            .catch(err => console.warn('Rubber Band worklet not ready:', err))
        }

        // SoundTouch is the live engine: its pitch is an AudioParam, so the
        // continuous pitch changes a deck makes ramp instead of restarting the
        // stretch pipeline.
        if (soundTouchReady) {
          soundTouchReady
            .then(() => {
              try {
                this.stNode = new SoundTouchNode({
                  context: this.ctx,
                  outputChannelCount: 2,
                })
                node.connect(this.stNode)
                this.wireKeyLockEngines()
                this.updateKeyLockRouting()
              } catch (err) {
                console.warn('SoundTouchNode instantiation skipped:', err)
              }
            })
            .catch(err => console.warn('SoundTouch worklet not ready:', err))
        }
      })
      .catch(err => console.error('vinyl worklet failed to load', err))
  }

  private post(msg: unknown, transfer?: Transferable[]) {
    if (this.vinylNode) this.vinylNode.port.postMessage(msg, transfer ?? [])
    else this.pendingMessages.push({ msg, transfer })
  }

  private ghostSeconds = 0

  private onWorkletMessage(d: WorkletMessage) {
    if (d.t === 'pos' && d.s !== undefined) {
      this.posSeconds = d.s
      if (d.g !== undefined) this.ghostSeconds = d.g
      if (d.f !== undefined) this.posFrame = d.f
    } else if (d.t === 'ended') {
      this._playing = false
      this._cuePreviewing = false
      this.emit()
    }
  }

  private emit() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  // ----- state -----

  get playing() {
    return this._playing
  }

  get cuePreviewing() {
    return this._cuePreviewing
  }

  get scratching() {
    return this._scratching
  }

  get rate() {
    return this._rate
  }

  get nudgeFactor() {
    return this._nudgeFactor
  }

  get duration() {
    return this.track?.duration ?? 0
  }

  get keyLock(): boolean {
    return this._keyLock
  }

  setKeyLock(on = true) {
    this._keyLock = on
    this.updateKeyLockRouting()
    this.emit()
  }

  toggleKeyLock() {
    this.setKeyLock(!this._keyLock)
  }

  /**
   * Seconds the active keylock path holds the audio back. 0 when the deck plays dry.
   *
   * See `keylock-transform.ts` for the measurement. Displays that show "where the track is
   * right now" want {@link audiblePosition} instead of {@link position}, or they will lead
   * the sound by this much whenever keylock is engaged.
   */
  get keyLockLatencySeconds(): number {
    return keyLockLatencyOf(this._keyLockEngine, this._keyLockActive, this.ctx.sampleRate)
  }

  /**
   * The source position being heard right now, as opposed to the one being read.
   *
   * `position` is the vinyl worklet's read head, which runs ahead of the audio whenever
   * the keylock engine is in the path. Anything drawn against "what you hear" — waveform
   * lanes, playheads, beat counters — should use this, or it will sit a fraction of a beat
   * early with keylock on and be correct with it off, which reads as the grids not lining
   * up between decks.
   *
   * Deliberately *not* folded into `position`: seeking, scrubbing and sync all want the
   * read head, and correcting those would make them 133 ms wrong instead.
   *
   * Note that this only fixes the *display*. `alignPhaseTo` bar-aligns read heads, so a
   * synced pair where exactly one deck holds the key is genuinely ~133 ms apart in the
   * audio — a flam on the kick — and drawing the lanes against this getter will show that
   * honestly rather than hiding it. Compensating it is a change to sync, not to this.
   */
  get audiblePosition(): number {
    return audiblePositionOf(this.posSeconds, this._rate, this.keyLockLatencySeconds)
  }

  private _keyShift = 0

  get keyShift(): number {
    return this._keyShift
  }

  setKeyShift(semitones: number) {
    this._keyShift = Math.max(-12, Math.min(12, Math.round(semitones)))
    this.updateKeyLockRouting()
    this.emit()
  }

  resetKeyShift() {
    this.setKeyShift(0)
  }

  get keyLockEngine(): KeyLockEngine {
    return this._keyLockEngine
  }

  /**
   * Selects the engine that holds the key on this deck.
   *
   * SoundTouch is the live default because a deck changes pitch constantly — fader,
   * nudge, sync PLL, key shift — and its pitch is an AudioParam, so those changes ramp
   * smoothly. Measured on a 220 Hz tone at 1.30x it lands 1.1 cents high.
   *
   * Rubber Band is the accurate engine — 0 cents on the same tone, exact on a key shift —
   * and it can now follow a fader too, because a deck keeps *two* of its kernels. The
   * binding resets the stretcher before applying any new ratio (measured: ~20 ms of the
   * old ratio, ~100 ms of silence, an unsettled tail, then exact pitch), so a change is
   * never applied to the voice being heard: it is prepared on the idle voice and faded in
   * once that voice is audibly producing again. A 3 s, 8 % sweep measured 0 silent windows
   * out of 304, with the key held to a median of 7.7 cents while the fader moved and under
   * 2.5 cents once it stopped — against 95 % of windows silent for a single kernel.
   *
   * Safe to call while playing: the deck keeps playing dry until the output tap shows the
   * new engine producing audio, so the switch is never a hole in the music.
   */
  setKeyLockEngine(engine: KeyLockEngine) {
    if (engine === this._keyLockEngine) return
    // Nothing to switch to if the R3 worklet never registered.
    if (engine === 'rubberband' && this.rbVoices.length === 0) return
    this._keyLockEngine = engine
    this.cancelKernelWait()

    if (engine === 'rubberband') {
      // A handover needs a spare, and this is the only engine that uses one.
      this.ensureSpareVoice()
      this.setAudibleVoice(this.rbAudibleVoice)
      // Hold the deck on the dry path *before* the graph changes underneath it, then wait
      // for the tap to confirm the voice is audible. That costs no re-tune: the voices are
      // fed from the moment they exist, so this normally resolves in a couple of polls.
      this.keyLockAwaitingKernel = true
      this.updateKeyLockRouting()
      this.wireKeyLockEngines()
      this.updateKeyLockRouting()
      this.engageRubberBandWhenReady()
    } else {
      this.setAudibleVoice(0)
      this.releaseSpareVoice()
      this.wireKeyLockEngines()
      this.updateKeyLockRouting()
    }

    this.emit()
  }

  /**
   * Creates the idle voice a handover needs, if it is not already there.
   *
   * Only while Rubber Band holds the key: a high quality voice is expensive, and a deck
   * keylocking with SoundTouch gains nothing from a spare it is not using.
   */
  private ensureSpareVoice() {
    if (this.rbVoices.length >= RB_VOICE_COUNT) return
    const voice = this.createRubberBandVoice()
    if (voice) this.rbVoices.push(voice)
  }

  /** Drops the spare again once Rubber Band is no longer holding the key. */
  private releaseSpareVoice() {
    this.cancelKeyLockHandover()
    const spare = this.rbVoices[RB_SPARE_VOICE]
    if (!spare) return
    // The surviving voice has to be the audible one, or the next selection would point
    // at an index that no longer exists.
    this.rbAudibleVoice = 0
    this.rbVoices = [this.rbVoices[0]]
    this.destroyRubberBandVoice(spare)
  }

  private cancelKeyLockHandover() {
    if (this.rbHandoverTimer !== null) {
      window.clearTimeout(this.rbHandoverTimer)
      this.rbHandoverTimer = null
    }
    this.rbHandover = null
  }

  /** One Rubber Band voice: kernel, output tap and crossfade gain, wired into the wet bus. */
  private createRubberBandVoice(): RubberBandVoice | null {
    try {
      const node = createRubberBandNode(this.ctx)
      // Quality is a kernel rebuild, so it has to be set before any audio flows. High
      // quality is the only mode with exact pitch: the fast mode measured +43 cents at
      // 1.30x and -21 cents at 2.00x.
      node.setHighQuality(true)
      // Pitch-only shift: tempo 1 leaves the stream's length, and therefore the playback
      // rate, to the vinyl worklet.
      node.setTempo(1)
      if (this.vinylNode) this.linkNodes(this.vinylNode, node)
      const probe = this.ctx.createAnalyser()
      probe.fftSize = 256
      const gain = this.ctx.createGain()
      gain.gain.value = RB_IDLE_VOICE_GAIN
      node.connect(probe)
      probe.connect(gain)
      this.linkNodes(gain, this.keyLockWetGain)
      return { node, probe, gain, pitch: 1 }
    } catch (err) {
      console.warn('Rubber Band keylock voice unavailable:', err)
      return null
    }
  }

  private destroyRubberBandVoice(voice: RubberBandVoice) {
    if (this.vinylNode) this.unlinkNodes(this.vinylNode, voice.node)
    this.unlinkNodes(voice.node, voice.probe)
    this.unlinkNodes(voice.probe, voice.gain)
    this.unlinkNodes(voice.gain, this.keyLockWetGain)
    voice.node.close()
  }

  /** Keeps the deck dry until a newly selected Rubber Band voice is audible. */
  private engageRubberBandWhenReady() {
    const started = performance.now()
    let streak = 0
    const poll = () => {
      const voice = this.rbVoices[this.rbAudibleVoice]
      streak = voice && this.tapPeak(voice.probe) > RB_KEYLOCK_SIGNAL_FLOOR ? streak + 1 : 0
      if (streak >= RB_KEYLOCK_READY_STREAK || performance.now() - started > RB_KEYLOCK_KERNEL_TIMEOUT_MS) {
        this.keyLockKernelTimer = null
        this.keyLockAwaitingKernel = false
        this.updateKeyLockRouting()
        return
      }
      this.keyLockKernelTimer = window.setTimeout(poll, RB_KEYLOCK_PROBE_INTERVAL_MS)
    }
    this.keyLockKernelTimer = window.setTimeout(poll, RB_KEYLOCK_PROBE_INTERVAL_MS)
  }

  /** Highest sample level an output tap has seen. */
  private tapPeak(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.rbProbeBuffer)
    let peak = 0
    for (let i = 0; i < this.rbProbeBuffer.length; i++) {
      const level = Math.abs(this.rbProbeBuffer[i])
      if (level > peak) peak = level
    }
    return peak
  }

  private cancelKernelWait() {
    if (this.keyLockKernelTimer !== null) {
      window.clearTimeout(this.keyLockKernelTimer)
      this.keyLockKernelTimer = null
    }
    this.keyLockAwaitingKernel = false
  }

  /**
   * Web Audio throws when told to disconnect an edge that is not there, so graph
   * changes go through these two.
   */
  private linkNodes(node: AudioNode, destination: AudioNode) {
    try {
      node.connect(destination)
    } catch (err) {
      console.warn('keylock connect failed:', err)
    }
  }

  private unlinkNodes(node: AudioNode, destination: AudioNode) {
    try {
      node.disconnect(destination)
    } catch {
      // Already disconnected: nothing to undo.
    }
  }

  /** The node currently holding the key, or null when neither is available. */
  private activeKeyLockEngine(): AudioWorkletNode | null {
    const voice = this.rbVoices[this.rbAudibleVoice]
    if (this._keyLockEngine === 'rubberband' && voice) return voice.node
    return this.stNode
  }

  /**
   * Plugs exactly one engine into the wet gain, so only that one is ever audible.
   *
   * Both engines still run, and both Rubber Band voices stay wired to the wet gain for
   * the life of the deck: an AudioWorkletNode fed by the vinyl worklet is an active
   * source, so Chrome keeps rendering it whether or not it reaches the destination, and
   * that is what keeps the idle voice primed and ready to be faded in.
   */
  private wireKeyLockEngines() {
    const engine = this.activeKeyLockEngine()
    if (this.stNode) {
      if (engine === this.stNode) this.linkNodes(this.stNode, this.keyLockWetGain)
      else this.unlinkNodes(this.stNode, this.keyLockWetGain)
    }
    // Which Rubber Band voice is heard is decided by the voice gains, not by wiring.
  }

  private updateKeyLockRouting() {
    const t = this.ctx.currentTime
    const needsKeyLock = this._keyLock || this._keyShift !== 0
    const engine = this.activeKeyLockEngine()

    // `pitch` is the ratio the engine would apply, and `identity` says whether applying
    // it would do anything. At a centred fader with no key shift it would not: the
    // engine would only re-time windows and warp the track. Play dry instead — the
    // engine keeps running and keeps being fed, and the params below are still written,
    // so the wet path is already correct and primed for the moment the fader leaves the
    // detent. See {@link keyLockTransform} for the measurement behind this.
    const { pitch, ratePitch, identity } = keyLockTransform(
      this._rate,
      this._nudgeFactor,
      this._pllCorrection,
      this._keyLock,
      this._keyShift,
    )

    const active =
      needsKeyLock && !identity && !this._scratching && engine !== null && !this.keyLockAwaitingKernel

    this._keyLockActive = active

    if (this.rbVoices.length > 0) {
      // Never applied directly: this is a request, and `requestKeyLockPitch` decides
      // whether the audible voice is close enough already or a handover is needed.
      this.requestKeyLockPitch(pitch)
    }
    if (engine === this.stNode && this.stNode) {
      // SoundTouch:
      // pipe.pitch = pitch * Math.pow(2, pitchSemitones / 12) / playbackRate
      // playbackRate is kept at 1.0 (vinyl worklet resamples at effectiveRate), and the
      // key shift goes in through pitchSemitones, so `pitch` here is the rate part only.
      this.stNode.playbackRate.value = 1.0
      this.stNode.playbackRate.setValueAtTime(1.0, t)
      this.stNode.pitch.value = ratePitch
      this.stNode.pitch.setValueAtTime(ratePitch, t)
      this.stNode.pitchSemitones.value = this._keyShift
      this.stNode.pitchSemitones.setValueAtTime(this._keyShift, t)
    }

    if (active) {
      this.keyLockWetGain.gain.setTargetAtTime(1, t, 0.015)
      this.keyLockDryGain.gain.setTargetAtTime(0, t, 0.015)
    } else {
      this.keyLockWetGain.gain.setTargetAtTime(0, t, 0.015)
      this.keyLockDryGain.gain.setTargetAtTime(1, t, 0.015)
    }
  }

  /**
   * Keeps the audible voice's key in step with the fader without ever retuning it.
   *
   * A Rubber Band ratio change is unaffordable on the voice the listener is hearing and
   * free on one they are not, so a request either does nothing (the wanted ratio is
   * already within {@link RB_KEYLOCK_SWAP_CENTS}) or starts a handover onto the idle
   * voice. Called for every rate, nudge, sync and key-shift change, so the request is
   * cheap by design.
   */
  private requestKeyLockPitch(pitch: number) {
    const now = performance.now()
    if (Math.abs(1200 * Math.log2(pitch / this.rbTargetPitch)) > 0.05) {
      const seconds = (now - this.rbTargetChangedAt) / 1000
      const cents = 1200 * Math.log2(pitch / this.rbTargetPitch)
      if (this.rbTargetChangedAt > 0 && seconds > 0.01) {
        this.rbPitchVelocity = this.rbPitchVelocity * 0.4 + (cents / seconds) * 0.6
      }
      this.rbTargetPitch = pitch
      this.rbTargetChangedAt = now
      this.scheduleKeyLockSettle()
    }
    if (this.rbHandover) return
    const audible = this.rbVoices[this.rbAudibleVoice]
    if (!audible) return
    if (Math.abs(1200 * Math.log2(pitch / audible.pitch)) <= RB_KEYLOCK_SWAP_CENTS) return
    this.beginKeyLockHandover()
  }

  /** Cents the fader has been still for, capped by nothing — used to decide when to settle. */
  private faderStillMs(): number {
    return this.rbTargetChangedAt > 0 ? performance.now() - this.rbTargetChangedAt : Infinity
  }

  /**
   * Where a handover should aim, in cents off the wanted ratio.
   *
   * Positive during a fader move that is heading down in ratio (speeding up), and it fades
   * to zero on its own once changes stop arriving, so a resting fader is aimed at exactly.
   */
  private keyLockAimCents(): number {
    const stillFor = this.faderStillMs() / 1000
    const decay = Math.exp(-stillFor / RB_KEYLOCK_VELOCITY_DECAY_S)
    const aim = RB_KEYLOCK_PRIME_LEAD_MS * (this.rbPitchVelocity / 1000) * decay
    return Math.max(-RB_KEYLOCK_AIM_MAX_CENTS, Math.min(RB_KEYLOCK_AIM_MAX_CENTS, aim))
  }

  /**
   * Retunes the idle voice and fades it in once it is producing audio at the new ratio.
   *
   * The retune is aimed at where a moving fader is *heading*: a handover costs
   * {@link RB_KEYLOCK_PRIME_LEAD_MS} of re-priming, so a voice tuned to the ratio the fader
   * had when the handover started would land exactly that far behind. Aiming ahead by the
   * measured slew is what keeps the error during a slide at a few cents instead of growing
   * with the speed of the slide.
   */
  private beginKeyLockHandover() {
    const index = 1 - this.rbAudibleVoice
    const voice = this.rbVoices[index]
    if (!voice) return
    const aim = this.rbTargetPitch * Math.pow(2, this.keyLockAimCents() / 1200)
    voice.node.setPitch(aim)
    voice.pitch = aim
    this.rbHandover = { index, tunedAt: performance.now(), sawSilence: false, streak: 0 }
    this.scheduleHandoverProbe()
  }

  /**
   * One more handover once the fader has stopped, so a deck nobody is touching holds the key
   * exactly rather than within a handover threshold of it.
   */
  private scheduleKeyLockSettle() {
    if (this.rbSettleTimer !== null) window.clearTimeout(this.rbSettleTimer)
    this.rbSettleTimer = window.setTimeout(() => {
      this.rbSettleTimer = null
      // A handover already in flight re-checks against the settle threshold when it lands.
      if (this.rbHandover) return
      const audible = this.rbVoices[this.rbAudibleVoice]
      if (!audible) return
      if (Math.abs(1200 * Math.log2(this.rbTargetPitch / audible.pitch)) > RB_KEYLOCK_SETTLE_CENTS) {
        this.beginKeyLockHandover()
      }
    }, RB_KEYLOCK_SETTLE_MS)
  }

  private scheduleHandoverProbe() {
    if (this.rbHandoverTimer !== null) return
    this.rbHandoverTimer = window.setTimeout(() => this.probeHandover(), RB_KEYLOCK_PROBE_INTERVAL_MS)
  }

  /**
   * Hands over once the retuned voice is audible *again*.
   *
   * Its kernel emits a last burst of the old ratio, goes quiet while it re-primes, then
   * settles, so the swap waits for that hole and for signal to come back through it
   * rather than trusting the first level it sees.
   */
  private probeHandover() {
    this.rbHandoverTimer = null
    const handover = this.rbHandover
    if (!handover) return
    const voice = this.rbVoices[handover.index]
    if (!voice) {
      this.finishKeyLockHandover()
      return
    }
    if (this.tapPeak(voice.probe) > RB_KEYLOCK_SIGNAL_FLOOR) {
      if (handover.sawSilence && ++handover.streak >= RB_KEYLOCK_PRIME_STREAK) {
        this.finishKeyLockHandover()
        return
      }
    } else {
      handover.sawSilence = true
      handover.streak = 0
    }
    if (performance.now() - handover.tunedAt > RB_KEYLOCK_PRIME_TIMEOUT_MS) {
      this.finishKeyLockHandover()
      return
    }
    this.scheduleHandoverProbe()
  }

  private finishKeyLockHandover() {
    const handover = this.rbHandover
    this.rbHandover = null
    if (this.rbHandoverTimer !== null) {
      window.clearTimeout(this.rbHandoverTimer)
      this.rbHandoverTimer = null
    }
    if (!handover) return
    this.setAudibleVoice(handover.index)
    // A fader that kept moving while this voice primed has left it behind again. Once the
    // fader has stopped, the bar is a couple of cents instead of a whole swap threshold.
    const threshold = this.faderStillMs() > RB_KEYLOCK_SETTLE_MS ? RB_KEYLOCK_SETTLE_CENTS : RB_KEYLOCK_SWAP_CENTS
    const voice = this.rbVoices[handover.index]
    if (voice && Math.abs(1200 * Math.log2(this.rbTargetPitch / voice.pitch)) > threshold) {
      this.beginKeyLockHandover()
    }
  }

  /** Fades the wet bus onto one voice and drops the other to its idle level. */
  private setAudibleVoice(index: number) {
    // Never point at a voice that is not there: that would leave the deck stuck on its dry
    // path waiting for an engine that cannot be heard.
    const chosen = this.rbVoices[index] ? index : 0
    this.rbAudibleVoice = chosen
    const t = this.ctx.currentTime
    this.rbVoices.forEach((voice, i) => {
      const audible = i === chosen && this._keyLockEngine === 'rubberband'
      voice.gain.gain.setTargetAtTime(audible ? 1 : RB_IDLE_VOICE_GAIN, t, RB_KEYLOCK_FADE_S)
    })
  }

  /**
   * Grid tempo at the playhead, before the pitch fader. On a variable-tempo grid
   * this is the *local* tempo, which is what lets sync follow a drifting master
   * instead of chasing a single average tempo.
   */
  get localBpm(): number | null {
    const grid = this.track?.grid
    if (grid) return bpmAt(grid, this.position)
    return this.track?.bpm ?? null
  }

  /** Local tempo after the pitch fader is applied. */
  get effectiveBpm(): number | null {
    const local = this.localBpm
    if (!local) return null
    return Math.round(local * this._rate * 100) / 100
  }

  /**
   * The top-level Master Tempo, mirrored onto the deck so the cutter has a tempo
   * to follow even before a track is loaded. Kept as a plain setter rather than
   * an `emit()`ing one: it is a read-only mirror of `AudioEngine.masterBpm`, which
   * emits for itself.
   */
  get masterBpm(): number {
    return this._masterBpm
  }

  setMasterBpm(bpm: number) {
    if (Number.isFinite(bpm) && bpm > 0) this._masterBpm = bpm
  }

  /** Local beat length in seconds at `time`. */
  beatLengthAt(time = this.position): number {
    const grid = this.track?.grid
    if (grid) return beatLengthAt(grid, time)
    const bpm = this.track?.bpm
    return bpm && bpm > 0 ? 60 / bpm : 0.5
  }

  /** Local bar length in seconds at `time`. */
  barLengthAt(time = this.position): number {
    const grid = this.track?.grid
    return grid ? barLengthAt(grid, time) : this.beatLengthAt(time) * 4
  }

  /** Fractional position inside the bar, 0 at the downbeat and 1 at the next bar. */
  barPhase(): number {
    return barPhaseAt(this.track?.grid, this.position)
  }

  /** The deck's grid, created on demand so manual grid edits always have one. */
  private ensureGrid(): BeatGrid {
    const existing = this.track?.grid
    if (existing) return existing
    const bpm = this.track?.bpm || 120
    const grid: BeatGrid = { bpm, firstBeat: 0, firstBar: 0, beatsPerBar: 4 }
    if (this.track) this.track.grid = grid
    return grid
  }

  get position(): number {
    return Math.min(Math.max(this.posSeconds, 0), this.duration)
  }

  get lastPosFrame(): number {
    return this.posFrame
  }

  positionAtFrame(frame: number): number {
    const rate = this._playing && !this._scratching ? this._rate : 0
    return this.posSeconds + ((frame - this.posFrame) / this.ctx.sampleRate) * rate
  }

  setTrackBpm(bpm: number) {
    if (!this.track) return
    const validBpm = Math.max(20, Math.min(300, Math.round(bpm * 10) / 10))
    this.track.bpm = validBpm
    const grid = this.track.grid
    if (grid) {
      // A manual tempo edit asserts that the track holds one tempo, so a
      // variable-tempo grid collapses here rather than fighting the new value.
      this.track.grid = collapseGridToConstant(grid, validBpm, grid.firstBar)
    }
    this.updateFxTiming()
    this.emit()
  }

  setTrackKey(camelot: string, name?: string) {
    if (!this.track) return
    this.track.key = {
      name: name ?? camelot,
      camelot,
    }
    this.updateKeyLockRouting()
    this.emit()
  }

  // ----- beatgrid adjustment -----

  nudgeBeatGrid(deltaSeconds: number) {
    if (!this.track) return
    // Shifting a variable grid moves every measured beat with the anchor, so the
    // ticks stay locked to the audio instead of sliding off it.
    this.track.grid = shiftGridBeats(this.ensureGrid(), deltaSeconds)
    this.emit()
  }

  /**
   * Shift the bar phase (white downbeat stripe) by an integer number of beats (e.g. +1 or -1 beat).
   * Shifts which beat is considered Beat 1 without altering grid tempo or beat tick alignment.
   */
  shiftBarPhase(deltaBeats: number) {
    if (!this.track) return
    const grid = this.ensureGrid()
    const anchorBeat = Math.round(beatIndexAt(grid, grid.firstBar))
    const anchor = Math.max(0, beatTimeAt(grid, anchorBeat + deltaBeats))
    this.track.grid = normalizeGrid({ ...grid, firstBar: anchor })
    this.emit()
  }

  setBeat1AtPosition(pos?: number) {
    if (!this.track) return
    const targetPos = Math.max(0, pos ?? this.position)
    // On a variable grid the downbeat has to land on a measured beat, otherwise
    // bar phase stops being exact. `reanchorBar` does that, and for a constant
    // grid it just re-establishes the phase invariant.
    this.track.grid = reanchorBar({ ...this.ensureGrid(), firstBar: targetPos })
    this.emit()
  }

  adjustGridBpm(deltaBpm: number) {
    if (!this.track) return
    const curBpm = this.track.grid?.bpm || this.track.bpm || 120
    const newBpm = Math.max(20, Math.min(300, Math.round((curBpm + deltaBpm) * 10) / 10))
    this.setTrackBpm(newBpm)
  }

  multiplyGridBpm(multiplier: 0.5 | 2) {
    if (!this.track) return
    const grid = this.track.grid
    const curBpm = grid?.bpm || this.track.bpm || 120
    if (grid && isVariableGrid(grid)) {
      // Halving/doubling a beat map renumbers its beats; the measured positions
      // themselves stay where the audio put them.
      const scaled = scaleGridBeats(grid, multiplier)
      this.track.grid = scaled
      this.track.bpm = scaled.bpm
      this.updateFxTiming()
      this.emit()
      return
    }
    const newBpm = Math.max(20, Math.min(300, Math.round(curBpm * multiplier * 10) / 10))
    this.setTrackBpm(newBpm)
  }

  // ----- track loading -----

  loadTrack(track: Track) {
    // A chop queued for a beat of the *old* track would sound at the old
    // track's level over the new one, against a grid that is no longer loaded.
    this.cancelPendingCutter()
    this.track = track
    this._playing = false
    this._scratching = false
    this._cuePreviewing = false
    // Clear sync lock and key shift so a new track doesn't inherit the previous one's mix state.
    // Reset pitch rate to 1.0 so track plays at its own native BPM.
    this.setSyncLock(false)
    this._keyShift = 0
    this._rate = 1.0
    this.post({ t: 'rate', rate: 1.0 })
    const startPos = track.grid?.firstBar && track.grid.firstBar > 0.03 ? track.grid.firstBar : 0
    this.posSeconds = startPos
    this.cuePoint = startPos
    this.loop = null
    this.hotCues = Array(HOT_CUE_COUNT).fill(null)

    const buf = track.buffer
    const channels: ArrayBuffer[] = []
    for (let c = 0; c < Math.min(buf.numberOfChannels, 2); c++) {
      const data = new Float32Array(buf.length)
      buf.copyFromChannel(data, c)
      channels.push(data.buffer)
    }
    this.post({ t: 'load', channels, length: buf.length, rate: buf.sampleRate, initialSec: startPos }, channels)
    this.autoGain.gain.setTargetAtTime(track.gain || 1, this.ctx.currentTime, 0.01)
    this.updateKeyLockRouting()
    this.updateFxTiming()
    this.emit()
  }

  ejectTrack() {
    if (this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
    }
    this.pause()
    this.track = null
    this.posSeconds = 0
    this.cuePoint = 0
    this.loop = null
    this.hotCues = Array(HOT_CUE_COUNT).fill(null)
    this.setSyncLock(false)
    this._keyShift = 0
    this.updateKeyLockRouting()
    this.emit()
  }

  // ----- transport -----

  async play() {
    if (this._cuePreviewing && this._playing) {
      // Transition from temporary CUE preview to normal playback
      this._cuePreviewing = false
      this.emit()
      return
    }
    if (!this.track || this._playing) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.posSeconds >= this.duration - 0.01) {
      this.posSeconds = 0
      this.post({ t: 'seek', s: 0 })
    }
    this.post({ t: 'play', rate: this._rate })
    this._playing = true
    // If SYNC was engaged while paused, align bar phase now that both can play.
    if (this._syncLocked && this._syncTargetDeck?.playing && !this._scratching) {
      this.alignPhaseTo(this._syncTargetDeck)
    }
    this.updateKeyLockRouting()
    this.emit()
  }

  pause(instant = false) {
    this._cuePreviewing = false
    if (this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
    }
    // A chop queued for the next grid beat is queued against a playhead that is
    // about to stop moving, so that beat is never going to arrive.
    this.cancelPendingCutter()
    if (!this._playing && !instant) return
    this.post({ t: 'pause', instant })
    this._playing = false
    this.emit()
  }

  async togglePlay() {
    if (this._cuePreviewing) {
      // Transition from temporary CUE preview to permanent PLAY (latch)
      this._cuePreviewing = false
      this.emit()
      return
    }
    if (this._playing) this.pause()
    else await this.play()
  }

  async cue() {
    if (!this.track) return
    if (this._playing) {
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.pause(true)
      this.seek(this.cuePoint)
    } else {
      this.cuePoint = this.snapMode ? this.snapToBeat(this.position) : this.position
      this.seek(this.cuePoint)
      this.emit()
    }
  }

  /**
   * Standard DJ CUE button behavior:
   * - If already playing: immediately stop and return to cue point.
   * - If paused: if playhead moved away from cuePoint, set new cuePoint.
   *   Then start preview playback immediately while held.
   */
  async cueDown() {
    if (!this.track) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    if (this._playing) {
      this._cuePreviewing = false
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.pause(true)
      this.seek(this.cuePoint)
      return
    }

    // Currently paused:
    const currentPos = this.position
    if (Math.abs(currentPos - this.cuePoint) > 0.015) {
      this.cuePoint = this.snapMode ? this.snapToBeat(currentPos) : currentPos
    }
    this.seek(this.cuePoint)
    this._cuePreviewing = true
    await this.play()
  }

  /**
   * Release CUE button: if previewing from cue, instantly stop and snap back to cue point.
   */
  cueUp() {
    if (!this.track) return
    if (this._cuePreviewing) {
      this._cuePreviewing = false
      this.pause(true)
      this.seek(this.cuePoint)
    }
  }

  seek(time: number) {
    if (!this.track) return
    // Moving the playhead re-phases the grid, so a chop queued against the old
    // position would land off-beat. This is the one path every jump goes
    // through — hot cues, beat jumps, CUE — so the cancel belongs here.
    this.cancelPendingCutter()
    const t = Math.min(Math.max(time, 0), this.duration)
    if (this._cuePreviewing && Math.abs(t - this.cuePoint) > 0.01) {
      this._cuePreviewing = false
    }
    if (this.loop && (t < this.loop.start || t > this.loop.end)) {
      this.loop = null
      this.post({ t: 'loop', loop: null })
    }
    this.post({ t: 'seek', s: t })
    this.posSeconds = t
    this.emit()
  }

  beatJump(bars: number) {
    if (!this.track) return
    const grid = this.track.grid
    if (grid) {
      this.seek(shiftBars(grid, this.position, bars))
      return
    }
    const bpm = this.track.bpm ?? 120
    this.seek(this.position + bars * (60 / bpm) * 4)
  }

  // ----- pitch & continuous sync lock -----

  get syncLocked(): boolean {
    return this._syncLocked
  }

  get syncTargetDeck(): DeckEngine | null {
    return this._syncTargetDeck
  }

  get pllCorrection(): number {
    return this._pllCorrection
  }

  setSyncLock(on: boolean, target?: DeckEngine | null) {
    this._syncLocked = on
    this._syncTargetDeck = on ? (target ?? null) : null
    if (!on) {
      this._pllCorrection = 1.0
      this.applyRateUpdate()
    }
    this.emit()
  }

  applyPllCorrection(factor: number) {
    if (Math.abs(this._pllCorrection - factor) < 0.00005) return
    this._pllCorrection = factor
    this.applyRateUpdate()
  }

  private applyRateUpdate() {
    const finalRate = this._rate * this._nudgeFactor * this._pllCorrection
    this.post({ t: 'rate', rate: finalRate })
    this.updateKeyLockRouting()
  }

  setRate(rate: number, fromSync = false) {
    if (!fromSync && this._syncLocked) {
      // Manual pitch slider adjustment disengages sync lock
      this._syncLocked = false
      this._syncTargetDeck = null
      this._pllCorrection = 1.0
    }
    this._rate = Math.max(0.2, Math.min(2.0, rate))
    this.applyRateUpdate()
    this.updateFxTiming()
    this.emit()
  }

  /**
   * Temporary pitch bend (nudge) while pushing button:
   * direction: -1 (slow down), +1 (speed up), 0 (release back to standard rate)
   */
  nudge(direction: -1 | 0 | 1, factor: number = 0.08) {
    if (direction === 0) {
      this._nudgeFactor = 1.0
    } else if (direction > 0) {
      this._nudgeFactor = 1.0 + factor
    } else {
      this._nudgeFactor = Math.max(0.1, 1.0 - factor)
    }

    if (!this._playing && direction !== 0) {
      this.seek(this.position + direction * 0.03)
    }

    this.applyRateUpdate()
    this.emit()
  }

  /**
   * Align this deck's bar phase to another deck (used by SYNC and deferred sync-on-play).
   *
   * Phase is compared at each deck's *audible* position, not its read head. A keylocked
   * deck's read head runs up to 133 ms ahead of the sound it is making (see
   * {@link audiblePosition}), so aligning read heads lines up the two decks on screen while
   * leaving their audio a quarter of a beat apart — a flam on the kick. Both decks report
   * zero latency when they play dry, so this is a no-op unless one of them holds the key.
   *
   * The correction is a source-time shift, and subtracting a constant latency commutes with
   * it, so shifting the read head by `shift` moves the audible position by `shift` too.
   */
  alignPhaseTo(other: DeckEngine): boolean {
    const ownGrid = this.track?.grid ?? null
    const otherGrid = other.track?.grid ?? null
    if (!ownGrid || !otherGrid || this._scratching) return false
    if (!(ownGrid.bpm > 0) || !(otherGrid.bpm > 0)) return false

    const ownAt = this.audiblePosition
    const otherAt = other.audiblePosition
    const phiSelf = barPhaseAt(ownGrid, ownAt)
    const phiOther = barPhaseAt(otherGrid, otherAt)
    let dPhi = phiOther - phiSelf
    if (dPhi > 0.5) dPhi -= 1.0
    if (dPhi < -0.5) dPhi += 1.0
    // Shift by a fraction of the *local* bar so the correction is right even
    // where a variable grid is running slower or faster than its average.
    const shift = dPhi * barLengthAt(ownGrid, ownAt)
    this.post({ t: 'shift', s: shift })
    this.posSeconds = Math.min(Math.max(this.posSeconds + shift, 0), this.duration)
    return true
  }

  /**
   * Sync to another deck: toggles sync lock, matches tempo, and aligns beat phase within the bar.
   */
  syncTo(other: DeckEngine): { pitch: number; barAligned: boolean } | null {
    if (this._syncLocked) {
      this.setSyncLock(false)
      return null
    }

    // Match the *local* tempo of both decks, so coupling to a drifting master
    // tracks it instead of landing on its average.
    const ownBpm = this.localBpm
    const otherBpm = other.localBpm
    if (!ownBpm || !otherBpm) return null

    let rate = (otherBpm * other.rate) / ownBpm
    while (rate > 1.5) rate /= 2
    while (rate < 0.66) rate *= 2
    this.setRate(rate, true)

    let barAligned = false
    if (this._playing && other.playing && !this._scratching) {
      barAligned = this.alignPhaseTo(other)
    }

    this.setSyncLock(true, other)
    this.emit()
    return { pitch: (rate - 1) * 100, barAligned }
  }

  // ----- scratching (jog wheel) -----

  async scratchBegin() {
    if (!this.track) return
    this._cuePreviewing = false
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this._scratching = true
    this.updateKeyLockRouting()
    this.post({ t: 'scratchOn' })
  }

  scratchMove(rate: number) {
    if (!this._scratching) return
    this.post({ t: 'scratchRate', rate })
  }

  scratchEnd() {
    if (!this._scratching) return
    this._scratching = false
    this.updateKeyLockRouting()
    this.post({ t: 'scratchOff' })
  }

  // ----- FLUX / Slip Mode -----

  get fluxMode(): boolean {
    return this._slipMode
  }

  get slipMode() {
    return this._slipMode
  }

  setFluxMode(on: boolean) {
    this.setSlip(on)
  }

  toggleFluxMode() {
    this.setFluxMode(!this._slipMode)
  }

  setSlip(on: boolean) {
    this._slipMode = on
    this.post({ t: 'slip', on })
    this.emit()
  }

  get fluxPosition(): number {
    return Math.min(Math.max(this.ghostSeconds, 0), this.duration)
  }

  private fxDecayRaf: number | null = null

  async triggerBrake(durationMs = 700) {
    if (!this.track) return
    if (this.fxDecayRaf) {
      cancelAnimationFrame(this.fxDecayRaf)
      this.fxDecayRaf = null
    }
    const wasPlaying = this._playing
    if (!wasPlaying) return
    await this.scratchBegin()
    const start = performance.now()
    const isFlux = this._slipMode

    const step = () => {
      const elapsed = performance.now() - start
      const p = Math.min(1, elapsed / durationMs)
      // Exponential brake curve: motor deceleration
      const rate = Math.pow(1 - p, 2.5)
      this.scratchMove(rate)
      if (p < 1) {
        this.fxDecayRaf = requestAnimationFrame(step)
      } else {
        this.fxDecayRaf = null
        this.scratchEnd()
        if (isFlux) {
          // When FLUX is on: keep playing through from virtual timeline
          if (!this._playing) void this.play()
        } else {
          // When FLUX is off: really stop the track
          this.pause()
        }
      }
    }
    this.fxDecayRaf = requestAnimationFrame(step)
  }

  async triggerBackspin(durationMs = 950) {
    if (!this.track) return
    if (this.fxDecayRaf) {
      cancelAnimationFrame(this.fxDecayRaf)
      this.fxDecayRaf = null
    }
    const wasPlaying = this._playing
    if (!wasPlaying) return
    await this.scratchBegin()
    const start = performance.now()
    const isFlux = this._slipMode

    const step = () => {
      const elapsed = performance.now() - start
      const p = Math.min(1, elapsed / durationMs)
      // Real vinyl backspin: initial high reverse speed (-9.0), smooth deceleration
      const rate = -9.0 * Math.pow(1 - p, 2.4)
      this.scratchMove(rate)
      if (p < 1) {
        this.fxDecayRaf = requestAnimationFrame(step)
      } else {
        this.fxDecayRaf = null
        this.scratchEnd()
        if (isFlux) {
          // When FLUX is on: keep playing through from virtual timeline
          if (!this._playing) void this.play()
        } else {
          // When FLUX is off: really stop the track
          this.pause()
        }
      }
    }
    this.fxDecayRaf = requestAnimationFrame(step)
  }

  /**
   * SCR — forward cutter.
   *
   * Fires the recorded cutter loop once, played back at this deck's tempo so the
   * chop stays in time with the music, and at a level derived from whatever is
   * on the deck so it sits with the track rather than under it. It replaced a
   * synthesised 8-chop RAF pattern: a sketch built from a running playhead
   * cannot reproduce the detail the recording already carries (the hat grid, the
   * kick, the reverse bleed that makes a real cutter buzz rather than click).
   *
   * The sample is 2 beats at {@link CUTTER_SAMPLE_BPM}, so `playbackRate` is just
   * the tempo ratio — the loop then spans the same two beats it does at its own
   * tempo, whatever the deck is running at.
   *
   * Under QUANT the chop is *scheduled* rather than played: `source.start()` is
   * handed the context time of the next grid beat, so the alignment is sample
   * accurate. A `setTimeout` would have to be right about how long the main
   * thread is busy, and the chop would drift by however much it was not.
   */
  async triggerCutter() {
    if (!this.track) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    const buffer = await this.loadCutterSample()
    if (!buffer) return

    const t0 = this.ctx.currentTime

    // Re-press: retire whatever the last press left behind — fade a chop that is
    // sounding, cancel one that is still waiting for its beat.
    const prev = this.cutterVoice
    this.cutterVoice = null
    if (prev) this.retireCutterVoice(prev, t0)

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    // Rate 1.0 plays the buffer at its own sample rate whatever the context runs
    // at: the resampler lives inside the node, so there is no 44.1/48 kHz term
    // to correct for here.
    source.playbackRate.value = this.cutterPlaybackRate()

    const gain = this.ctx.createGain()
    gain.gain.value = this.cutterLevel()

    source.connect(gain)
    gain.connect(this.cutterGain)

    const startAt = t0 + this.cutterQuantizeDelay()

    source.onended = () => {
      if (this.cutterVoice?.source === source) this.cutterVoice = null
      try {
        source.disconnect()
        gain.disconnect()
      } catch {
        // Already torn down by the re-press path.
      }
    }

    source.start(startAt)
    this.cutterVoice = { source, gain, startAt }
  }

  /**
   * How far past a beat a press still counts as being *on* that beat.
   *
   * The deck's position runs ahead of what is coming out of the speakers by the
   * output latency — the worklet advances as it renders, and the rendered audio
   * is heard later. So a press made in time with the music reads as
   * `outputLatency` past the beat, and with a bare 35 ms window a slow output
   * path would push that press a whole beat late. Adding the latency back keeps
   * the window measured against what the user actually heard.
   */
  private cutterGraceSeconds(): number {
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0
    const allowance = Math.min(
      CUTTER_MAX_LATENCY_ALLOWANCE_S,
      Number.isFinite(latency) ? latency : 0,
    )
    return CUTTER_QUANT_GRACE_S + allowance
  }

  /**
   * How long to hold the chop so it lands on a grid beat.
   *
   * Zero — fire now — when QUANT is off, when the deck is not running, or when
   * the track has no grid: in each case there is no beat to wait for. Otherwise
   * the chop waits for the *next* beat rather than snapping back to the previous
   * one, so it never starts off-grid and never sounds before the press.
   *
   * A press inside the grace window ({@link cutterGraceSeconds}) counts as
   * already being on the beat and fires at once. That is the compromise that
   * keeps a press landing a few milliseconds early from being a whole beat late;
   * the chop then starts within tens of milliseconds of the beat, which is as
   * close as an instant response can be. Same rule the hot-cue quantiser uses.
   */
  private cutterQuantizeDelay(): number {
    if (!this.quantMode || !this._playing) return 0

    const grid = this.track?.grid
    if (!grid) return 0

    const pos = this.position
    // Phase measured from the previous grid beat, so a variable-tempo grid
    // resolves against the beat that is actually playing.
    const beatIndex = Math.floor(beatIndexAt(grid, pos))
    const elapsedInBeat = pos - beatTimeAt(grid, beatIndex)
    if (elapsedInBeat < this.cutterGraceSeconds()) return 0

    // Wait for the *next* beat's own time rather than a beat length from now:
    // on a drifting grid the local beat length is a windowed average, so
    // counting one out from the playhead lands a few milliseconds off the beat
    // it was aiming at. `beatTimeAt` extrapolates past the last detected beat,
    // so this is defined everywhere the playhead can be.
    const nextBeat = beatTimeAt(grid, beatIndex + 1)
    if (!(nextBeat > pos)) return 0

    // The playhead covers track time at `_rate` per second of real time, so the
    // wait has to be scaled by it or the chop lands late on a pitched deck.
    const rate = this._rate > 0 ? this._rate : 1
    return (nextBeat - pos) / rate
  }

  /**
   * Stop a chop. One that has not sounded yet is cancelled outright — it never
   * produced a waveform, so there is nothing to fade. One that is sounding is
   * faded instead, because a hard `stop()` mid-waveform clicks.
   */
  private retireCutterVoice(voice: CutterVoice, now: number) {
    try {
      if (voice.startAt > now) {
        // Stopping before the start time means the source never sounds.
        voice.source.stop(now)
        voice.source.disconnect()
        voice.gain.disconnect()
        return
      }
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
      voice.gain.gain.linearRampToValueAtTime(0, now + CUTTER_RETRIGGER_FADE_S)
      voice.source.stop(now + CUTTER_RETRIGGER_FADE_S)
    } catch {
      // Already stopped or never started — nothing left to retire.
    }
  }

  /**
   * Drop a chop that is waiting for its beat. The transport stopping is the one
   * thing that can make a scheduled beat never arrive, so a queued chop has to
   * go with it rather than sounding over a paused deck.
   */
  private cancelPendingCutter() {
    const voice = this.cutterVoice
    if (!voice || voice.startAt <= this.ctx.currentTime) return
    this.cutterVoice = null
    this.retireCutterVoice(voice, this.ctx.currentTime)
  }

  /**
   * Level for the chop so it sits with whatever is on the deck.
   *
   * The deck normalises the track with `track.gain`, so the track leaves the
   * channel at `track.loudness * track.gain`. The chop is a different recording
   * with its own loudness, so matching it means normalising the sample to that
   * same level. Applying the track's gain to the chop instead would be wrong in
   * both directions: a track that needed heavy attenuation would drag the chop
   * down with it, and the chop is not the thing that was too loud.
   *
   * The payoff is that the same sample sits correctly on a brickwalled master
   * and on a quiet one — the track's auto-gain already put both at the same
   * level, and the chop now follows that level instead of a fixed one.
   */
  private cutterLevel(): number {
    const track = this.track
    // `loudness` is absent on tracks analysed before it was recorded, so fall
    // back to the reference the auto-gain was aiming for.
    const trackLevel = track
      ? (track.loudness ?? TARGET_RMS) * (track.gain || 1)
      : TARGET_RMS

    if (!this.cutterLoudness || !trackLevel) return CUTTER_LEVEL_FALLBACK

    const level = (trackLevel * CUTTER_TRACK_LEVEL) / this.cutterLoudness
    return Math.min(CUTTER_GAIN_MAX, Math.max(CUTTER_GAIN_MIN, level))
  }

  /**
   * Playback rate that lands the cutter loop on this deck's tempo.
   *
   * The deck's own tempo wins: the chop is a scratch performed on *this* deck, so
   * it should match what the deck is playing. The Master Tempo field is only the
   * fallback for a deck with no track to read a tempo from.
   */
  private cutterPlaybackRate(): number {
    const bpm = this.effectiveBpm ?? this._masterBpm
    if (!bpm || bpm <= 0) return 1
    const rate = bpm / CUTTER_SAMPLE_BPM
    return Math.min(CUTTER_MAX_RATE, Math.max(CUTTER_MIN_RATE, rate))
  }

  /**
   * The cutter loop, fetched and decoded once per deck and kept for the session.
   *
   * Uses the same asset convention as `public/sounds/*.audio` — plain RIFF/WAVE
   * with a renamed extension, so the file is served as a static asset without the
   * dev server trying to hand it to a media element (see `src/lib/audioEngine.ts`).
   */
  private async loadCutterSample(): Promise<AudioBuffer | null> {
    if (this.cutterBuffer) return this.cutterBuffer
    if (!this.cutterLoad) {
      const url = `${import.meta.env.BASE_URL}sounds/cutter.audio`
      this.cutterLoad = fetch(url)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.arrayBuffer()
        })
        .then(bytes => this.ctx.decodeAudioData(bytes))
        .then(buf => {
          this.cutterBuffer = buf
          // Measured once here rather than on every press: it is a full pass
          // over the buffer, and the loop never changes. The loop is too short
          // for the track loudness measure, so it uses its plain RMS.
          this.cutterLoudness = measureLevel(buf)
          return buf
        })
        .catch(err => {
          console.warn('cutter sample failed to load:', err)
          // Allow a later press to retry rather than caching the failure.
          this.cutterLoad = null
          return null
        })
    }
    return this.cutterLoad
  }

  // ----- FX -----

  get fxType() {
    return this._fxType
  }

  get fxWet() {
    return this._fxWet
  }

  get fxBeats() {
    return this._fxBeats
  }

  setFx(type: FxType) {
    this._fxType = type
    const t = this.ctx.currentTime
    if (type === 'reverb' && !this.reverb.buffer) {
      this.reverb.buffer = makeReverbImpulse(this.ctx)
    }
    this.echoSend.gain.setTargetAtTime(type === 'echo' ? 1 : 0, t, 0.02)
    this.echoFeedback.gain.setTargetAtTime(type === 'echo' ? 0.55 : 0, t, 0.02)
    this.reverbSend.gain.setTargetAtTime(type === 'reverb' ? 1 : 0, t, 0.02)
    this.flangerSend.gain.setTargetAtTime(type === 'flanger' ? 1 : 0, t, 0.02)
    this.flangerFeedback.gain.setTargetAtTime(type === 'flanger' ? 0.45 : 0, t, 0.02)
    this.applyFxWet()
    this.updateFxTiming()
    this.emit()
  }

  setFxWet(wet: number) {
    this._fxWet = wet
    this.applyFxWet()
    this.emit()
  }

  setFxBeats(beats: number) {
    this._fxBeats = beats
    this.updateFxTiming()
    this.emit()
  }

  private applyFxWet() {
    const t = this.ctx.currentTime
    this.echoWet.gain.setTargetAtTime(this._fxType === 'echo' ? this._fxWet : 0, t, 0.05)
    this.reverbWet.gain.setTargetAtTime(this._fxType === 'reverb' ? this._fxWet * 1.2 : 0, t, 0.05)
    this.flangerWet.gain.setTargetAtTime(this._fxType === 'flanger' ? this._fxWet : 0, t, 0.05)
  }

  private updateFxTiming() {
    const bpm = this.effectiveBpm ?? 120
    const seconds = Math.min(this._fxBeats * (60 / bpm), 2)
    this.echoDelay.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.05)
  }

  // ----- beatgrid snap helper -----

  snapToBeat(time: number): number {
    if (!this.track) return time
    const grid = this.track.grid
    if (grid) {
      return Math.max(0, Math.min(snapToGridBeat(grid, time), this.duration))
    }
    const bpm = this.track.bpm
    if (!bpm || bpm <= 0) return time
    const beatLen = 60 / bpm
    return Math.max(0, Math.min(Math.round(time / beatLen) * beatLen, this.duration))
  }

  // ----- hot cues -----

  hotCueDown(index: number) {
    if (!this.track) return
    const existing = this.hotCues[index]
    if (existing === null) {
      // No cue set yet → set it at current position, don't play
      this.hotCues[index] = this.snapMode ? this.snapToBeat(this.position) : this.position
      this.emit()
      return
    }

    if (this._slipMode && this._playing) {
      // In FLUX mode: start playing from cue while virtual ghost continues
      this.post({ t: 'slipCueOn', s: existing })
      this.emit()
    } else {
      // Momentary cue-hold (CDJ behavior): seek to cue, play while held
      this._hotCueHoldIndex = index
      this._cuePreviewing = false
      this.seek(existing)
      if (!this._playing) void this.play()
    }
  }

  hotCueUp(index: number) {
    if (!this.track) return
    if (this._slipMode && this._playing) {
      // In FLUX mode: release back to ghost playhead
      this.post({ t: 'slipCueOff' })
      this.emit()
      return
    }
    // Momentary cue-hold: pause and return to cue point on release
    if (this._hotCueHoldIndex === index) {
      this._hotCueHoldIndex = null
      const cueTime = this.hotCues[index]
      this.pause()
      if (cueTime !== null) this.seek(cueTime)
    }
  }

  triggerHotCue(index: number) {
    if (!this.track) return
    this._cuePreviewing = false
    const existing = this.hotCues[index]
    if (existing === null) {
      // Snap newly created cue to nearest beat if snap mode is enabled
      this.hotCues[index] = this.snapMode ? this.snapToBeat(this.position) : this.position
      this.emit()
      return
    }

    // Skipping to existing cue point
    if (!this._playing || !this.quantMode) {
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.seek(existing)
      if (!this._playing) void this.play()
      return
    }

    // QUANT MODE active during playback: beat-accurate skipping between cue points
    const grid = this.track.grid
    const currentPos = this.position
    // Measure the phase from the previous grid beat so the queued jump lands on
    // a real beat, including on a variable-tempo grid.
    const beatLen = this.beatLengthAt(currentPos)
    const elapsedInBeat = grid
      ? currentPos - beatTimeAt(grid, Math.floor(beatIndexAt(grid, currentPos)))
      : currentPos % beatLen
    const timeUntilNextBeat = Math.max(0, beatLen - elapsedInBeat)

    // If clicked right on the beat (within 35ms of the beat onset), jump immediately in phase
    if (elapsedInBeat < 0.035) {
      if (this.quantizeTimer) {
        window.clearTimeout(this.quantizeTimer)
        this.quantizeTimer = null
        this.pendingQuantizedCue = null
        this.pendingQuantizedIndex = null
      }
      this.seek(existing + elapsedInBeat)
      return
    }

    // Otherwise, delay jump until the next beat boundary so it lands on beat
    if (this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
    }
    this.pendingQuantizedCue = existing
    this.pendingQuantizedIndex = index
    this.emit()

    const delayMs = Math.max(10, Math.min(1000, (timeUntilNextBeat / this._rate) * 1000))
    this.quantizeTimer = window.setTimeout(() => {
      this.quantizeTimer = null
      const target = this.pendingQuantizedCue
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
      if (target !== null && this._playing) {
        this.seek(target)
      }
      this.emit()
    }, delayMs)
  }

  clearHotCue(index: number) {
    if (this.pendingQuantizedIndex === index && this.quantizeTimer) {
      window.clearTimeout(this.quantizeTimer)
      this.quantizeTimer = null
      this.pendingQuantizedCue = null
      this.pendingQuantizedIndex = null
    }
    if (this.hotCues[index] !== null) {
      this.hotCues[index] = null
      this.emit()
    }
  }

  // ----- loops -----

  setBarLoop(bars: number) {
    if (!this.track) return
    const grid = this.track.grid

    // Snap start to nearest beatgrid downbeat/beat if snap mode is enabled
    const start = this.snapMode ? this.snapToBeat(this.position) : this.position
    // Walk the grid forward `bars` bars instead of multiplying a fixed bar
    // length, so a loop stays the right length on a drifting track.
    const beatsPerBar = grid?.beatsPerBar ?? 4
    const len = grid
      ? shiftBars(grid, start, bars) - start
      : bars * this.beatLengthAt(start) * beatsPerBar
    const end = Math.min(start + len, this.duration)
    this.loop = { start, end, bars }
    this.post({ t: 'loop', loop: this.loop })
    this.emit()
  }

  setLoop(start: number, end: number) {
    if (!this.track) return
    const snappedStart = this.snapMode ? this.snapToBeat(start) : start
    const snappedEnd = this.snapMode ? this.snapToBeat(end) : end
    const s = Math.max(0, Math.min(snappedStart, this.duration))
    const e = Math.max(s + 0.05, Math.min(snappedEnd > s ? snappedEnd : end, this.duration))
    this.loop = { start: s, end: e, bars: 0 }
    this.post({ t: 'loop', loop: this.loop })
    this.emit()
  }

  exitLoop() {
    this.clearLoop()
  }

  clearLoop() {
    this.loop = null
    this.post({ t: 'loop', loop: null })
    this.emit()
  }

  // ----- mixer channel controls -----

  private _gain = 1
  private _eqLow = 0
  private _eqMid = 0
  private _eqHigh = 0
  private _filter = 0

  get gain(): number {
    return this._gain
  }

  setGain(v: number) {
    this._gain = v
    this.trim.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
    this.emit()
  }

  get eqLowGain(): number {
    return this._eqLow
  }

  get eqMidGain(): number {
    return this._eqMid
  }

  get eqHighGain(): number {
    return this._eqHigh
  }

  setEqLow(dB: number) {
    this._eqLow = dB
    this.eqLow.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.01)
    this.emit()
  }

  setEqMid(dB: number) {
    this._eqMid = dB
    this.eqMid.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.01)
    this.emit()
  }

  setEqHigh(dB: number) {
    this._eqHigh = dB
    this.eqHigh.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.01)
    this.emit()
  }

  /**
   * Filter knob: -1 = full LPF (20Hz), 0 = off (bypass), +1 = full HPF (20kHz).
   */
  setFilter(norm: number) {
    this._filter = norm
    const t = this.ctx.currentTime
    if (Math.abs(norm) < 0.02) {
      this.filter.type = 'allpass'
      this.filter.frequency.setTargetAtTime(1000, t, 0.01)
    } else if (norm < 0) {
      this.filter.type = 'lowpass'
      const f = 20 * Math.pow(20000 / 20, 1 + norm)
      this.filter.frequency.setTargetAtTime(f, t, 0.01)
      this.filter.Q.setTargetAtTime(1.2, t, 0.01)
    } else {
      this.filter.type = 'highpass'
      const f = 20 * Math.pow(20000 / 20, norm)
      this.filter.frequency.setTargetAtTime(f, t, 0.01)
      this.filter.Q.setTargetAtTime(1.2, t, 0.01)
    }
  }

  /** Current filter knob value, -1..1 (negative low-pass, positive high-pass). */
  get filterValue(): number {
    return this._filter
  }

  setVolume(vol: number) {
    // Volume fader: squared curve for natural fader taper
    this.fader.gain.setTargetAtTime(vol * vol, this.ctx.currentTime, 0.01)
  }

  setCrossfadeGain(gain: number) {
    this.xfade.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01)
  }
}

function makeReverbImpulse(ctx: AudioContext, seconds = 2.2, decay = 2.8): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}
