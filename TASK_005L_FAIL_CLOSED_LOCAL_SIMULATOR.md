# TASK 005L – fail-closed lokal utvecklingssimulator

## Syfte

Stäng den separata webbsimulatorn som öppen produktionsyta utan att ändra
stationens autentiserade ingest- eller offlineflöde. Simulatorn ska endast kunna
renderas efter ett uttryckligt lokalt utvecklingsval och ska annars svara med en
generisk 404 innan race-id valideras eller databasen används.

Snittet skapar ingen ny capability, session eller generell arrangörsroll. Det
ändrar inte `POST /api/races/{raceId}/device-batches`, stationscredentials,
stationspaket, simulatorpayloadens kontrakt, resultatmotorn eller den lokala kön.
Det lägger inte till SPORTidentparser, riktig USB, stafett, GPS, relay eller
annan senare funktion.

## Berörda paket

- `apps/web`: ren server-only-policy, tidig pagegrind, loopbackbunden devstart
  och privata simulatorheaders.
- `tests`: policy-/sidtester, befintliga simulatorregressioner och en verklig
  standalone-produktionsprobe.
- `docs`: ADR, arkitektur, offlinekonsekvens, acceptans, drift och status.

`packages/domain`, `packages/contracts`, `packages/application`,
`packages/database`, Androidstationen och worker ändras inte. Ingen migration
eller ny dependency behövs.

## Avgränsat flöde

1. `/admin/{raceId}/simulator` är avstängd som standard.
2. Serverkomponenten läser requestheaders och tillämpar policyn innan den väntar
   på routeparametrar, validerar UUID eller gör en databasfråga.
3. Åtkomst kräver samtidigt exakt `NODE_ENV=development`, exakt
   `O_TID_SIMULATOR_MODE=loopback-development` och en exakt canonical
   `O_TID_PUBLIC_ORIGIN` med `http:` och host `localhost`, `127.0.0.1` eller
   `[::1]`.
4. Requestens `Host`, `X-Forwarded-Host` och `X-Forwarded-Proto` måste vara
   entydiga och exakt matcha den konfigurerade loopback-originens authority och
   protokoll. Saknad, kommaseparerad eller avvikande authority avvisas.
5. Produktionsläge, testläge, okänt miljöläge, saknad/fel mode, malformed eller
   icke-canonical origin, HTTPS, LAN-IP, wildcardadress, lookalike-host eller
   authoritymismatch ger samma vanliga `notFound()`.
6. Den lokala devservern binds som standard till `127.0.0.1`. Hostheaders är
   försvar på djupet och utgör inte bevis för klientens nätverksadress; en
   operatör får inte binda simulatorns devserver till LAN eller wildcardadress.
7. Först efter godkänd policy valideras race-id och endast `snapshot_version`
   hämtas. Okänt race ger fortsatt 404.
8. Godkänd simulator använder oförändrat en manuellt inmatad race-/devicebunden
   `READOUT`-credential och den befintliga idempotenta device-batch-routen.
9. Simulatorns `localStorage`-kö, device-id, sekvenser och okvitterade poster
   rensas eller migreras aldrig av grinden. En spärrad sida hydreras inte och
   skapar därför inte heller nytt klienttillstånd.
10. Simulatorvägen behåller `private, no-store`, frame-skydd, `nosniff`,
    `no-referrer`, avstängda sensorbehörigheter och får explicit
    `X-Robots-Tag: noindex, nofollow` även när den svarar 404.

## Säkerhets- och driftgräns

- Miljövariabeln är server-only och får inte heta `NEXT_PUBLIC_*` eller
  exponeras genom en statusroute.
- `allowedDevOrigins` är inte åtkomstkontroll och ersätter ingen del av denna
  policy.
- Produktion är ovillkorligt avstängd även om mode och loopback-origin är
  fientligt felsatta.
- Direktnavigation kräver inte browserns `Origin`-header; konfigurerad public
  origin och requestauthority är den kontrollerade gränsen.
- En framtida fjärr- eller staging-simulator kräver ett separat vertikalt snitt
  med egen autentisering, audit och ADR.
- Den autentiserade stationens ingest får inte stängas utifrån payloadens
  nuvarande `transport: "simulator"`; samma normaliserade kontrakt används av
  den avgränsade stationen tills en senare protokolladapter finns.

## Migration och återställning

Ingen databasmigration görs. Ändringen är kod- och driftkonfiguration. Omedelbar
kill switch är att ta bort eller ändra `O_TID_SIMULATOR_MODE`; sidan blir då
404 utan att lokal kö raderas. Återställning av lokal utveckling sker genom
explicit korrekt mode, canonical loopback-origin och loopbackbunden server,
aldrig genom att öppna produktion.

## Acceptans

- En ren policytestmatris bevisar alla tillåtna loopbackvarianter och avvisar
  produktion/test, saknat/fel mode, malformed/icke-canonical origin, HTTPS,
  LAN/wildcard/lookalike och tvetydiga eller avvikande headers.
- Avvisad policy returnerar 404 och anropar snapshot-loadern noll gånger;
  race-id, snapshotversion och simulatorsträngar lämnas inte.
- Tillåten lokal development med matchande authority gör exakt en minimal
  snapshotfråga för känt race och ger 404 för ogiltigt eller okänt race.
- Befintliga fyra Playwrightflöden för simulering, reloadad kö, ordnad flush och
  omräkningsseed fortsätter genom explicit dev-opt-in.
- Den byggda standalone-servern startas med fientligt enableläge, loopback-
  origin och otillgänglig databas. Giltigt formaterade simulator-URL:er ger
  verklig 404, privata headers och inga simulatorsträngar utan DB-försök.
- Station-package och device-batch fortsätter kräva rätt stationcredential och
  befintliga ingest-/offline-/resultatregressioner förblir gröna.
- Ingen SPORTidentstatus höjs från `untested`; ingen fysisk hårdvara provas.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

Se ADR-0022.
