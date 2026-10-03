# TASK075: privat utskriftsvy för hyrbrickor

Påbörjad 2026-09-18 som nästa minsta vertikala snitt efter TASK074.

## Användarvärde

Tävlingsadministratören ska kunna skriva ut en kompakt privat arbetslista över
de deltagare som just nu har en entydig aktiv hyrbricka. Utskriften ska kunna
identifieras utan interna gissningar och visa tävling, lopp, genereringstid,
namn, klubb, klass och aktivt bricknummer.

## Arkitektur och avgränsning

- Utöka befintlig skyddad `transfer-candidates`-projektion additivt med
  `eventName`, `raceName` och servergenererad `generatedAt`.
- Återanvänd exakt `entry.activeAssignment?.isRental === true`; ingen separat
  hyrdatabasfråga eller klientinferens.
- En explicit print-target skiljer hyrbricksutskriften från befintlig
  skogsrapport så att endast avsedd privata lista syns i printmedia.
- Använd browserns `window.print()` och CSS printmedia. Ingen PDF-generator,
  fillagring eller serverrenderad rapport.
- Utskriften märks som privat personuppgiftslista och ska förvaras/förstöras
  säkert.
- Ingen betalning, avgift, återlämningsstatus, startlista, stationspaket,
  SPORTident-protokoll, GPS eller stafett ingår.

## Berörda delar

- `packages/contracts/src/entry-transfer.ts`
- `packages/application/src/entry-transfer.ts`
- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/components/race-administrator-workspace.module.css`
- `apps/web/src/i18n/race-administrator-sv.ts`
- befintliga riktade kontrakts- och TASK029-browserprov

## Acceptans

1. Rosterresponsen binder sann eventtitel, lopptitel och servergenereringstid.
2. Utskriftsknappen finns endast när minst en entydig aktiv hyrbricka finns.
3. Klick anropar `window.print()` utan nytt rosteranrop eller skrivning.
4. Printmedia visar bara hyrbricksrapporten med metadata, namn, klubb, klass
   och aktivt bricknummer; adminformulär och skogsrapport döljs.
5. Skärmmedia döljer printblocket.
6. Inaktiva, saknade och multipla assignments ger inga rader.

## Arkitektur- och licensbedömning

Ingen ny ADR behövs. Detta är en additiv read-projektion och presentation inom
ADR-0100:s befintliga racebundna modell och `MANAGE_RACE`-gräns. Ingen extern
kod eller AGPL-struktur används.

## Verifieringsplan

Kör riktade kontraktsprov, application/web lint och typecheck, E2E TypeScript/
lint, ett enda browserfall `TASK075` som fångar printanrop och emulerar
printmedia samt berörda builds. Ingen bred testsvit eller ny DB-integration.
