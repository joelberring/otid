-- TASK153 / ADR-0147. Private account follow preference history.
-- Additive only: no local favorites or result history are imported or changed.

CREATE TABLE account_public_result_follow (
  event_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES user_account(id),
  race_id uuid NOT NULL,
  public_result_id uuid NOT NULL,
  followed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_public_result_follow_target_fk FOREIGN KEY(race_id, public_result_id)
    REFERENCES entry(race_id, public_result_id)
);

CREATE UNIQUE INDEX account_public_result_follow_request_uidx
  ON account_public_result_follow(request_id);
CREATE INDEX account_public_result_follow_account_latest_idx
  ON account_public_result_follow(account_id, race_id, public_result_id, event_sequence DESC);
CREATE INDEX account_public_result_follow_account_sequence_idx
  ON account_public_result_follow(account_id, event_sequence DESC);

CREATE TRIGGER account_public_result_follow_immutable
  BEFORE UPDATE OR DELETE ON account_public_result_follow
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Restore note: disable the TASK153 follow/read routes during an incident and
-- retain the journal. Correct forward or restore a verified full PostgreSQL
-- backup; do not rewrite follow history or backfill browser-local favorites.
