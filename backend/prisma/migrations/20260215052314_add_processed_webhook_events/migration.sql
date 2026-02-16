-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_type" TEXT NOT NULL,
    "processed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "processed_webhook_events_event_type_processed_at_idx" ON "processed_webhook_events"("event_type", "processed_at");
