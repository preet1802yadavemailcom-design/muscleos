-- CreateEnum
CREATE TYPE "PlatformSubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'TRIAL');

-- CreateTable
CREATE TABLE "platform_subscriptions" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "planId" TEXT,
    "status" "PlatformSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "amount" DECIMAL(10,2) NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reminderStagesSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
    "gatewayPaymentId" TEXT,
    "gatewayOrderId" TEXT,
    "invoiceNumber" TEXT,
    "webhookData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_subscriptions_gymId_key" ON "platform_subscriptions"("gymId");

-- CreateIndex
CREATE INDEX "platform_subscriptions_status_idx" ON "platform_subscriptions"("status");

-- CreateIndex
CREATE INDEX "platform_subscriptions_currentPeriodEnd_idx" ON "platform_subscriptions"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payments_invoiceNumber_key" ON "platform_payments"("invoiceNumber");

-- CreateIndex
CREATE INDEX "platform_payments_subscriptionId_idx" ON "platform_payments"("subscriptionId");

-- CreateIndex
CREATE INDEX "platform_payments_status_idx" ON "platform_payments"("status");

-- AddForeignKey
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "gyms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "gym_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "platform_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
