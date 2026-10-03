-- TASK054: run only in the selected isolated test database after migration.
-- Reuses one synthetic administrator credential; rolls back every test row.
BEGIN;
DO $$
DECLARE
  test_actor uuid;
  test_race uuid;
BEGIN
  SELECT id, race_id INTO test_actor, test_race
  FROM pairing_admin_access_credential WHERE capability = 'MANAGE_RACE' LIMIT 1;
  IF test_actor IS NULL THEN RAISE EXCEPTION 'Synthetic administrator fixture required'; END IF;
  INSERT INTO start_checkin_device (id, race_id, actor_credential_id, capability, label, registered_at)
  VALUES (gen_random_uuid(), test_race, test_actor, 'MANAGE_RACE', 'TASK054 synthetic source', now());
  BEGIN
    INSERT INTO start_checkin_device (id, race_id, actor_credential_id, capability, label, registered_at)
    VALUES (gen_random_uuid(), test_race, test_actor, 'MANAGE_RACE', 'TASK054 duplicate', now());
    RAISE EXCEPTION 'Duplicate administrative source was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO start_checkin_device (id, race_id, actor_credential_id, capability, label, registered_at)
    VALUES (gen_random_uuid(), test_race, test_actor, 'FINISH_FOREST_WATCH', 'TASK054 wrong actor role', now());
    RAISE EXCEPTION 'False finish identity was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'TASK054: administrative source accepted; duplicate and false finish identity rejected';
END $$;
ROLLBACK;
