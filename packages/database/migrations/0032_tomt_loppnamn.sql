-- Loppets namn är valfritt: ett evenemang med ett enda lopp har inget eget loppnamn och sparar '' (NOT NULL kvar).
-- Webben visar då bara evenemangets namn (`raceTitle` i @o-tid/domain), inte "Natt-KM · Lopp 1".
-- Kontots skapandeförsök (user_account_event_creation_request) får därför också ha ett tomt loppnamn.
ALTER TABLE user_account_event_creation_request DROP CONSTRAINT IF EXISTS user_account_event_creation_race_name_check;
ALTER TABLE user_account_event_creation_request ADD CONSTRAINT user_account_event_creation_race_name_check
  CHECK (length(btrim(race_name)) <= 160);

-- Tidigare blev ett tomt fält "Lopp 1". Det enda loppet i sitt evenemang som heter exakt så får inget namn.
-- Tävlingsversionen räknas upp som när namnet ändras under Inställningar (avläsningens paket hämtas om).
UPDATE race SET name = '', snapshot_version = snapshot_version + 1
WHERE name = 'Lopp 1'
  AND NOT EXISTS (SELECT 1 FROM race other WHERE other.event_id = race.event_id AND other.id <> race.id);
