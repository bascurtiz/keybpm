import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getTrack } from '@/lib/data'
import { CAMELOT_WHEEL, KEY_TO_CAMELOT } from '@/types/track'
import { slugId } from '@/lib/contributions'
import { canonicalYoutube } from '@/lib/youtube'
import { toast } from '@/components/Toast'
import { CamelotBadge } from '@/components/badges'
import type { Track } from '@/types/track'
import { useAuth } from '@/lib/AuthContext'
import { apiCreateSubmission, apiListSubmissions, type Submission } from '@/lib/api'

const KEY_OPTIONS = Object.values(CAMELOT_WHEEL).flatMap(w => [w.minor, w.major])

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  )
}

/** Add / suggest-correction — Discord login required; submits go to the review queue. */
export function Contribute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, loading: authLoading, login } = useAuth()

  const correctId = params.get('correct')
  const original = correctId ? getTrack(correctId) : undefined
  const mode = original ? 'correct' : 'add'

  useEffect(() => {
    const auth = params.get('auth')
    if (!auth) return
    if (auth === 'ok') toast('Signed in with Discord')
    if (auth === 'error') toast('Discord sign-in failed')
    const next = new URLSearchParams(params)
    next.delete('auth')
    const q = next.toString()
    navigate(`/contribute${q ? `?${q}` : ''}`, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — one-shot URL flag

  const [artist, setArtist] = useState('')
  const [title, setTitle] = useState('')
  const [keyName, setKeyName] = useState('')
  const [bpm, setBpm] = useState('')
  const [tuning, setTuning] = useState('')
  const [notes, setNotes] = useState('')
  const [youtube, setYoutube] = useState('')

  useEffect(() => {
    if (original) {
      setArtist(original.artist)
      setTitle(original.title)
      setKeyName(original.key ?? '')
      setBpm(original.bpm !== null ? String(original.bpm) : '')
      setTuning(
        original.tuning !== undefined ? `${original.tuning > 0 ? '+' : ''}${original.tuning}` : '',
      )
      setNotes(original.notes ?? '')
      setYoutube(original.youtube ?? '')
    }
  }, [original])

  useEffect(() => {
    document.title = original
      ? `Suggest correction — KeyBPM`
      : 'Contribute — KeyBPM'
  }, [original])

  const camelot = keyName ? KEY_TO_CAMELOT[keyName] ?? '' : ''
  /** Cents sharp (+), flat (−) or off (0). Blank = not stated. `NaN` when the text isn't a number. */
  const tuningValue = useMemo(() => {
    const t = tuning.trim()
    if (!t) return undefined
    const n = Number(t)
    return Number.isFinite(n) ? Math.round(n) : Number.NaN
  }, [tuning])
  const tuningInvalid = tuningValue !== undefined && !Number.isFinite(tuningValue)
  const canSubmit = Boolean(artist.trim() && title.trim() && keyName && bpm.trim() && !tuningInvalid)

  const previewTrack = useMemo<Track | null>(() => {
    if (!canSubmit || !camelot) return null
    const n = Number(bpm)
    return {
      ...original,
      id: original?.id ?? slugId(artist, title),
      artist: artist.trim(),
      title: title.trim(),
      bpm: Number.isFinite(n) && n > 0 ? n : null,
      key: keyName,
      camelot,
      tuning: tuningValue,
      genre: original?.genre ?? null,
      label: original?.label ?? null,
      release: original?.release ?? null,
      year: original?.year ?? null,
      duration: original?.duration ?? null,
      source: 'Community',
      confidence: original?.confidence ?? null,
      lastVerified: original?.lastVerified ?? null,
      notes: notes.trim() || undefined,
      youtube: canonicalYoutube(youtube) ?? undefined,
    }
  }, [canSubmit, camelot, artist, title, bpm, keyName, tuningValue, notes, youtube, original])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) {
      login()
      return
    }
    if (tuningInvalid) {
      toast('Tuning must be a number of cents, e.g. +25 or -40')
      return
    }
    if (!canSubmit || !previewTrack) {
      toast('Please fill in all required (*) fields')
      return
    }

    const track = previewTrack
    if (mode === 'add' && getTrack(track.id)) {
      toast('A track with that artist/title already exists')
      return
    }

    try {
      await apiCreateSubmission({
        kind: mode === 'correct' ? 'correct' : 'add',
        trackId: mode === 'correct' ? original!.id : null,
        payload: track as unknown as Record<string, unknown>,
      })
      toast('Queued for review — appears in search after Approve')
      navigate(mode === 'correct' && original ? `/track/${original.id}` : '/contribute')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Submit failed')
    }
  }

  if (authLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8">
        <p className="text-sm text-text-muted">Checking Discord session…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8">
        <h1 className="text-lg font-semibold">
          {mode === 'correct' ? 'Suggest a correction' : 'Contribute'}
        </h1>

        <section className="surface mt-4 p-6">
          <h2 className="text-sm font-semibold">How can you contribute?</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-text-muted marker:text-text-dim">
            <li>
              Found a track missing a YouTube link (those that don&apos;t show a YouTube thumbnail) or a wrong
              video.
            </li>
            <li>
              Found wrong or missing info on a track (compared to what&apos;s stated in the{' '}
              <a
                href="https://docs.google.com/document/d/1WcHNaTo6KHNG88yUWxrCULuwHPuQCGQ8UtItgzzK50Q/edit?tab=t.0"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accent-hover"
              >
                duuzu database spreadsheet
              </a>
              ).
            </li>
            <li>A track that&apos;s not in the database yet, which you have keyed and bpm-determined.</li>
          </ol>
          <p className="mt-4 border-t border-line pt-4 text-sm text-text-muted">
            Either <span className="text-text">open the track</span>, click the{' '}
            <span className="text-text">Suggest correction</span> button and fill in the proper info. Or click{' '}
            <span className="text-text">Contribute</span>, <span className="text-text">add new track</span> and fill
            in the proper info.
          </p>
        </section>

        <div className="surface mt-5 p-6">
          <p className="text-sm text-text-muted">
            Sign in with Discord to add tracks or suggest corrections. Submissions go to a review queue.
          </p>
          <button type="button" className="btn-primary mt-4 px-4 py-2 text-sm" onClick={login}>
            Sign in with Discord
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {mode === 'correct' ? 'Suggest a correction' : 'Add a new track'}
        </h1>
        <p className="text-xs text-text-muted">
          {mode === 'correct'
            ? `Editing ${original?.artist} – ${original?.title}`
            : 'Signed in — submissions are reviewed before going live.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="surface mt-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Artist" required>
            <input
              className="input w-full"
              value={artist}
              onChange={e => setArtist(e.target.value)}
              placeholder="e.g. Nova Kestrel"
            />
          </Field>
          <Field label="Track title" required>
            <input
              className="input w-full"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Low Orbit"
            />
          </Field>
          <Field label="Key / Mode" required>
            <select
              className="input w-full"
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
            >
              <option value="">Select key</option>
              {KEY_OPTIONS.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="BPM" required>
            <input
              className="input w-full"
              value={bpm}
              onChange={e => setBpm(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 124 or 127.5"
            />
          </Field>
          <Field label="Tuning (cents)">
            <input
              className={`input w-full ${tuningInvalid ? 'border-bad focus:border-bad focus:ring-bad' : ''}`}
              value={tuning}
              onChange={e => setTuning(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={tuningInvalid || undefined}
              placeholder="e.g. +25 (sharp) or -40 (flat)"
            />
          </Field>
          <Field label="YouTube URL">
            <input
              className="input w-full"
              value={youtube}
              onChange={e => setYoutube(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              inputMode="url"
              autoComplete="off"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <input
                className="input w-full"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Key changes, alternate BPM, caveats…"
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {camelot ? (
              <>
                <CamelotBadge code={camelot} />
                <span>derived from {keyName}</span>
              </>
            ) : (
              <span>Select a key to derive its Camelot code</span>
            )}
            {tuningInvalid ? (
              <span className="text-bad">Tuning must be a number of cents, e.g. +25 or -40</span>
            ) : (
              tuningValue !== undefined && (
                <span>
                  tuning {tuningValue > 0 ? '+' : ''}
                  {tuningValue}¢ {tuningValue > 0 ? 'sharp' : tuningValue < 0 ? 'flat' : 'standard'}
                </span>
              )
            )}
          </div>
          <button type="submit" className="btn-primary px-3 py-1.5 text-xs">
            {mode === 'correct' ? 'Submit correction' : 'Submit track'}
          </button>
        </div>
        <p className="mt-3 text-xs text-text-dim">
          Signed in as <span className="text-text-muted">{user.username}</span> — queued for review.
        </p>
      </form>

      <YourQueue />
    </div>
  )
}

function YourQueue() {
  const [items, setItems] = useState<Submission[]>([])
  const load = useCallback(async () => {
    try {
      setItems(await apiListSubmissions({ mine: true }))
    } catch {
      /* API down */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (items.length === 0) {
    return (
      <p className="mt-6 text-xs text-text-dim">
        Your Discord submissions will show here with their review status.
      </p>
    )
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Your submissions</h2>
      <div className="divide-y divide-line rounded-card border border-line bg-bg-card">
        {items.map(s => {
          const artist = String(s.payload.artist ?? '')
          const title = String(s.payload.title ?? '')
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {artist} – {title || '—'}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {s.kind} · {s.status} · {s.created_at}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-text-dim">
        Mods review on <Link to="/review" className="underline underline-offset-2 hover:text-text">Review</Link>.
      </p>
    </section>
  )
}
