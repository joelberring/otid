# TASK080: bricka och start direkt i administratörens deltagarlista

Påbörjad 2026-09-19 som nästa avgränsade A3-snitt efter TASK079.

## Användarvärde

Administratören ska kunna identifiera rätt deltagare och se den vanligaste
operativa informationen utan att först välja personen: klass, aktuell bricka
och om starten är fri eller tidsatt. En saknad fast tid eller flera aktiva
brickor ska synas som text, inte döljas som ett normalt läge.

## Arkitektur och avgränsning

- Återanvänd den redan validerade `EntryTransferCandidates`; ingen ny fråga.
- Startupplägg härleds endast från klassens `startRule`:
  - `PUNCH` visas som fri start/startstämpling, oavsett eventuellt stale
    `fixedStartTime` i klientminnet.
  - `FIXED` visas som minutstart och exakt fast tid i tävlingens tidszon, eller
    explicit `Ingen fast starttid`.
- Bricka visas med följande företräde:
  - `multipleActiveAssignments=true` → `Flera aktiva brickor – kontrollera`;
  - entydig `activeAssignment` → dess bricknummer;
  - annars → `Ingen aktiv bricka`.
- Befintliga textbadges för äldre resultat och hyrbricka behålls.
- Ingen ny route, DTO, kontraktsversion, mutation, migration, dependency eller
  generell tabellkomponent. Ingen SPORTident-USB, GPS, stafett eller betalning.

## Berörda delar

- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/components/race-administrator-workspace.module.css`
- `apps/web/src/i18n/race-administrator-sv.ts`
- befintligt browserfall i `tests/e2e/task-029-race-administrator.spec.ts`
- plan, funktionsmatris och status efter verifiering

## Acceptans

1. Deltagartabellen har synliga kolumnrubriker `Namn och klubb`, `Klass`,
   `Bricka` och `Start` med korrekta tabellsemantiska headers.
2. En entydig aktiv bricka, ingen aktiv bricka och flera aktiva brickor visas
   som tre skilda textlägen. Inget specifikt nummer väljs vid multipel konflikt.
3. `PUNCH` visas som fri start. `FIXED` visar minutstart samt tävlingstidszonens
   fasta tid eller explicit saknad tid.
4. Befintlig deltagarknapp, valdmarkering, sökning, filter, pagination och
   hyr-/äldre-resultatbadges fungerar oförändrat.
5. Tabellen använder fast layout och brytbar text utan horisontell sidscroll
   vid 390 px. Kritisk betydelse bärs inte av färg.

## Verifieringsplan

Utöka samma befintliga TASK029-browserfall med entydig/ingen/multipel bricka,
PUNCH, FIXED utan tid, FIXED med tid, valknapp och 390 px. Kör riktad E2E-
TypeScript/ESLint, web lint/typecheck/build och endast `--grep TASK080`.
Ingen server-/kontraktssvit behövs eftersom serverbeteende och DTO är orörda.

## Arkitektur- och licensbedömning

Ingen ADR behövs: detta är presentation av befintligt accepterat rosterunderlag.
Ingen extern kod, AGPL-kod eller extern produktdata används.

## Slutfört 2026-09-19

Deltagartabellen visar nu fyra semantiska kolumner: namn/klubb, klass, bricka
och start. Den skiljer entydig aktiv bricka, ingen aktiv bricka och flera aktiva
brickor. PUNCH visas alltid som fri start/startstämpling. FIXED visar minutstart
med full tid i tävlingens tidszon eller explicit saknad fast tid.

Den befintliga deltagarknappen, valstatusen och badges är oförändrade. Tabellen
har fast kolumnlayout, brytbar text och riktad 390 px-kontroll. Ingen serverkod,
route, DTO, mutation, migration eller dependency tillkom.

Riktad verifiering: web lint/typecheck, E2E-TypeScript/ESLint, Playwright
`--grep TASK080` och webbuild passerade. Ett separat befintligt 1366 px-fall
passerade därefter som A3-grind och verifierade klass/start, bricka och
namn/klubb med samma login.
