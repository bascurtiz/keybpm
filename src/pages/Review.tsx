import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/AuthContext'
import {
  apiApprove,
  apiDeleteSubmission,
  apiListSubmissions,
  apiReject,
  apiSetRole,
  canReview,
  type Role,
  type Submission,
} from '@/lib/api'
import { getTrack, reloadQueueOverlay } from '@/lib/data'
import { removeContribution } from '@/lib/contributions'
import { toast } from '@/components/Toast'
import { CamelotBadge } from '@/components/badges'
import { EmptyState } from '@/components/EmptyState'

function payloadSummary(p: Record<string, unknown>) {
  const artist = String(p.artist ?? '')
  const title = String(p.title ?? '')
  const bpm = p.bpm != null ? String(p.bpm) : '—'
  const key = String(p.key ?? '—')
  const camelot = typeof p.camelot === 'string' ? p.camelot : null
  const tuning = typeof p.tuning === 'number' && Number.isFinite(p.tuning) ? p.tuning : null
  return { artist, title, bpm, key, camelot, tuning }
}

export function Review() {
  const { user, loading } = useAuth()
  const [items, setItems] = useState<Submission[]>([])
  /** Approved / applied rows — the ones a mod may need to take back down. */
  const [history, setHistory] = useState<Submission[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [promoteId, setPromoteId] = useState('')
  const [promoteRole, setPromoteRole] = useState<Role>('trusted')

  const load = useCallback(async () => {
    try {
      const list = await apiListSubmissions({ status: 'pending' })
      setItems(list)
    } catch {
      toast('Could not load queue (is the API running?)')
    }
  }, [])

  useEffect(() => {
    document.title = 'Review — KeyBPM'
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await apiListSubmissions({ status: 'approved,applied' }))
    } catch {
      /* history is a convenience — the pending queue above still works */
    }
  }, [])

  const isMod = user?.role === 'mod'

  useEffect(() => {
    if (user && canReview(user.role)) void load()
  }, [user, load])

  useEffect(() => {
    if (isMod) void loadHistory()
  }, [isMod, loadHistory])

  if (!loading && (!user || !canReview(user.role))) {
    return <Navigate to="/contribute" replace />
  }

  async function approve(id: string) {
    setBusy(id)
    try {
      await apiApprove(id)
      await reloadQueueOverlay()
      toast('Approved — live in search now')
      // The row leaves the pending queue and lands in the history below.
      await Promise.all([load(), loadHistory()])
    } catch {
      toast('Approve failed')
    } finally {
      setBusy(null)
    }
  }

  async function reject(id: string) {
    const note = window.prompt('Reject note (optional)') ?? undefined
    setBusy(id)
    try {
      const row = items.find(s => s.id === id)
      await apiReject(id, note || undefined)
      // Clear any localStorage overlay from older clients that wrote on submit.
      const localId =
        (typeof row?.payload?.id === 'string' && row.payload.id) ||
        row?.track_id ||
        null
      if (localId) removeContribution(localId)
      await reloadQueueOverlay()
      toast('Rejected')
      await load()
    } catch {
      toast('Reject failed')
    } finally {
      setBusy(null)
    }
  }

  /** Take a row out of the queue for good (mods only) — undoes an approval. */
  async function remove(s: Submission) {
    const p = payloadSummary(s.payload)
    const what = s.kind === 'correct' ? 'correction' : 'track'
    if (!window.confirm(`Remove this ${what} — ${p.artist} – ${p.title}? This cannot be undone.`)) return
    setBusy(s.id)
    try {
      await apiDeleteSubmission(s.id)
      // Clear any localStorage overlay written by older clients on submit.
      const localId =
        (typeof s.payload.id === 'string' && s.payload.id) || s.track_id || null
      if (localId) removeContribution(localId)
      await reloadQueueOverlay()
      toast(
        s.status === 'applied'
          ? 'Queue row deleted — also remove it from data/tracks.json and redeploy'
          : 'Removed — no longer in search',
      )
      await Promise.all([load(), loadHistory()])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(null)
    }
  }

  async function promote(e: React.FormEvent) {
    e.preventDefault()
    if (!promoteId.trim()) return
    try {
      await apiSetRole(promoteId.trim(), promoteRole)
      toast(`Role set to ${promoteRole}`)
      setPromoteId('')
    } catch {
      toast('Role update failed')
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8">
      <h1 className="text-lg font-semibold">Review queue</h1>
      <p className="mt-2 text-text-muted">
        Approve puts a track live in search immediately. Run{' '}
        <code className="font-mono text-xs">npm run data:apply-queue</code> when you want it written into{' '}
        <code className="font-mono text-xs">data/tracks.json</code> for deploy / git.
      </p>

      {items.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No pending submissions" hint="New Discord contributions will show up here." />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map(s => {
            const p = payloadSummary(s.payload)
            const existing = s.track_id ? getTrack(s.track_id) : undefined
            return (
              <li key={s.id} className="surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-text-dim">
                      {s.kind} · {s.created_at}
                      {s.payload.submittedBy != null && (
                        <> · by {String(s.payload.submittedBy)}</>
                      )}
                    </div>
                    <div className="mt-1 truncate font-medium">
                      {p.artist} – {p.title || '—'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                      <span>{p.bpm} BPM</span>
                      <span>{p.key}</span>
                      {p.tuning !== null && (
                        <span>
                          {p.tuning > 0 ? '+' : ''}
                          {p.tuning}¢
                        </span>
                      )}
                      {p.camelot && <CamelotBadge code={p.camelot} />}
                    </div>
                    {existing && (
                      <p className="mt-2 text-xs text-text-dim">
                        Current:{' '}
                        <Link to={`/track/${existing.id}`} className="underline underline-offset-2 hover:text-text">
                          {existing.artist} – {existing.title}
                        </Link>
                        {' · '}
                        {existing.bpm ?? '—'} BPM · {existing.key ?? '—'} · {existing.camelot ?? '—'}
                      </p>
                    )}
                    {typeof s.payload.notes === 'string' && s.payload.notes && (
                      <p className="mt-2 text-xs text-text-muted">{s.payload.notes}</p>
                    )}
                    {typeof s.payload.youtube === 'string' && s.payload.youtube && (
                      <a
                        href={s.payload.youtube}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-accent hover:text-accent-hover"
                      >
                        YouTube
                      </a>
                    )}
                    {typeof s.payload.soundcloud === 'string' && s.payload.soundcloud && (
                      <a
                        href={s.payload.soundcloud}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-accent hover:text-accent-hover"
                      >
                        SoundCloud
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary px-3 py-1.5 text-xs"
                      disabled={busy === s.id}
                      onClick={() => approve(s.id)}
                    >
                      Approve
                    </button>
                    {isMod && (
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-xs"
                        disabled={busy === s.id}
                        onClick={() => reject(s.id)}
                      >
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {isMod && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold">Approved &amp; applied</h2>
          <p className="mt-1 text-xs text-text-dim">
            Rows you approved earlier. <span className="text-text-muted">Remove</span> deletes the queue row —
            an <span className="text-text-muted">approved</span> track drops out of live search straight away,
            while an <span className="text-text-muted">applied</span> one is already in{' '}
            <code className="font-mono text-xs">data/tracks.json</code> and must be deleted there too
            (then redeploy).
          </p>
          {history.length === 0 ? (
            <p className="mt-3 text-xs text-text-dim">Nothing removed or approved yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-bg-card">
              {history.map(s => {
                const p = payloadSummary(s.payload)
                const trackId =
                  (typeof s.payload.id === 'string' && s.payload.id) || s.track_id || null
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {p.artist} – {p.title || '—'}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {s.status === 'applied' ? 'applied · in data/tracks.json' : 'approved · live in search'}
                        {' · '}
                        {s.kind} · {p.bpm} BPM · {p.key}
                        {p.camelot ? ` · ${p.camelot}` : ''}
                        {' · '}
                        {s.reviewed_at ?? s.created_at}
                        {typeof s.payload.submittedBy === 'string' && s.payload.submittedBy
                          ? ` · by ${s.payload.submittedBy}`
                          : ''}
                      </span>
                    </div>
                    {trackId && (
                      <Link
                        to={`/track/${trackId}`}
                        className="text-xs text-accent hover:text-accent-hover"
                      >
                        Open
                      </Link>
                    )}
                    <button
                      type="button"
                      className="btn-danger px-3 py-1.5 text-xs"
                      disabled={busy === s.id}
                      onClick={() => remove(s)}
                      title="Delete this queue row permanently"
                    >
                      {busy === s.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {isMod && (
        <section className="surface mt-10 p-4">
          <h2 className="text-sm font-semibold">Promote user</h2>
          <p className="mt-1 text-xs text-text-dim">
            Set role by Discord snowflake ID (from a submission&apos;s submitter id).
          </p>
          <form onSubmit={promote} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block min-w-[12rem] flex-1">
              <span className="mb-1 block text-xs text-text-muted">Discord ID</span>
              <input
                className="input w-full"
                value={promoteId}
                onChange={e => setPromoteId(e.target.value)}
                placeholder="123456789012345678"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">Role</span>
              <select
                className="input"
                value={promoteRole}
                onChange={e => setPromoteRole(e.target.value as Role)}
              >
                <option value="user">user</option>
                <option value="trusted">trusted</option>
                <option value="mod">mod</option>
              </select>
            </label>
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs">
              Set role
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
