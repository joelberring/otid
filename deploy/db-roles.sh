#!/bin/sh
# Databasroller (ADR-0186, docs/drift.md "Databasroller"). Körs på servern i repots rot:
#
#   sh deploy/db-roles.sh setup      skapar rollerna (eller byter deras lösenord), lägger lösenorden i .env om de saknas,
#                                    gör otid_owner till ägare av allt i databasen och ger rättigheterna. Kan köras om.
#   sh deploy/db-roles.sh check      provar varje roll: läser och skriver det den ska och nekas det den inte ska.
#   sh deploy/db-roles.sh rollback   ger tillbaka ägarskapet till superusern otid och tar bort rollerna. Ta först bort
#                                    raderna OTID_DB_* ur .env och kör `docker compose -f docker-compose.prod.yml up -d`.
#
# Rollerna:
#   otid_owner  äger tabellerna, kör migreringarna och backupen. Ingen superuser.
#   otid_app    webben (web, web-public, web-public2): läser och skriver data, kan inte ändra schemat eller skapa tabeller.
#   otid_print  utskriftsarbetaren: läser tävlingens namn och kartfil (race_map_source och innehållet i map_content och
#               map_content_part, ADR-0189) och skriver bara i utskriftskön.
# Superusern otid (POSTGRES_USER) finns kvar för det här skriptet och för underhåll för hand; ingen tjänst använder den sedan.
#
# Ingen data flyttas eller ändras: bara ägare och rättigheter. Allt sker i en transaktion; går något fel ändras inget.
# För test lokalt: OTID_PSQL="psql postgresql://otid:otid@127.0.0.1:5433/kopia" och OTID_ENV_FILE=<fil> (rollnamnen kan bytas
# med OTID_DB_OWNER_USER, OTID_DB_APP_USER och OTID_DB_PRINT_USER).
set -eu
command="${1:-}"
env_file="${OTID_ENV_FILE:-.env}"
compose="docker compose -f docker-compose.prod.yml"

value_of() { [ -f "$env_file" ] && sed -n "s/^$1=//p" "$env_file" | tail -n 1 || true; }
owner="${OTID_DB_OWNER_USER:-$(value_of OTID_DB_OWNER_USER)}"; owner="${owner:-otid_owner}"
app="${OTID_DB_APP_USER:-$(value_of OTID_DB_APP_USER)}"; app="${app:-otid_app}"
print="${OTID_DB_PRINT_USER:-$(value_of OTID_DB_PRINT_USER)}"; print="${print:-otid_print}"

psql_admin() {
  if [ -n "${OTID_PSQL:-}" ]; then
    # shellcheck disable=SC2086
    $OTID_PSQL -X -q -v ON_ERROR_STOP=1 "$@"
  else
    $compose exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U otid -d otid "$@"
  fi
}

case "$command" in
  setup)
    [ -f "$env_file" ] || { echo "Hittar inte $env_file (kör i repots rot)." >&2; exit 1; }
    for name in OWNER APP PRINT; do
      if [ -z "$(value_of "OTID_DB_${name}_PASSWORD")" ]; then
        printf 'OTID_DB_%s_PASSWORD=%s\n' "$name" "$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')" >> "$env_file"
        echo "Lösenord för $name lagt i $env_file."
      fi
    done
    for pair in "OWNER:$owner" "APP:$app" "PRINT:$print"; do
      name="${pair%%:*}"; role="${pair#*:}"
      [ -n "$(value_of "OTID_DB_${name}_USER")" ] || { printf 'OTID_DB_%s_USER=%s\n' "$name" "$role" >> "$env_file"; }
    done
    psql_admin -v owner="$owner" -v app="$app" -v print="$print" \
      -v owner_pw="$(value_of OTID_DB_OWNER_PASSWORD)" -v app_pw="$(value_of OTID_DB_APP_PASSWORD)" \
      -v print_pw="$(value_of OTID_DB_PRINT_PASSWORD)" <<'SQL'
BEGIN;
-- Rollerna (inloggning, ingen superuser, inga andra systemrättigheter). Finns de byts bara lösenordet.
SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY[:'owner', :'app', :'print']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'owner', :'owner_pw') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app', :'app_pw') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'print', :'print_pw') \gexec

-- Ägarrollen äger databasen, schemana och allt i dem (tabeller, vyer, fristående sekvenser, funktioner, typer). Tabellernas
-- egna sekvenser följer med tabellen. Tilläggens objekt (CREATE EXTENSION) behåller sin ägare.
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'owner') \gexec
SELECT format('ALTER SCHEMA %I OWNER TO %I', nspname, :'owner') FROM pg_namespace WHERE nspname IN ('public', 'drizzle') \gexec
SELECT format('ALTER %s %I.%I OWNER TO %I',
    CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
    n.nspname, c.relname, :'owner')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i', 'e'))
  ORDER BY c.relkind DESC, c.relname \gexec
SELECT format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, :'owner')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'drizzle')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') \gexec
SELECT format('ALTER %s %I.%I OWNER TO %I', CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, n.nspname, t.typname, :'owner')
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname IN ('public', 'drizzle') AND t.typtype IN ('e', 'd', 'r') AND t.typelem = 0
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e') \gexec

-- Webben: data, inte schemat. Sekvenserna för id och löpnummer. Nya tabeller från kommande migreringar får samma rättigheter.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I, %I', current_database(), :'app', :'print') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app", :"print";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app";

-- Utskriftsarbetaren: kön, tävlingens namn och kartfilen (scripts/print-worker.ts, course-setting-print.ts). Inget annat.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"print";
GRANT SELECT, UPDATE, DELETE ON course_setting_print_job TO :"print";
GRANT SELECT ON race, race_map_source TO :"print";
-- ADR-0189: kartfilens innehåll (migration 0044). Tabellerna finns inte före den migreringen.
SELECT format('GRANT SELECT ON %s TO %I', string_agg(quote_ident(c.relname), ', '), :'print')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('map_content', 'map_content_part') HAVING count(*) > 0 \gexec
COMMIT;
SQL
    echo "Klart: $owner äger databasen, $app och $print har sina rättigheter. Kör nu 'sh deploy/db-roles.sh check' och sedan"
    echo "'docker compose -f docker-compose.prod.yml up -d' så att tjänsterna byter till rollerna (docs/drift.md)."
    ;;
  check)
    psql_admin -v owner="$owner" -v app="$app" -v print="$print" <<'SQL'
\set QUIET on
\pset tuples_only on
\pset format unaligned
SELECT CASE WHEN count(*) = 3 THEN 'OK: rollerna finns och ingen är superuser' ELSE 'FEL: en roll saknas eller är superuser' END
  FROM pg_roles WHERE rolname IN (:'owner', :'app', :'print') AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb;
SELECT CASE WHEN count(*) = 0 THEN 'OK: ' || :'owner' || ' äger alla tabeller' ELSE 'FEL: ' || count(*) || ' tabeller har en annan ägare' END
  FROM pg_tables WHERE schemaname IN ('public', 'drizzle') AND tableowner <> :'owner';
SELECT CASE WHEN has_table_privilege(:'app', 'entry', 'SELECT,INSERT,UPDATE,DELETE') THEN 'OK: ' || :'app' || ' läser och skriver anmälda'
  ELSE 'FEL: ' || :'app' || ' når inte anmälda' END;
SELECT CASE WHEN has_schema_privilege(:'app', 'public', 'CREATE') THEN 'FEL: ' || :'app' || ' kan skapa tabeller'
  ELSE 'OK: ' || :'app' || ' kan inte ändra schemat' END;
SELECT CASE WHEN has_table_privilege(:'print', 'course_setting_print_job', 'SELECT,UPDATE') AND has_table_privilege(:'print', 'race_map_source', 'SELECT')
  AND (to_regclass('map_content_part') IS NULL OR (has_table_privilege(:'print', 'map_content', 'SELECT')
    AND has_table_privilege(:'print', 'map_content_part', 'SELECT')))
  AND NOT has_table_privilege(:'print', 'entry', 'SELECT') AND NOT has_table_privilege(:'print', 'user_account', 'SELECT')
  THEN 'OK: ' || :'print' || ' når bara utskriftskön, tävlingen och kartfilen' ELSE 'FEL: ' || :'print' || ' har fel rättigheter' END;
SELECT CASE WHEN count(*) = 0 THEN 'OK: ' || :'app' || ' når alla tabeller' ELSE 'FEL: ' || :'app' || ' saknar rättigheter på ' || string_agg(c.relname, ', ') END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT has_table_privilege(:'app', c.oid, 'SELECT,INSERT,UPDATE,DELETE');
SQL
    ;;
  rollback)
    psql_admin -v owner="$owner" -v app="$app" -v print="$print" <<'SQL'
BEGIN;
SELECT format('ALTER DATABASE %I OWNER TO otid', current_database()) \gexec
SELECT format('REASSIGN OWNED BY %I TO otid', :'owner') WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('DROP OWNED BY %I', r) FROM unnest(ARRAY[:'app', :'print', :'owner']) AS r
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
SELECT format('DROP ROLE %I', r) FROM unnest(ARRAY[:'app', :'print', :'owner']) AS r
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database()) \gexec
COMMIT;
SQL
    echo "Klart: superusern otid äger allt igen och rollerna är borttagna. Ta bort raderna OTID_DB_* ur $env_file om de finns kvar."
    ;;
  *)
    echo "Användning: sh deploy/db-roles.sh setup|check|rollback (docs/drift.md, Databasroller)" >&2
    exit 2
    ;;
esac
