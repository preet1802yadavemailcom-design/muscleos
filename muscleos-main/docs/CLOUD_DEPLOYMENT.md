# MuscleOS — Neon / Azure / Cloudflare Deployment

This maps the generic steps in `DEPLOYMENT.md` onto the three specific
platforms this project targets: **Neon** (Postgres), **Azure** (Dockerized
backend), **Cloudflare** (frontend). Read `DEPLOYMENT.md` first for the
security checklist and CI/CD pipeline — this doc only covers the
platform-specific parts.

## 1. Database — Neon PostgreSQL

1. Create a Neon project → note the pooled connection string (Neon gives you
   two: a direct one and a pgBouncer-pooled one — **use the pooled one** for
   `DATABASE_URL` since the backend runs multiple replicas/instances).
2. Neon requires TLS by default — the connection string already includes
   `sslmode=require`; don't strip it.
3. Run migrations from a machine with normal network access (this repo's
   sandbox blocks `binaries.prisma.sh`, so `prisma generate`/`migrate deploy`
   must run from CI or your own machine, not from here):
   ```bash
   cd backend
   npm ci
   npx prisma generate
   npx prisma migrate deploy
   npm run db:seed   # default GymPlans + notification templates
   ```
4. Neon's branching feature is genuinely useful here: create a branch per PR
   for integration tests against a real (throwaway) Postgres instance instead
   of mocking the DB in CI.
5. Backups: Neon retains point-in-time recovery on paid tiers — configure the
   retention window in the Neon console; you don't need `scripts/backup.sh`'s
   `pg_dump` cron for the primary DB on Neon (keep it only if you want an
   independent off-Neon copy).

## 2. Backend — Azure (Dockerized)

Two reasonable options; **Container Apps** is simpler for this app's shape
(stateless, HTTP-only, no persistent local disk needed since sessions/cache
are in Redis).

### Azure Container Apps (recommended)
```bash
az group create --name muscleos-rg --location centralindia
az acr create --resource-group muscleos-rg --name muscleosacr --sku Basic

# Build & push the existing backend/Dockerfile
az acr build --registry muscleosacr --image muscleos-backend:latest ./backend

az containerapp env create --name muscleos-env --resource-group muscleos-rg --location centralindia

az containerapp create \
  --name muscleos-backend \
  --resource-group muscleos-rg \
  --environment muscleos-env \
  --image muscleosacr.azurecr.io/muscleos-backend:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 --max-replicas 5 \
  --env-vars DATABASE_URL=secretref:database-url REDIS_URL=secretref:redis-url \
             JWT_SECRET=secretref:jwt-secret JWT_REFRESH_SECRET=secretref:jwt-refresh-secret \
             RAZORPAY_KEY_ID=secretref:razorpay-key-id RAZORPAY_KEY_SECRET=secretref:razorpay-key-secret \
             RAZORPAY_WEBHOOK_SECRET=secretref:razorpay-webhook-secret \
             CORS_ORIGINS=https://app.muscleos.com NODE_ENV=production
```
Register each `secretref:` value first with `az containerapp secret set`. Never
pass real secrets as plain `--env-vars` — Container Apps stores `secretref:`
values encrypted separately from the revision spec.

Point Container Apps' built-in health probe at the existing `/health/live`
(liveness — no dependency checks, fast) and `/health` (readiness — checks
Neon + Redis). Container Apps auto-restarts on failed liveness probes and
stops routing traffic on failed readiness probes — exactly the split those
two endpoints were built for.

### Redis on Azure
Use **Azure Cache for Redis** (Basic tier is enough at ~2,000 members) rather
than self-hosting — `REDIS_URL` from its access keys page drops straight into
the same env var the backend already expects.

### Rollback
Container Apps keeps prior revisions. `az containerapp revision list` then
`az containerapp ingress traffic set --revision-weight <old-revision>=100` is
an instant rollback with zero rebuild — cheaper than redeploying a prior
image tag.

## 3. Frontend — Cloudflare Pages

```bash
cd frontend
npm ci
npm run build   # outputs dist/, includes the PWA manifest + service worker
```

Connect the repo in the Cloudflare Pages dashboard (or `wrangler pages deploy
dist --project-name=muscleos`), with:
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_API_URL=https://api.muscleos.com` (or wherever
  the Azure Container App's ingress hostname/custom domain resolves)

Cloudflare Pages serves the PWA's `manifest.webmanifest` and service worker
with the correct headers by default — no extra `_headers` file needed for
those specifically, but if you add one for other reasons, don't override
`Cache-Control` on `/sw.js` to anything longer than a few minutes, or update
prompts (`PwaUpdatePrompt.tsx`) will take a long time to reach installed
users after a deploy.

## 4. Wiring it together

```
Cloudflare Pages (frontend)
        │  VITE_API_URL
        ▼
Azure Container Apps (backend, Docker)
        │                     │
        ▼                     ▼
   Neon Postgres      Azure Cache for Redis
```

CORS: set `CORS_ORIGINS` on the backend to the exact Cloudflare Pages URL
(and any custom domain) — never `*` in production; `main.ts` already reads
this from env rather than hardcoding it.

## 5. Health checks & logs (recap, Azure-specific)

- Liveness: `GET /health/live` — wire to Container Apps' liveness probe.
- Readiness: `GET /health` — wire to Container Apps' readiness probe; this one
  checks Neon + Redis connectivity, so a DB blip correctly takes the replica
  out of rotation instead of serving 500s.
- Logs: Container Apps captures stdout/stderr automatically into Log
  Analytics — the backend's Winston logger already writes structured JSON to
  stdout in production (`NODE_ENV=production`), so no extra shipping config
  is needed; query it with Log Analytics / KQL rather than relying on local
  file rotation (which still runs, but Container Apps' filesystem is
  ephemeral — treat `winston-daily-rotate-file` output as a local debugging
  aid only in this deployment, not the durable log store).

## 6. What's NOT covered here

- WAF/DDoS rules on Cloudflare — defaults are reasonable for launch, but this
  doc doesn't prescribe a specific ruleset.
- Multi-region Azure deployment — single-region is fine at the ~20 gym /
  ~2,000 member target this project was scoped for; revisit if that changes.
