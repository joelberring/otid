# TASK165: vald resultatkontrolltid i privat GPX-uppspelning (C3d)

Status: syntetiskt verifierad 2026-09-23 enligt ADR-0158; inte fältklar.

## Användbart utfall

Deltagaren väljer en publicerad kontrollrad och ser motsvarande **tidpunkt**
på sin redan manuellt justerade, privata GPX-tidslinje. Det framgår att
GPS-markören inte verifierar kontrollpassage och när tid/position saknas.

## Bygg endast detta

1. Behåll den skyddade privata overlayen på formatversion 4. Kräv i
   kontraktet samma resultatrevision för tillgänglig start och splits samt
   unika `(controlCode, occurrence)`-rader.
2. Lägg en ren beräkning för en vald ackumulerad kontrolltid ovanpå TASK164:s
   offset. Endast säkra heltal och tid inom GPX-serien får ge hopp; inget
   klampas eller matchas mot kontrollgeometri.
3. Lägg ett kompakt svenskt val och en hoppåtgärd vid befintlig privat
   resultatsplit/uppspelning. Valet är tillfälligt, pausar uppspelning och
   nollställs med rutt-/kontext-/resultatrevision. Visa tydligt när vald tid
   hamnar utanför eller i en GPX-segmentlucka.

## Minsta verifiering

- Riktade kontrakts- och rena tidsgränsprov.
- Befintlig isolerad PostgreSQL-integration för effektiv revision, exakt
  entry/kurs, MP/saknad split och återkallad deltagarkoppling.
- Ett 390px-browserfall för val, hopp, offset, saknad/utanför och ingen
  horisontell scroll.
- Berörd lint/typecheck, riktade tester och build med exakta resultat.

## Ingår inte

Automatisk kontrollpassage, kontrollring/GPS-matchning, officiell
resultatändring, persisterat val, offlinecache, OMAP, GPS-inspelning,
fler-ruttjämförelse, ny migration eller fältacceptans.

## Utfall och verifiering 2026-09-23

Den privata vyn erbjuder ett kompakt val av en publicerad kontrollrad och
ett hopp till dess **tidpunkt** i den manuellt justerade GPX-serien. Valet
stannar i minnet; utanförliggande tid klampas inte. Vid segmentlucka kan
tidslinjen sökas, men ingen kartmarkör fabriceras och luckan förklaras.
Overlayen är fortsatt formatversion 4. Kontraktet avvisar revisioner som
inte matchar och dubbla kontrollkod/förekomst-par när båda resultatgrenarna
är tillgängliga.

Riktade enhetsprov med installerade lokala binärer: **7 filer, 31/31 tester**.
Befintlig application-integration mot separat isolerad syntetisk PostgreSQL:
**1/1**. Ett 390px-browserfall mot riktig Next/HTTP och egen syntetisk
underdatabas: **1/1**, med val, offset, hopp, utanför-läge, saknad GPX-tid,
segmentlucka och ingen horisontell scroll. Endast kartbildens bytes
simulerades. Berörd ESLint och TypeScript-kontroll för contracts,
application, web och e2e: exit 0. Contracts- och application-build,
`build:checkin` och Next-produktionsbuild: exit 0. `pnpm`-wrappern försökte
hämta från registry och misslyckades med `ENOTFOUND`; den räknas inte som
grön. Proven kördes i stället med installerade lokala binärer. Ingen bred
workspace-svit, riktig tävling eller fysisk enhet användes.

Kvarvarande antaganden: resultattider kan vara preliminära och en öppen
sida uppdateras först vid ny läsning. Verkliga klockfel, kartprecision,
objektlagring, GNSS och mobilbeteende är inte fältverifierade. Den
separata syntetiska PostgreSQL-instansen stoppades och dess exakta 78 MB
tempkatalog raderades efter proven; den kan inte återställas.
