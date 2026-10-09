# KeyBPM

**The open music Key & BPM database.** A fast, dark, DJ-friendly web app for searching tracks and filtering them by BPM, musical key, Camelot notation, genre, label and year — inspired by the useful parts of a well-maintained spreadsheet, without the spreadsheet.

- 🎧 Music-aware search: `128 11A`, `F#m 125-130`, `house 2023`, `label:nordlys`
- 🎚 Dense, sortable track table with URL-driven filters (every view is shareable)
- 🎹 Interactive Camelot Key Wheel with harmonic compatibility
- 🎛 Mix Finder with **explainable** results (`Camelot +1`, `Same genre`, `Δ BPM`) — no black-box scores
- 📤 CSV / JSON export of any filtered view
- ✍️ Contribute & suggest corrections — Discord login + review queue (v2 API)
- 📱 Responsive: dense table on desktop, compact list on mobile
- 🌐 Static SPA + optional Cloudflare Worker API for Discord auth / submissions

## Quick start:

```bash
npm install
npm run dev       # http://localhost:5173
```

Other commands:

```bash
npm run build     # type-check + production build → dist/
npm run preview   # serve the production build
npm run typecheck # tsc --noEmit
npm run data:import # re-import duuzu's sheet export → data/tracks.json + data/tracks.csv
npm run data:csv    # re-export data/tracks.csv from the JSON
npm run data:seed     # regenerate the small fictional test set → data/seed-tracks.json
npm run data:soundiiz # unique Artist - Title list for Soundiiz YouTube matching → data/soundiiz/
npm run data:apply-queue # merge approved Discord submissions into data/tracks.json
npm run api:dev       # Cloudflare Worker API (wrangler) on :8787
```

Vite proxies `/api` and `/auth` to `http://127.0.0.1:8787` in dev. Copy `.env.example` if you need a remote API base.

## Data

The dataset lives in **`data/tracks.json`** (canonical) and **`data/tracks.csv`** — plain, portable files you can diff in Git, load in Python, or consume from other tools. The app imports the JSON at build time (as its own cacheable chunk); no database, no API server.

**Source:** ~19,150 tracks from *duuzu's song key & bpm 'database'* v10 (15 June 2025), keys and tempos worked out by ear. Credit for the data goes to duuzu — get their permission before publishing it.

### Importing a new sheet version

1. In Google Docs: **File → Download → Markdown (.md)**.
2. `npm run data:import -- "path/to/export.md"` (defaults to the v10 file in the repo root).

`scripts/import_duuzu.mjs` reads each `• Artist - Title (…) (BPM)` line under its key heading and peels the trailing brackets: notes after the BPM, the BPM group (`~75/150`), then key/mode/tuning (`Aphr+30`), flags (`inst`/`aca`/`perc`) and notes (`some Dmin`). The first bracket it doesn't recognise stays in the title, e.g. `(umru remix)`. Track IDs are slugs of artist + title, so they stay stable across re-imports.

### Soundiiz (YouTube URLs)

`npm run data:soundiiz` writes unique `Artist - Title` rows to `data/soundiiz/` (untitled tracks skipped, duplicate listings collapsed). In Soundiiz: **Playlists → Import Playlist**.

- **From File** → `all.csv` (columns `title,artist`) — preferred; titles may contain ` - `
- **From Plain Text** / **From File** → `all.txt` — one `Artist - Title` per line
- Files must be **under 2 MB** and imported **one at a time**. If the import times out, use `part-01.csv` … instead (2000 rows each)

Soundiiz Free transfers **200 tracks at a time** to YouTube. Drop the Soundiiz/YouTube CSV export in `data/soundiiz/export/` (keep the `part-NN.csv` name), then:

```bash
npm run data:youtube        # merge new matches (never overwrites existing)
npm run data:youtube:reset  # clear all youtube fields, then rematch every export
```

Matching is scoped per `part-NN.csv` (no cross-part guesses). Artist + title must agree; remix names must match; wrong hits (interviews, kids’ songs) are left unmatched.

### Gathered results (Soundiiz / TuneMyMusic)

When the source is a hand-collected batch of tracks that have no YouTube link yet — so there is no original `part-NN.csv` to align against — drop the downloaded CSVs in a directory of their own and use `--gathered`:

```bash
npm run data:tunemymusic:gathered   # reads data/export-tunemymusic/to-import/*.csv, refreshes the CSV
```

Every export row is scored against the whole catalogue, but only rows whose best match still lacks a link are assigned: a lookup for a track that is already linked counts as a duplicate rather than an excuse to link a sibling row. Exact score ties are broken by how much of a row's own wording the export repeats, which is what stops `Plaza Speakers K` from taking `Plaza Speakers L`'s video and `New You (Headspace)` from taking the `(Shella Fresh)` one. Existing `youtube` values are never overwritten, so re-running is safe (a second run matches 0).

`--dry` reports what would change without writing; `--debug` prints the score spread, near misses and a per-row `--probe=<text>` breakdown.

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

`key`/`camelot` are `null` for tracks without a single key. Optional fields (omitted when empty):

| Field | Purpose |
| --- | --- |
| `bpmRaw` | Tempo exactly as listed, e.g. `"80/160"`, `"~122"`, `"128, 138"` — search/filter/mix match every value |
| `mode` | `dorian`, `phrygian`, `mixolydian`, `blues`… — Camelot is then the closest position, shown next to the mode |
| `keyRaw` | Key annotation as listed, e.g. `"Aphr+30"` |
| `tuning` | Cents sharp (+) / flat (−) |
| `tags` | `instrumental`, `acapella`, `percussive` |
| `keySource` / `bpmSource` | Per-value provenance (e.g. key from MusicalKeyCNN) |
| `notes` | Free-text caveats (key changes, time signatures…) |
| `youtube` | Watch URL — table/detail show its thumbnail; click opens the video |

The app validates every record on load: malformed optional fields are dropped, and a record without an `id` or `artist` is skipped instead of crashing the app.

### Adding tracks

1. Append a record to `data/tracks.json` (one record per line keeps diffs readable), or use **Contribute** (Discord login → review queue → `data:apply-queue`).
2. Keep `camelot` consistent with `key` — the canonical mapping is in `src/types/track.ts`.
3. Run `npm run data:csv` to refresh the CSV.
4. IDs are slugs (`artist-title`) and must be unique. Note that re-running `data:import` overwrites manual edits to `tracks.json`.

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

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · React Router 6. Optional API: Cloudflare Workers + D1 (`workers/api`).

## Discord auth & contribution queue (v2)

The SPA stays static. Auth and the submission queue live in [`workers/api`](workers/api).

### Local

1. Create a [Discord Application](https://discord.com/developers/applications) → **OAuth2**.
   - **Redirects** (must match `APP_ORIGIN`): `http://localhost:5173/auth/callback`  
     Optional if you hit the Worker directly: `http://127.0.0.1:8787/auth/callback`
   - **Client ID** = Application ID (already in `wrangler.toml` `[vars]`).
   - **Client Secret** = OAuth2 → **Reset Secret** (copy once). This is *not* the Public Key.
   - Public Key is unused for this login flow (Interactions only).
2. In `workers/api`, copy `.dev.vars.example` → `.dev.vars` and set `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, and optional `APPLY_TOKEN`. Or use `wrangler secret put` for production.
3. Create D1 + migrate:

```bash
cd workers/api
npm install
npx wrangler d1 create keybpm   # paste database_id into wrangler.toml
npx wrangler d1 migrations apply keybpm --local
```

4. Set your Discord user id in `MOD_DISCORD_IDS` in [`workers/api/wrangler.toml`](workers/api/wrangler.toml).
5. Terminal A: `npm run api:dev` · Terminal B: `npm run dev`.
6. Header → **Discord** → Contribute → submit (queued). Mods/trusted see **Review**.

### Publish approved rows into the catalog

```bash
KEYBPM_API_URL=http://127.0.0.1:8787 KEYBPM_APPLY_TOKEN=… npm run data:apply-queue
```

Merges approved submissions into `data/tracks.json`, refreshes CSV, marks them `applied`. Commit and redeploy the Pages site.

### Production

1. Deploy the Worker: `npm run api:deploy` (after remote D1 migrate + secrets).
2. Point Discord OAuth redirect at `https://<your-api-host>/auth/callback`.
3. Either:
   - **Same site:** attach Worker routes for `/api*` and `/auth*` on the Pages custom domain and leave `VITE_API_BASE` empty, or
   - **Split host:** set Pages env `VITE_API_BASE=https://keybpm-api.<account>.workers.dev` and `APP_ORIGIN` to the Pages URL; enable CORS via that origin (already allowed when it matches `APP_ORIGIN`).
4. Set `MOD_DISCORD_IDS` to your Discord snowflake so the first login is `mod`. Promote others on `/review`.

Roles: `user` (submit), `trusted` (approve), `mod` (approve, reject, set roles).

## Deploy (free)

### Cloudflare Pages (recommended)

1. Push this repo to GitHub.
2. Cloudflare Dashboard → **Pages → Create project → Connect to Git**.
3. Framework preset: *None* · Build command: `npm run build` · Output directory: `dist`.
4. Done. Every `git push` redeploys.

`wrangler.jsonc` sets `assets.not_found_handling: single-page-application`, so deep links like `/track/<id>` are served `index.html` (Cloudflare Pages projects get the same behaviour from a `_redirects` rule).

### Continuous integration

`.github/workflows/ci.yml` runs `npm ci && npm run build` on every push to `main` and on pull requests — a compile/typecheck gate, not a deploy. It replaced an earlier GitHub Pages workflow whose deploy job failed on every run because Pages was never enabled for this repo; Cloudflare remains the only deployer.

To build for a sub-path locally (GitHub Pages style): `BASE_PATH=/keybpm/ npm run build`.

## Project structure

```
├── .github/workflows/    # CI build check (Cloudflare does the deploy)
├── data/                 # portable dataset (tracks.json, tracks.csv)
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
