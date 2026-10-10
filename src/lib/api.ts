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
