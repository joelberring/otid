-- Ägarens plan 2026-11-13 (banläggning och kartritning, etapp 1): banläggningens karta kan komma ur ett kartprojekt i stället
-- för en uppladdad fil. Kartan är en ögonblicksbild (grundfilen med projektets införda ändringar) som sparas som tävlingens
-- kartfil på samma sätt som en uppladdad (race_map_source och map_content); raden här säger vilket projekt bilden kom ur och
-- vilket löpnummer (map_project.seq) den motsvarar. Kartan under banorna ändras inte förrän någon väljer «Ta in kartans
-- ändringar», som gör en ny bild och byter raden.
--
-- Kopplingen gäller bara så länge tävlingens kartfil är just den bilden (sha256 lika med race_map_source.sha256): laddas en
-- annan kartfil upp på vanligt sätt ligger raden kvar men räknas inte. Främmande nycklar till tävlingen och projektet, så
-- att raden följer med när någon av dem tas bort (purge följer nycklarna).
--
-- Bara tillägg (migrations/README.md): en ny tabell. Befintliga banläggningar har ingen rad och är som förut.
CREATE TABLE IF NOT EXISTS race_map_project_link (
  race_id uuid PRIMARY KEY REFERENCES race(id),
  project_id uuid NOT NULL REFERENCES map_project(id),
  seq bigint NOT NULL,
  sha256 text NOT NULL,
  colors_changed_at timestamptz,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL,
  CONSTRAINT race_map_project_link_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT race_map_project_link_seq_check CHECK (seq >= 0)
);
CREATE INDEX IF NOT EXISTS race_map_project_link_project_idx ON race_map_project_link (project_id);
