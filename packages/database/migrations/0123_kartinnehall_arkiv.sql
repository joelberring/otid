-- PLAN.md steg L5 (ADR-0224, ägaren 2026-11-15): arkivet för vilande kartinnehåll i objektlagring. En rad per innehåll som
-- har laddats upp till arkivet och kontrollerats (sha256). `cold_at` sätts när delarna i `map_content_part` har tagits bort
-- här; innehållets rad i `map_content` ligger kvar och hämtas tillbaka ur arkivet vid nästa läsning (`restored_at`).
-- Raden har ingen främmande nyckel till `map_content`: när innehållet släpps (sista referensen borta) står den kvar med
-- `orphaned_at`, så att objektet i arkivet kan tas bort först när backupens sparade kopior har gått ut (beslut 7).
--
-- Bara tillägg (migrations/README.md): en ny tabell som ingen äldre kod läser.
CREATE TABLE IF NOT EXISTS map_content_archive (
  sha256 text PRIMARY KEY,
  byte_length bigint NOT NULL,
  archived_at timestamptz NOT NULL,
  cold_at timestamptz,
  restored_at timestamptz,
  orphaned_at timestamptz,
  CONSTRAINT map_content_archive_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS map_content_archive_cold_idx ON map_content_archive (cold_at) WHERE cold_at IS NOT NULL;
