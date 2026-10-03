# ADR-0140: operativ backup använder tidsbegränsad versionsbevarande MinIO-replikering

- Status: Accepterad för TASK099:s skrivande backup-/restorekedja
- Datum: 2026-09-22

## Kontext

ADR-0115 kräver att en O-Tid-backup består av både PostgreSQL/PostGIS och de
exakta privata PM-objektversioner som databasens `pm_object_manifest` pekar
på. Vanlig S3-skrivning, `mc cp` och `mc mirror` kan inte användas: målet får
nya MinIO-`versionId` medan den återställda databasen har bevarat källans
version-ID.

ADR-0138/TASK133 har därefter visat, enbart med syntetiska data och den
pinnade MinIO-/mc-kombinationen, att server-till-server bucket-replikering
med `existing-objects` och explicit resync kan låta den vanliga PM-läsaren
läsa två historiska målversioner med källans oförändrade `versionId`, hash och
längd. Kompatibilitetsprovet valde uttryckligen inte någon driftmodell.

TASK134 ger redan ett skrivskyddat källbevis: när operatören har stoppat alla
O-Tid-writers läser den en sammanhängande migration-/PM-referensgrund och
verifierar varje exakt källobjekt före ett canonicalt, hemlighetsfritt
backupmanifest. Det saknas bara ett avgränsat beslut om hur den bevisade
objektvägen används operativt, dess konsistenspunkt och dess rollback.

## Beslut

TASK099 använder en **tidsbegränsad, operatörsstartad source-to-empty-target
MinIO-replikering** som sin enda objektbackupväg.

1. Operatören stoppar först alla O-Tid-writers och väntar ut pågående writes.
   Konsistenspunkten är hela intervallet från det bekräftade skrivstoppet tills
   backupen antingen har verifierats eller uttryckligen avbrutits. Befintligt
   `writeStopConfirmed` är ett avsiktligt operatörsintygande; detta snitt
   bygger inte en ny global maintenance-mode eller ett dolt skrivlås.
2. Under detta skrivstopp skapas en full PostgreSQL/PostGIS-dump i en privat
   backupkatalog. Dess identitet, SHA-256 och längd går in i TASK134:s
   befintliga preflight. Samma preflight läser migrationsidentitet,
   PM-referenser och varje källobjekt till det canonicala backupmanifestet.
3. Varje backup använder en **ny, tom, privat och versionerad MinIO-
   målmiljö**, med samma konfigurerade bucketnamn per `storeId` som källan.
   En separat privat `storeId` → källa/mål-konfiguration binds till just
   backup-id i processminnet och en privat återhämtningsfil; den ingår aldrig
   i backupmanifestet eller dess kvittens. Målet är bara backupens
   objektunderlag, inte en fortsatt driftsreplika och inte en delad destination
   för flera backup-id:n. Inga tidigare objekt, bucketpolicies eller O-Tid-data
   får finnas där.
4. Den betrodda privata backupkomponenten skapar en `existing-objects`-
   replikationsregel från varje källbucket, läser regelns target-ARN privat och
   startar explicit resync mot just det ARN:et. Endast den MinIO- och
   mc-version som TASK133 har provat får användas. Käll- och målcredentials
   kommer bara från separat privat driftkonfiguration/processmiljö; de får
   aldrig hamna i argv, manifest, kvittens, logg eller repository. Källbucket
   måste ha **noll befintliga bucket-replikeringsregler** före operationen;
   TASK099 samverkar aldrig med en annan replikering.
5. Backupen är inte redo förrän den vanliga PM-läsaren, konfigurerad mot
   målet, har läst **varje** manifestbunden objektversion med exakt `storeId`,
   key, `versionId`, SHA-256 och längd. Därefter binds dump- och
   objektbeviset till det befintliga hemlighetsfria manifestet. En lyckad
   kvittens innehåller bara backup-id, manifesthash och antal verifierade
   objekt.
6. En privat fil med läge 0600 skrivs före varje extern förändring. Före den
   första dumpen har den `DUMP_PENDING`, backup-id och uttryckligen ingen
   manifesthash, eftersom dumpen ännu inte kan ingå i källpreflightens
   canonicala manifest. Efter preflight håller varje status backup-id,
   manifesthash, operationens steg och logiska store-/regelunderlag men aldrig
   credentials. Replikeringsreglerna tas bort med den exakt pinnade
   klientens bucket-regelkommando och en ny privat listning måste visa noll
   regler innan operatören får återuppta O-Tid-writers. Om processen avbryts
   körs samma cleanup-läge med den privata konfigurationen innan writers
   återupptas. Misslyckad resync, objektläsning eller regelrensning ger ingen
   godkänd backup och lämnar källans tävlingsdata orörda. Operatören får
   avbryta och starta en helt ny backup; den ofullständiga privata målmiljön
   används aldrig som återställning.
7. Restore använder backupens redan fyllda privata MinIO-mål och återställer
   dumpen endast till en ny, tom PostgreSQL/PostGIS-miljö. Den konfigurerade
   PM-läsaren måste läsa manifestets historiska objektversioner från samma
   mål före den befintliga skrivskyddade historikverifieringen körs. Restore
   får inte översätta `storeId` eller `versionId`, skriva om manifest,
   skapa resultat eller ändra journaler.

## Konsekvenser

- Den första användbara återställningen blir en isolerad, installationstäckande
  backupkedja med en explicit och synlig operativ paus, inte kontinuerlig
  backup, failover, PITR eller hög tillgänglighet.
- Varje backup behöver en separat privat målinstans eller motsvarande ny tom
  isolerad målmiljö. Det är avsiktligt: blandade historiker kan inte förväxlas
  med en manifestbunden återställning. Den privata operationens state-fil gör
  avbruten regelrensning återupptagbar utan att lägga konfiguration i arkivet.
- Backupkomponenten får göra de begränsade privata objekt- och dumpwrites som
  detta beslut kräver, men `packages/domain`, resultatmotor, publika läsare,
  stationskö och externa adaptrar ändras inte.
- En restore kan fungera som ny central servermiljö först efter att operatören
  konfigurerat nya, separata credentials. Credentials, API-nycklar,
  master keys, sessionsdata och Androids lokala SQLite/outbox följer aldrig
  med i backupen.
- En annan MinIO-release, en lagringstjänst utan bevisad versionsbevarande
  replikering eller önskemål om fortlöpande replikering kräver nytt ADR och
  nytt isolerat kompatibilitetsprov.

## Förtydligande 2026-09-23: sista regelns cleanup i pinnad MinIO

TASK175:s isolerade syntetiska prov visade att den pinnade kombinationen inte
kan ta bort bucketens **enda** replikeringsregel med `mc replicate remove
--id`: servern avvisar då en konfiguration med noll regler. Den redan
beslutade tidsbegränsade replikeringsmodellen ändras inte. För en källa där
förhandskontrollen visade noll regler får den betrodda cleanupen i stället
köra pinnad `mc replicate remove --all --force` **endast** efter en ny läsning
som visar exakt en regel med operationens deterministiska ID, väntad
destination och `ExistingObjectReplication=Enabled`. Efter kommandot krävs
ännu en oberoende läsning som visar noll regler. Om en annan/ytterligare
regel syns görs ingen all-rensning och ingen kvittens ges. Misslyckad
regelrensning lämnar `CLEANUP_REQUIRED` och spärrar writer-release.

`--all --force` är här en kompatibilitetsväg för **hela den bevisat ensamma
ägda konfigurationen**, inte generell rätt att rensa en delad källa. Det
finns ingen atomisk jämför-och-ta-bort för bucketens regelkonfiguration i
denna väg; därför kräver produktionsanvändning dessutom ett separat bevis
för att andra administratörer/automationer inte kan ändra just denna
konfiguration under det skrivstoppade intervallet. Isolerade lokala prov
kan visa kommandots beteende men inte denna driftmässiga exklusivitet.

## Rollback och återställning

Om backupen misslyckas markeras den inte som redo. Källans databas och
objektlagring ändras inte; regelrensningen färdigställs medan writers fortsatt
är stoppade, eller så avbryts försöket enligt privat driftinstruktion innan
skrivningar återupptas. Felaktig eller ofullständig målkopia repareras aldrig
genom skrivning ovanpå en återställningsmiljö. Ett nytt försök använder ny tom
målmiljö och nytt backup-id. En lyckad backup återställs bara till ny tom
PostgreSQL/PostGIS- och MinIO-miljö enligt ADR-0115.

## Avvisade alternativ

- Ständig MinIO-replika i Compose eller en produktionsmiljö: skulle vara en
  ny driftarkitektur och HA-liknande ansvar utanför TASK099.
- Delning av en källbucket med befintliga replikeringsregler: kräver
  regelägarskap, prioritering och kraschåterhämtning som första restorebeviset
  inte kan avgöra säkert.
- `putObject`, `mc cp`, `mc mirror` eller hash-lika objekt med nya version-ID:
  bryter de lagrade PM-referensernas historik.
- Översättning av `pm_object_manifest` efter restore: ändrar bevarad data och
  kräver en egen domän-/migrationspolicy.
- En gemensam backupbucket för flera backup-id:n: gör en tom och exakt
  manifestbunden målmiljö omöjlig att bevisa.
- Backup utan uttryckligt skrivstopp: kan blanda PostgreSQL-grund och
  objektversioner från olika ögonblick.
