-- Steg 28 (PLAN.md): vanlig PostgreSQL i stället för PostGIS. Inget i schemat använder PostGIS (kartor och rutter ligger
-- som bytea, ADR-0171), så tillägget tas bort i databaser som skapades med den gamla baslinjen. Utan CASCADE: skulle
-- något ändå bero på tillägget avbryts migreringen i stället för att något tas bort tyst.
-- Fungerar också när servern redan kör postgres:17 utan PostGIS-filerna (provat: DROP EXTENSION läser inga filer).
DROP EXTENSION IF EXISTS postgis;
--> statement-breakpoint
-- postgis/postgis:17-3.5 bygger på Debian bullseye och postgres:17 på trixie (nyare glibc). En databas från den gamla
-- bilden får då "collation version mismatch". Index som sorterar text byggs om och versionen uppdateras, bara när
-- versionerna skiljer sig. Ingen data ändras.
DO $collation$
DECLARE
  tabell regclass;
BEGIN
  IF (SELECT datcollversion <> pg_database_collation_actual_version(oid)
        FROM pg_database WHERE datname = current_database()) THEN
    FOR tabell IN SELECT c.oid::regclass FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'm') ORDER BY c.relname LOOP
      EXECUTE format('REINDEX TABLE %s', tabell);
    END LOOP;
    EXECUTE format('ALTER DATABASE %I REFRESH COLLATION VERSION', current_database());
  END IF;
END $collation$;
