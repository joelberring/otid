# ADR-0002: PostgreSQL/PostGIS med Drizzle och SQL-migrationer

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

Serverbeteende, transaktioner och framtida geodata måste testas mot PostgreSQL.
Externa ID:n får inte vara primärnycklar och schemaändringar måste vara spårbara.

## Beslut

PostgreSQL 17 med PostGIS 3.6 används i Docker Compose. Drizzle används som SQL-nära
TypeScript-lager. Versionssatta SQL-migrationer är den auktoritativa
schemahistoriken; migrationen aktiverar `postgis` även om TASK 001 inte använder
geometri.

Versionsvalet justerades 2026-08-30 från PostgreSQL 16 till 17 innan godkända
integrationstester fanns. Orsaken var att den aktuella verifieringsmiljön och
PostGIS 3.6 distribuerar extensionen för PostgreSQL 17/18. Detta ändrar inte
databasteknik, schema eller domängränser.

## Konsekvenser

Integrationstester kräver en riktig PostgreSQL-instans och får inte falla tillbaka
till SQLite. Migrationer ska ha restore/rollback-notering. Destruktiva ändringar
ska senare följa expand/migrate/contract.
