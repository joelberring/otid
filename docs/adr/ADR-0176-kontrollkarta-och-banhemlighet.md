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

## Konsekvenser

- Rutterna på vägvalskartan visas som förut (bara för publicerade resultat, ADR-0171 beslut 5); de visar var löparna
  sprungit, inte banan.
- IOF-resultatexporten innehåller bara sträcktider med kontrollkoder, inga lägen, och påverkas inte.
