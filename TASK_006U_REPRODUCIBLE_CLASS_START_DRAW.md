# TASK 006U – enkel reproducerbar klasslottning

Status: Klar 2026-09-04. ADR-0045 accepterad före implementation. Domänplan,
kontrakt, transaktion, migration 0030, capability/CLI och webb är verifierade.

Ett sammanhängande vertikalt flöde: välj FIXED-klass, första start/intervall,
granska reproducerbar plan, bekräfta och spara hela klassen atomärt. Befintliga
resultat och publicerade listor ändras inte automatiskt.

## Berörda paket

Domain (ren plan), contracts (strikta DTO:n), application (auth/lås/preview/
idempotent skrivning), database (additiv journalmigration), web (svensk
granskning/bekräftelse/fel/retry) och CLI för separat capability.

## Acceptans

1. Deterministisk versionerad plan oberoende av inputordning, utan I/O eller
   mutation; UUID-, seed-, intervall-, roster- och tidsgränser verifieras.
2. Endast hela valda FIXED-klassen. Preview/read skriver inget. Alla tidigare
   tider och entryversioner binds till samma underlagshash.
3. Auth/Origin/CSRF/4 KiB, race- och klassisolering. Servern räknar om planen
   under lås; stale/overflow/tom roster/no-op ger konflikt utan writes.
4. Atomärt header/items/audit, endast ändrade entryversioner +1, snapshot +1.
   Retry återger samma kvittens, changed actor/intent konflikterar; concurrent
   register/klass-/tidsändring får aldrig ge en halv eller ofullständig plan.
5. Befintliga resultat, rådata, manuella beslut, publicerade listor och XML är
   orörda. Nytt stationspaket får nya tider utan förlust av gamla kvittenser.
6. Mobil granskning visar gamla/nya tider och seed; separat bekräftelse och
   samma-id-retry efter förlorat commitsvar. Inga credentials/intent i Web Storage.
7. Relevanta PostgreSQL-/E2E-tester samt lint/typecheck/test/build passerar innan
   uppgiften kallas klar. Ingen avancerad seedning, stafett, GPS eller USB ingår.

## Första fasens delverifiering (historik)

- Domain lint/typecheck/test: exit 0, 10 filer/151 tester.
- Contracts lint/typecheck/test: exit 0, 33 filer/204 tester.
- Ingen PostgreSQL-, E2E- eller helhetsbuild kördes i den första fasen; dessa
  genomfördes efter integration enligt nedan.

## Slutverifiering och användning

Root lint/typecheck/test/build exit 0; 180 testfiler/1 092 tester. PostgreSQL
4/4 på slutlig migration i ny tom databas. Mobil E2E 1/1 på 6,3 s. Tidigare
lint-/E2E-fel och exakta kommandon redovisas i docs/status.md.

Migrera med `pnpm db:migrate`. Utfärda racebunden behörighet:
`pnpm class:start:draw:access:issue --race-id <uuid> --label <text> --expires-at <ISO>`.
Öppna `/admin/<raceId>/class-start-draw` via tävlingsöversikten. Välj klass,
första start med datum/offset och intervall; granska hela planen och bekräfta.
Spärra med `pnpm class:start:draw:access:revoke --credential-id <uuid>`.
Omräkning och ny publicering görs separat. Ingen fältdrift/maxlast/backuprestore
påstås verifierad av detta snitt.
