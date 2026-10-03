# TASK131: relativ tidsuppspelning av publik deltagarrutt

## Status

Klar.

## Mål

En besökare kan spela upp en redan samtyckt och publicerad deltagarrutt på den
befintliga publika kartan, från GPX-filens egna relativa tidsföljd. Funktionen
ska ge post-event-förståelse utan att påstå kontrollpassager eller officiell
tävlingstid.

## Beslut och avgränsning

ADR-0136 gäller. Implementationen använder bara den existerande
`readPublicParticipantRoute`-vägen och utökar dess validerade pixelprojektion
när — och endast när — GPX-tidsföljden redan är komplett och monoton.

Ingår:

- versionerat publikt playback-underlag med pixelposition, segment och relativ
  millisekund;
- skrivfri serverprojektion genom befintlig samtycke-/release-/kartgrind;
- kompakt svensk play/pause/starta-om-/tidsreglage i befintlig en-ruttvy;
- ingen interpolation över segmentgräns.

Ingår inte: ny lagring eller writer, publik jämförelseuppspelning, resultat- /
splittider, kontrollpassager, tempo, vägval, höjd, GPS-live, mobilinspelning,
FIT/TCX, OMAP, Eventor, SPORTident, stafett eller hårdvara.

## Acceptans

1. Bara en redan fullt godkänd publik rutt med komplett monotona GPX-tider
   ger playback; tidlös eller oordnad källa ger ingen spelarkontroll.
2. Varje publikt playbackprov innehåller enbart pixelposition, segment och
   relativ heltalsmillisekund, aldrig WGS84, absoluta GPX-tider, interna id:n,
   hash eller resultatdata.
3. Markören interpolerar bara inom samma segment och döljs över segmentgap.
4. Play/pause, starta om och reglage är rent lokala och ändrar inte route,
   resultat eller serverdata.
5. Återtaget samtycke/release/karta ger fortsatt ingen offentlig rutt- eller
   playbackläsning.

## Proportionell verifiering

1. Kontraktstest för strikt relativ playbackform och otillåtna fält.
2. Ett befintligt isolerat PostgreSQL-routefall som bevisar komplett relativ
   tidsföljd och samma fail-closed releasegrind.
3. Ett litet rent webtest av tidsmarkören för interpolation och segmentgap.
4. Ett 390 px Playwright-fall med play/pause/reglage på syntetisk publicerad
   rutt, plus berörd lint/typecheck/build.

## Kvarvarande antaganden

- GPX-tidsföljd är användarregistrerad källa och verifierar varken GPS-kvalitet
  eller kontrollpassage.
- Fysisk mobil, extern proxy och produktionstest ingår inte i detta snitt.

## Resultat

- contracts: lint och typecheck exit 0; riktat kontraktsprov 3/3;
- application: lint och typecheck exit 0; riktat PostgreSQL-prov 1/1;
- web: lint och typecheck exit 0; riktade webbtester 2 filer/5 tester;
- E2E TypeScript och ESLint: exit 0;
- Playwright: 1/1 passerade på 3,6 s vid 390 px;
- contracts-, application- och webbyggen: exit 0. Webbygget kompilerade på
  1,305 s och TypeScript-steget tog 6,2 s.

Browserprovet använder en riktig serverrenderad syntetisk deltagare samt
syntetiska, validerade rutt-/kartsvar. Det kontrollerar tidsreglage till
slutpunkten, återställning till första punkten och avsaknad av känsliga
identifierare i renderad sida. PostgreSQL-provet fortsätter att bevisa den
befintliga samtycke-/release-/historikgrinden för den routeprojektion som nu
även lämnar relativ tid.
