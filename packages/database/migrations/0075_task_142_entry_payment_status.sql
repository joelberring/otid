CREATE TYPE payment_status AS ENUM ('UNMARKED', 'UNPAID', 'PAID', 'WAIVED');

ALTER TABLE entry
  ADD COLUMN payment_status payment_status NOT NULL DEFAULT 'UNMARKED',
  ADD COLUMN payment_status_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT entry_payment_status_version_check CHECK (payment_status_version > 0);

CREATE TABLE entry_payment_status_change (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  class_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  previous_payment_status payment_status NOT NULL,
  payment_status payment_status NOT NULL,
  entry_version_at_change integer NOT NULL,
  payment_status_version_before integer NOT NULL,
  payment_status_version_after integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_payment_status_change_entry_version_uidx UNIQUE(entry_id, payment_status_version_before),
  CONSTRAINT entry_payment_status_change_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT entry_payment_status_change_value_check CHECK(previous_payment_status IS DISTINCT FROM payment_status),
  CONSTRAINT entry_payment_status_change_versions_check CHECK(entry_version_at_change > 0 AND payment_status_version_before > 0 AND payment_status_version_after::bigint = payment_status_version_before::bigint + 1),
  CONSTRAINT entry_payment_status_change_entry_scope_fk FOREIGN KEY(entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT entry_payment_status_change_class_scope_fk FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT entry_payment_status_change_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability) REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE INDEX entry_payment_status_change_race_time_idx ON entry_payment_status_change(race_id, changed_at);
CREATE TRIGGER entry_payment_status_change_immutable BEFORE UPDATE OR DELETE ON entry_payment_status_change
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback: disable the writer and UI, retain payment_status/current version and
-- immutable history, then correct forward additively or restore a verified full
-- backup. Never drop payment evidence in a populated environment.
