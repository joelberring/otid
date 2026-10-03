-- TASK063 / ADR-0097: retain the real reviewing credential and capability.
-- Composite scope FKs and immutable journal triggers remain unchanged.
ALTER TABLE start_checkin_conflict_review DROP CONSTRAINT start_checkin_conflict_review_capability_check;
ALTER TABLE start_checkin_conflict_review ADD CONSTRAINT start_checkin_conflict_review_capability_check
  CHECK (capability IN ('FINISH_FOREST_WATCH', 'MANAGE_RACE'));

-- Rollback: disable the administrative writer first; retain readers for both
-- capabilities. Do not narrow the check while administrative reviews exist.
-- Use forward correction or a verified backup restore, never journal deletion.
