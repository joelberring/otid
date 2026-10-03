-- TASK159 / ADR-0152: trusted, one-time invitation activation substrate.
-- Additive only: existing accounts and authentication history are untouched.

CREATE TABLE account_invitation_subject (
  login_name text PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_invitation_subject_login_name_check
    CHECK (login_name ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  CONSTRAINT account_invitation_subject_generation_check CHECK (generation >= 0)
);

CREATE TABLE account_invitation_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  code_hash text NOT NULL,
  login_name text NOT NULL REFERENCES account_invitation_subject(login_name),
  display_name text NOT NULL,
  operator_label text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT account_invitation_issue_code_hash_check CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_invitation_issue_login_name_check CHECK (login_name ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  CONSTRAINT account_invitation_issue_display_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT account_invitation_issue_operator_label_check CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT account_invitation_issue_lifetime_check CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '48 hours')
);
CREATE UNIQUE INDEX account_invitation_issue_request_uidx ON account_invitation_issue(request_id);
CREATE UNIQUE INDEX account_invitation_issue_code_hash_uidx ON account_invitation_issue(code_hash);
CREATE INDEX account_invitation_issue_login_issued_idx ON account_invitation_issue(login_name, issued_at);

CREATE TABLE account_invitation_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  invitation_id uuid NOT NULL REFERENCES account_invitation_issue(id),
  operator_label text NOT NULL,
  reason text NOT NULL,
  revoked_at timestamptz NOT NULL,
  CONSTRAINT account_invitation_revocation_operator_label_check CHECK (length(btrim(operator_label)) BETWEEN 1 AND 120),
  CONSTRAINT account_invitation_revocation_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX account_invitation_revocation_request_uidx ON account_invitation_revocation(request_id);
CREATE UNIQUE INDEX account_invitation_revocation_invitation_uidx ON account_invitation_revocation(invitation_id);

CREATE TABLE account_invitation_redemption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  invitation_id uuid NOT NULL REFERENCES account_invitation_issue(id),
  account_id uuid NOT NULL REFERENCES user_account(id),
  intent_hash text NOT NULL,
  redeemed_at timestamptz NOT NULL,
  CONSTRAINT account_invitation_redemption_intent_hash_check CHECK (intent_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX account_invitation_redemption_request_uidx ON account_invitation_redemption(request_id);
CREATE UNIQUE INDEX account_invitation_redemption_invitation_uidx ON account_invitation_redemption(invitation_id);
CREATE UNIQUE INDEX account_invitation_redemption_account_uidx ON account_invitation_redemption(account_id);

CREATE TABLE account_invitation_throttle (
  login_key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL,
  blocked_until timestamptz,
  CONSTRAINT account_invitation_throttle_key_check CHECK (login_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_invitation_throttle_attempts_check CHECK (failed_attempts >= 0)
);

-- Serialize all mutations for a normalized loginName and keep its generation
-- as a monotonic invalidation marker. Inserts, revocations and redemptions each
-- advance it exactly once.
CREATE FUNCTION protect_account_invitation_subject() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Account invitation subject cannot be deleted';
  END IF;
  IF NEW.login_name IS DISTINCT FROM OLD.login_name THEN
    RAISE EXCEPTION 'Account invitation subject identity cannot change';
  END IF;
  IF NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION 'Account invitation subject generation must advance exactly once';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Account invitation subject creation time cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_invitation_subject_protected
  BEFORE UPDATE OR DELETE ON account_invitation_subject
  FOR EACH ROW EXECUTE FUNCTION protect_account_invitation_subject();

CREATE FUNCTION check_account_invitation_issue() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE existing_login text;
BEGIN
  PERFORM 1 FROM account_invitation_subject WHERE login_name = NEW.login_name FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account invitation subject missing'; END IF;
  SELECT login_name INTO existing_login FROM user_account WHERE login_name = NEW.login_name;
  IF FOUND THEN RAISE EXCEPTION 'Account login name already exists'; END IF;
  IF EXISTS (
    SELECT 1 FROM account_invitation_issue i
    WHERE i.login_name = NEW.login_name
      AND i.expires_at > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM account_invitation_revocation r WHERE r.invitation_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM account_invitation_redemption d WHERE d.invitation_id = i.id)
  ) THEN RAISE EXCEPTION 'An active account invitation already exists'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_invitation_issue_guard
  BEFORE INSERT ON account_invitation_issue
  FOR EACH ROW EXECUTE FUNCTION check_account_invitation_issue();

CREATE FUNCTION check_account_invitation_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE subject_login text;
BEGIN
  SELECT login_name INTO STRICT subject_login
    FROM account_invitation_issue WHERE id = NEW.invitation_id;
  PERFORM 1 FROM account_invitation_subject WHERE login_name = subject_login FOR UPDATE;
  IF EXISTS (SELECT 1 FROM account_invitation_redemption WHERE invitation_id = NEW.invitation_id) THEN
    RAISE EXCEPTION 'Redeemed account invitation cannot be revoked';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_invitation_revocation_guard
  BEFORE INSERT ON account_invitation_revocation
  FOR EACH ROW EXECUTE FUNCTION check_account_invitation_revocation();

CREATE FUNCTION check_account_invitation_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE invited_login text;
        invitation_expiry timestamptz;
        invitation_issue_time timestamptz;
        account_login text;
BEGIN
  SELECT login_name, expires_at, issued_at INTO STRICT invited_login, invitation_expiry, invitation_issue_time
    FROM account_invitation_issue WHERE id = NEW.invitation_id;
  PERFORM 1 FROM account_invitation_subject WHERE login_name = invited_login FOR UPDATE;
  IF EXISTS (SELECT 1 FROM account_invitation_revocation WHERE invitation_id = NEW.invitation_id) THEN
    RAISE EXCEPTION 'Revoked account invitation cannot be redeemed';
  END IF;
  IF NEW.redeemed_at < invitation_issue_time OR NEW.redeemed_at > invitation_expiry
      OR clock_timestamp() > invitation_expiry THEN
    RAISE EXCEPTION 'Expired account invitation cannot be redeemed';
  END IF;
  SELECT login_name INTO STRICT account_login FROM user_account WHERE id = NEW.account_id;
  IF account_login IS DISTINCT FROM invited_login THEN
    RAISE EXCEPTION 'Account login name does not match invitation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_invitation_redemption_guard
  BEFORE INSERT ON account_invitation_redemption
  FOR EACH ROW EXECUTE FUNCTION check_account_invitation_redemption();

CREATE FUNCTION advance_account_invitation_subject_generation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE subject_login text;
BEGIN
  IF TG_TABLE_NAME = 'account_invitation_issue' THEN
    subject_login := NEW.login_name;
  ELSE
    SELECT login_name INTO STRICT subject_login
      FROM account_invitation_issue WHERE id = NEW.invitation_id;
  END IF;
  UPDATE account_invitation_subject
    SET generation = generation + 1
    WHERE login_name = subject_login;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account invitation subject missing'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_invitation_issue_advance_subject
  AFTER INSERT ON account_invitation_issue
  FOR EACH ROW EXECUTE FUNCTION advance_account_invitation_subject_generation();
CREATE TRIGGER account_invitation_revocation_advance_subject
  AFTER INSERT ON account_invitation_revocation
  FOR EACH ROW EXECUTE FUNCTION advance_account_invitation_subject_generation();
CREATE TRIGGER account_invitation_redemption_advance_subject
  AFTER INSERT ON account_invitation_redemption
  FOR EACH ROW EXECUTE FUNCTION advance_account_invitation_subject_generation();

CREATE TRIGGER account_invitation_issue_immutable BEFORE UPDATE OR DELETE ON account_invitation_issue
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_invitation_revocation_immutable BEFORE UPDATE OR DELETE ON account_invitation_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER account_invitation_redemption_immutable BEFORE UPDATE OR DELETE ON account_invitation_redemption
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback in an active environment: disable invitation issue and activation,
-- then correct forward additively or restore a verified full PostgreSQL backup.
-- Do not drop invitation journals or reservations. Restored private invitation
-- codes cannot be reconstructed from hashes; revoke and reissue them instead.
