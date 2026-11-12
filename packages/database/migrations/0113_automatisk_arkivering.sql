-- Ägaren 2026-11-12 (docs/plan-ledarflode-2026-11-12.md, G (i); ADR-0209 tillägg 2026-11-12): en träning som hör till en
-- klubb läggs i klubbens arkiv automatiskt när den är genomförd. En rad per tävling där någon har kryssat i eller ur rutan
-- "Lägg i klubbarkivet när träningen är klar", där tävlingen har lagts i ett klubbarkiv eller där den automatiska inte gick.
-- `enabled` null = förvalet (räknas fram i koden: på för en Träning med arrangörsklubbens klubbyta); `set_by`/`set_at` är den
-- som valde (kontot, utan främmande nyckel som race_organiser.set_by). `archived_at` är spärren: när den är satt görs ingen
-- automatisk arkivering (också efter Ta ur). `problem` är senaste skälet till att den automatiska inte gick (NO_ADMIN, FAILED).
-- Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS race_club_archive_auto (
  race_id uuid PRIMARY KEY REFERENCES race(id),
  enabled boolean,
  set_by uuid,
  set_at timestamptz,
  archived_at timestamptz,
  problem text,
  updated_at timestamptz NOT NULL
);
-- Tävlingar som redan har lagts i ett klubbarkiv (också de som sedan togs ur) får spärren, så att den automatiska
-- arkiveringen inte lägger tillbaka något som någon har tagit ur. Läser journalen en gång; ingen befintlig rad ändras.
INSERT INTO race_club_archive_auto (race_id, archived_at, updated_at)
SELECT a.race_id, min(a.created_at), min(a.created_at)
FROM audit_event a
WHERE a.action = 'RACE_ADDED_TO_CLUB_ARCHIVE'
GROUP BY a.race_id
ON CONFLICT (race_id) DO NOTHING;
