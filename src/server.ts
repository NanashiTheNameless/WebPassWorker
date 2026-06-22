import express, { Request, Response, NextFunction } from 'express'
import * as http from 'http'
import httpProxy from 'http-proxy'
import { createClient } from 'redis'
import cron from 'node-cron'
import { parseCookies, hmacSha256 } from '../lib/utils.js'
import { COOKIE_NAME, COOKIE_MAX_AGE, generateTokenAndCookie, validateCookie } from '../lib/auth.js'
import { makeLoginForm, makeDenyPage, makeRateLimitedPage } from '../lib/templates.js'

const RATE_LIMIT_CAPACITY = 10
const RATE_LIMIT_REFILL_MS = 12 * 60 * 1000
const RATE_LIMIT_STORAGE_TTL_SECONDS = Math.ceil((RATE_LIMIT_CAPACITY * RATE_LIMIT_REFILL_MS) / 1000) + 60 * 60

interface BucketState {
  tokens: number
  updatedAt: number
}

interface BucketResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  scope?: string
}

interface Env {
  PASSWORD: string | undefined
  BASE_SECRET: string | undefined
  REDIS_URL: string | undefined
  ORIGIN_URL: string | undefined
  PORT: string | undefined
}

const env: Env = {
  PASSWORD: process.env.PASSWORD,
  BASE_SECRET: process.env.BASE_SECRET,
  REDIS_URL: process.env.REDIS_URL || 'redis://redis:6379',
  ORIGIN_URL: process.env.ORIGIN_URL || 'http://host.docker.internal:30000',
  PORT: process.env.PORT || '3000'
}

const app = express()
let redisClient: ReturnType<typeof createClient> | null = null

// Middleware
app.use(express.urlencoded({ extended: false }))
app.use(express.json())

// Trust proxy for X-Forwarded-For
app.set('trust proxy', 1)

// Initialize Redis
async function initRedis() {
  try {
    redisClient = createClient({ url: env.REDIS_URL })
    redisClient.on('error', (err) => console.error('Redis Client Error', err))
    await redisClient.connect()
    console.log('Redis connected')
  } catch (err) {
    console.error('Failed to connect to Redis:', err)
    process.exit(1)
  }
}

// Health check
app.get('/__pw_gate_health', (req: Request, res: Response) => {
  res.status(200).send('ok')
})

// Login handler
app.post('/__pw_gate_login', async (req: Request, res: Response) => {
  const expected = env.PASSWORD
  if (!expected) {
    return res.status(500).send('Server not configured')
  }

  const baseSecret = env.BASE_SECRET
  if (!baseSecret) {
    return res.status(500).send('Server not configured')
  }

  const rateLimitResp = await enforceRateLimit(req, baseSecret)
  if (rateLimitResp) {
    return res
      .status(429)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Retry-After', String(rateLimitResp.retryAfterSeconds))
      .send(makeRateLimitedPage(rateLimitResp.retryAfterSeconds))
  }

  const pw = (req.body.password || '').toString().slice(0, 1000) // Limit password length
  if (pw === expected) {
    const { cookieVal } = await generateTokenAndCookie(baseSecret)
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${cookieVal}; HttpOnly; Secure; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`)
    return res.redirect(302, '/')
  } else {
    return res
      .status(403)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(makeDenyPage())
  }
})

// Authentication middleware
app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Skip auth for health checks
  if (req.path === '/__pw_gate_health') {
    return next()
  }

  const cookieHeader = req.get('Cookie')
  const cookies = parseCookies(cookieHeader)
  const cookie = cookies[COOKIE_NAME]
  const baseSecretRaw = env.BASE_SECRET

  if (!baseSecretRaw) {
    return res.status(500).send('Server not configured')
  }

  const baseSecret: string = baseSecretRaw

  if (cookie) {
    const result = await validateCookie(cookie, baseSecret)
    if (result.status === 'today') {
      return next()
    }
    if (result.status === 'yesterday' && result.newCookie) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${result.newCookie}; HttpOnly; Secure; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`)
      return next()
    }
  }

  // GET requests show login form
  if (req.method === 'GET') {
    return res
      .status(200)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(makeLoginForm('Please enter the password to continue.'))
  }

  return res.status(401).send('Unauthorized')
})

// Proxy to origin after auth
if (env.ORIGIN_URL) {
  const proxy = httpProxy.createProxyServer({
    target: env.ORIGIN_URL,
    changeOrigin: true,
    ws: true
  })

  proxy.on('error', (err: Error, req: any, res: any) => {
    console.error('Proxy error:', err)
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Bad Gateway')
  })

  app.use((req: Request, res: Response) => {
    proxy.web(req, res, { target: env.ORIGIN_URL })
  })
}

// Rate limiting
async function enforceRateLimit(req: Request, baseSecret: string): Promise<BucketResult | null> {
  if (!redisClient) {
    console.error('Rate limiter not available')
    // Fail closed: deny requests if Redis is down
    return { allowed: false, remaining: 0, retryAfterSeconds: 60, scope: 'system' }
  }

  const clientIp = getClientIp(req)
  const ipKey = await makeRateLimitKey(baseSecret, 'ip', clientIp)
  const result = await consumeRateLimitToken(ipKey)

  return result.allowed ? null : result
}

function getClientIp(req: Request): string {
  // Prioritize Cloudflare header (when behind Cloudflare proxy)
  const cfIp = req.get('CF-Connecting-IP')
  if (cfIp) return cfIp

  // Fall back to Express's req.ip (respects X-Forwarded-For when trust proxy is set)
  return req.ip || 'unknown'
}

async function makeRateLimitKey(baseSecret: string, scope: string, value: string): Promise<string> {
  return `${scope}:${await hmacSha256(`${baseSecret}:rate-limit`, value)}`
}

async function consumeRateLimitToken(ipKey: string): Promise<BucketResult> {
  const now = Date.now()
  const ipBucket = await readRateLimitBucket(ipKey, now)

  if (ipBucket.tokens < 1) {
    await writeRateLimitBucket(ipKey, ipBucket)
    return makeBucketResult(false, ipBucket, 'ip')
  }

  ipBucket.tokens -= 1
  await writeRateLimitBucket(ipKey, ipBucket)

  return {
    allowed: true,
    remaining: Math.floor(ipBucket.tokens),
    retryAfterSeconds: 0
  }
}

async function readRateLimitBucket(key: string, now: number): Promise<BucketState> {
  if (!redisClient) return { tokens: RATE_LIMIT_CAPACITY, updatedAt: now }

  const storedText = await redisClient.get(key)
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

async function writeRateLimitBucket(key: string, bucket: BucketState): Promise<void> {
  if (!redisClient) return

  if (bucket.tokens >= RATE_LIMIT_CAPACITY) {
    await redisClient.del(key)
    return
  }
  await redisClient.setEx(key, RATE_LIMIT_STORAGE_TTL_SECONDS, formatBucketValue(bucket))
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

// Cleanup cron job (runs every hour)
cron.schedule('0 * * * *', async () => {
  if (!redisClient) return
  console.log('Running rate limit cleanup...')
  try {
    const keys = await redisClient.keys('ip:*')
    if (keys.length === 0) return

    const now = Date.now()
    for (const key of keys) {
      const value = await redisClient.get(key)
      if (!value) continue

      const bucket = parseBucketValue(value)
      if (!bucket) {
        await redisClient.del(key)
        continue
      }

      const refilled = refillBucket(bucket, now)
      if (refilled.tokens >= RATE_LIMIT_CAPACITY) {
        await redisClient.del(key)
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err)
  }
})

// Start server
async function start() {
  await initRedis()

  const port = Number(env.PORT) || 3000
  const baseSecret = env.BASE_SECRET
  if (!baseSecret) {
    throw new Error('BASE_SECRET environment variable is required')
  }
  
  const server = http.createServer(app)
  
  // Handle WebSocket upgrades
  if (env.ORIGIN_URL) {
    const proxy = httpProxy.createProxyServer({
      target: env.ORIGIN_URL,
      ws: true,
      changeOrigin: true
    })

    proxy.on('error', (err: Error) => {
      console.error('WebSocket proxy error:', err)
    })

    server.on('upgrade', (req: any, socket: any, head: Buffer) => {
      // Check authentication before allowing upgrade
      const cookieHeader = req.headers.cookie
      const cookies = parseCookies(cookieHeader || null)
      const cookie = cookies[COOKIE_NAME]
      
      if (!cookie || !validateCookie(cookie, baseSecret)) {
        socket.writeHead(401, { 'Content-Type': 'text/plain' })
        socket.end('Unauthorized')
        return
      }

      proxy.ws(req, socket, head)
    })
  }
  
  server.listen(port, '0.0.0.0', () => {
    console.log(`WebPassWorker listening on port ${port}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
