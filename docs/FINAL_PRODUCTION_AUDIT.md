# MuscleOS — Final Production Audit Report

Generated: 2026-08-12, from an AI-assisted hardening pass run in a sandboxed
environment with a confirmed, documented network restriction (see §17,
Environment Blockers). Status markers used throughout:

- ✅ VERIFIED — an actual command/test ran in this session and passed.
- 🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED — code exists and was
  reviewed, but no command in this session could execute it end-to-end.
- 🔴 NOT IMPLEMENTED — does not exist in the codebase.
- ❌ FAILED — a command ran and failed; root cause and fix status noted.

**Overall: NOT 100% VERIFIED.** Frontend build tooling is genuinely verified
in this session. Backend verification is blocked by one confirmed
environment limitation (§17) that no amount of code changes can fix from
inside this sandbox — it requires running the same commands from a machine
with normal network access.

---

## 1. Feature Status

All features listed in the freeze scope are present in the codebase:
multi-tenant orgs/branches, Super Admin + 2FA, RBAC, permanent QR
(generate/regenerate/revoke), check-in/out, manual attendance, geofence,
memberships, expiry reminders, member self-payment + Razorpay, webhook
idempotency, refund guard, owner dashboard, staff management, Member PWA,
reports (CSV/PDF triggers), support tickets, Redis pub/sub + SSE real-time,
Docker, and the Neon/Azure/Cloudflare deployment docs. 🟡 IMPLEMENTED —
EXTERNAL VERIFICATION REQUIRED for anything that needs a running server
(everything backend-dependent).

## 2. Security Status

Confirmed vulnerabilities found AND fixed across this whole engagement
(cumulative, not just this session):

| Issue | Severity | Status |
|---|---|---|
| `x-gym-id` header trusted for tenant scoping | Critical (IDOR) | Fixed — `@GymId()` now JWT-only |
| Public `/auth/register` accepted client-supplied `role` | Critical | Fixed — forced to MEMBER; SUPER_ADMIN only via script |
| `GET /memberships`, `/memberships/:id` had no role guard | Critical (IDOR) | Fixed — staff-only + `/me` endpoint |
| `GET /payments/:id`, `/:id/receipt` had no role/ownership check | Critical (IDOR) | Fixed — staff-only + ownership check + `/me` endpoint |
| Attendance check-in race condition (two concurrent scans) | High | Fixed — DB partial unique index |
| `regenerateGymQr` didn't actually invalidate the old QR | High (non-functional control) | Fixed — replaced with DB-token system |
| Missed-checkout permanently blocked re-check-in | High (availability) | Fixed — hourly auto-close job |
| Payment webhook raw-body fallback could verify against a reconstruction | High | Fixed — fails closed |
| Member could self-pay an arbitrary amount / for another member | High | Fixed — server derives amount, ownership-checked |
| `docker-compose.yml` shipped working default DB/JWT secrets | High | Fixed this session — hard-fail syntax |
| `app.config.ts` fell back to a known JWT/cookie secret in prod | Critical | Fixed this session — throws at startup in production |
| Push notifications silently returned fake `success: true` | Medium | Fixed |

Live penetration-style testing (actually sending crafted HTTP requests
against a running instance) was **not performed**. Every fix above was
verified by code review and, where possible, by unit test — not by firing
real requests at a live server. This is the biggest gap between "the code
is correct" and "VERIFIED."

## 3. Database Status

Schema reviewed in full. Relations, indexes, and cascade rules added this
session look structurally sound by inspection.
🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED — `prisma validate` has
never successfully run against this schema in any session (see §17).

## 4. Prisma Status

❌ FAILED — `prisma validate` / `generate` / `migrate deploy` all fail with
`403 Forbidden` fetching from `binaries.prisma.sh`. This sandbox's network
allowlist does not include that domain. Retried with
`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` and `PRISMA_CLIENT_ENGINE_TYPE=
wasm` (both still fail), and via filesystem-wide search for any bundled
engine binary (none found). **ENVIRONMENT BLOCKER, not a code defect** —
see §17.

## 5. Build Status

- Backend `npm install`: ✅ VERIFIED.
- Backend `npm run build` / `tsc --noEmit`: ❌ FAILED — 145 errors: ~100
  cascade 100% from the never-generated Prisma Client, ~37 are pre-existing
  implicit-`any` warnings unrelated to this session, 3 were real
  regressions this session introduced and fixed.
- Frontend `npm install`: ✅ VERIFIED.
- Frontend `npx tsc --noEmit`: ✅ VERIFIED — 0 errors (3 real unused-import
  errors found and fixed this session).
- Frontend `npm run build` (`tsc && vite build`): 🟡 IMPLEMENTED — the
  `tsc` half is verified; the `vite build` bundling step was not run this
  session.

## 6. Test Status

❌ FAILED to execute — `npx jest` fails at the ts-jest compile step for
every suite (old and new) from the same Prisma cascade as §4/§5. 3 new
regression test files were added this session
(`memberships-idor.spec.ts`, `payments-idor.spec.ts`,
`attendance-core-race.spec.ts`) — reviewed for syntax/logic correctness,
**not confirmed green**.

Frontend `vitest`: 🔴 NOT RUN this session.

## 7. QR Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Opaque DB-backed tokens,
branch-scoped resolution, genuine revoke/regenerate — code-reviewed, not
exercised against a live server.

## 8. Attendance Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Race-condition fix has a
dedicated unit test that mocks the Postgres unique-violation — logically
sound, not run. No real concurrent-request test against live Postgres.

## 9. Payment Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Self-pay amount is
server-derived. Webhook idempotency and signature verification are
code-reviewed. No real Razorpay sandbox transaction was tested — no live
credentials exist in this environment.

## 10. Email Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Welcome, membership-
created, membership-renewed templates added and wired this session. No
actual SMTP send was tested.

## 11. PWA Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Manifest and service
worker config confirmed by reading `vite.config.ts` (`NetworkOnly` for all
`/api/*`). Never installed on a real device/browser.

## 12. Mobile Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Fixed this engagement: 6
raw `<table>` elements missing `overflow-x-auto` (5 files), 14
non-responsive form grids (6 files), and the complete absence of mobile
navigation below 1024px. Static/code-level audit only — no real device or
devtools viewport testing performed.

## 13. SSE / Real-time Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. Redis pub/sub → SSE →
`EventSource` hook. Never tested against a live Redis instance or multiple
browser tabs.

## 14. Docker Status

- `docker compose config` / `docker build`: ❌ could not attempt — `docker`
  binary is not installed in this sandbox (ENVIRONMENT BLOCKER, §17).
- `docker-compose.yml` YAML syntax: ✅ VERIFIED (Python `yaml.safe_load`).
- Fixed this session: hardcoded insecure default secrets in both
  `docker-compose.yml` and `app.config.ts` now hard-fail in production
  instead of silently running with a known, in-repo default.

## 15. Deployment Status

🟡 IMPLEMENTED — EXTERNAL VERIFICATION REQUIRED. `docs/CLOUD_DEPLOYMENT.md`
documents concrete Neon/Azure/Cloudflare steps; none executed against real
cloud accounts.

## 16. Remaining Issues

- 75 pre-existing `no-explicit-any` lint warnings (down from 87) against a
  `--max-warnings 0` script, across files this session did not author —
  deliberately not mass-edited without individual review.
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`,
  `docs/SECURITY.md`, `docs/TESTING.md`, `docs/PAYMENTS.md`,
  `docs/QR_ATTENDANCE.md`, `docs/REALTIME.md`, `docs/TROUBLESHOOTING.md` —
  not written this session.
- Frontend `vitest` suite and `vite build` not run this session.
- No live third-party credentials (Razorpay, SMTP, Twilio, FCM) configured
  anywhere.
- Member/owner-facing "create a support ticket" form not found or built
  (only the Super Admin management side exists).

## 17. Environment Blockers

1. **`binaries.prisma.sh` unreachable from this sandbox** (403 via egress
   proxy) — blocks `prisma validate`/`generate`/`migrate deploy`
   unconditionally. Every backend tsc/eslint/jest failure traces to this
   one root cause. Confirmed pre-existing (even basic enums are missing
   from the shipped client stub, before this session's changes). Fix: run
   `npx prisma generate` from a machine/CI runner with normal internet
   access — the existing `.github/workflows/ci.yml` should work correctly
   on GitHub Actions.
2. **`docker` is not installed in this sandbox** — compose/build commands
   could not be attempted at all.

## 18. Exact Commands Executed

| Command | Result |
|---|---|
| `cd backend && npm install` | PASS |
| `npx prisma validate` | FAIL — 403, binaries.prisma.sh unreachable |
| `npx prisma generate` (+ wasm/checksum-ignore retries) | FAIL — same |
| `npx tsc --noEmit` (backend) | FAIL — 145 errors (cascade, §5) |
| `npx eslint src/**/*.ts` (backend) | FAIL — 3427 problems (same cascade) |
| `npx jest` (backend) | FAIL — compile-step cascade |
| `cd frontend && npm install` | PASS |
| `npx tsc --noEmit` (frontend) | **PASS — 0 errors** |
| `npx eslint . --ext ts,tsx --max-warnings 0` (frontend) | FAIL — 75 pre-existing warnings (down from 87) |
| `python3 yaml.safe_load(docker-compose.yml)` | PASS (syntax only) |
| `docker compose config` / `docker build` | Could not run — docker not installed |

## 19. Exact Failures (root-caused)

- All backend TS/ESLint/Jest failures → Prisma Client never generated (§17.1).
- Frontend lint failure → pre-existing codebase-wide `any`-typing style vs
  an apparently-never-enforced `--max-warnings 0` script.
- `docker` commands → binary absent from sandbox (§17.2).

## 20. Files Changed (this hardening session)

- `docker-compose.yml` — removed insecure default secrets, added
  `${VAR:?error}` hard-fail syntax for `DB_PASSWORD`, `JWT_SECRET`,
  `JWT_REFRESH_SECRET`.
- `.env.example` — replaced realistic-looking defaults with obviously
  non-functional placeholders + explanatory comment.
- `backend/src/config/app.config.ts` — added `requireSecret()`; JWT/cookie
  secrets now throw at startup in production instead of silently falling
  back to an in-repo default.
- `frontend/package-lock.json` — generated (was missing despite CI
  referencing it — confirmed CI-breaking bug).
- `frontend/pnpm-lock.yaml`, `backend/pnpm-lock.yaml` — removed (stale,
  unused by CI).
- `frontend/src/lib/api-error.ts` — new shared typed error-message helper.
- `frontend/src/pages/super-admin/{OrganizationsPage,PlansPage,
  SupportTicketsPage}.tsx`, `frontend/src/pages/profile/MyProfilePage.tsx`,
  `frontend/src/components/payments/PayNowButton.tsx`,
  `frontend/src/components/layout/{navigation,PwaUpdatePrompt}.tsx` —
  replaced `any`-typed error handlers with `apiErrorMessage()`; fixed 2
  real ESLint errors and 3 real TypeScript unused-import errors.

---

**Bottom line:** this session found and fixed 3 more real issues beyond
everything fixed earlier — a CI-breaking package-manager conflict, and two
separate layers (Docker Compose + app config) of the same insecure-default-
secret problem. Frontend build tooling is now genuinely, freshly verified.
Backend verification remains blocked by one specific, well-understood,
external network restriction — not by any known defect in the code — but
that distinction can only be confirmed by running the same commands
outside this sandbox.
