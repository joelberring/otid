-- Steg 23 (ADR-0173 beslut 4): en sessionsnivå. Adminförfrågningar bär kontots session och prövas mot kontots
-- roll på eventet. Tävlingssessionerna, deras credentials och delegeringarna tas bort, liksom behörighetsenumen.
-- Journalernas aktör är kontot (actor_account_id, utan främmande nyckel så att ett konto kan rensas utan att
-- tävlingens historik ändras). Avprickningskällan och okänd-bricka-journalen behåller rollen (ADMIN/FUNCTIONARY).
DROP TABLE user_account_race_delegation, pairing_admin_session_revocation, pairing_admin_session,
  pairing_admin_access_credential_revocation, pairing_admin_revocation_guard, pairing_admin_access_credential CASCADE;
--> statement-breakpoint
DROP FUNCTION advance_pairing_admin_revocation_guard(), create_pairing_admin_revocation_guard(),
  protect_pairing_admin_revocation_guard();
--> statement-breakpoint
ALTER TABLE class_capacity_change_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE class_control_neutralization DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE class_edit_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE class_result_recalculation DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE course_edit_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE course_variant_assignment_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE entry_card_rental_change DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE entry_card_rental_return_change DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE entry_card_rental_reuse_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE entry_identity_change_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE entry_transfer_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE manual_class_create_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE manual_course_class_create_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE race_settings_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE relay_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE rogaining_change_request DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE shortened_course_class_transfer DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE start_checkin_conflict_review DROP COLUMN capability;
--> statement-breakpoint
ALTER TABLE start_draw_request DROP COLUMN capability;
--> statement-breakpoint
DROP INDEX start_checkin_device_capability_scope_uidx, start_checkin_device_online_credential_uidx;
--> statement-breakpoint
ALTER TABLE start_checkin_device DROP CONSTRAINT start_checkin_device_capability_check;
--> statement-breakpoint
ALTER TABLE start_checkin_device ALTER COLUMN capability TYPE text
  USING (CASE capability::text WHEN 'RACE_FUNCTIONARY' THEN 'FUNCTIONARY' ELSE 'ADMIN' END);
--> statement-breakpoint
ALTER TABLE start_checkin_device RENAME COLUMN capability TO role;
--> statement-breakpoint
ALTER TABLE start_checkin_device ADD CONSTRAINT start_checkin_device_role_check CHECK (role IN ('ADMIN', 'FUNCTIONARY'));
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution DROP CONSTRAINT unknown_readout_resolution_capability_check;
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution ALTER COLUMN capability TYPE text
  USING (CASE capability::text WHEN 'RACE_FUNCTIONARY' THEN 'FUNCTIONARY' ELSE 'ADMIN' END);
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution RENAME COLUMN capability TO role;
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution ADD CONSTRAINT unknown_readout_resolution_role_check
  CHECK (role = 'ADMIN' OR (role = 'FUNCTIONARY' AND target = 'NEW_ENTRY'));
--> statement-breakpoint
DROP TYPE pairing_admin_capability;
--> statement-breakpoint
ALTER TABLE class_capacity_change_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE class_control_neutralization RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE class_edit_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE class_result_recalculation RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE course_edit_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE course_variant_assignment_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_card_change_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_card_rental_change RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_card_rental_return_change RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_card_rental_reuse_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_class_change_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_identity_change_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_registration_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_start_time_change_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE entry_transfer_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE iof_import_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE manual_class_create_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE manual_course_class_create_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE race_settings_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE relay_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE result_finalization RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE result_recalculation_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE rogaining_change_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE shortened_course_class_transfer RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE source_snapshot RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_checkin_conflict_review RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_checkin_device RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_checkin_dns_decision RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_checkin_dns_withdrawal RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_checkin_operation RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_draw_request RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE start_list_publication RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution RENAME COLUMN actor_credential_id TO actor_account_id;
--> statement-breakpoint
-- En avprickningskälla per konto, tävling och roll (tidigare en per tävlingssession).
CREATE UNIQUE INDEX start_checkin_device_online_account_uidx ON start_checkin_device (race_id, actor_account_id, role);
