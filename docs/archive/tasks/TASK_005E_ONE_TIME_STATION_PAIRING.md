# TASK 005E – kortlivad engångsparning för station

## Syfte

Ersätt TASK 005D:s manuella credentialinstallation med ett verkligt, säkert
parningsflöde. En betrodd operatör utfärdar ett kortlivat engångsgrant för ett
bestämt lopp och funktionen `READOUT`. Androidstationen löser in grantet och
installerar en device-bunden credential utan att credentialens plaintext-secret
någonsin lämnar native lagret eller lagras på servern.

Detta är nästa avgränsade vertikala snitt efter TASK 005D. Det omfattar inte
arrangörsinloggning, QR-rendering eller kamera, generell rolladministration,
SPORTidentprotokoll, riktig USB, stafett, GPS eller senare tävlingsfunktioner.

## Berörda paket

- `packages/database`: additiva grant-, revocation-, attempt- och
  redemptiontabeller.
- `packages/contracts`: exakt request-/responsekontrakt för inlösen.
- `packages/application`: utfärdning, spärrning, rate limit och transaktionell
  inlösen till befintlig stationscredential.
- `apps/web`: publik men hårt avgränsad pairing-route med generiska privata
  felsvar.
- `apps/station`: operatörsflöde för ny respektive återupptagen parning.
- `apps/station/android/otid-station-store`: krypterat pendingförsök, native
  secretgenerering, inlösen och atomisk credentialinstallation.
- `scripts`: betrodd CLI för att utfärda och spärra grant tills
  arrangörsautentisering byggs separat.
- `docs`: arkitektur, offline-/retryregler, acceptans och status.

## Avgränsat flöde

1. En betrodd CLI utfärdar ett grant för exakt lopp och `READOUT`, med högst
   15 minuters giltighet och en angiven utgångstid för den credential som ska
   skapas. Credentialens utgångstid måste ligga efter hela grantfönstret.
   Plaintext-grantet visas exakt en gång.
2. Grantformatet är `otid_pair_v1.<grant-id>.<secret>`, där secret är 32
   kryptografiskt slumpade bytes. Databasen lagrar bara SHA-256-hashen.
3. Operatören klistrar grantet i stationen. Strängen är QR-redo men TASK 005E
   renderar eller skannar inte QR. Den gamla publika manualinstallationen av en
   komplett credential tas bort ur plugin och stations-UI.
4. Native `begin` skapar 32 slumpbytes via `SecureRandom` för den framtida
   credentialen och ett `attemptId`. Grant, secret, attempt, bas-URL och
   starttid krypteras med Android Keystore och skrivs atomiskt i
   `noBackupFilesDir` innan anropet returnerar. Först ett separat `redeem` får
   öppna nätverk.
5. Native skickar exakt `attemptId`, stationens befintliga `deviceId` och
   SHA-256 över credential-secret till pairing-routen, med grantet som bearer
   och `Idempotency-Key: pairing:<attemptId>`.
6. Servern låser grantet och genomför validering, rate limit, skapande av
   station/device-credential, redemption och audit i en PostgreSQL-transaktion.
7. Svaret innehåller credential-id och publik metadata men aldrig någon secret.
   Native bygger token lokalt, installerar den i befintligt credentialvalv och
   ersätter först därefter pendinghemligheterna atomiskt med en icke-hemlig
   completed-markör.
8. Om svaret tappas eller processen dör återanvänder native exakt samma
   attempt, device och hash. Servern returnerar samma metadata utan att skapa
   en ny credential. Ett annat försök kan aldrig använda samma grant.

## Beständighet och migration

- Migration `0003` är additiv och skapar `station_pairing_grant`,
  `station_pairing_grant_revocation`, `station_pairing_attempt` och
  `station_pairing_redemption`.
- Grant, revocation, attempt och redemption är append-only. Ett unikt grant-id i
  redemptiontabellen är engångsbarriären; ett unikt `attemptId` binder retry.
- Credentialen fortsätter använda TASK 005D:s append-only generationer. Ny
  parning för samma device/lopp skapar nästa generation och spärrar inte en äldre
  credential automatiskt.
- Attemptloggen lagrar utfall, grant-id och tid. Attempt-id och device-id finns
  endast när grantet autentiserats och bodyn därefter validerats; fälten är
  annars null. Den lagrar aldrig grant-secret, presenterad token,
  credential-secret eller dess hash.
- Androids SQLite-schema ändras inte. Pendingförsöket ligger i en separat
  Keystore-krypterad AtomicFile och ingår inte i backup eller device transfer.
- PostgreSQL-rollback är verifierad backup och roll-forward; migrationen får
  ingen automatisk destruktiv `DROP`.

## Säkerhets- och kontraktsgräns

- Grantets maximala livslängd är 15 minuter och dess secret har 256 bitars
  entropi. Utgången eller spärrad grant kan inte skapa en credential.
- Fem felaktiga försök mot samma känt grant inom tio minuter ger `429` och
  `Retry-After`. Räknaren är PostgreSQL-baserad och serialiseras med grantlåset;
  ingen processlokal räknare framställs som produktionssäker.
- De fem append-only felraderna är själva blockbeviset. Ytterligare requests
  under spärrfönstret ger read-only `429` och får inte skapa obegränsad
  attemptlogg. En exakt autentiserad replay av en redan committad redemption
  förblir tillåten och är också read-only eftersom den aldrig kan skapa ny
  behörighet. Den ursprungliga success-attempten och redemptionraden är dess
  auditbevis.
- Syntaktiskt trasiga eller okända grant-id:n avvisas utan databasmutation.
  Infrastrukturens generella DoS-skydd ligger utanför detta snitt; headers från
  obetrodd proxy används inte som klientidentitet.
- Grantsecret jämförs constant-time mot en exakt 32-byte-hash. Okänt id går
  genom dummyhashvägen.
- Auth och rate limit sker före requestbodyparsning när grantet inte kan
  autentiseras. Alla `401`, `409` och `429` är generiska, `no-store` och läcker
  inte lopp-, device-, grant- eller credentialmetadata.
- Idempotent replay är endast tillåten för exakt samma autentiserade grant,
  `attemptId`, device-id och credentialhash. Den returnerar ingen secret och är
  användbar tills den skapade credentialen går ut.
- Endast HTTPS tillåts, med samma explicita localhost/127.0.0.1-undantag som
  övriga native stationsanrop. Redirect följs inte.
- Pairingtoken och pending credential-secret får inte lagras i SQLite,
  Web Storage, logg eller audit och får inte returneras av pluginstatus.
- `beginDevicePairing` får inte öppna nätverk. `redeemDevicePairing` använder
  endast redan beständig pendingstate; caller får inte skicka secret, hash eller
  grant en gång till.
- Explicit discard kräver expected attempt-id. Ett oläsbart kuvert får endast
  rensas genom en separat, uttrycklig operatörsåtgärd eftersom servercommit kan
  vara okänd.

## Acceptans

- Ett giltigt grant skapar exakt en device-bunden credential och en redemption.
- Hundra samtidiga identiska inlösningar skapar en credential och returnerar
  samma metadata; konkurrerande annat attempt kan inte ta över grantet.
- Tappat svar och processdöd efter servercommit kan återupptas med samma
  attempt utan ny credential eller förlorad secret.
- Utgånget, spärrat, felaktigt eller redan inlöst grant ger generiskt negativt
  svar utan credential- eller rawdatamutation.
- Fem felaktiga försök utlöser PostgreSQL-baserad rate limit; tidsfönstrets
  utgång återöppnar endast ett ännu giltigt och oinlöst grant.
- Grant-, revocation-, attempt-, redemption-, credential- och auditspår är
  append-only och innehåller inga plaintexthemligheter.
- Native pendingstate överlever reopen, är krypterad och manipulationsskyddad,
  men kan inte läsas via plugin-API.
- Credential installeras före pendinghemligheter ersätts av completed-markör.
  Fel i HTTP, svarstolkning, credentialinstallation eller markörskrivning ändrar
  aldrig SQLite-outbox.
- UI visar parning krävs, parning pågår, återuppta och lyckad parning med text
  och symbol utan färgberoende.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, webb-E2E-, Android JVM-,
  Android lint- och buildgrindar körs. Keystore/instrumentering redovisas som
  runtime-körd eller endast kompilerad.

Se ADR-0015.
