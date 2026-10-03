# TASK076: journalförd återlämning av hyrbricka

Påbörjad 2026-09-18 som nästa minsta vertikala snitt efter TASK075.

## Användarvärde

Tävlingsadministratören ska kunna markera att den aktiva hyrbrickan har
återlämnats och rätta ett felaktigt beslut. Hyrbrickslistan och utskriften ska
därefter endast visa aktiva hyrbrickor som ännu inte registrerats återlämnade.

## Arkitektur och avgränsning

- Följ ADR-0101: statusen tillhör den konkreta `card_assignment`-raden.
- Lägg till additiv projection samt immutable, idempotent ändringsjournal.
- Återanvänd `MANAGE_RACE`, befintligt sessions-/CSRF-skydd, entryversion och
  race-snapshot.
- Behåll assignmenten aktiv och lämna bricknummer, raw data, readouts och
  resultat orörda.
- Exponera statusen i den befintliga skyddade rosterresponsen.
- Uppdatera gemensam adminvy, lokalt hyrfilter och privat utskrift.
- Ingen betalning, avgift, lagerhantering, fysisk skanning, SPORTident-USB,
  GPS eller stafett ingår.

## Berörda delar

- `packages/database` — additiv migration, projection och append-only journal
- `packages/contracts` — strict request/response och rosterfält
- `packages/application` — atomiskt exact-retry-kommando
- `apps/web` — route, klientåtgärd, status samt list-/printurval
- riktade kontrakts-, PostgreSQL- och ett befintligt browserfall

## Acceptans

1. Endast en entydig aktiv hyrassignment kan markeras återlämnad eller rättas.
2. Requesten binder aktuell assignment och optimistiska versioner; stale eller
   fel scope skriver ingenting.
3. Projection, immutable journal, audit, entryversion och race-snapshot
   committar atomiskt och samma retry ger samma kvittens.
4. Återlämning ändrar inte assignmentens `active`, bricknummer eller resultat.
5. Roster visar statusen; filter, total och print omfattar bara hyrbrickor som
   inte är registrerade återlämnade.
6. UI har tydlig granskning, tappat-svar/exakt-retry och rättningsväg.

## Verifieringsplan

Kör kontraktsprovet, ett avgränsat PostgreSQL-integrationsprov, berörda lint/
typecheck och ett enda `TASK076`-browserfall. Kör endast berörda builds efter
grön riktad verifiering; inga breda testsviter.

## Arkitektur- och licensbedömning

ADR-0101 är accepterad före implementation eftersom datamodellen utökas.
Ingen teknik, capability eller domängräns byts och ingen extern/AGPL-kod
används.

## Utfall 2026-09-18

Snittet är implementerat enligt acceptansen. Migration0050, strict kontrakt,
atomisk application-writer, skyddad route och den gemensamma adminvyn stödjer
både återlämning och explicit rättning. Assignmenten förblir aktiv; lista,
räknare och privat utskrift visar endast ej återlämnade hyrbrickor.

Verifierat med 5 kontraktstester, 2 PostgreSQL-integrationstester och ett
genomgående browserfall med tappat svar/exakt retry. Berörda lint, typecheck
och builds passerar. Se `docs/status.md` för exakta resultat och kvarvarande
antaganden.
