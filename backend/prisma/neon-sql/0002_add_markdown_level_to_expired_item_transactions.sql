-- Snapshot the markdown level an item was at when it was dispositioned
-- (sold through / written off), so sell-through reporting can break stock down
-- by the reduction depth it actually sold at. Aligned with the expiry report
-- windows: 1 = 61-90 days, 2 = 31-60, 3 = 0-30 days to expiry; NULL when the
-- item was not within a markdown window.
ALTER TABLE expired_item_transactions
  ADD COLUMN IF NOT EXISTS markdown_level smallint;
