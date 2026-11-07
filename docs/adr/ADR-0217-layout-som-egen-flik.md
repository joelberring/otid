# ADR-0217: Layout som egen flik – layouter, ark (bana × layout), justeringar per skala, klassens layout och sparade lägen

Status: beslutad 2026-11-07 (grenen `b3-layoutflik`, ägarens godkända skiss samma dag). Ingen migration: allt står i
banläggningens JSON-dokument. Bygger på ADR-0183 (layoutmallar, "Kartor per ark"), ADR-0197 (papperet), ADR-0203 (kartbyten),
ADR-0211 (beslut 5: skalan hör till banan) och ADR-0213 (löparkopplade kartor).

## Bakgrund

En bana skrivs ibland ut i flera format: Elit på A3 i 1:15 000, äldre på A4 i 1:7 500, resten som banan är lagd. I dag finns
en skala, en tryckyta och ett papper per bana, och papperet redigeras på utskriftssidan. Ägaren vill skilja på *model space*
(Banläggning: kartan och banorna), *paper space* (Layout: allt om papperet) och utskriften (vad, hur många, vart).

## Beslut

1. **Flikarna** i banläggningen: Banläggning | Layout | Utskrift. Layoutfliken har överblicken, layouterna, arket, klasserna
   och lägena; Utskrift har bara vad, antal, färger och PDF/skrivare (ingen redigering av papperet).
2. **Layout** (`event.layouts[]`, `PrintLayout`): id, namn, skala, papper (storlek, marginal och riktning i 1/100 tum som
   `PrintArea.page`), mall för papperet (`paperTemplate`, ADR-0197) och "Kartor per ark" (`layoutTemplate`, ADR-0183).
   **Huvudlayouten** (`MAIN_LAYOUT` = "MAIN") är det som finns i dag: banans skala (`Course.printScale`), banans tryckyta och
   papper (`printArea`, `partPrintAreas`, `event.paperLayouts`); namnet och "Kartor per ark" i `event.mainLayout`. Den är den
   enda som skrivs till .ppen.
3. **Ark** = bana × layout. Huvudlayoutens ark är banans fält som förut. En annan layouts ark står i
   `event.layoutSheets[layout][bana]` (`LayoutSheet`): utsnitt (`printArea` utan papper; papperet är layoutens), delarnas
   utsnitt (`partPrintAreas`), papperet (`paper`, `partPapers`; ärver layoutens mall tills det ändras, "Återställ till mallen"),
   och justerade nummer. Ett ark finns när en klass med banan har layouten eller när det lagts till ("+ Lägg till ark").
4. **Justering per skala**: nummerplaceringen per ark (`LayoutSheet.numbers[banans kontroll]`, kartans mm; null = automatisk
   i layouten) och ringavbrotten per layout (`PrintLayout.circleGaps[kontroll]`, grader). Det som inte är justerat följer
   banläggningen, också när den ändras. Sträckornas avbrott justeras inte (för senare).
5. **Utskriften räknar arket genom en projektion** (`layoutDocument(dokument, layout)`): dokumentet med layoutens skala,
   arkets utsnitt med layoutens papper, arkets papper och justeringarna i banans och kontrollernas vanliga fält. Allt efter det
   (`layoutCoursePage`, `layoutTemplateSheets`, papperet, klippningen, delarna, PDF:en) är oförändrat. `SheetItem.layout` och
   PDF-jobbets `items[].layout` säger arkets layout; utan den (eller "MAIN") är resultatet byte för byte som förut.
6. **Klassens layout** (`event.classLayouts[klassnamn] = layout`): en klass har en layout, reserverna följer klassen. Banan
   kommer från tävlingen som förut. Kartor till starten delar grupperna per bana, variant *och* layout (`group.layout`),
   tryckantalet räknas per grupp, och löparkartorna (ADR-0213) får klassens layout. Utan val = huvudlayouten.
7. **Ändringar** (med ångra och kollaborationsnycklar per layout, ark, klass och läge): `ADD_LAYOUT` (id från klienten),
   `UPDATE_LAYOUT`, `DELETE_LAYOUT`, `PUT_LAYOUT_SHEET`, `SET_LAYOUT_CIRCLE_GAPS`, `CLEAR_LAYOUT_ADJUSTMENTS`,
   `SET_CLASS_LAYOUTS`, `SAVE_LAYOUT_STATE`, `RESTORE_LAYOUT_STATE`, `DELETE_LAYOUT_STATE`; `SET_PRINT_AREA`,
   `SET_PAPER_LAYOUT` och `MOVE_NUMBER` har `layout` för ett annat ark än huvudlayoutens.
8. **Sparat läge** (`event.layoutStates[]`): namngiven ögonblicksbild av layouterna, arken (också huvudlayoutens tryckytor
   och papper), justeringarna, klassernas val, mallarna och färgprofilen (vald profil och tävlingens kopia). Inte banorna.
   "Återställ" är en ändring som kan ångras; "Jämför" listar layouter, ark och klasser som skiljer. Vid inläsning av en .ppen
   görs läget "Från Purple Pen" automatiskt (ersätter det förra).
9. **Gamla dokument** läses utan migration: saknade fält = bara huvudlayouten, och utskriften är identisk (golden-test på ark
   och PDF). En ny .ppen behåller layouterna, arken för banor som finns kvar, klassvalen och lägena (`keepPaperOnImport`).
10. **Ordlista** (`docs/domain-rules.md`): tryckyta = `printArea` (i UI "utsnitt" på arket), kartram = `SheetFrame`.

## Följder

- Dokumentet växer med layouter och lägen; högst 20 layouter och 20 sparade lägen.
- Huvudlayoutens ark ändras i banans fält som förut, så .ppen och Purple Pen ser samma sak som i dag.
