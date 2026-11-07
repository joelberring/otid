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

Översynen 2026-11-02 (ADR-0185 beslut 1): appen används publikt, så migrationer får inte längre ta bort eller skriva om
data i ett steg (se `AGENTS.md`). `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS …;` lyfts ut ur filen och körs före
filens transaktion; ett ogiltigt index från ett avbrutet bygge tas bort och byggs om (`splitConcurrentIndexes`).

## Ordning och nummer (städrundan 2026-11-07)

- **Journalens ordning är körordningen, inte numret.** Migratorn kör raderna i `meta/_journal.json` uppifrån och ned. Numret
  i filnamnet är bara ett namn: i dag står t.ex. 0059–0061 före 0047 och 0077 före 0076, eftersom de lades till i den ordningen.
  En rad som flyttas i journalen körs i den nya ordningen på en ny databas men aldrig om på en befintlig (bokföringen är per
  tagg), så två databaser kan få olika scheman. Flytta därför aldrig en befintlig rad.
- **En ny migration läggs alltid sist i journalen**, med nästa lediga nummer (högsta numret i mappen plus ett, eller numret
  som koordinatorn delat ut när flera grenar arbetar samtidigt), nästa `idx` och ett `when` som är större än alla andra.
  Krockar två grenar läggs den som slås ihop sist längst ned med `idx` omnumrerat; filnamnet ändras inte.
- **Tvåstegsregeln gäller utan undantag** (`AGENTS.md`, ADR-0185 beslut 1): först en migration som lägger till eller lättar
  (ny kolumn, nullbar kolumn, borttaget villkor) och en kodversion som klarar både det gamla och det nya, sedan i en senare
  driftsättning det som tar bort. Undantaget i 0079 (en engångsändring av data i ett steg, godtagen eftersom ingen driftsatt
  server hade 0076) är stängt och gäller inte nya migrationer.
- **Ett villkor som räknar upp värden som koden bestämmer** (som spärrens scope före 0087) skrivs inte som en lista i CHECK,
  eftersom varje nytt värde då kräver att hela listan kopieras: listan står i koden med ett test, och databasen kräver formen.
- `test/integration/schemadrift.test.ts` i application jämför Drizzle-schemat med databasen efter alla migrationer (kolumner,
  NULL och typ i grova drag). En kolumn eller tabell som medvetet bara finns i SQL skrivs in i testets undantagslista med skälet.
