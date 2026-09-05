-- Made idempotent: this migration duplicates 20260905071835_add_sequence_counter.
-- IF NOT EXISTS guards make it safe to apply regardless of which one ran first
-- on a given environment. Do NOT delete this file if it has already been
-- applied to any environment (production/staging) — that would break
-- migration history there. Run `npx prisma migrate status` to check first.

CREATE TABLE IF NOT EXISTS "sequence_counters" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sequence_counters_gymId_scope_key" ON "sequence_counters"("gymId", "scope");
