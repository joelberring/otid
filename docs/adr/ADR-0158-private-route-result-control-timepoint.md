# ADR-0158: publicerad kontrolltid som tidpunkt i egen GPX-uppspelning

- Status: Accepterad för C3d/TASK165 före implementation
- Datum: 2026-09-23

## Kontext

ADR-0155–0157 skiljer en tidsatt privat GPX-rutt från resultatets aktuella
publicerade start och sträcktider. Deltagaren kan redan justera GPX-klockan
manuellt och hoppa till resultatstarten. Nästa lilla analyssteg är att kunna
se var **tiden** för en vald publicerad kontroll hamnar i samma uppspelning.
En GPS-position vid den tiden är inte bevis för att kontrollen passerades
där. Resultatet kan senare rättas, och GPX kan ha segmentluckor.

## Beslut

Återanvänd exakt den kontoskyddade, `no-store`-lästa privata overlayen från
TASK164. Ingen API-form, resultatrevision, migration eller serverläsare
tillkommer. Klienten erbjuder ett kompakt val av **en** rad ur det aktuella
`resultSplits.AVAILABLE`-underlaget, märkt med kontrollkod, förekomst och
ackumulerad resultattid. Valet är bara sidtillstånd och nollställs vid byte
av rutt, kontext eller aktuell resultatrevision. `resultStart` och
`resultSplits` måste båda vara tillgängliga och ha **samma revision**;
kontraktet avvisar mismatch och dubbla `(controlCode, occurrence)`-nycklar.
GPX-tid och uppspelning måste vara tillgängliga, och vald rad måste
fortfarande finnas i det aktuella svaret. MP:s partiella stämplingar
används inte, eftersom TASK163 medvetet inte publicerar resultatsplittar
för MP här.

Låt `G` vara GPX:s första absoluta tid, `R` publicerad resultatstart, `O`
användarens signerade heltalsförskjutning i sekunder och `S` den valda
kontrollradens ackumulerade `elapsedMs`. Motsvarande GPX-tid från första
punkten är `T = R − (G + 1 000 × O) + S`. En ren deterministisk funktion
kräver säkra heltal och accepterar hopp bara när `0 ≤ T ≤ GPX-duration`.
Resultatstarten själv får ligga utanför GPX-spåret om den **valda
kontrolltiden** ligger inom det; inget klampas till början eller slut.
Hoppet pausar och flyttar endast den befintliga uppspelningsmarkören.
Vid segmentbrott får ingen interpolerad GPS-position fabriceras: den
befintliga markörfunktionen ger då `null`, och vyn förklarar att position
saknas vid just den tidpunkten.

UI kallar detta en **tidpunkt enligt resultatet** i GPX-spåret, inte en
GPS-verifierad kontrollpassage. Resultatets kod/förekomst används som
etikett för valt tidsvärde, aldrig för geometrisk matchning mot kontroll-
ringen. Varken GPX-punkter, officiella splits, offset, ruttpublicering,
server, URL eller offlinekö skrivs. En öppen sida är en läst ögonblicksbild;
en ny publicerad revision hämtas vid ny läsning, inte genom ett löfte om
liveuppdatering.

## Verifiering och konsekvenser

Riktade kontraktsprov avvisar mismatch/dubbletter. Rena tidsprov täcker
offset, upprepade kontrollkoder via förekomst, ändpunkter, saknad/ogiltig
tid, negativa/överstora värden och utanförliggande kontrolltid utan
klampning. Befintligt isolerat PostgreSQL-prov för aktuell revision,
exakt entry/kurs och nekad fel användare återanvänds. Ett 390px-browser-
fall provar val av en kontroll, hopp/pause, missläge, revisionsskifte och
tydlig provenance-text. Berörd lint, typecheck och build körs. Detta är
inte fältbevis för klockprecision, faktisk kontrollpassage eller fysisk
mobil.
