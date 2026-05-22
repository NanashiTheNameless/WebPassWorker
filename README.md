# WebPassWorker — Password-gate Cloudflare Worker

Simple Cloudflare Worker that gates a site with a password and issues a daily-rotating cookie.

Quick start

Requirements

- Node.js + yarn
- `wrangler` (Cloudflare Workers CLI)

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

4. Run locally:

```bash
yarn wrangler dev
```

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

If you want a CI workflow or helper scripts added, tell me which CI (GitHub/GitLab) and I'll add a ready-to-commit workflow.
