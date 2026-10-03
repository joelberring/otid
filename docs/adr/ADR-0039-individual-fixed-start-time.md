# ADR-0039: Individuell fast starttid med separat explicit omräkning

- Status: Accepterad
- Datum: 2026-09-04

## Kontext

TASK 006O behöver låta arrangören rätta en individuell fast starttid. Befintlig
StartList-import ändrar startkonfiguration medan `RECALCULATE_RESULT` räknar om
en vald entry genom en ny revision (ADR-0025). Samma arbetsflöde räcker här.

## Beslut

- En separat racebunden `CHANGE_ENTRY_START_TIME` får ändra endast
  `Entry.fixedStartTime` i en befintlig `FIXED`-klass. Klass, startregel,
  måltid och råavläsning ändras inte. Saknad fast starttid får sättas, men
  radering till null och ändring i `PUNCH`-klass avvisas.
- Requesten fryser entryversion, klass, snapshotversion och tidigare starttid.
  Tid kräver datum, sekunder och explicit UTC-offset (högst ±14:00), högst
  millisekundprecision, och normaliseras till UTC före jämförelse/journalföring.
  Ingen lokal tidszon gissas och dygnsöverskridande tillåts.
- En verklig ändring ökar entryversion och racesnapshot med ett. Samma tid,
  stale grund, fel race/klass och versionsoverflow ger konflikt utan writes.
- Låsordningen är session → credential → race UPDATE → request advisory →
  entry UPDATE. Mutation, immutable requestjournal och actor-audit är atomära.
  Samma request-id/actor/normaliserade intent återger det ursprungliga svaret,
  även efter senare ändringar; ändrat intent eller actor ger konflikt.
- Ingen automatisk omräkning sker vid sparandet. UI visar uttryckligen att
  befintligt resultat är oförändrat och länkar till befintlig omräkningsvy.
  Operatören bekräftar där entry och aktuell beräkningsgrund med separat
  `RECALCULATE_RESULT`. Resultatet appenderas som `EXPLICIT_RECALCULATION`.
  Befintliga manuella beslut behåller sin livscykel över senare teknik.
- Gamla stationpaket och lokal kö bevaras. Nästa signerade paket innehåller
  den nya starttiden/snapshotversionen. Gammal köad ingest accepteras enligt
  befintlig idempotens och returnerar paketstatus `stale`.
- Befintlig finalisering blir inaktuell genom snapshotändringen; redan
  finaliserad XML/hash bevaras. Publik och Snapshot använder senaste
  publicerade resultat tills explicit omräkning eller ny ingest tillkommer.
- Eget credentialprefix `otid_org_entry_start_time_v1`, egna host-only cookies,
  högst åtta timmars access/en timmes session, Origin/CSRF före mutationens
  body, strikt JSON högst 4 KiB. UI håller intent endast i minnet och har
  bekräftelse samt explicit same-id-retry efter okänt svar.
- Migration 0024 inför capability, actor kind och immutable
  `entry_start_time_change_request`. Inga nya resultatstatusar, revisionsorsaker,
  publika format eller motorregler behövs. Inga dependencies tillkommer.

## Alternativ och konsekvenser

Ett kombinerat spara-och-omräkna-kommando skulle kräva att starttidsrätten även
omfattar resultatmutation och readoutval. Den befintliga tvådelade processen
bevarar capabilityseparationen och fungerar även före första avläsningen.
Operatören måste därför uttryckligen genomföra det andra steget när ett
befintligt resultat ska uppdateras.

## Migration och återställning

0024 är additiv. Vid incident stängs den nya ytan av eller en additiv rättning
driftsätts. Journaler och enumvärden raderas inte; återgång till äldre schema
kräver verifierad backuprestore. Tidigare starttid finns i journalen och kan
rättas med en ny versionsbunden request.

## Avgränsning

Ingen fri resultattid, ändrad klassregel, lottning, kontrollneutralisering,
Eventor, stafett, GPS, parser eller riktig USB. Ingen extern kod används.
