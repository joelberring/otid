# ADR-0218: Stora kartor laddar snabbare

Status: beslutad 2026-11-07 (städrundan, paket B5, grenen `b5-stora-kartor`). Ägaren var bortrest; besluten nedan är
agentens och kan ändras. Bygger på ADR-0177/0179 (kartfilen läses och ritas i webbläsaren), ADR-0181 beslut 7–8 (offline,
kartritaren) och ADR-0189 (kartinnehållet). Ingen migration.

**Bakgrund.** Ägaren upplever att stora kartfiler (skogskartor på flera MB med tiotusentals objekt) laddar långsamt i
banläggningen, förhandsvisningen och klubbarkivets Kartor-flik. Förslaget var att cacha den tolkade kartan och rita det
synliga området först. Först mättes var tiden går.

**Mätning (före).** En syntetisk skogskarta (`packages/map-file/test/synthetic-map.ts`: 50 000 objekt, 11,1 MB OCAD 2018,
höjdkurvor med kurvor, ytor med hål och raster, stenar, stigar med streck, staket och kraftledningar med tecken, namn; ingen
riktig klubbkarta). Chromium (Playwright, headless), OffscreenCanvas 1600 × 1000 px, maskinen delad med fem agenter, så
spridningen är stor:

| Del | Tid |
| --- | --- |
| Hämtning från servern (lokal utvecklingsserver, 11 MB ur Postgres) | 2–4 s; 20 Mbit/s: ca 5 s till |
| Tolkning (`readMapFile`) | 160–350 ms (Node 260–385 ms) |
| `structuredClone` av den tolkade kartan | 580–760 ms |
| IndexedDB: spara / läsa den tolkade kartan | 480–560 / 370–1 020 ms |
| IndexedDB: spara / läsa filens bytes | 115–180 / 25–104 ms |
| Rita hela kartan (`drawMap`) | 440–480 ms (planering i JS 60–110 ms, resten canvas) |
| Rita inzoomat, 4 / 10 px/mm | 350–380 / 460–490 ms (alla 50 000 objekt planeras varje gång) |

I banläggningen (utvecklingsservern, 1280 × 800) kom första bilden 7,7–8,9 s efter navigeringen vid andra öppningen, och
Workern ritade **två** bilder av samma vy (0,5–0,8 s var): en ny kartyta från Workern gav en ny vy med samma värden.
Workern skapades först när filen var hämtad (0,8 s i utvecklingsläget). Kartfilen hämtades med `no-store` varje gång.

**Beslut.**
1. **Ingen cache av den tolkade kartan.** Att läsa den tolkade kartan ur IndexedDB (eller klona den) tar längre tid än att
   tolka filen. Det som cachas är filen.
2. **Kartfilen i webbläsaren per sha256** (`apps/web/src/lib/map-file-cache.ts`, IndexedDB `otid-map-cache`). Nyckeln är
   filens sha256 ur banläggningens tillstånd, som servern lämnar ut först efter behörigheten; webbläsaren frågar alltså aldrig
   cachen om en fil som kontot inte just fått veta att det får se. Innehållet är oföränderligt och sha256 kontrolleras när
   filen sparas. Högst tre filer och 250 MB; den som använts längst tillbaka tas bort först. Fel i lagret (privat läge, full
   lagring) gör bara att filen hämtas som förut, med en rad i konsolen. Lagret töms vid utloggning med banläggningens övriga
   kopior. Ordningen i `loadMapFile`: "Spara för offline"-kopian, cachen, servern.
3. **HTTP-cache för kartfilen.** Ny adress `…/administrator/map/source/<sha256>` (bara GET, samma behörighet som
   `map/source`). När adressens sha256 är filens: `Cache-Control: private, max-age=86400, immutable`, `ETag: "<sha256>"` och
   `Vary: Cookie`; annars `private, no-store` som förut. If-None-Match prövas **efter** behörigheten och ger 304 utan att
   innehållet läses. Säkerheten: `private` håller filen ur delade cachar; en annan inloggning i samma webbläsare har andra
   kakor och hämtar och prövas på nytt; efter ett dygn frågar webbläsaren med ETag (behörigheten prövas, ingen ny hämtning om
   filen är densamma). Den som en gång fått filen har den kvar i sin webbläsare under dygnet, som med offlinekopian. Chrome
   sparar inga svar över en åttondel av cachens storlek och i Playwrights (privata) kontext kom 11 MB inte med; därför
   beslut 2. HTTP-cachen hjälper för mindre filer och när lagret i beslut 2 saknas.
4. **Rita det synliga först: rumsligt index** (`packages/map-file/src/render/spatial-index.ts`, ren TypeScript). Ett jämnt
   rutnät över objektens rutor, utökade med det symbolen ritar utanför geometrin (punktsymbolens storlek, linjens bredd och
   tecken, hörnsymbolens sträckning, textens längd). Långa objekt (över 64 rutor) prövas en och en. `drawMap(…, { cull: true })`
   planerar bara objekten som når in i bilden, i kartans ordning, så att bilden blir densamma; byggs en gång per karta
   (27–47 ms). Bara banläggningens Worker (editorn, förhandsvisningen, kartfel, kartritarens länk) använder det; PDF:en ritar
   som förut. Lägre detalj utzoomat behövs inte: hela kartan tar under en halv sekund och allt syns då.
5. **Workern startar medan filen hämtas**, och en ändrad kartyta med samma storlek ger samma vy (`resize`), så att samma bild
   inte ritas två gånger.
6. **Förlopp:** "Läser kartfilen … 43 %" medan filen hämtas från servern (högst var 200:e ms, eftersom varje ändring ritar om
   editorn), sedan "Läser kartfilen …".
7. **Servern** (granskningens fynd): "Välj karta från klubbarkivet" frågar inte längre per klubb (inställningarna, kartorna
   och de härledda medlemskapen i samma frågor för alla klubbar; med sju klubbar förut 12 frågor fler än med en, nu inga).
   Dubblettförslagen i Kartor-fliken: namnen normaliseras en gång per namn i stället för i varje par (400 kartor 12,8 s →
   1,9 s lokalt, samma svar), och förslagen sparas i serverns minne per klubb (32 klubbar) med en nyckel ur allt som
   jämförs (kartor, versionernas namn, fingeravtryck, år, träningar och bortval), så en ändring räknar om och en sparad lista
   aldrig blir inaktuell. Nyckeln `max(updated_at)` valdes bort: alla tabeller som påverkar svaret har inte den kolumnen.
   `planMapBundles` grupperar deltagarna per klass en gång.

**Mätning (efter).**

| Del | Före | Efter |
| --- | --- | --- |
| Rita inzoomat 4 / 10 px/mm | 350–380 / 460–490 ms | 190–240 / 310–325 ms (8 745 av 50 000 objekt planeras vid 10 px/mm; JS 60–110 → 14–29 ms) |
| Rita hela kartan | 440–480 ms | 410–455 ms (oförändrat, allt syns) |
| Bilder av samma vy vid öppning | 2 | 1 |
| Andra öppningen, kartfilen | hämtas (11 MB) | ur webbläsarens lager (25–104 ms), inget nätanrop |
| Banläggningen 20 Mbit/s, första bild: tom cache / andra öppningen (utvecklingsservern) | 13,2 s varje öppning (filen hämtas alltid) | 13,7 s / 9,0 s |
| Banläggningen lokalt, andra öppningen, första bild (utvecklingsservern) | 7,7–8,9 s | 4,6–6,8 s |

Det som återstår i banläggningen är sidans egen laddning (i utvecklingsläget 1–2 s), tolkningen (0,4–0,7 s), ringklippens
index (0,1–0,2 s) och första bilden av hela kartan (0,5–0,8 s). Tolkningen av den syntetiska kartan har ett prestandatest
med generös gräns (`packages/map-file/test/large-map.test.ts`).

**Inte gjort.** Förhandsvisningen av utskriften och kartfelssidan hämtar fortfarande `map/source` utan sha256 (B3 arbetar i
utskriften); de får beslut 2 och 3 genom att anropa `loadMapFile`/`fetchMapSource` med kartans sha256.
