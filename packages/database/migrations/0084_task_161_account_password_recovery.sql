-- TASK161 / ADR-0154: trusted one-time password recovery for existing accounts.
-- Additive only; account identity, grants, claims, and prior verifier history remain intact.

CREATE TABLE account_password_recovery_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES user_account(id),
  login_name text NOT NULL,
  operator_label text NOT NULL,
  reason text NOT NULL,
  code_hash text NOT NULL,
  expected_password_version integer NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT account_password_recovery_issue_id_account_uidx UNIQUE(id, account_id),
  CONSTRAINT account_password_recovery_issue_login_name_check
    CHECK (login_name ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  CONSTRAINT account_password_recovery_issue_operator_label_check
    CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT account_password_recovery_issue_reason_check
    CHECK (length(btrim(reason)) BETWEEN 1 AND 240),
  CONSTRAINT account_password_recovery_issue_code_hash_check CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_password_recovery_issue_version_check CHECK (expected_password_version > 0),
  CONSTRAINT account_password_recovery_issue_lifetime_check CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'),
  CONSTRAINT account_password_recovery_issue_verifier_fk
    FOREIGN KEY(account_id, expected_password_version)
    REFERENCES user_account_password_verifier(account_id, version)
);
CREATE UNIQUE INDEX account_password_recovery_issue_request_uidx
  ON account_password_recovery_issue(request_id);
CREATE UNIQUE INDEX account_password_recovery_issue_code_hash_uidx
  ON account_password_recovery_issue(code_hash);
CREATE INDEX account_password_recovery_issue_account_issued_idx
  ON account_password_recovery_issue(account_id, issued_at);

CREATE TABLE account_password_recovery_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  recovery_id uuid NOT NULL REFERENCES account_password_recovery_issue(id),
  operator_label text NOT NULL,
  reason text NOT NULL,
  revoked_at timestamptz NOT NULL,
  CONSTRAINT account_password_recovery_revocation_operator_label_check
    CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT account_password_recovery_revocation_reason_check
    CHECK (length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX account_password_recovery_revocation_request_uidx
  ON account_password_recovery_revocation(request_id);
CREATE UNIQUE INDEX account_password_recovery_revocation_recovery_uidx
  ON account_password_recovery_revocation(recovery_id);

CREATE TABLE account_password_recovery_redemption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  recovery_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES user_account(id),
  password_version integer NOT NULL,
  intent_hash text NOT NULL,
  redeemed_at timestamptz NOT NULL,
  CONSTRAINT account_password_recovery_redemption_version_check CHECK (password_version > 0),
  CONSTRAINT account_password_recovery_redemption_intent_hash_check CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_password_recovery_redemption_issue_account_fk
    FOREIGN KEY(recovery_id, account_id)
    REFERENCES account_password_recovery_issue(id, account_id),
  CONSTRAINT account_password_recovery_redemption_verifier_fk
    FOREIGN KEY(account_id, password_version)
    REFERENCES user_account_password_verifier(account_id, version)
);
CREATE UNIQUE INDEX account_password_recovery_redemption_request_uidx
  ON account_password_recovery_redemption(request_id);
CREATE UNIQUE INDEX account_password_recovery_redemption_recovery_uidx
  ON account_password_recovery_redemption(recovery_id);

CREATE TABLE account_password_recovery_throttle (
  login_key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL,
  blocked_until timestamptz,
  CONSTRAINT account_password_recovery_throttle_key_check CHECK (login_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_password_recovery_throttle_attempts_check CHECK (failed_attempts >= 0)
);

-- Serialize issue/revoke/redeem with password rotation and one another on the
-- existing per-account auth guard. This also prevents multiple pending codes.
CREATE FUNCTION check_account_password_recovery_issue() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_login text;
        current_version integer;
BEGIN
  PERFORM 1 FROM user_account_auth_guard WHERE account_id = NEW.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account auth guard missing'; END IF;
  SELECT login_name INTO STRICT current_login FROM user_account WHERE id = NEW.account_id;
  IF current_login IS DISTINCT FROM NEW.login_name THEN
    RAISE EXCEPTION 'Recovery account login name mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM user_account_revocation WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Revoked account cannot receive recovery';
  END IF;
  SELECT version INTO current_version FROM user_account_password_verifier
    WHERE account_id = NEW.account_id ORDER BY version DESC LIMIT 1;
  IF current_version IS DISTINCT FROM NEW.expected_password_version THEN
    RAISE EXCEPTION 'Recovery verifier version is stale';
  END IF;
  IF EXISTS (
    SELECT 1 FROM account_password_recovery_issue i
    WHERE i.account_id = NEW.account_id
      AND i.expires_at > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM account_password_recovery_revocation r WHERE r.recovery_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM account_password_recovery_redemption d WHERE d.recovery_id = i.id)
  ) THEN RAISE EXCEPTION 'Active password recovery already exists'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_password_recovery_issue_guard
  BEFORE INSERT ON account_password_recovery_issue
  FOR EACH ROW EXECUTE FUNCTION check_account_password_recovery_issue();

CREATE FUNCTION check_account_password_recovery_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_account uuid;
BEGIN
  SELECT account_id INTO STRICT target_account
    FROM account_password_recovery_issue WHERE id = NEW.recovery_id;
  PERFORM 1 FROM user_account_auth_guard WHERE account_id = target_account FOR UPDATE;
  IF EXISTS (SELECT 1 FROM account_password_recovery_redemption WHERE recovery_id = NEW.recovery_id) THEN
    RAISE EXCEPTION 'Redeemed recovery cannot be revoked';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_password_recovery_revocation_guard
  BEFORE INSERT ON account_password_recovery_revocation
  FOR EACH ROW EXECUTE FUNCTION check_account_password_recovery_revocation();

CREATE FUNCTION check_account_password_recovery_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE issue_account uuid;
        expected_version integer;
        issue_time timestamptz;
        expiry timestamptz;
        latest_version integer;
BEGIN
  SELECT account_id, expected_password_version, issued_at, expires_at
    INTO STRICT issue_account, expected_version, issue_time, expiry
    FROM account_password_recovery_issue WHERE id = NEW.recovery_id;
  PERFORM 1 FROM user_account_auth_guard WHERE account_id = issue_account FOR UPDATE;
  IF NEW.account_id IS DISTINCT FROM issue_account THEN
    RAISE EXCEPTION 'Recovery account mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM user_account_revocation WHERE account_id = issue_account) THEN
    RAISE EXCEPTION 'Revoked account cannot redeem recovery';
  END IF;
  IF EXISTS (SELECT 1 FROM account_password_recovery_revocation WHERE recovery_id = NEW.recovery_id) THEN
    RAISE EXCEPTION 'Revoked recovery cannot be redeemed';
  END IF;
  IF NEW.redeemed_at < issue_time OR NEW.redeemed_at > expiry OR clock_timestamp() > expiry THEN
    RAISE EXCEPTION 'Expired recovery cannot be redeemed';
  END IF;
  SELECT version INTO latest_version FROM user_account_password_verifier
    WHERE account_id = issue_account ORDER BY version DESC LIMIT 1;
  -- The new verifier is inserted first in this same transaction because the
  -- redemption row has a foreign key to it. The account guard serializes both.
  IF latest_version IS DISTINCT FROM NEW.password_version OR NEW.password_version <> expected_version + 1 THEN
    RAISE EXCEPTION 'Recovery verifier version changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_password_recovery_redemption_guard
  BEFORE INSERT ON account_password_recovery_redemption
  FOR EACH ROW EXECUTE FUNCTION check_account_password_recovery_redemption();

CREATE TRIGGER account_password_recovery_issue_immutable BEFORE UPDATE OR DELETE ON account_password_recovery_issue
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_password_recovery_revocation_immutable BEFORE UPDATE OR DELETE ON account_password_recovery_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_password_recovery_redemption_immutable BEFORE UPDATE OR DELETE ON account_password_recovery_redemption
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback in an active environment: disable recovery issue/revoke CLI and
-- recovery POST, then correct forward or restore a verified full PostgreSQL
-- backup. Do not drop recovery journals or verifier history. After restore,
-- lost private codes cannot be reconstructed; revoke and issue replacements.
