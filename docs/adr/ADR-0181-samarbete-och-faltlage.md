# ADR-0181: Samarbete i banläggningen och fältläge i mobilen

Status: beslutad 2026-11-01 (PLAN.md steg 66 och 67, ägarens önskemål samma dag). Bygger på ADR-0180. Stegen görs efter
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

**Konsekvenser.** Ingen ny teknik för realtid (som CRDT) behövs, eftersom ändringarna redan är små åtgärder. GPS i skog
är ofta 5–15 m fel, så GPS-läget visar var man står men ersätter inte kartbilden; finjusteringen avgör.

## Risker och öppna frågor

- **GPS-noggrannheten** i skog och nära hus. Provas av ägaren i terrängen.
- **Kartfilen i telefonen:** stora OCAD-filer kan vara tunga att rita. Provas med Högdalen och Djurgården.
- **Foton** tar plats; storleken begränsas och de tas bort med tävlingen.
