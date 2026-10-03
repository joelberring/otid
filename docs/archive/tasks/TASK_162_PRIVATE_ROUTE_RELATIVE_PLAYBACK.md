# TASK162: egen relativ GPX-uppspelning efter loppet (C3a)

Status: avgränsad i ADR-0155 före kod; syntetiskt verifierad 2026-09-23.

## Användbart utfall

En inloggad deltagare öppnar sin redan utvalda privata GPX-version på den
redan bevisat rätta egna kartan och kan följa inspelningens **uppmätta** tid
med spela/pausa, omstart och tidsreglage. Saknar spåret komplett monoton
GPX-tid säger vyn det tydligt men visar fortfarande rutten och dess fakta.

## Bygg endast detta

1. Höj den befintliga privata overlay-responsen till formatversion 2 med
   obligatorisk `AVAILABLE` relativ tid per punkt eller `UNAVAILABLE`.
   Validera en punkt/tid, första 0, monoton ordning och duration. Ingen
   råkoordinat eller nytt behörighetsbevis exponeras.
2. Härled tidsserien i samma read-only serverprojektion som redan väljer
   exakt GPX/karta/banhistoria. Ingen migration, ny writer eller
   publiceringsväg.
3. Lägg kompakta svenska uppspelningskontroller i den befintliga privata
   ruttdetaljen på mobil och dator. Använd befintlig ren pixelmarkör;
   animera inte över segmentbrott och koppla inte GPS-markören till
   kontrollstämplingar.

## Minsta verifiering

- Kontraktsprov för giltig/ogiltig tid samt saknade/omvända källtider.
- Riktat isolerat PostgreSQL-prov för projektion och oförändrad kontogrind.
- Ett 390px-browserfall för play/scrub, unavailable och ingen horisontell
  scroll; syntetisk karta får inte kallas kartprecisionsbevis.
- Berörd lint, typecheck, riktade tester och build med exakta resultat.

## Ingår inte

Nya kontroll-/splittider, tempo/höjd, GPS-inspelning, OMAP, jämförelse av
flera privata rutter, automatisk publicering, SPORTident eller fältacceptans.
Fortsatt C3-analys får en egen liten TASK och vid ny proveniensregel ett ADR.

## Verifierat utfall 2026-09-23

Kontraktet för privat overlay är formatversion 2 och skiljer `AVAILABLE`
relativ uppmätt GPX-tid från `UNAVAILABLE`. Den skyddade projektionen
skickar bara pixelpunkter och relativ tid för exakt vald GPX-/kart-/banversion.
Vyn har spela/pausa, omstart och tidsreglage; saknad tid får ett eget besked.
Ingen kontrollpassage eller sträcktid härleds från GPX.

Riktade kontrakts-/webbprov: 4 filer, 16/16 tester. Isolerat PostgreSQL-prov:
1/1. Riktigt 390px-browserprov mot syntetisk HTTP/PostgreSQL: 1/1, även efter
sista kodändringen. Berörd ESLint och typecheck för contracts, application,
web samt e2e passerade. Contracts/application TypeScript-build,
`build:checkin` och Next-produktionsbuild passerade. Browserprovet behövde
lokal socket-/loopbackbehörighet; första sandboxförsöket gav `EPERM` och
omkörningen i tillåten isolerad miljö gav exit 0. Ingen fysisk enhet,
verklig karta, objektlagringsacceptans eller GPS-inspelning verifierades.
