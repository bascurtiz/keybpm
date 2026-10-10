/**
 * Pure merge of approved queue rows into `data/tracks.json`, shared by
 * scripts/apply_submissions.mjs and scripts/test-queue-merge.mjs.
 *
 * Two passes, because one submission can depend on another:
 *
 *  1. `add` rows, oldest → newest. A contributed track exists only in the
 *     queue until it lands here, so it has to be inserted *before* a
 *     correction can target it — in wire order (newest first) a correction
 *     found no track and was silently skipped, then the original add wrote
 *     its empty BPM back over the fix.
 *  2. `correct` rows, oldest → newest, so the newest correction wins and the
 *     add it corrects can never overwrite it.
 *
 * A correction is a patch, not a replacement: fields it does not state
 * (missing / null) keep their existing value, so a form that only knows part
 * of a record cannot blank the rest of it.
 *
 * Provenance is never patched: the queue stamps `submittedBy` with whoever
 * wrote the submission, so a moderator correcting a contributed track would
 * otherwise replace its contributor's name (and relabel a sheet row's `source`
 * as "Community"). `source`/`submittedBy` stay put and the editor is recorded
 * in `lastEditedBy` instead.
 *
 * Approval is verification: the reviewer who let a row through stands behind
 * its values, so `verifiedAt` (the review date) and `verifiedBy` (their name)
 * are stamped on every merged row. Rows nobody reviewed carry no stamp — the
 * imported `lastVerified` is the *source's* refresh date, not a review.
 */

/** "2026-10-10 11:53:32" -> "2026-10-10"; undefined when there is no review date. */
function reviewDate(s) {
  const raw = s && s.reviewed_at
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : undefined
}

function stampVerification(row, s) {
  const at = reviewDate(s)
  if (!at) return row
  const next = { ...row, verifiedAt: at }
  if (s.reviewer_username) next.verifiedBy = s.reviewer_username
  return next
}

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

/**
 * @param {Array<Record<string, unknown>>} tracks  current tracks.json rows
 * @param {Array<{id: string, kind: string, track_id: string | null, payload: unknown, created_at?: string}>} submissions
 * @returns {{ tracks: Array<Record<string, unknown>>, added: number, corrected: number, appliedIds: string[], skipped: Array<{id: string, reason: string}> }}
 */
export function mergeQueue(tracks, submissions) {
  const ordered = [...submissions].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  )
  const byId = new Map(tracks.map(t => [t.id, t]))
  const added = []
  const appliedIds = []
  const skipped = []
  let corrected = 0

  for (const s of ordered) {
    if (s.kind !== 'add') continue
    const payload = plainObject(s.payload)
    if (!payload) {
      skipped.push({ id: s.id, reason: 'bad payload' })
      continue
    }
    const id = typeof payload.id === 'string' && payload.id ? payload.id : null
    if (!id) {
      skipped.push({ id: s.id, reason: 'add missing id' })
      continue
    }
    if (byId.has(id)) {
      skipped.push({ id: s.id, reason: `id ${id} already exists` })
      continue
    }
    const row = stampVerification({ ...payload, id, source: payload.source || 'Community' }, s)
    byId.set(id, row)
    added.push(row)
    appliedIds.push(s.id)
  }

  for (const s of ordered) {
    if (s.kind !== 'correct' || !s.track_id) continue
    const existing = byId.get(s.track_id)
    if (!existing) {
      skipped.push({ id: s.id, reason: `track ${s.track_id} not found` })
      continue
    }
    const payload = plainObject(s.payload)
    if (!payload) {
      skipped.push({ id: s.id, reason: 'bad payload' })
      continue
    }
    const patch = {}
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'id' || v === null || v === undefined) continue
      patch[k] = v
    }
    // The stamp is the submission's author, not the record's contributor, and
    // the payload's `source` describes whoever typed the form.
    const editor = patch.submittedBy
    const editorId = patch.submittedByDiscordId
    delete patch.submittedBy
    delete patch.submittedByDiscordId
    delete patch.source

    const next = {
      ...existing,
      ...patch,
      id: existing.id,
      source: existing.source || 'Community',
    }
    if (editor && editor !== existing.submittedBy) {
      next.lastEditedBy = editor
      if (editorId) next.lastEditedByDiscordId = editorId
    }
    // A correction was reviewed too — the reviewer verified the new values.
    const reviewed = reviewDate(s)
    if (reviewed) {
      next.verifiedAt = reviewed
      if (s.reviewer_username) next.verifiedBy = s.reviewer_username
    }

    byId.set(existing.id, next)
    corrected++
    appliedIds.push(s.id)
  }

  // Resolve every row through the map after both passes: a queue-added track
  // has to come back in its corrected form, not as the object inserted before
  // the correction ran.
  const merged = []
  const seen = new Set()
  for (const t of [...added, ...tracks]) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    merged.push(byId.get(t.id) ?? t)
  }

  return {
    tracks: merged,
    added: added.length,
    corrected,
    appliedIds,
    skipped,
  }
}
