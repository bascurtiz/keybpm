import { getUser, insertSubmission, listSubmissions, getSubmission, reviewSubmission, setRole, upsertUser, markApplied } from './db'
import { canonicalSoundcloud, fetchSoundcloudArtwork } from './artwork'
import { err, json, optionsCors, publicOrigin, withCors, isSecure } from './http'
import {
  clearOauthStateCookie,
  clearSessionCookie,
  createSessionToken,
  getCookie,
  oauthStateCookie,
  readSessionToken,
  sessionCookie,
  COOKIE,
} from './session'
import type { Env, Role, SubmissionRow } from './types'
import { toPublicUser } from './types'

const PUBLIC_CORS = { 'Access-Control-Allow-Origin': '*' }

function serializeSubmission(row: SubmissionRow) {
  let payload: unknown = null
  try {
    payload = JSON.parse(row.payload)
  } catch {
    payload = row.payload
  }
  return { ...row, payload }
}

async function requireUser(req: Request, env: Env) {
  const token = getCookie(req, COOKIE)
  const discordId = await readSessionToken(env, token)
  if (!discordId) return null
  return getUser(env, discordId)
}

function canReview(role: Role): boolean {
  return role === 'trusted' || role === 'mod'
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return optionsCors(req, env)

    const url = new URL(req.url)
    const path = url.pathname
    const secure = isSecure(url)
    const appOrigin = env.APP_ORIGIN.replace(/\/$/, '')

    try {
      // ---- Auth ----
      if (path === '/auth/discord' && req.method === 'GET') {
        if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) {
          return err('Discord auth is not configured on this server', 503)
        }
        const state = crypto.randomUUID()
        const redirectUri = `${publicOrigin(req, env)}/auth/callback`
        const params = new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          response_type: 'code',
          scope: 'identify',
          redirect_uri: redirectUri,
          state,
          prompt: 'none',
        })
        // prompt=none fails for first login; use consent when needed — Discord ignores unknown; use default
        params.delete('prompt')
        const headers = new Headers({ Location: `https://discord.com/api/oauth2/authorize?${params}` })
        headers.append('Set-Cookie', oauthStateCookie(state, secure))
        return withCors(req, env, new Response(null, { status: 302, headers }))
      }

      if (path === '/auth/callback' && req.method === 'GET') {
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const expected = getCookie(req, 'keybpm_oauth_state')
        if (!code || !state || !expected || state !== expected) {
          return withCors(
            req,
            env,
            new Response(null, {
              status: 302,
              headers: {
                Location: `${appOrigin}/contribute?auth=error`,
                'Set-Cookie': clearOauthStateCookie(secure),
              },
            }),
          )
        }

        const redirectUri = `${publicOrigin(req, env)}/auth/callback`
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
          }),
        })
        if (!tokenRes.ok) {
          return withCors(
            req,
            env,
            new Response(null, {
              status: 302,
              headers: { Location: `${appOrigin}/contribute?auth=error` },
            }),
          )
        }
        const tokenJson = (await tokenRes.json()) as { access_token: string }
        const meRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        })
        if (!meRes.ok) {
          return withCors(
            req,
            env,
            new Response(null, {
              status: 302,
              headers: { Location: `${appOrigin}/contribute?auth=error` },
            }),
          )
        }
        const me = (await meRes.json()) as {
          id: string
          username: string
          global_name?: string | null
          avatar: string | null
        }
        const display = me.global_name?.trim() || me.username
        await upsertUser(env, me.id, display, me.avatar)
        const session = await createSessionToken(env, me.id)
        const headers = new Headers({ Location: `${appOrigin}/contribute?auth=ok` })
        headers.append('Set-Cookie', clearOauthStateCookie(secure))
        headers.append('Set-Cookie', sessionCookie(session, secure))
        return withCors(req, env, new Response(null, { status: 302, headers }))
      }

      if (path === '/auth/logout' && req.method === 'POST') {
        return withCors(
          req,
          env,
          json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) }),
        )
      }

      // ---- API ----
      if (path === '/api/me' && req.method === 'GET') {
        const user = await requireUser(req, env)
        if (!user) return withCors(req, env, err('Unauthorized', 401))
        return withCors(req, env, json(toPublicUser(user)))
      }

      if (path === '/api/submissions' && req.method === 'POST') {
        const user = await requireUser(req, env)
        if (!user) return withCors(req, env, err('Unauthorized', 401))
        let body: {
          kind?: string
          trackId?: string | null
          payload?: Record<string, unknown>
        }
        try {
          body = await req.json()
        } catch {
          return withCors(req, env, err('Invalid JSON'))
        }
        if (body.kind !== 'add' && body.kind !== 'correct') {
          return withCors(req, env, err('kind must be add or correct'))
        }
        if (!body.payload || typeof body.payload !== 'object') {
          return withCors(req, env, err('payload required'))
        }
        if (body.kind === 'correct' && !body.trackId) {
          return withCors(req, env, err('trackId required for corrections'))
        }
        const artist = typeof body.payload.artist === 'string' ? body.payload.artist.trim() : ''
        const title = typeof body.payload.title === 'string' ? body.payload.title.trim() : ''
        if (!artist || !title) return withCors(req, env, err('artist and title required'))

        const stamped = {
          ...body.payload,
          submittedBy: user.username,
          submittedByDiscordId: user.discord_id,
        }
        const row = await insertSubmission(env, {
          discordId: user.discord_id,
          kind: body.kind,
          trackId: body.kind === 'correct' ? (body.trackId ?? null) : null,
          payload: stamped,
        })
        return withCors(req, env, json(serializeSubmission(row), 201))
      }

      if (path === '/api/submissions' && req.method === 'GET') {
        const user = await requireUser(req, env)
        if (!user) return withCors(req, env, err('Unauthorized', 401))
        const status = url.searchParams.get('status') ?? undefined
        const mine = url.searchParams.get('mine') === '1'

        let list: SubmissionRow[]
        if (mine || !canReview(user.role)) {
          list = await listSubmissions(env, { discordId: user.discord_id, status })
        } else {
          // Reviewers default to pending queue.
          list = await listSubmissions(env, { status: status ?? 'pending' })
        }
        return withCors(req, env, json({ submissions: list.map(serializeSubmission) }))
      }

      const approveMatch = path.match(/^\/api\/submissions\/([^/]+)\/approve$/)
      if (approveMatch && req.method === 'POST') {
        const user = await requireUser(req, env)
        if (!user) return withCors(req, env, err('Unauthorized', 401))
        if (!canReview(user.role)) return withCors(req, env, err('Forbidden', 403))
        const row = await reviewSubmission(env, approveMatch[1], 'approved', user.discord_id)
        if (!row || row.status !== 'approved') {
          return withCors(req, env, err('Not found or already reviewed', 404))
        }
        return withCors(req, env, json(serializeSubmission(row)))
      }

      const rejectMatch = path.match(/^\/api\/submissions\/([^/]+)\/reject$/)
      if (rejectMatch && req.method === 'POST') {
        const user = await requireUser(req, env)
        if (!user) return withCors(req, env, err('Unauthorized', 401))
        if (user.role !== 'mod') return withCors(req, env, err('Forbidden', 403))
        let note: string | undefined
        try {
          const body = (await req.json()) as { note?: string }
          note = body.note
        } catch {
          /* optional body */
        }
        const row = await reviewSubmission(env, rejectMatch[1], 'rejected', user.discord_id, note)
        if (!row || row.status !== 'rejected') {
          return withCors(req, env, err('Not found or already reviewed', 404))
        }
        return withCors(req, env, json(serializeSubmission(row)))
      }

      const roleMatch = path.match(/^\/api\/users\/([^/]+)\/role$/)
      if (roleMatch && req.method === 'POST') {
        const user = await requireUser(req, env)
        if (!user) return withCors(req, env, err('Unauthorized', 401))
        if (user.role !== 'mod') return withCors(req, env, err('Forbidden', 403))
        let body: { role?: string }
        try {
          body = await req.json()
        } catch {
          return withCors(req, env, err('Invalid JSON'))
        }
        if (body.role !== 'user' && body.role !== 'trusted' && body.role !== 'mod') {
          return withCors(req, env, err('role must be user, trusted, or mod'))
        }
        const updated = await setRole(env, roleMatch[1], body.role)
        if (!updated) return withCors(req, env, err('User not found', 404))
        return withCors(req, env, json(toPublicUser(updated)))
      }

      // Public SoundCloud artwork proxy — the browser can't read SoundCloud
      // pages (no CORS) and oEmbed is 403 for many networks, so the Worker
      // resolves og:image once and caches it. Wildcard CORS: public, no cookies.
      if (path === '/api/artwork' && req.method === 'GET') {
        const canonical = canonicalSoundcloud(url.searchParams.get('url') ?? '')
        if (!canonical) return json({ artwork: null, error: 'Not a SoundCloud track URL' }, 400, PUBLIC_CORS)

        const cacheKey = new Request(`${url.origin}/api/artwork?url=${encodeURIComponent(canonical)}`)
        let hit: Response | undefined
        try {
          hit = await caches.default.match(cacheKey)
        } catch {
          /* cache unavailable — resolve live */
        }
        if (hit) return hit

        const artwork = await fetchSoundcloudArtwork(canonical)
        const res = new Response(
          JSON.stringify({ artwork, url: canonical }),
          {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              // Covers change rarely; failures retry in an hour.
              'Cache-Control': artwork ? 'public, max-age=604800' : 'public, max-age=3600',
            },
          },
        )
        try {
          await caches.default.put(cacheKey, res.clone())
        } catch {
          /* cache unavailable — still serve the fresh result */
        }
        return res
      }

      // Public live overlay: approved (not yet written to tracks.json) appear in search.
      if (path === '/api/overlay' && req.method === 'GET') {
        const rows = await listSubmissions(env, { status: 'approved', limit: 500 })
        return withCors(
          req,
          env,
          json({
            submissions: rows.map(serializeSubmission),
          }),
        )
      }

      // Export approved (not yet applied) for data:apply-queue
      if (path === '/api/export/approved' && req.method === 'GET') {
        const auth = req.headers.get('Authorization') || ''
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        const user = await requireUser(req, env)
        const tokenOk = env.APPLY_TOKEN && bearer === env.APPLY_TOKEN
        if (!tokenOk && !(user && user.role === 'mod')) {
          return withCors(req, env, err('Forbidden', 403))
        }
        const rows = await listSubmissions(env, { status: 'approved', limit: 500 })
        return withCors(req, env, json({ submissions: rows.map(serializeSubmission) }))
      }

      if (path === '/api/export/mark-applied' && req.method === 'POST') {
        const auth = req.headers.get('Authorization') || ''
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        const user = await requireUser(req, env)
        const tokenOk = env.APPLY_TOKEN && bearer === env.APPLY_TOKEN
        if (!tokenOk && !(user && user.role === 'mod')) {
          return withCors(req, env, err('Forbidden', 403))
        }
        let body: { ids?: string[] }
        try {
          body = await req.json()
        } catch {
          return withCors(req, env, err('Invalid JSON'))
        }
        const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string') : []
        const n = await markApplied(env, ids)
        return withCors(req, env, json({ applied: n }))
      }

      if (path === '/api/health' && req.method === 'GET') {
        return withCors(req, env, json({ ok: true }))
      }

      return withCors(req, env, err('Not found', 404))
    } catch (e) {
      console.error(e)
      return withCors(req, env, err('Internal error', 500))
    }
  },
}
