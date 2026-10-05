-- ADR-0172 beslut 3 / PLAN.md steg 18: rollen Funktionär och städning av gamla behörigheter.
-- Ingen produktionsdata finns (ADR-0168 beslut 6).
ALTER TYPE event_administration_role ADD VALUE IF NOT EXISTS 'FUNCTIONARY';
ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'RACE_FUNCTIONARY';

-- Funktionären läggs till och tas bort under Inställningar, med samma oföränderliga historik som administratörer.
ALTER TABLE event_administration_access_request DROP CONSTRAINT event_administration_access_request_action_check;
ALTER TABLE event_administration_access_request ADD CONSTRAINT event_administration_access_request_action_check
  CHECK (action IN ('GRANT_ADMIN', 'REVOKE_ADMIN', 'GRANT_FUNCTIONARY', 'REVOKE_FUNCTIONARY'));

-- Kontot öppnar tävlingen som administratör (MANAGE_RACE) eller funktionär (RACE_FUNCTIONARY).
ALTER TABLE user_account_race_delegation DROP CONSTRAINT user_account_race_delegation_capability_check;
ALTER TABLE user_account_race_delegation ADD CONSTRAINT user_account_race_delegation_capability_check
  CHECK (capability::text IN ('MANAGE_RACE', 'RACE_FUNCTIONARY'));
ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_race_functionary_lifetime_check
  CHECK (capability::text <> 'RACE_FUNCTIONARY' OR expires_at <= issued_at + interval '8 hours');

-- Kvar i skogen och start: funktionären är en egen onlinekälla i avprickningsjournalen.
ALTER TABLE start_checkin_device DROP CONSTRAINT start_checkin_device_capability_check;
ALTER TABLE start_checkin_device ADD CONSTRAINT start_checkin_device_capability_check
  CHECK (capability::text IN ('START_CHECKIN', 'FINISH_FOREST_WATCH', 'MANAGE_RACE', 'RACE_FUNCTIONARY'));
DROP INDEX start_checkin_device_manage_race_credential_uidx;
CREATE UNIQUE INDEX start_checkin_device_online_credential_uidx
  ON start_checkin_device (actor_credential_id)
  WHERE capability IN ('MANAGE_RACE', 'RACE_FUNCTIONARY');

-- Okänd bricka: funktionären får bara direktanmäla en ny deltagare.
ALTER TABLE unknown_readout_resolution DROP CONSTRAINT unknown_readout_resolution_capability_check;
ALTER TABLE unknown_readout_resolution ADD CONSTRAINT unknown_readout_resolution_capability_check
  CHECK (capability::text = 'MANAGE_RACE' OR (capability::text = 'RACE_FUNCTIONARY' AND target = 'NEW_ENTRY'));

-- Borttaget (ADR-0172): stationsparning och stationscredentials, eventskapande med credential,
-- deltagarkoder och följda resultat ("Mina resultat") samt återhämtningskoder för incheckningsappen.
DROP TABLE IF EXISTS checkin_recovery_delivery, checkin_recovery_grant_revocation, checkin_recovery_grant_item,
  checkin_recovery_grant CASCADE;
DROP TABLE IF EXISTS participant_entry_claim_redemption, participant_entry_claim_revocation,
  participant_entry_claim_issue, account_public_result_follow CASCADE;
DROP TABLE IF EXISTS event_creation_request, event_creation_session_revocation, event_creation_session,
  event_creation_access_credential_revocation, event_creation_access_credential CASCADE;
DROP TABLE IF EXISTS station_pairing_redemption, station_pairing_attempt, station_pairing_grant_revocation,
  station_pairing_grant, station_credential_revocation, station_credential, station_device CASCADE;
DROP TYPE IF EXISTS station_credential_scope;
