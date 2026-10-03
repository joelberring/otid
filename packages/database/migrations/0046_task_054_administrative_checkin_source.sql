-- TASK054 / ADR-0091: allow a stable, race-bound MANAGE_RACE journal source.
-- Keep the composite credential FK and all existing personnel capabilities intact.
ALTER TABLE start_checkin_device DROP CONSTRAINT start_checkin_device_capability_check;
ALTER TABLE start_checkin_device ADD CONSTRAINT start_checkin_device_capability_check
  CHECK (capability::text IN ('START_CHECKIN', 'FINISH_FOREST_WATCH', 'MANAGE_RACE'));
CREATE UNIQUE INDEX start_checkin_device_manage_race_credential_uidx
  ON start_checkin_device (actor_credential_id)
  WHERE capability = 'MANAGE_RACE';

-- Rollback: close the administrative writer first. Do not remove this check or
-- index while MANAGE_RACE source rows exist; use forward correction or restore
-- a verified backup, preserving journal history and FK scope.
