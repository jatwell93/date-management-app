-- Recovery (manual-only, destructive, partial) for migration 0010.
--
-- Narrows tier_feature_flags.limit_value from bigint back to integer. This
-- fails or loses data if any row exceeds the int4 range (~2.1B). Only use after
-- confirming no row exceeds int4; otherwise recover via a forward fix.
ALTER TABLE "tier_feature_flags" ALTER COLUMN "limit_value" TYPE integer;
