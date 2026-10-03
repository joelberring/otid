# TASK240: tät neutral ruttjämförelse med läsbar kartzoom

Status: implementerad och syntetiskt browser-verifierad 2026-09-27.

## Användarutfall

En oinloggad besökare ska kunna jämföra två eller tre redan publicerade
och kompatibla deltagarrutter på mobil, padda och dator utan stor grön
sidkrom, upprepade kortytor eller en karta som förblir för liten att läsa.
Personernas färgkopplade rutter, fakta, resultatsplits och relativ GPX-
uppspelning ska fortfarande vara begripliga och åtkomliga.

## Avgränsat UI-beslut före implementation

Ge endast jämförelsesidan en sidlokal ljus/grå grund, kompakt rubrik och
navigering, tunna avdelare för ruttfakta/splits och lågmälda knappar.
Behåll Röd/Blå/Grön i text och som särskiljande rutt-/markörfärger;
färgerna är alltså datakoppling, inte dekorativ normalstatus. Ingen global
palett, fontfamilj, annan resultatsida eller speaker-/stationssignal ändras.

Lägg en namngiven, fokuserbar visningsyta runt den enda befintliga SVG:n.
Hela kartan visas på 1×. Synliga svenska knappar zoomar i halva steg
1×–4×, visar aktuell procent och återställer. Förstora SVG:ns verkliga
layoutmått så ytan kan panoreras med browserns vanliga touch-svep och
piltangenter när scrollutrymme finns. Bevara synligt centrum inom gränserna.
Bild, 2–3 ruttlinjer, kontrollringar och uppspelningsmarkörer stannar i
samma viewBox. På print passar hela kartan oberoende av skärmzoom.

Vid ny jämförelseidentitet återgår zoom och pan till helkarta. 404/503
visar varken karta eller verktyg. Återanvänd TASK239:s interaktionsmönster
men undvik ny dependency eller en generell kartmotor. Inga nya API:er,
DTO:er, resultatsplits, publicerings-/samtyckesbeslut, databasändringar
eller domänregler. Ingen ADR behövs eftersom teknikval och domängränser
är oförändrade.

## Riktad acceptans

Med syntetiskt jämförelseunderlag för två och tre rutter: 320/390/1280 px
har 1× ingen horisontell sidspill; 2×/4× får verkliga scrollbar kartmått;
zoom, återställning, tangentbordspanorering och centrum fungerar; alla
rutter, kontrollkoder och uppspelningsmarkörer ligger kvar i SVG:n.
Färgkopplad text och signal finns kvar, men faktakort, splitkort och
uppspelning är kompakt avdelade. 404/503 har inga kartkontroller. Print
visar hel karta. Riktad lint/typecheck, ett litet monterat browserprov
och webbuild räcker. Ingen DB-suite utan isolerad PostgreSQL.

## Ingår inte

Nya ruttdata, GPS-live, kartprecision, pinch-gest, synkad start,
kontrollpassagetid, fler än tre rutter, fysisk enhets- eller fältacceptans.

## Utfall

Jämförelsesidan har nu samma lugna ljus/grå sidkrom och kompakta
text-/avdelarrytm som den publika deltagarrutten. Ruttfakta och
resultatsplits är avdelade rader i stället för stora kort; Röd/Blå/Grön
är kvar som text och linje-/markörfärger. Den befintliga SVG:n med bild,
alla rutter, kontroller och uppspelningsmarkörer ligger i en enda
fokuserbar visningsyta med 1×–4×-zoom, native scroll/pan,
tangentbordspilar, återställning och synlig procent. Vid ny
jämförelseidentitet återgår zoom och pan till helkarta. Print passar
helkartan; 404/503 visar inga kartverktyg.

Visuell granskning vid 320 px fångade först en två-ruttstabell vars fem
rubriker bröts mitt i orden. Den får nu en lokalt sidledsrullbar minsta
bredd och en synlig sveptext; kolumnrubrikerna anger Röd/Blå även
visuellt och har fullständiga deltagaretiketter för hjälpmedel. Sidan
själv får ingen horisontell spill. Vid 390 px fungerar tre rutter som
kompakta avdelade rader; 1280 px använder hela bredden.

Efter sista produktkodändringen: webblint **exit 0** och webb-TypeScript
**exit 0**; två relevanta testfiler **6/6, exit 0**;
browserhärvans TypeScript/ESLint **exit 0**; tre monterade syntetiska
jämförelsefall **3/3, exit 0** vid 320/390/1280 px och 404/503;
hela återanvända visuella sviten **9/9, exit 0**. Checkin-förberedelse
och Next-produktionsbuild gav **exit 0**. Ett första browserprov visade
en bruten kartbild på grund av en för snäv mock-URL; fixturen rättades
och ett HTTP 200-svar för kartbilden kontrolleras nu. Efterföljande
bilder granskades med kartan synlig.

Ingen faktisk Next-server, PostgreSQL, tävling, kartrelease eller
samtyckesgrind ingick i browserbeviset. Fysisk mobil-/touchhantering,
skärmläsare, verklig kartprecision och hög datavolym återstår.
