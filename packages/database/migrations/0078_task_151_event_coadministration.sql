-- TASK151 / ADR-0145: event-scoped ADMIN grants and immutable request history.
-- Existing grants and revocations remain unchanged; each regrant gets a new id.
ALTER TYPE event_administration_role ADD VALUE 'ADMIN';

DROP INDEX event_administration_grant_account_event_role_uidx;
CREATE UNIQUE INDEX event_administration_grant_owner_account_event_uidx
  ON event_administration_grant(account_id, event_id)
  WHERE role = 'OWNER';

CREATE TABLE event_administration_access_request (
  request_id uuid PRIMARY KEY,
  action text NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES user_account(id),
  event_id uuid NOT NULL REFERENCES event(id),
  target_account_id uuid NOT NULL REFERENCES user_account(id),
  grant_id uuid NOT NULL REFERENCES event_administration_grant(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_administration_access_request_grant_scope_fk
    FOREIGN KEY (grant_id, target_account_id, event_id)
    REFERENCES event_administration_grant(id, account_id, event_id),
  CONSTRAINT event_administration_access_request_action_check
    CHECK (action IN ('GRANT_ADMIN', 'REVOKE_ADMIN')),
  CONSTRAINT event_administration_access_request_target_check
    CHECK (actor_account_id <> target_account_id),
  CONSTRAINT event_administration_access_request_reason_check
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE INDEX event_administration_access_request_event_idx
  ON event_administration_access_request(event_id, created_at);
CREATE INDEX event_administration_access_request_actor_idx
  ON event_administration_access_request(actor_account_id, created_at);
CREATE TRIGGER event_administration_access_request_immutable
  BEFORE UPDATE OR DELETE ON event_administration_access_request
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Restore note: disable TASK151 grant routes on incident and retain grants,
-- revocations, and request rows. Correct forward or restore a verified full
-- PostgreSQL backup. Never drop the ADMIN enum value or access-request history.
