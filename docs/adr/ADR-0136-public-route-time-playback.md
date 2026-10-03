# ADR-0136: relativ tidsuppspelning av en exakt publicerad deltagarrutt

- Status: Accepterad för TASK131
- Datum: 2026-09-22

## Kontext

TASK117–125 kan, efter separat samtycke, release, kartrelease,
georeferens- och historisk bankontroll, visa exakt en publicerad GPX-rutt som
en pixelbana med härledd metadata. Den publika vyn visar att en komplett GPX
har tidsinformation men kan ännu inte låta en besökare följa den registrerade
rutten över tid. Det är ett konkret post-event-värde på väg mot O-Tids egna
spåranalys, men det får inte antyda GPS-verifierade kontrollpassager,
officiella resultatider eller en liveföljning.

## Beslut

TASK131 får lägga en **frivillig, klientlokal relativ tidsuppspelning** i den
redan tillgängliga offentliga en-ruttvyn. Den återanvänder exakt samma
read-only releasegrind som TASK117: aktivt samtycke för exakt routemanifest,
aktiv route-publication, exakt aktiv kartrelease, georeferens, publicerat
resultathuvud och historisk kontrollgeometri. Om någon befintlig grind inte
passerar är hela ruttvyn fortsatt `not-found`; tidsdata får aldrig vara en
egen öppnare läsväg.

Endast en rutt där varje lagrad GPX-punkt har en ändlig tidsstämpel i en
globalt monoton källordning får `AVAILABLE` uppspelning. Servern skickar
endast pixelkoordinat, segmentnummer och **heltalsmillisekunder relativt
första GPX-punkten** för samma redan publicerade punkter. Absolut GPX-tid,
WGS84, entry-/upload-/publication-id, hash, objektlagring och resultatdata
tillkommer inte i uppspelningsfältet.

Klienten visar full rutt som tidigare och en tydlig markör som kan spelas,
pausas, startas om eller flyttas via en tillgänglig relativ tidsreglage. Den
interpolerar endast mellan två följande punkter i samma GPX-segment. Mellan
segment visas ingen interpolerad övergång; markören döljs i sådant gap tills
nästa registrerade segmentpunkt. Det förhindrar en uppfunnen väg över
avbrott. Ett spår utan komplett monotona tider visar ingen spelare, men den
befintliga tidlösa ruttvyn består.

Texten ska uttryckligen säga att detta är uppspelning av GPX-spårets relativa
inspelningstid, inte tävlingstid, kontrollpassage, officiell split eller
liveposition. Start/pause/sökning ändrar bara lokalt komponenttillstånd och
skriver aldrig till servern.

## Konsekvenser

- Den publika vyn får en liten, användbar post-event-funktion utan ny
  lagring, writer, behörighet eller extern tjänst.
- Release- eller samtyckesåtertagande stänger även uppspelningen genom samma
  befintliga routegrind.
- Fler rutter i samma spelare, gemensam masstart, kontrollpassagetider,
  sträcktempo, vägvals-/höjdanalys, GPS-live, mobilinspelning, FIT/TCX och
  OMAP är fortsatt separata beslut.

## Avvisade alternativ

- Att härleda punktid från officiella splits: skulle fabricera passagepunkter.
- Att publicera WGS84 eller absolut GPX-tid enbart för animation: bryter den
  befintliga pixel-only-/minimeringsgränsen utan behov.
- Att interpolera över GPX-segment: skulle påstå en väg som filen inte innehåller.
- En separat analys- eller realtime-tjänst: oproportionerligt för en enda
  skrivfri publiksida.
