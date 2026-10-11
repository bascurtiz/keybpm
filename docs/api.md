# Contribution API & Discord auth

The SPA stays static. Auth and the submission queue live in [`workers/api`](../workers/api),
a Cloudflare Worker backed by D1. The home page **Contribute** flow and the
**Review** queue talk to it.

## Local

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

4. Set your Discord user id in `MOD_DISCORD_IDS` in [`workers/api/wrangler.toml`](../workers/api/wrangler.toml).
5. Terminal A: `npm run api:dev` · Terminal B: `npm run dev`.
6. Header → **Discord** → Contribute → submit (queued). Mods/trusted see **Review**.

## Publish approved rows into the catalog

```bash
KEYBPM_API_URL=http://127.0.0.1:8787 KEYBPM_APPLY_TOKEN=… npm run data:apply-queue
```

Merges approved submissions into `data/tracks.json`, refreshes CSV, marks them `applied`. Commit and redeploy the Pages site.

Queue rows are folded in **oldest first**: `add` rows are inserted before the `correct` rows that target them, and a correction is a *patch* — fields it leaves unstated keep their existing value. Without that order a correction to a track that only existed in the queue found nothing to patch, so the original add (empty BPM) won and the track stayed tempo-less in live search. `scripts/lib/merge_queue.mjs` holds that logic; `npm test` covers it.

Attribution is not patchable: the queue stamps every submission with its author, so a moderator correcting someone else's row would otherwise replace the contributor's name. `submittedBy` stays with the original submitter and the editor is recorded in `lastEditedBy` (shown as **Edited by** on the track page). A correction also keeps the record's `source` instead of relabelling it "Community".

**Verification** is a review stamp, nothing else: approving a row writes `verifiedAt` (the review date) and `verifiedBy` (the reviewer, resolved from `users` by the API for the overlay/export payloads) onto the track, and a later correction re-stamps it because the reviewer verified the new values. Unreviewed rows carry no stamp and the track page shows no *Verified* row. The imported `lastVerified` is **not** a review — it is the date the source (duuzu's sheet) last refreshed the row, imported as a single constant, so it is displayed beside `source` as "as of …".

Approved rows stay listed under **Approved & applied** at the bottom of `/review`, where a moderator gets a **Remove** button: it hard-deletes the queue row (`DELETE /api/submissions/:id`, mod-only), so an `approved` track leaves live search/overlay immediately. An `applied` row is already in `data/tracks.json` — delete it there too and redeploy.

## Production

1. Deploy the Worker: `npm run api:deploy` (after remote D1 migrate + secrets).
2. Point Discord OAuth redirect at `https://<your-api-host>/auth/callback`.
3. Either:
   - **Same site:** attach Worker routes for `/api*` and `/auth*` on the Pages custom domain and leave `VITE_API_BASE` empty, or
   - **Split host:** set Pages env `VITE_API_BASE=https://keybpm-api.<account>.workers.dev` and `APP_ORIGIN` to the Pages URL; enable CORS via that origin (already allowed when it matches `APP_ORIGIN`).

## Roles & activity

Roles: `user` (submit), `trusted` (approve), `mod` (approve, reject, remove, set roles).

Tracks submitted through the queue live in the overlay until they are applied, so a later correction to one of them is enough to fix its BPM/key live — no redeploy needed.

**Activity feed.** `GET /api/activity` (public, `?limit=` up to 60) returns the newest reviewed rows, newest review first, with the reviewer's name — `approved` and `applied` alike, so an entry stays in the history after `data:apply-queue` writes it into `data/tracks.json`. The homepage reads it for the **Community activity** list (`src/components/ActivityFeed.tsx`, `src/lib/activity.ts`): one row per track, labelled `added` or `edited`, with who contributed it and when. The reviewer is deliberately not printed: every row in the feed was approved, so crediting the moderator would put their name on every line — the review travels with the record instead (`verifiedBy`, shown on the track page), and the API still returns `reviewer` on this payload for callers that want it. A track that was added and then corrected twice is one entry, and the **add wins**: the row credits whoever put the track in the database (`added … · TheHolyT-Bo`) rather than the later editor. A track that only ever lived in the dataset lists its newest correction. Rows are ordered by the kept row's contribution time, so the "… ago" stamps run newest to oldest.

Queue rows are not the whole story: the bulk imports behind `data:consensus` / `data:import` never pass through the queue, so those tracks would otherwise appear with no event attached. `recentImports()` in the same module lists them individually — one row per track, `artist – title`, its BPM and key, `imported <when> · <source>` and the track's Camelot chip, exactly the shape a queue row has — because "8,797 tracks imported" tells a DJ nothing about what actually arrived. There is no per-track time inside a snapshot, so rows come out in reverse dataset order (the order the import appended them, last first) and the snapshot date is what places them among the queue rows. The two kinds date themselves differently — a queue row to the second (`2026-10-11 10:45:00`), an import to the day of its snapshot (`2026-10-11`) — so `orderFeed()` in `src/lib/activityOrder.ts` parses both to a UTC instant before comparing them; sorting the strings directly put every same-day import above every same-day contribution, which buried messages a moderator had just approved under a bulk import. Everything is derived from the data, so a re-import restates the same rows rather than inventing events. If the API cannot be reached the imported rows are still listed and the section says the queue did not answer, instead of showing an empty feed (`apiActivity()` returns `null`, not `[]`).
