export type Role = 'user' | 'trusted' | 'mod'
export type SubmissionKind = 'add' | 'correct'
export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'applied'

export interface Env {
  DB: D1Database
  DISCORD_CLIENT_ID: string
  DISCORD_CLIENT_SECRET: string
  SESSION_SECRET: string
  /** Comma-separated Discord IDs that become mod on first login. */
  MOD_DISCORD_IDS: string
  /** SPA origin for redirects, e.g. https://keybpm.pages.dev or http://localhost:5173 */
  APP_ORIGIN: string
  /** Optional bearer token for data:apply-queue script. */
  APPLY_TOKEN?: string
}

export interface UserRow {
  discord_id: string
  username: string
  avatar: string | null
  role: Role
  created_at: string
}

export interface SubmissionRow {
  id: string
  discord_id: string
  kind: SubmissionKind
  track_id: string | null
  payload: string
  status: SubmissionStatus
  reviewer_id: string | null
  reject_note: string | null
  created_at: string
  reviewed_at: string | null
}

export interface PublicUser {
  id: string
  username: string
  avatar: string | null
  role: Role
  avatarUrl: string | null
}

export function avatarUrl(id: string, avatar: string | null): string | null {
  if (!avatar) return null
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.discord_id,
    username: u.username,
    avatar: u.avatar,
    role: u.role,
    avatarUrl: avatarUrl(u.discord_id, u.avatar),
  }
}
