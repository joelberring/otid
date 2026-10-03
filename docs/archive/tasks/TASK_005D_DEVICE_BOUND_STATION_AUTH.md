# TASK 005D – device-bunden autentisering för stationsingest

## Syfte

Stäng den öppna ingestytan från TASK 005C utan att låtsas att arrangörsinloggning
eller QR-parning redan finns. En utfärdad credential ska endast kunna skicka
readout-data för exakt ett lopp och exakt den beständiga stationidentitet den
utfärdades till. Ett autentiseringsfel får aldrig ändra eller radera stationens
lokala outbox.

Detta är nästa minsta vertikala snitt efter TASK 005C. Det omfattar inte
engångs-/QR-parning, allmän arrangörsautentisering, SPORTidentprotokoll, riktig
USB, stafett, GPS eller fler-event-batchoptimering.

## Berörda paket

- `packages/database`: additiv credential-, revocation- och auditmodell.
- `packages/application`: utfärdning, rotation, spärrning och server-only
  verifiering av device-/race-/funktionsscope.
- `apps/web`: autentiseringsbarriär före ingest och samma credential för privat
  stationspakethämtning.
- `apps/station`: Keystore-krypterad credential, native autentiserad request och
  operativ autentiseringsstatus.
- `scripts`: betrodd operatörs-CLI för utfärdning, rotation och spärrning tills
  ett separat parningsflöde finns.
- `docs`: arkitektur, offlineprotokoll, acceptans och verifieringsstatus.

## Avgränsat flöde

1. En betrodd serveroperatör utfärdar en högentropisk, tidsbegränsad credential
   för ett känt `deviceId`, ett lopp och funktionen `READOUT`.
2. Servern visar plaintext-token exakt vid utfärdning/rotation och sparar endast
   dess SHA-256-hash samt ett publikt credential-id och scope-metadata.
3. Operatören installerar token manuellt i Androidstationen. Native kod binder
   metadata till stationens befintliga `deviceId`, krypterar credentialen med en
   icke-exporterbar Android Keystore-nyckel och skriver kuvertet atomiskt i
   `noBackupFilesDir`.
4. Stationssynk skickar requesten från native kod. Native kod validerar bas-URL
   och den tillåtna lopp-routen och injicerar bearer-headern utan att lämna
   token till WebView efter installation.
5. Servern verifierar credentialen innan ingest. Path-lopp, `READOUT` och
   body-`deviceId` måste alla motsvara credentialen.
6. Saknad, trasig, okänd, felaktig, utgången eller spärrad credential ger ett
   generiskt `401`-svar. En giltig credential i fel race-/device-/funktionsscope
   ger generiskt `403`. Varken svar får skapa rawdata eller ändra outbox.
7. Rotation skapar en ny generation. Den gamla credentialen förblir giltig tills
   den nya installerats, varefter operatören spärrar den explicit. Spärrning är
   append-only.

## Beständighet och migration

- PostgreSQL-migration `0002` är additiv och skapar `station_device`,
  `station_credential` och `station_credential_revocation`.
- Interna server-UUID är primärnycklar. Stationens externa `deviceId` är unikt
  men aldrig primärnyckel.
- Credential och revocation är append-only. Rotation skriver en ny generation;
  äldre rader skrivs inte över.
- Auditposter innehåller endast credential-id, generation, scope och tidpunkter;
  aldrig plaintext-token eller tokenhash.
- Androids SQLite-schema stannar på version 3. Credentialkuvertet ligger separat
  i `noBackupFilesDir`, skrivs med `AtomicFile` och krypteras med AES-256-GCM.
- Android Keystore-hårdvarubacking och StrongBox är inte ett krav och får inte
  påstås utan fysisk verifiering.

PostgreSQL-rollback är export + verifierad backup/roll-forward; migrationen har
ingen automatisk `DROP`. Android återställs genom att installera credentialen på
nytt. Ett saknat, manipulerat eller oläsbart kuvert ger `parning krävs` och får
inte nollställa stationidentitet, paket eller outbox.

## Säkerhets- och kontraktsgräns

- Tokenformatet är versionsmärkt och består av publikt credential-id plus minst
  256 bitar slumpmässig secret. Parsern är strikt och längdbegränsad.
- Servern slår upp credential-id, hashar presenterad secret och jämför alltid
  32 bytes med constant-time-jämförelse. Okänt id använder en fast dummyhash.
- HTTPS krävs utom explicit loopback-HTTP i lokal utveckling.
- Route-auth sker före JSON-parsning och före alla databasmutationer.
- Felbesked är generiska, `no-store` och får inte innehålla deltagar-, race-,
  device- eller credentialmetadata.
- Credentialen får inte lagras i SQLite, web storage, loggar eller auditdata.
- Betrodd CLI är en tillfällig provisioneringsadapter, inte ett publikt API och
  inte färdig parning. QR-/engångsgrant kräver en senare ADR.
- Webbsimulatorns befintliga administratörsflöde får inte ge en dold authbypass;
  tester och lokal användning måste tillföra en riktig utfärdad credential.

## Acceptans

- Rätt credential ger `200` och oförändrad idempotens för stored/duplicate.
- Saknad/felaktig/utgången/spärrad credential ger `401`; rätt secret med fel
  race, device eller funktion ger `403`.
- 401/403 skapar inga raw/readout/outcome-rader och läcker ingen privat metadata.
- Paketroute och ingest använder samma device-bundna credentialmodell.
- Utfärdning, rotation och spärrning skapar append-only credential- och
  auditspår utan lagrad plaintext eller hash i audit.
- Native lagring återöppnas med samma credentialmetadata, men token kan inte
  läsas via plugin-API eller återfinnas i SQLite/web storage.
- Manipulerat kuvert, borttagen Keystore-nyckel och atomic-write-fel ger säkert
  felläge utan att outbox eller annan stationsdata ändras.
- Authfel stoppar ordnad flush, lämnar pending och startar ingen retry-loop.
- UI visar aktiv, utgången, saknad eller ogiltig autentisering med text/symbol
  utan att förlita sig på färg.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, webb-E2E-, Android JVM-,
  Android lint- och buildgrindar körs. Keystore/instrumentering redovisas
  explicit som körd eller endast kompilerad.

Se ADR-0014.
