-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CHEQUE';

-- AlterTable
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "members_registrationStatus_idx" ON "members"("registrationStatus");

-- AlterTable
ALTER TABLE "notification_templates" ADD COLUMN IF NOT EXISTS "gymId" TEXT;
DROP INDEX IF EXISTS "notification_templates_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "notification_templates_gymId_name_key" ON "notification_templates"("gymId", "name");
CREATE INDEX IF NOT EXISTS "notification_templates_gymId_idx" ON "notification_templates"("gymId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "member_progress" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "recordedById" TEXT,
    "weight" DECIMAL(5,2),
    "bodyFatPercent" DECIMAL(4,1),
    "chest" DECIMAL(5,2),
    "waist" DECIMAL(5,2),
    "hips" DECIMAL(5,2),
    "biceps" DECIMAL(5,2),
    "thighs" DECIMAL(5,2),
    "photoUrl" TEXT,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "member_progress_memberId_idx" ON "member_progress"("memberId");
CREATE INDEX IF NOT EXISTS "member_progress_recordedAt_idx" ON "member_progress"("recordedAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "member_progress" ADD CONSTRAINT "member_progress_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "member_progress" ADD CONSTRAINT "member_progress_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
