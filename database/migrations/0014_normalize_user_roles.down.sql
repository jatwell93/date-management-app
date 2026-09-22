-- Recovery (manual-only, destructive, partial) for migration 0014.
--
-- There is no faithful reverse. 0014 rewrites 'Manager' to 'admin' or
-- 'manager' and 'Team Member' to 'team_member'; after it runs, a row holding
-- 'admin' is indistinguishable from one the bootstrap path wrote correctly
-- months earlier. Rewriting every 'admin' back to 'Manager' would downgrade
-- users who were never affected -- reintroducing issue #517 to a wider set of
-- rows than it ever touched.
--
-- So this is a deliberate no-op. Recovery is `forward-fix`: if the
-- normalization is judged wrong for some organization, correct those rows
-- forward with a new migration that names them, rather than reversing this one
-- blindly. The pre-migration values are recoverable from the Neon PITR window
-- if they are genuinely needed (docs/runbooks, migration-prep.yml creates the
-- recovery point before any apply).
--
-- A statement is required here because the runner reads every entry's recovery
-- file to fingerprint it; SELECT keeps that contract without touching data.

SELECT 1;
