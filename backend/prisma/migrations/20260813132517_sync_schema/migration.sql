/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `members` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[claimToken]` on the table `members` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('QR', 'MANUAL', 'STAFF', 'KIOSK');

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "performedBy" TEXT,
ADD COLUMN     "source" "AttendanceSource" NOT NULL DEFAULT 'QR';

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "claimToken" TEXT,
ADD COLUMN     "claimTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "twoFactorRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geofenceRadiusMeters" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_qr_tokens" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "branch_qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_gymId_idx" ON "branches"("gymId");

-- CreateIndex
CREATE INDEX "branches_isActive_idx" ON "branches"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "branch_qr_tokens_token_key" ON "branch_qr_tokens"("token");

-- CreateIndex
CREATE INDEX "branch_qr_tokens_branchId_idx" ON "branch_qr_tokens"("branchId");

-- CreateIndex
CREATE INDEX "branch_qr_tokens_token_idx" ON "branch_qr_tokens"("token");

-- CreateIndex
CREATE INDEX "branch_qr_tokens_isActive_idx" ON "branch_qr_tokens"("isActive");

-- CreateIndex
CREATE INDEX "attendance_branchId_idx" ON "attendance"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "members_userId_key" ON "members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "members_claimToken_key" ON "members"("claimToken");

-- CreateIndex
CREATE INDEX "members_branchId_idx" ON "members"("branchId");

-- CreateIndex
CREATE INDEX "memberships_branchId_idx" ON "memberships"("branchId");

-- CreateIndex
CREATE INDEX "users_branchId_idx" ON "users"("branchId");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_qr_tokens" ADD CONSTRAINT "branch_qr_tokens_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
