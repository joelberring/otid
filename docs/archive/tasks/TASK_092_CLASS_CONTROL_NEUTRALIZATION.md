# TASK092: neutralisera en kontrollförekomst för en klass

Slutförd 2026-09-19 efter TASK091. Följ ADR-0110.

## Användarvärde

En tävlingsadministratör kan dokumentera att exakt en felande kontrollförekomst
inte ska krävas för en klass, utan att skriva om banan eller låtsas att
deltagares råstämplingar har försvunnit.

## Avgränsning

- Endast en `MANAGE_RACE`-administratör, en aktuell Class, dess aktuella
  CourseVersion och exakt en `CourseControl` via sequence och kontrollkod.
- Ett immutable, idempotent beslut per class/course-version; preview och commit
  måste ha hashad aktuell grund och conflict vid stale underlag.
- Beslutet ökar snapshot men skapar ingen revision och räknar inte om någon
  deltagare. TASK091 används senare som separat, uttryckligt beslut.
- Resultatmotor, snapshot, revisionprovenans och relevanta split-/IOF-/
  finaliseringsprojektioner hanterar neutraliseringen explicit och fail-closed.
- Ingen global banändring, avkortad bana, fler neutraliseringar, återtagande,
  tidsrättning, GPS, kartor/rutter, stafett eller hårdvara.

## Acceptans

1. En vald kontrollförekomst neutraliseras för exakt en klass; samma kod i en
   annan sequence eller klass är fortsatt obligatorisk.
2. CourseVersion, CourseControl, rawdata, äldre ResultRevisioner, manuella
   beslut, finaliseringar och frysta XML-bytes förblir oförändrade.
3. En ny uttrycklig omräkning kan använda beslutet och har spårbar
   neutraliseringsprovenans; den fabricerar ingen tid eller kontrollstämpling.
4. Stale snapshot/klass/bana, ny relevant ingest/revision, annan actor eller
   ändrat retryintent konflikterar helt utan delwrite.
5. Svensk 390 px-adminvy visar kontrollkod och förekomst, tydlig varning om
   att gamla resultat inte räknas om automatiskt samt exakt retry.

## Verifieringsplan före implementation

Riktade domain-facit för en och upprepad kontrollkod; contracts-,
PostgreSQL-transaktions-, snapshot/evaluator-, revisionprovenans- och
IOF/finaliseringsprov; därefter route, ett 390 px browserfall och berörda
lint/typecheck/build. Full regression ersätts inte men ingen
produktions-/hårdvaruacceptans påstås.

## Verifierat

- Riktat domainfacit täcker en neutraliserad av två förekomster med samma kod.
- Kontrakt, stationpaket, snapshot och resultatmotor bär beslutet explicit.
- Det isolerade PostgreSQL-provet täcker immutable beslut, stale underlag,
  samma-id-retry, ny revisionsprovenans, Snapshot-XML och att ny finalisering
  blockeras med `INVALID_RESULT_REVISION` tills en senare fryst projektion finns.
- Ett 390 px browserprov täcker svensk tvåstegsgranskning och retry efter tappat
  svar. Fysisk mobil, produktion och hårdvara är inte verifierade.
