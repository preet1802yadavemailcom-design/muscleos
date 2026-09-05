-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('STAFF', 'ONLINE');

-- CreateEnum
CREATE TYPE "MembershipMonthStatus" AS ENUM ('LOCKED', 'PAYABLE', 'PENDING', 'PAID');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "attemptGroupId" TEXT,
ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "utr" TEXT,
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "membership_months" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "monthStart" TIMESTAMP(3) NOT NULL,
    "amountDue" DECIMAL(10,2) NOT NULL,
    "status" "MembershipMonthStatus" NOT NULL DEFAULT 'LOCKED',
    "paymentId" TEXT,
    "gymId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_month_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "membershipMonthId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_month_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_months_gymId_idx" ON "membership_months"("gymId");

-- CreateIndex
CREATE INDEX "membership_months_status_idx" ON "membership_months"("status");

-- CreateIndex
CREATE UNIQUE INDEX "membership_months_membershipId_monthStart_key" ON "membership_months"("membershipId", "monthStart");

-- CreateIndex
CREATE UNIQUE INDEX "payment_month_allocations_paymentId_membershipMonthId_key" ON "payment_month_allocations"("paymentId", "membershipMonthId");

-- CreateIndex
CREATE INDEX "payments_utr_idx" ON "payments"("utr");

-- AddForeignKey
ALTER TABLE "membership_months" ADD CONSTRAINT "membership_months_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_months" ADD CONSTRAINT "membership_months_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_months" ADD CONSTRAINT "membership_months_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_month_allocations" ADD CONSTRAINT "payment_month_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_month_allocations" ADD CONSTRAINT "payment_month_allocations_membershipMonthId_fkey" FOREIGN KEY ("membershipMonthId") REFERENCES "membership_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
