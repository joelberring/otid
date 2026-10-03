-- TASK152 / ADR-0146. Exact-entry participant claim with immutable lifecycle.
-- Additive only: existing entries, accounts, results and history are untouched.

CREATE TABLE participant_entry_claim_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  race_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  issuer_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  secret_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attestation text NOT NULL,
  CONSTRAINT participant_entry_claim_issue_scope_uidx UNIQUE(id, race_id, entry_id),
  CONSTRAINT participant_entry_claim_issue_race_scope_uidx UNIQUE(id, race_id),
  CONSTRAINT participant_entry_claim_issue_entry_scope_fk FOREIGN KEY(entry_id, race_id)
    REFERENCES entry(id, race_id),
  CONSTRAINT participant_entry_claim_issue_issuer_scope_fk FOREIGN KEY(issuer_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT participant_entry_claim_issue_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT participant_entry_claim_issue_secret_hash_check CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT participant_entry_claim_issue_expiry_check CHECK(expires_at > issued_at AND expires_at <= issued_at + interval '7 days'),
  CONSTRAINT participant_entry_claim_issue_attestation_check CHECK(attestation = 'IDENTITY_CHECKED')
);
CREATE UNIQUE INDEX participant_entry_claim_issue_request_uidx ON participant_entry_claim_issue(request_id);
CREATE UNIQUE INDEX participant_entry_claim_issue_secret_hash_uidx ON participant_entry_claim_issue(secret_hash);
CREATE INDEX participant_entry_claim_issue_entry_idx ON participant_entry_claim_issue(race_id, entry_id, expires_at);

CREATE TABLE participant_entry_claim_redemption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  claim_id uuid NOT NULL REFERENCES participant_entry_claim_issue(id),
  account_id uuid NOT NULL REFERENCES user_account(id),
  redeemed_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX participant_entry_claim_redemption_request_uidx ON participant_entry_claim_redemption(request_id);
CREATE UNIQUE INDEX participant_entry_claim_redemption_claim_uidx ON participant_entry_claim_redemption(claim_id);
CREATE INDEX participant_entry_claim_redemption_account_idx ON participant_entry_claim_redemption(account_id, redeemed_at);

CREATE TABLE participant_entry_claim_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  race_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  revoked_at timestamptz NOT NULL,
  reason text NOT NULL,
  CONSTRAINT participant_entry_claim_revocation_claim_scope_fk FOREIGN KEY(claim_id, race_id)
    REFERENCES participant_entry_claim_issue(id, race_id),
  CONSTRAINT participant_entry_claim_revocation_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT participant_entry_claim_revocation_capability_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT participant_entry_claim_revocation_reason_check CHECK(length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX participant_entry_claim_revocation_request_uidx ON participant_entry_claim_revocation(request_id);
CREATE UNIQUE INDEX participant_entry_claim_revocation_claim_uidx ON participant_entry_claim_revocation(claim_id);

CREATE TRIGGER participant_entry_claim_issue_immutable BEFORE UPDATE OR DELETE ON participant_entry_claim_issue
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER participant_entry_claim_redemption_immutable BEFORE UPDATE OR DELETE ON participant_entry_claim_redemption
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER participant_entry_claim_revocation_immutable BEFORE UPDATE OR DELETE ON participant_entry_claim_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Restore note: disable TASK152 issue/redeem/read routes during an incident and
-- retain all claim journals. Forward repair or restore a verified full
-- PostgreSQL backup; plaintext codes cannot be recovered after restore and
-- affected participants must receive newly issued codes. Never delete or
-- rewrite claim, account, entry, or result history.
