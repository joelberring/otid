-- Granskningen 2026-11-22 (2.2): när ett konto tas bort ska delade kartprojekt och klubbar behålla körningar och lagerprofiler som
-- kontot skapat. Kolumnerna blir nullbara och nycklarna ON DELETE SET NULL i stället för CASCADE (en lättnad, ingen data ändras).
-- Koden tar bort kontots pågående körningar och personliga lagerprofiler uttryckligen (deleteAccountWithOwnedEvents).
-- Den nya nyckeln läggs till NOT VALID och valideras efteråt så att det inte tar ett långt lås.
ALTER TABLE map_project_geo_job ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE map_project_geo_job DROP CONSTRAINT IF EXISTS map_project_geo_job_account_fkey;
ALTER TABLE map_project_geo_job ADD CONSTRAINT map_project_geo_job_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id) ON DELETE SET NULL NOT VALID;
ALTER TABLE map_project_geo_job VALIDATE CONSTRAINT map_project_geo_job_account_fkey;

ALTER TABLE map_layer_profile ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE map_layer_profile DROP CONSTRAINT IF EXISTS map_layer_profile_account_fkey;
ALTER TABLE map_layer_profile ADD CONSTRAINT map_layer_profile_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id) ON DELETE SET NULL NOT VALID;
ALTER TABLE map_layer_profile VALIDATE CONSTRAINT map_layer_profile_account_fkey;
