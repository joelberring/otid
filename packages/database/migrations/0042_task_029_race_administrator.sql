-- Additive: no existing credential gains administrator privileges.
ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'MANAGE_RACE';
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'RACE_ADMIN_ACCESS_CREDENTIAL';
ALTER TABLE pairing_admin_access_credential
  ADD CONSTRAINT pairing_admin_race_administrator_lifetime_check
  CHECK (capability::text <> 'MANAGE_RACE' OR expires_at <= issued_at + interval '8 hours');
