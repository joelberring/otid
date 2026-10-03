# TASK231: öppna exakt klass från banvarningen

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

Från varningen i `Före tävlingen` → `Banor` ska funktionären kunna
öppna just den berörda klassposten, även när flera klasser har samma
visningsnamn och banversion. Landningen ska tydligt visa vilken rad som
valdes utan att exponera interna UUID:n.

## Avgränsning

Återanvänd den befintliga läsande navigeringen till `Före tävlingen` →
`Klasser` och skicka klassens interna ID enbart i klientens callback.
Varningens rader får varsin tangentbordsstyrbar knapp med minst 44 px
tryckyta och en begriplig svensk etikett. Likalydande rader ska ha en
synlig, deterministisk radbeteckning från klassernas ordning i det
aktuella deltagarunderlaget. Den valda klassraden ska kunna särskiljas
även på målsidan; sökning och övriga klassrader ska fortfarande vara
tillgängliga. Under låst arbetsflöde får åtgärden inte navigera.

Varningen är inte bevis för att banan är raderad eller att en
banomkoppling bör göras. Öppna inte en ändringsgranskning automatiskt,
och gör inga dataskrivningar. Ingen API-, domän-, databas-, behörighets-
eller teknikändring; ingen ADR krävs.

## Riktad acceptans

Utöka det befintliga syntetiska browserfallet med 60 klasser, 12 banor
och två identiskt namngivna varningsrader. Båda raderna ska kunna
aktiveras var för sig, landa på `Klasser` med rätt internt vald post och
en synlig markering som skiljer dem. Kontrollera 390 och 1280 px,
tangentbord, minst 44 px mobilmål, ingen rå UUID och inget sidspill.
Riktad lint/typecheck/build och ett återanvänt browserfall räcker.

## Utfall

Varje berörd klassrad har nu en läsande åtgärd som skickar exakt
klass-ID i klientcallbacken. Identiska namn, bannamn och versioner
skiljs synligt med klassradens position i det aktuella underlaget.
Klassöversikten markerar och fokuserar exakt motsvarande rad, med
texten `Vald klassrad N`; dess vanliga sökning fungerar fortfarande,
inklusive nollträff. Inget formulär eller banbyte öppnas automatiskt.

Webblint, web-typecheck, E2E-TypeScript/ESLint, checkin-förberedelse
och web-build gav **exit 0**. Det återanvända syntetiska Playwright-
fallet passerade **1/1, exit 0**, med två likalydande rader, exakt
olika vald klass, Enter-aktivering, minst 44 px mobilmål, sökning och
ingen rå UUID eller horisontellt sidspill vid 390/1280 px. Mobil-
och datorbilderna granskades. Ett första buildkommando använde fel
relativ binärsökväg och gav **exit 127**; det korrigerade buildkommandot
gav **exit 0**. `pnpm`-wrappern ville oavsiktligt starta en
installation i denna miljö, så installerade lokala binärer användes.

Ingen riktig tävling, fysisk mobil, databasändring, credential eller
funktionärsacceptans ingick. Klassradens ordningsnummer är en etikett
i det aktuella hämtade underlaget, inte en beständig extern identitet.
