# KeyBPM

**The open music Key & BPM database.** A fast, dark, DJ-friendly web app for searching tracks and filtering them by BPM, musical key, Camelot notation, genre, label and year — inspired by the useful parts of a well-maintained spreadsheet, without the spreadsheet.

> 🧠 **100% vibe-coded.** No planning docs, no hand-typed boilerplate — every feature here was built by describing what I wanted and iterating until the build passed.

- 🎧 Music-aware search: `128 11A`, `F#m 125-130`, `house 2023`, `label:nordlys`
- 🎚 Dense, sortable track table with URL-driven filters (every view is shareable)
- 🎹 Interactive Camelot Key Wheel with harmonic compatibility
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
npm test          # data-layer unit tests
npm run api:dev   # Cloudflare Worker API (wrangler) on :8787
```

Data import/export and API setup scripts are documented in the [data pipeline](docs/data-pipeline.md) and [API](docs/api.md) guides; the full list is in [`package.json`](package.json).

Vite proxies `/api` and `/auth` to `http://127.0.0.1:8787` in dev. Copy `.env.example` if you need a remote API base.

## Data

The dataset lives in **`data/tracks.json`** (canonical) and **`data/tracks.csv`** — plain, portable files you can diff in Git, load in Python, or consume from other tools. The app imports the JSON at build time; no database, no API server.

**Source:** ~19,150 tracks from *duuzu's song key & bpm 'database'* v10 (15 June 2025), keys and tempos worked out by ear, plus 8,797 tracks from a ten-source **Key Consensus Engine** export. Credit for the sheet goes to duuzu — get their permission before publishing it.

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

## Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · React Router 6. Optional API: Cloudflare Workers + D1 ([`workers/api`](workers/api)).

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
├── scripts/              # import/export + apply_submissions
├── workers/api/          # Discord OAuth + D1 submission queue (Wrangler)
├── src/
│   ├── components/       # Header, SearchBar, FilterBar, TrackTable, KeyWheel, badges…
│   ├── pages/            # Home, Browse, Track, Contribute, Review, Mix, Key Wheel, About
│   ├── lib/              # camelot, search, mix, data, auth, api, contributions…
│   └── types/            # Track model + key maps
├── AGENTS.md             # product spec
└── README.md
```

## License

MIT
