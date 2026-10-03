ALTER TABLE entry ADD COLUMN public_result_id uuid;

UPDATE entry
SET public_result_id = gen_random_uuid()
WHERE public_result_id IS NULL;

ALTER TABLE entry
  ALTER COLUMN public_result_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN public_result_id SET NOT NULL;

CREATE UNIQUE INDEX entry_race_public_result_uidx ON entry(race_id, public_result_id);

-- Rollback: disable the public list field and detail route. Preserve opaque
-- identities so old public links cannot be reassigned to another entry.
