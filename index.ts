import { parseCookies, escapeHtml } from './lib/utils'
import { COOKIE_NAME, COOKIE_MAX_AGE, generateTokenAndCookie, validateCookie } from './lib/auth'
import { makeLoginForm, makeDenyPage } from './lib/templates'

addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(handleRequest(event.request))
})

function getSecret(name: string): string | undefined {
  try { if ((globalThis as any)[name]) return (globalThis as any)[name] } catch (e) {}
  if (typeof (globalThis as any).PASSWORD !== 'undefined' && name === 'PASSWORD') return (globalThis as any).PASSWORD
  if (typeof (globalThis as any).BASE_SECRET !== 'undefined' && name === 'BASE_SECRET') return (globalThis as any).BASE_SECRET
  return undefined
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method

  if (url.pathname === '/__pw_gate_health') return new Response('ok', { status: 200 })
  if (url.pathname === '/__pw_gate_login' && method === 'POST') {
    const form = await request.formData()
    const pw = (form.get('password') || '') as string
    const expected = getSecret('PASSWORD')
    if (!expected) return new Response('Server not configured', { status: 500 })
    if (pw === expected) {
      const baseSecret = getSecret('BASE_SECRET')
      if (!baseSecret) return new Response('Server not configured', { status: 500 })
      const { cookieVal } = await generateTokenAndCookie(baseSecret)
      const headers = new Headers({ 'Location': url.origin, 'Set-Cookie': `${COOKIE_NAME}=${cookieVal}; HttpOnly; Secure; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax` })
      return new Response(null, { status: 303, headers })
    } else {
      return new Response(makeDenyPage(), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
  }

  const cookieHeader = request.headers.get('Cookie')
  const cookies = parseCookies(cookieHeader)
  const cookie = cookies[COOKIE_NAME]
  const baseSecret = getSecret('BASE_SECRET')
  if (!baseSecret) return new Response('Server not configured', { status: 500 })

  if (cookie) {
    const res = await validateCookie(cookie, baseSecret)
    if (res.status === 'today') {
      return await proxyToOrigin(request)
    }
    if (res.status === 'yesterday' && res.newCookie) {
      const resp = await proxyToOrigin(request)
      const headers = new Headers(resp.headers)
      headers.set('Set-Cookie', `${COOKIE_NAME}=${res.newCookie}; HttpOnly; Secure; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`)
      return new Response(resp.body, { status: resp.status, headers })
    }
  }

  if (method === 'GET') {
    return new Response(makeLoginForm('Please enter the password to continue.'), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return new Response('Unauthorized', { status: 401 })
}

async function proxyToOrigin(request: Request): Promise<Response> {
  const reqHeaders = new Headers(request.headers)
  reqHeaders.delete('Cookie')
  const proxied = new Request(request.url, {
    method: request.method,
    headers: reqHeaders,
    body: request.body,
    redirect: 'manual'
  })
  return fetch(proxied)
}

async function getStoredPassword(): Promise<string | null> {
  // removed: durable object storage no longer used
  return null
}
 
