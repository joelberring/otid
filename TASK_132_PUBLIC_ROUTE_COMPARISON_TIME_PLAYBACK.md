# TASK132: relativ tidsuppspelning i publik jämförelse av två rutter

## Status

Klar. ADR-0137 beslutades före produktkod.

## Mål

En besökare kan spela upp två redan godkända publika deltagarrutter på samma
historiska karta, från var sin GPX-fils relativa inspelningstid, utan att
systemet påstår gemensam tävlingsstart eller GPS-verifierade passagetider.

## Avgränsning

Ingår:

- ett versionerat, strikt pixel-only playbackfält per sida i TASK121:s redan
  godkända två-ruttsprojektion;
- en lokal gemensam play/pause/starta om-/tidsreglage i den befintliga
  jämförelsevyn när båda källorna har komplett monoton GPX-tid;
- två markörer med självständiga segmentgap och olika varaktigheter.

Ingår inte: ny lagring, writer, samtycke, release, resultat- eller splitdata,
officiell tidslinjering, normaliserad fart, fler än två rutter, GPS-live,
mobilinspelning, FIT/TCX, OMAP, Eventor, SPORTident, stafett eller hårdvara.

## Acceptans

1. Endast en redan TASK121-kompatibel jämförelse där båda rutterna har komplett
   monoton GPX-tid visar spelaren.
2. Varje playbackfält innehåller enbart relativ heltalsmillisekund per redan
   publicerad pixelpunkt; inga WGS84-, absoluta tids-, interna-, hash-,
   objekt- eller resultatfält tillkommer.
3. Båda markörer börjar vid var sin relativa nollpunkt. En markör interpolerar
   aldrig över segmentgap och döljs när dess rutt är slut medan den andra
   fortsätter.
4. En tidlös/otidsenlig sida ger fortsatt jämförelse utan spelare och utan
   fabricerade data.
5. Play/pause/starta om/reglage är lokala, skriver inget och beskriver tydligt
   att det inte är tävlingstid, kontrollpassage eller synkad start.
6. Återtaget samtycke/release/karta eller inkompatibel historisk bana ger
   fortsatt ingen jämförelse eller playback.

## Proportionell verifiering

1. Kontraktstest av båda playbackprojektionernas strikthet och koppling till
   respektive route-metadata.
2. Befintligt isolerat PostgreSQL-routefall: två tidsatta rutter, olika
   varaktighet, plus samma fail-closed jämförelsegrind.
3. Litet rent webtest för två markörer, segmentgap, avslutad kortare rutt och
   ogiltigt underlag.
4. Ett 390 px-Playwrightfall med två syntetiska tidsatta rutter, reglage och
   integritetskontroll, plus berörd lint/typecheck/build.

## Kvarvarande antaganden

- GPX-tiden är användarregistrerad och säger inte när deltagaren officiellt
  startade, passerade en kontroll eller stämplade.
- Fysisk mobil, extern proxy och produktionstest ingår inte.


## Resultat

- contracts: lint och typecheck exit 0; riktat kontraktsprov 3/3;
- application: lint och typecheck exit 0; riktat PostgreSQL-prov 1/1;
- web: lint och typecheck exit 0; riktade webtester 2 filer/6 tester;
- E2E TypeScript och ESLint: exit 0;
- Playwright: 1/1 passerade på 5,3 s vid 390 px;
- contracts-, application- och webbyggen: exit 0. Webbygget kompilerade på
  3,7 s och TypeScript-steget tog 6,3 s.

Browserprovet använder två syntetiska, validerade pixelrutter med olika
relativa varaktighet och ett segmentgap. Det kontrollerar båda startmarkörer,
gapet, att den kortare rutten döljs när den andra fortsätter, omstart och
spel-/pausknappar. PostgreSQL-provet bevisar den befintliga samtycke-/release-/
historikgrinden för båda playbackprojektionerna. Inga verkliga deltagare,
kartfiler, GPS-inspelningar eller externa tjänster användes.
