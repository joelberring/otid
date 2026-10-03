# TASK 005A – signerat tävlingspaket och beständig stationskärna

## Syfte

Bygg den första körbara delen av Etapp C utan att gå in i SPORTident-protokoll:

> Servern ska kunna skapa ett signerat och versionsmärkt tävlingspaket som
> Androidstationen verifierar mot en redan betrodd publik nyckel och installerar
> atomiskt. Stationens identitet och utgående händelser ska ligga i app-privat
> SQLite och överleva omstart utan att en skickad men okvitterad post försvinner.

Snittet återanvänder TASK 004:s batch- och kvittenskontrakt med transporttypen
`simulator`. Det inför ingen SPORTident-parser, kortnormalisering eller fysisk
USB-verifiering.

## Leverabler

- strikt runtimevaliderat kontrakt för paketpayload och signerat kuvert,
- deterministiska UTF-8-bytes och SHA-256 för paketpayloaden,
- RSA/SHA-256-signatur över exakt de bytes som stationen lagrar,
- serverfunktion som bygger en sammanhängande snapshot under lopplås,
- privat paketroute som är avstängd när signing key eller stationstoken saknas,
- Androidpluginen `OtidStationStore`, separat från USB-modulen,
- app-privat SQLite med atomisk paketinstallation, stabilt `deviceId`, monoton
  lokal sekvens och append-only outbox,
- explicit Android-backupregel som utesluter databas, deviceidentitet och kö,
- TypeScriptgräns som laddar ner, validerar och installerar ett paket,
- tester för signatur, manipulation, rollback, idempotens, omstart och kvittens.

## Paket- och förtroendekrav

Kuvertet innehåller algoritm, key-id, Base64URL-kodade payloadbytes och signatur.
Payloaden innehåller loppets aktuella `RaceSnapshot`, evenemangets tidszon,
resultatmotorversion, tillåten stationsfunktion och den publika signing key som
payloaden påstår sig tillhöra.

Den inbäddade publika nyckeln är inte en trust root. Installationen kräver samma
publika SPKI-nyckel från en separat betrodd bootstrap. TASK 005A använder ett
explicit konfigurerat värde; QR-baserad enhetsparning byggs senare.

Stationen verifierar signaturen över de mottagna payloadbytesen innan JSON
tolkas eller något skrivs. Samma version och hash är idempotent. Samma version
med annan hash eller en lägre version avvisas utan att aktivt paket ändras.
Äldre korrekt installerade paket sparas för framtida konfliktförklaring.

## Lokal transaktionsmodell

SQLite använder foreign keys, WAL och `synchronous=FULL`.

En enqueue-transaktion ska samtidigt:

1. läsa eller skapa stabilt `deviceId`,
2. reservera nästa lokala sekvens,
3. skriva hela frysta batchkontexten och payloaden,
4. öka nästa sekvens,
5. committa innan anropet får svara.

En post raderas aldrig när den skickas. Endast en exakt validerad kvittens för
device, sekvens och hash får ändra den till `ACKNOWLEDGED`. Avvisningar sparas
som `REJECTED` för operatörsgranskning. Okänd commitstatus lämnar posten pending
och retry använder samma identitet.

## Acceptanstester

1. Ett servergenererat paket verifieras och installeras byteidentiskt.
2. Ändrad payload, signatur, key-id eller betrodd nyckel avvisas.
3. Snapshotmutation kan inte ge ett paket med blandade versioner.
4. Samma version/hash är idempotent; samma version/annan hash och downgrade
   lämnar tidigare aktiv version orörd.
5. Stationens `deviceId`, aktiva paket, outbox och nästa sekvens finns kvar när
   SQLite stängs och öppnas igen.
6. Fel före commit lämnar varken sekvensökning eller halv outboxpost.
7. En exakt `stored`/`duplicate`-kvittens markeras atomiskt men posten behålls.
8. Fel device, sekvens, hash eller motsägande kvittens lämnar hela
   kvittenstransaktionen oförändrad.
9. Paketroute svarar inte med persondata utan korrekt bearer-token och är
   avstängd när serverhemligheter saknas.
10. Android Auto Backup/data transfer omfattar inte stationsdatabasen.

## Berörda delar

- `packages/contracts`
- `packages/application`
- `apps/web` endast privat paketroute
- `apps/station` och ny native modul `:otid-station-store`
- `docs/architecture.md`
- `docs/offline-sync.md`
- `docs/acceptance-tests.md`
- `docs/status.md`

Ingen PostgreSQL-migration behövs. SQLite-schemat skapas som en ny, separat
lokal databas och har en restore-notering i ADR-0011.

## Ingår inte

- QR-parning, användarkonton eller generell behörighetsmodell,
- ny transporttyp i serverns ingestkontrakt,
- SPORTident-frameparser, probe, kortavkodning eller verklig USB,
- lokal resultatutvärdering från SPORTidentdata,
- stafett, GPS, karta, Eventor eller publikfunktioner.
