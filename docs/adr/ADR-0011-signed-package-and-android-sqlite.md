# ADR-0011: Signerade paket och Androids beständiga stationslager

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 004 ger servern idempotent ingest men webbsimulatorns `localStorage` är inte
en fältduglig kö. Androidskalet saknar både tävlingspaket och lokal lagring.
Tävlingspaketet innehåller personuppgifter och resultatregler; stationen måste
kunna upptäcka manipulation och fortsätta efter process- eller nätavbrott.

Paketets egen publika nyckel kan inte ensam etablera förtroende. JSON som
serialiseras om på klienten kan dessutom ge andra bytes än de servern signerade.
Androids standardbackup kan flytta en appdatabas till en ny enhet och därmed
duplicera `deviceId` och lokala sekvenser.

## Beslut

### Signerat kuvert

Paketet använder ett versionssatt kuvert:

- `formatVersion: 1`,
- `algorithm: RS256`,
- `keyId`: SHA-256 av publik X.509/SPKI-DER,
- `payload`: Base64URL av exakta UTF-8-bytes,
- `signature`: Base64URL av RSA PKCS#1 v1.5 med SHA-256 över dessa bytes.

RS256 väljs eftersom Node och Android API 24 kan verifiera formatet med sina
plattformskrypton utan nytt runtimeberoende. Serverns privata PEM-nyckel läses
endast från miljövariabel. Payload byggs med en liten deterministisk JSON-
serialiserare som sorterar objektnycklar rekursivt; arrayer behåller domänordning.
Flyttal, `undefined` och icke-JSON-värden accepteras inte.

Stationen får den betrodda publika SPKI-nyckeln utanför kuvertet. Den jämför
beräknat key-id, verifierar signaturen över exakt `payload` och kontrollerar att
payloadens inbäddade verifieringsnyckel är samma nyckel. Ingen trust-on-first-use
införs. TASK 005A:s manuellt konfigurerade bootstrap ersätts senare av
enhetsparning utan att paketformatet behöver ändras.

### Privat nedladdning

Paketroute kräver en bearer-token från miljövariabel och svarar `503` om token
eller signing key saknas. Jämförelsen görs tidsoberoende. Detta är en avgränsad
bootstrap för test och lokala arrangörsmiljöer, inte V1:s slutliga
behörighetsmodell. Produktionsdrift blockeras tills device pairing och
rollavgränsad autentisering finns.

### Native lokal lagring

En ny Android library-modul `:otid-station-store` äger `OtidStationStore` och
använder plattformens `SQLiteOpenHelper`; USB-modulen ändras inte. Ingen
tredjepartsdatabas tillförs.

Databasen innehåller:

- en singletonrad för stabilt `deviceId` och nästa lokala sekvens,
- append-only installerade paket identifierade av `(raceId, version)`,
- en separat aktiv paketpekare per lopp,
- append-only outboxposter med fryst device/session/race/package/sequence/hash,
  payload och kvittensmetadata.

Paketinstallation, sekvensallokering + enqueue och applicering av kvittenser är
egna SQLite-transaktioner. `stored` och `duplicate` markerar posten
`ACKNOWLEDGED`; `rejected` bevaras som `REJECTED`; inga poster raderas via
plugin-API:t. Skrivningar serialiseras. Foreign keys, WAL och
`PRAGMA synchronous=FULL` används för process- och strömavbrottsbarriären.

Android Auto Backup och device-to-device transfer exkluderar hela
stationsdatabasen. Återställning sker i stället genom ominstallation av signerat
paket och serverstödd avstämning; en lokal kö får aldrig kopieras till ny device.

## Restore- och rollbacknotering

SQLite-schemat introduceras på databasversion 1 och ersätter ingen befintlig
lokal lagring. Alla framtida uppgraderingar måste vara explicita, additiva och
testade mot en kopia av databasen. Automatisk downgrade eller destruktiv
`onUpgrade` är förbjuden. Vid misslyckad paketinstallation eller kvittens rullas
transaktionen tillbaka och tidigare aktiv pekare/outbox ligger kvar.

En återställd app utan databas skapar nytt `deviceId`; serverns idempotens gör
att tidigare uppladdningar förblir säkra, men ej kvitterad lokalkö som saknar
separat säkerhetskopia kan då inte återskapas. Export/arkiv av stationsdata är ett
senare återställningssnitt.

## Konsekvenser

- Exakt signerade bytes kan granskas och återverifieras utan JSON-omskrivning.
- Paketrollback och samma-version-equivocation stoppas lokalt.
- Äldre paket och kvitterade händelser finns kvar för konfliktförklaring.
- Appens privata sandbox skyddar data från andra appar, men detta beslut inför
  inte databaskryptering i vila.
- Emulatorns instrumenteringstest krävs innan crash-säkerheten får markeras som
  verifierad. JVM-/TypeScripttester och APK-build är nödvändiga men inte
  tillräckliga bevis för Androids faktiska SQLite-runtime.
- Beslutet ändrar inte resultatdomänen, SPORTidentgränserna eller serverns
  PostgreSQLteknik.

## Licens

Implementation använder endast Node.js/Androids plattforms-API:er och befintliga
Capacitorberoenden. Ingen kod eller struktur hämtas från MeOS, Oxygen eller
Livelox.
