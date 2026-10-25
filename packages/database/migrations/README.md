# Migrationer

`0000_baseline.sql` är hela schemat efter steg 23 (ADR-0173): de 106 tidigare migrationerna (0000–0105) och
borttagningen av tolv döda tabeller slogs ihop eftersom det inte finns någon produktionsdata (ADR-0168 beslut 6). Den skapar typerna, funktionerna
(bland dem resultatunderlagets hash och triggerfunktionerna som släpper igenom purge-flaggan `otid.purge`), tabellerna,
index, check-villkor och immutabilitetstriggers. En databas från de gamla migrationerna avvisas; skapa den
på nytt (`docs/drift.md`).

Nya schemaändringar läggs som nya filer `0001_…sql` och en rad i `meta/_journal.json`. `pnpm db:migrate`
committar nya enum-värden (`ALTER TYPE … ADD VALUE IF NOT EXISTS`) först och kör sedan varje fil i en egen
transaktion (`src/migrator.ts`).

Migratorn bokför per migration (steg 44): varje journalrad som saknas i `drizzle.__drizzle_migrations` körs, i
journalordning, även om dess `when` är lägre än en redan körd (som när `drizzle-kit generate` sätter `when` till
dagens datum). En rad räknas som körd om tabellen har dess tagg (kolumnen `tag`, ny i steg 44), eller, för rader
från före steg 44, dess `when` i `created_at` eller dess hash; sådana rader får taggen ifylld vid nästa körning.
Filens innehåll avgör alltså inte ensamt. Därför kunde `CREATE EXTENSION postgis` tas bort ur baslinjen i steg 28
utan att befintliga databaser påverkas; `0007_utan_postgis.sql` tar bort tillägget där.

Journalen ska ha unika taggar och unika `when`, och `idx` ska vara 0..n i ordning (`test/migration-journal.test.ts`).
