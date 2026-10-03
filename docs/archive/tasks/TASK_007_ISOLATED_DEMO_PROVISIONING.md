# TASK 007 – reproducerbar isolerad demonstrationsmiljö

Status: implementerat och verifierat avgränsat snitt, 2026-09-06. ADR-0057,
ren målpolicy, atomisk applikationsprovisionering, privat filadapter och CLI
har verkliga fil-/CLI-/PG-prov. Genomgående browserprov med CLI-provisionerade
roller och separat enhetsbunden station-CLI har passerat.
En lokal engångsdemo är igång enligt `docs/local-demo-20260906.md`; återanvändbar
provisionering beskrivs i docs/demo-provisioning.md. Detta ersätter inte V1:s återstående
SPORTident-, speaker-, dokument-/kartsläpps- och arkivfunktioner.

## Behov och gräns

Användaren ska kunna prova ett sammanhängande syntetiskt tävlingsflöde utan
manuell sammanfogning av testfixtures och många administrativa CLI-anrop.
Skapa en explicit utvecklings-CLI, aldrig en anonym produktionsroute.
Behåll nuvarande teknik och rollgränser; besluta säkerhetsgrindar i ADR innan
implementation. Ingen riktig API-nyckel, tävling, hårdvara, GPS eller stafett.

Berörda paket: application/test, contracts vid behov, betrott script och
dokumentation. Webbens produktionsautentisering ska inte kringgås.

## Acceptans

1. Explicit isoleringsval och verifierad tom testdatabas krävs före mutation;
   fel mål eller icke-tom databas avvisas. Migrering av befintlig tävling ingår inte.
2. Endast versionskontrollerade syntetiska fixtures används. Skapa ett nytt
   demo-event/lopp; fel får inte lämna halvprovisionerade tävlingsdata/credentials.
3. Minst-behöriga, kortlivade roller; hemligheter endast till avsiktligt privat
   output, aldrig i logg, URL, auditpayload eller hemlighetsfri sammanfattning.
4. Hemlighetsfri sammanfattning ger lopp-id och länkar samt klar åtskillnad
   mellan syntetisk demo och verklig SPORTident-funktion.
5. Riktig PostgreSQL provar fel miljö, icke-tomt mål, atomicitet och upprepad
   körning utan tyst dubblering. Browser/HTTP provar simulator → publikresultat
   och offlineavprickning → målpersonalens lista med provisionerade roller.
6. Dokumentera start/stopp, credentialexpiry och återstart utan radering.
   Kör lint, typecheck, relevanta tester och build; redovisa exakt evidens.

Målet är en provbar del av V1, inte att kalla hela O-Tid produktionsklart.

## Acceptansevidens

1–2: targetpolicy och task-007-demo.test.ts visar fel mål/icke-tomt avslag,
fasta syntetiska fixtures, nested rollback och endast en konkurrensvinnare.
3–4: privata filtester, demo-installation-kontrakt och verkligt CLI/PG-prov
visar0600, exklusiv output, exakt scopes/livslängd samt inga tokens i summary
eller audit. Tydligt osäkert commitutfall påstår inte gemensam fil/DB-atomicitet.
5: tests/e2e/task-007-demo.spec.ts genomför CLI → simulator → offentlig OK-rad
i oinloggad kontext samt annan deltagare offline → reload → synk → skogslista
och privat utskrift. Ingen testkod ersätter HTTP-ingest eller auth-beslut.
6: docs/demo-provisioning.md, AGENTS.md och slutresultat i docs/status.md.

Browserprovet upptäckte även en verklig regressionslucka i 006W: fragmentet i
checkin-länken hindrade offlinecachematch. Worker tar nu bort endast fragment
före exakt resursmatch; query/API/okända filer avvisas fortsatt. Tre shellprov
och hela demoflödet passerar efter rättningen. Produktionsdrift/fysisk mobil
är fortsatt utanför denna automatiserade acceptans.

## Senare aktuell utökning

TASK078 och ADR-0102 utökar den privata installationen med befintlig
`MANAGE_RACE`, en hemlighetsfri `/manage`-länk och demoegna fixtures för blandad
fri/minutstart. Den ursprungliga TASK007-arkitekturen, tomdatabasgrinden och
privata outputen är oförändrade. Aktuell körinstruktion finns i
`docs/demo-provisioning.md`.
