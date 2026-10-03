# ADR-0060: Privat tillbaka-navigation utan krav på cacheinträde

- Status: Accepterad
- Datum: 2026-09-06

## Kontext och faktisk observation

ADR-0058 kräver privata no-store-svar, säker auth och att sena svar inte
återvisar dolda uppgifter. Main lade under verifieringen till ett starkare
testkrav: faktisk pageshow.persisted=true. Det är en begäran om att browsern
ska cachelagra sidan, inte ett ursprungligt funktionellt krav i TASK008.

En riktig navigation bort/tillbaka mot produktionsbyggd Next över lokal TLS
gav persisted=false. Chromium angav response-cache-control-no-store och
response-cache-control-no-store-with-js-network-request bland sina
notRestoredReasons. Login, effektiv DNS-withdrawal och färsk återautentisering
fungerade. Det röda provet ligger dokumenterat i docs/status.md och loggen
/private/tmp/otid-008-production-navigation.log. Det visade uteblivet
cacheinträde, inte att gamla uppgifter återvisades utan giltig behörighet.

## Beslut

Behåll no-store och ordinarie produktionskrav på HTTPS/host-only Secure cookies.
Ta inte bort privata headers eller aktivera experimentella browserfeatures
för att framtvinga ett grönt cacheprov. Ingen produktionsteknik ändras.

Acceptans av verklig tillbaka-navigation har två uttryckliga grenar:

- Verklig bfcache (persisted=true): privat underlag ska vara dolt och sidan
  kräva explicit inloggning. Sena svar får inte återöppna vyn.
- Ny dokumentladdning (persisted=false): ingen gammal privat DOM återanvänds;
  en ny serverkontroll måste bevisa giltig session innan persondata hämtas.
  I det lokala produktionsprovet ska browserns rapporterade no-store-hinder
  också observeras. Detta får inte redovisas som bfcache-täckning.

Syntetiska PageTransitionEvents är fortfarande bara handlerprov. Äkta
bfcache-grenen förblir uttryckligen overifierad på en browser som inte väljer
den. Det är en kompatibilitets-/fältprovsbegränsning, inte tillstånd att lagra
persondata beständigt. Framtida browserbeteende ska fortsätta prövas mot samma
sekretesskrav, inte mot ett krav att själva prestandaoptimeringen används.

## Testmiljö och avgränsning

Endast syntetiskt lopp i explicit isolerad PostgreSQL. Tillfälligt self-signed
certifikat i privat tempkatalog och loopback-TLS-proxy, ingen systemtrust,
ingen publik port och ingen riktig Eventornyckel. Browserns certifikatundantag
gäller bara testkontexten, aldrig applikationens produktionspolicy.
Kör genererad standalone-server med dess statiska assets i separat privat
testkatalog enligt bundled Next output-dokumentation; ändra inte projektets
standalone-val eller inför en ny custom produktionsserver.

## Konsekvenser

Ett överstyrt testkrav korrigeras öppet, inte genom skip eller fabricerat
persisted-värde. Båda navigationsgrenarna behåller sina säkerhetsassertioner.
Produktionslast, fysisk mobil och bred browserkompatibilitet bevisas inte.
Detta beslut avslutar inte huvudmålet eller resterande V1-funktioner.
