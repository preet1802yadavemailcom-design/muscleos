-- CreateTable
CREATE TABLE IF NOT EXISTS "sequence_counters" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_counters_gymId_scope_key" ON "sequence_counters"("gymId", "scope");
