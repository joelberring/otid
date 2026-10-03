# ADR-0012: Delad lokal resultatmotor och minimal stationsbundle

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 005A lagrar signerade tävlingspaket och en crash-säker outbox, men exponerar
bara aktiv paketmetadata till TypeScript. Resultatmotorn finns redan som ren,
browser-safe TypeScript i `packages/domain`. `packages/application` får inte
användas i stationen eftersom det paketet orkestrerar PostgreSQL och Node-I/O.

Capacitors `www` innehåller samtidigt bara statisk HTML. `tsc` kan typkontrollera
stationens moduler men lämnar workspace-importer som webbläsaren inte kan lösa.
En faktisk operativ vy kräver därför en liten, reproducerbar browserbundle.

Rådataregeln kräver att en avläsning bevaras även om lokal evaluering inte kan
köras. En enda transaktion som kräver ett lyckat resultat skulle göra
motorversionsfel till dataförlust. SQLite-schemat behöver därför skilja
outboxposten från den härledda lokala bedömningen.

## Beslut

### Samma motor på server och station

`apps/station` får ett direkt workspaceberoende på `@o-tid/domain` och importerar
`evaluateCardReadout` samt `RESULT_ENGINE_VERSION`. Ingen resultatlogik kopieras
till UI eller Kotlin. Stationen importerar inte `@o-tid/application`.

Domänmotorns argument smalnas till `EvaluationReadout`, med bara de fält motorn
faktiskt använder. `NormalizedCardReadout` utökar fortsatt denna typ. Det ändrar
ingen resultatregel och gör att stationen inte behöver fabricera serveridentiteter.

Paketets `resultEngineVersion` måste vara exakt lika med appens motorversion för
att en lokal bedömning ska visas. Avvikelse blockerar endast den härledda
bedömningen; den normaliserade händelsen har redan sparats i outboxen.

### Återläsning av aktivt paket

`OtidStationStore` får ett read-only `loadActivePackage(raceId)`. Native lagret
läser append-only `payload_bytes`, beräknar SHA-256 och jämför med lagrad hash
innan strikt UTF-8 lämnas över. TypeScript runtimevaliderar därefter JSON med
`stationPackagePayloadSchema` och kontrollerar race, version och hashmetadata.

Den tidigare verifierade signaturen körs inte om vid varje läsning. Förtroendet
etablerades vid den atomiska installationen; återläsningen skyddar mot lokal
korruption med den lagrade digesten. Paketbytes kan inte uppdateras via API eller
databastriggers.

### Outbox först, lokal bedömning därefter

SQLite uppgraderas additivt från version 1 till 2 med en ny tabell
`local_evaluation`. Den refererar `(device_id, local_sequence)` i outboxen och
lagrar motorversion, snapshotversion, pakethash, canonical bedömnings-JSON,
bedömningshash och skapandetid. Tabellen är insert-only med no-update/no-delete-
triggers.

Enqueue committas alltid före evaluering. Ett separat idempotent
`recordLocalEvaluation` infogar bedömningen efter lyckad domänkörning. Samma
sekvens och hash är en dublett; annat innehåll är en explicit konflikt. Ett fel
eller appstopp mellan transaktionerna lämnar en synkbar outboxpost utan lokal
bedömning, aldrig ett förlorat readout.

Migration 1→2 skapar endast den nya tabellen och dess triggers. Befintlig
identitet, paket- och outboxhistorik ändras inte.

### Stations-UI och bundle

Stationen använder plattforms-DOM och CSS, inte ett nytt UI-ramverk. `esbuild`
pinnas som build-only devDependency för att paketera stationens TypeScript och
workspaceberoenden till en enda browserfil. Det är en bygggräns, inte en ny
runtimearkitektur. Bygget kopierar `www` till Androids assets före APK-assemble.

Vyn håller bootstrap-token och SPKI endast i formulär/minne. Den sparar dem inte
i webblagring eller SQLite. Kritisk status uttrycks med svensk text och symbol,
inte enbart färg. SPORTident visas uttryckligen som inte aktiverat i detta snitt;
ingen hårdvarustatus höjs.

## Migration, restore och rollback

Migration 1→2 skapar en separat append-only-tabell och två triggers. Den får
inte radera eller uppdatera befintliga rader. En kopia av v1-databasen är
återställningspunkten före appuppgradering.

Appdowngrade från schema 2 blockeras fortsatt. Om en uppgradering avbryts rullar
SQLite tillbaka migrationstransaktionen. En v1-app kan inte öppna en lyckat
migrerad v2-databas och ska inte installeras över den.

## Konsekvenser

- Lokal och central grundbedömning använder samma versionssatta funktion.
- Ett resultat visas först när dess härledda bedömning är beständig.
- Evalueringsfel kan inte förhindra att den normaliserade händelsen bevaras.
- Gamla köposter överlever utan fabricerade lokala resultat.
- Den statiska stationsappen blir faktiskt körbar utan React eller server.
- Signaturtrust, serverkonflikter och hårdvarutolkning förblir separata ansvar.

## Licens

Endast projektets egen domänkod, Androidplattformens API:er, Capacitor och MIT-
licensierade `esbuild` används. Ingen kod eller struktur hämtas från MeOS,
Oxygen eller Livelox.
