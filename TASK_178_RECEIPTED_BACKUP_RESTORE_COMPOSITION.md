# TASK178: kvitterad syntetisk backup återställs i ny tom miljö

Status: syntetiskt verifierad 2026-09-23; inte operativt driftsatt. D1b.4e-snitt i
[produktmålplanen](docs/product-goal-roadmap-2026-09-23.md). ADR-0140 beslutar
restoreordningen; ADR-0159 beslutar TASK177:s kvittensgrind. Inget nytt
teknikval eller någon ny domängräns görs här.

## Avgränsat utfall

Det enda opt-in-provet kör först TASK177:s **fulla** managed capture med
hemlighetsfri kvittens och bevarar samma privata manifest, dump och bundna
MinIO-mål inom den betrodda testprocessen. Därefter återställs exakt den
uppmätta `pg_dump -Fc`-filen i en ny, bevisat tom PostgreSQL17/PostGIS-
databas. Befintlig läsande `verifyOperationalRestore` ska kontrollera samma
manifest mot den vanliga PM-målläsaren och den återställda DB-historiken.
En annan version på samma PM-nyckel får inte ersätta DB-referensen.

## Gränser och ordning

1. Endast explicit opt-in, två nyss skapade isolerade tomma lokala
   testdatabaser och hashpinnad MinIO/`mc`; inga implicita `DATABASE_URL`,
   befintliga mål eller verkliga credentials. Syntetisk källa migreras och
   seedas som i TASK170/177. Måldatabasen förblir tom tills restore börjar.
2. Full TASK177-capture ska ge exakt samma backup-id/hash/objektantal som
   det privata källbeviset. Läs mål-PM-versionen och mät dumpen mot manifestet
   även i restorefasen. Kvittensen ensam är inte ett restorebevis.
3. Kör `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`
   mot **bara** det explicita tomma målet med samma privata dumpväg. Ingen
   migration, seed, version-ID-översättning eller PM-skrivning efter restore.
4. Läs mål-DB:s PM-referenser och kräv exakt samma historiska tuple
   `{storeId,key,versionId,sha256,byteLength}` som källmanifestet. Kräv även
   bevarade syntetiska event-/anmälans-ID och befintligt läsande
   historikbevis. Den nyare PM-versionen på samma nyckel ska inte väljas.
5. Fel i tomhetsgrind, kvittensbindning, dump, målversion eller
   historikbevis ger inget lyckat restorepåstående. Städa endast de exakt
   namngivna egna testdatabaserna efter kontroll av noll anslutningar;
   bevara privata felartefakter för diagnos.

## Riktad acceptans

- En ny opt-in-variant av den befintliga sammansatta TASK170/177-runnern
  passerar med verklig syntetisk dump och privat versionsbevarande MinIO-mål.
- Negativa kontroller för icke-tomt DB-mål och fel/saknad historisk PM-version
  ska stoppa godkännande utan att ändra källhistoriken. Där befintliga
  TASK170-negativprov redan täcker samma verifierare återanvänds de; ingen
  duplicerad bred testsvit byggs.
- Berörd lint, typecheck och build samt ett riktat genomgående prov redovisas
  med exakta resultat. Ingen full workspace-svit för ett testägt snitt.

## Ingår inte

Produktions-CLI, automatisk restoreprovisionering, writer-release,
produktionsmässigt bevisat skrivstopp eller exklusiva replikeringsregler,
driftcredentials, fler stores, riktig tävling, Android/SPORTident, fysiskt
internetprov eller återställning av extern secret-/stationsdata.

## Verifierat utfall och kvarvarande antaganden

Den nya separata opt-in-varianten körde TASK177:s fulla managed capture och
hemlighetsfria kvittens, återställde exakt den uppmätta privata dumpen i ett
nytt tomt PostgreSQL17-mål och använde den befintliga läsande verifieraren
mot samma bundna MinIO-mål. Verifieringen kontrollerade manifesthash,
objektantal, den historiska DB-refererade PM-tuplen, historikantal och
syntetiska event-/anmälnings-ID. Källa och mål hade vardera en rad för
event, anmälan, PM-manifest, resultatrevision och finalisering. Opt-in gav
exit 0. De befintliga riktade restoreproven gav 11/11 application och 2/2
infrastructure; infrastructure lint/typecheck/build gav exit 0 och runnerns
ESLint gav exit 0. Befintliga TASK170-negativprov täcker icke-tomt mål,
saknad/fel version och manipulerat dumpbevis; de kördes inte om i detta
snitt. En felaktig extra TASK170-framgångsrad i TASK178-läget rättades
efter opt-in utan att ändra restorelogik.

Exakt två nyskapade isolerade syntetiska testdatabaser togs bort efter
kontroll av noll anslutningar och bekräftades frånvarande; deras bytes kan
inte återställas. Beviset gäller inte en betrodd produktionsåtgärd, verkligt
tekniskt skrivstopp, exklusiva källregler, återstartbar operatörskvittens,
fler stores eller fysisk fältacceptans.
