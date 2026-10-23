# KeyBPM

**The open music Key & BPM database.** A fast, DJ-friendly web app for searching tracks and filtering them by BPM, musical key, Camelot notation or Open Key — inspired by duuzu's song key & bpm database.

> 🧠 **100% vibe-coded.** No planning docs, no hand-typed boilerplate — every feature here was built by describing what I wanted and iterating until the build passed.

- 🎧 Music-aware search: `128 11A`, `F#m 125-130`, `daft punk 8A`
- 🎚 Dense, sortable track table with URL-driven filters (every view is shareable)
- 🎹 Interactive Key Tool: Camelot & Open Key Wheel, scale/chord synth player, and harmonic theory
- 🤖 Client-side Key & BPM Detector: drag & drop any audio file for neural key detection (KeyNet / MusicalKeyCNN via ONNX Runtime Web) + Essentia.js tempo analysis — 100% private in-browser, no audio leaves your device
- 🎛 Mix Finder with **explainable** results (`Camelot +1`, `Same genre`, `Δ BPM`) — no black-box scores
- 📤 CSV / JSON export of any filtered view
- ✍️ Contribute & suggest corrections — Discord login + review queue
- 📱 Responsive: dense table on desktop, compact list on mobile
- 🌐 Static SPA + optional Cloudflare Worker API for auth / submissions

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173
```

```bash
npm run build     # type-check + production build → dist/
npm run preview   # serve the production build
npm run typecheck # tsc --noEmit
npm test          # grid, beat-tracker, mix-render and data-layer unit tests
npm run api:dev   # Cloudflare Worker API (wrangler) on :8787
```

Data import/export and API setup scripts are documented in the [data pipeline](docs/data-pipeline.md) and [API](docs/api.md) guides; the full list is in [`package.json`](package.json).

Vite proxies `/api` and `/auth` to `http://127.0.0.1:8787` in dev. Copy `.env.example` if you need a remote API base.

## Data

The dataset lives in **`data/tracks.json`** (canonical) and **`data/tracks.csv`** — plain, portable files you can diff in Git, load in Python, or consume from other tools. The app imports the JSON at build time; no database, no API server.

**Source:** ~19,150 tracks from *duuzu's song key & bpm 'database'* v10 (15 June 2025), keys and tempos worked out by ear, plus 8,797 tracks from a ten-source **Key Consensus Engine** export. Credit for the sheet goes to duuzu.

### Schema

```json
{
  "id": "aesop-rock-costco",
  "artist": "Aesop Rock",
  "title": "Costco",
  "bpm": 80,
  "key": "A minor",
  "camelot": "8A",
  "genre": null,
  "label": null,
  "release": null,
  "year": null,
  "duration": null,
  "source": "duuzu's key & bpm database v10",
  "confidence": null,
  "lastVerified": "2025-06-15"
}
```

`key`/`camelot` are `null` for tracks without a single key. Optional fields, omitted when empty: `bpmRaw` (tempo as listed, e.g. `"80/160"`), `mode` (dorian, phrygian…), `keyRaw`, `tuning`, `tags`, `keySource`/`bpmSource`, `submittedBy`/`lastEditedBy` (Discord), `verifiedAt`/`verifiedBy` (queue review), `notes`, `youtube`, and `sources` (`[{ id, key, url }]` per-source key reports rendered as clickable chips).

The app validates every record on load: malformed optional fields are dropped, and a record without an `id` or `artist` is skipped instead of crashing the app. Full field reference: [schema](docs/data-pipeline.md#schema).

### Adding tracks

1. Append a record to `data/tracks.json` (one record per line keeps diffs readable), or use **Contribute** (Discord login → review queue → `npm run data:apply-queue`).
2. Keep `camelot` consistent with `key` — the canonical mapping is in `src/types/track.ts`.
3. Run `npm run data:csv` to refresh the CSV.
4. IDs are slugs (`artist-title`) and must be unique. Note that re-running `data:import` overwrites manual edits to `tracks.json`.

**BPM field:** the Contribute form accepts exactly one tempo — `124`, `127.5`, a comma decimal (`132,9` → `132.9`), or the sheet's approximate notation (`~128` / `≈128` / `128*`, stored as `bpm` plus `bpmRaw`). Multi-tempo notations (`80/160`, `128-130`) are rejected — put those in `notes`. `src/lib/bpm.ts` holds the rule; `workers/api/src/validate.ts` enforces the same one server-side.

## Camelot compatibility

Implemented once in `src/lib/camelot.ts` (standard harmonic-mixing rules):

- **Same key** — `11A → 11A`
- **Adjacent** — ±1 on the same ring: `10A`, `12A`
- **Relative major/minor** — `11A → 11B`

## Mix scoring

`src/lib/mix.ts` — deterministic and explainable, never a mysterious percentage:

```
score = keyScore (same 40 · adjacent 32 · relative 28)
      + bpmScore (40 at Δ0, linear falloff to 0 at the tolerance edge)
      + genre 10 · label 10
```

Every result shows its reasons as chips, so the ranking is auditable.

## Beat & BPM analysis

`src/lib/dj/beatgrid.ts` is the analyzer behind the DJ player's grids. Every tempo and beat
path now shares one onset front-end (`src/lib/dj/spectral-flux.ts`):

- **24 log-spaced bands, equally weighted.** The three hand-tuned bands
  (`2.5 * low + mid + 0.6 * high`, previously duplicated in four places) are gone. Log
  spacing puts a roughly constant number of bands per octave, and because the flux is
  measured in log magnitude a quiet hi-hat band counts on the same footing as the kick. The
  sub-180 Hz group is still kept separately — a DJ grid is phase-anchored to the kick — but
  as the sum of the low bands rather than a magic multiplier.
- **The phase anchor is the kick *plus* the percussion** (`phaseEvidence`). Scoring the kick
  group alone locked the grid to a sub-bass on the offbeat on offbeat-bass house and techno —
  a half-beat-out grid, which the benchmark caught as F 0.000 with a 205 ms phase error and
  which is now F 1.000 with 0 ms. The two groups are each normalised to their own peak before
  they are added, because in log-magnitude flux a quiet hi-hat can change its band as much as
  a kick changes its own; comparing shapes rather than absolute levels is what makes the
  combination meaningful. A track with no low content degrades to percussion-only, which is
  the old fallback behaviour.
- **Ellis dynamic-programming beat tracking** (`src/lib/dj/beat-tracker.ts`), the algorithm
  MixCN and librosa use: a Gaussian-smoothed local score (σ = period/32), a cumulative score
  maximised with a `tightness = 100` squared-log transition penalty over a `[P/2, 2P]`
  window, then backtracked from the last supported peak. A rigid lattice cannot follow
  timing wobble, which is exactly what real drums, disco and vinyl rips have: on a synthetic
  track drifting 128 → 124 BPM the DP holds every beat (worst error ~10 ms) where a lattice
  at the mid-tempo drifts 355 ms by the outro. Both the Essentia path *and* the measurement
  fallback now run it, so the fallback is no longer the worse analyzer on exactly the material
  that needs the beat map.
- **The octave is decided by committee, not a BPM threshold** (`src/lib/dj/tempo-candidates.ts`).
  A reading under 85 BPM used to be doubled and one over 185 halved, which is how a 174 BPM
  drum-and-bass track came back as **86.9 BPM** — inside the "fine" band, so nothing doubled
  it, and the grid sat on every other beat. Now five in-process estimators vote (full-band and
  low-band autocorrelation, an inter-onset-interval histogram whose fundamental pulse commits
  on the octave, a comb filter, and the DP tracker's fitted tempo) plus Essentia when its
  kernel is loaded. The decision is measured: each octave hypothesis is scored by **onset
  coverage** — the fraction of the envelope's energy its lattice explains, so a half-tempo
  lattice that leaves half the onsets unexplained scores ~0.5 while the correct one approaches
  1.0 — then by whether an octave-committing estimator agrees, and only then by the DJ tempo
  prior. The winner and every losing hypothesis are stored on the track
  (`analysis.tempoCandidates`, `analysis.octaveDecision`), so a user who disagrees can see what
  the alternatives were instead of one opaque number.
- **Tempo is refined, not just measured.** A 0.1 % tempo error is invisible per beat and 4 s
  over a six-minute track, so the stored tempo is scanned on a ±1.2 % window in 0.04 % steps
  against the evidence envelope, re-optimising phase at each step (`refineTempoAndPhase`).
  This is what took the mean absolute grid error from 20 ms to 6 ms.
- **Bars, downbeats and drops are measured too, not assumed** (`src/lib/dj/bar-structure.ts`).
  Bar 1 used to *be* the first kick in the intro; a track whose intro starts on the fourth beat
  of a bar therefore kept every beat in the right place and put every bar line one beat out.
  All four rotations are now scored against three cues, in order of how much they can be
  trusted: the **bass note under the beat** (low-band energy after the kick has decayed — the
  only cue that survives a sparse kick pattern), the **kick/bass attack contrast** at one
  position versus the others, and the **snare pair**, which can only *rule out* rotations (a
  snare on 2 and 4 fits the bar either way, so it narrows the candidates and says so rather
  than flipping a coin). The same pass produces bar-aligned **drops** (the end of an intro or a
  breakdown) and groups bars into **phrases** from their spacing. All of it is stored on the
  grid — `downbeats[]`, `drops[]` and `barStructure: { rotation, rotationScores,
  rotationDecision, rotationDecided, rotationCandidates, phraseBars, phrases, drops }` — and
  rebuilt by every grid transform, so a manual BPM or bar-shift edit cannot leave bar markers
  describing the previous grid. The deck waveform draws the drops and the measured phrase
  boundaries.
- **Measurable quality, not a vibe.** Each analyzed grid carries
  `analysis: { rawBpm, bpmMultiplier, bpmSource, beatSource, fitResidual, contrast,
  retainedRatio, confidence, variable }`. `fitResidual` is the RMS of `ln(interval/period)`
  over the tracked beats (how periodic the performance is); `contrast` is the onset support
  of the fitted grid relative to the track's average; `confidence` is a documented, bounded
  combination of the two. It is a derived score and explicitly **not** calibrated against
  annotated recordings.
- **Half/double tempo is visible and reversible.** The analyzer used to double or halve a
  reading inline, overwriting the measurement. Now `rawBpm` and `bpmMultiplier` sit next to
  `bpm`, so `rawBpm = bpm / bpmMultiplier` always holds and the interpretation can be undone.
- **Variable-tempo grids** (`src/lib/dj/grid.ts`) hold per-beat positions for tracks that do
  not hold one tempo. The analyzer adopts one only when no single tempo fits the tracked
  beats within `constantToleranceSeconds` — **0.05 s**, down from 0.08: the tracker's tick
  noise is a few tens of milliseconds, so an 80 ms tolerance was accepting a genuinely
  wobbling track as "constant" (measured: a ±3 % wobbly live-drum pattern left a 67 ms
  residual, survived as a constant grid, and scored F 0.583; at 0.05 it gets a beat map and
  scores F 0.992). Machine-timed 4/4 keeps the fast constant grid and merely takes a refined
  BPM from the tracked beats.

**Measured, not asserted.** `npm run bench:beats` scores the stored grid against known beat
times with the literature's metrics (F-measure at 70 ms, continuity, grid drift) and runs in
CI with no browser and no downloads; [bench/README.md](bench/README.md) documents the corpus,
the gates and how to point it at Ballroom/SMC/Harmonix annotations:

| corpus (11 synthetic tracks) | before | now |
|---|---|---|
| mean F-measure, 70 ms | 0.772 | **0.993** |
| median continuity (CMLt) | 0.985 | **1.000** |
| mean absolute grid error | 42 ms | **6 ms** |
| downbeat match, 70 ms | not scored | **0.997** |
| bar lines a whole beat out | not scored (0 claimed) | **0 of 11** |
| annotated drops found | not scored | **2 of 2** |

The harness scores **both** analyzer paths, because the primary one is what the app runs. The
Essentia WASM kernel turned out to load in Node as well as in the browser, so it is scored
headlessly too — and it was measurably **worse than its own fallback**: mean F **0.626**
against 0.992, from an octave decided by an ad-hoc cross-check and a phase taken from
Essentia's tick list (three tracks landed half a beat off, 211–240 ms). Both paths now read
0.993, and both are gated: the primary path's decision layer — octave committee, phase
anchor, map guards — is ours, so a regression in it fails the build. The defects that round
found are itemised in [bench/README.md](bench/README.md).

Scoring the bar found three more, in the code the app was already running: the first-beat
anchor walked **three beats late** on jittery and accelerating material (bar 1 in the wrong
place on a track whose kick starts at 0:00, because a ±35 ms lattice window misses a beat that
has drifted 56 ms), every steady track reported a **spurious intro drop** at bar 1 (the
preamble it measured included 5 ms of the first kick, which made silence look like a ×3.4
energy arrival), and the metric that was supposed to catch bar errors compared each grid
against itself and always returned "correct". The bar gates now fail the build on a whole-beat
bar error, on a claimed rotation that is wrong, on a *decidable* rotation left undecided, and
on a drop that is missed or invented — the last two in both directions, because a wrong claim
is worse than an honest "unknown" and a marker that sends a mix looking for a change that is
not there is worse than no marker.

Those are synthetic tracks with click-accurate annotations, so they gate regressions and
cannot substitute for an annotated corpus — the harness reports the corpus it used and which
path it scored. Grid confidence is still a *derived* score rather than a probability
calibrated against annotations, and the benchmark is what will tell us how far off it is.

## Mixing and mix rendering

The DJ player (`/mix-it`) runs two decks through a realtime keylock stage, and the engine
behind it is an AudioWorklet — nothing about live keylock needs an offline render. A deck
plays the track through a vinyl worklet that does the resampling, so the keylock stage is a
pure pitch shift of an already time-compressed stream:

- **Rubber Band's `RealtimeRubberBand` R3 kernel is the live engine**
  (`public/rubberband-processor.js`, `src/lib/dj/rubberband-node.ts`). On a held ratio it is
  exact: 220.00 Hz at 1.30x, 261.62 Hz on a +3 st key shift (target 261.63). What made it
  unusable live sits in the *binding*, not the engine: `RealtimeRubberBand::setPitch`
  calls `fetchProcessed()` and then `stretcher_->reset()` before it applies the new ratio, so
  a change on a kernel that is being heard flushes its stretch pipeline. Measured on a 220 Hz
  tone that is ~20 ms of the old ratio, **~100 ms of silence**, ~15 ms unsettled, then exact
  pitch — and at 10 changes/s the wet path was silent in 95 % of monitored windows.
- A deck therefore keeps **two** kernels. The audible voice is never retuned: a new ratio is
  prepared on the idle voice and faded in once that voice is producing audio again (a
  handover waits for the hole above and for signal to come back through it, which is what
  makes it a handover rather than a click into silence), aimed where a moving fader is
  heading by its measured slew. Through the real deck a 3 s, 8 % sweep measured **0 silent
  windows out of 304**, the key held to a median of 7.7 cents while the fader moved, a worst
  handover glide of 16–20 cents, and **≤2.3 cents a couple of seconds after the fader
  stopped** (re-measured on the final code: −1.7 cents held at 1.30x, −0.2 at 1.38x) — a
  settle handover chases the last couple of cents once the input goes quiet, so a reading
  taken *during* that settle is a few cents off.
- It runs in **high quality**, the only mode with exact pitch — the fast mode measured
  **+43 cents at 1.30x and −21 cents at 2.00x**. A high quality voice is not free (measured
  ceiling on this machine: six voices clean, eight overloading the render thread), so a deck
  only ever holds its two. Cold start costs 61 ms of dry audio before the keylocked path
  takes over.
- **SoundTouch used to be the alternative, and has been removed.** On steady signals the two
  are indistinguishable in the artefact that matters (level modulation within 0.03 dB of each
  other on tone, saw and noise), so the choice came down to the two things that are not a tie:
  SoundTouch's pipeline is ~133 ms of buffering against Rubber Band's fixed 4096 samples, and
  SoundTouch cannot hold pitch *exactly* at a held ratio where Rubber Band can. The realtime
  SoundTouch worklet, its toggle and `@soundtouchjs/audio-worklet` are gone with it.
- Keylock is bypassed whenever the transform is within a cent of unity, which is both the
  cheaper answer and the correct one: at unity a time-stretcher has nothing to align and its
  window re-timing becomes audible warble. See `KEYLOCK_UNITY_CENTS` in
  `src/lib/dj/keylock-transform.ts` for the measurement that pinned it.

The keylock stage holds the audio back by its own buffer — 4096 samples, 85 ms at 48 kHz — so
the deck's *read head* (`position`) runs ahead of what you hear. Anything drawn against "where
the track is right now" (the stacked lanes, the beat counters) uses `audiblePosition`
instead, and sync compares audible positions for the same reason. Otherwise both decks would
be a fraction of a beat early with keylock on and correct with it off, which reads as the two
grids not lining up. See `keyLockLatencySeconds` for how that figure was measured.

That figure is a *flat* 4096 samples, and a step-response measurement shows it is only flat
while a deck is at or below its own tempo: pitched up to 1.25x the real pipeline is ~4770
samples (99 ms), 14 ms more than the constant. Two keylocked decks or two dry decks share that
error and cancel it, but a **mixed** pair — one keylocked and pitched, one straight — does not,
so it lands on the sync as the keylocked deck sitting those few ms off. The measurement and the
reason the shape is not modelled are in `keylock-transform.ts`.

Live playback runs on a deliberately generous output buffer. The deck built its `AudioContext`
with `latencyHint: 'interactive'`, which on this machine's real WASAPI device is a 480-frame
block — 10 ms base / 40 ms output latency — and that 10 ms is the whole tolerance the render
thread has for being late. Anything longer (a Windows DPC, a driver interrupt, a background app
spiking a core, the renderer doing a heavy layout) drops samples, which is heard as the
intermittent glitching this was chasing. The keylock voices are not the cause: measured offline,
four high-quality Rubber Band kernels render at ~100x realtime, so under 1 % of a core each.

So `src/lib/dj/audio-latency.ts` asks for 30 ms (1440 frames, 64 ms output) by default, three
times the slack for a few ms more monitor latency, and takes `keybpm:audio-latency` in
localStorage as either a level — `tight` (10 ms), `balanced` (30 ms), `safe` (60 ms) — or a
number of seconds, clamped to 0.01–0.2. It is read once, when the engine builds its context, so a
change applies on the next page load. The effective figure is on the engine as
`bufferLatencyMs`.

Phones and tablets get `safe` (60 ms) rather than `balanced`, because that is where the deadline
is both slower and shrinking: the same graph renders on a few watts, the SoC throttles its clocks
over the first minutes of sustained playback, and the main thread is meanwhile repainting a 60 Hz
canvas console. The stored override still wins, so `keybpm:audio-latency = balanced` puts a phone
back on the desktop default.

That main thread was doing more work than it needed to, which is the other half of the same
problem. Two waveform lanes were filled one `fillRect` at a time — around 3,000 canvas calls per
frame at landscape-phone widths — the vinyl worklet reported its position 187 times a second per
deck (three times what a display can show, each report a callback on the main thread), and the canvases
asked for 3x device pixels for a console that is drawn scaled *down*. `StackedWaveforms` and
`MiniWaveform` now fill four paths instead of three thousand rectangles, the worklet reports at
~60 Hz and stays quiet while a deck is stopped, and `canvas-dpr.ts` stops the backing store at
2x. The kiosk console also holds a screen wake lock while something is playing
(`wake-lock.ts`): Web Audio does not get the "this is playback" treatment a media element does,
and a phone that dims mid-set is a phone that starts dropping clocks.

Two more of those costs only matter once both decks are running, which is exactly when a phone
starts glitching. `src/lib/dj/device-profile.ts` spends frame rate rather than audio quality on
a hand-held device, with `keybpm:handheld` = `1` / `0` in localStorage forcing either profile
(read once, so a reload applies it — that is how the phone path is exercised on a desktop):

- **Playhead reports arrive at 30 Hz instead of 60.** The rate is passed to the vinyl worklet in
  its `load` message. Every report crosses the worklet port, runs a callback and re-renders the
  console; two decks playing is twice as many of them, and 30 Hz still reads as smooth motion
  for a playhead.
- **The lanes and the strip waveforms redraw every second frame.** Both clear and repaint their
  whole surface, grid, peaks and playhead included, so on a phone they were the single largest
  consumer of a frame.

Independently of the device, deck notifications are now batched into **one animation-frame
flush** (`pendingEmits` in `deck-engine.ts`). Ten components subscribe to each deck with
`setVer(v => v + 1)`, so two reports from two decks used to mean two separate React passes per
frame; they now share one. A hidden tab has no animation frames and flushes synchronously
instead, so state still settles with nothing to draw.

Keylock is deliberately left at two voices per deck on a phone. Measured through the real
`rubberband-processor.js`, four high-quality kernels cost under 1 % of a core each, which is an
order of magnitude below the main-thread work above; the spare voice is what keeps a pitch move
from dropping out, and buying CPU that was not the bottleneck with an audible artifact would be
the wrong trade.

### Playhead jumps no longer click

SYNC's bar alignment can move a deck's read head by most of a bar in one sample, and a seek, hot
cue, beat jump or slip's return do the same. A step like that is a discontinuity in the waveform
— on a sustained bass note it is a full-scale step, heard as a click, and sync is exactly when
both decks are in the mix. The vinyl worklet now renders every such jump as a **4 ms equal-power
crossfade**: the outgoing stream stays audible for those 4 ms while the incoming one fades in
from the target, so the head lands on the target instead of stepping to it. A jump that arrives
mid-crossfade is queued behind it, a stopped or scratched deck lands immediately (there is no
audio to hide), and pausing mid-crossfade lands the jump rather than resuming it on the next
play. `scripts/test-vinyl-declick.mjs` extracts the real processor, renders a sine through it and
asserts that no sample-to-sample step across a jump exceeds twice the sine's own slope, that the
undeclicked step would have been more than ten times that, and that the deck lands on the target
and plays on. It is part of `npm test`.

Recording a mix does **not** capture audio. It captures what the decks *did* — per deck:
where the audio read from, how fast (the pitch fader's value, with any seek recorded as a
segment break), the channel gain, three-band EQ, filter and key shift — then rebuilds the
performance offline in an `OfflineAudioContext`:

- Keylocked sections are stretched again offline by a **selectable engine**: **Rubber Band
  R3** by default, with the **SoundTouch core** as an automatic fallback (either can be
  forced from the MIX RENDER control, which also reports which engine wrote the file).
  Here the worklet route is closed: during a render the node's `port` messages never reach
  the render thread (the same dead channel that made the SoundTouch worklet ignore its own
  window settings offline, back when it was still wired up), so `src/lib/dj/rubberband-offline.ts` takes the engine class out
  of the app's own processor asset and drives it synchronously on the main thread,
  128-frame block by 128-frame block. Measured on marker signals at 48 kHz, Rubber Band's
  alignment error is +0.1 ms at speed 1.0, +1.0 ms at 1.25 and −2.4 ms at 0.8, its length is
  within 0.15 %, and it renders at about a third of realtime. It handles key shift and tempo
  in one pass, so a shifted keylocked segment is resynthesised once rather than twice.
- The SoundTouch core remains for `stretchEngine: 'soundtouch'` and for hosts where the
  Rubber Band engine cannot load; it runs on the main thread through `@soundtouchjs/core`,
  where the WSOLA windows and the exhaustive seek search are actually applied. Rendered from
  the same captured 5 s performance, both engines produce the same length (5.255 s, frames
  within four samples) and level (RMS 0.069 against 0.070), so the choice is about sound, not
  arrangement.
- Keylock off is plain varispeed: segments are resampled by the source node itself.
- Everything is therefore rendered at the track's own sample rate, then mixed at the
  context rate, and written as 24-bit WAV — no Opus, no dropouts.

The stretch/build/render logic is `src/lib/dj/mix-timeline.ts`, `offline-stretch.ts`,
`mix-renderer.ts` and `wav.ts`, with `npm test` covering segment building, the stretcher
(identity, timing, keylock pitch, pitch shift) and the WAV encoder.

### The phone console

Below 1024 px the console replaces the page and is fitted to the viewport by
`use-console-fit.ts`: the chassis keeps its 1156 px hardware geometry and a transform scales
it, because reflowing a two-deck controller for a 360 px phone shrinks every control below
a tappable size. The layout is then arranged so that scale is as large as the screen allows.
On a landscape phone the fit is **width-bound**, so the console is given the height that makes
1156 design px fill the box — it fills the screen edge to edge. That height is clamped
(`KIOSK_MIN_CONSOLE_H`..`KIOSK_MAX_CONSOLE_H`), and it is spent by one row: everything but the
waveform band is a fixed height, so the band takes the remainder. Making the *band* the flexible
row is what bought the controls their size — the deck row used to be the flexible one, and on
a 19.5:9 phone it took 312 design px for a 196 px jog wheel. A few things differ between the
desktop and phone arrangements:

- The **phone's controls are sized for a thumb, not scaled down from the desktop's.** The deck
  grows a 64 px pitch well with a 40 px fader cap, and its platter shrinks from 236 to 220 of
  the row's 250 — so the jog sits *inside* the row with air around it rather than filling it.
  The mixer's own columns widen to 36 / 54 / 172 / 54 / 36 (402 px in all) to carry 50 px EQ
  and filter knobs, and the transport bar is 82 px tall for a 52 px key row: play is 56 px, and
  CUE is a full-height key the width of SYNC with its label turned 90°, reading bottom to top.
- The **waveform band absorbs the leftover height**, between a floor of
  `KIOSK_LANE_BAND_FLOOR_H` (two 72 px lanes) and a ceiling of
  `KIOSK_LANE_BAND_MAX_H` (two 125 px lanes). It keeps the full width and every
  control — rewind to start, set downbeat, ±10 ms nudge and the GRID dropdowns. The ceiling is
  set on the band so that a tall box cannot turn the console into a waveform display, and it
  moves with the deck row, so a trim on the waveforms applies to every screen rather than only
  to the ones filling theirs. The deck row below it is a fixed `KIOSK_DECK_ROW_H` of 250 — the
  platter's row, and the waveform's counterweight: the band takes exactly the height the fixed
  rows leave, so a trim on the waveforms is height the console above and below them spends
  instead.
- The **empty-lane A/B badge is drawn at its design size through the chassis scale**
  (`laneBadge(laneH, uiScale)`), so it shrinks with the console exactly like the A/B on the
  artwork squares. A fixed size was the one mark on the waveform that did not, and on a phone
  it ended up the loudest thing in the lane.
- The console's only chrome is a **side rail**: a menu button and a fullscreen toggle,
  40 design px square — the deck load button's artwork size — level with it, and sitting in
  the band kept clear on each side, *outside* the chassis. Outside is the point: on a phone
  the corners are rounded and the cutout is on one flank, so a control drawn in the corner
  of the chassis would be clipped. The band is `max(env(safe-area-inset-*), 5.2vw)` per
  side, which is why the console fills roughly 90% of a phone's width rather than all of
  it. The site header stays hidden on this route below 1024 px, so no bar is needed and the
  rail costs the fit nothing vertically. The menu opens the site's navigation in a left
  sheet drawn in real CSS pixels — a menu does not need to shrink with the chassis, and 44
  px rows stay 44 px rows.
- **Fullscreen has a button now**, so the Android system popup is no longer the only way
  in or out. The portrait rotate prompt still offers it too, because asking is a gesture
  and rotating is not.
- The **lane controls keep their drawn size but take a bigger tap**: at the phone fit they
  are 15–17 CSS px, so each one covers itself with a transparent pseudo-element that adds
  9 px above and below (`TAP_PAD` in `StackedWaveforms.tsx`), and a couple more sideways
  where the row has room. The ±10 ms pill's label is part of that target too — its left half
  nudges earlier, its right half later. All of it is `max-lg`, the same breakpoint as kiosk
  mode, so desktop is untouched. The **waveform zoom − / +** pair on the seam is the one
  control spaced for the thumb rather than for the mock-up: 24 px buttons 112 px apart,
  which is the widest gap on the console. The playhead runs through the middle of it, so
  the space is where the needle is read — and at the phone fit it is ~75 CSS px of it,
  which is what keeps a thumb off the wrong zoom step.
- The **FX drawer floats over the metadata strip** on a phone instead of taking a row of its
  own, because the rows are already at their floors.
- **Fullscreen is re-asked while a dialog is up.** The browser owns the exit: on Android the
  file picker is a separate activity and the keyboard takes the bottom of the screen, so
  opening the load dialog can drop the console out of fullscreen and bring the address bar
  back. The page cannot refuse that, but it can ask again inside a gesture — so while the load
  dialog, the analysis dialog or the FX drawer is open, a lost fullscreen re-arms one request
  on the next tap (plus an immediate attempt, which catches the tap that opened the dialog
  itself), and for three seconds after they close. Outside that window a deliberate exit via
  Android's system popup is left alone. See `useFullscreenKeeper` in `src/lib/fullscreen.ts`.

A phone held upright still opens on the rotate prompt; a portrait tablet fits the same console
into the screen it has. It cannot grow past `KIOSK_MAX_CONSOLE_H` there — the fit is
width-bound anyway, and the band at its ceiling is as tall as the waveforms are allowed to get
— so the leftover height is left as margin rather than spent on a two-deck waveform display.

## Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · React Router 6 · ONNX Runtime Web · Essentia.js (WASM) · Web Audio API. Optional API: Cloudflare Workers + D1 ([`workers/api`](workers/api)).

## Docs

- **[Data pipeline](docs/data-pipeline.md)** — sheet import, Soundiiz / TuneMyMusic matching, the Key Consensus Engine and source key listings.
- **[API & Discord auth](docs/api.md)** — local setup, the contribution queue, review/verification and the activity feed.

## Deploy (free)

### Cloudflare Pages (recommended)

1. Push this repo to GitHub.
2. Cloudflare Dashboard → **Pages → Create project → Connect to Git**.
3. Framework preset: *None* · Build command: `npm run build` · Output directory: `dist`.
4. Done. Every `git push` redeploys.

`wrangler.jsonc` sets `assets.not_found_handling: single-page-application`, so deep links like `/track/<id>` are served `index.html` (Cloudflare Pages projects get the same behaviour from a `_redirects` rule).

### Continuous integration

`.github/workflows/ci.yml` runs `npm ci && npm run build` on every push to `main` and on pull requests — a compile/typecheck gate, not a deploy. To build for a sub-path locally (GitHub Pages style): `BASE_PATH=/keybpm/ npm run build`.

### Version numbering

The chip next to **Mix it!** reads `v<package.json version>.<build number>` — for example
`v1.0.1.175`. The last segment advances by one on every commit; nothing is bumped by hand.

Two files are involved, and both are committed:

- `build-number` holds the ordinal of the commit that carries it.
- `.githooks/pre-commit` rewrites and stages `build-number` before each commit. `npm install`
enables it (`core.hooksPath = .githooks` via `npm run prepare`), so a fresh clone is set up by
the normal install step. If `core.hooksPath` is already configured for something else, the
installer leaves it alone and prints a note.

Why the file exists at all: hosted builders clone shallowly — Cloudflare Pages fetches a single
commit, and `actions/checkout` defaults to `fetch-depth: 1` — so `git rev-list --count HEAD`
returns 1 there and the deployed chip used to read `v1.0.1.1` forever. A full clone still uses
git's own count (and ignores the file); a shallow clone reads the committed number. The tooltip
on the chip carries the commit SHA, branch, exact build time and a warning when the bundle was
built from uncommitted changes.

Commit with `--no-verify` (or edit files straight on GitHub) and the file will not advance; the
next normal commit picks the count back up from git's history, so it self-corrects. Note that
`git commit --amend` leaves the counter one ahead for that commit, which only shows in shallow
builds.

## Project structure

```
├── .github/workflows/    # CI build check (Cloudflare does the deploy)
├── .githooks/            # pre-commit: advances build-number for the version chip
├── data/                 # portable dataset (tracks.json, tracks.csv)
├── docs/                 # data pipeline + API guides
├── public/               # static assets, ONNX neural key model & WASM binaries
├── scripts/              # import/export + apply_submissions
├── workers/api/          # Discord OAuth + D1 submission queue (Wrangler)
├── src/
│   ├── components/       # KeyTagger, Header, SearchBar, FilterBar, TrackTable, KeyWheel…
│   ├── pages/            # Home, Browse, Track, KeyTool, MixFinder, Contribute, Review…
│   ├── lib/              # keyDetector (ONNX), bpmDetector (Essentia), cqt, audioEngine, mix, search…
│   │   └── dj/           # decks, log-band onset + Ellis DP beat tracker, beat grids,
│   │                     # mix capture, offline mix renderer (Rubber Band / SoundTouch)
│   └── types/            # Track model + key maps
├── AGENTS.md             # product spec
└── README.md
```

## License

MIT
