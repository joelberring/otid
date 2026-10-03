ALTER TABLE card_assignment ADD COLUMN rental_returned boolean NOT NULL DEFAULT false;

CREATE TABLE entry_card_rental_return_change (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  class_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  card_number text NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  previous_rental_returned boolean NOT NULL,
  rental_returned boolean NOT NULL,
  entry_version_before integer NOT NULL,
  entry_version_after integer NOT NULL,
  snapshot_version_before integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_card_rental_return_change_entry_version_uidx UNIQUE(entry_id,entry_version_before),
  CONSTRAINT entry_card_rental_return_change_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT entry_card_rental_return_change_value_check CHECK(previous_rental_returned IS DISTINCT FROM rental_returned),
  CONSTRAINT entry_card_rental_return_change_versions_check CHECK(entry_version_before > 0 AND entry_version_after::bigint = entry_version_before::bigint + 1 AND snapshot_version_before > 0 AND snapshot_version_after::bigint = snapshot_version_before::bigint + 1),
  CONSTRAINT entry_card_rental_return_change_entry_scope_fk FOREIGN KEY(entry_id,race_id) REFERENCES entry(id,race_id),
  CONSTRAINT entry_card_rental_return_change_class_scope_fk FOREIGN KEY(class_id,race_id) REFERENCES class(id,race_id),
  CONSTRAINT entry_card_rental_return_change_assignment_scope_fk FOREIGN KEY(assignment_id,race_id,entry_id,card_number) REFERENCES card_assignment(id,race_id,entry_id,card_number),
  CONSTRAINT entry_card_rental_return_change_actor_scope_fk FOREIGN KEY(actor_credential_id,race_id,capability) REFERENCES pairing_admin_access_credential(id,race_id,capability)
);
CREATE INDEX entry_card_rental_return_change_race_time_idx ON entry_card_rental_return_change(race_id,changed_at);
CREATE TRIGGER entry_card_rental_return_change_immutable BEFORE UPDATE OR DELETE ON entry_card_rental_return_change
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the writer and UI, retain rental_returned and the immutable
-- journal, then correct forward additively or restore a verified full backup.
-- Never drop populated return evidence in production.
