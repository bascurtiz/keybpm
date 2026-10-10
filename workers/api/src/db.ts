import type { Env, Role, SubmissionRow, UserRow } from './types'

export async function getUser(env: Env, discordId: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE discord_id = ?')
    .bind(discordId)
    .first<UserRow>()
}

export async function upsertUser(
  env: Env,
  discordId: string,
  username: string,
  avatar: string | null,
): Promise<UserRow> {
  const mods = new Set(
    (env.MOD_DISCORD_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
  const existing = await getUser(env, discordId)
  if (existing) {
    await env.DB.prepare('UPDATE users SET username = ?, avatar = ? WHERE discord_id = ?')
      .bind(username, avatar, discordId)
      .run()
    return { ...existing, username, avatar }
  }
  const role: Role = mods.has(discordId) ? 'mod' : 'user'
  await env.DB.prepare(
    'INSERT INTO users (discord_id, username, avatar, role) VALUES (?, ?, ?, ?)',
  )
    .bind(discordId, username, avatar, role)
    .run()
  const row = await getUser(env, discordId)
  if (!row) throw new Error('Failed to create user')
  return row
}

export async function setRole(env: Env, discordId: string, role: Role): Promise<UserRow | null> {
  await env.DB.prepare('UPDATE users SET role = ? WHERE discord_id = ?').bind(role, discordId).run()
  return getUser(env, discordId)
}

export function newId(): string {
  return crypto.randomUUID()
}

export async function insertSubmission(
  env: Env,
  row: {
    discordId: string
    kind: 'add' | 'correct'
    trackId: string | null
    payload: unknown
  },
): Promise<SubmissionRow> {
  const id = newId()
  await env.DB.prepare(
    `INSERT INTO submissions (id, discord_id, kind, track_id, payload, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(id, row.discordId, row.kind, row.trackId, JSON.stringify(row.payload))
    .run()
  const created = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<SubmissionRow>()
  if (!created) throw new Error('Failed to create submission')
  return created
}

export async function listSubmissions(
  env: Env,
  opts: {
    status?: string | string[]
    discordId?: string
    limit?: number
    /** `asc` = oldest first; the overlay/apply paths fold rows in that order. */
    order?: 'asc' | 'desc'
  },
): Promise<SubmissionRow[]> {
  const limit = Math.min(opts.limit ?? 100, 200)
  const statuses = (Array.isArray(opts.status) ? opts.status : opts.status ? [opts.status] : [])
    .map(s => s.trim())
    .filter(Boolean)

  const where: string[] = []
  const binds: string[] = []
  if (statuses.length) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`)
    binds.push(...statuses)
  }
  if (opts.discordId) {
    where.push('discord_id = ?')
    binds.push(opts.discordId)
  }

  // `asc` also breaks ties on rowid: created_at has second resolution, so two
  // rows from the same second would otherwise come back in an arbitrary order
  // (and a correction must never precede the add it corrects).
  const orderBy = opts.order === 'asc' ? 'created_at ASC, rowid ASC' : 'created_at DESC'

  const { results } = await env.DB.prepare(
    `SELECT * FROM submissions${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<SubmissionRow>()
  return results ?? []
}

export async function getSubmission(env: Env, id: string): Promise<SubmissionRow | null> {
  return env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first<SubmissionRow>()
}

/** Hard-delete a queue row. Returns the number of rows removed (0 = unknown id). */
export async function deleteSubmission(env: Env, id: string): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run()
  return r.meta.changes ?? 0
}

export async function reviewSubmission(
  env: Env,
  id: string,
  status: 'approved' | 'rejected',
  reviewerId: string,
  rejectNote?: string,
): Promise<SubmissionRow | null> {
  await env.DB.prepare(
    `UPDATE submissions
     SET status = ?, reviewer_id = ?, reject_note = ?, reviewed_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(status, reviewerId, rejectNote ?? null, id)
    .run()
  return getSubmission(env, id)
}

export async function markApplied(env: Env, ids: string[]): Promise<number> {
  if (!ids.length) return 0
  let n = 0
  for (const id of ids) {
    const r = await env.DB.prepare(
      `UPDATE submissions SET status = 'applied' WHERE id = ? AND status = 'approved'`,
    )
      .bind(id)
      .run()
    n += r.meta.changes ?? 0
  }
  return n
}
