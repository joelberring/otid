-- ADR-0172 beslut 1–2 / PLAN.md steg 17: konton med e-post, återställningslänk, superadmin och borttagning.
-- Ingen produktionsdata finns (ADR-0168 beslut 6). Inbjudningar och återställningskoder i fil tas bort.
DROP TABLE IF EXISTS event_account_invitation_revocation, event_account_invitation_issue,
  account_invitation_redemption, account_invitation_revocation, account_invitation_issue,
  account_invitation_subject, account_invitation_throttle,
  account_password_recovery_redemption, account_password_recovery_revocation,
  account_password_recovery_issue, account_password_recovery_throttle,
  user_account_revocation CASCADE;
DROP FUNCTION IF EXISTS protect_account_invitation_subject(), advance_account_invitation_subject_generation(),
  check_account_invitation_issue(), check_account_invitation_redemption(), check_account_invitation_revocation(),
  check_event_account_invitation_revocation(), check_account_password_recovery_issue(),
  check_account_password_recovery_redemption(), check_account_password_recovery_revocation() CASCADE;

-- Skyddade tabeller får tas bort bara i en uttrycklig borttagning av en tävling eller ett konto
-- (`set_config('otid.purge', 'on', true)` i samma transaktion, se packages/application/src/purge.ts).
-- Ändringar av befintliga rader nekas som förut.
CREATE OR REPLACE FUNCTION reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION protect_task150_auth_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Authentication guard cannot be deleted';
  END IF;
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

CREATE OR REPLACE FUNCTION protect_card_assignment_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Card assignment identity is immutable';
  END IF;
  IF ROW(NEW.id, NEW.race_id, NEW.entry_id, NEW.card_number, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.race_id, OLD.entry_id, OLD.card_number, OLD.created_at) THEN
    RAISE EXCEPTION 'Card assignment identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_pairing_admin_revocation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Authentication revocation guard cannot be deleted';
  END IF;
  IF NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION 'Authentication revocation guard must advance exactly once';
  END IF;
  RETURN NEW;
END;
$$;

-- Kontot: e-post i stället för inloggningsnamn. Namn, superadmin, spärr och senaste inloggning får ändras;
-- id och skapandetid aldrig. Befintliga utvecklingskonton får en adress under den reserverade domänen .invalid.
DROP TRIGGER user_account_immutable ON user_account;
ALTER TABLE user_account ADD COLUMN email text;
UPDATE user_account SET email = login_name || '@konto.invalid';
DROP INDEX user_account_login_name_uidx;
ALTER TABLE user_account DROP CONSTRAINT user_account_login_name_check, DROP COLUMN login_name;
ALTER TABLE user_account
  ALTER COLUMN email SET NOT NULL,
  ADD COLUMN is_superadmin boolean NOT NULL DEFAULT false,
  ADD COLUMN blocked_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD CONSTRAINT user_account_email_check CHECK (
    email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$');
CREATE UNIQUE INDEX user_account_email_uidx ON user_account(email);

CREATE FUNCTION protect_user_account_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'user_account can only be removed by an explicit account deletion';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'user_account identity cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_account_identity_protected BEFORE UPDATE OR DELETE ON user_account
  FOR EACH ROW EXECUTE FUNCTION protect_user_account_identity();

-- Spärr mot upprepade försök (registrering per IP, återställning per IP och e-post). Nycklarna lagras hashade.
CREATE TABLE account_request_throttle (
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (scope, key_hash),
  CONSTRAINT account_request_throttle_scope_check CHECK (scope IN ('REGISTER_IP', 'RESET_IP', 'RESET_EMAIL')),
  CONSTRAINT account_request_throttle_key_check CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_request_throttle_attempts_check CHECK (attempts >= 0)
);

-- Återställningslänk: bara hashen av engångsnyckeln sparas. Gäller en timme och en gång.
CREATE TABLE password_reset_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES user_account(id),
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by_superadmin boolean NOT NULL DEFAULT false,
  CONSTRAINT password_reset_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT password_reset_token_lifetime_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE UNIQUE INDEX password_reset_token_hash_uidx ON password_reset_token(token_hash);
CREATE INDEX password_reset_token_account_idx ON password_reset_token(account_id, created_at);

-- Superadmin döljer en tävling från de publika sidorna. Steg 19 lägger till arrangörens publicering;
-- publikt synlig = publicerad OCH inte dold.
ALTER TABLE race ADD COLUMN hidden_by_superadmin boolean NOT NULL DEFAULT false;

-- Superadmins åtgärder: vem, vad, mot vad, varför och när. Inga främmande nycklar, så loggen finns kvar
-- när kontot eller tävlingen har tagits bort. Raderna ändras aldrig.
CREATE TABLE superadmin_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL,
  actor_account_id uuid,
  actor_label text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_label text NOT NULL,
  reason text NOT NULL,
  CONSTRAINT superadmin_action_action_check CHECK (action IN ('GRANT_SUPERADMIN', 'REVOKE_SUPERADMIN', 'HIDE_RACE',
    'UNHIDE_RACE', 'DELETE_EVENT', 'BLOCK_ACCOUNT', 'UNBLOCK_ACCOUNT', 'DELETE_ACCOUNT', 'CREATE_RESET_LINK')),
  CONSTRAINT superadmin_action_target_type_check CHECK (target_type IN ('ACCOUNT', 'EVENT', 'RACE')),
  CONSTRAINT superadmin_action_actor_label_check CHECK (length(btrim(actor_label)) BETWEEN 1 AND 254),
  CONSTRAINT superadmin_action_target_label_check CHECK (length(btrim(target_label)) BETWEEN 1 AND 320),
  CONSTRAINT superadmin_action_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);
CREATE INDEX superadmin_action_created_idx ON superadmin_action(created_at DESC);
CREATE FUNCTION superadmin_action_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'superadmin_action is append-only';
END;
$$;
CREATE TRIGGER superadmin_action_append_only BEFORE UPDATE OR DELETE ON superadmin_action
  FOR EACH ROW EXECUTE FUNCTION superadmin_action_reject_change();
