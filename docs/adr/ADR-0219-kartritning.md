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


## Tillägg 2026-11-07 (natt): arbetssätt, förslag och delområden (steg K1, migration 0091)

Ägarens beslut, som samarbetet i banläggningen (steg 66): ett kartprojekt har två arbetssätt och personer kan få delområden.

1. **Arbetssätt** (`map_project.mode`, null = Gemensamt): *Gemensamt* (`SHARED`) – alla med Ändra ritar direkt; *Huvudkartritare*
   (`LEAD`) – ägarna ritar direkt, andras ändringar blir förslag. Ägarna byter arbetssätt (`PUT` på projektet med `mode`).
2. **Rollen Föreslå** (`SUGGEST`, rangordning Läsa < Föreslå < Ändra < Ägare): ritar, men allt blir förslag. Ingen migration
   (rollerna bestäms i koden, beslut 2). Inbjudningar med Föreslå fungerar som de andra.
3. **Delområden** (`map_project_area`): polygon i kartans mm med y uppåt (1–20 ringar, 3–2000 punkter), status underlag, grundritat,
   rekat, klart. Ägarna skapar, ändrar och tar bort; den som fått området ändrar dess status. I det egna området ritar man direkt,
   i någon annans blir ändringen ett förslag. Den som fått området har ingen främmande nyckel och nollställs i koden när personen
   tas bort ur projektet eller kontot tas bort (som avsändarna i 0088).
4. **Direkt eller förslag avgörs bara på servern** med `editRoute` i map-revision: ägare alltid direkt, Föreslå aldrig, Ändra i
   Gemensamt direkt utom i någon annans område, Ändra i Huvudkartritare direkt bara i ett eget område. Platsen är objektets punkter
   i det nya läget och i serverns nuvarande läge (en punkt i ett område räcker); för en borttagning av ett objekt som servern bara
   har i grundfilen används ändringens valfria `point` (fältet `at` var redan tiden). En klient kan ljuga om `point` när den tar
   bort ett grundfilsobjekt. Det godtas: ingenting når originalet utan att en ägare skriver en ny version (beslut 5), och loggen
   visar vem som gjorde vad.
5. **Förslag** (`map_project_proposal` och `map_project_proposal_edit`): en grupp ändringar med en kort anteckning, källa `PERSON`
   eller `AI` (K2; AI lämnar bara förslag, beslut 8). Synken samlar ändringarna som inte får göras direkt i ett förslag per anrop
   (utfallet `PROPOSED` med `proposalId`; samma ändring igen ger samma förslag) och svarar med kontots öppna förslag
   (`openProposals`), så att klienten kan ta bort avgjorda ur sin lista. Förslag kan också skapas uttryckligen. Ägarna godkänner
   (ändringarna görs genom samma väg som synken, var och en gjord eller krock) eller avvisar; den som föreslog kan dra tillbaka.
   Loggen har den som föreslog som författare och den som godkände i `map_project_edit.accepted_by` (med `proposal_id`).
   Förslag från en person som tagits bort står kvar.


## Tillägg 2026-11-08: nya kartor (steg K1, migration 0092)

1. **O-Tids egna symbolset** (`packages/map-file/src/template`): ISOM 2017-2 (1:15 000, 1:10 000 förstorat 1,5 gånger) och
   ISSprOM 2019-2 (1:4 000 och 1:3 000 med samma mått), skrivna ur normerna som data i O-Tid. Mappers symbolfiler (GPL) används inte.
   Förenklingar: kantlinjer på ytor är egna linjesymboler (301.1, 501.1, 521.1), några mönster är ungefärliga. Symbolsetet ska
   kontrolleras mot normen innan en karta trycks skarpt; normkontrollen kommer i K6.
2. **En ny karta** (`newMapFile`) är en tom Mapper-fil (XML v9) med symbolsetet, skalan och georeferensen i SWEREF 99 TM.
   Referenspunkten är mitten av områdets omslutande rektangel, kartans 0,0. Kartan vrids mot magnetisk nord: grivationen är
   missvisningen (som personen anger) minus meridiankonvergensen i referenspunkten.
3. **Projektet** (`POST /api/organizer/map-projects/new`, alla inloggade, ingen klubb, `base_source = NEW`) får kartfilen som
   grundfil och området som `map_project.area` (kartans mm, y uppåt, som delområdena). Området kommer som polygon i WGS 84 eller
   SWEREF 99 TM, högst 15 km per sida. I webben: en GeoJSON-fil (t.ex. strandlinjen från QGIS) eller en mittpunkt med bredd och
   höjd. Att välja området på en bakgrundskarta kommer med underlagen i K4.


## Tillägg 2026-11-08: AI-kopplingen, att se och läsa kartan (steg K2, migration 0093)

Beslut 8 och planen (avsnitt 8a): Claude kopplas till O-Tid med personens eget Claude-konto. O-Tid har ingen AI-nyckel.

1. **O-Tid är inloggningsserver (OAuth 2.1) och MCP-server.**
   - Metadata: `/.well-known/oauth-protected-resource` (RFC 9728) och `/.well-known/oauth-authorization-server` (RFC 8414).
   - Dynamisk registrering (RFC 7591) för publika klienter: PKCE med S256 krävs, och omdirigeringen ska vara https eller
     `localhost`/`127.0.0.1`.
   - Godkännandet görs på sidan `/oauth/authorize` av den som är inloggad i O-Tid (samma inloggning som annars). Sidan visar
     klientens namn och vart svaret skickas.
   - Behörigheten `kartprojekt`: se de kartprojekt kontot är medlem i och lämna förslag. Inget annat i O-Tid nås med en AI-nyckel.
   - Åtkomstnyckeln gäller en timme. Förnyelsenyckeln gäller 30 dagar och byts vid varje förnyelse. En gammal förnyelsenyckel
     som används igen återkallar kopplingen.
   - Koder och nycklar sparas bara som sha256. Kopplingarna syns och återkallas under Konto → AI-kopplingar och tas bort med
     kontot.
2. **MCP på `/api/mcp`** (Streamable HTTP, utan sessioner, svar som JSON och ingen ström). Utan giltig nyckel blir svaret 401
   med `WWW-Authenticate` som pekar på metadata.
3. **Verktygen:**
   - `list_map_projects` och `map_overview`,
   - `render_view` (en bild av ett område, med kartans egna färger, rutnät och markeringar),
   - `render_compare` (grundfilen och kartan med ändringarna sida vid sida; ortofoto kommer med underlagen i K4),
   - `list_objects`,
   - `norm_check` (en grundläggande kontroll: minsta storlek och längd, öppna ytor, dubbletter; den fullständiga kommer i K6),
   - `propose_changes`.
4. **AI lämnar bara förslag** (beslut 8). `propose_changes` gör alltid ett förslag med källan `AI`, också när kontot är ägare.
   Förslaget är märkt med personen ("föreslagen av Claude åt …"). Ett förslag har högst 200 objekt och ryms inom 500 × 500 m.
   Läsa-rollen kan inte föreslå.
5. **Det tunga görs i utskriftsarbetaren, inte i webben** (beslut 7):
   - Webben lägger ett kartjobb (`map_project_job`) och väntar högst 25 s på svaret.
   - Utskriftsarbetaren (lägsta prioritet, barnprocess per jobb med tidsgräns och minnestak) läser grundfilen och projektets
     ändrade objekt, ritar med samma ritkod som webbläsaren (`drawMap` med `@napi-rs/canvas`) och skriver resultatet.
   - Resultaten rensas efter en timme.
   - Rollen `otid_print` får läsa `map_project` och `map_project_object` och sköta kartjobbskön (migration 0093 och
     `deploy/db-roles.sh`).
   - Jobben tar sekunder och körs också på tävlingsdagar, som PDF:erna. Regeln att stoppa på tävlingsdagen gäller
     geo-arbetarens långa jobb (K4).
6. **Gränser:**
   - en bild är högst 1 600 px per sida,
   - högst 30 kartjobb per minut och konto, och ett åt gången per konto,
   - registreringen och token-anropen räknas som inloggningsförsök (samma spärr som inloggningen).

## Tillägg 2026-11-08: rekningen, fältet och snabbare redigering (steg K3, migration 0094)

Ägaren vill se vad som är rekat så att flera kan dela på arbetet (planens avsnitt 7b), rita i mobilen utan nät och kunna göra
"väldigt många justeringar i minuten" med små menyer i mobilen.

1. **Rekningens status räknas, den sparas inte** (`recon.ts` i map-revision, i kartans Worker):
   - `UNSEEN` ej rekat, `PASSED` passerat (ett GPS-spår har varit inom siktavståndet), `CHECKED` kollat (en person har
     bekräftat objektet och det har inte ändrats sedan).
   - Siktavstånd per symbolgrupp (förval 25 m terrängformer, berg och anläggningar, 15 m stenar, 20 m vatten och vegetation),
     krympt i tät vegetation (406/407 0,75, 408/409 0,5, 410/411 0,35); halva GPS-noggrannheten (högst 5 m) läggs till.
   - En linje är passerad när 80 % av den, en yta när 50 % av den, varit inom siktavståndet. En lucka över 150 m i spåret är
     tappad signal. Förenklingen (1,5 m) lämnar ingen sträcka längre än 50 m.
   - Täckningen är ett rutnät (5 m) runt spåren; delområdena visar täckt andel och andelen sedda och kollade objekt.
   - Inställningarna ändras av ägarna (`map_project.recon`).
2. **Spåren är personuppgifter.** De syns bara för projektets medlemmar, aldrig publikt eller via delade länkar. Var och en döper
   om och tar bort sina egna; de tas bort med kontot. Den som får föreslå lägger till spår. Punkterna sparas i WGS 84 i delar om
   högst 2 000 (samma del två gånger görs en gång). I telefonen ligger spåret tills servern kvitterat allt; utloggningen räknar
   och tar bort spår som inte skickats.
3. **Bekräftelser** gäller objektets dåvarande senaste ändring (`basis_edit_id`) och räknas bort när objektet ändrats sedan.
   "Godkänn passerade" bekräftar alla passerade i ett delområde.
4. **Fältet:** positionen (visa, följ), spela in spår (skärmen hålls tänd), GPX-filer, punkt här, gå en linje med GPS och
   notiser med foto (migration 0095; id:t från telefonen, klar och ta bort av den som skrev eller ägarna).
   Kartsidan får använda positionen (Permissions-Policy). Sidan, projektet, kartfilen, ändringarna och spåren finns i
   telefonen: sidskalet via `/map-project-sw.js` (samma källa som banläggningens, egen cache och scope bara projektets karta).
5. **Redigeringen** (`curve-edit.ts`): dra i en sträcka böjer den, dubbelklick lägger till en punkt (också på kurvor) eller tar
   bort den, styrpunkterna dras och en mjuk punkt håller kurvan jämn. "Flytta hela" (eller en yta inifrån) flyttar objektet.
   Ett klick på den markerade linjens kant byter inte objekt; Alt-klick tar objektet under.

## Tillägg 2026-11-08: frivilliga topplistor och statistik (steg K3b, migration 0096)

Planens avsnitt 7c. Av från början; inget nytt spelas in.

1. **Två val krävs:** projektets ägare slår på topplistan och väljer hur namnen visas (förnamn, hela namnet eller utan namn;
   `map_project.leaderboard`), och var och en väljer själv "Visa mig i topplistorna" (`map_stats_opt_in`, tas bort med kontot).
   Topplistan syns bara för projektets medlemmar och aldrig publikt. Den egna statistiken ser var och en alltid.
2. **Räknas ur det som finns** (`map-project-stats.ts`): gjorda ändringar per författare (nya, ändrade, borttagna), godkända
   förslag från personer, spåren (antal, km, timmar, rekad yta i 10 m-rutor inom 20 m, nattrunda), bekräftelserna, notiserna
   (skrivna och åtgärdade) och klara delområden. Ändringar från ett förslag som Claude lämnade räknas inte som personens.
3. **Belöna rätt saker:** topplistan sorteras på rekad yta från början; märkena gäller rekad yta, km, natt, kollade objekt,
   åtgärdade notiser, klara delområden och borttagna objekt (generalisering), inte mängden nya objekt.
4. **Säsong** är ett kalenderår. Klubbens och hela O-Tids topplistor väntar (namnen skulle då synas utanför projektet).

## Tillägg 2026-11-08: egna underlag (steg K4a, migration 0097)

Ägaren: den som inte har kartunderlag via ett svenskt API ska kunna lägga upp eget material.

1. **Underlaget är en bild med georeferens** (`map_project_layer`): PNG eller JPEG, världsfilens sex tal (pixelns mitt → systemets
   enheter) och EPSG-koden. Bilden sparas en gång per sha256 i `map_content` på kontots kvot, högst 40 MB och 50 underlag per
   projekt. Föreslå eller mer lägger till; den som lade till och ägarna ändrar och tar bort. Genomskinligheten är projektets; vilka
   underlag som syns väljer var och en.
2. **Webbläsaren gör bilden klar:** en GeoTIFF läses med geotiff (MIT, laddas först när den behövs), läget och koordinatsystemet ur
   filen, skalas ned till högst 8 192 pixlar per sida och blir en JPEG; en PNG eller JPEG behöver en världsfil. Servern tar emot
   bara den färdiga bilden. Inget skickas till Claude.
3. **På kartan** räknas bildens pixlar om till kartans mm ur tre hörn via kartfilens georeferens (samma system direkt, annars via
   WGS 84). UTM (WGS 84 och ETRS 89) stöds nu i `map-file` vid sidan av SWEREF 99 och RT 90.
4. **Rättat:** `otid_map_content_release` kände inte till kartprojekten; innehåll som både var klubbarkivets och ett projekts
   grundfil kunde inte tas bort. Funktionen räknar nu också projektens grundfiler, versioner och underlag.

## Tillägg 2026-11-08: vektorer som kandidater (steg K4b, ingen migration)

Planens avsnitt om baskartor (plandokumentet om aktualisering och baskartor, avsnitt 4).

1. **Läses i webbläsaren** (`map-revision`: `vector-parse.ts`, `vector-import.ts`): GeoJSON (lagret ur `layer`, `objekttyp`,
   `obkod` med flera, koordinatsystemet ur den gamla `crs`-medlemmen, annars WGS 84) och DXF i textform (POINT, INSERT, CIRCLE,
   LINE, LWPOLYLINE, POLYLINE, SPLINE). Koordinatsystemet ur filen, annars ur koordinaternas storlek, annars kartans.
2. **Lagermappning:** ett val per lager, förslag ur ord i namnet (HUS → 521, STAKET → 516, STIG → 505, SJÖ → 301 …) bland
   kartans egna symboler. Profiler per källa och DWG väntar på geo-arbetaren (K4c).
3. **Städning:** objekt utanför kartan, dubbletter och korta stumpar tas bort, brutna linjer med samma symbol slås ihop, slutna
   linjer kan bli ytor. Klippning mot kartgränsen väntar.
4. **Kandidater, inte karta:** resultatet lämnas som förslag (högst 200 ändringar och 3 MB per förslag) med den nya källan
   `IMPORT` (texten matchar redan kontrollen, ingen migration). Ägaren godkänner som andra förslag; AI-kopplingen kan inte välja
   `IMPORT`, och importerade ändringar räknas inte som personens i statistiken.

## Tillägg 2026-11-08: etapper (migration 0098)

Ägaren: kartor görs ofta i etapper. Etappen är ett delområde (K1) med ett revideringsdatum (`map_project_area.revised_on`,
nullbar). Ägarna och den som fått området sätter och tar bort datumet; ett område som blir Klart utan datum får dagens.
Lagret Etapper (av från början, bara på skärmen och aldrig i utskrift eller export) färgar delområdena efter åldern: inom ett
år, 1–3, 3–6, äldre och inte reviderad. MCP-verktyget som visar projektet tar med datumet. Att hämta och köra nytt underlag
bara för en etapp kommer med geo-arbetaren (K4c, K5).

## Tillägg 2026-11-08: normkontrollen (del av K6, ingen migration)

Ägaren: kartritningen ska följa normerna, och kartan ska kunna kontrolleras mot dem i ett läge som slås på och av.

1. **Ren logik** (`map-revision/norm-check.ts`) körs i kartans Worker på kartan med ändringarna, när läget är påslaget och efter
   ändringar. Måtten är ISOM 2017-2:s (avsnitt 2.11.3 och symbolernas parametrar) i grundskalan 1:15 000, ×1,5 på en förstorad
   karta. Linjebredden tas ur kartfilens symbol.
2. **Regler nu:** kurvor (101–103) med mindre än 0,15 mm mellan konturerna, fristående linjer under symbolens minsta längd,
   ytor under minsta yta, mycket smala ytor (2·yta/omkrets under halva minsta bredden, så att bara tydliga fall tas med), slutna
   kurvor under kullens minsta mått.
3. **Sprint** (skala till och med 1:5 000, tillägg samma kväll): ISSprOM 2019-2:s tabell över minimimått (längder för
   murar, staket, branter; ytor och bredder för öppen mark, vegetation, hus, tak, område som inte får beträdas), passagen mellan
   två oframkomliga objekt (201, 301, 307, 411, 515, 518, 520, 521, 529) minst 0,40 mm kant till kant och öppningen mellan murar
   och staket minst 1,00 mm. Objekt som rör varandra stänger med avsikt och räknas inte; en kort mur som når ett oframkomligt
   objekt räknas inte som fristående. Rutnätet jämför nu också grannrutorna, så att ett par över en rutgräns inte missas.
4. Kontrollen visar ställen att se över (romber på kartan, listan i panelen); den ändrar inget och skickar inget.

## Tillägg 2026-11-08: hämtningen från öppna källor (K4c, del 1, ingen migration)

Ägaren: underlag ska kunna hämtas från Lantmäteriet (användarens eget konto), OpenStreetMap och NVDB, för hela kartan eller
en etapp.

1. **Ingen egen container än.** Hämtningarna är korta och går via webbens server: den frågar källan åt webbläsaren (inga
   nycklar eller CORS i webbläsaren, en gräns per konto: 20 hämtningar i timmen) och svarar utan att spara något. Tunga
   processer (laser, Karttapullautin i K5) får geo-arbetaren; beslutet om dess container i drift väntar på ägaren.
2. **OpenStreetMap** (Overpass, `OTID_OVERPASS_URL`, förval overpass-api.de): byggnader, vägar, stigar, staket, murar,
   järnväg, kraftledningar, vatten, markanvändning och träd för en ruta på högst omkring 40 km². Svaret blir samma lager och
   objekt som en vektorfil (K4b) med svenska lagernamn som ger symbolförslag; kandidaterna lämnas som förslag (IMPORT) med
   källan och ODbL i anteckningen.
3. **Etapp:** rutan kring ett delområde i stället för kartans; kandidaterna klipps mot etappens ruta.
4. **Lantmäteriet (del 2, migration 0100, provas):** varje konto sparar sina egna uppgifter under Mitt konto: Geotorgets
   användarnamn och lösenord (Basic, privatperson) eller API-portalens nyckel och hemlighet (OAuth2, organisation). De
   krypteras med driftens masternyckel (AES-256-GCM, kontot och källan autentiseras), visas aldrig igen (bara fyra tecken) och
   tas bort med kontot. Sökningen i `stac-bild` görs av servern; bilden (COG) läses av webbläsaren i delar genom serverns
   `asset`-anrop (Range krävs, högst 32 MB per del, bara Lantmäteriets adresser, omdirigeringar bara dit) och blir ett underlag
   (K4a) klippt till kartan eller etappen, en per bildruta. Adresserna följer Lantmäteriets guider men är inte provade mot den
   riktiga tjänsten (`OTID_LM_STAC_BILD_URL`, `OTID_LM_TOKEN_URL`).
5. **Kvar:** NVDB; laserdata och höjdmodell (`stac-hojd`) med geo-arbetaren (K5).

## Tillägg 2026-11-08: AI-banläggningsassistenten (behörigheten `banlaggning`, ingen migration)

Ägaren: Claude ska kunna granska banorna mot nivån, som en banläggningsassistent, och bara lämna förslag.

1. **Ny behörighet i AI-kopplingen:** `banlaggning` utöver `kartprojekt`. En klient som inte anger scope får båda; godkännandet
   listar vad varje behörighet ger. Kopplingar från före tillägget har bara `kartprojekt` och måste kopplas om.
2. **Verktygen** (MCP, bara med `banlaggning`): `list_course_settings` (tävlingarna där kontot har behörighet i banläggningen),
   `course_overview` (banorna med målnivå eller förslag ur klassnamnen, klasser, längd, stigning, kontrollerna med kod,
   beskrivning i text och läge, sträckorna med fågelväg och riktning, O-Tids varningar) och `add_course_note` (en notis på en
   bana, kontroll, sträcka eller punkt, märkt "AI-granskning:").
3. **Behörigheten** prövas som på sidan (`requireCourseSettingForAccount`, samma regler som sessionen); Kommentera räcker.
   Inget verktyg ändrar en bana, tävlingen, deltagare eller resultat.
4. **Bilden** (`render_course`, migration 0101): ett kartjobb i utskriftsarbetaren ritar banan på tävlingens karta (samma
   `drawMap` och `layoutOverprint` som annars) med rutnät i kartans mm; dokumentet följer med jobbet. Ett kartjobb gäller nu ett
   kartprojekt eller en tävling (precis en av dem; jobbet tas bort med tävlingen).
5. **Nivåstödets mätningar** (`course_level`): samma beräkning som banläggningens sida (ADR-0212: vägval med "följ
   ledstänger", sträckornas och kontrollernas drag, bedömningen mot målnivån) körs som kartjobb `COURSE_LEVEL` med tävlingens
   vägvalsinställningar. Jobbet får minst fem minuter och 512 MB; anropet väntar 90 s och svarar annars att mätningen pågår.
   Samma bana, karta och inställningar (hash i jobbet) hämtar ett jobb som redan räknas eller är klart. Sprintkartor,
   poängbanor och banor med fler än 60 sträckor bedöms inte.

## Tillägg 2026-11-08: geo-arbetaren och Karttapullautin (K5, del 1, migration 0103)

Ägaren: geo-arbetaren körs på en egen geo-server som O-Tid startar vid behov hos Hetzner (förstahand CX23, andrahand CAX11,
båda 4 GB) och raderar efter tomgång, så att användarna inte installerar något och tävlingsservern inte belastas. Det
ändrar svaret 2026-11-07 (samma server under testerna).

1. **Kön:** `map_project_geo_job` och resultatfilerna `map_project_geo_output` (i kartinnehållet, tas bort med jobbet).
   Jobbet gäller laserrutor från Lantmäteriets `stac-hojd` och några av Karttapullautins inställningar (en lista med gränser).
   Två jobb per konto åt gången, högst 16 rutor per jobb och en kvot rutor per månad.
2. **Geo-arbetaren** talar bara HTTPS med O-Tid med sin nyckel (`/api/geo-worker/…`): hämtar jobbet, livstecken med
   förloppet (svaret säger om jobbet avbrutits), laserfilen, resultatfilerna och klart eller fel. Laserfilen hämtas av servern
   med jobbkontots egna uppgifter, som aldrig lämnar servern. Ett jobb utan livstecken i tio minuter läggs tillbaka i kön och
   misslyckas efter två försök.
3. **Karttapullautin** (GPL-3) byggs oförändrat ur källkoden vid en låst tagg och körs som ett eget program i avbildningen
   `otid-geo`; ingen kod kopieras in. En ruta i taget (`processes=1`), rutorna slås ihop (`pngmerge`, `dxfmerge`).
4. **Resultatet:** bilden blir ett underlag (K4a) i rutornas koordinatsystem; kurvor, formlinjer, branter, stup och knollar
   ligger som DXF och läses in som kandidater (K4b) med symbolförslag ur Karttapullautins lagernamn (101–104, 109, 201, 202).
5. **Kvar:** egen beräkning av fuktighet (TWI, DTW) och mark och vegetation ur lasern (K5c, del 2).

## Tillägg 2026-11-08: geo-servern startas och raderas automatiskt (K5b, migration 0104)

1. **Webben** (tävlingens instans) tittar varje minut efter väntande geo-jobb när `OTID_HETZNER_TOKEN` är satt. Finns ingen
   geo-server skapas en med Hetzners API: typerna och platserna i tur och ordning (förval cx23 och cax11 i fsn1, nbg1, hel1),
   Ubuntu med Docker och `otid-geo` via cloud-init, etiketten `otid-geo=<domänen>`.
2. **Nyckeln** skapas per server och följer med i uppstarten; bara dess sha256 sparas (`geo_server`). Den gäller tills servern
   raderas. Driftens fasta nyckel (`OTID_GEO_WORKER_TOKEN`) fungerar som förut för en egen server.
3. **Raderas** efter tomgång (förval 20 minuter utan jobb), om den inte hört av sig inom 15 minuter, efter högst
   `OTID_GEO_MAX_HOURS` (förval 8) och om den har O-Tids etikett men är okänd. Högst tre starter i timmen.
4. **Kostnaden** räknas per påbörjad timme ur `geo_server` mot månadens budget (förval 10 €); räcker den inte startas inget.
5. **Mejl** till superadmin högst en gång per sort och dygn: ingen typ gick att skapa (med förslag på andra typer), en
   reservtyp användes, budgeten är slut, en server startade inte. Användarna ser läget i kartprojektet (igång, startar, startar
   när ett jobb väntar, kan inte startas, budgeten slut).

## Tillägg 2026-11-08: markfuktighet som underlag (K5c, del 1, ingen migration)

1. **SLU:s markfuktighetskarta** (2 m, Skogsstyrelsens öppna WMS) hämtas av servern för kartan eller en etapp i SWEREF 99 TM
   (WMS 1.1.1, så att axlarna är östlig, nordlig) och blir ett underlag med världsfil (K4a). Högst 4000 pixel åt något håll;
   större områden får grövre upplösning. Lagret läses ur tjänstens GetCapabilities (eller `OTID_SLU_MOISTURE_LAYER`).
2. **Webbläsartestet** kör geo-arbetaren (`scripts/geo-worker.ts`) mot webben med en falsk Karttapullautin och falska
   Lantmäteriet och SLU, så att hela kedjan (jobb, laser genom servern, resultat, underlag, kandidater) prövas i CI.

## Tillägg 2026-11-09: generaliseringen som förslag (K6, del 1, ingen migration)

1. **Två säkra steg** räknas i webbläsarens Worker för kartan med ändringarna (hela kartan eller en etapp): förenkla linjer
   och ytor med raka sträckor (Douglas–Peucker, toleransen 0,05–0,2 mm i kartans mm; kurvor lämnas) och ta bort det som
   normkontrollen säger är mindre än normen (små ytor, korta linjer, små slutna kurvor).
2. **Inget ändras direkt:** ändringarna lämnas som förslag med källan `GENERALIZE` (högst 200 ändringar och 3 MB per förslag),
   byggda på serverns senaste läge för varje objekt. Objekt med egna ändringar som inte skickats eller en krock hoppas över.
3. **Kvar (K6, del 2):** kurvavstånd, tunna ytor, delade kanter (topologi), att slå ihop små ytor med grannen och samma steg
   som MCP-verktyg med `refine_to`; de kräver bilder på riktiga kartor innan de läggs ut.
