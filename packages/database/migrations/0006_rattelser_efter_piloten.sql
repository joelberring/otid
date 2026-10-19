-- Steg 27 (PLAN.md): rättelser efter första piloten.
-- "Stryk": en anmäld som har läst ut (eller har en resultatrevision) tas inte bort utan stryks. Den syns inte i någon
-- lista (arbetsytan, start- och resultatlistor, speaker, kvar i skogen, avläsningspaketet, export till IOF), men
-- anmälan, resultatrevisionerna och de råa avläsningarna finns kvar. NULL = inte struken.
ALTER TABLE entry ADD COLUMN struck_at timestamptz;
--> statement-breakpoint
CREATE INDEX entry_race_struck_idx ON entry (race_id) WHERE struck_at IS NULL;
--> statement-breakpoint
-- "Resultaten är klara": det fastställande av hela loppet som gäller som officiella resultat. NULL = preliminära
-- (aldrig klara, eller ångrat med "Gör resultaten preliminära igen"). Fastställandena själva ändras aldrig.
-- Nyckeln är uppskjuten så att borttagningen av en hel tävling (purge) kan ta loppet och fastställandena i en följd.
ALTER TABLE race ADD COLUMN official_result_finalization_id uuid;
--> statement-breakpoint
ALTER TABLE race ADD CONSTRAINT race_official_result_finalization_fk FOREIGN KEY (official_result_finalization_id)
  REFERENCES result_finalization(id) DEFERRABLE INITIALLY DEFERRED;
