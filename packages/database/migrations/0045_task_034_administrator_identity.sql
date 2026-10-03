-- ADR-0075: expand the allowed genuine actor roles; retain every scoped FK,
-- version check, unique index and immutable journal trigger. No data rewrite.
-- Apply before enabling the administrator identity route.
-- Rollback: disable that route, retaining this expanded check if MANAGE_RACE
-- journal rows exist. Never delete history or restore a check that invalidates
-- it; use a forward correction or verified full backup restore instead.
ALTER TABLE entry_identity_change_request DROP CONSTRAINT entry_identity_change_capability_check;
ALTER TABLE entry_identity_change_request ADD CONSTRAINT entry_identity_change_capability_check
CHECK (capability::text IN ('CHANGE_ENTRY_IDENTITY', 'MANAGE_RACE'));
