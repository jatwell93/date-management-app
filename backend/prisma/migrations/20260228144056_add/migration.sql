-- CreateTable
CREATE TABLE "metrics_snapshots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "trial_conversion_rate" REAL,
    "avg_revenue_per_user" REAL,
    "churn_rate" REAL,
    "total_trials" INTEGER NOT NULL DEFAULT 0,
    "total_conversions" INTEGER NOT NULL DEFAULT 0,
    "total_churn" INTEGER NOT NULL DEFAULT 0,
    "total_revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "tier_distribution" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "webhook_metrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_type" TEXT NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "date" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "metrics_snapshots_date_key" ON "metrics_snapshots"("date");

-- CreateIndex
CREATE INDEX "metrics_snapshots_date_idx" ON "metrics_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_metrics_date_key" ON "webhook_metrics"("date");

-- CreateIndex
CREATE INDEX "webhook_metrics_event_type_idx" ON "webhook_metrics"("event_type");

-- CreateIndex
CREATE INDEX "webhook_metrics_date_idx" ON "webhook_metrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_metrics_event_type_date_key" ON "webhook_metrics"("event_type", "date");
