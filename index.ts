import { parseCookies, hmacSha256 } from './lib/utils'
import { COOKIE_NAME, COOKIE_MAX_AGE, generateTokenAndCookie, validateCookie } from './lib/auth'
import { makeLoginForm, makeDenyPage, makeRateLimitedPage } from './lib/templates'
import { isWebSocketUpgrade } from './lib/websocket'

const RATE_LIMIT_CAPACITY = 10
const RATE_LIMIT_REFILL_MS = 12 * 60 * 1000
const RATE_LIMIT_STORAGE_TTL_SECONDS = Math.ceil((RATE_LIMIT_CAPACITY * RATE_LIMIT_REFILL_MS) / 1000) + 60 * 60
const RATE_LIMIT_CLEANUP_BATCH_SIZE = 1000

type Env = {
  PASSWORD?: string
  BASE_SECRET?: string
  RATE_LIMIT_KV?: any
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },

  async scheduled(_controller: any, env: Env, ctx: any): Promise<void> {
    ctx.waitUntil(cleanRateLimitKV(env))
  }
}

type BucketState = {
  tokens: number
  updatedAt: number
}

type BucketResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  scope?: string
}

function getSecret(name: string, env: Env): string | undefined {
  if (name === 'PASSWORD' && env.PASSWORD) return env.PASSWORD
  if (name === 'BASE_SECRET' && env.BASE_SECRET) return env.BASE_SECRET
  try { if ((globalThis as any)[name]) return (globalThis as any)[name] } catch (e) {}
  if (typeof (globalThis as any).PASSWORD !== 'undefined' && name === 'PASSWORD') return (globalThis as any).PASSWORD
  if (typeof (globalThis as any).BASE_SECRET !== 'undefined' && name === 'BASE_SECRET') return (globalThis as any).BASE_SECRET
  return undefined
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method

  if (url.pathname === '/__pw_gate_health') return new Response('ok', { status: 200 })
  if (url.pathname === '/__pw_gate_login' && method === 'POST') {
    const expected = getSecret('PASSWORD', env)
    if (!expected) return new Response('Server not configured', { status: 500 })
    const baseSecret = getSecret('BASE_SECRET', env)
    if (!baseSecret) return new Response('Server not configured', { status: 500 })
    const rateLimit = await enforceRateLimit(request, baseSecret, env)
    if (rateLimit) return rateLimit
    const form = await request.formData()
    const pw = (form.get('password') || '') as string
    if (pw === expected) {
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
  const baseSecret = getSecret('BASE_SECRET', env)
  if (!baseSecret) return new Response('Server not configured', { status: 500 })

  if (cookie) {
    const res = await validateCookie(cookie, baseSecret)
    if (res.status === 'today') {
      return await passToOrigin(request)
    }
    if (res.status === 'yesterday' && res.newCookie) {
      const resp = await passToOrigin(request)
      if (!isWebSocketUpgrade(request)) {
        const headers = new Headers(resp.headers)
        headers.set('Set-Cookie', `${COOKIE_NAME}=${res.newCookie}; HttpOnly; Secure; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`)
        return new Response(resp.body, { status: resp.status, headers })
      }
      return resp
    }
  }

  if (method === 'GET') {
    return new Response(makeLoginForm('Please enter the password to continue.'), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return new Response('Unauthorized', { status: 401 })
}

async function enforceRateLimit(request: Request, baseSecret: string, env: Env): Promise<Response | null> {
  const kv = getRateLimitKV(env)
  if (!kv) return new Response('Server rate limiter not configured', { status: 500 })

  const ipKey = await makeRateLimitKey(baseSecret, 'ip', getClientIp(request))
  const result = await consumeRateLimitToken(kv, ipKey)

  return result.allowed ? null : makeRateLimitResponse(result)
}

function getRateLimitKV(env: Env): any | undefined {
  if (env.RATE_LIMIT_KV) return env.RATE_LIMIT_KV
  try {
    return (globalThis as any).RATE_LIMIT_KV
  } catch (e) {
    return undefined
  }
}

async function makeRateLimitKey(baseSecret: string, scope: string, value: string): Promise<string> {
  return `${scope}:${await hmacSha256(`${baseSecret}:rate-limit`, value)}`
}

function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown'
}

async function consumeRateLimitToken(kv: any, ipKey: string): Promise<BucketResult> {
  const now = Date.now()
  const ipBucket = await readRateLimitBucket(kv, ipKey, now)

  if (ipBucket.tokens < 1) {
    await writeRateLimitBucket(kv, ipKey, ipBucket)
    return makeBucketResult(false, ipBucket, 'ip')
  }

  ipBucket.tokens -= 1
  await writeRateLimitBucket(kv, ipKey, ipBucket)

  return {
    allowed: true,
    remaining: Math.floor(ipBucket.tokens),
    retryAfterSeconds: 0
  }
}

async function readRateLimitBucket(kv: any, key: string, now: number): Promise<BucketState> {
  const storedText = await kv.get(key)
  if (!storedText) return { tokens: RATE_LIMIT_CAPACITY, updatedAt: now }

  const stored = parseBucketValue(storedText)
  if (!stored) return { tokens: RATE_LIMIT_CAPACITY, updatedAt: now }

  return refillBucket(stored, now)
}

function refillBucket(bucket: BucketState, now: number): BucketState {
  const elapsed = Math.max(0, now - bucket.updatedAt)
  const refilledTokens = elapsed / RATE_LIMIT_REFILL_MS
  return {
    tokens: Math.min(RATE_LIMIT_CAPACITY, Math.max(0, bucket.tokens) + refilledTokens),
    updatedAt: now
  }
}

async function writeRateLimitBucket(kv: any, key: string, bucket: BucketState): Promise<void> {
  if (bucket.tokens >= RATE_LIMIT_CAPACITY) {
    await kv.delete(key)
    return
  }
  await kv.put(key, formatBucketValue(bucket), { expirationTtl: RATE_LIMIT_STORAGE_TTL_SECONDS })
}

async function cleanRateLimitKV(env: Env): Promise<void> {
  const kv = getRateLimitKV(env)
  if (!kv) return

  const now = Date.now()
  let cursor: string | undefined
  let listComplete = false
  do {
    const page = await kv.list({ prefix: 'ip:', limit: RATE_LIMIT_CLEANUP_BATCH_SIZE, cursor })
    await Promise.all(page.keys.map(async (entry: { name: string }) => {
      const value = await kv.get(entry.name)
      if (!value) return

      const bucket = parseBucketValue(value)
      if (!bucket) {
        await kv.delete(entry.name)
        return
      }

      const refilled = refillBucket(bucket, now)
      if (refilled.tokens >= RATE_LIMIT_CAPACITY) await kv.delete(entry.name)
    }))
    cursor = page.cursor
    listComplete = page.list_complete
  } while (!listComplete)
}

function parseBucketValue(value: string): BucketState | null {
  const separatorIndex = value.lastIndexOf('-')
  if (separatorIndex === -1) return null

  const updatedAt = Number(value.slice(0, separatorIndex))
  const tokens = Number(value.slice(separatorIndex + 1))
  if (!isFinite(updatedAt) || !isFinite(tokens)) return null

  return { updatedAt, tokens }
}

function formatBucketValue(bucket: BucketState): string {
  return `${Math.floor(bucket.updatedAt)}-${bucket.tokens}`
}

function makeBucketResult(allowed: boolean, bucket: BucketState, scope: string): BucketResult {
  return {
    allowed,
    remaining: Math.max(0, Math.floor(bucket.tokens)),
    retryAfterSeconds: bucket.tokens >= 1 ? 0 : Math.ceil((1 - bucket.tokens) * RATE_LIMIT_REFILL_MS / 1000),
    scope
  }
}

function makeRateLimitResponse(result: BucketResult): Response {
  const retryAfterSeconds = Math.max(1, result.retryAfterSeconds)
  return new Response(makeRateLimitedPage(retryAfterSeconds), {
    status: 429,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(retryAfterSeconds),
      'RateLimit-Limit': String(RATE_LIMIT_CAPACITY),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(retryAfterSeconds)
    }
  })
}

async function passToOrigin(request: Request): Promise<Response> {
  return fetch(request, { redirect: 'manual' })
}
