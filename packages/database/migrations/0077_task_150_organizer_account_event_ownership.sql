-- TASK150 / ADR-0144: additive identity and event-administration substrate.
-- No historical event or legacy credential is assigned to an account.
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'USER_ACCOUNT';
CREATE TYPE event_administration_role AS ENUM ('OWNER');

CREATE TABLE user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_account_login_name_check CHECK (login_name ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  CONSTRAINT user_account_display_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX user_account_login_name_uidx ON user_account(login_name);

CREATE TABLE user_account_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES user_account(id),
  revoked_at timestamptz NOT NULL,
  reason text NOT NULL,
  CONSTRAINT user_account_revocation_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX user_account_revocation_account_uidx ON user_account_revocation(account_id);

CREATE TABLE user_account_auth_guard (
  account_id uuid PRIMARY KEY REFERENCES user_account(id),
  generation bigint NOT NULL DEFAULT 0,
  CONSTRAINT user_account_auth_guard_generation_check CHECK (generation >= 0)
);

CREATE TABLE user_account_password_verifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES user_account(id),
  version integer NOT NULL,
  algorithm text NOT NULL,
  salt_hex text NOT NULL,
  verifier_hex text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_account_password_verifier_version_check CHECK (version > 0),
  CONSTRAINT user_account_password_verifier_algorithm_check CHECK (algorithm = 'scrypt-v1'),
  CONSTRAINT user_account_password_verifier_salt_check CHECK (salt_hex ~ '^[a-f0-9]{32}$'),
  CONSTRAINT user_account_password_verifier_hash_check CHECK (verifier_hex ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX user_account_password_verifier_version_uidx
  ON user_account_password_verifier(account_id, version);

CREATE TABLE user_account_login_throttle (
  login_key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL,
  blocked_until timestamptz,
  CONSTRAINT user_account_login_throttle_key_check CHECK (login_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT user_account_login_throttle_attempts_check CHECK (failed_attempts >= 0)
);

CREATE TABLE user_account_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES user_account(id),
  password_version integer NOT NULL,
  session_secret_hash text NOT NULL,
  csrf_secret_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT user_account_session_verifier_fk FOREIGN KEY(account_id, password_version)
    REFERENCES user_account_password_verifier(account_id, version),
  CONSTRAINT user_account_session_secret_hash_check CHECK (session_secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT user_account_session_csrf_hash_check CHECK (csrf_secret_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT user_account_session_lifetime_check CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '8 hours')
);
CREATE UNIQUE INDEX user_account_session_id_account_uidx ON user_account_session(id, account_id);
CREATE INDEX user_account_session_account_idx ON user_account_session(account_id, expires_at);

CREATE TABLE user_account_session_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES user_account_session(id),
  revoked_at timestamptz NOT NULL,
  reason text NOT NULL,
  CONSTRAINT user_account_session_revocation_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX user_account_session_revocation_session_uidx
  ON user_account_session_revocation(session_id);

CREATE TABLE event_administration_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event(id),
  account_id uuid NOT NULL REFERENCES user_account(id),
  role event_administration_role NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_administration_grant_scope_uidx
  ON event_administration_grant(id, account_id, event_id);
CREATE UNIQUE INDEX event_administration_grant_account_event_role_uidx
  ON event_administration_grant(account_id, event_id, role);
CREATE INDEX event_administration_grant_account_idx
  ON event_administration_grant(account_id, granted_at);

CREATE TABLE event_administration_grant_revocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES event_administration_grant(id),
  revoked_at timestamptz NOT NULL,
  reason text NOT NULL,
  CONSTRAINT event_administration_grant_revocation_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX event_administration_grant_revocation_grant_uidx
  ON event_administration_grant_revocation(grant_id);

CREATE TABLE event_administration_grant_guard (
  grant_id uuid PRIMARY KEY REFERENCES event_administration_grant(id),
  generation bigint NOT NULL DEFAULT 0,
  CONSTRAINT event_administration_grant_guard_generation_check CHECK (generation >= 0)
);

CREATE TABLE user_account_event_creation_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES user_account(id),
  event_name text NOT NULL,
  race_name text NOT NULL,
  race_date date NOT NULL,
  time_zone text NOT NULL,
  event_id uuid NOT NULL REFERENCES event(id),
  race_id uuid NOT NULL REFERENCES race(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_account_event_creation_event_name_check CHECK (length(btrim(event_name)) BETWEEN 2 AND 160),
  CONSTRAINT user_account_event_creation_race_name_check CHECK (length(btrim(race_name)) BETWEEN 2 AND 160),
  CONSTRAINT user_account_event_creation_time_zone_check CHECK (length(btrim(time_zone)) BETWEEN 1 AND 100),
  CONSTRAINT user_account_event_creation_race_event_fk FOREIGN KEY(race_id, event_id)
    REFERENCES race(id, event_id)
);
CREATE UNIQUE INDEX user_account_event_creation_request_uidx
  ON user_account_event_creation_request(request_id);
CREATE UNIQUE INDEX user_account_event_creation_event_uidx
  ON user_account_event_creation_request(event_id);
CREATE UNIQUE INDEX user_account_event_creation_race_uidx
  ON user_account_event_creation_request(race_id);
CREATE INDEX user_account_event_creation_actor_idx
  ON user_account_event_creation_request(actor_account_id, created_at);

CREATE TABLE user_account_race_delegation (
  credential_id uuid PRIMARY KEY REFERENCES pairing_admin_access_credential(id),
  account_id uuid NOT NULL REFERENCES user_account(id),
  account_session_id uuid NOT NULL REFERENCES user_account_session(id),
  grant_id uuid NOT NULL REFERENCES event_administration_grant(id),
  event_id uuid NOT NULL REFERENCES event(id),
  race_id uuid NOT NULL REFERENCES race(id),
  capability pairing_admin_capability NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT user_account_race_delegation_capability_check CHECK (capability = 'MANAGE_RACE'),
  CONSTRAINT user_account_race_delegation_lifetime_check CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '1 hour'),
  CONSTRAINT user_account_race_delegation_session_scope_fk FOREIGN KEY(account_session_id, account_id)
    REFERENCES user_account_session(id, account_id),
  CONSTRAINT user_account_race_delegation_grant_scope_fk FOREIGN KEY(grant_id, account_id, event_id)
    REFERENCES event_administration_grant(id, account_id, event_id),
  CONSTRAINT user_account_race_delegation_race_scope_fk FOREIGN KEY(race_id, event_id)
    REFERENCES race(id, event_id),
  CONSTRAINT user_account_race_delegation_credential_scope_fk FOREIGN KEY(credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability)
);
CREATE INDEX user_account_race_delegation_session_idx
  ON user_account_race_delegation(account_session_id, expires_at);

CREATE FUNCTION create_user_account_auth_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_account_auth_guard (account_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_account_create_guard AFTER INSERT ON user_account
  FOR EACH ROW EXECUTE FUNCTION create_user_account_auth_guard();

CREATE FUNCTION advance_user_account_auth_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE guarded_account uuid;
BEGIN
  IF TG_TABLE_NAME = 'user_account_session_revocation' THEN
    SELECT account_id INTO STRICT guarded_account FROM user_account_session WHERE id = NEW.session_id;
  ELSE
    guarded_account := NEW.account_id;
  END IF;
  UPDATE user_account_auth_guard SET generation = generation + 1
    WHERE account_id = guarded_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account authentication guard missing'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_account_password_advance_guard AFTER INSERT ON user_account_password_verifier
  FOR EACH ROW EXECUTE FUNCTION advance_user_account_auth_guard();
CREATE TRIGGER user_account_revocation_advance_guard AFTER INSERT ON user_account_revocation
  FOR EACH ROW EXECUTE FUNCTION advance_user_account_auth_guard();
CREATE TRIGGER user_account_session_revocation_advance_guard AFTER INSERT ON user_account_session_revocation
  FOR EACH ROW EXECUTE FUNCTION advance_user_account_auth_guard();

CREATE FUNCTION create_event_administration_grant_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_administration_grant_guard (grant_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_administration_grant_create_guard AFTER INSERT ON event_administration_grant
  FOR EACH ROW EXECUTE FUNCTION create_event_administration_grant_guard();

CREATE FUNCTION advance_event_administration_grant_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE event_administration_grant_guard SET generation = generation + 1
    WHERE grant_id = NEW.grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event administration grant guard missing'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_administration_grant_revocation_advance_guard
  AFTER INSERT ON event_administration_grant_revocation
  FOR EACH ROW EXECUTE FUNCTION advance_event_administration_grant_guard();

CREATE FUNCTION protect_task150_auth_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Authentication guard cannot be deleted'; END IF;
  IF NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION 'Authentication guard must advance exactly once';
  END IF;
  IF TG_TABLE_NAME = 'user_account_auth_guard' THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'Authentication guard identity cannot change';
    END IF;
  ELSE
    IF NEW.grant_id IS DISTINCT FROM OLD.grant_id THEN
      RAISE EXCEPTION 'Authentication guard identity cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_account_auth_guard_protected BEFORE UPDATE OR DELETE ON user_account_auth_guard
  FOR EACH ROW EXECUTE FUNCTION protect_task150_auth_guard();
CREATE TRIGGER event_administration_grant_guard_protected
  BEFORE UPDATE OR DELETE ON event_administration_grant_guard
  FOR EACH ROW EXECUTE FUNCTION protect_task150_auth_guard();

CREATE TRIGGER user_account_immutable BEFORE UPDATE OR DELETE ON user_account
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER user_account_revocation_immutable BEFORE UPDATE OR DELETE ON user_account_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER user_account_password_verifier_immutable BEFORE UPDATE OR DELETE ON user_account_password_verifier
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER user_account_session_immutable BEFORE UPDATE OR DELETE ON user_account_session
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER user_account_session_revocation_immutable BEFORE UPDATE OR DELETE ON user_account_session_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_administration_grant_immutable BEFORE UPDATE OR DELETE ON event_administration_grant
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER event_administration_grant_revocation_immutable BEFORE UPDATE OR DELETE ON event_administration_grant_revocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER user_account_event_creation_request_immutable BEFORE UPDATE OR DELETE ON user_account_event_creation_request
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER user_account_race_delegation_immutable BEFORE UPDATE OR DELETE ON user_account_race_delegation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Rollback in a populated environment: disable the new account routes/CLI,
-- invalidate sessions, correct forward additively or restore a verified full
-- backup. Never drop account/grant/create/delegation evidence or mutate legacy
-- event, race, credential, result or raw-data history.
