# MuscleOS — Production Deployment Guide

## 1. Prerequisites

- A host or cluster capable of running Docker Compose (single VM) or Kubernetes (scale-out).
- Managed PostgreSQL 16+ (or self-hosted with backups configured — see `scripts/backup.sh`).
- Managed Redis 7+ (session store, cache, rate-limit counters).
- A domain with TLS (Let's Encrypt via the bundled Nginx config, or a managed load balancer).
- SMTP credentials (transactional email), Twilio credentials (SMS), Razorpay/Stripe live keys.

## 2. Environment configuration

Copy `.env.example` to `.env` and fill in every value. Do **not** reuse the example
secrets — generate fresh ones:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 32   # COOKIE_SECRET
```

Required for production specifically:
- `NODE_ENV=production`
- `DATABASE_URL` — pointed at your managed Postgres instance, `sslmode=require`
- `SENTRY_DSN` — leave empty to disable error tracking, but production should set this
- `RAZORPAY_*` / `STRIPE_*` — live keys, and configure webhook URLs in each dashboard to
  `https://api.yourdomain.com/api/v1/payments/webhook/razorpay` and `/stripe`

## 3. Database migration

```bash
cd backend
npm ci
npm run db:generate
npm run db:migrate:prod
npm run db:seed     # loads default GymPlans + notification templates
```

## 4. Build & run with Docker Compose

```bash
docker compose -f docker-compose.yml up -d --build
```

This brings up: `postgres`, `redis`, `backend` (NestJS on :3000), `frontend` (static build
served via `nginx`), and the reverse proxy defined in `infra/nginx/nginx.conf`.

Confirm health:

```bash
curl https://api.yourdomain.com/health        # DB + Redis + memory checks
curl https://api.yourdomain.com/health/live    # lightweight liveness probe
```

## 5. CI/CD

`.github/workflows/ci.yml` runs lint, type-check, tests, and a Docker build on every push/PR
to `main`/`develop`. Wire your deploy step (SSH + `docker compose pull && up -d`, or a
Kubernetes rollout) after the `docker` job — intentionally left to your infra choice since
that varies by host provider.

`.github/workflows/backup.yml` runs a nightly `pg_dump` via `scripts/backup.sh` and (if
`BACKUP_S3_BUCKET` secret is set) uploads it to S3-compatible storage, with automatic
pruning after `BACKUP_RETENTION_DAYS`. Configure these GitHub Actions secrets:
`DATABASE_URL`, `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_DEFAULT_REGION`.

## 6. Monitoring & error tracking

- `/health` is wired to `@nestjs/terminus` and checks Postgres connectivity, Redis
  connectivity, and process memory thresholds — point your uptime monitor (UptimeRobot,
  Better Uptime, a Kubernetes readinessProbe, etc.) at it.
- Setting `SENTRY_DSN` turns on automatic capture of every unhandled 5xx exception,
  tagged with the request ID from `AllExceptionsFilter`, so you can correlate a Sentry
  event with the matching structured log line.
- Application logs are written via Winston with daily rotation
  (`winston-daily-rotate-file`) — ship the log directory to your aggregator of choice
  (Loki, CloudWatch, Datadog) rather than relying on local disk retention alone.

## 7. Security checklist before go-live

- [ ] Rotate every secret in `.env` away from the example values
- [ ] Confirm `helmet()` CSP directives in `backend/src/main.ts` match your actual frontend
      origins if you add third-party scripts
- [ ] Confirm CORS `origin` in `main.ts` is your real production frontend URL, not `*`
- [ ] Enable `sslmode=require` (or stricter) on `DATABASE_URL`
- [ ] Confirm rate-limit thresholds in `ThrottlerModule.forRoot(...)` fit your expected
      traffic (defaults are conservative for a multi-tenant SaaS)
- [ ] Restrict the Postgres/Redis security groups to only the backend's network
- [ ] Set up the nightly backup workflow's secrets and do one manual restore-drill with
      `scripts/restore.sh` against a staging database before you need it for real

## 8. Scaling notes

- The backend is stateless (sessions live in Redis, not memory) — safe to run multiple
  replicas behind a load balancer.
- `ResponseCacheInterceptor` (see `common/interceptors/cache.interceptor.ts`) uses Redis,
  so cache hits are shared across replicas.
- `@nestjs/schedule` cron jobs (membership expiry reminders, birthday wishes, auto-expiry)
  are **not** distributed-lock protected — if you run more than one backend replica, either
  run those jobs from a single designated "worker" replica (env flag) or move them to a
  proper job queue (BullMQ) to avoid duplicate notification sends.
