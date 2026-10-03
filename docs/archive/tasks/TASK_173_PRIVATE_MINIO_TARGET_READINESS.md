# TASK173: privat MinIO-målpreflight före replikering

Status: implementerad och syntetiskt verifierad 2026-09-23; inte operativ backup.

## Användarutfall

En betrodd backupåtgärd ska kunna vägra starta MinIO-replikering om dess
uttryckligen förberedda mål inte är den avsedda, tomma och versionerade
miljön för just backup-id:t. Ett grönt svar är endast ett tidsbundet
**målberedskapsbevis**, inte en backup- eller restorekvittens.

## Beslutad gräns

ADR-0140 kräver ett nytt, privat och tomt MinIO-mål med samma bucketnamn
per `storeId` som källan. TASK172 stannar på `TARGET_PREPARATION_PENDING`
innan någon målport anropas. TASK173 är en läsande infrastructure-port
för det steget; ingen ny teknik, domängräns eller ADR behövs. En tom SDK-
listing bevisar inte att en server är ny. Därför kräver porten ett explicit
privat operatörsintyg om färsk, exklusiv målprovisionering samt ett av
operatören angivet mål-id bundet till backup-id; en senare betrodd provisionerings-/recovery-
adapter måste faktiskt styrka och bevara den bindningen före drift.

## Avgränsat snitt

- Indata är TASK172:s diskriminerade källbevis, den **faktiskt lästa** privata
  `TARGET_PREPARATION_PENDING`-statusen, backup-id och explicit privat
  `storeId`→käll-/mål-bucketkonfiguration. Exakt samma store-id:n, bucketnamn
  och manifesthash krävs; inga extra, saknade eller dubbla rader godtas.
- En explicit MinIO 8.0.7-klientkonfiguration byggs från betrodd processdata.
  HTTPS krävs utom `127.0.0.1` i icke-produktionsläge. Källa och mål får
  inte vara samma canonicala endpoint. URL/credential/ARN lagras aldrig i
  manifest, operation-state, fel, konsol eller resultat.
- Read-only SDK-kontroller kräver exakt de förväntade bucketsen och inga
  andra, `Status: Enabled`, ingen policy eller replikeringsregel, inga
  aktuella objekt, **inga historiska versioner/delete markers** och inga
  ofullständiga multipart uploads. Endast SDK:ns exakta
  `NoSuchBucketPolicy` respektive `ReplicationConfigurationNotFoundError`
  betyder avsaknad. Alla andra fel, timeout och tvetydigt svar avvisas.
- Inget anrop får skapa eller ändra bucket/versionering/policy/regel,
  starta resync, radera data eller utfärda kvittens. Om ett redan förberett
  mål inte uppfyller kraven måste operatören kasta det och välja ett nytt.

## Acceptans

1. Fel källbevis, backup-id, manifesthash, statefas, färskhetsintyg,
   ogiltigt mål-id eller store-/bucketbindning avvisas före MinIO-I/O.
2. Verklig ny privat versionerad loopback-MinIO med syntetisk credential
   passerar mot samma TASK172-källbevis **före** TASK170:s regelstart.
3. Aktuellt objekt, äldre dold version, delete marker, incomplete upload,
   avstängd/suspenderad versionering, policy, regel eller extra bucket ger
   inget målberedskapsbevis. SDK-/behörighets-/nätfel behandlas aldrig som
   tomt mål. Stubbtester räcker för negativa varianter; en riktig pinnad
   MinIO-körning krävs för det positiva kompatibilitetsbeviset.
4. Resultatet har egen `TARGET_READY_EVIDENCE`-diskriminant och endast
   backup-id, manifesthash, target-id och sorterade store-id:n. Det får
   inte kunna misstas för backupkvittens eller bäras i publik projektion.
5. Riktad lint, typecheck, små tester och build för berörda paket; ingen
   bred workspace-svit, riktig tävling eller produktionscredential.

## Ingår inte

Provisionering av MinIO-instans/buckets, faktisk kontroll av operatörens
färskhetsintyg, återstartsbar privat source/target-konfigurationsfil,
replikeringsregel, resync, cleanup, restore, backupkvittens, produktions-TLS-
drift, Eventor, GPS, SPORTident/USB eller fältacceptans. Ett positivt
punkt-i-tid-prov hindrar inte senare writes till målet; exklusivt
operatörsägarskap och ny kontroll vid regelstart hör till följande snitt.

## Utfall och verifiering

`packages/infrastructure` har nu en read-only MinIO 8.0.7-port som strikt
binder TASK172:s `SOURCE_CAPTURE_EVIDENCE`, den faktiskt lästa privata
`TARGET_PREPARATION_PENDING`-raden, backup-id/hash/store-id:n, ett separat
operatörsintyg om nytt/exklusivt mål och en enda explicit målendpoint.
Käll- och målbucket måste vara samma per store-id; målet får inte vara
källendpointen. Porten kontrollerar exakt bucketset, aktiv versionering,
frånvaro av policy/replikeringsregel, aktuella objekt, historiska versioner/
delete markers och ofullständiga multipart uploads. Endast ett
`TARGET_READY_EVIDENCE` utan endpoint/credential lämnas. Ingen bucket,
regel, policy eller objekt ändras av porten.

Riktat infrastructure-stubbprov: **4/4** tester, inklusive felaktiga
bindningar, dolda äldre versioner/delete markers, policy/regler, multipart
och tvetydiga SDK-fel. Lint, typecheck och build gav var för sig exit 0.
TASK170:s opt-in-runner anropar nu porten **före** regelstart mot en ny
hashpinnad lokal MinIO-målinstans och fortsätter därefter samma syntetiska
PostgreSQL/PM-restore; slutkörning exit 0. Två exakt skapade syntetiska
testdatabaser och tre körningsunika privata MinIO-/mc-kataloger kontrollerades
utan anslutningar/processer, togs bort och verifierades frånvarande. Dessa
testdata kan inte återställas. Ingen produktionscredential, verklig
tävling eller Eventortrafik användes.

Kvarstående gräns: färskhet/exklusivitet är ännu ett operatörsintyg, inte
ett automatiskt bevis om MinIO-serverns livstid eller att det angivna
mål-id:t faktiskt tillhör endpointen, och inte ett lås mot senare
writes. De negativa historiska versionsfallen har stubbtäckning men inte ett
eget verkligt MinIO-prov. Privat provisionering och återstartsbar bindning
av target-id/config, ny kontroll vid regelstart, resync, cleanup och
backupkvittens är efterföljande D1b.4-delar.
