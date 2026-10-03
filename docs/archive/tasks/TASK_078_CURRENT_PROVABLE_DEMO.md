# TASK078: aktuell provbar demo med gemensam administration

Påbörjad 2026-09-19 som genomförandeplanens A2 efter slutförd TASK077.

## Användarvärde

En ny operatör ska kunna provisionera en isolerad syntetisk demo, öppna dagens
gemensamma administratörsvy, hitta en deltagare, förstå fri/minutstart, prova
ett klassbyte med faktisk platskontroll och därefter se ett syntetiskt
publikresultat utan att sammanfoga flera gamla guider.

## Arkitektur och avgränsning

- Följ ADR-0102 och återanvänd `demo:provision`, `MANAGE_RACE`, `/manage`,
  IOF-importen, simulatorn och den publika resultatsidan.
- Behåll tom-databasgrinden, atomisk transaktion, privat 0600-output och
  entimmescredentials från ADR-0057.
- Lägg till demo-specifika, versionskontrollerade EntryList-/StartList-fixtures;
  ändra inte de generella IOF-testfixturerna.
- En deltagare ska börja i `PUNCH`, en i `FIXED`; den fasta klassen ska visa
  verkligt deltagarantal och gräns 1/2.
- Ingen ny route, migration, capability, dependency, resultatregel eller
  produktionsdeployment. Ingen Eventor-nyckel, privat tävling, SPORTident-USB,
  GPS, stafett eller betalning ingår.

## Berörda delar

- `packages/application/src/provision-synthetic-demo.ts`
- `packages/contracts/src/demo-installation.ts`
- demo-specifika filer under `fixtures/iof/`
- befintliga kontrakts-/provisioneringsprov och `tests/e2e/task-007-demo.spec.ts`
- `docs/demo-provisioning.md`, `README.md`, arkitektur/status/funktionsmatris

## Acceptans

1. En ny tom `otid_demo_*`-databas provisioneras en gång med exakt fyra
   validerade privata roller, inklusive `MANAGE_RACE`; stdout är fortsatt
   hemlighetsfri och innehåller `/manage` samt `/results`.
2. Ada visas i fri start och Bo i minutstart med fast tid. D21 visar 1/2 och
   klassbyte kontrollerar samma serverkapacitet som produkten.
3. Samma administratör loggar in en gång, söker en deltagare och genomför ett
   klass-/starttidsbyte med granskning. Browseracceptansen återställer därefter
   demounderlaget innan syntetisk avläsning.
4. Simulatorns befintliga enhetsbundna credential ger ett publicerat syntetiskt
   resultat som kan läsas utan publik inloggning.
5. En kort aktuell guide beskriver start, roller, fri/minutstart, klassbyte,
   publikresultat, stopp och begränsningar utan utgångna hårdkodade credentials.

## Verifieringsplan

Uppdatera de befintliga demo-kontrakts- och PostgreSQL-proven och utöka det
enda TASK007-browserfallet. Kör berörda lint/typecheck/build. Kör ingen bred
workspace- eller äldre demosvit utöver dessa riktade kontroller.

## Licensbedömning

Endast repositoryägda syntetiska fixtures och befintlig O-Tid-kod används.
Ingen AGPL-kod, Livelox-data eller extern tävlingsdata ingår.

## Slutfört 2026-09-19

Den befintliga demoprovisioneringen använder nu demoegna IOF EntryList- och
StartList-fixtures. Ada börjar i H21/`PUNCH`, Bo i D21/`FIXED` med fast tid och
D21 får initial gräns 2. Det privata manifestet innehåller exakt fyra
entimmesroller, inklusive befintlig `MANAGE_RACE`; den hemlighetsfria
sammanfattningen innehåller `/manage` men inga credentials.

Det enda befintliga demobrowserfallet loggar in i gemensam administration,
söker Ada, visar D21 som 1/2, genomför ett granskat klass-/starttidsbyte och
återställer sedan Ada till H21 innan simulator, publikresultat,
offlineavprickning och skogslista provas. Ingen ny route, migration, capability,
dependency eller produktionspolicy tillkom.

Riktad verifiering: kontrakt 2/2, PostgreSQL-provisionering 5/5 och Playwright
1/1 passerade. Berörd lint, typecheck och build passerade. Full workspace-svit
kördes inte eftersom ändringen var avgränsad till befintlig demo och planen
uttryckligen föreskriver riktade kontroller.
