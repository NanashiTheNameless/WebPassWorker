# WebPassWorker

Password-gating middleware. Supports two deployment models from the same codebase:

1. **Cloudflare Workers** — Serverless edge deployment
2. **Docker Compose** — Self-hosted with Redis + nginx

Both models issue daily-rotating cookies, enforce server-side per-IP rate limits (10 attempts / 12 min), and transparently proxy authenticated requests to your origin.

## Deployment Options

### Option 1: Cloudflare Workers

**Entry point:** `index.ts`
**Dependencies:** Cloudflare Workers runtime
**Storage:** Cloudflare KV

Local development

1. Install Wrangler if you don't have it:

```bash
yarn install
```

2. Authenticate locally (interactive):

```bash
yarn wrangler login
```

3. Set required secrets (preferred):

```bash
yarn wrangler secret put PASSWORD
yarn wrangler secret put BASE_SECRET
```

4. Create a KV namespace for rate limiting and update `wrangler.toml` with the returned ID:

```bash
yarn wrangler kv namespace create RATE_LIMIT_KV
```

5. Run locally:

```bash
yarn dev:worker
```

6. Deploy to Cloudflare:

```bash
yarn build:worker
```

Rate-limiting details

- Password form submissions must pass the per-IP token bucket: 10 tokens, refilling 1 token every 12 minutes.
- Valid cookie requests do not consume tokens; only password entries do.
- Buckets are stored in the `RATE_LIMIT_KV` Workers KV binding, so clearing cookies or editing client state does not reset the server-side counters for password entry.
- Each KV record is stored as key `<bucket-hmac>` with value `<last-edit-ms>-<token-count>`.
- Full buckets are deleted instead of stored. A scheduled cleanup runs hourly and removes buckets that have refilled to 10 tokens, plus malformed bucket records.
- KV is eventually consistent, so this is a free-tier-friendly approximate limiter rather than a strict concurrent limiter.
- If the KV binding is missing, authenticated traffic fails closed with HTTP 500 instead of bypassing the limiter.
- IP identity uses Cloudflare's `CF-Connecting-IP` header. Raw IPs are never stored; bucket keys are keyed HMACs derived with `BASE_SECRET`. Local development without that header shares the hashed `unknown` IP bucket.

### Option 2: Docker Compose (Self-Hosted)

**Entry point:** `src/server.ts` (inside Docker)
**Docker services:** nginx + app + redis
**Storage:** Redis

Complete password gate middleware running in Docker. Validates passwords, issues cookies, rate-limits attempts, and proxies authenticated requests to your real application.

Quick start:

```bash
# 1. Set configuration
cp .env.example .env
# Edit: PASSWORD, BASE_SECRET, ORIGIN_URL (your real app)

# 2. Build and run
docker compose up -d

# 3. Access
# http://localhost → gate → your app at ORIGIN_URL
```

Flow: `http://localhost` → auth check → issues cookie → proxies to `ORIGIN_URL`

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for HTTPS, multiple origins, and troubleshooting.

Publish to workers.dev

```bash
# set environment variables for CI/local usage (prefer CLOUDFLARE_* names)
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
yarn wrangler publish
```

CI notes

- Do NOT commit API tokens to source control. Store `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PASSWORD`, and `BASE_SECRET` as secrets in your CI provider and reference them in the workflow.

Remove the gate

- To stop the Worker from intercepting traffic, remove the Worker route in the Cloudflare dashboard or via the API (delete the zone route). Deleting the route immediately stops edge interception and requests will go to your origin.

Where to look

- Entrypoint: `index.ts`
- Templates: `lib/templates.ts` (login/deny pages)
- Auth utilities: `lib/auth.ts`
- KV rate limiter: `enforceRateLimit` in `index.ts`

If you want a CI workflow or helper scripts added, tell me which CI (GitHub/GitLab) and I'll add a ready-to-commit workflow.
