# Data pipeline

How the dataset in `data/tracks.json` / `data/tracks.csv` is built, merged and
annotated. The [README](../README.md) covers the schema and how to add a track
by hand; this file covers the import scripts.

## Importing a new sheet version

1. In Google Docs: **File → Download → Markdown (.md)**.
2. `npm run data:import -- "path/to/export.md"` (defaults to the v10 file in the repo root).

`scripts/import_duuzu.mjs` reads each `• Artist - Title (…) (BPM)` line under its key heading and peels the trailing brackets: notes after the BPM, the BPM group (`~75/150`), then key/mode/tuning (`Aphr+30`), flags (`inst`/`aca`/`perc`) and notes (`some Dmin`). The first bracket it doesn't recognise stays in the title, e.g. `(umru remix)`. Track IDs are slugs of artist + title, so they stay stable across re-imports.

## Soundiiz (YouTube URLs)

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

## Gathered results (Soundiiz / TuneMyMusic)

When the source is a hand-collected batch of tracks that have no YouTube link yet — so there is no original `part-NN.csv` to align against — drop the downloaded CSVs in a directory of their own and use `--gathered`:

```bash
npm run data:tunemymusic:gathered   # reads data/export-tunemymusic/to-import/*.csv, refreshes the CSV
```

Every export row is scored against the whole catalogue, but only rows whose best match still lacks a link are assigned: a lookup for a track that is already linked counts as a duplicate rather than an excuse to link a sibling row. Exact score ties are broken by how much of a row's own wording the export repeats, which is what stops `Plaza Speakers K` from taking `Plaza Speakers L`'s video and `New You (Headspace)` from taking the `(Shella Fresh)` one. Existing `youtube` values are never overwritten, so re-running is safe (a second run matches 0).

`--dry` reports what would change without writing; `--debug` prints the score spread, near misses and a per-row `--probe=<text>` breakdown.

## SoundCloud links

TuneMyMusic writes the permalink into its `url` column whichever platform it searched, so the same exports fill `soundcloud` instead of `youtube` with `--link=soundcloud`. Matching is otherwise identical; the URL is canonicalised to `https://soundcloud.com/user/track` (share/UTM params dropped), and a value is never overwritten.

```bash
npm run data:soundcloud:gathered
```

Two flags matter for a hand-collected SoundCloud batch, because uploads are user-generated and often misdescribe themselves:

- `--input=<file>` lists the `Artist - Title` rows that were actually searched, so a loose hit can only land on a row that was looked up rather than anywhere in the catalogue.
- `--report=<file.tsv>` writes three review files next to it: the accepted matches (lowest score first), `-rejected.tsv` (rows turned down, with their most plausible catalogue row and the guard that stopped it — `export-remix` means the upload is a remix of the track the row claims to be, and so on) and `-unmatched.tsv` (searched rows that got no link, which is the input for another round).

## Key Consensus Engine import

A separate pipeline (`project-consensus-keys`) cross-references ten key databases — CamelotSound, HookTheory, MusicNotes, Karaoke-Version, SongGalaxy, SongKeyFinder, Isolated-Tracks, Harmonic Keys, KeyFinder, FMAK v2 — and exports every track whose key at least three of them agree on (`keybpm_consensus_new_tracks.csv`):

```bash
npm run data:consensus -- "path/to/keybpm_consensus_new_tracks.csv"
npm run data:csv   # refresh data/tracks.csv
```

`scripts/import_consensus.mjs` re-checks every row against the current `data/tracks.json` using the engine's own normalisation (accents, brackets and `feat.` stripped, leading `The` dropped). A row that already exists is never added twice — instead its **missing `bpm`** is filled from the export's `BPM` column, so tempo coverage grows as the engine's lookups improve (24,509 of 27,954 tracks carry a tempo today). A track that already has a tempo keeps it even when the export disagrees; the script reports those as conflicts instead of overwriting them. A second run is a no-op, and `--dry` reports what would change without writing. A row is only accepted when **three or more sources state its key** in their own listing or in the engine's evidence for them — the floor described under *consensus provenance* below, which is the engine's own rule applied to votes this database can point at.

Imported rows keep provenance in their `source` string rather than a `sources` array, so the app also renders a chip for that: duuzu's rows show a `DZ` chip whose tooltip states the sheet's key and whose link opens the sheet. `src/lib/sources.ts` holds that mapping — no per-row data is invented.

Each accepted row keeps its per-source reports in `sources` (`[{ id, key, url }]`). The app renders these as the coloured source chips (`SG`, `HK`, …) in the track table and on the track page: hovering shows the source's full name plus the key it states, and clicking opens its page — the direct link from the export, or the source's own search page when it had none. The **Source(s)** column is sortable (`?sort=sources&dir=desc`): most-corroborated first, ties broken by which sources reported, so the best-attested rows rank first and duuzu's single-source rows come last — sorting still counts *key sources* only, a contributor is not corroboration. A row that came through the queue has no key service behind it at all, so the column shows the member who added it instead: `submittedBy`, stamped by the API from the session that created the row, rendered by `ContributorBadge` as a neutral chip carrying the name in full (a person is not a two-letter source code, and there is no listing behind it to open). A correction is recorded as `lastEditedBy` and never changes who is credited. A source whose key differs from the consensus key is called out rather than shown as unanimous. `confidence` is the share of listed sources that agreed, and `notes` spells the split out.

**Those reports come from the sources' own listings and from the engine's per-record evidence, never from the export's `key_<source>` columns.** An export column is the first record the engine's fuzzy cluster matched for that source, so it can be a *different song*: the `Glee – Santa Baby` row carried `key_isolated_tracks = 6B`, which is Isolated-Tracks' key for `Glee – Baby`, while three sources (Isolated-Tracks, Karaoke-Version, MusicNotes) state `3B` for Santa Baby — the row's real key. Reading those columns as "what this source states for this track" made 1,028 rows show a source disagreeing with a key it had agreed on, and 5 rows claim their key was corroborated by nobody.

The engine knows better than that, it just does not write it down: `compute_cluster_consensus()` keeps one record per source and throws the agreeing records away. `scripts/export_match_details.py` (in the `project-consensus-keys` repo, added for this) re-runs the clustering and writes the evidence instead — `data/exports/keybpm_consensus_match_details.csv`, one row per track, source and record that stated the winning key, with that record's own URL:

```bash
python scripts/export_match_details.py     # ~90s over 373,835 source records → 40,756 agreeing records
```

`scripts/lib/match_details.mjs` reads it, joining a database row to its evidence by the record URL the engine matched, or by the engine's normalised name — 8,771 of the export's 8,833 tracks; the other 62 are 46 with no detail row and 16 whose entry states a different key, and there the listings decide. That layer is what makes unusual spellings work: `Gigi D'Agostino – lamour toujours` is corroborated by HookTheory, Karaoke-Version and SongKeyFinder, each listing it as `L'amour Toujours`, which no name/URL/title join reaches — the row used to be unverifiable and now reads "agreed by 3 of 3". Where there is no evidence file (or no entry for a track), `scripts/lib/consensus_sources.mjs` falls back to joining each source's `data/sources/*.csv` by normalised name, by the URL the engine matched, or — for listings that spell the artist differently and carry no URL, like MusicNotes' `Glee Cast` for `Glee` — by title with the artist gated on a token match. A source whose listing has no row for the track is left out rather than credited with a sibling's key, so every chip in the dataset answers "what does this service state for *this* track".

```bash
npm run data:consensus:verify    # report what a repair would change, writes nothing
npm run data:consensus:repair    # rebuild provenance on existing rows + refresh the CSV
```

The export also carries a few tracks twice — `Meghan Trainor feat. John Legend` and `Meghan Trainor` for one song, `That's What Friends Are For` with a straight and a curly apostrophe for another — with the sources that corroborate them split across the two rows. `mergeExportRows()` merges those (only when they state the same key), so a record keeps every source that states it rather than whichever row came last: both of those tracks now read "agreed by 5 of 5" instead of 3.

A record's `notes` reports two different counts, and they are not the same thing. The engine accepts a key only when **three of its sources state it** (`Source_Count`), while a chip exists only where a source's own listing — or the engine's per-record evidence for it — could be traced to the track. When the engine counted more than could be traced, the note says so rather than quietly reporting the smaller number: `Lady Antebellum – Champagne Night` reads `Key agreed by 5 sources in the consensus run; this track appears in 4 of their listings.` (4 records are in that state; the import and the repair pass the engine's count through as `counted` for exactly this). A row that cannot reach three *traced* votes is not annotated more carefully — it is dropped, because `Key agreed by 1 of 1 reporting sources` is how a key the engine reached on three votes came to look like one source's guess. `confidence` is computed over the sources a chip can show, so where a note states a shortfall the percentage still reads `100%`; the note is where the gap is stated.

**The floor is the rule, not a report.** A consensus row is published only when three or more sources state its key in their own listing or in the engine's evidence for them — the engine's own `min_sources=3` applied to votes that can be traced (`MIN_VERIFIED_SOURCES` in `scripts/lib/consensus_sources.mjs`). The dataset therefore holds exactly **8,797 consensus records**, and the 36 export rows below the floor (1 with no traceable source, 10 with one, 25 with two) are **not imported**; `npm run data:consensus:repair` **removes** the 35 that had already been written into `data/tracks.json`, including `2pac-snoop-dogg-2-of-americaz-most-wanted-lp` (`D# minor`/`2A`), which used to sit in the dataset annotated "no source listing accounts for this key". They are all the same failure: the engine's fuzzy cluster paired a track with a near-miss pressing (`Deadmau5 – Ghost N Stuff (Matroda Remix)` was counted on CamelotSound, Karaoke-Version and MusicNotes, but the latter two list `Ghosts 'n' Stuff`, the original), so its three sourced votes were not three votes for *this* track. 1,815 records still carry a source that states a different key, a real disagreement now shown as one.

Two properties of the sources themselves shape how that list reads (`src/lib/sources.ts`):

- **Some sources key a section, not the song.** HookTheory anchors each analysed section separately, so `zedd feat selena gomez – I Want You to Know` is C major (`8B`) in its Intro and Verse and A minor (`8A`) in its Chorus — one source, two keys, both correct. The export records one of those sections, and it carries the section *name* as the URL fragment (`#Intro%20and%20Verse`), which matches no element on the page — so the browser ignored it and the site opened on whatever section it defaults to (its Chorus, `8A`), which read as the page contradicting the `8B` the row printed. `repairSectionAnchor()` rewrites fragments to the slug those sites use as ids (`#intro-and-verse`) for the sources whose scheme has been checked against live pages, so a click lands on the section whose key the row states; `sourceSection()` names that section in the row ("states 8B (C) in its “Intro and Verse” section") and in the chip tooltip.
- **A relative major/minor is not a disagreement.** `8A` and `8B` are the same seven notes with a different tonal centre, and it is the most common way two sources differ (and exactly what a section-keyed source produces when its sections are relatives). Those rows say `relative major, same seven notes as this track's 8A` instead of `differs`; a source stating an unrelated key still reads as `differs`.
- **A source can state several keys for one track.** A listing row per section or per arrangement means the source really does list more than one, so the entry keeps them all in `keys` (`hooktheory: 8A` with `keys: ['8B', '8A']`). The track page shows the primary one with `also lists 8B`, and the tooltip lists them all. 2,887 of the 8,797 consensus records carry at least one such source.

## Schema

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

## Source key listings (`/source/:id`)

A chip (`CS`, `KF`, `HK`, `FM`) says "this source states a key" — the listing pages are where that can be checked against the source's own full list.

```bash
npm run data:source-keys   # project-consensus-keys CSVs -> data/source-keys/*.json
```

The script reads each source's CSV in `project-consensus-keys/data/sources/` (per-source CSV and export paths overridable with `CONSENSUS_DIR` / `CONSENSUS_EXPORT`) and writes one compact JSON per published source — rows are `[artist, title, camelot, trackId]`, where `trackId` is the matching record in `data/tracks.json`. Listings are lazy-loaded (`src/lib/sourceKeys.ts` uses `import.meta.glob`), so the 60–210 KB files are only fetched when their page is opened.

That id is what makes a chip deep-linkable: chips for listed sources point at `/source/camelotsound#the-beatles-in-my-life` (a client-side route, no new tab), and the page scrolls to that row and highlights it — the list is virtualized, so the row is not in the DOM until then. The track page's Sources list links the same way (its "Open ↗" row for that source is a client-side link). The page header states the source's canonical URL, what it publishes, how many entries are listed and the snapshot date, then lists artist – title – Camelot key (plus the musical key) with a filter box and a "Track →" link for entries the database also holds.

**Only entries whose track is in `data/tracks.json` are published** — a listing row nobody can open in the app is a dead end, and these sources reach far beyond the catalogue. The script reports what it dropped for that reason (currently KeyFinder 779 of 1,176, Harmonic Keys 3,077 of 3,590, FMAK v2 5,332 of 5,336 rows), which keeps every `CS`/`KF`/`HK`/`FM` chip anchored on a row that exists.

**The anchor set is the dataset's own chips**, not the export's `Consensus_Sources` column: every track whose `sources` carry this source gets a row, stating the key that chip's tooltip states (`anchorChips()` in `scripts/lib/source_listings.mjs`). The two must agree, because a chip for a published source *is* a link to this page — 148 CamelotSound chips pointed at rows the export-only selection never built (the evidence layer records reports that column never named), and 43 more landed on a row stating a key the chip did not. Rows the export names are still added on top, and a source that lists one track twice under two different keys — Harmonic Keys does, for 35 of them — collapses to a single row, so a listing is one row per track and every chip's anchor is unambiguous. The script prints all four counts (`chips not anchored` should read 0).

CamelotSound is narrower still, because its 35k-row CSV is deliberately not published in full: its page carries the 1,091 entries it could be built from — 148 of them for chips the evidence layer adds on top of what the export names, 30 of them re-keyed to the key the chip states, and 11 of its CSV rows dropped because their track is not in the database — while KeyFinder, Harmonic Keys and FMAK v2 add any track the export names that their CSV lacks.

Adding another source is three steps: add it to `SOURCES` in `scripts/import_source_keys.mjs`, set `listing: true` and a `description` (plus the canonical `url`) in `SOURCE_META` in `src/lib/sources.ts`, and run `npm run data:source-keys`. A source whose key differs from the track's consensus key is not hidden by this — the listing shows what the source itself states.
