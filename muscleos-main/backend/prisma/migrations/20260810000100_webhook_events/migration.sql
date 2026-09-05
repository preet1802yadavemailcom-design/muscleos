CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_eventId_key" ON "webhook_events" ("provider", "eventId");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_idx" ON "webhook_events" ("provider");
