import type { Env } from './types'

const COOKIE = 'keybpm_session'
const MAX_AGE = 60 * 60 * 24 * 14 // 14 days

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Payload: discordId.exp — signed as discordId.exp.sig */
export async function createSessionToken(env: Env, discordId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const body = `${discordId}.${exp}`
  const sig = await hmac(env.SESSION_SECRET, body)
  return `${body}.${sig}`
}

export async function readSessionToken(env: Env, token: string | null): Promise<string | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [discordId, expStr, sig] = parts
  const exp = Number(expStr)
  if (!discordId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null
  const body = `${discordId}.${expStr}`
  const expected = await hmac(env.SESSION_SECRET, body)
  if (sig.length !== expected.length) return null
  let ok = 0
  for (let i = 0; i < sig.length; i++) ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (ok !== 0) return null
  return discordId
}

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('Cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function sessionCookie(token: string, secure: boolean): string {
  const flags = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function clearSessionCookie(secure: boolean): string {
  const flags = [`${COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax']
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export { COOKIE }

export function oauthStateCookie(state: string, secure: boolean): string {
  const flags = [
    `keybpm_oauth_state=${encodeURIComponent(state)}`,
    'Path=/',
    'Max-Age=600',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) flags.push('Secure')
  return flags.join('; ')
}

export function clearOauthStateCookie(secure: boolean): string {
  const flags = ['keybpm_oauth_state=', 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax']
  if (secure) flags.push('Secure')
  return flags.join('; ')
}
