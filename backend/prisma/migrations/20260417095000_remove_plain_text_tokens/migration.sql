-- Remove plain text token field for security
-- Tokens should only be stored as bcrypt hashes

-- Drop the unique index on token column first
DROP INDEX "organization_invites_token_key";

-- Drop the plain text token column
ALTER TABLE "organization_invites" DROP COLUMN "token";

-- The inviteTokenHash column contains the secure bcrypt hash
-- inviteTokenExpiresAt contains the expiration time
-- These are sufficient for secure invite validation
