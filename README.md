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
- **Ellis dynamic-programming beat tracking** (`src/lib/dj/beat-tracker.ts`), the algorithm
  MixCN and librosa use: a Gaussian-smoothed local score (σ = period/32), a cumulative score
  maximised with a `tightness = 100` squared-log transition penalty over a `[P/2, 2P]`
  window, then backtracked from the last supported peak. A rigid lattice cannot follow
  timing wobble, which is exactly what real drums, disco and vinyl rips have: on a synthetic
  track drifting 128 → 124 BPM the DP holds every beat (worst error ~10 ms) where a lattice
  at the mid-tempo drifts 355 ms by the outro.
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
  beats (`constantToleranceSeconds = 0.08`), so machine-timed 4/4 keeps the fast constant grid
  and merely takes a refined BPM from the tracked beats.

Measured in the browser on synthetic material: a steady 128 BPM track reports confidence
**0.97** with a 0.005 residual; the same track with ±25 ms humanised jitter reports **0.61**
and 0.031; jitter alone never flips a track to a variable grid; and a 128 → 124 BPM drift
produces a variable grid (`variable: true`) whose beats hold the tempo.

## Mixing and mix rendering

The DJ player (`/mix-it`) runs two decks through a realtime keylock stage, and both engines
behind it are AudioWorklets — nothing about live keylock needs an offline render. A deck
plays the track through a vinyl worklet that does the resampling, so the keylock stage is a
pure pitch shift of an already time-compressed stream:

- **SoundTouch is the live engine.** A deck changes pitch constantly (fader, nudge, sync
  PLL, key shift) and SoundTouch takes pitch as an AudioParam, so those changes ramp
  instead of restarting anything. Measured through the real `DeckEngine` against a 220 Hz
  tone: 220.1 Hz at 1.30x (+1 cent), and over a 2 s, 8 % fader sweep the key held to a
  median of 1.1 cents (p90 2.4) with **no** window below the noise floor.
- **Rubber Band's `RealtimeRubberBand` kernel is the accurate one, and is now a live engine
  too** (`public/rubberband-processor.js`, `src/lib/dj/rubberband-node.ts`). On a held ratio
  it is exact: 220.00 Hz at 1.30x, 261.62 Hz on a +3 st key shift (target 261.63). What made
  it unusable live sits in the *binding*, not the engine: `RealtimeRubberBand::setPitch`
  calls `fetchProcessed()` and then `stretcher_->reset()` before it applies the new ratio, so
  a change on a kernel that is being heard flushes its stretch pipeline. Measured on a 220 Hz
  tone that is ~20 ms of the old ratio, **~100 ms of silence**, ~15 ms unsettled, then exact
  pitch — and at 10 changes/s the wet path was silent in 95 % of monitored windows.
- A deck therefore keeps **two** kernels. The audible voice is never retuned: a new ratio is
  prepared on the idle voice and faded in once that voice is producing audio again (a
  handover waits for the hole above and for signal to come back through it, which is what
  makes it a handover rather than a click into silence), aimed where a moving fader is
  heading by its measured slew. Through the real deck a 3 s, 8 % sweep measured **0 silent
  windows out of 304**, the key held to a median of 7.7 cents while the fader moved (against
  1.1 for SoundTouch), a worst handover glide of 16–20 cents, and **≤2.3 cents a couple of
  seconds after the fader stopped** (re-measured on the final code: −1.7 cents held at 1.30x,
  −0.2 at 1.38x) — a settle handover chases the last couple of cents once the input goes
  quiet, so a reading taken *during* that settle is a few cents off.
- Two details make that affordable. It runs in **high quality**, the only mode with exact
  pitch — the fast mode measured **+43 cents at 1.30x and −21 cents at 2.00x** — and the
  spare voice exists only while Rubber Band holds the key, because a high quality voice is
  not free (measured ceiling on this machine: six voices clean, eight overloading the render
  thread, and a two-deck mix with spares would be four). Selecting Rubber Band costs 61 ms of
  dry audio before the keylocked path takes over, switching back is instant, and
  `engine.setKeyLockEngine('soundtouch' | 'rubberband')` flips both decks together.
  SoundTouch stays the default: it tracks a fader far more tightly for half the voices.

Recording a mix does **not** capture audio. It captures what the decks *did* — per deck:
where the audio read from, how fast (the pitch fader's value, with any seek recorded as a
segment break), the channel gain, three-band EQ, filter and key shift — then rebuilds the
performance offline in an `OfflineAudioContext`:

- Keylocked sections are stretched again offline by a **selectable engine**: **Rubber Band
  R3** by default, with the **SoundTouch core** as an automatic fallback (either can be
  forced from the MIX RENDER control, which also reports which engine wrote the file).
  Here the worklet route is closed: during a render the node's `port` messages never reach
  the render thread (the same dead channel that makes the SoundTouch worklet ignore its own
  window settings offline), so `src/lib/dj/rubberband-offline.ts` takes the engine class out
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

## Project structure

```
├── .github/workflows/    # CI build check (Cloudflare does the deploy)
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
