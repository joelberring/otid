# ADR-0184: PDF för tryck med dekorfärger och övertryck

Status: beslutad 2026-11-02 (PLAN.md steg 65). Bygger på ADR-0180 beslut 5 och 11 (banpåtrycket som figurer, `layoutCoursePage`),
ADR-0183 (`Sheet`, utskriftsprofil, förhandskontroll) och ADR-0177 (tävlingen först).

**Bakgrund.** Purple Pens PDF:er håller inte OCAD-kvalitet i färger och övertryck, så tryckeriet har velat göra om banor.
Kartor har ofta fel färginställningar för skrivaren, och att spara om i Mapper kan förstöra filerna. Steg 64 gav arken
(`Sheet`) och utskriftsprofilen; webbläsarens utskrift kan inte dekorfärger eller övertryck. Ägarens Mac-version av Purple
Pen (macpurplepen, BSD) lärde: CMYK-operatorer, äkta övertryck med /OP /op /OPM 1 som verifieras strukturellt, PDF/X och
ICC påstås inte förrän de är verifierade, och källkartan skrivs aldrig om. Ingen kod är tagen ur PDFsharp.

**Beslut.**
1. **Paketet `@o-tid/print-pdf`** (ren TypeScript utan I/O) skriver arken som PDF: `writeSheetsPdf({ sheets, map, profile,
   mode, fonts })`. Ingenting räknas om; arken kommer ur `layoutCoursePage`/`layoutTemplateSheets` som i förhandsvisningen.
2. **Bibliotek: pdf-lib 1.17.1 (MIT) med @pdf-lib/fontkit 1.1.1 (MIT).** pdf-lib sköter filens struktur (objekt, xref,
   komprimering), inbäddning av TrueType som delmängd med ToUnicode, och PNG/JPEG. Dekorfärger och övertryck har pdf-lib inget
   API för, men låga objekt (`context.obj`, `context.stream`) räcker: färgrymderna, funktionerna, ExtGState och alla
   innehållsströmmar skrivs av O-Tid som PDF-operatorer i text. En egen PDF-skrivare hade krävt en egen TrueType-delmängd
   och komprimering; pdf-lib är väletablerat, utan inbyggda beroenden, och används bara för det det är bra på. Filen sparas
   utan objektströmmar (`useObjectStreams: false`) så att äldre RIP:ar och enkla strukturkontroller kan läsa den.
3. **Kartan som vektorer med samma geometri som skärmen.** `drawMap` (`@o-tid/map-file`) tar en ritkontext med canvasens
   betydelse (`MapDrawingContext`); PDF:en har en egen (`PdfCanvas`) som följer transformen i JavaScript och skriver vägar,
   bézierkurvor, klipp och text. Ingen geometri finns två gånger. Färgen väljs i en krok före varje kartfärg (`beforeColor`),
   så målningsordningen är kartans färgordning. Varje unikt utsnitt (yta, storlek, skala) blir en Form XObject som alla
   sidor med samma utsnitt delar: 300 kartor per löpare på Högdalen gav en XObject och 5,7 MB. Objekt långt utanför utsnittet
   tas inte med. Ytornas mönster ritas punkt för punkt upp till 250 000 per yta (skärmen 20 000), annars som tonad yta.
4. **Färgerna.** Tre lägen:
   - *Tryckeri (PRESS):* kartans dekorfärger som i filen: en plåt som `/Separation`, flera (t.ex. "Grön 100 % + 50 % svart")
     som `/DeviceN` med en typ 4-funktion (summan, högst 1) till CMYK-alternativet. Alternativet är dekorfärgens CMYK ur
     filen (OCAD:s dekorfärgstabell, typ 10; Mappers dekorfärg). "Process Black" m.fl. blir processplåten (Black). Filens
     övertryck följs: med övertryck målar färgen bara sina plåtar (även 0 %, som då slår ut plåten), utan (knockout) slår
     den ut allt under, vilket är exakt PDF:s /OP för /Separation och /DeviceN. Kartmodellen behåller nu separationerna med
     andel och CMYK (`MapColor.spot.separations`).
   - *Tryckeri med kartan i CMYK (PROCESS):* kartfärgernas egna CMYK med filens övertryck och /OPM 1.
   - *Kontorsskrivare (OFFICE):* allt DeviceCMYK, inga dekorfärger och inget övertryck, profilen "Kontorsskrivare".
   Utskriftsprofilen gäller i alla lägen: dold färg ritas inte, ljusare/mörkare på CMYK (och på dekorfärgernas andelar), ny
   CMYK gör färgen till processfärg och profilens dekorfärg ger en egen plåt. Banans färg (COURSE och COURSE_LOWER) blir
   dekorfärgen med profilens namn (förval "Purple", 20/100/0/0) med övertryck som standard. Vitt (bakgrund, remsa,
   beskrivningens ruta) är CMYK 0 utan övertryck (knockout). Skärmarker skrivs i registerfärgen `/All`. Har samma plåtnamn
   olika CMYK (kartans Purple 30/100/0/0, profilens 20/100/0/0) används profilens och en notis visar avvikelsen.
5. **Typsnitt:** Roboto och Roboto Condensed (SIL Open Font License 1.1, `packages/print-pdf/fonts/OFL.txt`; OS/2 tillåter
   inbäddning och delmängd), samma som Purple Pen använder. Bara de varianter som behövs bäddas in, som delmängd med etikett
   (`OTIDAA+Roboto-Regular`). Kartans texter (ofta Arial) skrivs också med Roboto; det står i jobbets notiser.
6. **Dubbelsidigt:** baksidan följer varje karta, i samma format och riktning och upprätt, och katalogen säger
   `/ViewerPreferences << /Duplex /DuplexFlipLongEdge >>` så att utskriftsdialogen föreslår vändning på långsidan.
7. **På servern med låg prioritet (ADR-0177):** jobben ligger i `course_setting_print_job` (migration 0036) med
   banläggningens dokument som det var. Webben gör bara det lätta (kontrollera, lägga i kön, lista, lämna ut, ta bort). En
   egen process, `print-worker` (`scripts/print-worker.ts`, paketerad som `print-worker.mjs`), tar jobben ett i taget med
   `FOR UPDATE SKIP LOCKED`, kör med nice 19, CPU-vikt 64 och 384 MB i drift, en egen pool med två anslutningar och bara korta
   transaktioner. Ett avbrutet jobb görs om en gång (livstecken var 30:e sekund, gräns 15 minuter). Lokalt startar `pnpm dev`
   arbetaren. Bara admin (banläggningens ADMIN = ägare och administratörer); PDF:erna är aldrig publika. Högst tre aktiva
   jobb per tävling, 2 000 sidor och 150 MB per PDF; klara PDF:er sparas 7 dagar (högst 10 per tävling), raderna 30 dagar,
   och tabellens data tas inte med i säkerhetskopian (PDF:erna kan skapas igen).
8. **Förhandskontrollen** (`colorPreflight`) görs mot det PDF:en kan (`PDF_PRINT_CAPABILITIES`: äkta övertryck ja, PDF/X och
   ICC nej): i förhandsvisningen före "Skapa PDF" (blockerande fel stoppar, varningar måste bekräftas) och igen i arbetaren
   mot kartfilens färger. En profil som kräver PDF/X eller ICC stoppas redan när jobbet skapas.
9. **Ärlighet:** PDF:en påstår inte PDF/X, OutputIntent eller ICC. Förhandsvisningen och jobbet säger att det inte stöds
   och att ett provtryck hos tryckeriet behövs innan PDF:en används skarpt.

**Verifierat.** Strukturellt i testerna (pdf-lib läser tillbaka PDF:en): `/Separation /Purple` med C1 [0.2 1 0 0], /OP /op
/OPM 1, `/DeviceN` med typ 4-funktionen utvärderad, kartans CMYK, knockout och övertryck per färg, inbäddade typsnitt,
registerfärgen, baksidorna och /Duplex. Med Ghostscript (`tiffsep`) i utvecklingsmiljön: lilan på egen plåt och kartans
plåtar orörda under banan. Renderat med poppler och Ghostscript. **Inte verifierat:** riktigt tryck, PDF/X-validering, RIP:ar
hos tryckerier, Acrobats överskrivningsförhandsvisning, och hur ett tryckeri med bara CMYK hanterar dekorfärgerna.

**Konsekvenser.** Tryckeriet får kartan och banan i rätt plåtar utan att kartfilen ändras. Avvikelser från Purple Pen:
undre lila (COURSE_LOWER) ritas efter kartan, inte under kartans svarta (med övertryck syns ingen skillnad i separationerna,
men på kontorsskrivaren täcker lilan svart); bilder skrivs i RGB som de är och WebP/SVG utelämnas; textbredderna i
banpåtrycket kommer ur Roboto, inte ur skärmens uppskattning.

*Ändrat 2026-11-07 (städrundan, grenen `a3-tryck`):* servern litar inte på klientens lista: en bortvald gafflingsvariant
(ADR-0198 beslut 5) tas bort ur jobbet och notiserna säger vilka ("Bortvalda varianter skrivs inte ut: …"); är alla valda
bortvalda misslyckas jobbet med "Inget att skriva ut". Kartbytets del och dubbelsidigt följer med i förfrågan (ADR-0203).

## Risker och öppna frågor

- **Provtryck:** dekorfärgernas alternativ, övertrycket och bilderna måste provas hos tryckeriet.
- **Ett tryckeri som bara trycker CMYK** räknar om dekorfärgerna med alternativen; då kan läget "kartan i CMYK" passa bättre.
- **PDF/X och ICC** kräver en vald profil från tryckeriet och extern validering innan de kan påstås (som macpurplepen).
