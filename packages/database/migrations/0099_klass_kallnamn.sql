-- Ägaren 2026-11-08: en importerad klass (Eventor, IOF XML) kan döpas om här. `source_name` är klassens namn i källan när
-- den döptes om; en ny hämtning ändrar då inte det egna namnet (klassen känns igen på källans id, inte namnet).
--
-- Bara tillägg (migrations/README.md): en ny nullbar kolumn.
ALTER TABLE class ADD COLUMN IF NOT EXISTS source_name text;
