-- Additive safety marker. Revocation history remains authoritative/immutable.
-- Run with admin writers quiesced. Login and logout acquire different parent
-- locks; table ordering alone cannot replace the documented maintenance stop.
SET LOCAL lock_timeout = '5s';
LOCK TABLE pairing_admin_session, pairing_admin_access_credential,
  pairing_admin_access_credential_revocation, pairing_admin_session_revocation
  IN EXCLUSIVE MODE;

CREATE TABLE pairing_admin_revocation_guard (
  credential_id uuid PRIMARY KEY REFERENCES pairing_admin_access_credential(id),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0)
);
INSERT INTO pairing_admin_revocation_guard (credential_id)
SELECT id FROM pairing_admin_access_credential;

CREATE FUNCTION create_pairing_admin_revocation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pairing_admin_revocation_guard (credential_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER pairing_admin_credential_create_guard
AFTER INSERT ON pairing_admin_access_credential
FOR EACH ROW EXECUTE FUNCTION create_pairing_admin_revocation_guard();

CREATE FUNCTION advance_pairing_admin_revocation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE guarded_credential uuid;
BEGIN
  IF TG_TABLE_NAME = 'pairing_admin_access_credential_revocation' THEN
    guarded_credential := NEW.credential_id;
  ELSE
    SELECT access_credential_id INTO STRICT guarded_credential
    FROM pairing_admin_session WHERE id = NEW.session_id;
  END IF;
  UPDATE pairing_admin_revocation_guard SET generation = generation + 1
    WHERE credential_id = guarded_credential;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication revocation guard missing';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pairing_admin_credential_revocation_advance_guard
AFTER INSERT ON pairing_admin_access_credential_revocation
FOR EACH ROW EXECUTE FUNCTION advance_pairing_admin_revocation_guard();
CREATE TRIGGER pairing_admin_session_revocation_advance_guard
AFTER INSERT ON pairing_admin_session_revocation
FOR EACH ROW EXECUTE FUNCTION advance_pairing_admin_revocation_guard();

CREATE FUNCTION protect_pairing_admin_revocation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Authentication revocation guard cannot be deleted';
  END IF;
  IF NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION 'Authentication revocation guard must advance exactly once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pairing_admin_revocation_guard_protected
BEFORE UPDATE OR DELETE ON pairing_admin_revocation_guard
FOR EACH ROW EXECUTE FUNCTION protect_pairing_admin_revocation_guard();
