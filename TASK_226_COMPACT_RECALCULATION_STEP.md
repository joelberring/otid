# TASK226: kompakt omberäkning före fastställande

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

I `Efter tävlingen` ska arbetsordningen vara lätt att skanna: omräkning av
äldre underlag vid behov, därefter fastställande och till sist filhämtning.
Den sällan använda klassvisa massomberäkningen ska finnas tidigt men inte
ta upp en stor tom panel när den är stängd. Mobilen ska behålla minst 44 px
tryckmål; datorn ska visa fler åtgärder i samma vy.

## Avgränsning

Flytta den befintliga expanderbara `Räkna om flera resultat`-delen från
slutet av `/manage` till början av `Efter tävlingen`, direkt före TASK225:s
fastställande. Ta bort dess dekorativa panelram och dubblerade synliga
rubrik, men behåll sammanfattning, förklarande text, klass-/deltagarurval,
manifest, granskning, osäkert återförsök, autoöppning för pågående försök,
alla `disabled`-villkor och samma komponentinstans per renderad vy.

Detta är enbart presentation av befintlig funktion. Inga resultat räknas
om automatiskt; inga API-, behörighets-, journal-, databas- eller
resultatregeländringar. Ingen ADR behövs eftersom teknik och domängränser
är oförändrade. Ändra endast de två berörda Reactkomponenterna och den
scopade CSS-modulen; svensk text är redan externaliserad.

## Riktad acceptans

Vid 390 och 1280 px: den stängda omberäkningsraden kommer före direkt
synligt fastställande och före separat export, är högst en kompakt rad,
har minst 44 px tryckmål och ger inget sidspill. Öppnad rad visar fortsatt
klassval och förklaring utan dubblerad rubrik. Riktad webblint/typecheck/
build och ett syntetiskt browserfall räcker; ingen databas eller verklig
credential används. Serverns omräkningssemantik provas inte om.

## Utfall

Samma omberäkningskomponent ligger nu som en tunn, stängd rad före
fastställandet. Den gamla kortpanelen längst ned är borttagen.
Öppnad rad har kvar klassval, förklaring, manifest och befintlig
granskning/återförsök utan upprepad rubrik. En pågående begäran öppnar
fortfarande raden automatiskt. Den närliggande granskningspanelen för
fastställande är begränsad i bredd på dator; mobilens fulla bredd behålls.

Webblint, web-typecheck, E2E-TypeScript, E2E-ESLint, checkin-förberedelse
och web-build gav alla **exit 0**. Ett riktat syntetiskt browserprov
gav **1/1, exit 0** med 390/1280 px, kompakt 44 px mobilrad,
ordningen omberäkning → fastställande → export, öppnat innehåll utan
dubbelrubrik, inget sidspill och oförändrad idempotent retry av
fastställandet. Bilderna granskades. Ett första browserkommando använde
ett grep-uttryck som inte matchade testnamnet och gav **exit 1, inga
tester funna**; selektorn rättades och det sista provet passerade.

Endast syntetiska browser-API-svar användes. Ingen omberäkning eller
officiell finalisering skrevs, och ingen verklig databas, credential
eller fysisk enhet ingick. Funktionärers faktiska förståelse av ordningen
är ännu ett öppet användbarhetsantagande.
