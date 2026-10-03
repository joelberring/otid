# ADR-0126: deltagarens uttryckliga samtycke till framtida ruttpublicering

- Status: Accepterad, implementerad i TASK116
- Datum: 2026-09-21

## Kontext

TASK111–113 lagrar deltagarens GPX-rutt privat via en tidsbegränsad
route-upload-grant. TASK115 låter endast en `MANAGE_RACE`-administratör
förhandsgranska en uttryckligt vald rutt privat. `publicResultId` är en
resultatlänk, inte deltagaridentitet eller skrivbehörighet. Ingen av dessa
gränser är ett samtycke till att publicera en persons rörelseuppgifter.

Den kommande egna spårmodulen behöver kunna skilja en privat rutt från en rutt
som deltagaren uttryckligen har godkänt för en senare, ännu ej byggd
publiceringsyta. Ett muterbart `published`-fält på ruttmanifestet skulle göra
historiken oklar och ge senare route-versioner samma godkännande av misstag.

## Beslut

TASK116 inför en smal, append-only samtyckesjournal för **framtida**
ruttpublicering. Den är inte en publik release.

- Endast en aktiv, deltagarbunden route-upload-session kan skapa ett beslut.
  Varken `publicResultId`, administratörens preview-session eller upload-grant
  i sig är samtycke.
- Servern resolverar den enda lagrade rutten för sessionens aktuella grant och
  binder varje beslut till exakt `route_object_manifest.upload_id` och dess
  SHA-256. Browsern skickar aldrig manifest-, entry- eller hashidentifierare.
- Ett beslut är antingen `GRANT` eller `WITHDRAW`. Standardläget utan beslut
  är privat. Senaste giltiga beslutet för exakt manifest avgör bara om rutten
  är `READY_FOR_FUTURE_PUBLICATION` eller `PRIVATE`.
- Samtycke och återtagande har egna request-id:n, är idempotenta vid exakt
  retry och append-only. Ändrat intent eller annan grant/race/entry för samma
  request-id är konflikt. Rå GPX, manifest och tidigare beslut ändras eller
  raderas aldrig.
- Återtagande stoppar varje framtida läsning som en senare publikeringsyta
  annars skulle ha öppnat. Det kan inte ta tillbaka kopior som redan har
  publicerats; sådan faktisk publicering beslutas inte i detta snitt.
- Deltagarens privata uppladdningssida visar endast aktuell status och erbjuder
  uttryckliga, CSRF-skyddade val. Administratörens route-preview och alla
  publika resultat-/kartvägar förändras inte.

## Konsekvenser

Det skapar ett verifierbart personligt beslut utan att påstå att en publik
ruttvy redan finns. En senare ADR måste välja publikens målgrupp
(`event-participants` eller `public`), kartsläppsvillkor, synlighetsperiod,
återtagandehantering efter faktisk release och den minimala publika
projektionen. Den får bara läsa manifest vars senaste consent är `GRANT`.

TASK116 omfattar inte karta, georeferering, publik API, deltagarresultatlänk
som credential, multi-route-jämförelse, analys, tidsuppspelning, live-GPS,
FIT/TCX, OMAP, stafett eller hårdvara.

## Alternativ

- Ett publikt resultat-ID som samtyckesnyckel avvisas: länken är delbar och
  saknar deltagarautentisering.
- Ett `published`-fält på manifestet avvisas: det blandar immutable ruttdata
  och föränderlig policy utan beslutshistorik.
- Direkt publik ruttvy avvisas: den skulle sakna valt målgrupps- och
  återtagandebeslut.
