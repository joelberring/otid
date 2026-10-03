# TASK091: atomisk klassbunden explicit resultatomräkning

Påbörjad 2026-09-19 som nästa B4-snitt efter publik B3.

## Användarvärde

Efter en ändring som lämnat en klass med äldre resultat kan administratören
granska exakt vilka deltagare som har tekniskt redo, äldre underlag och räkna
om den uttryckligt valda gruppen i ett enda säkert beslut. Ingen deltagare ska
lämnas halvuppdaterad om nät, ny ingest eller en konflikt inträffar.

## Arkitektur och avgränsning

- Följ ADR-0109. En grupp är exakt en Class, 1–100 uttryckligt valda Entries
  och ett servervaliderat manifest; den är inte ”alla stale resultat i loppet”.
- Återanvänd `MANAGE_RACE`, men skapa en egen skyddad kandidat-/commitväg,
  append-only gruppjournal och atomic transaction. Anropa aldrig den
  individuella omräkningsrouten N gånger.
- Bara `READY`-Entries med senaste revision äldre än aktuell snapshot kan
  väljas. Kandidatvyn visar blockerade/aktuella Entries men har ingen
  skrivknapp för dem.
- Commit kontrollerar manifestet på nytt och appenderar en publicerad teknisk
  `EXPLICIT_RECALCULATION` per vald Entry, eller inget alls. Manuella beslut,
  äldre revisioner, rådata, finaliseringar och exporter ändras aldrig.
- Ingen automatisk omräkning, flerkass-selektion, ny resultatstatus, kart-,
  GPS-, rutt-, stafett- eller hårdvarufunktion införs.

## Berörda delar

- ADR-0109, domän-/arkitekturdokument och status,
- contracts för kandidatmanifest, request och immutable response,
- additiv database migration för gruppheader/items och restore-not,
- application för lås, hash, idempotens, atomisk revision/audit,
- skyddade adminroutes och avgränsad gransknings-/bekräftelseyta,
- riktade contract-, PostgreSQL-, route- och ett 390 px-browserfall.

## Acceptans

1. En Class-kandidat visar exakt readiness och manifesthash; bara 1–100
   uttryckliga READY-rader med äldre revision kan väljas.
2. Lyckad commit appenderar exakt en teknisk revision per vald Entry och en
   immutable gruppheader/items; ingen Entry/snapshot/raw/readout/assignment
   muteras.
3. Ingest, individuell omräkning, brickbyte, klass-/ban-/startändring eller
   revisionsändring mellan granskning och commit ger konflikt och noll delwrite.
4. Samma idempotensnyckel och exakt intent återger samma gruppresultat; ändrad
   actor, klass, urval eller manifest ger konflikt.
5. Manuella DSQ/DNS/DNF/approval/OOC/NT, gamla finaliseringar och Complete-XML
   förblir sanningsenliga och oförändrade; livepublik kan endast ändras genom
   de nya tekniska revisionerna.
6. Browsern kräver tydlig svensk granskning/bekräftelse, visar osäkert svar med
   exakt retry och fungerar på 390 px utan horisontell scroll.

## Verifieringsplan före implementation

Kör berörda contracts/database/application lint/typecheck, riktad
PostgreSQL/PostGIS-integration för all-or-nothing/retry/concurrency/manual-
provenance, route-test, E2E TypeScript/ESLint, ett enda isolerat
browserfall samt web build. Full regression ersätts inte, men körs inte för
detta avgränsade snitt utan ett konkret regressionsbelägg.

## Utförd riktad verifiering 2026-09-19

Migration0056 har applicerats mot en uttryckligen isolerad PostgreSQL17-databas.
Contracts lint/typecheck och 2/2 kontraktstest, database lint/typecheck,
application lint/typecheck och 2/2 PostgreSQL-integrationstest, web lint/
typecheck och 32/32 klient-/route-tester samt E2E TypeScript/ESLint passerade.
Ett Playwright-fall 1/1 kördes i 390 px mot riktig Next/HTTP och samma isolerade
databas: det verifierade READY-urval, manifestgranskning, avbrutet första svar,
exakt retry, en gruppheader med två items och exakt två nya tekniska revisioner.
Web production build passerade (4,0 s kompilering, 5,7 s TypeScript, 7/7
statiska sidor på 51 ms). Full workspace-, integrations- och browserregression
kördes avsiktligt inte.
