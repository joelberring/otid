-- TASK160 / ADR-0153: bind OWNER-issued invitation mutations to exact event/account.
-- Additive only: existing invitation, account and administration history is unchanged.

CREATE TABLE event_account_invitation_issue (
  request_id uuid PRIMARY KEY,
  invitation_id uuid NOT NULL UNIQUE REFERENCES account_invitation_issue(id),
  event_id uuid NOT NULL REFERENCES event(id),
  actor_account_id uuid NOT NULL REFERENCES user_account(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_account_invitation_issue_invitation_event_uidx UNIQUE(invitation_id, event_id)
);
CREATE INDEX event_account_invitation_issue_event_created_idx
  ON event_account_invitation_issue(event_id, created_at);

CREATE TABLE event_account_invitation_revocation (
  request_id uuid PRIMARY KEY,
  revocation_id uuid NOT NULL UNIQUE REFERENCES account_invitation_revocation(id),
  invitation_id uuid NOT NULL UNIQUE,
  event_id uuid NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES user_account(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_account_invitation_revocation_issue_scope_fk
    FOREIGN KEY(invitation_id, event_id)
    REFERENCES event_account_invitation_issue(invitation_id, event_id),
  CONSTRAINT event_account_invitation_revocation_reason_check
    CHECK (length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE INDEX event_account_invitation_revocation_event_created_idx
  ON event_account_invitation_revocation(event_id, created_at);

-- Ensure the A3a revocation id identifies the same invitation as this scoped row.
CREATE FUNCTION check_event_account_invitation_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE revoked_invitation_id uuid;
BEGIN
  SELECT invitation_id INTO STRICT revoked_invitation_id
    FROM account_invitation_revocation WHERE id = NEW.revocation_id;
  IF revoked_invitation_id IS DISTINCT FROM NEW.invitation_id THEN
    RAISE EXCEPTION 'Event invitation revocation does not match invitation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_account_invitation_revocation_guard
  BEFORE INSERT ON event_account_invitation_revocation
  FOR EACH ROW EXECUTE FUNCTION check_event_account_invitation_revocation();

CREATE TRIGGER event_account_invitation_issue_immutable
  BEFORE UPDATE OR DELETE ON event_account_invitation_issue
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_account_invitation_revocation_immutable
  BEFORE UPDATE OR DELETE ON event_account_invitation_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback/restore: disable TASK160 OWNER issue/list/revoke routes and retain
-- both scoped journals and the A3a invitation journals. Correct forward or
-- restore a verified full PostgreSQL backup; do not drop history. A lost
-- browser-only invitation code cannot be reconstructed from its stored hash.
