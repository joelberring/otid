-- TASK101 widens the immutable, closed Eventor profile discriminator. It does
-- not create a free-form URL, change any existing Testeventor provenance, or
-- grant a new capability.
ALTER TABLE eventor_connection DROP CONSTRAINT eventor_connection_environment_check;
ALTER TABLE eventor_connection ADD CONSTRAINT eventor_connection_environment_check
  CHECK (environment IN ('testeventor-se', 'production-se'));

ALTER TABLE eventor_import_request DROP CONSTRAINT eventor_import_environment_check;
ALTER TABLE eventor_import_request ADD CONSTRAINT eventor_import_environment_check
  CHECK (environment IN ('testeventor-se', 'production-se'));

-- Rollback/restore: disable production-profile provisioning and revoke its
-- connections. Do not mutate or delete immutable connection/import history;
-- repair forward or restore a verified PostgreSQL backup.
