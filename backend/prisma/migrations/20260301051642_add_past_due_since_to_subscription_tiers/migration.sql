-- AlterTable
ALTER TABLE "subscription_tiers" ADD COLUMN "past_due_since" DATETIME;

-- CreateIndex
CREATE INDEX "subscription_tiers_past_due_since_idx" ON "subscription_tiers"("past_due_since");
