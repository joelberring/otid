-- ADR-0056: append-only review provenance; no operation, receipt or result is changed.
CREATE UNIQUE INDEX start_checkin_operation_conflict_review_source_uidx
  ON start_checkin_operation(request_id, race_id, entry_id, content_hash, effect);
CREATE TABLE start_checkin_conflict_review (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL,
  source_hash text NOT NULL,
  intent_canonical_json text NOT NULL,
  intent_hash text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  CONSTRAINT start_checkin_conflict_review_capability_check CHECK (capability = 'FINISH_FOREST_WATCH'),
  CONSTRAINT start_checkin_conflict_review_decision_check CHECK (decision = 'KEEP_CURRENT_STATE'),
  CONSTRAINT start_checkin_conflict_review_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT start_checkin_conflict_review_hash_check CHECK (source_hash ~ '^[a-f0-9]{64}$' AND intent_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT start_checkin_conflict_review_intent_check CHECK (jsonb_typeof(intent_canonical_json::jsonb) = 'object'),
  CONSTRAINT start_checkin_conflict_review_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES entry(id, race_id),
  CONSTRAINT start_checkin_conflict_review_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE UNIQUE INDEX start_checkin_conflict_review_request_uidx ON start_checkin_conflict_review(request_id);
CREATE UNIQUE INDEX start_checkin_conflict_review_scope_uidx ON start_checkin_conflict_review(id, race_id, entry_id);
CREATE INDEX start_checkin_conflict_review_race_time_idx ON start_checkin_conflict_review(race_id, reviewed_at);
CREATE TABLE start_checkin_conflict_review_item (
  review_id uuid NOT NULL,
  conflict_request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  content_hash text NOT NULL,
  operation_effect text NOT NULL DEFAULT 'CONFLICT',
  CONSTRAINT start_checkin_conflict_review_item_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT start_checkin_conflict_review_item_effect_check CHECK (operation_effect = 'CONFLICT'),
  CONSTRAINT start_checkin_conflict_review_item_review_scope_fk FOREIGN KEY (review_id, race_id, entry_id)
    REFERENCES start_checkin_conflict_review(id, race_id, entry_id),
  CONSTRAINT start_checkin_conflict_review_item_operation_source_fk FOREIGN KEY (conflict_request_id, race_id, entry_id, content_hash, operation_effect)
    REFERENCES start_checkin_operation(request_id, race_id, entry_id, content_hash, effect)
);
CREATE INDEX start_checkin_conflict_review_item_review_idx ON start_checkin_conflict_review_item(review_id);
CREATE TRIGGER start_checkin_conflict_review_immutable BEFORE UPDATE OR DELETE ON start_checkin_conflict_review
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER start_checkin_conflict_review_item_immutable BEFORE UPDATE OR DELETE ON start_checkin_conflict_review_item
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
-- Rollback: disable review writes, preserve reports/reviews/items/audit. Correct forward
-- or restore a verified complete PostgreSQL backup. Never delete history to retry a review.
