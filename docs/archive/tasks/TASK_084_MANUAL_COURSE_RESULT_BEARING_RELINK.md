# TASK084: ny manuell banversion för klass med resultat

Påbörjad 2026-09-19 som B1:s fjärde avgränsade snitt.

## Användarvärde

En tävlingsadministratör kan rätta en manuell kontrollföljd även efter första resultatet utan att förlora eller skriva om historiska resultat. Systemet visar vilka deltagare som senare behöver bedömas individuellt.

## Arkitektur och avgränsning

- Följ ADR-0106; TASK083:s läsväg är aldrig skrivbevis.
- Endast en manuell Course/Class i samma race; IOF-objekt och korsande scope blockeras.
- Eget kandidatunderlag med canonical basis-hash binds till commit, snapshot, klassens aktuella banversion, entryversions-, resultat- och manuella beslutshuvuden.
- Writern skapar enbart CourseVersion N+1, CourseControl, klassomlänkning, snapshot +1 samt egen immutable requestjournal/audit.
- Gammal resultat-, beslut-, finaliserings-, export-, rådata- och stationshistorik ändras aldrig. Ingen auto- eller massomräkning.
- Befintlig individuell omräkning får användas senare med egen capability, granskning och idempotens.

## Berörda delar

- ADR-0106 och additiv migration0053 med restore-notering,
- contracts/database/application för kandidat, hash, requestjournal och writer,
- tunn MANAGE_RACE-route och kompakt svensk `/manage`-panel,
- riktade kontrakts-, PostgreSQL-, route- och browserprov,
- status, plan, funktionsmatris och AGENTS efter verifiering.

## Acceptans

1. En manuell resultatbärande klass får exakt en ny immutable banversion efter hash-bundet kandidatunderlag och explicit bekräftelse. Gamla revisionsrader och manuella beslut är byteidentiska.
2. Stale snapshot, entryversion, latest revision, manuellt beslut, ingest eller omräkning mellan kandidat och commit ger konflikt utan delwrite.
3. Exakt retry för samma aktör och intent returnerar samma kvittens; annan aktör, annat scope eller annat intent ger konflikt.
4. IOF/scope/auth/CSRF-fel, historisk CourseVersion-ändring och resultatmutation avvisas. Requestjournalen är immutable i PostgreSQL.
5. Gammal finalisering och Complete-XML ändras inte. Ny individuell omräkning efter lyckad omlänkning skapar nästa revision på den nya banversionen.
6. Browsern visar svensk konsekvens, ingen automatisk omräkning och 390 px utan horisontell scroll; tappat commitsvar återförsöks exakt.

## Riktad verifieringsplan

- kontraktstest för canonical hash, strikt request/receipt och ack,
- isolerat PostgreSQL-prov för happy path, replay, stale/concurrent ingest/recalculation/manual-decision, journal-/resultat-/finaliseringsimmutability samt IOF/scope,
- route-test för MANAGE_RACE/auth/CSRF/statusmappning,
- ett 390 px browserfall med verklig HTTP/PostgreSQL och tappat svar efter commit,
- berörd lint/typecheck och webbuild.

Ingen full regression, GPS, stafett eller riktig USB omfattas; testdatabasen är uttryckligen isolerad och syntetisk.

## Genomfört 2026-09-19

Migration0053, strikt kandidat-/request-/receipt-kontrakt, transaktionell
`MANAGE_RACE`-writer, immutable journal och audit är implementerade. `/manage`
har ett separat svenskt granskningsflöde som visar underlaget, kräver
konsekvensbekräftelse och återanvänder exakt request-id efter tappat svar.

Riktade kontroller passerade med `CI=true`: contracts lint/typecheck och 2/2
kontraktstester; database lint/typecheck; application lint/typecheck och 2/2
PostgreSQL-integrationstester; web lint/typecheck och route-svit 28/28; E2E
TypeScript/ESLint; Playwright TASK084 1/1 på riktig Next/HTTP och isolerad
PostgreSQL; samt web production build. Exakta tider och begränsningar finns i
`docs/status.md`.
