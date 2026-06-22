# WebPassWorker Docker Compose Setup

Docker Compose runs the complete **password gate + authentication middleware** that sits in front of your real application.

## Architecture

```
Incoming request
       │
       ▼
┌───────────────────────────────┐
│ Docker Container              │
│  ┌──────────────────────┐     │
│  │ nginx (port 80/443)  │     │
│  └──────────┬───────────┘     │
│             │                 │
│  ┌──────────▼─────────────┐   │
│  │ app (port 3000)        │   │
│  │ • Validates password   │   │
│  │ • Issues cookies       │   │
│  │ • Rate-limits (10/12m) |   │
│  └──────────┬─────────────┘   │
│             │                 │
│  ┌──────────▼───────────┐     │
│  │ redis (port 6379)    │     │
│  │ (rate-limit storage) │     │
│  └──────────────────────┘     │
└───────────────────────────────┘
             │ (after auth)
             ▼
     ORIGIN_URL
  (your real app)
```

## Requirements

- **Docker Engine** 25.0+
- **Docker Compose** 5.1.4+ (for Compose file format 3.13 support and `host-gateway` networking)

Verify:
```bash
docker --version
docker compose version
```

## Quick Start

1. **Set environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with PASSWORD, BASE_SECRET, and ORIGIN_URL
   ```

2. **Build and run:**
   ```bash
   docker compose up -d
   ```

3. **Access:**
   - Login gate: `http://localhost`
   - After password: auto-proxied to `ORIGIN_URL`

## Configuration

### Environment Variables (`.env`)
- `PASSWORD` — The login password (required)
- `BASE_SECRET` — Secret for signing cookies (required)
- `REDIS_PASSWORD` — Redis password (change in production!)
- `ORIGIN_URL` — Your real application URL (default: `http://host.docker.internal:3001`)

### HTTPS Setup

Uncomment the HTTPS section in `nginx.conf` and provide SSL certificates in `./ssl/`:
- `./ssl/cert.pem` — Server certificate
- `./ssl/key.pem` — Private key

Then run:
```bash
docker compose up -d
```

## Services

- **app** — Node.js password gate + auth proxy (port 3000 internal)
- **redis** — Rate-limit token storage
- **nginx** — Reverse proxy & SSL termination (ports 80/443)

## Commands

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View nginx logs
docker compose logs -f nginx

# View app logs (password attempts, auth events)
docker compose logs -f app

# View redis logs
docker compose logs -f redis

# Rebuild Docker images
docker compose up -d --build

# Clean (removes volumes and stops containers)
docker compose down -v
```

## Rate Limiting

Configured per IP:
- **10 password attempts** per ~12 minutes
- Valid cookies don't consume attempts (only failed/new attempts do)
- Automatic cleanup runs hourly
- Fails closed: if Redis unavailable, requests are denied

## Security

- **Redis**: Protected with password (set via `REDIS_PASSWORD`). Only accessible to the app container.
- **Credentials**: `PASSWORD` and `BASE_SECRET` are required. Change from defaults in production.
- **Password field**: Limited to 1000 characters to prevent DoS.
- **Rate limiting**: Fails closed — if Redis unavailable, requests are blocked rather than bypassed.
- **HTTPS**: For production, enable SSL/TLS by uncommenting the HTTPS section in `nginx.conf`.
- **Cloudflare**: If behind Cloudflare, the app respects `CF-Connecting-IP` headers for accurate IP-based rate limiting.

## Cookies

- **Name**: `pw_gate`
- **Duration**: 2 days
- **Rotation**: Daily (valid for current day + previous day for seamless rollovers)
- **Flags**: HttpOnly, Secure, SameSite=Lax

## WebSocket Support

WebSocket connections are proxied transparently through nginx.
