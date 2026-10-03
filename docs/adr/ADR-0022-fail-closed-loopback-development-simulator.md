# ADR-0022: Fail-closed loopbackgräns för webbsimulatorn

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 005J flyttade simulatorn från den privata tävlingsöversikten till
`/admin/{raceId}/simulator`, men sidan är fortfarande en publik Next-route. Den
validerar race-id, frågar PostgreSQL efter `snapshot_version` och renderar ett
verktyg för syntetiska readouts utan miljö- eller nätverksgrind. Själva
servermutationen kräver redan en race-/devicebunden `READOUT`-credential, men
den öppna sidan avslöjar raceexistens och snapshotversion och gör fabricering
enkel för den som har en stationcredential.

Att stänga `device-batches` eller avvisa kontraktets nuvarande
`transport: "simulator"` skulle samtidigt stänga Androidstationens beprövade
offline-/synkflöde. Att lägga en ny arrangörscapability på utvecklingsverktyget
skulle skapa en ny produktionsfunktion i stället för att ta bort exponeringen.
Det minsta snittet är därför en deploymentgräns runt själva browsersidan.

En miljöflagga ensam bevisar varken utvecklingsläge eller lokal exponering.
Nexts `allowedDevOrigins` begränsar inte direktnavigation, och en HTTP `Host`-
header bevisar inte klientens källadress. Policyn måste både vara fail-closed i
kod och kombineras med explicit loopbackbindning av devservern.

## Beslut

### Server-only fyrdelad grind före data

Simulatorns sida får renderas endast när alla följande villkor är sanna:

1. `NODE_ENV` är exakt `development`.
2. `O_TID_SIMULATOR_MODE` är exakt `loopback-development`.
3. `O_TID_PUBLIC_ORIGIN` är exakt sin egen `URL.origin`, använder `http:`, har
   inga credentials, path, query eller fragment och har hostname exakt
   `localhost`, `127.0.0.1` eller `[::1]`.
4. `Host` och de av Next normaliserade `X-Forwarded-Host`/
   `X-Forwarded-Proto` är enkelvärden och matchar originens host inklusive port
   respektive `http` exakt.

Kontrollen implementeras som en ren, server-only webbadapterpolicy med
injekterade värden för test. Sidan samlar requestheaders och kör policyn före
routeparametrar, UUID-validering och databas. Avslag använder `notFound()` och
ger samma detaljfria svar oberoende av race-id eller raceexistens. Ingen klient
hydreras vid avslag.

Modevariabeln får inte exponeras med `NEXT_PUBLIC_*` eller en browserroute.
Produktion och alla andra miljölägen avvisas ovillkorligt, även vid fientligt
korrekta övriga värden. Den dynamiska routen får finnas i buildmanifestet; det
bindande kravet är att runtime alltid stoppar den före data och rendering.

### Loopbackbindning är en separat nödvändig driftregel

Projektets vanliga web-devscript och Playwrightserver binds till
`127.0.0.1`. Requestauthority kontrolleras som försvar på djupet men påstås inte
bevisa att TCP-klienten är lokal, eftersom `Host` kan spoofas. En utvecklare
eller operatör får därför inte åsidosätta bindningen till `0.0.0.0`, LAN-IP,
containerhost eller publik reverse proxy när simulatorläget är aktivt.

Direkt top-level GET kräver inte browserns `Origin`, eftersom den headern ofta
saknas. En proxykedja med kommaseparerade eller avvikande forwardedvärden
avvisas; fjärr-/stagingdrift ingår inte.

### Station och offlinekö lämnas orörda

`POST /api/races/{raceId}/device-batches`, station-package, credentiallivscykel,
idempotens, raw readout, resultatrevision och stationens lokala SQLite-outbox
ändras inte. Simulatorns befintliga `localStorage` är också orörd: grinden får
aldrig radera den enda lokala kopian. När sidan tillåts använder den exakt samma
autentiserade ingestflöde som tidigare.

## Konsekvenser

- Produktionsservern lämnar inte längre simulatorverktyg, raceexistens eller
  snapshotversion genom denna route.
- Lokal simulatorutveckling kräver ett explicit, självbeskrivande val och rätt
  loopbackdrift; felkonfiguration stänger i stället för att öppna.
- Ingen ny capability, schemaändring, domänregel, dependency eller
  produktionsfunktion införs.
- En devserver som trots driftregeln binds till ett externt interface kan inte
  göras nätverkssäker enbart med spoofbara HTTP-headers. Det är ett känt
  operativt antagande, inte något grinden döljer.
- En framtida autentiserad fjärrsimulator kräver separat threat model, audit,
  rate-limit och ADR.

## Migration och återställning

Ingen databas- eller datamigration behövs. Ändringen kan stoppas omedelbart
genom att ta bort `O_TID_SIMULATOR_MODE`; det ger 404 och bevarar lokal kö.
Lokal utveckling återställs genom korrekt explicit mode och loopbackbindning.
Produktion öppnas aldrig som rollback. En kodrollback måste fortfarande följa
projektets regel att simulatorn inte exponeras offentligt.

## Avvisade alternativ

- Endast en boolean enableflagga: uttrycker inte avsedd miljö och kan felsättas
  i produktion.
- Endast `NODE_ENV !== "production"`: skulle öppna okända/testmiljöer och
  saknar explicit operatörsval.
- Endast `allowedDevOrigins`: är Next-devkonfiguration, inte routeauth eller
  nätverksgräns.
- Endast origin-/hostkontroll: headers kan spoofas och ersätter inte
  loopbackbindning.
- Kräva browserns `Origin` på navigation: legitim top-level GET saknar ofta
  headern och det ger ingen säkrare källadress.
- Ny simulatorcapability/session: gör utvecklingsverktyget till en ny
  produktionsyta och är bredare än snittet.
- Stänga device-batch eller förbjuda `transport: "simulator"`: bryter
  stationens nuvarande beprövade normaliserade flöde.
- Radera routen eller klientkön i produktion: fysisk manifestfrånvaro är
  onödigt brittle, och ködata kan vara den enda lokala kopian.
