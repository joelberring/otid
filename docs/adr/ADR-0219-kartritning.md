# ADR-0219: Kartritning – kartprojekt, ändringar per objekt och säker tillbakaskrivning

Status: beslutad 2026-11-07 (ägaren startade kartritningen samma kväll). Planen finns i projektdokumentet
`claude/plan-kartritning.md`; stegen K0–K7 står i `PLAN.md`. Ändrar ADR-0179 beslut 1 och 2. Ersätter utkasten ADR-0207
(ändringssatser) och ADR-0208 (kartrevidering) på de pausade grenarna `kartfil-skrivning` och `kartrevidering`, som aldrig
kom in i main; numren 0207 och 0208 lämnas tomma.

**Bakgrund.** Ägaren ritar i Mapper och det fungerar i fält. Det krångliga är att flytta filer för hand och att flera
ritar på samma karta. Värdet ligger i en gemensam version med synk utan nät, och på sikt i hela kedjan från laserdata till
färdig karta med AI som stöd (planen). Grenarna från 2026-11-03/04 hade kontraktet för ändringssatser, läsarnas källor och
paketet `map-revision`, men revideringen var knuten till klubbarkivet med en ny klubbroll. Ägaren valde 2026-11-07
kartprojekt med egna medlemmar i stället.

**Beslut.**
1. **Kartprojektet är det enda begreppet** (`map_project`). En revidering är ett kartprojekt som utgår från en kartversion
   i klubbarkivet (exakt dess sha256). Nya kartor (Mapper med ISOM 2017-2 eller ISSprOM 2019-2), område, delområden och
   underlag läggs på samma projekt i senare steg (K1, K4). Ingen ny klubbroll.
2. **Egna medlemmar per projekt** (`map_project_member`): Ägare (`OWNER`), Ändra (`EDIT`) och Läsa (`READ`). Förslag
   (`SUGGEST`) och arbetssätten Huvudkartritare/Gemensamt kommer i K1 och kräver ingen migration: rollerna bestäms i
   koden och databasen kräver bara formen (som spärrtyperna i 0087). Medlemmar bjuds in med e-post genom inbjudningarna
   (ADR-0206, nytt slag `MAP_PROJECT`); behörigheten kommer när kontot med adressen loggar in, som för klubbar och tävlingar.
   Projekten är aldrig publika och aldrig indexerade.
3. **Vem som startar:** klubbens Administratör eller Ägare startar ett projekt från en kartversion i arkivet och blir
   projektets Ägare. Den som bjuds in får kartfilen; det är det projektet är till för. En ny kartversion i arkivet skapas
   bara av en projektägare som fortfarande är Administratör eller Ägare i klubben.
4. **Ändringar per objekt** (paketet `map-revision`): varje objekt har en nyckel (`b:` + objektets plats i grundfilen,
   `n:` + uuid för nya). En ändring bär id:t för den ändring den bygger på; servern gör den om den bygger på objektets
   senaste ändring, annars är det en krock som en person löser. Två personer krockar bara när de ändrat samma objekt.
   Samma ändring två gånger görs en gång. Klientens kö raderas först när servern kvitterat (AGENTS.md).
5. **Tillbakaskrivning lappar filen** (`applyMapRevision` i `@o-tid/map-file`). Originalet skrivs aldrig över; resultatet
   blir en ny kartversion bredvid. Bara ändrade objekt skrivs om, allt annat finns byte för byte kvar. En tom ändringssats
   ger exakt samma bytes. Efter skrivningen läses filen om och kontrolleras objekt för objekt; hittar kontrollen något
   lämnas ingen fil ut. Mapper först. OCAD vägras tills K7 är prövat i riktiga OCAD (bakom en flagga).
6. **Har grundfilen ändrats på annat håll** skrivs ingenting automatiskt. Ändringarna kan exporteras som en liten egen fil
   (Mapper-fil med bara ändrade och nya objekt, eller GeoJSON) som kartritaren lägger in själv.
7. **Tävlingen först (ADR-0177).** Synken är små anrop på webbinstansen utan tunga beräkningar. Tillbakaskrivningen körs
   bara på begäran av en ägare. Tunga jobb (laser, fuktighet, rendering åt AI) körs i en egen geo-arbetare (K4), aldrig i
   webbinstansen och aldrig på tävlingsdag. Det ändrar ADR-0179 beslut 2 för de jobben.
8. **Principer för senare steg:** AI (Claude via MCP med personens eget konto) lämnar bara förslag som en människa godkänner.
   GPL-program som Karttapullautin körs som separata, oförändrade program och ingen kod kopieras in (som ADR-0168).

**Konsekvenser.** ADR-0179 beslut 1 ("inget skrivs tillbaka") gäller inte längre för kartprojekt; tävlingens kartfil
(`race_map_source`) är fortfarande orörd. Läsarna kan ange varifrån varje objekt kom (`readMapFile(…, { sources: true })`),
vilket kostar en hash per objekt och bara används av kartprojekten. `MAP_READER_VERSION` räknas upp när läsarna ändras; ett
projekt minns versionen den startade med, så att objektens platser kan jämföras.

## Tillägg 2026-11-07 (kväll): projektet ägs av sina medlemmar, klubben är valfri (migration 0090)

Granskningen mot planen visade att beslut 1 och 3 var för snäva: ett projekt måste utgå från en kartversion i klubbarkivet och
bara klubbens administratörer kunde starta det. Det fungerar inte för en ny karta (piloten Kungshatt har ingen grundfil) och
inte med ägarens beslut att inloggningen ska fungera som i resten av O-Tid. Ägaren valde 2026-11-07 "konto, klubb valfri".

1. **Beslut 1 ändras:** ett kartprojekt ägs av sina medlemmar. Grundfilen är en kartversion i klubbarkivet (`ARCHIVE`), en egen
   uppladdad kartfil (`UPLOAD`) eller en ny tom karta (`NEW`, K1). `club_id` och `base_version_id` är nullbara;
   `base_file_name` och `base_source` beskriver grundfilen när den inte kommer från arkivet.
2. **Beslut 3 ändras:** alla inloggade kan starta ett eget projekt från en fil. Från klubbarkivet kan alla som får läsa arkivet
   starta (också Eventor-bekräftade medlemmar); projektet hör då till klubben och klubbens administratörer räknas som ägare.
3. **Nya versioner sparas alltid i projektet** (`map_project_output` med eget innehåll och filnamn) och kan laddas ner av alla
   medlemmar. Projektets ägare skapar dem. När projektet hör till en klubb och den som skriver är administratör där kan versionen
   också läggas i klubbarkivet som en ny version av samma karta (`archive` i begäran).
4. **Ett eget projekt blir aldrig utan ägare:** den sista ägaren kan inte lämna, och kan inte ta bort sitt konto medan andra är
   med (`soleOwnerships`, slaget `MAP_PROJECT`). Är ägaren ensam medlem tas projektet bort med kontot. Ett eget projekt har ingen
   klubbjournal; ändringsloggen och medlemslistan finns kvar.
5. Underhållet tar inte innehåll som ett resultat i ett projekt använder (`sweepMapContent`).

