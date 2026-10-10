/** Base URL for the KeyBPM API Worker. Empty = same origin (Pages + Worker routes). */
export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE as string | undefined
  return (raw ?? '').replace(/\/$/, '')
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}${p}`
}

export type Role = 'user' | 'trusted' | 'mod'

export interface AuthUser {
  id: string
  username: string
  avatar: string | null
  role: Role
  avatarUrl: string | null
}

export interface Submission {
  id: string
  discord_id: string
  kind: 'add' | 'correct'
  track_id: string | null
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'applied'
  reviewer_id: string | null
  reject_note: string | null
  created_at: string
  reviewed_at: string | null
  /** Display name of the reviewer, resolved by the API (null for pending rows). */
  reviewer_username?: string | null
}

export async function apiGetMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(apiUrl('/api/me'), { credentials: 'include' })
    if (res.status === 401) return null
    if (!res.ok) return null
    return (await res.json()) as AuthUser
  } catch {
    return null
  }
}

export async function apiLogout(): Promise<void> {
  await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {})
}

export function loginUrl(): string {
  return apiUrl('/auth/discord')
}

export async function apiCreateSubmission(body: {
  kind: 'add' | 'correct'
  trackId?: string | null
  payload: Record<string, unknown>
}): Promise<Submission> {
  const res = await fetch(apiUrl('/api/submissions'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Submit failed (${res.status})`)
  }
  return (await res.json()) as Submission
}

export async function apiListSubmissions(opts?: {
  status?: string
  mine?: boolean
}): Promise<Submission[]> {
  const q = new URLSearchParams()
  if (opts?.status) q.set('status', opts.status)
  if (opts?.mine) q.set('mine', '1')
  const res = await fetch(apiUrl(`/api/submissions?${q}`), { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load submissions')
  const data = (await res.json()) as { submissions: Submission[] }
  return data.submissions
}

export async function apiApprove(id: string): Promise<Submission> {
  const res = await fetch(apiUrl(`/api/submissions/${id}/approve`), {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Approve failed')
  return (await res.json()) as Submission
}

export async function apiReject(id: string, note?: string): Promise<Submission> {
  const res = await fetch(apiUrl(`/api/submissions/${id}/reject`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  })
  if (!res.ok) throw new Error('Reject failed')
  return (await res.json()) as Submission
}

export async function apiSetRole(discordId: string, role: Role): Promise<AuthUser> {
  const res = await fetch(apiUrl(`/api/users/${discordId}/role`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  if (!res.ok) throw new Error('Role update failed')
  return (await res.json()) as AuthUser
}

export function canReview(role: Role | undefined): boolean {
  return role === 'trusted' || role === 'mod'
}

/**
 * Hard-delete a queue row (mods only) — undoes an approval or drops a test entry.
 * Call `reloadQueueOverlay()` afterwards so the live catalogue drops the track.
 */
export async function apiDeleteSubmission(id: string): Promise<Submission> {
  const res = await fetch(apiUrl(`/api/submissions/${id}`), {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Delete failed (${res.status})`)
  }
  return (await res.json()) as Submission
}

/** Approved-but-not-yet-in-tracks.json rows — public, powers live search after Approve. */
export async function apiOverlay(): Promise<Submission[]> {
  try {
    const res = await fetch(apiUrl('/api/overlay'), { credentials: 'omit' })
    if (!res.ok) return []
    const data = (await res.json()) as { submissions: Submission[] }
    return Array.isArray(data.submissions) ? data.submissions : []
  } catch {
    return []
  }
}

/**
 * One reviewed queue row, flattened for the public activity feed. Values come
 * from the submission payload (the track itself is read from the catalogue by
 * `trackId`), so a row stays readable even after it is applied and leaves the
 * overlay.
 */
export interface ActivityItem {
  id: string
  kind: 'add' | 'correct'
  status: 'approved' | 'applied'
  /** Track the row is about — the target of a correction, the proposed id of an add. */
  trackId: string | null
  artist: string | null
  title: string | null
  bpm: number | null
  key: string | null
  camelot: string | null
  /** Who submitted the track (add) or made the edit (correct). */
  by: string | null
  createdAt: string
  reviewedAt: string | null
  /** Reviewer who approved it — a review is what verification means here. */
  reviewer: string | null
}

/**
 * Recent reviewed contributions, newest review first.
 *
 * `null` — not an empty array — when the API could not be reached or answered
 * with an error: the feed must never present "silence" as "nothing ever
 * happened" (a static deploy without the Worker has no queue to show).
 */
export async function apiActivity(limit = 30): Promise<ActivityItem[] | null> {
  try {
    const res = await fetch(apiUrl(`/api/activity?limit=${limit}`), { credentials: 'omit' })
    if (!res.ok) return null
    const data = (await res.json()) as { activity: ActivityItem[] }
    return Array.isArray(data.activity) ? data.activity : null
  } catch {
    return null
  }
}
