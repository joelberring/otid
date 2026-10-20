# Migrationer

`0000_baseline.sql` är hela schemat efter steg 23 (ADR-0173): de 106 tidigare migrationerna (0000–0105) och
borttagningen av tolv döda tabeller slogs ihop eftersom det inte finns någon produktionsdata (ADR-0168 beslut 6). Den skapar typerna, funktionerna
(bland dem resultatunderlagets hash och triggerfunktionerna som släpper igenom purge-flaggan `otid.purge`), tabellerna,
index, check-villkor och immutabilitetstriggers. En databas från de gamla migrationerna avvisas; skapa den
på nytt (`docs/drift.md`).

Nya schemaändringar läggs som nya filer `0001_…sql` och en rad i `meta/_journal.json`. `pnpm db:migrate`
committar nya enum-värden (`ALTER TYPE … ADD VALUE IF NOT EXISTS`) först och kör sedan varje fil i en egen
transaktion (`src/migrator.ts`).

Migratorn avgör vad som redan körts med `created_at` (journalens `when`), inte med filens innehåll. Därför kunde
`CREATE EXTENSION postgis` tas bort ur baslinjen i steg 28 utan att befintliga databaser påverkas; `0007_utan_postgis.sql`
tar bort tillägget där.
