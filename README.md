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
npm run data:consensus -- path/to/keybpm_consensus_new_tracks.csv  # merge a Key Consensus Engine export
npm run data:csv    # re-export data/tracks.csv from the JSON
npm run data:seed     # regenerate the small fictional test set → data/seed-tracks.json
npm run data:soundiiz # unique Artist - Title list for Soundiiz YouTube matching → data/soundiiz/
npm run data:soundcloud:gathered # merge TuneMyMusic SoundCloud results → soundcloud fields + review TSVs
npm run data:apply-queue # merge approved Discord submissions into data/tracks.json
npm run api:dev       # Cloudflare Worker API (wrangler) on :8787
```

Vite proxies `/api` and `/auth` to `http://127.0.0.1:8787` in dev. Copy `.env.example` if you need a remote API base.

## Data

The dataset lives in **`data/tracks.json`** (canonical) and **`data/tracks.csv`** — plain, portable files you can diff in Git, load in Python, or consume from other tools. The app imports the JSON at build time (as its own cacheable chunk); no database, no API server.

**Source:** ~19,150 tracks from *duuzu's song key & bpm 'database'* v10 (15 June 2025), keys and tempos worked out by ear, plus 8,832 tracks from a ten-source **Key Consensus Engine** export (see below). Credit for the sheet goes to duuzu — get their permission before publishing it.

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

### SoundCloud links

TuneMyMusic writes the permalink into its `url` column whichever platform it searched, so the same exports fill `soundcloud` instead of `youtube` with `--link=soundcloud`. Matching is otherwise identical; the URL is canonicalised to `https://soundcloud.com/user/track` (share/UTM params dropped), and a value is never overwritten.

```bash
npm run data:soundcloud:gathered
```

Two flags matter for a hand-collected SoundCloud batch, because uploads are user-generated and often misdescribe themselves:

- `--input=<file>` lists the `Artist - Title` rows that were actually searched, so a loose hit can only land on a row that was looked up rather than anywhere in the catalogue.
- `--report=<file.tsv>` writes three review files next to it: the accepted matches (lowest score first), `-rejected.tsv` (rows turned down, with their most plausible catalogue row and the guard that stopped it — `export-remix` means the upload is a remix of the track the row claims to be, and so on) and `-unmatched.tsv` (searched rows that got no link, which is the input for another round).

### Key Consensus Engine import

A separate pipeline (`project-consensus-keys`) cross-references ten key databases — CamelotSound, HookTheory, MusicNotes, Karaoke-Version, SongGalaxy, SongKeyFinder, Isolated Tracks, Harmonic Keys, KeyFinder, FMAK v2 — and exports every track whose key at least three of them agree on (`keybpm_consensus_new_tracks.csv`):

```bash
npm run data:consensus -- "path/to/keybpm_consensus_new_tracks.csv"
npm run data:csv   # refresh data/tracks.csv
```

`scripts/import_consensus.mjs` re-checks every row against the current `data/tracks.json` using the engine's own normalisation (accents, brackets and `feat.` stripped, leading `The` dropped). A row that already exists is never added twice — instead its **missing `bpm`** is filled from the export's `BPM` column, so tempo coverage grows as the engine's lookups improve (24,522 of 27,989 tracks carry a tempo today). A track that already has a tempo keeps it even when the export disagrees; the script reports those as conflicts instead of overwriting them. A second run is a no-op, and `--dry` reports what would change without writing.

Imported rows keep provenance in their `source` string rather than a `sources` array, so the app also renders a chip for that: duuzu's rows show a `DZ` chip whose tooltip states the sheet's key and whose link opens the sheet. `src/lib/sources.ts` holds that mapping — no per-row data is invented.

Each accepted row keeps its per-source reports in `sources` (`[{ id, key, url }]`). The app renders these as the coloured source chips (`SG`, `HK`, …) in the track table and on the track page: hovering shows the source's full name plus the key it states, and clicking opens its page — the direct link from the export, or the source's own search page when it had none. The **Sources** column is sortable (`?sort=sources&dir=desc`): most-corroborated first, ties broken by which sources reported, so the best-attested rows rank first and duuzu's single-source rows come last. A source whose key differs from the consensus key is called out rather than shown as unanimous. `confidence` is the share of listed sources that agreed, and `notes` spells the split out.

**Those reports come from the sources' own listings and from the engine's per-record evidence, never from the export's `key_<source>` columns.** An export column is the first record the engine's fuzzy cluster matched for that source, so it can be a *different song*: the `Glee – Santa Baby` row carried `key_isolated_tracks = 6B`, which is Isolated Tracks' key for `Glee – Baby`, while three sources (Isolated Tracks, Karaoke-Version, MusicNotes) state `3B` for Santa Baby — the row's real key. Reading those columns as "what this source states for this track" made 1,028 rows show a source disagreeing with a key it had agreed on, and 5 rows claim their key was corroborated by nobody.

The engine knows better than that, it just does not write it down: `compute_cluster_consensus()` keeps one record per source and throws the agreeing records away. `scripts/export_match_details.py` (in the `project-consensus-keys` repo, added for this) re-runs the clustering and writes the evidence instead — `data/exports/keybpm_consensus_match_details.csv`, one row per track, source and record that stated the winning key, with that record's own URL:

```bash
python scripts/export_match_details.py     # ~90s over 373,835 source records → 40,756 agreeing records
```

`scripts/lib/match_details.mjs` reads it, joining a database row to its evidence by the record URL the engine matched, or by the engine's normalised name — 8,771 of the 8,832 tracks; the other 61 are 45 with no detail row and 16 whose entry states a different key, and there the listings decide. That layer is what makes unusual spellings work: `Gigi D'Agostino – lamour toujours` is corroborated by HookTheory, Karaoke-Version and SongKeyFinder, each listing it as `L'amour Toujours`, which no name/URL/title join reaches — the row used to be unverifiable and now reads "agreed by 3 of 3". Where there is no evidence file (or no entry for a track), `scripts/lib/consensus_sources.mjs` falls back to joining each source's `data/sources/*.csv` by normalised name, by the URL the engine matched, or — for listings that spell the artist differently and carry no URL, like MusicNotes' `Glee Cast` for `Glee` — by title with the artist gated on a token match. A source whose listing has no row for the track is left out rather than credited with a sibling's key, so every chip in the dataset answers "what does this service state for *this* track".

```bash
npm run data:consensus:verify    # report what a repair would change, writes nothing
npm run data:consensus:repair    # rebuild provenance on existing rows + refresh the CSV
```

The export also carries a few tracks twice — `Meghan Trainor feat. John Legend` and `Meghan Trainor` for one song, `That's What Friends Are For` with a straight and a curly apostrophe for another — with the sources that corroborate them split across the two rows. `mergeExportRows()` merges those (only when they state the same key), so a record keeps every source that states it rather than whichever row came last: both of those tracks now read "agreed by 5 of 5" instead of 3.

After the repair, **8,797 of the 8,832 tracks** are corroborated by three or more sources per the engine's own evidence; 35 have fewer than three sources that can be evidenced, and one export row — `2pac-snoop-dogg-2-of-americaz-most-wanted-lp`, `D# minor`/`2A` — has no listing and no evidence that accounts for its key, so it is **not imported**: a key no source states is not something this database can support, and the repair removes rows that were imported before the rule (`npm run data:consensus:repair` reports the one it removed). 1,819 tracks still carry a source that states a different key, a real disagreement now shown as one.

Two properties of the sources themselves shape how that list reads (`src/lib/sources.ts`):

- **Some sources key a section, not the song.** HookTheory anchors each analysed section separately, so `zedd feat selena gomez – I Want You to Know` is C major (`8B`) in its Intro and Verse and A minor (`8A`) in its Chorus — one source, two keys, both correct. The export records one of those sections, and it carries the section *name* as the URL fragment (`#Intro%20and%20Verse`), which matches no element on the page — so the browser ignored it and the site opened on whatever section it defaults to (its Chorus, `8A`), which read as the page contradicting the `8B` the row printed. `repairSectionAnchor()` rewrites fragments to the slug those sites use as ids (`#intro-and-verse`) for the sources whose scheme has been checked against live pages, so a click lands on the section whose key the row states; `sourceSection()` names that section in the row ("states 8B (C) in its “Intro and Verse” section") and in the chip tooltip.
- **A relative major/minor is not a disagreement.** `8A` and `8B` are the same seven notes with a different tonal centre, and it is the most common way two sources differ (and exactly what a section-keyed source produces when its sections are relatives). Those rows say `relative major, same seven notes as this track's 8A` instead of `differs`; a source stating an unrelated key still reads as `differs`.
- **A source can state several keys for one track.** A listing row per section or per arrangement means the source really does list more than one, so the entry keeps them all in `keys` (`hooktheory: 8A` with `keys: ['8B', '8A']`). The track page shows the primary one with `also lists 8B`, and the tooltip lists them all. 2,894 of the 8,832 consensus records carry at least one such source.

### Source key listings (`/source/:id`)

A chip (`CS`, `KF`, `HK`, `FM`) says "this source states a key" — the listing pages are where that can be checked against the source's own full list.

```bash
npm run data:source-keys   # project-consensus-keys CSVs -> data/source-keys/*.json
```

The script reads each source's CSV in `project-consensus-keys/data/sources/` (per-source CSV and export paths overridable with `CONSENSUS_DIR` / `CONSENSUS_EXPORT`) and writes one compact JSON per published source — rows are `[artist, title, camelot, trackId]`, where `trackId` is the matching record in `data/tracks.json`. Listings are lazy-loaded (`src/lib/sourceKeys.ts` uses `import.meta.glob`), so the 60–210 KB files are only fetched when their page is opened.

That id is what makes a chip deep-linkable: chips for listed sources point at `/source/camelotsound#the-beatles-in-my-life` (a client-side route, no new tab), and the page scrolls to that row and highlights it — the list is virtualized, so the row is not in the DOM until then. The track page's Sources list links the same way (its "Open ↗" row for that source is a client-side link). The page header states the source's canonical URL, what it publishes, how many entries are listed and the snapshot date, then lists artist – title – Camelot key (plus the musical key) with a filter box and a "Track →" link for entries the database also holds.

**Only entries whose track is in `data/tracks.json` are published** — a listing row nobody can open in the app is a dead end, and these sources reach far beyond the catalogue. The script reports what it dropped for that reason (currently KeyFinder 777 of 1,185, Harmonic Keys 3,074 of 3,628, FMAK v2 5,332 of 5,336 rows), which keeps every `CS`/`KF`/`HK`/`FM` chip anchored on a row that exists.

**The anchor set is the dataset's own chips**, not the export's `Consensus_Sources` column: every track whose `sources` carry this source gets a row, stating the key that chip's tooltip states (`anchorChips()` in `scripts/lib/source_listings.mjs`). The two must agree, because a chip for a published source *is* a link to this page — 148 CamelotSound chips pointed at rows the export-only selection never built (the evidence layer records reports that column never named), and 43 more landed on a row stating a key the chip did not. Rows the export names are still added on top, and a source that lists one track twice under two different keys — Harmonic Keys does, for 35 of them — collapses to a single row, so a listing is one row per track and every chip's anchor is unambiguous. The script prints all four counts (`chips not anchored` should read 0).

CamelotSound is narrower still, because its 35k-row CSV is deliberately not published in full: its page carries the 1,101 entries it could be built from — 954 the consensus export lists, plus 148 for the chips the evidence layer adds and minus 1 whose track left the database — while KeyFinder, Harmonic Keys and FMAK v2 add any track the export names that their CSV lacks.

Adding another source is three steps: add it to `SOURCES` in `scripts/import_source_keys.mjs`, set `listing: true` and a `description` (plus the canonical `url`) in `SOURCE_META` in `src/lib/sources.ts`, and run `npm run data:source-keys`. A source whose key differs from the track's consensus key is not hidden by this — the listing shows what the source itself states.

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
| `submittedBy` / `submittedByDiscordId` | Discord member who contributed the row — a later correction never takes this over |
| `lastEditedBy` / `lastEditedByDiscordId` | Discord member whose **correction** last changed the row |
| `verifiedAt` / `verifiedBy` | Date and reviewer of the queue approval that verified the row — the only thing "Verified" means |
| `notes` | Free-text caveats (key changes, time signatures…) |
| `youtube` | Watch URL — table/detail show its thumbnail; click opens the video |
| `sources` | Per-source key reports from the consensus engine: `[{ id, key, url }]` — rendered as clickable source chips with the source's stated key |

The app validates every record on load: malformed optional fields are dropped, and a record without an `id` or `artist` is skipped instead of crashing the app.

### Adding tracks

1. Append a record to `data/tracks.json` (one record per line keeps diffs readable), or use **Contribute** (Discord login → review queue → `data:apply-queue`).

**BPM field:** the Contribute form accepts exactly one tempo — `124`, `127.5`, a comma decimal (`132,9`, normalised to `132.9`), or the sheet's approximate notation `~128` / `≈128` / `128*` (stored as `bpm: 128` plus `bpmRaw: "~128"`). Anything else is refused with an inline error — a lone `-`, the sheet's "not known" placeholder, no longer saves as `bpm: null`. Multi-tempo notations (`80/160`, `128-130`) are rejected too; put those in `notes`. `src/lib/bpm.ts` holds the rule, `workers/api/src/validate.ts` enforces the same one server-side.
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

Queue rows are folded in **oldest first**: `add` rows are inserted before the `correct` rows that target them, and a correction is a *patch* — fields it leaves unstated keep their existing value. Without that order a correction to a track that only existed in the queue found nothing to patch, so the original add (empty BPM) won and the track stayed tempo-less in live search. `scripts/lib/merge_queue.mjs` holds that logic; `npm test` covers it.

Attribution is not patchable: the queue stamps every submission with its author, so a moderator correcting someone else's row would otherwise replace the contributor's name. `submittedBy` stays with the original submitter and the editor is recorded in `lastEditedBy` (shown as **Edited by** on the track page). A correction also keeps the record's `source` instead of relabelling it "Community".

**Verification** is a review stamp, nothing else: approving a row writes `verifiedAt` (the review date) and `verifiedBy` (the reviewer, resolved from `users` by the API for the overlay/export payloads) onto the track, and a later correction re-stamps it because the reviewer verified the new values. Unreviewed rows carry no stamp and the track page shows no *Verified* row. The imported `lastVerified` is **not** a review — it is the date the source (duuzu's sheet) last refreshed the row, imported as a single constant, so it is displayed beside `source` as "as of …".

Approved rows stay listed under **Approved & applied** at the bottom of `/review`, where a moderator gets a **Remove** button: it hard-deletes the queue row (`DELETE /api/submissions/:id`, mod-only), so an `approved` track leaves live search/overlay immediately. An `applied` row is already in `data/tracks.json` — delete it there too and redeploy.

### Production

1. Deploy the Worker: `npm run api:deploy` (after remote D1 migrate + secrets).
2. Point Discord OAuth redirect at `https://<your-api-host>/auth/callback`.
3. Either:
   - **Same site:** attach Worker routes for `/api*` and `/auth*` on the Pages custom domain and leave `VITE_API_BASE` empty, or
   - **Split host:** set Pages env `VITE_API_BASE=https://keybpm-api.<account>.workers.dev` and `APP_ORIGIN` to the Pages URL; enable CORS via that origin (already allowed when it matches `APP_ORIGIN`).
4. Set `MOD_DISCORD_IDS` to your Discord snowflake so the first login is `mod`. Promote others on `/review`.

Roles: `user` (submit), `trusted` (approve), `mod` (approve, reject, remove, set roles).

Tracks submitted through the queue live in the overlay until they are applied, so a later correction to one of them is enough to fix its BPM/key live — no redeploy needed.

**Activity feed.** `GET /api/activity` (public, `?limit=` up to 60) returns the newest reviewed rows, newest review first, with the reviewer's name — `approved` and `applied` alike, so an entry stays in the history after `data:apply-queue` writes it into `data/tracks.json`. The homepage reads it for the **Community activity** list (`src/components/ActivityFeed.tsx`, `src/lib/activity.ts`): one row per track, labelled `added` or `edited`, with who did it, when, and the reviewer who cleared it. A track that was added and then corrected twice is one entry, and the **add wins**: the row credits whoever put the track in the database (`added … · TheHolyT-Bo`) rather than the later editor. A track that only ever lived in the dataset lists its newest correction. Rows are ordered by the kept row's contribution time, so the "… ago" stamps run newest to oldest.

Queue rows are not the whole story: the bulk imports behind `data:consensus` / `data:import` never pass through the queue, so those tracks would otherwise appear with no event attached. `recentImports()` in the same module lists them individually — one row per track, `artist – title`, its BPM and key, `imported <when> · <source>` and the track's Camelot chip, exactly the shape a queue row has — because "8,832 tracks imported" tells a DJ nothing about what actually arrived. There is no per-track time inside a snapshot, so rows come out in reverse dataset order (the order the import appended them, last first) and the snapshot date is what places them among the queue rows. Everything is derived from the data, so a re-import restates the same rows rather than inventing events. If the API cannot be reached the imported rows are still listed and the section says the queue did not answer, instead of showing an empty feed (`apiActivity()` returns `null`, not `[]`).

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
