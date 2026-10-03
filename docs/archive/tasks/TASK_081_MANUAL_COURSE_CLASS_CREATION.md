# TASK081: skapa en manuell bana och länkad klass

Påbörjad 2026-09-19 som första avgränsade B1-snitt efter slutförd etapp A.

## Användarvärde

En tävlingsadministratör ska kunna förbereda en enkel bana och en klass utan att
först skapa en IOF-fil. Kontrollernas ordning och eventuella upprepningar ska
vara synliga före sparande. Fri start och minutstart ska väljas uttryckligen.

## Arkitektur och avgränsning

- Följ ADR-0103.
- Återanvänd den befintliga racebundna `MANAGE_RACE`-sessionen.
- Skapa `Course`, version 1, ordnade `CourseControl` och länkad `Class` i en
  enda idempotent PostgreSQL-transaktion.
- Manuella objekt har ingen extern identitet och blandas inte ihop med IOF-
  importerade objekt.
- Höj race-snapshot exakt ett steg; ändra inga entries eller resultat.
- Lägg en immutable requestjournal och komplettera databasskyddet för
  `course_control`.
- UI ligger i befintlig `/admin/{raceId}/manage` och använder granska → bekräfta.
- Ingen banredigering, karta, GPS, stafett, XML-fabricering eller USB.

## Berörda delar

- `docs/adr/ADR-0103-manual-course-class-creation.md`
- additiv migration 0051 och `packages/database/src/schema.ts`
- nytt strikt kontrakt i `packages/contracts`
- ny applikationstjänst i `packages/application`
- tunn administrator-route i `apps/web`
- befintlig gemensam administratörskomponent och svensk text
- riktade kontrakts-, PostgreSQL- och browserprov
- `docs/status.md`, plan, funktionsmatris och migrationsnotering efter verifiering

## Acceptans

1. En giltig request skapar exakt en manuell bana, banversion 1, en ordnad
   kontrollrad per angiven kod och exakt en länkad klass. Dubblettkod bevaras.
2. Klassen får exakt valt `PUNCH` eller `FIXED`; inga entries eller starttider
   skapas och snapshot ökar exakt ett.
3. Exakt retry returnerar samma id:n utan write. Ändrad aktör/intent och stale
   snapshot ger konflikt med full rollback.
4. Manuella objekt saknar extern identitet. IOF CourseData före eller efter
   mutationen fortsätter fungera utan att skriva över dem.
5. Otillåten session, fel race/origin/CSRF och ogiltigt kontrakt avvisas.
6. Databasen avvisar update/delete på requestjournal och `course_control`.
7. Administratören kan granska namn, startupplägg och exakt kontrollordning utan
   write, sedan bekräfta med samma login och se att den nya klassen finns i
   arbetsytan.
8. Vid 390 px staplas formuläret och sidan får ingen horisontell scroll.

## Riktad verifieringsplan

- kontraktstest för strikt validering, 1–1 000 positiva kontrollkoder och
  bevarad dubblett/ordning,
- ett fokuserat PostgreSQL-integrationsprov för skapande, retry, konflikter,
  rollback, IOF-samexistens och immutabilitet,
- befintlig route-handlerenhetssvit utökad för auth/CSRF/statusmappning,
- ett browserfall i befintlig TASK029-konfiguration för granska, spara,
  uppdaterat rosterunderlag och 390 px,
- berörd lint/typecheck och webbuild.

Breda resultat-, hårdvaru-, GPS- och fulla browserregressioner körs inte när de
berörda gränserna redan täcks av ovanstående riktade kontroller.

## Arkitektur- och licensbedömning

ADR-0103 dokumenterar den nya beständiga skrivvägen, den gemensamma rollen,
versionssemantiken och importgränsen före kod. Ingen extern eller AGPL-licensierad
kod används.

## Slutfört 2026-09-19

Den gemensamma administratörsvyn kan nu granska och atomiskt skapa en manuell
bana, immutable version 1 med exakt kontrollordning samt en länkad klass med
explicit PUNCH/FIXED. Upprepade kontrollkoder bevaras. Exakt retry efter ett
tappat serversvar skapar inte dubbletter. IOF-identiteter och manuella objekt
hålls åtskilda.

Migration 0051 registrerar den immutable requestjournalen, dess scopebevis och
en saknad update/delete-barriär för `course_control`. Klienten skiljer ett
okänt mutationssvar från en bekräftad commit vars efterläsning misslyckas.

Riktad slutverifiering passerade: 2 kontraktstester, 25 route-handlerfall,
3 PostgreSQL-integrationsfall och 1 verkligt HTTP/PostgreSQL-browserfall.
Berörda paket passerade lint/typecheck och webbens produktionsbuild. Fulla
workspace-/browser-/hårdvarusviter kördes inte eftersom snittet har en egen
avgränsad acceptans och inte ändrar resultatmotor eller hårdvara. Exakta
kommandon och tider finns i `docs/status.md`.
