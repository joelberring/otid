# ADR-0137: relativ tidsuppspelning av exakt två publika deltagarrutter

- Status: Accepterad för TASK132
- Datum: 2026-09-22

## Kontext

TASK121–124 visar exakt två historiskt kompatibla, samtyckta och explicit
publicerade GPX-rutter. TASK131 kan spela upp en sådan rutt från filens egna
relativa tidsföljd. Jämförelsevyn saknar däremot ett sätt att visuellt följa
de två redan godkända vägvalen över deras inspelade förlopp.

En delad kontroll betyder inte att deltagarna startade samtidigt, att deras
GPX-klockor var synkroniserade eller att en punkt är en kontrollpassage. Den
distinktionen måste vara explicit innan samma klientklocka visas för två
rutter.

## Beslut

TASK132 får införa en frivillig, klientlokal relativ uppspelning i den
befintliga TASK121-jämförelsevyn. Varje rutt passerar fortfarande hela
TASK121-grinden: aktiv publicerad resultatrevision, samtycke, route-release,
kartrelease, exakt hashbindning, georeferens, historisk bana och kompatibilitet
med den andra rutten. Om någon av dessa gränser fallerar är jämförelsen fortsatt
not-found och tidsuppspelning får aldrig vara en egen läsväg.

Jämförelsens redan pixelbaserade rutter får varsin playback-projektion med
enbart heltalsmillisekunder relativt den ruttens första GPX-punkt. En sida är
AVAILABLE bara när dess GPX-punkter har en komplett globalt monoton
tidsföljd. En gemensam spelare visas endast om **båda** sidor är tillgängliga.
Den startar båda filerna vid deras respektive relativa nollpunkt och använder
den längsta av de två relativa varaktigheterna som reglagets intervall. Detta
är ett presentationshjälpmedel, inte synkning av tävlingsstart, officiell tid,
split, kontrollpassage eller GPS-verifierad position.

Under uppspelning interpoleras varje markör enbart mellan följande punkter i
samma GPX-segment. Markören döljs över segmentgap. När en rutt är slut men den
andra fortsätter döljs den avslutade markören; den låtsas inte att en senare
stillastående punkt är observation. Vid exakt slutpunkt får markören visas.
Klientens spela/pausa/starta om/reglage ändrar bara lokalt tillstånd.

Inga nya absoluta GPX-tider, WGS84-koordinater, interna identifierare,
hashar, objektlagringsuppgifter, officiella resultatfält eller splits får
läggas till i uppspelningsfältet. Befintlig metadata ändras inte och får inte
användas för synkning. En tidlös rutt behåller den befintliga jämförelsevyn
utan spelare.

## Konsekvenser

- Besökaren får en konkret, tydligt begränsad eftertävlingsjämförelse av två
  vägval utan ny serverwriter eller extern analystjänst.
- Olika GPS-startögonblick och -varaktigheter normaliseras inte och jämförs
  inte mot resultatets officiella tider.
- Fler rutter, masstart, kontrollpassagetider, tempo-/vägvalsanalys, höjd,
  GPS-live, mobilinspelning, FIT/TCX och OMAP kräver separata beslut.

## Avvisade alternativ

- Att härleda gemensam tid från resultatets start- eller splittider: skulle
  fabricera GPX-positioner och passagepunkter.
- Att normalisera båda rutterna till procent av deras längd: skulle skapa en
  konstruerad fartjämförelse som inte finns i källan.
- Att frysa en avslutad markör medan den andra fortsätter: kan misstolkas som
  en registrerad position vid den senare relativa tidpunkten.
- En realtime- eller separat analysprodukt: oproportionerligt för en skrivfri
  två-ruttsvy.

