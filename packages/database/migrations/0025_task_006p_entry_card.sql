ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'CHANGE_ENTRY_CARD';
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'ENTRY_CARD_ACCESS_CREDENTIAL';
ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_entry_card_lifetime_check
CHECK (capability::text <> 'CHANGE_ENTRY_CARD' OR expires_at <= issued_at + interval '8 hours');

CREATE TABLE entry_card_change_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race(id),
  entry_id uuid NOT NULL REFERENCES entry(id),
  class_id uuid NOT NULL REFERENCES class(id),
  actor_credential_id uuid NOT NULL REFERENCES pairing_admin_access_credential(id),
  previous_assignment_id uuid REFERENCES card_assignment(id),
  previous_card_number text,
  active_assignment_id uuid NOT NULL REFERENCES card_assignment(id),
  card_number text NOT NULL,
  entry_version_before integer NOT NULL,
  entry_version_after integer NOT NULL,
  snapshot_version_before integer NOT NULL,
  snapshot_version_after integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_card_change_request_versions_check CHECK (
    entry_version_before > 0 AND entry_version_after = entry_version_before + 1 AND
    snapshot_version_before > 0 AND snapshot_version_after = snapshot_version_before + 1),
  CONSTRAINT entry_card_change_request_previous_check CHECK ((previous_assignment_id IS NULL) = (previous_card_number IS NULL)),
  CONSTRAINT entry_card_change_request_change_check CHECK (
    previous_assignment_id IS DISTINCT FROM active_assignment_id AND previous_card_number IS DISTINCT FROM card_number)
);
CREATE UNIQUE INDEX entry_card_change_request_request_uidx ON entry_card_change_request(request_id);
CREATE UNIQUE INDEX entry_card_change_request_entry_version_uidx ON entry_card_change_request(entry_id, entry_version_before);
CREATE INDEX entry_card_change_request_race_time_idx ON entry_card_change_request(race_id, changed_at);
CREATE TRIGGER entry_card_change_request_immutable BEFORE UPDATE OR DELETE ON entry_card_change_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION protect_card_assignment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Card assignment identity is immutable'; END IF;
  IF ROW(NEW.id, NEW.race_id, NEW.entry_id, NEW.card_number, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.race_id, OLD.entry_id, OLD.card_number, OLD.created_at) THEN
    RAISE EXCEPTION 'Card assignment identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER card_assignment_identity_immutable BEFORE UPDATE OR DELETE ON card_assignment
FOR EACH ROW EXECUTE FUNCTION protect_card_assignment_identity();
