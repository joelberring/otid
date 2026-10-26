# ADR-0176: Kontrollkartan och banhemlighet

Status: beslutad 2026-10-26 (PLAN.md steg 52, ägarens önskemål samma dag). Kompletterar ADR-0171 och ADR-0175.

## Bakgrund

Steg 49 visar gafflingsbilden (med kontrollkoder) i den publika resultatlistan och på deltagarsidan, och banan med
kontrollernas lägen på den publika vägvalskartan, så fort den första löparen har ett resultat. Under tävlingen avslöjar det
banorna för dem som inte har startat. Ägaren (2026-10-26): "På den publika vyn ska inte alla kontroller synas förrän alla
gått i mål".

## Beslut

1. **Banorna är publika** när något av detta gäller (domänen `courseSecrecy`, `packages/domain/src/course-secrecy.ts`):
   arrangören har valt "Visa banorna publikt nu"; resultaten är fastställda ("Resultaten är klara",
   `race.official_result_finalization_id`); eller det finns minst en ej struken deltagare och alla ej strukna har ett
   resultat eller ett beslut (även ej start). Ett borttaget beslut (`MANUAL_RESULT_REMOVED`) räknas som inget resultat.
   Utan deltagare är banorna hemliga, annars vore de publika innan anmälan öppnar. Läget räknas vid varje fråga, så en
   efteranmäld löpare döljer banorna igen (utom när resultaten är fastställda eller arrangören valt att visa dem).
2. **Innan dess publikt:** ingen gafflingsbild ("Visa gafflingar" i resultatlistan och på deltagarsidan; `classCourses`
   saknar `forking`), ingen bana med kontrollägen på vägvalskartan (`course` saknas), ingen publik kontrollkarta och inga
   kontrollägen i något publikt API. Variantkoden som text och sträcktiderna med kontrollkoder står kvar som i dag.
3. **Arrangören och funktionärerna ser allt.** De publika svaren tar med banorna när den inloggade har behörighet på
   tävlingen (`isRaceStaff`; arbetsytans resultatlista använder samma API). Ett sådant svar sparas aldrig i en delad cache
   (`private, no-store`).
4. **"Visa banorna publikt nu"** (Publicera → Banorna publikt) sparas som `race.courses_public_at` (migration 0026) med en
   auditpost (`COURSES_REVEALED_BY_ADMIN`) och går att ångra ("Dölj banorna igen", `COURSES_REVEAL_WITHDRAWN_BY_ADMIN`).
   Samma val igen ändrar inget. Arbetsytan visar läget i en mening: hemliga med antalet löpare utan resultat, eller
   publika och varför.

5. **Kontrollkartan** (ägaren 2026-10-26: "se vilka kontroller som finns, växla mellan banor, se vilka kontroller som är mest
   belastade och kanske visa vilken kontroll någon har stämplat fel på") finns bakom knappen "Kontrollkarta" i Banor, i en
   egen dialog så att den inte tar plats vid vanlig genomgång. Egen SVG utan bibliotek och utan extern kartdata, bara
   färgtoken. Lägena läggs i en gemensam ram av domänen (`layoutControlMap`): kartbildens pixlar när kartan är georefererad
   (bilden under, beskuren till kontrollerna), annars meter runt mittpunkten med norr uppåt, annars kartlägena ur banfilen.
6. **Kartlägen** (IOF `MapPosition`, mm, y uppåt) och kartans skala (`Map/Scale`) sparas vid inläsningen (migration 0026:
   `control.map_x/map_y`, `course.start_map_position/finish_map_position`, `race.course_map_scale`) och används när lägena i
   WGS 84 saknas. En kontroll med bara kartläge placeras i en WGS 84-ram när minst två andra punkter har båda (likformig
   anpassning). Utan skala är avstånden ungefärliga och skalstocken saknas.
7. **Bana och variant:** vald bana (en variant eller alla) med sträckor kortade vid ringarna och kontrollens nummer;
   övriga varianter och kontroller nedtonade. En gafflad bana visar också gafflingsbilden (ADR-0175).
8. **Belastning per kontroll** (`controlLoads`): antal banor, varianter (en bana utan gafflingar räknas som en), planerade
   löpare (ej strukna vars bana eller variant har kontrollen; utan variant bara kontroller som alla varianter har) och
   stämplingar (avlästa löpare med sträcktid vid kontrollen). Färg och storlek efter nivå (tre nivåer relativt den mest
   belastade) och alltid samma siffror i en tabell. En kontroll ur funktion är markerad med ett kryss och i tabellen.
9. **Löparens bana** ("Visa på kartan" i deltagarkortet, `runnerControlMarks`): en kontroll med sträcktid är stämplad, en
   utan sträcktid som finns bland brickans extra stämplingar är stämplad i fel ordning, annars saknas den ("Kontroll 47
   saknas, mellan 46 och 48"); en kontroll ur funktion är frivillig. En stafettlöpare får sin sträcka, en teamsprintlöpare
   alla sina sträckor (samma bricka). Markeringarna finns bara när resultatet bygger på en avläsning.
10. **Publikt** finns "Visa på kartan" på deltagarsidan bara när banorna är publika (beslut 1–3), byggt ur löparens
    publicerade resultat: bara löparens egna kontroller, start och mål, inga andra löpares data och ingen belastning.
11. **Utan lägen** ritas ingen karta: arbetsytan visar gafflingsbilden och kontrollerna i ordning, tabellen finns kvar och
    deltagarkortet visar beskeden. Inget fel.

## Konsekvenser

- Rutterna på vägvalskartan visas som förut (bara för publicerade resultat, ADR-0171 beslut 5); de visar var löparna
  sprungit, inte banan.
- IOF-resultatexporten innehåller bara sträcktider med kontrollkoder, inga lägen, och påverkas inte.
- Kontrollkartan finns bara för admin (funktionärens rutter är oförändrade). Den publika kartan har ingen stafettsträcka,
  eftersom den publika deltagarsidan bara finns för individuella resultat.
- Kartbilden ritas bara när kartan är georefererad (ADR-0171); kartlägen i mm kopplas inte till en bild.
