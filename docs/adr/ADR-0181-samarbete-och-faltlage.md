# ADR-0181: Samarbete i banläggningen och fältläge i mobilen

Status: beslutad 2026-11-01 (PLAN.md steg 66 och 67, ägarens önskemål samma dag); beslut 8 och 9 2026-11-02. Bygger på ADR-0180. Stegen görs efter
steg 63 och före steg 64–65 (som steg 61 gjordes före 60).

**Bakgrund.** Flera arbetar ofta med samma banor: huvudbanläggare, medhjälpare och bankontrollant. De behöver lämna
notiser på kartan och i banorna, och föreslå ändringar som huvudbanläggaren godkänner, eller arbeta helt gemensamt.
Mycket av arbetet görs ute i terrängen med mobilen, vid utsättning, snitsling och kontroll av punkterna: flytta en
kontroll lite, skriva in stenens höjd, vilken sida flaggan sitter på och liknande.

**Beslut.**
1. **Notiser** sparas för sig, utanför banläggningens dokument (`course_setting_note`), fästa vid en punkt på kartan, en
   kontroll, en sträcka eller en bana. Trådar med svar, öppen/klar, valfritt foto. Banpåtryck, kontrollbeskrivningar,
   PDF, .ppen och överföringen till tävlingen läser aldrig notiserna.
2. **Arbetssätt per tävling:** "Huvudbanläggare" (de med behörigheten *ändra* ändrar direkt, övriga föreslår) eller
   "Gemensamt" (alla med *ändra* ändrar direkt, notiser för diskussionen).
3. **Förslag** är en lista med ändringar (`CourseSettingEdit`) gjorda mot en viss version, med kommentar. De visas
   streckade ovanpå banan och godkänns helt, delvis eller avböjs. Godkända ändringar spelas upp på aktuell version; det
   som inte går längre (t.ex. kontrollen borttagen) visas och hoppas över.
4. **Samtidigt arbete:** ändringarna skickas som åtgärder. När dokumentet har ändrats av någon annan spelas egna
   osparade åtgärder upp på den nya versionen (i stället för att ladda om), och andras ändringar når öppna editorer inom
   någon sekund. Samma kontroll ändrad samtidigt: den första vinner och den andra får besked.
5. **Behörighet för banläggning** per person och tävling i tre nivåer: *ändra*, *föreslå*, *läsa och kommentera*.
   Den ger inte tillgång till resten av tävlingen (anmälningar, avläsning). Ägare och admin har *ändra*.
   Banhemligheten gäller alla nivåer.
6. **Fältläget i mobilen:** samma editor med stora knappar för en hand. Egen position från telefonens GPS på kartan
   (kräver georefererad kartfil), med noggrannheten som cirkel. "Flytta hit" tar ett medelvärde över några sekunder och
   flytten finjusteras med pilar i steg om 1 m. Snabbinmatning av kontrollbeskrivningens F (mått, t.ex. höjd "1.5",
   "2x3") och G (läge, t.ex. sidan med väderstreck, fot, topp), notis med foto, och bocka av kontrollen som kollad.
7. **Utan täckning:** sidan och kartfilen sparas i telefonen, och ändringar och notiser köas och skickas när nätet är
   tillbaka, med samma uppspelning som i beslut 4.
8. **Notiser med ritning, kartfel och borttagning** (ägarens synpunkter 2026-11-02 efter rekognosering: stigar fel,
   beståndsgränser felplacerade). En notis kan ha en ritning (target `SKETCH`): linjer och ytor i kartans mm, högst 20
   delar och 1 000 punkter, ritade fritt (dra) eller punkt för punkt (klick); i mobilen ritar ett finger och två fingrar
   flyttar kartan. Färgen följer slaget (kartfel röd, snitsel/markering orange, allmänt blå) och betydelsen ("är fel"
   streckad, "ska vara här" med pil). Ritningen är notisens markering på kartan och ritas aldrig i banpåtryck, PDF, .ppen
   eller överföring (beslut 1). Notisen har ett slag, banläggning (förval) eller **kartfel**; ett kartfel sitter bara på
   en punkt eller en ritning, aldrig på en kontroll, sträcka eller bana (kontrakt och databas). Den som skrev en notis
   eller ett svar, och den med *ändra*, tar bort den (svar och foto följer med), genom telefonens kö som allt annat.
   **Exporten till kartritaren** (`/course-setting/map-errors`) görs i webbläsaren: utskrift/PDF med kartutsnitt per
   kartfel och GeoJSON (kartans projicerade koordinater med `crs` när kartfilen är georefererad, annars kartans mm).
   Kartritaren kan tävla själv, så exporten följer banhemligheten (ADR-0176): bara kartan och kartfelets ritning (inga
   ringar, sträckor, nummer, objekt eller tryckyta), löpnummer, text och status; inga bannamn, kontrollkoder, kopplingar
   till kontroller eller vem som skrev och när. Utsnittet förskjuts slumpvis från kartfelet, ett kartfel inom ringen
   eller 50 m från en kontroll varnas för och är inte med som förval, fotot är avbockat som förval, och texten visas med
   påminnelsen att den inte får avslöja kontrollplatser. Förhandsvisningen är exakt det som skrivs ut och laddas ned.
   **Kartritaren** är en egen behörighet (nivå `MAP`, rollen "Kartritare"): kartfilen och kartfelen (utan bana och foto)
   på samma sida, svara och markera klara; aldrig banläggningens dokument, versioner, förslag eller andra notiser.
9. **Översynen 2026-11-02 (sparande, utan nät och samarbete).**
   - *Sparandet* skickas i omgångar (högst 500 åtgärder och ungefär 1 MB). Servern svarar 413 för för stor kropp och fler
     än 5 000 åtgärder; klienten halverar då omgången. 400 för hela begäran betyder "läs om och försök igen", aldrig att
     åtgärderna är avvisade. Bara en ensam åtgärd som är för stor (eller oläslig två gånger efter omläsning) stryks, med
     besked; det som servern avvisar per åtgärd stryks som förut.
   - *Konflikterna* (beslut 4) prövas mot det som åtgärderna faktiskt ändrade: servern lagrar touches ur skillnaden mellan
     dokumenten före och efter varje åtgärd (`diffTouches`, fält för fält, banornas ordning undantagen), så att också
     strukturändringar (lägga in, ta bort, gafflingar) krockar. Ångra av en inställning sätter tillbaka bara de fält som
     ändrades (`PUT_OBJECTS.eventFields`), inte hela händelsen med profiler och logotyper.
   - *Telefonens kö* (beslut 7) skickas efter ändringarna, och notiser och bockar översätts till de id som servern gav
     kontroller som skapades utan nät. Servern avvisar (409) notiser och bockar på en kontroll eller bana som inte finns.
     Posten skrivs i två delar: grunden när den ändrats, loggen efter varje ändring. Ett lagringsfel syns i statusraden.
   - *Banhemligheten:* telefonens kopia tas bort vid utloggning och när servern svarar 403. En kopia av tävlingen tar med
     banläggningens behörigheter (också kartritaren) och notiserna bara när personerna följer med (`includePeople`);
     träningsgruppens tillfällen tar aldrig med dem.
   - *Minnet i mobilen:* vägvalens Worker startas först när en sträcka väljs. Högdalen (5 MB OCAD): kartans Worker 20 MB,
     vägvalens 48 MB (kostnadsmodellen 28 MB); fältläget håller nu bara kartans.

**Konsekvenser.** Ingen ny teknik för realtid (som CRDT) behövs, eftersom ändringarna redan är små åtgärder. GPS i skog
är ofta 5–15 m fel, så GPS-läget visar var man står men ersätter inte kartbilden; finjusteringen avgör.

## Risker och öppna frågor

- **GPS-noggrannheten** i skog och nära hus. Provas av ägaren i terrängen.
- **Kartfilen i telefonen:** stora OCAD-filer kan vara tunga att rita. Provas med Högdalen och Djurgården. Minnet
  räknat i Node (V8): Högdalen 20 MB för kartans Worker; i webbläsaren på en riktig telefon är det inte mätt.
- **Foton** tar plats; storleken begränsas och de tas bort med tävlingen.
- **Kartritaren** ser alla kartfel; ett kartfel nära en kontroll kan avslöja den (arrangören väljer vem som får rollen).
- **GeoJSON i OCAD:** QGIS läser `crs`; OCAD:s import av GeoJSON är inte provad med en riktig kartfil.
