# ADR-0014: Device-bundna stationscredentials

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 005C gav stationen beständig, idempotent synk men lämnade
`/api/races/{raceId}/device-batches` öppet. Paketdownload skyddas endast av en
global miljötoken. Den modellen kan varken binda en station till ett lopp eller
funktionen `READOUT`, och den kan inte roteras eller spärras per enhet.

Briefen kräver egen stationsidentitet, tävlings- och funktionsscope, tidsbegränsad
credential, rotation och spärrning. Samtidigt saknas ännu arrangörsinloggning och
ett säkert engångs-/QR-grant. Ett publikt provisionerings-API i detta läge skulle
bara flytta den öppna säkerhetsluckan.

Androidstationens SQLite innehåller crash-safe tävlingsdata och outbox men är
inte krypterad. En bearer-token får därför inte läggas där i klartext eller
returneras från native lagring till WebView vid varje request.

## Beslut

### Serveridentitet och credential

Servern får en intern `station_device` med UUID-primärnyckel och separat unik
stationrapporterad `device_id`. En `station_credential` binder serverenheten till
ett lopp, scope `READOUT`, en strikt ökande generation och ett giltighetsintervall.
Credentialrader är append-only. En separat append-only
`station_credential_revocation` gör spärrning historisk i stället för att skriva
över credentialen.

Tokenformatet är `otid_stn_v1.<credential-id>.<secret>`, där secret är 32
kryptografiskt slumpade bytes i base64url. Servern lagrar endast SHA-256 över
secret. Publikt id används för uppslag; presenterad och lagrad hash jämförs med
`timingSafeEqual`. Okänt id går genom samma hash-/jämförelseväg mot en fast
dummyhash. Ingen ny kryptodependency införs.

Utfärdning, rotation och spärrning ligger i applikationslagret och anropas i
005D av en betrodd server-CLI med direkt databasanslutning. Plaintext-token
returneras endast från utfärdnings-/rotationskommandot och går aldrig att läsa
tillbaka. CLI:n är inte färdig parning. Ett senare QR-/engångsgrant måste
designas separat med retry-, expiry- och rate-limitsemantik.

### Routebarriär

Ett server-only åtkomstlager verifierar bearer-token före bodyparsning. Saknad,
malformed, okänd, felaktig, utgången eller spärrad credential ger samma generiska
`401` med `WWW-Authenticate: Bearer` och `Cache-Control: no-store`. En
kryptografiskt giltig credential som inte matchar path-lopp, body-device eller
funktionen ger generiskt `403`. Inget authfel får anropa ingest eller skapa data.

Samma verifiering skyddar stationspaketet. Den tidigare globala paket-tokenen
tas bort; en station kan alltså bara hämta det loppaket dess egen credential är
scopad till. Webbsimulatorn får ingen dold fallback eller utvecklingsbypass.

### Android

SQLite förblir schema 3. Native stationsmodul genererar en icke-exporterbar
AES-256-GCM-nyckel i `AndroidKeyStore`. Ett versionsmärkt credentialkuvert binds
med AAD till app-id och stationens beständiga `deviceId`, och skrivs atomiskt med
`AtomicFile` i `noBackupFilesDir`. Kuvertet innehåller token och validerad
metadata; pluginstatus returnerar endast metadata.

Installation är ett explicit native anrop där den manuellt provisionerade token
får passera WebView en gång. Därefter gör native kod den tillåtna authenticated
HTTP-requesten, läser credentialen internt och injicerar Authorization. Caller
kan inte ange egen authheader. Endast HTTPS och explicit loopback-HTTP accepteras,
och requestens path måste vara den scopade device-batch-routen.

Ett authfel, nätfel eller credentialfel ändrar aldrig outbox. 401/403 stoppar
ordnad flush och lämnar credentialen kvar för operatörsåtgärd; klienten raderar
inte en hemlighet utifrån ett obetrott eller tvetydigt svar. Korrupt kuvert eller
ogiltig Keystore-nyckel visas som att ny credential krävs utan att annan lokal
data nollställs.

## Konsekvenser

- Ingest och privat paketdownload får samma per-device, per-race scope.
- Databasläcka ger inte återanvändbara tokens, och Androidbackup innehåller inte
  credentialen.
- Manuell CLI-provisionering är operativt begränsad men är en autentisk säker
  gräns; den påstås inte vara färdig parning.
- Explicit spärrning efter lyckad installation ger säker rotation utan att ett
  tappat svar omedelbart låser stationen ute.
- Native requestkod blir en liten separat adapter. Domän- och resultatlogik
  flyttas inte och den befintliga idempotensbarriären ändras inte.
- Verklig Keystore-, AtomicFile- och nätverksfunktion kräver Android
  instrumentering; JVM-fakes får inte räknas som fysisk verifiering.

## Migration och återställning

PostgreSQL-migrationen är additiv. Automatisk destruktiv rollback är inte
tillåten. Före manuell nedtagning exporteras credential- och revocationhistorik
och en verifierad full backup tas; normal återställning sker med roll-forward.

Androids SQLite migreras inte. Förlorad eller oläsbar Keystore/credentialfil
återställs genom ny utfärdning och installation. Stationidentitet, paket, outbox,
lokala bedömningar och serverobservationer lämnas orörda.

## Avvisade alternativ

- Global miljötoken för ingest: saknar device-/race-scope och individuell
  rotation/spärrning.
- Öppet QR-/pairing-API utan arrangörsautentisering: flyttar bara tilliten och
  kräver rate limiting som ännu inte finns.
- Plaintexttoken i SQLite, preferences eller web storage: exponerar långlivad
  credential vid fil-, backup- eller XSS-läcka.
- Returnera token från plugin inför varje Capacitor HTTP-anrop: breddar
  WebViewens åtkomst till hemligheten efter installation.
- Automatisk spärrning av gammal credential i samma steg som rotation: ett
  tappat svar kan låsa stationen ute innan ny credential är beständigt lagrad.
- Ändra råmeddelandets idempotensnyckel eller FK i detta snitt: behövs inte för
  authbarriären och skulle blanda in en datamigration utan acceptansbehov.
