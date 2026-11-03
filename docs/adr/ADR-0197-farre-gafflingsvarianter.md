# ADR-0197: Färre gafflingsvarianter – välj bort de längsta

Status: beslutad 2026-11-03 (grenen `gaffling-urval`, migration 0063, ägarens önskemål samma dag inför Stockholm by Night 9 dec).
Bygger på ADR-0175 (gafflingsstruktur), ADR-0180 (banläggningen), ADR-0190 beslut 6 (längd längs vägval) och steg 61 (fel karta).

## Bakgrund

"När man gör fulgafflingar blir det väldigt många alternativ och vissa blir längre. Går det att ha en funktion som begränsar
bort alternativ som är längst i alla avseenden så att det kan bli färre gafflingsvarianter?" Tre gafflingar med två alternativ
ger åtta varianter, fyra med fyra 256; tävlingen tar högst 100 per bana.

## Beslut

1. **Bortvalet hör till banan i banläggningen.** `Course.excludedVariants` är en lista med `{ code, controls }` (koden och
   kontrollkoderna i ordning). Båda ska stämma; ändras banan så att varianten får en annan kod eller andra kontroller gäller
   bortvalet inte längre och varianten kommer tillbaka (det säkra hållet). Ändras med `UPDATE_COURSE` (`excludedVariants`,
   null = alla), så autosparandet, ångra (också efter omladdning och med flera samtidigt) och versionerna fungerar som för
   banans andra egenskaper. Minst en variant används alltid.
2. **Regeln är ren och generell** (`packages/domain/src/variant-pruning.ts`): en variant tas bort när en annan inte är längre i
   något mått som finns för alla varianter (fågelväg; längs vägval när den är räknad; stigning när den finns per variant) och
   kortare i minst ett. Lika långa (under en meter) tar aldrig bort varandra. Taken "högst X % längre än kortaste" och "högst N"
   behåller de kortaste (längs vägval om det finns för alla, annars fågelväg); den kortaste tas aldrig bort. Längsta först,
   deterministiskt. **Skyddet** (förval på): en variant behålls när den är den enda kvar med en kontroll eller sträcka, så
   att ingen gren står oanvänd. Med bara fågelvägen betyder "längst i alla avseenden" i praktiken "de kortaste plus det som
   behövs för att alla grenar springs"; med längd längs vägval blir en variant kvar som är kortare längs vägval.
3. **Stigning per variant finns inte** (banan har en stigning, ingen höjdmodell). Måttet finns i regeln men visas inte.
4. **Editorn**: panelen Varianter i fliken Banor med tabell (fågelväg, längs vägval, kontroller, skillnad mot kortaste i m och
   %), kryssruta per variant, "Räkna längs vägval" för alla varianters sträckor (vägvalens Worker, samma tabell som banans
   längd, en sträcka räknas en gång), "Begränsa varianter" med förhandsgranskning (vad som går, vad som blir kvar och varför)
   innan något ändras, och en rad "8 varianter, 4 används (4 bortvalda som längre)". Banlistan säger "4 varianter (4 bortvalda)".
5. **Bortvalda används inte**: de räknas inte i sammanfattningen, längden, kontrollen av banan, IOF XML (banor), utskriften av
   kartor och beskrivningar, och förs inte över till tävlingen. I tävlingen finns bara de behållna som varianter, så lottning,
   "Fördela gafflingar", efteranmälan, stafettens fördelning och tävlingens IOF-exporter använder dem utan ändring.
   `forkingReadiness` räknar antalet och bokstäverna på de behållna (`excludedVariantCodes`) och arbetsytan visar antalet bortvalda.
6. **Avläsningen** (migration 0063, `course_version.excluded_variants`, högst 1000): de bortvalda följer med banversionen och
   ögonblicksbilden. `excludedVariantsFitting` säger när en felstämplad löpare (mot sin variant, eller mot alla behållna när
   löparen saknar giltig variant) passar en bortvald variant utan fel: beskedet "Stämplingarna passar BDF, som är bortvald i
   banläggningen. Fick löparen fel karta?" i avläsningen, på kvittot, i deltagarkortet och i deltagarlistan. Bara ett besked som
   fel karta (steg 61): status och variant ändras inte, ingen döms ut tyst på grund av bortvalet. En löpare som redan fått en
   variant som sedan väljs bort saknar variant i kontrollen före tävlingen, som förut när en variant försvinner.
7. **.ppen kan inte bära bortvalen.** Purple Pens format har bara stafettens fasta grenar per sträcka (`relay-branch`), inga
   bortvalda varianter. De skrivs som träningen (ADR-0192 beslut 10) i ett eget element sist i filen, `<otid:variants>` i
   namnrymden `https://o-tid.se/ns/ppen-variants/1` med JSON; Purple Pen hoppar över det. En fil som sparats i Purple Pen
   saknar det, och då följer bortvalen med från banläggningen när filen läses in (`carryExcludedVariants`: samma bana, och bara
   bortval vars kod och kontroller finns i den nya filen).
8. **Utjämnad gaffling och stafett: varnar, stoppar inte.** Bortval är till för fulgaffling. En utjämnad bana (BALANCED) eller
   en utjämnad stafett (EVEN) behöver alla kombinationer för att sträckorna ska jämnas ut. Banläggningen vet inte tävlingens
   gafflingssätt; panelen varnar när banan har stafettlag i Purple Pen, och i tävlingen ger de befintliga kontrollerna varning:
   rättvisekontrollen för en utjämnad bana (sträckor som inte springs lika många gånger) och stafettens kontroll per lag (finns
   ingen rättvis kombination sprids varianterna som för fulgaffling och kontrollen varnar). Att stänga av funktionen för
   stafett vore fel för en fulgafflad stafett.

## Följder

- Stafettlagens varianter ur Purple Pen förs fortfarande inte över (ADR-0190); de bortvalda skulle inte heller ingå där.
- En banversion som ändras i tävlingens egen baneditor får inga bortvalda (avläsningens besked gäller banläggningens versioner).
