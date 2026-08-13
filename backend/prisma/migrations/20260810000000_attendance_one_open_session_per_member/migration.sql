-- Enforce at most one OPEN (checkOutAt IS NULL) attendance row per member,
-- at the database level. This is the actual fix for the check-in race
-- condition: two concurrent scans can both pass an application-level
-- "is there an open session?" check before either has committed, so only a
-- DB constraint closes the window completely.
--
-- Prisma's schema DSL (@@unique) cannot express a partial index (WHERE
-- clause), so this is a raw SQL migration. AttendanceCoreService.recordScan
-- relies on catching the resulting unique_violation (Postgres 23505 /
-- Prisma P2002) to atomically decide "this must be a check-out" instead of
-- doing a separate, racy read-then-write.
--
-- Before this migration runs against an existing database, it will FAIL if
-- any member already has more than one open row (data anomaly caused by the
-- prior non-atomic logic). Run the companion cleanup query first in prod:
--
--   -- Closes all but the most recent open session per member, using the
--   -- next attendance row's checkInAt as the checkout time where available,
--   -- else the same day's midnight (manual review recommended before running).
--   WITH ranked AS (
--     SELECT id, member_id,
--            ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY check_in_at DESC) AS rn
--     FROM attendance
--     WHERE check_out_at IS NULL
--   )
--   SELECT id FROM ranked WHERE rn > 1; -- inspect, then decide checkout times manually

CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open_session_per_member
  ON attendance ("memberId")
  WHERE "checkOutAt" IS NULL;