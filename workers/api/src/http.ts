import type { Env } from './types'

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

export function isSecure(url: URL): boolean {
  return url.protocol === 'https:'
}

/** CORS for local Vite ↔ Worker; same-origin in production needs no CORS. */
export function withCors(req: Request, env: Env, res: Response): Response {
  const origin = req.headers.get('Origin')
  const allowed = env.APP_ORIGIN.replace(/\/$/, '')
  if (!origin) return res
  if (origin !== allowed && origin !== 'http://localhost:5173' && origin !== 'http://127.0.0.1:5173') {
    return res
  }
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Vary', 'Origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

export function optionsCors(req: Request, env: Env): Response {
  return withCors(req, env, new Response(null, { status: 204 }))
}

export function publicOrigin(req: Request, env: Env): string {
  // Prefer the request host when the Worker is same-origin with the SPA.
  const url = new URL(req.url)
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    return `${url.protocol}//${url.host}`
  }
  return env.APP_ORIGIN.replace(/\/$/, '')
}
