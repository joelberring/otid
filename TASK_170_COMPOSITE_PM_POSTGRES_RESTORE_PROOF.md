# TASK170: syntetiskt gemensamt PM- och PostgreSQL-restorebevis

Status: syntetiskt kompatibilitetsverifierad 2026-09-23; ingen körbar
produktionsbackup eller fältacceptans.

## Användarutfall

Driftansvarig ska kunna se ett enda reproducerbart, syntetiskt delbevis för
att en återställd PostgreSQL/PostGIS-databas fortfarande pekar på **samma
historiska privata PM-version** som finns i ett separat, versionsbevarande
MinIO-mål. Den vanliga PM-läsaren ska läsa exakt `versionId`, byte-längd och
SHA-256 före applicationens läsande databashistorikbevis.

## Förutsättningar och beslutad gräns

- ADR-0140:s skrivstopp, tillfälliga `existing-objects`-replikering,
  explicita resync och regelrensning gäller. TASK133/137:s hashpinnade
  MinIO-/`mc`-kombination och TASK169:s `pg_dump -Fc`→`pg_restore` till ny
  tom databas återanvänds; ingen ny lagringsmetod väljs.
- Runnern skapar två **nya** privata MinIO-loopbackinstanser med tomma,
  versionerade buckets och syntetiska credentials samt två uttryckligen
  valda, tomma syntetiska PostgreSQL-databaser. Inga befintliga endpoints,
  buckets, demo-/tävlingsdatabaser eller användarfiler adopteras.
- Samma tuple `{storeId, key, versionId, sha256, byteLength}` skrivs i
  källans `pm_object_manifest`, ingår i manifestet och läses från MinIO-målet
  via `createOperationalBackupPmVerifier` efter replikering. Ingen `putObject`
  på målet, `mc cp`, `mc mirror` eller omskrivning av databasens version-ID.
- Databasmålet får inte migreras, seedas eller återanvändas efter restore.
  Samma färdiga privata dumpfil som mättes återställs med `pg_restore`.
- Credentials, URL:er och target-ARN stannar i privat processmiljö/0600-
  underlag och får inte förekomma i publik logg, argument eller kvittens.

## Minsta acceptans

1. Källans valda historiska PM-version finns i den aktuella käll-DB:ns
   manifest; en annan version under samma nyckel får inte tyst ersätta den.
2. Pinnad aktiv resync bevarar detta `versionId` i ett från början tomt
   MinIO-mål. Källregeln tas bort och en privat efterkontroll visar noll
   regler innan kvittens kan ges.
3. Efter faktisk dump/restore till nytt tomt PostgreSQL/PostGIS-mål läser
   `verifyOperationalRestore` PM-bytes genom vanliga mål-`createPmObjectStore`
   och `createOperationalBackupPmVerifier` **före** mål-DB-historiken.
   Bevarat event-/anmälans-ID och exakt PM-referens visas i målbeviset.
4. Saknad/fel historisk målversion, ändrad dump eller icke-tomt databasmål
   ger inget godkänt bevis. Källan och äldre lokala data lämnas orörda.

## Ingår inte

Produktions-CLI, automatisk miljöprovisionering, verkliga credentials,
faktiskt operativt skrivstopp, crash-recovery för replikationsregel,
återställning av fler än ett valt PM-objekt, produktions-TLS, komplett
arkiv/backup eller användartävling. Även ett grönt TASK170-prov är ett
syntetiskt kompatibilitetsbevis och gör inte D1b fältklar.

## Genomfört och verifierat 2026-09-23

`packages/infrastructure/test/pinned-minio-replication-fixture.ts` bevarar
TASK137:s pinnade två-MinIO-flöde och ger två smala testkrokar: vald
historisk källversion och vanlig käll-PM-läsare före regeländring, samt
vanligt målläsargränssnitt först efter resync, regelrensning och bekräftad
läsning av båda versionerna. Den
befintliga fristående runnern behåller sitt kommando och utfall.

`packages/infrastructure/test/run-composite-restore.ts` kräver ett uttryckligt
syntetiskt opt-in, två **nya tomma** loopbackdatabaser med samma suffix och
namnen `otid_task170_source_*`/`otid_task170_target_*`, en absolut katalog
med versionsmatchande PostgreSQL-verktyg samt de två redan pinnade
MinIO-/`mc`-binärerna. Varken `DATABASE_URL` eller befintlig MinIO-
konfiguration används som fallback. Samma verkliga historiska MinIO-`versionId`,
nyckel, SHA-256 och byte-längd skrivs i käll-DB:ns PM-journal innan resync.
Sedan kör TASK172:s source-only-ordning TASK140:s privata state,
TASK171:s riktiga dump och TASK134:s exakta källpreflight **före** regelstart.
TASK173:s läsande målpreflight kräver dessutom exakt tom, versionerad
MinIO-målmiljö och käll-/statebindning i samma testögonblick, fortfarande
före regelstart; målmiljön skapas enbart av den isolerade testfixturen.
Efter resync och bekräftad regelrensning återställer runnern samma uppmätta
0600-arkiv till tom mål-DB utan eftermigration/seed,
och kör `verifyOperationalRestore` med den **riktiga** målstorens
`createOperationalBackupPmVerifier` före läsande mål-DB-bevis. Bevarade
event-/anmälans-ID och PM-referens kontrolleras.

En opt-in-körning mot nya syntetiska PostgreSQL17/PostGIS-databaser och två
nya privata MinIO-loopbackinstanser gav **exit 0**. Inom samma körning
avvisades saknad historisk målversion, försök att välja den nyare versionen
i stället för databasens äldre, samt ändrad dumphash. En separat körning
med en enda markörtavla i ett nytt syntetiskt mål gav avsiktligt **exit 1**
med `TASK170_DATABASE_NOT_EMPTY`; efteråt var källan fortfarande tom och
målet innehöll bara markörtavlan. Infrastructure lint, typecheck och build
efter sista kodändringen gav alla exit 0. Två tidigare integrationsförsök
stoppade på testfixturens nyckelkoppling respektive ett extra fält till den
strikta dumpmätaren; de rättades innan den gröna körningen.
Den äldre fristående pinnade MinIO-runnern kördes också efter utbrytningen
och gav exit 0 med samma två historiska versioner och regelrensning.

Alla sex körningsunika TASK170-databaser från de tre sammansatta försöken
och två från det negativa guardprovet kontrollerades utan aktiva anslutningar,
togs bort och verifierades frånvarande. De nio privata MinIO-/mc-katalogerna
från de tre sammansatta försöken togs bort efter processkontroll; bara
syntetiska testobjekt/loggar fanns där och de kan inte återställas.
Ytterligare tre körningsunika kataloger från den fristående regressionen
togs bort efter samma kontroll. Den separata privata katalogen med de
hashverifierade pinnade binärerna finns kvar för senare opt-in-prov. Ingen
verklig tävling, credential, Eventortrafik,
Androidenhet eller fysisk station ingick.

Kvarstående antagande: `writeStopConfirmed` i detta helt ensamma syntetiska
testintyg är inte ett bevis för att en operatör kan stoppa verkliga writers.
Det finns ännu ingen återstartsbar privat backup-/restoreadapter, samordnad
produktionskvittens eller fysisk internet-/återställningsövning.
