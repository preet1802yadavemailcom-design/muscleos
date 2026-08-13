ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "reminderStagesSent" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "platform_subscriptions" ADD COLUMN IF NOT EXISTS "reminderStagesSent" TEXT[] NOT NULL DEFAULT '{}';
