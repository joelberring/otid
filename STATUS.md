# Status

Kort logg. Högst tio rader per steg. Nyaste överst. Historik före omstarten
finns i `docs/archive/status-2026-10-03.md`.

## Aktuellt steg

Kartritningen har startat (ADR-0219, planen i projektdokumentet `claude/plan-kartritning.md`): K0–K3b är klara (K3: rekningen, fältet, notiser och snabbare redigering, 0094–0095; K3b: frivilliga topplistor, 0096); K4a egna underlag (0097), K4b vektorer som kandidater och K4c hämtning från OpenStreetMap och Lantmäteriet (0100, provas) är klara; nästa i kartritningen är K5 (geo-arbetaren, Karttapullautin). Steg 59–68 är klara; sist steg 65 (PDF för tryck med dekorfärger och övertryck, grenen steg65-pdf, ADR-0184) som väntar på provtryck hos tryckeriet. Steg 7 (riktig hårdvara och pilot) ligger hos ägaren.
Riktiga tjänster: Eventor (klubbens nyckel, tävlingslistan, klubben och klubbens löpare via `cachedcompetitors`, strukturen) provad mot riktiga Eventor 2026-10-19; hela landets `cachedcompetitors` och `/api/organisations` måste provas av ägaren; ROC:s sökväg för stämplingar (bara provad mot falsk ROC) och e-post via SMTP är inte provade.

## Logg

### 2026-11-09 – Ny startsida (idéerna 2026-11-08)
- Tävlingarna först som förut; den inloggade ser "Ditt O-Tid" (klubbar, träningsgrupper, öppna kartprojekt); alla ser "Mer
  än tidtagning" (sex delar), hur O-Tid är byggt och länken till koden på GitHub. Svenska och engelska.
- Verifierat: E2E `startsida`, `sprak`, `publikt`.
- Demoläget, första steget: `OTID_DEMO_RACE` (kort kod till en publicerad tävling) ger länken "Prova: se en demotävling".
- Kvar: ägaren väljer licens för koden (repot är publikt men har ingen LICENSE-fil) och en demotävling; att prova arbetsytan
  utan konto (gästkonto med egen kopia) kräver ägarens beslut.

### 2026-11-09 – Engelska, del 1: språkval och de publika ingångssidorna
- Språket ur kakan `otid-lang` (länken English/Svenska i sidhuvudet, `/sprak`), annars engelska bara när webbläsaren inte
  nämner svenska eller nordiska språk. Startsidan, sidhuvudet, sidfoten, tävlingslistan och Om O-Tid (med klubbar utanför
  Sverige och Eventor) finns på engelska; texterna i `i18n/public-en.ts` med samma form (`Texts`).
- Verifierat: enhetstester `language`, i18n-testerna, E2E `sprak`, `publikt`, `hjalp`. Playwright körs med `locale: sv-SE`.
- Del 2 (samma dag): tävlingssidan, start- och resultatlistorna (vyerna, verktygsraden, CSV) på engelska för besökaren;
  klientkomponenterna läser språket ur `LanguageProvider` i de publika layouterna (arbetsytan är svenska). E2E `sprak` (två test).
- Del 3: Live, sträcktidsanalysen (inte vägvalsvyn), löparens resultatsida, självregistreringens formulär och tävlingsinfon.
  `/sprak` är publik (Caddyfile: `dc restart caddy`). E2E `sprak`, `live`, `strackanalys`, `sjalvregistrering*`, `fest`, `traningsgrupp`.
- Del 4: inloggningen, Skapa konto och Mina tävlingar (`organizer-en.ts`, språket i /organizer), bekräftelsen av adressen,
  Glömt lösenordet och mejlen (bekräftelse, återställning, redan ett konto) på det språk sidan visades på.
  E2E `sprak`, `konton`, `konto-inloggning`, `konto-meny`, `aterstallning`, `inbjudan`; enhetstest `mail`.
- Del 5: träningsgruppens sida (med självanmälan) och QR-sidorna. E2E `sprak`, `traningsgrupp`, `publikt`.
- Del 6: vägvalsvyn. Kvar: festen, Mitt konto, sedan arbetsytan del för del.

### 2026-11-09 – Lagren fas 2: arbetslager och skisslager (migration 0107)
- Arbetslager = egna grupper av normens symboler (tänd, släck, lås, tona); skisslager med linjer på fri hand, punkter och
  texter som inte hör till kartan. Delas i projektet; valen per person.
- Verifierat: integrationstest `adr-0219-arbetslager`, enhetstester `map-project-layer-model` och `map-project-sketch`,
  E2E `kartprojekt-rita` (arbetslager och skisslager) och `kartprojekt-underlag`.
- Kvar: tabell för äldre normers nummer.

### 2026-11-09 – K7: OCAD-kartor lappas bakom flaggan OTID_OCAD_WRITE
- Ny version av en OCAD-karta (version 9+): ta bort (status 0), ändra (på plats eller sist) och lägga till (ledig indexpost
  eller nytt block); kontroll efter skrivningen som för Mapper. Av tills den är prövad i riktiga OCAD.
- Verifierat: enhetstester `revision-ocd` (version 2018, 11 och 9; flaggbitar; nytt indexblock; vägran), integrationstest
  `adr-0219-kartprojekt` (OCAD med och utan flaggan).
- Kvar: prov i riktiga OCAD (ägaren), sedan ta bort flaggan.

### 2026-11-09 – K6b: passpunkter för skannade underlag och för att rätta kartan
- En bild utan världsfil läggs mitt på kartan; passpunkter (bild → karta) rättar den likformigt (2) eller affint (3+), med
  avvikelser i meter. Placeringen sparas som en ny världsfil i kartans koordinatsystem.
- Verifierat: enhetstester `map-project-control-points`, integrationstest `adr-0219-underlag`, E2E `kartprojekt-underlag`
  (sju test) och `kartprojekt-rita`.
- Rätta kartan med passpunkter: likformig, affin eller gummiduk; alla objekt flyttas som förslag (källan PROCESS).
  E2E `kartprojekt-underlag` (rätta kartan), enhetstester `warp`.
- Kvar: sparade försök att jämföra.

### 2026-11-09 – K6b: städning av baskartor (ytor av slutna linjer, trappor av steg)
- Fasadlinjer som sluter sig blir byggnadsytor, samma byggnad som skraffyr och linjer blir en, korta parallella steg i
  trapplagret blir en trapplinje (532). Bara inom samma symbol; antalen syns i importen.
- Verifierat: enhetstester `vector-import` (åtta test).
- Kvar: passpunkter (gummiduk) för skannade kartor och äldre kartor.

### 2026-11-09 – Kartredigeraren: lager efter normen, lås, nedtonat och slå ihop symboler
- Lagren är normens grupper med symbolerna som underlager och ett lager för det som är utanför normen; tänd, släck, lås och
  visa låsta lager nedtonade. Slå ihop symboler med förslag (samma nummer eller namn) och en tydlig förhandsvisning.
- Verifierat: enhetstester `map-project-layer-model`, E2E `kartprojekt-rita` (sex test) och övriga kartprojekt-test.
- Kvar: skisslager och egna arbetslager, tabell för äldre normer.

### 2026-11-09 – K6b del 2: DWG via LibreDWG i geo-arbetaren (migration 0106)
- En DWG-ritning i importen blir ett geo-jobb; geo-servern läser den med LibreDWG (`dwgread -O JSON`, så att skraffyrerna
  kommer med) och ritningen blir GeoJSON som läses in som kandidater. Avbildningen otid-geo bygger dwgread ur källkoden.
- Verifierat: enhetstester `geo-dwg`, integrationstest `adr-0219-geo` (fyra test), E2E `kartprojekt-geo` (falsk dwgread),
  riktig dwgread lokalt på LibreDWG:s exempelritningar (amd64; arm64 korskompilerad).
- Kvar: städning av baskartor och passpunkter.

### 2026-11-09 – K6 del 2: foga ihop linjer, ytor inuti likadana ytor, MCP-verktyg
- Generaliseringen fogar ihop linjer med samma symbol vars ändar möts och tar bort ytor inuti en likadan yta (som förslag).
  AI-kopplingen: `norm_check` med hela normkontrollen och det nya verktyget `generalize` (kan lämna förslag).
- Verifierat: enhetstester `generalize-topology`, integrationstest `adr-0219-ai`, E2E `kartprojekt-underlag`.
- Kvar: kurvavstånd, tunna ytor och sammanslagning av små ytor (kräver prov mot riktiga kartor).

### 2026-11-09 – Kartredigeraren: verktygshjul, symbolrutor, förenkla, mjuk och cirkel
- Högerklick, långt tryck eller mellanslag öppnar verktygshjulet (verktyg, senaste symboler, objektets åtgärder); 1–9 väljer
  senaste symbolerna. Förenkla, gör mjuk, gör rak och cirkelverktyget (O). Symbolerna som rutor.
- Verifierat: enhetstester `shape-edit` och `map-project-shape-actions`, E2E `kartprojekt-rita` (fem test), `kartprojekt`,
  `kartprojekt-underlag`, `kartprojekt-rekning`.

### 2026-11-09 – Kartor till startens baksidor följer banläggningens baksida
- Baksidorna under Kartor till starten (steg 61) använder baksidan som den är inställd i banläggningen (ADR-0213) när den
  finns: samma texter och variabler, så att t.ex. varianten bara står med när baksidan har {variant}.
- Verifierat: enhetstest `map-back-lines`, integrationstest `steg-61-gafflingar-start`.

### 2026-11-09 – Kontrollnumren står still mellan banläggning och utskrift
- En variant (utskriften per löpare) eller del får de automatiska numren där hela den gafflade banan har dem; valet
  "Placera numren för varje variant för sig" under Utseende placerar dem efter variantens egna sträckor.
- Verifierat: enhetstest `overprint` (gaffel där numret annars flyttas; testet fallerar utan ändringen), hela `course-setting`.

### 2026-11-09 – K5c del 3: vegetation ur laserns returer
- Laserjobbet kan också göra ytor av vegetationen: Karttapullautins klassbilder blir öppen mark, tre gröna och
  undervegetation som kandidater (401, 406, 408, 410, 407, 409).
- Verifierat: enhetstester `geo-vegetation`, integrationstest `adr-0219-geo`, E2E `kartprojekt-geo` med vegetationen.
- Provas: gränserna mot riktig skog; SLU som vikt är inte gjort.

### 2026-11-09 – K5c del 2: fuktighet ur laserns markmodell
- Laserjobbet kan också räkna fuktigheten: Karttapullautins höjdraster slås ihop, sänkor fylls, flödet och höjden över
  närmaste fuktstråk avgör blött och fuktigt. Ett eget underlag och kandidater (308, 310, 306).
- Verifierat: enhetstester `geo-moisture`, integrationstest `adr-0219-geo`, geo-arbetaren med riktig Karttapullautin mot en
  falsk O-Tid (två rutor), E2E `kartprojekt-geo` med fuktigheten.
- Provas: tröskelvärdena mot riktiga våtmarker.

### 2026-11-09 – K6b del 1: Stockholms lagernamn och lagermappningsprofiler (migration 0105)
- Importen känner igen Stockholms baskartas och parkkartas lagernamn och föreslår symboler enligt planens utkast; överskottet
  hoppas över. Valen kan sparas som en profil (för kontot eller delad med klubben) och används för nästa fil med samma lager.
- Verifierat: enhetstester `stockholm-layers`, integrationstest `adr-0219-lagerprofiler`, E2E `kartprojekt-underlag` (sju test).
- Provas: utkastet mot riktiga sprintkartor (Älvsjö–Solberga); DWG måste fortfarande sparas som DXF.

### 2026-11-09 – K6 del 1: generaliseringen som förslag
- Kartprojektet → Generalisering: förenkla linjer och ytor med täta punkter (0,05–0,2 mm) och ta bort det som är mindre än
  normen, för hela kartan eller en etapp. Ändringarna lämnas som förslag (källan GENERALIZE) som ägaren godkänner.
- Verifierat: enhetstester `generalize`, E2E `kartprojekt: generalisering som förslag` (import, godkänn, generalisera, godkänn,
  synken visar resultatet), hela `kartprojekt-underlag` och `kartprojekt-geo` mot produktionsbygget.

### 2026-11-08 – K5c del 1: markfuktighet (SLU) som underlag; webbläsartest för geo-kedjan
- Kartprojektet → Markfuktighet (SLU): servern hämtar SLU:s markfuktighetskarta (Skogsstyrelsens öppna WMS) för kartan eller en
  etapp, och den läggs till som underlag.
- E2E `kartprojekt-geo`: markfuktighet, laserrutor, jobbet, geo-arbetaren (med falsk Karttapullautin) mot webben, underlaget och
  kurvorna som kandidater. Verifierat lokalt mot produktionsbygget, plus `kartprojekt-underlag`, integrationstesterna.
- Provas: riktiga SLU-tjänsten (lagrets namn och färger).

### 2026-11-08 – K5b: geo-servern startas och raderas automatiskt hos Hetzner (migration 0104)
- `web` startar en geo-server när geo-jobb väntar (typer och platser i tur och ordning, egen nyckel per server via cloud-init)
  och raderar den efter tomgång, utebliven start eller maxtid. Budget per månad; mejl till superadmin vid reservtyp, när ingen
  typ går att skapa, när budgeten är slut och när en server inte startade.
- Verifierat: typecheck, lint, integrationstest `adr-0219-geo-server` (falsk Hetzner), `adr-0219-geo`.
- Provas: riktiga Hetzner (kräver `OTID_HETZNER_TOKEN`) och att `otid-geo` är publik på ghcr.io.

### 2026-11-08 – K5: geo-arbetaren och Karttapullautin (migration 0103, provas)
- Kartprojektet → Laserdata och Karttapullautin: sök laserrutor hos Lantmäteriet med egna uppgifter, kör Karttapullautin på
  geo-servern; bilden blir underlag, kurvor m.m. läses in som kandidater. Geo-arbetaren (`scripts/geo-worker.ts`, avbildningen
  `otid-geo` för amd64 och arm64) talar bara HTTPS med O-Tid; uppgifterna lämnar aldrig servern.
- Verifierat: typecheck, lint, integrationstest `adr-0219-geo`, geo-arbetaren med riktig Karttapullautin 2.15.4 mot en falsk
  O-Tid (två syntetiska laserrutor, sju resultatfiler), `public-paths`, `vector-import`.
- Provas: riktiga Lantmäteriet (väntar på beställningen), avbildningens bygge i CI. Kvar: K5b automatisk geo-server.

### 2026-11-08 – AI-assistenten: nivåstödets mätningar på servern
- Nytt MCP-verktyg `course_level`: per kontroll och sträcka den uppmätta nivån, regeln, mätvärdena och avvikelsen mot
  banans målnivå, samma som banläggningens nivåstöd. Kartjobbet `COURSE_LEVEL` i utskriftsarbetaren (minst 5 min, 512 MB).
- Ett nytt anrop med samma bana, karta och inställningar hämtar det pågående eller färdiga jobbet.
- `course_overview` listade "Röd" som målnivå; rättat.
- Verifierat: typecheck, lint, `lint:dead`, integrationstest `adr-0219-banlaggningsassistent`.

### 2026-11-08 – Ställa in enheter och klubbens enhetsregister (migration 0102, untested)
- Läs ut enheter → Ställ in enheten: klockan efter datorn, koden och läget; enheten läses igen och sidan visar före och efter
  och om ändringen gick fram. Inget annat skrivs.
- Klubbens enhetsregister: välj klubb på sidan, så sparas varje utläst eller inställd enhet (serienummer, modell, kod, läge,
  batteribyte, backupens antal, klockans fel). Fliken Enheter i klubbarkivet visar listan med batteriets ålder och anteckning.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester (`station-write`), `organizer-roles`, E2E `enheter` (falsk Web Serial).
- Untested: provas med riktiga enheter (rålogg från sidan).

### 2026-11-08 – AI-banläggningsassistenten (migration 0101, ADR-0219 tillägg)
- AI-kopplingen har en ny behörighet, `banlaggning`: Claude listar tävlingarna där kontot får lägga banor, läser banorna (målnivå,
  klasser, längd, stigning, kontroller med beskrivning, sträckor med fågelväg och riktning, varningar) och lämnar notiser märkta
  "AI-granskning:" på bana, kontroll, sträcka eller punkt. Inget ändras i banor, tävling eller resultat.
- Godkännandet visar behörigheterna; äldre kopplingar har bara kartprojekten och kopplas om.
- Verifierat: typecheck, lint, `lint:dead`, integration `adr-0219-banlaggningsassistent`, `adr-0219-ai`, E2E `ai-koppling`.
- Bild av banan på kartan (`render_course`, kartjobb i utskriftsarbetaren, migration 0101: kartjobb för en tävling).
- Kvar: nivåstödets mätningar på servern.

### 2026-11-08 – Läs ut enheter (ingen migration, untested)
- Avläsning → "Läs ut enheter": huvudstationen ansluts med Web Serial och enheten som ligger mot den läses i fjärrläge:
  serienummer, modell, programversion, kod, läge, batteribyte, klockan mot datorn och backupminnet (de senaste 4 000
  stämplingarna) med löparen för brickor i tävlingen och om koden finns på banorna. CSV och rålogg. Inget skrivs till enheten.
- `StationReadSession` i sportident (ren, tål chunkgränser, dubbletter, fel CRC, NAK, avbrott och tystnad).
- Untested: byggt efter öppna beskrivningar (docs/sportident.md); provas med riktiga enheter.
- Verifierat: typecheck, lint, enhetstester (`station-read`), E2E `enheter` (falsk Web Serial).

### 2026-11-08 – Ortofoto från Lantmäteriet med eget konto (K4c del 2, migration 0100, ADR-0219 tillägg, provas)
- Mitt konto → Lantmäteriet: Geotorgets användarnamn och lösenord eller API-portalens nyckel och hemlighet. Sparas krypterade
  (`OTID_EVENTOR_MASTER_KEY`), visas aldrig igen, tas bort med kontot.
- Kartprojektet → Underlag → Ortofoto från Lantmäteriet: sök för kartan eller en etapp, välj bildrutor (nyaste årgången förvald),
  de läggs till som underlag klippta till området. Servern söker och släpper igenom bildens delar (Range, bara Lantmäteriets
  adresser); bilden görs klar i webbläsaren.
- Provas: inte provat mot riktiga Lantmäteriet (adresser och inloggning efter deras guider).
- Verifierat: typecheck, lint, `lint:dead`, integration `adr-0219-hamtning`, `organizer-roles`, E2E `kartprojekt-underlag`.

### 2026-11-08 – Hämta OpenStreetMap till kartprojektet (K4c del 1, ingen migration, ADR-0219 tillägg)
- Importera vektorer → Hämta från OpenStreetMap: hela kartan eller en etapp. Servern frågar Overpass (`OTID_OVERPASS_URL`,
  högst omkring 40 km², 20 hämtningar per konto och timme) och svarar med lager som en vektorfil; svenska lagernamn ger
  symbolförslag (byggnad 521, staket 516, mur 513, gångväg 505, väg 503, vatten 301 …). Kandidaterna lämnas som förslag.
- Ingen egen geo-container ännu: hämtningarna går via webben, tunga processer (K5) väntar på geo-arbetaren.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester (`osm`), E2E `kartprojekt-underlag` (falsk Overpass på port 4343).
- Kvar i K4c: Lantmäteriet med eget konto (ortofoto), NVDB.

### 2026-11-08 – Normkontrollen för sprintkartor (ingen migration, ADR-0219 tillägg)
- Sprint (1:5 000 och större): ISSprOM 2019-2:s minimimått för längder och ytor, passager mellan oframkomliga objekt under
  0,40 mm och öppningar mellan murar och staket under 1,00 mm (ett fel per par, där det är smalast; objekt som rör varandra
  räknas inte). En kort mur som når ett hus räknas inte som fristående.
- Rättat: avståndskontrollen missade par som låg på var sin sida om en rutgräns (också kurvavståndet på skogskartor).
- Verifierat: typecheck, lint, enhetstester (`norm-check`), E2E `kartprojekt-underlag`.

### 2026-11-08 – Kontrollnumren undviker vägvalen (ingen migration)
- Varje sträcka som vägvalens Worker räknar i banläggningen (vald sträcka, banans längd, förbjudna områden) ger bästa vägen och
  alternativen nära kontrollerna (inom 20 mm, förenklade); de sparas i banfilen (`event.routeHints`, åtgärden `SET_ROUTE_HINTS`,
  utanför ångra-historiken, inte i .ppen). Numrens automatiska placering undviker dem, så förhandsvisningen och PDF:en är lika.
- En väg gäller bara så länge båda kontrollerna står kvar; flyttas en räknas den om nästa gång. Placerade nummer flyttas inte.
- Ringkapningen följer fortfarande banans linjer och kartans detaljer, inte vägvalen.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester (`route-hints`), E2E `banlaggning-varningar`, `banlaggning`, `vagval-analys`.

### 2026-11-08 – Masstart direkt på klassen (ingen migration)
- Klassens rad (Redigera): "Masstart kl." för en klass med minutstart; en lottning med masstart för bara den klassen (samma väg
  som Start → Lottning), så att efteranmälda också får tiden. Fungerar i alla typer med startsätt per klass.
- Verifierat: typecheck, lint, E2E `lottning` (masstart, efteranmäld), `redigera-bana`, `arbetsyta` mot driftbygget.

### 2026-11-08 – Byt namn på banor och importerade klasser (migration 0099)
- Banor: namnet i formuläret Namn, längd och stigning (också gafflade banor); ett namn som redan finns avvisas. Inget räknas om.
- Klasser från Eventor eller IOF XML får döpas om: källans namn sparas (`class.source_name`) och syns på raden, en ny hämtning
  från Eventor skriver inte över det egna namnet, "Använd importens namn" går tillbaka.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester (`source-sync-diff`), integration `adr-0169-class-edit`, `steg-25-competition`.

### 2026-11-08 – Layouten: fria typsnitt, textfärg, kopiera element, karta per löpare på banans papper (ingen migration)
- Papperets texter: typsnitt (Roboto, Roboto Condensed, Inter, Crimson Text, Bebas Neue, Creepster, Nosifer, Permanent Marker; OFL/Apache,
  samma TrueType på skärmen och inbäddat i PDF:en), kursiv, spärrning och färg (t.ex. grå baksida); Purple Pen får typsnittets namn.
- Kopiera markerade element (logotyper) till andra banor. Kartritningen syns alltid under Arrangera och i kontomenyn.
- Rättat: en karta per löpare utan mall skrev alla banor på A4 stående; nu får varje bana sitt eget papper (stående/liggande).
- Verifierat: typecheck, lint, `lint:dead`, enhetstester, E2E `banlaggning-pappersrum` och `kartprojekt-underlag` mot driftbygget.
- Kvar (ägaren 2026-11-08): numren och ringkapningen undviker vägvalsanalysens troliga vägval, eget uppladdat typsnitt (t.ex. licensierad Zombies Brainless).

### 2026-11-08 – Normkontrollen (del av K6, ingen migration, ADR-0219 tillägg)
- Läget Normkontroll i panelen: ISOM 2017-2:s minimimått mot kartan med ändringarna (×1,5 på 1:10 000), i Workern.
- Kurvor för nära varandra, korta fristående linjer, små och smala ytor, små kullar; romber på kartan och Visa i listan.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester (`norm-check`), E2E `kartprojekt-underlag` (normkontroll).
- Kvar: ISSprOM:s symbolmått för sprint, passager mellan oframkomliga objekt.

### 2026-11-08 – Underlagens ordning, Shapefile och klippning (ingen migration)
- Ägarna ändrar ordningen mellan underlagen; genomskinligheten ändras bara av den som får ändra underlaget.
- Importen läser Shapefile (också i .zip) med koordinatsystemet ur .prj, och klipper linjer och ytor mot kartans kant.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester (`vector-shape`, `vector-import`, importens filer), E2E `kartprojekt-underlag` (3).

### 2026-11-08 – Etapper med revideringsdatum (migration 0098, ADR-0219 tillägg)
- Delområdena får ett revideringsdatum (ägarna och den som fått området; klart utan datum ger dagens).
- Lagret Etapper (bara på skärmen) färgar dem efter åldern, med förklaring i panelen.
- Verifierat: typecheck, lint, integration `adr-0219-forslag`, E2E `kartprojekt-underlag` (etapper).
- Kvar: nytt underlag bara för en etapp (med geo-arbetaren).

### 2026-11-08 – K4b: vektorer som kandidater (ingen migration, ADR-0219 tillägg)
- GeoJSON och DXF läses i webbläsaren; ett symbolval per lager med förslag ur namnen; koordinatsystemet ur filen eller koordinaterna.
- Städning: utanför kartan, dubbletter, korta stumpar, brutna linjer slås ihop, slutna linjer blir ytor; kandidaterna syns på kartan.
- Lämnas som förslag med källan IMPORT (högst 200 per förslag), räknas inte i statistiken.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester, integration `adr-0219-rekning`, E2E `kartprojekt-underlag` (2).
- Kvar: DWG, Shape, lagerprofiler och klippning (med geo-arbetaren, K4c).

### 2026-11-08 – K4a: egna underlag (migration 0097, ADR-0219 tillägg)
- Egna underlag i kartprojektet: GeoTIFF, eller PNG/JPEG med världsfil; webbläsaren skalar ned och läser läget och EPSG ur filen.
- Panelen Underlag: visa/dölj (för sig), genomskinlighet (för projektet), ta bort (den som lade till eller ägarna); bilderna i kartcachen.
- UTM (WGS 84 och ETRS 89) i `map-file`; rättat att innehållets frigöring inte kände till kartprojekten.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester, integration `adr-0219-underlag` (2), E2E `kartprojekt-underlag`.
- Utan nät: listan sparas i webbläsaren (tas bort vid utloggning); omladdningen provad mot driftbygget.
- Kvar: ordningen mellan underlagen; K4b och K4c.

### 2026-11-08 – K3b: frivilliga topplistor och statistik (migration 0096, ADR-0219 tillägg)
- Den egna kartstatistiken per projekt och totalt per säsong (rekad yta, km och timmar, kollade, notiser, nya/ändrade/borttagna, godkända förslag, klara delområden) med märken.
- Topplistan i projektet: ägarna slår på och väljer namnen, var och en väljer "Visa mig i topplistorna"; bara för medlemmarna; sorteras på rekad yta.
- Claudes förslag räknas inte som personens; inget nytt spelas in.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester, integration `adr-0219-rekning` (5), E2E `kartprojekt-rekning` (2).
- Kvar: klubbens och hela O-Tids topplistor (beslut om namn utanför projektet).

### 2026-11-08 – K3: rekningen, fältet och snabbare redigering (migration 0094–0095, ADR-0219 tillägg)
- Rekningens status (ej rekat, passerat, kollat) och täckningen räknas i kartans Worker ur GPS-spåren; siktavstånd per symbolgrupp, krympt i tät vegetation; delområdenas framsteg, "Godkänn passerade" och "Markera kollad".
- Spår från fältläget (sparas i telefonen och skickas del för del) och GPX-filer; bara medlemmar ser dem; tas bort med kontot och räknas vid utloggningen.
- Mobilen: position (visa, följ), punkt här, gå en linje, menyerna på en rad; kartsidan och projektet utan nät (`/map-project-sw.js`).
- Redigeringen: böja en sträcka, punkter på kurvor, dubbelklick lägger till eller tar bort, styrpunkterna, Flytta hela.
- Rättat: klippningen i Layout (arket ärver huvudlayoutens papper), beskrivningen sparas som papperet.
- Verifierat: typecheck, lint, `lint:dead`, enhetstester, integration `adr-0219-rekning` (3), E2E `kartprojekt-rekning`, `kartprojekt-rita` (4), `kartprojekt` (2), `banlaggning-layout`, `banlaggning-pappersrum`.
- Tillägg: notiser med foto i kartprojektet (migration 0095), också utan nät; omladdningen utan nät provad mot driftbygget.
- Kvar: ägaren provar i terrängen.

### 2026-11-08 – K2: AI-kopplingen, Claude ser och läser kartan (migration 0093, ADR-0219 tillägg)
- O-Tid är inloggningsserver (OAuth 2.1: metadata, dynamisk registrering, PKCE S256, nycklar med rotation och återkallelse vid återanvändning) och MCP-server på `/api/mcp` (JSON, utan sessioner); godkännandet på `/oauth/authorize` med vanlig inloggning; Mitt konto → AI-kopplingar.
- Verktygen `list_map_projects`, `map_overview`, `render_view`, `render_compare`, `list_objects`, `norm_check` (grundläggande) och `propose_changes` (alltid förslag med källan AI, högst 200 operationer inom 500 × 500 m; Läsa kan inte).
- Kartjobben (`map_project_job`) görs av utskriftsarbetaren i en barnprocess (`drawMap` på `@napi-rs/canvas`), väckt med `pg_notify`; `otid_print` får kön och kartprojektens objekt; `/api/mcp` och `/.well-known/*` går till de publika instanserna.
- Rättat: falska Eventor bytte dagens datum två gånger (fixturens stafettdatum är 2026-11-08), CI röd sedan K1.
- Verifierat: typecheck, lint, `lint:dead`, alla enhetstester, integration `adr-0219-ai` (2) och hela sviten, E2E `ai-koppling`, `kartprojekt-rita` (3), `kartprojekt` (2), `eventor`.
- Återstår för ägaren: köra `sh deploy/db-roles.sh setup` efter uppdateringen och koppla Claude (docs/drift.md, AI-koppling).

### 2026-11-08 – K1 klart: samarbetet i editorn och nya kartor (migration 0092, ADR-0219 tillägg)
- Editorn: arbetssätt, förslag (streckade, borttagningar som kryss, Visa/Godkänn/Avvisa/Dra tillbaka), verktyget Delområde med kartritare och läge; Föreslå ritar och får beskedet; borttagning skickar objektets punkt.
- Nya kartor: O-Tids symbolset ISOM 2017-2 och ISSprOM 2019-2 (`map-file/template`, egna tabeller, inte Mappers GPL-filer), `newMapFile` med SWEREF 99 TM och grivation = missvisning − meridiankonvergens; 0092 `map_project.area`; `POST …/map-projects/new`; formuläret Ny karta (GeoJSON eller mittpunkt och storlek); editorn passar in och ritar området.
- Verifierat: typecheck, lint, `lint:dead`, alla enhetstester (nya: `new-map`, områdets inmatning, skalornas överensstämmelse), integration `adr-0219-ny-karta` (2), `adr-0219-forslag`, `adr-0219-kartprojekt`, `schemadrift`; E2E `kartprojekt-rita` (4) och `kartprojekt` (2). Varje symbol ritad och granskad på skärmbild.
- Återstår för ägaren: prova editorn, kontrollera symbolsetet mot normen och öppna en ny karta och en ny version i Mapper.

### 2026-11-07 – K1: arbetssätt Gemensamt/Huvudkartritare, förslag och delområden (grenen k1-forslag, migration 0091, ADR-0219 tillägg)
- 0091 (bara tillägg): `map_project.mode`, `map_project_area`, `map_project_proposal`, `map_project_proposal_edit`, `map_project_edit.proposal_id`/`accepted_by`.
- Rollen Föreslå (`SUGGEST`); regeln direkt eller förslag (`editRoute` i map-revision, enhetstestad) avgörs bara på servern; ändringens valfria `point` för borttagning.
- Synken gör ändringar som inte får göras direkt till ett förslag per anrop (`PROPOSED`, `openProposals`); klientens `proposed` och `keepOpenProposals`.
- Förslag: lista, skapa med anteckning, godkänna (samma väg som synken, gjord eller krock), avvisa, dra tillbaka. Delområden: CRUD för ägarna, status för den som fått området; nollställs när personen eller kontot tas bort.
- API: `…/[projectId]/areas`, `areas/[areaId]`, `proposals`, `proposals/[proposalId]`, `mode` med PUT på projektet.
- Verifierat: typecheck (contracts, map-revision, application, database, web), lint, `lint:dead`, enhetstester, databasens tester, integration `adr-0219-forslag` (4), `adr-0219-kartprojekt` (5), `schemadrift`.
- Återstår: ritytan (förslag streckade, listan att godkänna, områden på kartan) i editorn.

### 2026-11-07 – K0 rättat: kartprojekt ägs av sina medlemmar, klubben valfri (migration 0090, ADR-0219 tillägg)
- Granskningen mot planen: projekten krävde en kartversion i klubbarkivet och klubbens administratör, vilket stänger ute nya kartor (Kungshatt) och vanliga konton. Ägaren valde "konto, klubb valfri".
- 0090 (bara lättnader): `club_id`/`base_version_id` nullbara, `base_file_name`, `base_source`, resultatens eget innehåll och filnamn (`map_project_output.content_sha256`, `file_name`, `version_id` nullbar).
- Eget projekt från en kartfil (`POST /api/organizer/map-projects/upload`, formuläret i Mina kartprojekt); från arkivet får alla som läser det starta. Nya versioner sparas i projektet och laddas ner (`…/outputs/[outputId]`); "Lägg också i klubbarkivet" för klubbens administratörer.
- Konto: ensam ägare av ett eget projekt med andra medlemmar kan inte ta bort kontot; ensam medlem tar projektet med sig.
- Verifierat: typecheck, lint, `lint:dead`, databasens tester, integration `adr-0219-kartprojekt` (5, nytt: eget projekt) och `schemadrift`; E2E `kartprojekt` (2, nytt: eget projekt).

### 2026-11-07 – Steg K0: kartprojekt och säker tillbakaskrivning (grenen k0-kartritning, ADR-0219, migration 0089)
- Kartfilen: läsarna anger varifrån varje objekt kom (`readMapFile(…, { sources: true })`); `applyMapRevision` lappar Mapper-filer (bara ändrade `<object>`, `<objects count>`, ångra-historiken bort vid ändring), läser om och kontrollerar objekt för objekt, tom sats ger samma bytes; OCAD vägras tills K7. `MAP_READER_VERSION` 3.
- T2: OCAD 8:s ytsymbol saknar FillOn/BorderOn, så strukturfälten ligger 2 byte tidigare (ocd/layout.ts, symbols.ts, testbyggaren).
- Paketet `map-revision` från den pausade grenen på main med kartfilens riktiga `ObjectRef` (plats + hash) och `toChangeSet` (bara det som skiljer).
- Kartprojekt (0089): `map_project` från en kartversion i klubbarkivet, egna medlemmar (Ägare/Ändra/Läsa, klubbens administratörer som ägare), inbjudan med e-post (slaget `MAP_PROJECT` i invitation_link), synk per objekt med krockar, "Skapa ny kartversion" (ny version av samma karta, `map_project_output`), export som Mapper-fil eller GeoJSON. Versioner och innehåll som ett projekt använder tas inte bort (`dropUnusedCreated`, `sweepMapContent`).
- Webben: API under `/api/organizer/map-projects`, enkel projektsida (grundversion, filer, medlemmar, ny version), "Starta kartprojekt" i Kartor, remsan Mina kartprojekt. Ritningen är K1.
- Verifierat: lint, typecheck, test, `lint:dead`, integration `adr-0219-kartprojekt` (behörighet, inbjudan, synk, krock, dubblett, avslutat, ny version, export, kontots borttagning) och hela integrationssviten; E2E `kartprojekt`.
- Återstår: ägaren provar tillbakaskrivningen på en riktig Mapper-fil (öppna resultatet i Mapper); de pausade grenarna kan tas bort.

### 2026-11-07 – Begrepp, namn och två sanningar (grenen c4-begrepp, C4, ingen migration, ingen ny ADR)
- Ordlista i `docs/domain-rules.md` (tryckyta/utsnitt/kartram, layout/ark/justering, Kartor per ark, Mall för papperet, notis/svar/kommentar, Medlem = `READER`); UI-texter som blandade mall-orden rättade; ADR-0194/0196 "läsare" → Medlem.
- `LayoutTemplate*` heter `SheetLayout*` i koden (`sheet-layout.ts`; print-sheets förra `SheetLayout` → `PrintSheetsLayout`); lagrade namn kvar med kommentar.
- Inbjudningar tas på ett ställe (`account-arrival.ts`: alla vid ankomst, bara tävlingens och dess grupps när en tävling öppnas); behörighetskontroller tar inga klubbinbjudningar (ADR-0188 ändrat).
- Inbjudningarnas roller per slag i kontraktet (`invitationRoleFits`), trådformatet oförändrat. En `attachGoogleIdentity` för inloggning, koppling, flytt och kommando.
- "Vem ser vad" på `PUT …/clubs/[clubId]/access` (ADR-0209 ändrat). Rogaining: med banläggning är poängen skrivskyddade på tävlingssidan och servern vägrar dem (ADR-0170 ändrat).
- En regel för årsmappar: `yearOfYearFolder` i domänen ("2019 04-02 Skogen" är ingen årsmapp; ADR-0194 ändrat).
- Tester: c4-begrepp.test.ts, rogaining-poang-overforing (C4-fallet), invitation-roles, year-folder, folder-name, organizer-roles.

### 2026-11-07 – Småfel och två ägarbeslut (grenen d-smafixar, migration 0088, ingen ny ADR)
- Återställningen ger ingen annan konto behörighet: adresserna i kopian får vanliga inbjudningar, svaret bara antalet (ADR-0187).
- Migration 0088: `race_person_invitation.actor_account_id` och `invitation_link.issued_by` utan nyckel; inbjudan och länken överlever avsändarens borttagning (ADR-0188/0206). Drizzle utan `.references` som migrationen.
- Kartritarlänkens "Åtgärdat" skriver inte över kontots stängning (ADR-0214). Klubb, grupp, konto, superadmin och Eventor-kopplingen prövar inloggning/behörighet före kroppen (401 i stället för 400/422).
- Livesidan hämtar igen direkt efter en väckning under pågående hämtning. CSS `:global(.site-footer)` och `button:global(.secondary)`.
- Utskrift, Layout och Kartfel hämtar kartfilen med sha256 och webbläsarens lager (`cachedMapFile`, som banläggningen).
- E2E väntar på kartans `data-drawn`. Bortvalda varianter i kontrollerna, ringarnas gap och IOF-längden (ADR-0198). `scripts/` typkontrolleras och lintas.
- Ägarbeslut: klubbarkivets bilder och kartkontroller sparas av medlemmar som ser dem (ADR-0194/0196/0210); ett konto som bara loggar in med Google tas bort efter en ny Google-inloggning (`prompt=login`, `auth_time` ≤ 5 min, ADR-0205).

### 2026-11-07 – Dela upp för stora filer (grenen c3-dela-filer, C3, ingen funktionsändring, ingen migration)
- Schema: `planning.ts` (620 r.) → `planning.ts` 283 + `course-setting.ts` 159 + `print.ts` 71 + `map-content.ts` 110; samma exporter ur `schema.ts`. Gemensam `bytea` i `schema/types.ts` (clubs och party använder den efter C2).
- Banläggning: `types.ts` (652) → `document-types` 342, `edit-types` 162, `check-types` 79, `overprint-types` 83 (`types.ts` återexporterar). `paper-items.ts` (779) → `paper-items` 455 (modell, kontroll, arv), `paper-text` 96 (variablerna), `paper-sheet` 236 (arket, klippningen).
- IOF: `export-result-list.ts` (798) → 122 + `result-list-types` 176, `-xml` 154, `-person` 329, `-team` 43. Fastställande: `result-finalization-basis.ts` (746) → 457 + `result-finalization-load` 165 (läsningen) + `-projection` 160 (frusen projektion, metadata).
- Web: `entry-actions.ts` (538, 24 useState) → 47 + `entry-card-actions` 257, `entry-class-actions` 108, `entry-identity-actions` 78, `entry-registration-actions` 115. Avläsningen `readout/app.tsx` (856) → 398 + `use-station` 140, `use-readout-queue` 148, `use-readout-registration` 42, `use-current-verdict` 37, `use-readout-sound` 39, `verdict-panel.tsx` 150.
- Adminroutes: `allowedMethods` (47 villkor) är en tabell per åtgärd; samma svar för alla 141 åtgärder (jämfört med den gamla funktionen). Tjänsteobjektet i `race-administrator-route-context.ts` (249 r.) är kvar: testerna ersätter tjänster i det och en uppdelning per ruttgrupp ger importcykler.
- Banläggningens editor (811 efter B5) → 776 + `use-suggestion-review.ts` 55. `course-setting-print-page.tsx` (371) orörd.
- Verifierat: lint/typecheck/test i berörda paket, schemadrift, fastställandets integrationstester, race-roles, E2E avlasaren, avlasning-ko, fest, lopardatabas och banlaggning-samarbete lokalt; knip. Efter C2: avläsningen använder `formatDuration` direkt (vidareexporten i `evaluate.ts` borta).

### 2026-11-07 – En hjälpare per sak (grenen c2-hjalpare, ingen migration, ingen ADR)
- `foldForSearch` i domain ersätter sex accentvikningar (ø→o, æ→ae, ß→ss överallt; hjälpsökningen gav förut æ→a). `plural()` i `i18n/plural.ts` ersätter tio kopior och de raka inline-ternärerna.
- Tidsformat i domain: `formatDuration` (ersätter `formatRunningTime` i avläsningen; skalet byggt, 67 byte mindre), `formatClockTime`, `formatHourMinute`, `zonedDate`, `formatDayMonthTime`.
- contracts: `sha256HexSchema`/`SHA256_HEX_PATTERN`, `ANY_UUID_PATTERN` (lika lös som de gamla kopiorna), `SHORT_SESSION_LIFETIME_MS`. domain: `CLUB_ROLE_RANK`. database: `bytea` i `schema/types.ts`.
- `distance`, `nearestOnSegment`, `distanceToSegment`, `polylineLength` i map-file (banläggning och vägval).
- `adminFetch` (CSRF + credentials) ersätter tio `csrf()`-omslag. UI: `Dialog` (fyra dialoger), `CopyButton`/`copyText` (tre kopieringar), `Disclosure` (elva `<details>` med `styles.disclosure`), samma DOM och CSS.
- Verifierat: lint, typecheck och enhetstester i berörda paket; avläsningsskalet byggt.

### 2026-11-07 – Stora kartor laddar snabbare (grenen b5-stora-kartor, ADR-0218, ingen migration)
- Mätt med en syntetisk skogskarta (50 000 objekt, 11 MB OCAD): tolkningen 0,2–0,35 s, att läsa en tolkad karta ur IndexedDB 0,4–1 s (därför ingen sådan cache), hämtningen och ritningen dominerar. Siffror före/efter i ADR-0218.
- Kartfilen sparas i webbläsaren per sha256 (IndexedDB `otid-map-cache`, tre filer, töms vid utloggning); andra öppningen hämtar inget. `map/source/<sha256>` ger `private, max-age=86400, immutable`, ETag och `Vary: Cookie`; 304 efter behörigheten.
- Rumsligt index i `drawMap` (`cull`, bara banläggningens Worker): inzoomat planeras 17 % av objekten, bilden blir densamma. Workern startar under hämtningen och samma vy ritas inte två gånger. "Läser kartfilen … 43 %" under hämtningen.
- Servern: kartväljaren utan frågor per klubb, dubblettförslagen med namnen normaliserade en gång (400 kartor 12,8 → 1,9 s) och sparade per klubb, kartbuntarna grupperade en gång.
- Verifierat: enhetstester (index, cache, adress/ETag, förlopp, kartbuntar, dubbletter), prestandatest för tolkningen, integrationstester (steg-59, adr-0210 med frågeräkning, 0189, 0194, 0196, 0209), E2E `banlaggning-kartcache`.

### 2026-11-07 – Layout fas 3: papperet bara i Layout (grenen b3-layout-fas3, ADR-0217, ingen migration)
- Papperets redigering flyttad från utskriftssidan till Layout-fliken (`LayoutSheets`): banor, baksidan per löpare, kartbytets delar, översikt, papper och kartram, Kartor per ark, papperets element, beskrivningen. Utskrift har bara vad, antal, färger och PDF/skrivare, och visar arken utan redigering.
- "Papper och kartram" i en annan layout än huvudlayouten visar layoutens skala och "Ändra i layouten".
- Sträckavbrott per layout: `PrintLayout.legGaps`, edit `SET_LAYOUT_LEG_GAPS`, rader i "Justera för 1:…"; "Ta bort justeringar" tar dem också.
- `paperUndoFor` behåller `part` vid ångra av SET_PAPER_LAYOUT och DELETE_PAPER_TEMPLATE (test `course-setting-paper-undo.test.ts`).
- Specarna pappersrum, utskrift-omtag, kartbyte, hittbarhet, löparkartor, utskrift och layout arbetar i Layout-fliken; hjälpen ändrad och hjälpknapp i Layout.
### 2026-11-07 – Teststabilitet och behörighetstester (grenen c6-tester, C6, inga produktändringar)
- E2E: `readExercise`/`expectVerdictFor` i `tests/e2e/helpers.ts` väntar på "Bricka <nr>" för just den brickan, sedan status och "Sparad."; alla specar som läser av med övningsstationen använder den (20 specar).
- `placering.spec.ts`: Adas tider från en och samma hela sekund (gav ibland "+4:59"). `live.spec.ts`: Live väntar 20 s (en väckning under en pågående hämtning tas först vid nästa hämtning, 10 s med öppen ström).
- `waitForTimeout` i flödet ersatt med tillstånd: `mapSettled` (kartan ritad och stilla), `courseSettingInPhone` (posten, kön och ångra-historiken i IndexedDB före omladdning), festens hämtning, kartfilens uppladdning. Kvar: `ux-flode` före breddmätningen (två "Hämtar …" stod kvar i CI), väntor före skärmdumpar bakom E2E_SCREENSHOT_DIR, Högdalen-testerna, pekgesternas 16 ms och notisens foto (ingen synlig signal).
- `stafett-steg47`: `compileRoutes` hoppas över mot driftbygget (E2E_BASE_URL).
- Nytt `apps/web/src/lib/organizer-roles.test.ts`: tabell över vad ägare/admin/ledare/medlem i klubben, ledare/medlem i gruppen, utomstående, superadmin, utloggad och importnyckeln får på varje route och metod under organizer/clubs, organizer/groups, account, club-import och superadmin (81 metoder, ~650 anrop mot en egen PostgreSQL-databas; körs när TEST_DATABASE_URL finns). En route som saknas i tabellen fäller testet. Inga felaktiga behörigheter hittades; Google-routes prövas inte (inte inställt i testet).

### 2026-11-07 – Död kod bort och knip i CI (grenen c1-dod-kod, ingen migration)
- Gamla versionsscheman (resultOutcomeV1–V8, storedResult*V4/V6, publicResult*V1–V6, V9-alias) bort; gällande namn kvar. `publicResultListResponseSchema` är format 7.
- Oanvända exporter, konstanter och ~150 exporterade typer bort; `distributeRelayVariants` och `encodeCaptureWalNdjson` flyttade till testerna.
- Döda Drizzle-tabeller (`shortenedCourseClassTransfer*`, `mapContentParts`; SQL-tabellerna kvar), Google-kakans gamla format, `POST …/maps/{mapId}/merge` (ADR-0210 ändrad).
- 82 oanvända i18n-nycklar och 18 CSS-modulklasser bort; `i18n/unused-keys.test.ts` kräver att varje toppnyckel används.
- `pnpm lint:dead` (knip 5.60, `knip.json`) körs i CI-jobbet verify. Undantag med kommentar i `knip.json` (B4-filer, pg, typsnitt).
### 2026-11-07 – Layout som egen flik (grenen b3-layoutflik, ADR-0217, ingen migration)
- Flikarna Banläggning | Layout | Utskrift. Layout: överblick banor × layouter (telefon: lista), layouterna (papper, skala, mall, Kartor per ark), arket öppnat (utsnitt, klippning, papperets element, kartbytets delar, "Justera för 1:7 500": dra nummer, ringavbrott per kontroll, "Ta bort justeringar"), klasstabell med massval, lägen (spara, jämför, återställ, ångra).
- Modell: `event.layouts`, `layoutSheets`, `classLayouts`, `mainLayout`, `layoutStates`; huvudlayouten är banans fält och den enda i .ppen. Utskriften räknar arket genom `layoutDocument` (golden-test: gamla dokument ger byte-identisk PDF). Läget "Från Purple Pen" vid inläsning.
- Kartor till starten delar grupperna per layout (reserver och tryckantal per layout); löparkartor och PDF-jobbet tar arkets layout.
- Utskrift: alla ark i en layout, klasser, provark (ett av varje) och antal (anmälda + reserver eller eget); B2:s färgdel orörd.
- Verifierat: enhetstester (course-setting, domain, contracts, application, web-lib), integration `adr-0217-layout-kartbuntar`, E2E `banlaggning-layout`.
- Återstår: papperets redigering finns kvar också på utskriftssidan (specarna pappersrum, utskrift-omtag, kartbyte, hittbarhet, löparkartor och utskrift använder den; baksidan per löpare och kartbytets delmål finns bara där). Sträckavbrott per layout.
### 2026-11-07 – Städrundan C5: databasen, säkrare migrationer och schema (grenen c5-databas, migration 0087, ändringsmeningar i ADR-0186 och ADR-0189)
- Spärrens scope räknas inte längre upp i ett CHECK (skrevs om sex gånger): listan står i `ACCOUNT_REQUEST_THROTTLE_SCOPES` (schema/accounts.ts), `throttleKeyHash` vägrar andra, databasen kräver bara formen. Klubbens roller behåller sitt CHECK (ändrat en gång, sluten lista).
- K4: `training_group_invitation.actor_account_id` utan främmande nyckel; ett borttaget konto tar inte med sig gruppinbjudningar till andra.
- Bekräftelselänken skriver inte `salt_hex`/`verifier_hex` (nullbara, steg 1). Steg 2 (DROP COLUMN) under Idéer.
- `club_map_merge`/`club_map_duplicate_dismissal` får inga nycklar (målet kan gå upp i en senare sammanslagning och komma tillbaka; `purgeRows` skulle radera klubbens historik via `user_account`); skälet i schema/clubs.ts och ett test.
- Nya tester: `schemadrift.test.ts` (Drizzle mot `information_schema` efter alla migrationer, undantagslista), `c5-databas.test.ts`, kedjad sammanslagning i `adr-0210`. migrations/README.md: journalens ordning är körordningen, nya sist, undantaget i 0079 stängt.

### 2026-11-07 – Serverrapport, larm, mindre säkerhetskopior, belastningstest (grenen b4-serverrapport, ADR-0216, migration 0085)
- Veckorapport söndag kl. 19 och larm (disk, kartkvot, backup, hälsokontroll, minne; högst ett per sort och dygn, "löst" när det gått över) till superadmin via mail.ts, från `web` (`lib/server-watch-runner.ts`, `application/server-report.ts` + `server-status.ts`). Tabellerna `server_sample`, `server_notice`, `server_notice_log`. `node superadmin.mjs server-report` visar rapporten.
- `monitor.sh` skriver `./status/monitor.log`, `backup.sh` `./backups/.backup-status`; `web` monterar `./backups` och `./status` skrivskyddat (compose). Inget nytt i `.env` krävs.
- Backup: kartinnehållet en gång per innehåll i `./backups/map-content`, miniatyrer och kartkontroller utesluts, 24 timdumpar; `sh /backup.sh restore-map-content` efter pg_restore. Dump och återställning provade lokalt (md5 lika, även omtagen dump).
- `pnpm load-test` (N samtidiga tävlingar via API:t) och bedömning för CX23 i docs/drift.md.
- Tester: `server-report.test.ts` (16), `adr-0216-serverrapport.test.ts` (integration), `server-watch-runner.test.ts`; CI kör `server-report` i driftjobbet.

### 2026-11-07 – Förenklade färger för tryck (grenen b2-tryckfarger, ADR-0215, ingen migration)
- Ny förvald profil "Kartans egna färger" (`map-own`): kartfilens färger i normens ordning utan att någon gör något. En tävling som valt en profil behåller den; en som aldrig valt får normens ordning i nästa PDF.
- "Färger för tryck": en statusrad ("Färger: kartans egna, i normens ordning (32 färger, 3 över banan)") med "Visa", lägena "Kartans egna färger" och "Tryck hos BL". BL visar bara de tveksamma färgerna (ingen säker rad eller fel sida mot normen) och "Godta alla säkra".
- Profilval, banans färg, färgordningen, BL:s hela lista, tabellen för hand, förhandskontrollen och JSON under "Avancerat" (stängt). Ett lagrat eget val visas som "Egna inställningar (Avancerat)".
- Fliken Utskrift använder `COURSE_PRINT_SCALES` (också 1:3 000).
- Verifierat: enhetstester (`course-setting-print-colors-mode.test.ts`, `course-setting-print-colors.test.tsx`), print-pdf-testerna oförändrade; E2E `banlaggning-pdf` (statusrad, Avancerat stängt, `map-own` i jobbet), `utskrift-bl` och `hittbarhet` väljer BL med radioknappen.
### 2026-11-07 – Ostadiga E2E: avläsningen väntar på sin egen bricka (grenen c6-flaky-e2e, testfel, ingen produktändring)
- `stafett-steg47.spec.ts` (lag 1 "deltog i omstart" placerad först) och `listor.spec.ts` (Eva Sjö saknades per klubb) hade samma orsak: testet godtog förra löparens "GODKÄND" och "Sparad." som besked för nästa bricka. Övningsstationen tar ur en bricka som sitter i när nästa sätts i, så den sista brickan (eller en mitt i) blev aldrig avläst: lag 2 var ute på sträcka 3 och laget i omstart ensamt godkänt.
- Testen väntar nu på "Bricka <nummer> · …" i beskedet före status och "Sparad.". Placeringen efter omstart är rätt: nytt integrationstest i `adr-0174-stafett.test.ts` med E2E-testets läge (fart 97/94 %, omstart flyttad till hel minut mellan växlingarna).

### 2026-11-07 – Drift: publika sökvägar, beroenden, hälsokontroll (grenen a2-drift, ingen migration, ingen ny ADR)
- Caddy: `/g/…` (träningsgrupperna), `/icon.svg`, `/apple-icon.png`, `/manifest.webmanifest` och `/icons/…` till publikens instanser. Listan står en gång i koden (`PUBLIC_PATHS`, `apps/web/src/lib/public-paths.ts`); testet kräver att Caddyfiles `@public` är samma, att varje sida med `publicDb` är publik och att inget av admin, konto, arbetsytan eller deras API:er är det. ADR-0177 har en mening om det.
- Beroenden: `@playwright/test` 1.55.0 → 1.55.1 (GHSA-7mvr-c777-76hp, hög; samma Chromium 140). 1.63 och 1.65 fäller `banlaggning-falt`: omladdningen utan nät når inte service workern (1.63), kompassen ger 0 (1.65, Chromium 158) – eget arbete, next 16.4.4 (inte 16.4.5: den tar bort `content-encoding` från route handlers svar, och de förpackade gzip-svaren i `public-race-cache.ts` blir oläsliga; 16 E2E föll), pg 8.23.1, jose 6.2.15. `pnpm audit` 19 → 18 fynd (kvar: vitest/tinypool/vite, brace-expansion, minimatch i utvecklingsverktygen).
- Hälsokontrollen i `docker-compose.prod.yml`: web, web-public och web-public2 frågar `/api/health` var 30:e sekund (timeout 5 s, start_period 120 s, retries 10) i stället för `/organizer` och `/om` var 5:e. `up -d` väntar därför upp till ~30 s längre på varje steg (web, sedan publikens instanser).
- docs/drift.md: Caddyfile-ändringar kräver `docker compose -f docker-compose.prod.yml restart caddy` (filen är monterad som enskild fil); tabell över miljövariablerna som saknas i `prod.env.example`.
- Servern: `git pull && dc pull && dc up -d && dc restart caddy` räcker; inget mer krävs.
### 2026-11-07 – Saknad skala för banan är kartans, också i .ppen (grenen a6-tryckskala, ADR-0211 beslut 13)
- En ny bana och en bana ur IOF XML får ingen skala inskriven; `readPpen` läser `print-scale` lika med kartans skala som saknad. `writePpen` skriver kartans skala tillbaka (A3), så Purple Pen får samma `<options>`.
- Tester: `print-scale-default.test.ts` (ny bana, banfil, rundtripp med fixturen och med en annan skala); A3:s rundtripptest förväntar nu ingen skala efter återinläsning.

### 2026-11-07 – Kom igång i klubbytan (grenen b1-kom-igang, ändringsmening i ADR-0209, ingen migration)
- "Kom igång" överst i klubbytan för ägare och administratörer: koppla till Eventor med klubbens API-nyckel, bjud in fler ledare/admin, kartor eller import, Vem ser vad (förval). Försvinner vid koppling + minst en karta; "Dölj" i localStorage per klubbyta. En ny klubbyta säger "Nästa steg: koppla klubbytan till Eventor".
- "Be klubbens Eventor-administratör koppla" (i kortet och i kopplingsrutan): text att kopiera eller öppna i e-post utan mottagare; ingen nyckel i texten.
- Var nyckeln finns: Eventor → Klubb → Klubbinställningar (Eventors guide: Club → Club settings) i kopplingsrutan, hjälpen och tävlingens Eventor-ruta (`EVENTOR_KEY_PLACE`). Ny hjälpartikel "Kom igång med klubbytan".
- Verifierat: enhetstester (`lib/club-start.test.ts`), `klubbtillhorighet.spec.ts` (kortet för ägaren, inte för medlemmen, dialogen, Dölj).

### 2026-11-07 – Bortvalda varianter påverkar inte banläggningen, en regel för banans längd (grenen a6-bortvalda, ADR-0198 tillägg 12)
- B5: "sträcka/kontroll i förbjudet område" och nivåstödet räknar bara kontroller och sträckor i varianter som används (`activeParts`, `activeControlOrders`).
- Banans längd: `courseLength` (fast längd först, annars längsta kvarvarande variant, eller den valda varianten) i banlistan, beskrivningen, utskriftens rubrik, `$(CourseLength)`, `{längd}` och överföringen. Rubriken, makrot och `{längd}` räknade förut med bortvalda.
- B11: krysset (förbjuden väg) spärrar så stort som det ritas (1,06 × figurskalan) i stället för fasta 1,5 kartans mm.
- Väntar på A3: att en ny eller importerad bana inte får något förval för skalan (saknas = kartans skala) läggs på när ppen-write behåller `<options>` utan skala.
- Verifierat: enhetstester (course-setting, application) och nya tester som fallerade före.
### 2026-11-07 – Städrundan A1: säkerhet och personuppgifter (grenen a1-sakerhet, migration 0084, ingen ny ADR)
- Säkerhetskopian: förhandsvisningen säger inte vilka adresser som har konto (hemmagjord zip var ett kontoorakel); personer "Från klubben" följer med utan adress och kopplas per referens (ADR-0187, ADR-0209).
- Klubbytan: fritext som liknar namnet bara i en Eventor-kopplad klubbyta och mot klubbens namn; medlemslistan bara för ägare och admin, läsare och ledare ser sin egen rad, inget konto-id.
- Inbjudningsmejlens spärr (mottagare och avsändare, timme och dygn) i `account_request_throttle`, så att en borttagen tävling inte nollställer den (ADR-0206, migration 0084).
- Ny registrering av obekräftad adress: namnet skrivs över och länken minns sitt namn (`email_verification_token.display_name`, ADR-0205).
- Kartritarsidan: svar med konto som "Banläggaren"/"Kartritaren" utan namn och tid (ADR-0214 beslut 4).
- Utloggningen spärrar alltid sessionen på servern (exakt Origin räcker utan CSRF-kakan); "Du är utloggad" först efter svaret.
- CSV: `toCsv`/`csvCell` i `@o-tid/domain` (BOM, `;`, formelskydd) också för festen och "Kontrollera kopplingen". Varning en gång om X-Forwarded-For saknas i https-drift; inbjudans `next` får inte börja med `//`.
- Verifierat: lint och typecheck (per paket), enhetstester, integration (`aterstallning`, `adr-0186`, `adr-0194`, `adr-0206`, `adr-0209`, `adr-0214` utom ett test som fallerar också på main).
### 2026-11-07 – Städrundan A4: konton och klubbar (grenen a4-konto, ändringsmeningar i ADR-0205 och ADR-0209, ingen migration)
- Koppla Google-konto: egna klubbsvar (utan `decided_by`) räknas som tomt konto, så en dubblett som svarat på klubbfrågan går att flytta; konto i bruk utan lösenord ger beskedet "Glömt lösenordet först" (`?google=upptaget-utan-losenord`).
- Välj karta från klubbarkivet: bekräftade medlemmar ser klubbens kartor (samma medlemskap som övriga ställen), prövningen på en gång och utan sammanslagningshistorik.
- Ta bort kontot vägras för ensam ägare av klubb eller ensam ledare av träningsgrupp; Mitt konto listar dem.
- Eventors medlemslista: tillbakadragandet använder hämtningens konfiguration; adresserna normaliseras som kontots (NFC), också i `verify`-kommandot.
- Kartritarens länk: "Inte åtgärdat" öppnar inte en notis som ett konto har stängt.
- Verifierat: integration (`adr-0205-google-koppla`, `adr-0210`, `adr-0172-accounts`, `adr-0209`, `adr-0214` utom ett tidsberoende test som fallerar också på main), enhetstester, lint, typecheck.
- Återstår: `training_group_invitation.actor_account_id` har FK, så kontoradering tar andras gruppinbjudningar (kräver migration).
### 2026-11-07 – Städrundan A3: tryck (grenen a3-tryck, ändringar i ADR-0184, ADR-0203 och ADR-0211, ingen migration)
- PDF-jobbet: kartbytets del och "Dubbelsidigt" följer med från förhandsvisningen (förut hela banan en gång per del och aldrig dubbelsidigt utan löpare); delar vänds alltid på långsidan.
- Servern filtrerar bort bortvalda gafflingsvarianter ur jobbet och säger det i notiserna.
- Normens färgordning: vita specialobjekt (white-out) och bilder ritas under banan, och kartans färger över banan ritas inte i dem, i PDF:en och förhandsvisningen.
- .ppen: automatisk tryckyta (0,0,0,0 som Purple Pen) läses tillbaka utan rektangel; `<options>` skrivs alltid, med kartans skala när banan saknar egen.
- Ringklipp också för kartor med egen skala i jobbet. Sträckans fasta avbrott räknas från kontrollens mitt (test fixerar konventionen, ingen kodändring).
- Verifierat: enhetstester (course-setting, print-pdf, application, web), integration `steg-65-tryck`, lint och typecheck per paket, provark-PDF (syntetisk karta) renderad med pdftoppm och Ghostscript.
### 2026-11-07 – Städrundan A5: tävlingsdag, stafett, rogaining, klubbarkiv (grenen a5-tavlingsdag, ingen migration)
- Flytta banorna: okänt koordinatsystem (OCAD 8, OCAD 9–11 utan kod) ger alltid "kontrollera själv" (`UNKNOWN_CRS`), aldrig "Georefererad".
- IOF XML-banor: poängbanans förvalda poäng (koden/10) skrivs som `Score`; ADR-0190 ändrad.
- Kartor till starten: listan per klass skiljer stafettens sträckor (`leg` i grupp och kontrakt); rogaining ingår som ogafflade grupper. ADR-0213 ändrad.
- Stafett: ny fast variant skriver om sträcklöparnas variant med ny version och auditpost; avläsningens paket ger sträckans fasta variant när löparens saknas. ADR-0174 ändrad.
- Använd igen: kartan och kartavtalet i samma transaktion. Gruppens bibliotek: "senaste version" i arkivets ordning (året först).
- Kontrollera kopplingen: död varning "samma startnummer" borttagen. Dubbletter: pappersytan kräver namnlikhet eller gemensam träning. ADR-0210 ändrad.
- Verifierat: enhetstester, integration (`adr-0174-stafett`, `adr-0194-klubbarkiv`, `adr-0213-stafett-kartor`, `adr-0210-kartor-sammanfoga`), lint, typecheck.

### 2026-11-05 – Länken till kartritaren och redigera egna notiser (grenen kartritare-lank, ADR-0214, migration 0083)
- Kartfel → "Dela med kartritaren" (den som får ändra): länk med 256-bitars nyckel, bara hashen sparas, visas en gång med "Kopiera länken"; "Begränsa tiden" (förslag tävlingsdagen + 7), "Visa tävlingens namn", "Senast öppnad", "Stäng av länken", "Skapa ny länk".
- `/kartfel/<nyckel>` utan konto: kartan (kartfilen ritas i webbläsaren) med kartfelen och löpnummer, listan, tråden, svar, "Åtgärdat i kartan"/"Inte åtgärdat", "Min position". Inga banor, kontroller, foton eller deltagare. Ogiltig/avstängd/utgången länk: samma besked.
- Svaren går via tävlingens instans och syns direkt i Kartfel och editorn (banläggningens ström). Spärr per IP och länk, Origin + eget huvud på skrivningar, journalposter, no-index, Caddy.
- "Redigera" på egna notiser och svar (bara den som skrev), "(ändrad …)", tidigare text i historiken, 409 vid samtidig ändring.
- Verifierat: enhetstester (domain, application, web med routetestet för länkens routes), integration (`adr-0214-kartritarens-lank` och hela sviten), lint, typecheck, Playwright `kartritarens-lank` i 1280 och 390 px.
- Återstår: kartritaren skapar kartfel och redigerar sina svar med länken (inte byggt).

### 2026-11-04 – Färgordningen i trycket rättad (grenen tryck-fargordning, ADR-0211 beslut 11, ingen migration)
- Orsak till vita skivor och vita streck på ägarens provtryck (Stockholm by Night, ISOM): allt vitt lyftes över banan om det låg över den lägsta "över"-färgen (Svart för odlad mark), men grönt för punkter och vägkanternas svart ligger under; glorian täckte ringen och järnvägens vitt låg över strecken.
- Normen bestämmer bara sidan; inom sidan gäller kartfilens ordning. Vitt över banan bara om det ligger över all svart och inget under banan ritas över det. Svart för odlad mark med rastren under banan. Vitt aldrig med övertryck eller multiplicering.
- Skog: numren i undre lila som förval (kurvorna korsar dem); "Kontrollnummer och texter överst" som val. Sprint som förut.
- Kontors-PDF:en: tävlingsprofilens färgordning och kartans färger över banan med /BM /Multiply; tryck-PDF:en oförändrad (/OP, /OPM 1). Rad om Acrobat och Förhandsvisning under knappen; förhandsvisningen ritar övre vitt utan multiplicering.
- Verifierat: enhetstester (course-setting, print-pdf med påhittad gloria-, järnvägs- och kurvkarta och Ghostscript, web), lint, typecheck, hela Playwright-sviten i CI (`banlaggning-pdf` provar kontors-PDF:ens multiplicering); före och efter med pdftoppm.
- Återstår: provtryck hos tryckeriet med ägarens karta.

### 2026-11-04 – Löparkopplade kartor (grenen lopar-kartor, ADR-0213, ingen migration)
- Löparens variabler på papperet: {namn} {startnummer} {klubb} {klass} {starttid} {variant} och för stafett {lag} {lagnummer} {sträcka}; platshållare med en rad i banornas förhandsvisning.
- "Baksida med löparens uppgifter": dubbelsidigt i samma PDF (baksidan redigeras på arket som "Baksidan (per löpare)", förvalet som Kartor till startens baksida, `SET_RUNNER_BACK`) eller separat körning.
- "Vilka som skrivs ut": alla, klasser, löpare (sök på namn eller nummer) eller lag med alla sträckor eller en sträcka; framsida och baksida följer urvalet.
- Stafetten i Kartor till starten: en klass per sträcka med lagens varianter, efter de individuella; lag och sträcka i listan och på kartorna.
- "Kontrollera kopplingen": PDF-sida, Nr, Namn, Klubb, Klass, Lag/Sträcka, Bana, Variant, Starttid; sortering, filter, fyra varningar, förhandsvisning per rad, CSV; länk från Kartor till starten.
- Verifierat: enhetstester (course-setting, domain, contracts, print-pdf med fram/bak för tre löpare, web), lint, typecheck, Playwright `lopar-kartor` lokalt.
- Återstår: IOF-exporten av lagens gafflingar (utanför uppdraget).

### 2026-11-04 – Nivåstöd omkalibrerat (grenen nivastod-2, ändring i ADR-0212, ingen migration)
- Stämt mot 238 märkta banor ur klubbens träningsbank (lokalt, committas inte) och Djurgårdens natt-KM: öppen mark är en yta (bara kanten är ledstång), föremålets storlek väger mer, stignätets korsningar och likvärdiga vägval (inom 10 %) är nya mått och regler, genandet räknas först vid 50 %.
- Banans nivå är två tredjedelar-punkten med spridningen; en park i 1:15 000 är skogsnorm (bara 1:4 000/1:5 000 är sprint i nivåstödet).
- Märkta banor inom ±1 steg 90 % (exakt 47 %, före 39 %), nivåerna i rätt ordning; Djurgården Gul–Orange (före Vit–Gul). Siffrorna i ADR-0212.
- Verifierat: enhetstester (course-setting, web), lint, typecheck, Playwright `banlaggning-nivastod`. Återstår: nattval saknas i tävlingen, så "Natt: upplevs svårare" visas inte.

### 2026-11-04 – Koppla Google-konto, kontomenyn och Mina tävlingar (grenen google-koppla, ADR-0205 tillägg, migration 0082)
- Mitt konto → "Koppla Google-konto": Google-kontot kopplas till kontot också med en annan adress (bunden till sessionen, `email_verified`); "Ta bort kopplingen" vägras utan eget lösenord.
- Kopplat till ett tomt konto (dubbletten): sidan `/konto/flytta-google` säger vad som händer, lösenordet bekräftar, dubbletten tas bort och loggas; används kontot vägras det. Superadmin: `superadmin.mjs google move <källa> <mål> [--delete-source-if-empty]`.
- Kontomenyn (namnet/initialerna) på alla inloggade sidor: Mina tävlingar, Mina klubbar, Mina grupper, Mitt konto, Logga ut; utloggningen rensar webbläsarens tävlings- och persondata och varnar när ändringar väntar på nät. "Logga ut från alla enheter".
- "Kom ihåg mig på den här datorn" (av som förval): annars tolv timmar och en sessionskaka.
- Mina tävlingar: Mina klubbar och Mina grupper som remsa överst (roll, antal, väntar på bekräftelse, Ny klubbyta/Ny grupp); tidigare tävlingar ihopfällda, sökningen gäller dem också.
- Verifierat: se slutrapporten (enhet, integration `adr-0205-google-koppla`, Playwright `konto-meny` 1280/390).

### 2026-11-04 – Utskriften putsad (grenen utskrift-omtag-2, ADR-0211 beslut 10, ingen migration)
- Dev-överläggets "1 Issue": dubbla React-nycklar för en banas kartbytesdelar i översikten. Rättat; utskriftens E2E fäller nu på sidfel, `console.error` och svar ≥ 400 (`browserErrors`), vilket också hittade en 404 för en nyss uppladdad bild (visas nu ur webbläsarens kopia).
- "Layoutmall" heter "Kartor per ark" och står bredvid nya "Papper och kartram"; "Mall för papperet" heter likadant i panelen och översikten.
- Redigera arket: arken först, panelerna bredvid (datorn) eller under (telefonen); en mening och "?" per panel; Klippning, Vitt, Uppgifter och Mitt bibliotek hopfällda.
- Papper, riktning, marginal, tryckyta och överlapp på arket; kartramen flyttas och ändrar storlek på arket. Editorns flik Utskrift länkar dit.
- Verifierat: enhetstester (web, nya `course-setting-sheet-frame`), lint, typecheck, Playwright `utskrift-omtag` lokalt; övriga utskriftsspecar i CI.

### 2026-11-04 – Nivåstöd (grenen nivastod, ADR-0212, ingen migration)
- "Nivå" i banans egenskaper (Grön … Svart, förslag ur klasserna med SOFT:s tabell); sparas i dokumentet, inte i .ppen, följer med ny .ppen.
- "Bedöm nivån" och "Bedöm alla banor" bara på begäran, i vägvalens Worker (samma motor och tabell; ny väg längs stigar `LegInput.follow`).
- Mätning ur kartans symboler: avstånd till ledstänger, föremålets storlek, angreppspunkt, inläsning; längs vägvalet andel på ledstänger, längsta bit utan, byten, lönar det sig att gena, kurvläsning. Regeltabell `LEVEL_LIMITS` med skäl och tips per regel.
- Panelen med märken i nivåns färg, skäl, tips, "Visa på kartan" och "Visa förslag på kartan"; "Inaktuell – bedöm igen"; "Nivåmarkeringar" under Visa; notiser i Varningar bara med "Visa avvikelser mot nivån i Varningar". Sprint: inte tillämpligt.
- Hjälpen: "Nivåstöd – grön, vit, gul …" och en guide per nivå med SOFT:s banlängder.
- Verifierat: enhetstester (course-setting, route-choice, web), integration `adr-0212-nivastod`, lint, typecheck, Playwright `banlaggning-nivastod` (1280/390).
- Återstår: stämma av gränserna mot banor med kända nivåer.

### 2026-11-04 – Utskriften om (grenen utskrift-omtag, ADR-0211, ingen migration)
- Ringklippen över detaljer följer med till förhandsvisningen och PDF:en (`printSheetGroups` fick aldrig detaljgapen; nu `printDetailGaps` i servern och samma Worker som editorn).
- Sträckorna slutar 0,35 mm utanför ringar, start och mål (ISOM 705; Purple Pen har inget mellanrum), inställbart under Utseende.
- Färgordningen efter normen (ISOM/ISSprOM) med undre och övre lila, övertryck på färgerna över banan och multiplicering i förhandsvisningen; asfalt och byggnadsytor ligger under banan. Numren undviker hus och svarta linjer; placerade nummer på ett hus ger en notis.
- "Skala för banan" i banans egenskaper; fliken Utskrift visar den.
- Utskriftssidan: Färger för tryck i ett flöde (kompakt rad, kort, "Justera färger för hand"), Skriv ut med skrivaren och PDF:en bredvid varandra, översikten med ett kort per ark, mallen på markerade eller alla banor.
- Papperet direkt på arket: markera flera, fästning med hjälplinjer (Alt fritt), rutnät, justera/fördela, lager (ordning, lås, dölj), dubbelklick skriver i texten, ram, linje, "Vitt på utskriften", Gör om. Mallen bär papper, riktning, marginal och vita ytor.
- Verifierat: enhetstester (course-setting, print-pdf, application, contracts, web), lint, typecheck, PDF-tester (ringklipp, ordningen per norm, mellanrum, ramar, vita ytor). Playwright `utskrift-omtag` (1280/390) och de ändrade utskriftsspecarna i CI.
- Återstår: vridning, kartramen direkt på arket, papperet i editorns flik Utskrift (mallen bär det), editorn i normens färgordning.

### 2026-11-04 – Inbjudningar med e-post (grenen inbjudan-mejl, ADR-0206, migration 0073)
- Med `OTID_SMTP_URL` mejlas varje ny inbjudan (klubbarkivets medlemmar, tävlingens Personer med behörighet med banläggningens roller, träningsgruppen och "Från klubben"): vem, till vad, rollen i ord och en länk `/inbjudan#token=…` (14 dagar, bara hashen sparas).
- Länksidan: "Skapa konto" (adressen låst) eller "Logga in"; efter inloggningen eller bekräftelsen hamnar personen på klubben eller tävlingen. Länken ger ingenting själv; bekräftelsen hoppas inte över (beslut 4).
- Listorna: "skickad …"/"inte skickad", "Skicka igen" (ny nyckel, spärrad) eller "Kopiera länken" utan e-post; borttagen inbjudan ger "Inbjudan gäller inte längre". Flera adresser på en gång med sammanfattning.
- Spärrar per avsändare (100/h, 300/dygn) och mottagare (3/h, 10/dygn); "Från klubben" visar aldrig adressen och kan inte kopieras.
- Verifierat: enhetstester (mejltexten, adresserna, hjälpen, routernas roller), integration `adr-0206-inbjudningar` och `adr-0209-klubbtillhorighet`, lint, typecheck; Playwright `inbjudan`. Återstår: provning mot riktig SMTP.

### 2026-11-04 – Kontot: ingen loop mellan bekräftelse och återställning, lösenordet två gånger, Logga in med Google (grenen konto-inloggning, ADR-0205, migration 0072)
- Orsaken till loopen från klubbmötet 2026-11-03: bekräftelselänken krävde registreringens (felskrivna) lösenord och skickade tillbaka till inloggningen; efter fem fel spärrades adressen från IP-adressen, och återställningen nollställde bara spärren utan IP-adress, så det nya lösenordet gav "För många försök" och den gamla länken "ogiltig".
- Bekräftelselänken bevisar adressen och personen väljer lösenordet där; redan bekräftad eller gammal länk ger ett nästa steg (Logga in / Glömt lösenordet). Återställningslänken bekräftar alltid adressen och loggar in där den öppnas; ett nytt lösenord häver spärren.
- Lösenordet två gånger med besked direkt och ögat (registrering, bekräftelse, återställning, byte). Mejlen säger samma sak.
- Logga in med Google (PKCE, state, nonce, JWKS via `jose`) när `OTID_GOOGLE_CLIENT_ID` och `OTID_GOOGLE_CLIENT_SECRET` är satta; koppling på `sub` (0072). Alla inloggningsvägar tar inbjudningar och Eventor-listan (`acceptOnLogin`).
- Hjälpen: Skapa konto, Glömt lösenordet, Logga in med Google. Drift: docs/drift.md (Inloggning med Google, steg i Google Cloud Console).
- Verifierat: se slutrapporten för grenen. Återstår: Google-klienten på servern (ägaren) och provning mot riktiga Google.

### 2026-11-04 – Kartbanken för alla medlemmar som förval (grenen kartbank-forval, ändring i ADR-0209, migration 0079)
- Ägaren: kartorna döljs bara som undantag. "Kartbanken (kartfiler, Använd igen, nedladdning) får användas av" har förvalet "Alla medlemmar" (först och förvald) med tipset "Välj Ledare och admin om kartorna inte ska delas med alla medlemmar"; `CLUB_AREA_DEFAULTS` och kolumnens förval.
- Migration 0079: befintliga `LEADERS` blir alla medlemmar utom där en administratör valt det (journalen `CLUB_ACCESS_CHANGED`); godtas i ett steg eftersom ingen driftsatt server har 0076.
- Hjälpen (`bekrafta-medlemmar`) säger det nya förvalet. Testerna `adr-0194`, `adr-0210` och `klubbarkiv` bjuder åter in en vanlig medlem för Använd igen; `adr-0209` och `klubbtillhorighet` provar båda valen och migrationen.
- Verifierat: se slutrapporten för grenen.

### 2026-11-03 – Klubbtillhörighet (grenen klubbtillhorighet, ADR-0209, migration 0076)
- Klubblistan från Eventor (`organisation`, `node superadmin.mjs clubs refresh|import|sync`, högst en gång per dygn), sökning utan accenter med kortnamn och initialer.
- "Vilken klubb tillhör du?" efter registreringen och Mitt konto → Mina klubbar; en egen anmälan ger ingenting.
- Klubbytan: fliken Klubben med "Koppla till Eventor" (klubbens nyckel, krypterad), medlemslistan som HMAC av adressen med automatisk bekräftelse, Väntar på bekräftelse, Vem ser vad (arkivet och kartbanken; ägare och admin alltid allt), rollen Ledare.
- "Från klubben" i tävlingens personer, klubbytans medlemmar och träningsgrupper (namn, aldrig adresser). Byggt utan grenen inbjudan-mejl (den var WIP): mejlavsändaren skickas med när den är med.
- Tävlingens arrangörsklubb, "Lägg i klubbarkivet"/"Ta ur klubbarkivet" (dubbel administratör, banhemligheten, inga personuppgifter) och påminnelsen i Resultat.
- Verifierat: enhetstester (domain, eventor, hjälpen), integration `adr-0209-klubbtillhorighet` och `adr-0194`, lint, typecheck; Playwright `klubbtillhorighet` (1280/390). Återstår: provning mot riktiga Eventor (organisationslistans förälder/land och medlemslistans adressfält).
### 2026-11-03 – Kartarkivets dubbletter och versioner, och kartan ur klubbarkivet (grenen kartor-sammanfoga, ADR-0210, migration 0077)
- "Möjliga dubbletter (n)" i Kartor-fliken (ägare och administratörer): par av kartor jämförs på georeferensens överlapp, namnet (utan accenter, år, datum och ord som ny/rev/version/kopia), kartytan, symbolerna, skalan och gemensamma träningar (`map-duplicates.ts` i domänen); grupperna är "Troligen samma karta" eller "Kanske samma" med skälen. Fingeravtrycket sparas vid kontrollen i webbläsaren; servern läser inga kartfiler.
- "Slå ihop till en karta" (välj vilken som behåller namnet), "Inte samma karta" (sparas per par), "Slå ihop markerade" och "Ångra sammanslagning" under Historik så länge kartan är oförändrad. Bara metadata: innehållet, kvoten och träningarnas versioner är orörda; journalförs.
- Varje version har ett år (filnamnet, mappen, årsmappen, datumet, uppladdningen; går att skriva in), nyaste först, "5 versioner, 2014–2023". Kartan har beskrivning och kartritare; "Kopiera till alla versioner" och "Från kartan" med förhandsvisning.
- "Välj karta från klubbarkivet" i Skapa tävling och i banläggningens start: samma väg som Använd igen (bara bilden skickas, rättigheterna följer med); `mayUseClubMap` är det enda beslutet om vem som får använda kartan.
- Gränserna provade lokalt mot klubbens riktiga OCAD-filer (inga namn eller filer committade). Verifierat: se slutrapporten för grenen.

### 2026-11-03 – Kartbyten: delar, dubbelsidigt och överlapp (grenen kartbyte-delar, ADR-0203)
- Delar som Purple Pen (`course-parts.ts`): kartbytet sist i en del och först i nästa, ritat som start; numren fortsätter; eget kartbyte sist döljs; `part-options show-finish`; specialobjekt per del.
- Fliken Utskrift: "Kartbyten" med "Del" (Hela banan / Del 1 / Del 2 …), egen tryckyta per del (`<print-area part="n">` i .ppen, "Som banans igen") och "Visa överlapp" (Ingen / Sista sträckan / Hela föregående del).
- Utskriften: en karta per del med delens beskrivning, tryckyta och papper (ärver banans; "Alla sidor" = alla delar); "Dubbelsidigt" lägger del 2 på baksidan, tom baksida vid udda antal, förval när kartan vänds. Överlappet tonat 35 % utan nummer (PDF: dekorfärgen med andel 0,35).
- Utskriftssidans sparanden går genom `saveOnLatest` (ett tyst nytt försök på senaste versionen); profilvalet och beskrivningen som dras på arket visar "Ändringen sparades inte – försök igen" när det ändå inte gick.
- Verifierat: enhetstester (`course-parts` mot Purple Pens mapexchange-filer och CourseView-tester), print-pdf `parts-pdf`, hjälptestet, lint; Playwright `banlaggning-kartbyte` (1280/390).
### 2026-11-03 – Årsmappen följer med (grenen arkiv-webbimport-2, ändring i ADR-0204)
- Väljs en årsmapp (2019, "2019 träningar") direkt, i kommandot eller i webbläsaren, blir den sökvägens första del och träningarna behåller året (`pathInChosenFolder`). Hjälpen och fältets tips säger att en enda årsmapp går bra.
- Förvalet för ledarnas namn är konstanten `LEADERS_BY_DEFAULT` (med, som förut); kommandot har också `--med-ledare`.
- Verifierat: se slutrapporten för grenen.

### 2026-11-03 – Banfil som banläggning: ägarens svar (grenen iof-foljd)
- Längden: en banfils längd sparas aldrig som fast längd; den räknas ur lägena så att en flyttad kontroll ändrar den. Skiljer filens längd mer än 50 m sägs det en gång ("Banfilens längd för A var 4,2 km, uppmätt 4,0 km.").
- Beskedet om varianter som blev egna banor står kvar tills det stängs (övriga besked försvinner som förut).
- Rogaining: ett tomt poängfält på en poängbana betyder kodens första siffra (tiotalet, som tävlingens `defaultRogainingPoints` och IRF:s regel C9); summan räknar så. "Överför till tävlingen" i en rogaining tar med poängen per kod (`controlPoints`, null = förvalet); ändrade poäng är egna rader (Kontroll, Poäng) och prövas mot avlästa löpare; Kontroller & poäng kan ändra efteråt. Hjälpen: ny artikel Rogaining, editorns rad.
- Fest: oförändrat (bara utskrift, ingen överföring).
- Verifierat: enhetstester (course-setting, application diff och överföring, webbens lib och hjälp), integration `rogaining-poang-overforing`, typecheck och lint.

### 2026-11-03 – Importen till klubbarkivet i webbläsaren (grenen arkiv-webbimport, ADR-0204, ingen migration)
- Fliken Import: "Välj mapp" (webkitdirectory), "Välj filer" (zip eller lösa filer) och dra och släpp av mappar/zip; kort besked på telefon. Kommandot och nyckeln hopfällda under "För den som kan Git: kommandoraden".
- `@o-tid/club-archive` läser en abstrakt källa: samma läsning, plan, rapport och uppladdning för disken (kommandot) och File/Blob (Blob.slice, DecompressionStream, WebCrypto). PDF, startlistor och bilder öppnas aldrig och skickas aldrig; kartor över 75 MB läses inte och sägs i förhandsgranskningen.
- "Förhandsgranska" = `--dry-run` (nytt/finns redan, kvoten, det som inte skickas, problem, "Ladda ner rapporten"); "Importera" med förlopp ("Karta 3 av 12", "Träning 50 av 212") och "Avbryt"; idempotent omkörning. "Ta inte med ledarens namn ur [hakparenteser]" = `--utan-ledare`.
- Inloggningen i stället för nyckeln: `/api/organizer/clubs/{id}/import/…` med Origin och CSRF, rollen administratör; samma tjänster som nyckelns väg. Kontrollfrågan tar valfria `importKeys` och svarar `knownEntries`.
- Verifierat: se slutrapporten för grenen. Hjälpartikeln `arkiv-import` skriven om kring webbläsaren.

### 2026-11-03 – Färre varianter, ägarens svar (grenen gaffling-urval-2, tillägg i ADR-0198)
- "Begränsa varianter" har sätt: förval "Ta bort de längsta" med 3 (1 till alla utom en), bara bland varianter som är längre i alla avseenden än en som blir kvar, längs vägval när den är räknad; "Längst i alla avseenden (alla)" och taken finns kvar. Förhandsgranskningen säger skälet.
- Tävlingens baneditor: en sparad struktur tar inte med bortvalda varianter och bortvalen följer med till nya banversionen; ett bortval som slutar stämma sägs i förhandsgranskningen och tappas inte. En IOF-banfil utan bortval tar inte heller tillbaka dem.
- Utskrift per löpare: bortvalda varianter skrivs inte ut (inte heller som reserv) och sägs som problem. Hjälpen Färre varianter uppdaterad.
- Verifierat: enhetstester (domän, application, webbens variant- och utskriftslogik, hjälpen), integration adr-0198 med baneditorn; Playwright i CI.

### 2026-11-03 – Varningar som går att godta (grenen varningar, ADR-0199)
- Nivåer: fel (samma kod, kod saknas, start/mål saknas, kontroll i förbjudet område, sträcka utan laglig väg), varningar och notiser; grupperade per sort med antal, fel först. Fliken räknar bara fel och varningar som inte är godtagna.
- Förbjudna områden: fågelvägen genom ett område är ingen varning när vägvalet (med spärrarna) går runt – i stället "Fågelvägen korsar ett förbjudet område – vägvalet går runt (+182 m)" i Vald sträcka. Inget vägval = fel; inte räknat = notis. Bara de sträckorna räknas, i vägvalens Worker med gemensam tabell (banans längd, vald sträcka), viker för dem; i telefonen bara med fliken öppen.
- Samma sträcka på flera banor/varianter = en rad ("A, B, C: …"). Godta, "Godta alla n" per sort, "Godtagna (n)" med Ångra; sparas i `event.acceptedChecks` (`SET_ACCEPTED_CHECKS`, ångra och versioner), gäller tills något byts ut eller flyttas mer än 25 m. Följer med vid ny .ppen. Fel som stoppar tidtagningen går inte att godta.
- Visa: "Kollade kontroller", "Notiser" och "Markera varningar" (per webbläsare, på som förval, också i fältläget). Fältraden i telefonen: vald kontroll och "Kollad av …" kortas, statusen går ned under raden på 390 px. Hjälpen (Varningar, Alla kontroller) beskriver godta, spärrarna och Visa.
- Verifierat: lint, typecheck, enhetstester (paketet `check-accept`, webbens `course-setting-checks`, hjälpen), Playwright `banlaggning-varningar` lokalt med skärmbilder 1280/390 (också fältläget utan nät), hela sviten i CI.

### 2026-11-03 – Banfil utan .ppen blir banläggning, sparbesked, fest och rogaining (grenen ppen-fran-iof)
- IOF XML CourseData (3.0 och 2.0.3) utan .ppen blir banläggningsdokument (`readCourseLayout` i iof-xml, `courseDataDocument` i course-setting): kontroller med koder och lägen, start, mål, passager, kartbyte, poängbanor med poäng, banornas ordning, stigning, klasser som undertitel. Lägena är kartfilens mm rakt av (som .ppen; provat mot klubbens OCAD-kartor, 0,5–0,7 m). Varianter blir gafflingar eller slingor när varianterna blir exakt filens; ger gafflingarna fler varianter väljs de som saknas bort (ADR-0198, så en banfil ur O-Tid med bortvalda varianter blir samma bana); annars egna banor med en rad i beskedet. Filens längd blir fast längd bara när den skiljer mer än 50 m. Inga beskrivningar (förslaget körs inte).
- Använd igen med bara banfil öppnar banläggningen med banorna; Banor → Banfil erbjuder banorna i banläggningen när tävlingen har kartfil (en befintlig ersätts efter frågan och blir tidigare version).
- Sparande utanför editorn: `saveOnLatest` (senaste versionen, ett tyst nytt försök vid konflikt) och en rad "Ändringen sparades inte – försök igen" med Försök igen (`SaveFailed`). Används av Banfil-erbjudandet; startsidans .ppen-inläsning säger nu till vid konflikt. Utskriftssidan (pappersrum) orörd. En ersatt banläggning behåller utskriftsprofiler, mallar, papperets mallar (ADR-0197), ringklipp och träning.
- Banläggning syns för fest och rogaining (sidopanelen, Mina tävlingar, Banor); läget har tävlingstypen (`raceType`), rogaining ger nya poängbanor, festen saknar Överför till tävlingen och förklarar varför.
- Verifierat: enhetstester (course-setting med Purple Pens exporter marymoor/relay/mapexchange som tur och retur, iof-xml, webbens lib), integration steg-62, typecheck och lint. Playwright `banfil-banlaggning` (Använd igen, dra starten, omladdning, Banfil ersätter efter frågan; rogaining och fest), skärmbilder 1280/390.
- Hjälpen: artiklarna ”Purple Pen, OCAD och IOF XML”, ”Kom igång: från Purple Pen till tävling” och ”Sparande, versioner och ångra” säger hur banfilen blir banläggning, vad sparbeskedet betyder och vad som gäller för fest och rogaining.
- Kvar: banfilen flyttas inte till en nyare kartversion vid Använd igen (som förut); Purple Pens kartbyte vid en vanlig kontroll står inte i IOF XML.

### 2026-11-03 – Papperet, ägarens svar (grenen pappersrum-2, ADR-0197 punkt 11)
- Varje element på papperet har "Sidor": "Första sidan" (förval) eller "Alla sidor"; en bana på flera sidor får elementen med "Alla sidor" på varje sida. Beskrivningen bara på första.
- Klippningen: banan (kontroller, start, mål, sträckor, nummer) står alltid hel; markeringar utanför syns inte (punktsymboler efter sin punkt, områden och linjer klippta vid kanten); "Visa markeringar utanför utsnittet" (förval av). Samma i förhandsvisningen och PDF:en.
- Hjälpen ("Papperet", "Mallar för papperet och klippning av kartan") säger båda.
- Verifierat: enhetstester (`paper-items`, print-pdf `paper-pdf`), hjälptestet, lint, Playwright `banlaggning-pappersrum` utökad (1280/390).

### 2026-11-03 – Flytta en delad kontroll långt (grenen flytta-kontroll)
- Som Purple Pen (QueryEvent.ShouldWarnAboutMovingControl, bara beteendet): när en vanlig kontroll dras mer än 50 m i terrängen i en bana och kontrollen finns i någon annan bana frågar editorn "Flytta i alla banor (n)" (banornas namn, förkortat), "Ny kontroll bara i [banan]" eller "Avbryt". Inte i Alla kontroller, inte när kontrollen bara finns i banan, inte för piltangenter/1 m-knapparna och inte för start, mål, passage och kartbyte (ingen kod; samma plats för alla banor, en egen start görs med Ny start). Gränsen räknas i hela meter (precis 50 m frågar inte) och väljs i Inställningar (10–100 m, i webbläsaren).
- Ny åtgärd `NEW_CONTROL_IN_COURSE` (paketet, kontraktet, samarbetets touches/refs/id-översättning, förslagens text): ny kontroll med nästa lediga kod (upptagen kod vid uppspelning: nästa lediga) ersätter kontrollen i de angivna banans kontrollerna; gaffling, slinga och poäng står kvar, numret får förvalt läge. Beskrivningen kopieras inte (ett nytt läge är ett nytt objekt; tom beskrivning syns i kontrollerna, som i Purple Pen). Ett steg för ångra, gör om och samarbetet.
- Bortvalda varianter (ADR-0198, känns igen på kontrollkoderna): "Ny kontroll bara i" byter koden i banans bortval till den nya, så att ett bortval inte tyst försvinner; "Flytta i alla banor" ändrar inga koder och rör inte bortvalen.
- Fjäril (samma kontroll flera gånger i följd eller slingans mitt) ritas som en ring: alla förekomster i banan byts och frågan säger det. I en gafflad banas variant där bara en förekomst syns byts bara den.
- Fältläget: "Flytta hit" ställer samma fråga (dialog som ryms i 390 px). "Kom ihåg för den här sessionen" (sessionStorage per tävling) hoppar över frågan med senaste valet; "Fråga igen" i Inställningar.
- Överförda tävlingar: oförändrat – banläggningen förs över för hand med banfilens granskning, där den nya koden syns som en ändring i banan.
- Verifierat: enhetstester (paketet `new-control-in-course`, webben `course-setting-move-shared`, `help-sv`), CI grönt med alla webbläsartester mot driftbygget, också nya `banlaggning-flytta-kontroll` (1280/390); `banlaggning-mobil` och `banlaggning-beskrivningsforslag` svarar nu på frågan där de flyttar långt. Hjälpen "Kontroller och banor" beskriver frågan.

### 2026-11-03 – Färre gafflingsvarianter (grenen gaffling-urval, ADR-0198, migration 0064)
- Banläggningen: panelen Varianter i fliken Banor (fågelväg, längs vägval på begäran i vägvalens Worker, kontroller, skillnad mot kortaste i m och %), kryssruta per variant och "Begränsa varianter" (längst i alla avseenden, högst X % längre, högst N) med förhandsgranskning; skyddet behåller en variant per kontroll och sträcka. "8 varianter, 4 används (4 bortvalda som längre)".
- Bortvalen sparas på banan (`UPDATE_COURSE.excludedVariants`: kod och kontrollkoder), så autosparande, ångra och versioner gäller; .ppen kan inte bära dem (Purple Pen har bara `relay-branch`), så de skrivs i `<otid:variants>` och följer med när en fil från Purple Pen läses in om varianterna finns kvar.
- Bortvalda räknas inte i sammanfattning, kontroll, IOF XML eller utskrift och förs inte över; tävlingen får bara de behållna (lottning, fördelning, stafett och exporter oförändrade). `forkingReadiness` räknar bara behållna; arbetsytan visar antalet bortvalda.
- Avläsningen: banversionen bär de bortvalda (`course_version.excluded_variants`); `excludedVariantsFitting` ger beskedet "passar BDF, som är bortvald" i avläsningen, kvittot, deltagarkortet och listan. Inget byts och ingen döms ut tyst.
- Utjämnad bana och utjämnad stafett: varnar (panelen vid stafettlag, tävlingens rättvisekontroller), stoppar inte.
- Verifierat: se slutrapporten för grenen.

### 2026-11-03 – Hjälp för banläggning, vägval och klubbarkiv (grenen hjalp-banlaggning, bygger på steg 37)
- Hjälp i banläggningens rad överst (bara "?" under 900 px), på sidan före editorn, utskriftssidan, kontrollbeskrivningarna, klubbarkivet (flikarna och en träning) och i kontrollkartan. Panelen visar först den öppna flikens artiklar (fältläget först på telefonen), sedan banläggningen i stort; i kontrollkartans läge Vägval vägvalens.
- 39 nya artiklar i `help-course-setting-sv.ts`, `help-print-sv.ts` och `help-archive-route-sv.ts` (Kom igång ×2 som numrerade steg, kartfil och .ppen, verktygen, gaffling, objekt, egenskaper, beskrivning och förslag, varningar, notiser, fältläget, utan nät, kollat, utskrift, beskrivningen på kartan, papperet och dess mallar/klippning (efter pappersrum), BL, PDF, samarbete, versioner, förslag, utseende, överföring, vägval ×6, kontrollkartan, arkivet ×6); Träning utökad.
- Artiklarna länkar till varandra (`[text](#id)`); sökningen har synonymer (kartdef, ppen, gafflingar, hänga/utsättning, tryck/utskrift/pdf, offline) och ställer rubrikträffar först; "tryck på" räknas inte som tryck.
- Små "?" (`HelpLink`) vid kalibreringen av farterna, BL-förslaget, gafflingen (Gaffla här och Vald), beskrivningens plats på arket, papperet, importen till arkivet och vägvalen för vald sträcka.
- "Se filmen (1 min)" i hjälpens fot och på /om när `NEXT_PUBLIC_INTRO_FILM_URL` är satt (layouten lägger adressen på body vid förfrågan).
- Tester: `help-sv` (varje citat finns som UI-text, länkarna går till artiklar, varje flik i editorn och arkivet har artiklar, Kom igång 5–8 steg), `help-search` (synonymer, vyernas ordning, efterfrågad artikel först), Playwright `hjalp-banlaggning` (1280/390).
- Återstår när grenarna ppen-fran-iof, gaffling-urval, varningar och flytta-kontroll slås ihop: lägg till stycken i artiklarna `purple-pen`, `gaffling`, `varningar` och `kontroller-banor`.

### 2026-11-03 – Papperet ("paper space"), steg 2 (grenen pappersrum, ADR-0197, migration 0063)
- Förhandsvisningen har "Papperet: texter, bilder och klippning" per bana: text med variabler ({bana} {klass} {längd} {stigning} {tävling} {datum} {skala} {ekvidistans} {variant}), storlek, fet, justering, vit bakgrund; bild (PNG/JPG/SVG→PNG, högst 2 MB, en gång per sha256 i `course_setting_paper_image`) med låsta proportioner och täckning; skalstock ur banans utskriftsskala; nordpil. Allt förankrat i ramens eller arkets hörn (`paper-items.ts`, `event.paperLayouts`).
- På arket: markera, dra, handtag för storleken, pilar 1 mm (Skift 5 mm), Delete, Escape/klick på tomt papper, Ångra och Ctrl+Z. 390 px: fälten i ett ark nere på skärmen. Ändringarna visas direkt och sparas en i taget.
- Klippning (rektangel eller polygon, utanför vitt eller tonat) läggs på kartans pass (träningens ritning), så förhandsvisningen och PDF:en ritar den; banan klipps inte. Editorn visar inget av papperet.
- Mallar för papperet (`event.paperTemplates`, `PUT/DELETE_PAPER_TEMPLATE`): banor ärver, ändringar per bana (`OVERRIDE`), dolda mallelement, på alla valda banor; kontots bibliotek (`course_setting_paper_template`) för andra tävlingar.
- PDF:en ritar elementen som vektorer (bilderna med ExtGState för täckningen). .ppen: texter → textobjekt med Purple Pens makron, bilder → bildobjekt, beskrivningen även på automatisk plats; vid inläsning följer papperet med och O-Tid:s egna objekt (och en beskrivning exakt på automatisk plats) tas bort.
- Verifierat: lint, typecheck, enhetstester (course-setting `paper-items`, print-pdf `paper-pdf`), integration `adr-0197-pappersrum`, Playwright `banlaggning-pappersrum` (1280/390) och de befintliga utskriftsspecarna.
- Kvar: klubbarnas mallar (klubbarkivet har ingen plats för delade inställningar), SVG som vektor i PDF:en, bilderna i säkerhetskopian, dra på telefonen (siffrorna räcker).

### 2026-11-03 – Hittbarhet efter ägarens användning (grenen hittbarhet)
- Banläggning i arbetsytans sidopanel/remsa och Meny, som knapp i Mina tävlingar (ägare, administratör, banläggare) och sessionen säger banläggningens nivå; den som bara har banläggningen skickas dit. Editorns tillbaka: "← Tävlingen"/"← Mina tävlingar", Fil har Utskrift och Kontrollbeskrivningar.
- Kontrollbeskrivningen på kartan hör till papperet (`paper-layout.ts`, `event.paperLayouts`, `SET_PAPER_LAYOUT`): på för varje bana, automatiskt i ett fritt hörn med varning när den täcker banan, dras/ändras på arket i förhandsvisningen (piltangenter också). Ritas inte i editorn; Purple Pens `descriptions` tolkas som platsen och skrivs tillbaka vid export. Mallens gamla plats gäller bara utan utplacering.
- BL-förslaget: status som märke, valt som nedtryckt knapp ("✓ Godtagen"), Ångra, besked vid raden; panelen monteras inte om när kopian skapas (beskedet försvann).
- Kepsens förklaring står under hela banan; poängbanans fasta längd visar inte "0,0 km".
- Klubbarkivet: Ny klubb med fältfel (tomt, för långt, finns redan `NAME_TAKEN`); importen hämtar klubben ur nyckeln (`GET /api/club-import/token`), `--club` valfritt och kontrollerat, svenska fel för 401/404, dold nyckel vid frågan; träningssidan säger att arkivet bara visar och har Använd igen under kartan.
- Rättat: starten gick inte att ta i en kopia ur arkivet – kartan passades in under verktygsraden (nu bredvid den, `fitBounds` med `insets`) och bara triangelns kontur träffade (nu inuti också). BL-godkännandet sparades på en gammal version och avvisades tyst (utskriftssidan sparar nu en sak i taget på senaste versionen).
- Verifierat: lint, typecheck, enhetstester (paketen, webben), integration klubbarkiv, Playwright `hittbarhet` och `klubbarkiv` (1280/390).

### 2026-11-03 – Klubbarkivets kartor syns (grenen kartarkiv-kartor, ADR-0196, migration 0062)
- Kartfilen: OCAD 8, 9, 10 och 11 läses och ritas (`OcdVariant`); OCAD 6–7 säger "OCAD 7 stöds inte. Öppna kartan och spara den i nyare OCAD eller i Mapper." Windows-1252 i äldre filer.
- IOF XML 2.0.3 CourseData läses till samma modell som 3.0 (längd ur lägena när CourseLength saknas). Banfilens sammanfattning räknas ur filen när den sparade är tom.
- Kartor-fliken: bild av senaste versionen, "Fungerar · OCAD 11.2" eller skälet per version, "Kontrollera alla kartor igen". Träningarna har en bild med längsta banan. Ritas i en administratörs webbläsare och sparas (högst sex kartversioner per besök automatiskt).
- "Ändra rättigheter" i kartans kort och på träningens sida. Träningens sida säger varför kartan inte kunde ritas.
- Verifierat: map-file mot klubbens prov (OCAD 8 ×2, 9 ×2, 10 ×2, 11 ×3 ritade och granskade som PNG), iof-xml mot två 2.0.3-filer, integrationstest adr-0196, Playwright `klubbarkiv-kartor` (1280/390).

### 2026-11-03 – Färdiga avbildningar, servern bygger inte (grenen snabbare-bygge, ADR-0195)
- Arbetsflödet `Avbildningar`: efter grön CI för en push till main byggs `ghcr.io/joelberring/otid-web` och `otid-backup` (amd64, taggar sha, kort sha, main; GHA-cache). Andra grenar bygger utan att lägga upp.
- `docker-compose.prod.yml`: `${OTID_IMAGE:-ghcr.io/joelberring/otid-web}:${OTID_TAG:-main}` (backupen likadant); `build:` kvar som reserv med lokala namn. CI-jobbet production bygger från commiten med lokala namn.
- Docker-bygget hoppar över typkontrollen (`OTID_SKIP_BUILD_CHECKS=1` → `typescript.ignoreBuildErrors`), Nodes heap 1,5 GB, BuildKit-cache för pnpm-lagret och `.next/cache`. Lokalt `pnpm build` och CI verify kontrollerar typerna som förut.
- Uppmätt (`next build`, 2 vCPU, processträdets RSS): förut 153–162 s, topp 2,7 GB och 2,2–2,3 GB i en minut under typkontrollen; nu 90 s med samma korta topp i slutet av kompileringen; med varm cache 11–14 s och 1,2 GB.
- docs/drift.md: Uppdatera (pull i stället för build, låsa `OTID_TAG` inför tävlingen, tillbakagång), reserven med 3 GB swap. Ägaren gör paketen publika efter första publiceringen.
- Ej provat här: Docker-bygget lokalt (Docker Hub nås inte från den här miljön); bygget provas av CI-jobben production och Avbildningar på grenen. Publiceringen körs först när arbetsflödet finns på main.

### 2026-11-02 – Träningsläge i banläggningen (grenen traningslage, ADR-0192)
- Modell `document.training`: avsnitt per bana (från–till) med korridor (kantig/mjuk, bredd per sträcka), bälte med filter (bara kurvbild m.m.), fönster och utan karta; utanför hela/vitt/tonat/filter; ritade områden; sista säkra per sträcka; stjärna, linje, keps (1a/1b, gemensam karta som förval, A/B som val) och kartbitar. `PUT_TRAINING` med touches, ångra och id-översättning; .ppen i `<otid:training>` (egen namnrymd, Purple Pen hoppar över).
- Symbolfilter efter ISOM 2017-2/ISSprOM 2019-2 (okända nummer efter namnet), förval och val per symbol. Kartan ritas i pass med klippning och dolda symboler (`drawTrainingMap`) i editorns Worker, förhandsvisningen och PDF:en; tonat = lägre andel av samma dekorfärg.
- Editorn: fliken och knappen "Träning" med formerna som kort, avsnitten i följd med markering vid bytet (text med pil eller tvärstreck), "Visa träningen" för före/efter. Utskrift: stjärnans uddar, kepsens A/B, kontrollantens karta och kartbitar (`PIECES`).
- Verifierat: lint, typecheck, test (paketen och webbens lib, ny `training*`), PDF med dekorfärger och klippning (fixturen och Högdalen via `OTID_REAL_MAP`: 126 symboler, 1 i Övrigt), Playwright `banlaggning-traning` (1280/390).
- Spegelvänd karta (kortet Spegel, ADR-0192 beslut 12) i förhandsvisningen och PDF:en; formernas svenska taggar `TRAINING_TAGS` (beslut 13) för klubbarkivet.
- Rättat: ändringar som gick genom utkastet (ny bana, flytta kontroll …) tappade `document.training`; knappen Träning fäller upp panelen på telefonen.
- Ej gjort: roterad karta (PDF:ens transform saknar rotation), kepsens etiketter i beskrivningen.

### 2026-11-03 – Loggan och "Banläggning och tidtagning för orientering" (grenen logga)
- Ägarens logga (variant B): lila ring med "tid" i Poppins Bold som kontur (`scripts/logo/generate.py`, `components/brand/`), före "O-Tid" i det gemensamma sidhuvudet (28 px; tagline dold under 420 px) och på startsidan (40 px). Färgen `--logo` (#a626ff); appen är bara ljus, så #c77dff används bara i `icon.svg` i mörkt läge.
- Favicon 16/32 och `icon.svg`: ring med punkt. `apple-icon.png` (180, vitt), `manifest.ts` med 192/512 och maskerbar 512 i `public/icons/`.
- Startsidan: länken "Se vad O-Tid kan (film, 1 min)" bara med `NEXT_PUBLIC_INTRO_FILM_URL` (läses vid förfrågan, docs/drift.md).
- Verifierat: enhetstest för adressen, publikt och hjalp i Playwright, skärmbilder 1280/390 ljust och mörkt.

### 2026-11-02 – Banläggningens luckor mot Purple Pen (grenen banlaggning-egenskaper, ADR-0190)
- Banans egenskaper i fliken Banor: vanlig/poängbana (inte med gafflingar), stigning, fast längd (tom = uträknad), poäng per kontroll i poängbanans lista med summa, ordningen med upp/ned och dra. `UPDATE_COURSE` tar `kind` och `null`, ny `SET_POINTS`; `PUT_OBJECTS.courseOrder` gör att ångra av en flytt bara rör ordningen (och ångra av ett namnbyte inte flyttar tillbaka andras flytt).
- Utskriftens rubrik visar stigningen; beskrivningen och `$(CourseLength)`/`$(CourseClimb)` hade redan längd och stigning. Banfilsjämförelsen: egen rad för ändrad längd eller stigning (`SET_COURSE_MEASURES`, räknar inte om), ny ordning ger inga rader.
- Ångra efter omladdning: historiken (högst 200 steg) i IndexedDB bredvid offline-posten, per konto; steg som någon annan ändrat sedan dess läggs inte tillbaka; bort vid utloggning, 403 och byte av dokument.
- "Ladda ned IOF XML (banor)" under Fil: som Purple Pens ExportXmlVersion3 (varianter med CourseFamily, klasser, Position med georeferens); Purple Pens tre förväntade exporter blir likadana utom stafettlagens `TeamCourseAssignment` (inte portad). OCAD förklaras i hjälpen (läser IOF XML), inget eget format.
- Längd längs vägval bredvid fågelvägen (Workern räknar banans sträckor på begäran).
- Rogaining och poängbanor: mål är mål, stämplingar efter målstämplingen ger aldrig poäng (`ignoredAfterFinish`, kvittot, resultatmotorn 0.7.0). Ingen migration.
- Verifierat: lint, typecheck, enhetstester; Playwright `banlaggning-egenskaper` (stigning, fast längd, ordning med ångra, ångra efter omladdning, poängbana med poäng, gafflad bana nekas, IOF XML, längd längs vägval, överföringens rad Stigning, 390 px utan sidledsscroll) lokalt på main 9443fda; efter ombaseringen på a8eae07 CI grönt (lint, typecheck, enhets- och integrationstester, webbläsartesterna mot driftbygget); skärmbilder 1280 och 390 px granskade.
- Ej gjort: stafettlagens varianter i IOF-exporten; IOF:s XSD finns inte i repot (exporten av Purple Pens 151 testfiler validerad mot IOF.xsd med xmllint utanför repot); OCAD-importen inte provad i en riktig OCAD; en borttagen stigning nollställs inte i tävlingen.

### 2026-11-02 – Rätta, klubblistor och städning (grenen ratta-listor, ADR-0191, migration 0047)
- Rätta: deltagarkortets panel "Rätta" har allt som ändrar en löpares resultat (status, manuell tid, godkända kontroller, omläsning, byt bricka, byt klass, variant; de fyra tidsrättningarna av en stämplad mål-/starttid under Mer, nu för kortets löpare). Avläsning och Resultat har "Rätta en löpare", alla Öppna visar Rätta; Avläsningens verktyg för hela tävlingen under "Mer: verktyg för hela tävlingen". Inventeringen står i ADR-0191.
- Listorna: klubbfilter i start- och resultatlistor (arbetsytan och publikt, `?klubb=` i adressen, klubben i utskriftens rubrik) och vyn "Klubbar" (startande, fullföljda, ettor–treor, totalt, CSV). Samma publika data, så bricka, varianter före start och noindex som förut.
- Import av anmälda under Anmälda (alltid synlig länk); Inställningar hänvisar dit; importsidan går tillbaka till Anmälda.
- Död kod: `importIofXml`, `changeEntryClass`, `recalculateEntry` bort, testerna via produktionsvägen (`production-paths.ts`); också `resultHistory`, `isForkedCourseVersion`, `changeEntryClassSchema`, `publicPoolOfDatabase`, `Toolbar` (`Select` kvar, klubbarkivet använder den). Kvar (bara testernas läshjälp): sex `list…/get…AsAdmin`-funktioner, se ADR-0191 beslut 4.
- FORKED steg två: migration 0047 skriver om `race.race_type` till STANDARD, återställning ger STANDARD. 0047 står sist i journalen (efter 0059–0061 från main), så nya och befintliga databaser kör den i samma ordning. Steg tre (senare driftsättning): ta bort FORKED ur `race_type_check` och kontraktet.
- Verifierat: se slutrapporten för grenen (typecheck, lint, enhetstester, berörda integrationstester, Playwright `ratta-listor` m.fl.).

### 2026-11-02 – Klubbarkivet (grenen klubbarkiv, ADR-0194, migration 0059–0061)
- Klubb med ägare/administratör/läsare och inbjudan per adress (samma svar med och utan konto); `training_group.club_id` för klubbens grupper senare.
- Kartorna är logiska med versioner i `map_content` (ADR-0189, en gång per sha256, upp till 100 MB, arkivet räknas i borttagningen); rättigheterna hör till kartan. Slå ihop, flytta version, ny version (strömmad). Gruppens kartbibliotek kan peka på klubbens karta och visar när en nyare version finns.
- Arkivet: sök och filter (år, karta, tagg, ledare, läge), träningen med banan ritad på kartversionen den gjordes med, originalen, "Använd igen" (Ny träning eller gruppens tillfälle, kartan pekar på arkivets innehåll, .ppen som i banläggningen, CourseData som banfil); senaste versionen förvald och "Flytta banorna" jämför georeferensen (samma, via koordinaterna eller förskjutning för hand).
- Importen på ägarens dator: `pnpm archive-import <mapp> --dry-run` och med `--server --club` och importnyckeln; zip läses som ström (ZIP64), bara kartor/.ppen/CourseData, dubbletter en gång, .ppen:s karta löses i mappen, på namnet i arkivet eller "karta saknas"; idempotent.
- Verifierat lokalt: paketets enhetstester (mappnamn, taggar, skip, kartgrupper, .ppen-referenser, zip, provkörning), kontraktet, webbens lib, integration `adr-0194-klubbarkiv` (+ steg-68, adr-0188/0189, aterstallning), Playwright `klubbarkiv` (provkörning, import två gånger, filter, karta, inbjudan, Använd igen) med skärmbilder 1280/390.
- Kvar: kartor över 60 MB kan inte bli tävlingens kartfil; CourseData flyttas inte till en ny kartversion; grenen bygger på lagring-integritet (ADR-0189).

### 2026-11-02 – Lagring och integritet efter granskningen (grenen lagring-integritet, ADR-0189, migration 0044–0046)
- Kartbilder och kartfiler lagras en gång (`map_content`/`map_content_part`, sha256, delar om 1 MiB); tävlingar, kopior, träningstillfällen, biblioteket och återställningar pekar på samma innehåll, som en utlösare tar bort med sista referensen (också purge). Kvot per konto (2048 MB) och server (20480 MB) via env med besked i MB. Säkerhetskopian oförändrad; `otid_print` läser innehållet (migrationen och db-roles.sh).
- Steg två (gamla rader och dubbletter): `node superadmin.mjs map-content move` när den nya versionen fungerar; kolumnerna image/file tas bort senare.
- Uppladdningen strömmas till databasen (Next 16.4 buffrar inte `/api/`): 60 MB fil + 30 MB bild ökade processens minne ~35 MB (mätt), förut hela bodyn och kopior.
- "Anonymisera" på deltagarkortet: namn, klubb, Eventor-id och externa id bort ur anmälan, journalerna, publicerade listor, fastställandet och inlästa IOF-filer; resultat och sträcktider kvar som "Anonym deltagare". Brickans nummer stannar i avläsningarna (oföränderliga). Valfri gallring `OTID_RETENTION=anonymize|delete` (förval av, 24 månader) i webbens underhåll en gång i timmen.
- Säkerhet: inloggningsspärren per adress och IP; nya gruppkoder med slumpad del och 30 missar/timme per IP; gruppens ledare och medlemmar sparas för adressen (samma svar med och utan konto).
- Verifierat lokalt: typecheck, enhetstester, nya integrationstester (adr-0189-kartinnehall, -anonymisering, -sakerhet) och de berörda (steg-59, -65, -68, -21, -27, -28, -46, aterstallning, adr-0186/0188); db-roles setup/check/rollback mot en egen databas med egna rollnamn.
- Kvar: registreringen utan SMTP säger att adressen finns (ADR-0186 täcker bara läget med e-post); befintliga gruppkoder behåller sin korta kod; nedladdningen av kartfilen läses i minnet (60 MB) som förut.

### 2026-11-02 – Användarflöden efter granskningen (grenen ux-flode, ADR-0188, migration 0043)
- Lottning: "Gemensamt för klasserna" (startsätt, intervall, klassernas första start, vakanser) med Använd för alla/valda, kryssruta för alla, nya lottbara klasser ikryssade; förhandsvisningen en rad per klass med löparna bakom ett klick (10 klasser/300 löpare: 887 px i stället för ~25 000). Första start sätts i Lottning och sparas med lottningen; Inställningar visar den och länkar dit (typer utan lottning skriver den där som förut).
- Datumet kan ändras efter lottningen: förhandsvisning, bekräftelse och flytt av fasta starttider, lottningar (ny lottningspost) och stafettstarter med samma klockslag i samma transaktion, journal per löpare; avläsning, radiostämpling, incheckning eller resultat stoppar.
- 390 px: Banor och Klasser som kort; Playwright kontrollerar att ingen del av arbetsytan går utanför skärmen.
- Klasser från banfil/Eventor får lottad start i Tävling (fri i Träning, Liten tävling, Rogaining, Fest); gafflad klass med löpare utan variant är "Inte klar".
- Texter: Kartor till starten länkar till utskriften per löpare, inga interna ord, bricka i stället för pinne, rätt hänvisningar, datum ÅÅÅÅ-MM-DD i alla formulär (Ny träning, kartans avtal, festen, omläsningen).
- Banläggningen: hela fliknamn på datorn, telefonens fyra flikar och resten under Mer; Kollad/Notis här bara i fältläget (Kollad i fliken Kollat annars); Sparat och Ångra en gång i mobilen.
- "Tävling med gafflade banor" ingår i Tävling (FORKED alias för STANDARD; steg två: skriv om raderna och ta bort värdet). Personer med behörighet svarar likadant med och utan konto; behörigheten sparas för adressen (`race_person_invitation`) och tas vid inloggning, bekräftelse, Mina tävlingar eller första besöket på tävlingen.
- Verifierat: lint, typecheck, test, test:integration (ny adr-0188-anvandarfloden), Playwright ux-flode (ny), lottning, lottning-avancerad, tavlingsinfo m.fl. lokalt; skärmbilder före/efter i 1280/390 px.
- Ej gjort: rättelseverktygen (senare punkt); träningsgruppens medlemmar avslöjar fortfarande om en adress har konto (samma lösning kan användas där).

### 2026-11-02 – Arrangörens säkerhetskopia och återställning (grenen aterstallning, ADR-0187, migration 0041–0042)
- "Exportera tävlingen" (JSON v1, gick inte att läsa in och saknade bl.a. avprickningen, kortbaneöverflyttningen, begärandenas journaler och festen) är ersatt av "Ladda ner säkerhetskopia": zip med `manifest.json` (formatVersion 2, sha256 per fil), en JSON per tabell och binärdata (kartfil, bild, foton, GPX) som egna filer. Alla tävlingens tabeller utom fyra uttryckligen uteslutna (integrationstestet jämför med katalogen).
- Aldrig med: konton, lösenord, sessioner, Eventor-nyckeln; kontonas id är slumpade referenser, behörigheter följer med som e-post (`personer.json`). Inställningar säger när kopian tas, att den har personuppgifter och när den senast laddades ner (`race.last_backup_at`, journalen utan namn).
- "Återställ tävling från säkerhetskopia" (Mina tävlingar, inloggat konto): strikt kontroll (zip-gränser, zod per rad efter katalogen, sha256, okänd formatversion/kolumn med begripligt besked), förhandsvisning, sedan en NY tävling med nya id (också inuti JSON/XML), opublicerad, radio av; personerna kopplas på e-post eller lämnas bort. Idempotent (`race_restore_request`).
- Verifierat: lint, typecheck, test (zip-läsaren), test:integration (ny `aterstallning`: samma publika lista, sträcktider, IOF-lista, fastställande och teamsprint efter återställning; felaktiga filer; de nio testerna som läste JSON-exporten läser nu zip), Playwright `aterstallning` (nedladdning, fel fil, förhandsvisning, återställning, samma publika lista och sträcktider; skärmbilder 1280/390 granskade).
- Uppföljning: inaktuella resultat förblir inaktuella (manifestets `staleResultRevisions`, utlösaren i migration 0042 behåller en avvikande hash bara med `otid.restore`). Avläsningsdatorns kö skickas aldrig till den återställda tävlingen; avläsningssidan visar väntande avläsningar för en annan tävling och kan ladda ner dem. Provat: samma sats till den återställda avvisas på samma server och blir en dubblett med samma resultat på en ny.
- Kvar: stora kopior nära 200 MB är inte provade mot webbens minnestak.

### 2026-11-02 – Säkerhet, integritet och drift efter översynen (grenen sakerhet-drift, ADR-0186, migration 0040)
- Beroenden: next 16.4.3, sharp 0.35.5, fast-xml-parser 5.11.2, nodemailer 10.3.1, drizzle-orm 0.45.4, zod 4.6.7; `images.unoptimized`; Mapper avvisar DOCTYPE. Kvar i `pnpm audit --prod`: playwright 1.55.0 (bara test).
- Inget publikt om löpare indexeras (robots.txt, X-Robots-Tag, meta); HSTS. Varianten (startlista, IOF XML, stafett) och kartbilden publikt först efter start, val under Publicera → Före start; bricknummer av för nya tävlingar.
- Behörigheter från andra kräver bekräftad e-post; registrering och glömt lösenord svarar likadant och arbetar efter svaret; `superadmin.mjs verify`.
- Drift: roller otid_owner/otid_app/otid_print (`deploy/db-roles.sh`, provad mot kopia med data, i CI före alla specar), hemligheter bara i web, egen `migrate` med dump före, backup dygnet runt + valfri restic, `monitor` med bevakningspingar, disk > 80 %, utskriftsjobb i barnprocess med tidsgräns, KONFIGURATIONSFEL i loggen, fasta bildversioner, CI `contents: read`.
- Verifierat: lint, typecheck, test, test:integration (ny adr-0186-sakerhet.test); rollerna, migrering 0038–0040 som ägare, dump/återställning och tillbakagång mot kopia med data; Playwright sakerhetshuvuden, banhemlighet, konton, listor, tavlingsinfo lokalt; CI grönt med alla specar efter rollövergången.
- Ägaren: SMTP behövs för att nya personer ska få behörigheter utan `verify`; följ docs/drift.md (Databasroller, Kopia utanför servern, Bevakning).

### 2026-11-02 – Tävlingsdagen robust efter översynen (grenen tavlingsdag-robust, ADR-0185, migration 0038–0039)
- 500 loggas utan personuppgifter; databas nere ger 503; transaktioner görs om vid 40001/40P01. Avläsningen skickar om 502–504 med växande väntan, håller bara vid upprepat 400/404/409/500, statusraden säger "Servern svarar inte".
- Brickregler i `card-assignment.ts`: inaktiv historik hindrar inte, 409 säger vem som har brickan, "Byt bricka med …", okänd avläsning kopplas och räknas i alla vägar.
- Direkt CourseData efter avläsning går banfilens väg (eller avvisas med hänvisning); EntryList visar vem och vad som skiljer, brickbyten bekräftas.
- IOF: rad och element i felen, Person.Id utan EntryId, ISO-8859-1. Migrationsregeln i AGENTS.md: två steg, CONCURRENTLY, inte på tävlingsdagen.
- Verifierat: lint, typecheck, test, test:integration (nya: tavlingsdag-brickor, tavlingsdag-import), Playwright avlasning-ko, brickbyte, lanad-bricka, sjalvregistrering-tavling.
- Återstår: eget källslag med ögonblicksbild för anmälningsfiler i synken; ett resultat som bygger på den andras bricka står kvar tills löparen läses ut.

### 2026-11-02 – Banläggningens sparande, utan nät och samarbete (grenen banlaggning-sparande, ADR-0181 beslut 9)
- Sparandet i omgångar (500 åtgärder/1 MB); 413 halverar, 400 läser om och försöker igen, bara en ensam för stor eller oläslig åtgärd stryks med besked. Routen ger 413.
- Servern lagrar touches ur skillnaden (`diffTouches`), så strukturändringar krockar; ångra per fält (`eventFields`). Integrationstest med två samtidiga.
- Kön skickas efter ändringarna med id översatta; servern avvisar notiser/bockar på kontroller som inte finns (409). Posten i två delar, lagringsfel i statusraden, kopian bort vid utloggning och 403.
- Fel visas i stället för att sväljas (vägvalens spärrar, banpåtrycket, ringklipp, förslag, beskrivningar och varianter i utskriften); ringklippen följer med ny .ppen; describeEdit komplett; fältets variantväljare.
- Kopia av tävling: banläggningens behörigheter och notiser bara med `includePeople`, aldrig i träningsgruppens tillfällen.
- Vägvalets Worker startas när en sträcka väljs (Högdalen: kartans Worker 20 MB, vägvalets 48 MB, mätt i Node). `circleArcs` och arkvalet (`printSheetGroups`) i paketet.
- Verifierat: lint, typecheck, test, test:integration och alla 77 Playwright-specar (ny: banlaggning-sparande) gröna i CI; lokalt lib-, paket- och integrationstesterna för grenen, specen mot dev-servern. steg-65:s rensningstest räknar från nu (dess fasta tidpunkt hade passerats). Återstår: minnet på en riktig telefon.

### 2026-11-02 – Banläggningens editor mer som Purple Pen (grenen banlaggning-ux, ADR-0180 beslut 14)
- Objekt i verktygsraden (och bakom "Mer") öppnar en palett i fyra grupper med ikoner ritade av kartans ritare; obligatorisk passage ("Obl. passage", tooltip) skiljs från valfri; kartbyte och bild (uppladdning) läggs därifrån.
- Vridhandtag för obligatorisk och valfri passage (5°-steg, Skift/andra fingret fritt), "Vrid efter sträckan", en ny passage i en bana vrids efter sträckan; ny ändring `SET_CONTROL_ORIENTATION`.
- Duplicera bana (`DUPLICATE_COURSE`, med gafflingar, nummer, tryckyta och specialobjekt); båda nya ändringarna i samarbetet, kontraktet och förslagens text.
- Kontroller utanför banan syns svagt med kod och fångas med ett klick i ringen ("Lägg in 45"; Alt/"Alltid ny" ger ny); "Visa andra banor svagt".
- Kontrollistan i Banor visar gafflingen som träd (grenar bredvid varandra, klick = arbeta i grenen), "Gaffla här" (2/3/4 grenar, slinga), Nästa gren, bokstäver på kartan, varianter med antal och bild.
- Ta bort bana frågar om kontrollerna som blir oanvända (ett ångra-steg); oanvända i Alla kontroller ritas grå streckade, filter, antal och "Ta bort alla oanvända".
- Verifierat: lint, typecheck, test (paketet: kopia, vinkel, uppspelning och rundresa till .ppen; webben: fångst, vridning, grenar, alla 16 specialobjekt); Playwright banlaggning-objekt-gaffling (ny, skärmbilder 1280/390 granskade), banlaggning, -utskrift, -mobil, -samarbete, -falt, -utseende och kontrollbeskrivning gröna lokalt; CI grönt.

### 2026-11-02 – BL-profiler och förslaget att godkänna (grenen bl-profil, ADR-0183 beslut 7)
- "BL skog" och "BL sprint" (tabellerna kontrollerade mot BL:s sidor 2026-11-02, källa och datum i profilen, tomma celler tolkade och märkta); ny tabell = ny profilversion, de gamla låsta och markerade som ersatta.
- Förslaget per kartfärg (namn, OCAD-id, CMYK, användning via `colorUsage`, ordning): säker, bekräfta, tvetydig. Godkännandet i förhandsvisningen: färgrutor före/efter, kartbit per färg, hela kartan före/efter med reglage, lagren som bild; beslut sparas i tävlingens kopia, kartfilen orörd.
- PDF med BL: CMYK (banan 35/95/0/0 som processfärg), banan i kartans färgordning under brunt, svart och 100 % blå (valbart); förhandskontrollen visar obekräftade färger och stoppar passmärket.
- Högdalen (BL skog): 20 säkra, 12 att bekräfta, 2 tvetydiga, 8 oanvända; banan hamnar under brun höjdkurva, grön punktsymbol över banan blir varning.
- Verifierat: lint, typecheck, test (Högdalen via `OTID_REAL_MAP`), test:integration, Ghostscript-rendering av ordningen (Högdalen/SBN26_2 före och efter: samma linjebredd, banan under brunt och svart); CI grönt med Playwright utskrift-bl mot driftbygget. Högdalen-varianten (`OTID_E2E_SBN_DIR`) grön lokalt med delbilder i 1280/390 px (jämförelsen, lagren, säker, bekräfta, tvetydig med "Välj BL-rad" utfälld), inget utanför skärmen.
- Återstår: provtryck hos BL; webbläsarens utkast lägger inte banan i färgordningen.

### 2026-11-02 – Förslag på kontrollbeskrivning ur kartfilen (grenen beskrivningsforslag, ADR-0180 beslut 13)
- Paketet: tabell ISOM 2017-2/ISSprOM 2019-2 → IOF 2018 D (namnet som reserv), regler för G (sida, fot/uppe på, kant, hörn in/ut, ände, del, mellan; väderstreck från nordlinjerna), C (flera likadana), E (raserad, djup, sank, stenig), F bara korsning/förgrening; säkerhet, förklaring, högst tre förslag.
- Webben: kartans Worker räknar; beskrivningspanelen visar förslaget som symboler med Godta, Godta alla tomma och alternativen, markerar objektet på kartan; kontroller utan D förhandsvisas ljusare ("förslag"); fältläget har raden "Förslag: … Godta". Allt via SET_DESCRIPTION.
- Ägarens filer: SBN26_2.ppen har inga D-rutor, så träffsäkerheten mot ägarens beskrivningar går inte att mäta. Mot min avläsning av kartan: Högdalen D rätt i 24 av 24 entydiga kontroller (8 av 32 oklara), Djurgården 16 av 16 (7 oklara). G kunde inte prövas mot facit.
- Verifierat: lint, typecheck, test (paketet 26 regeltester, webbens lib), ägartestet med `OTID_REAL_MAP`/`OTID_REAL_MAP_PPEN`/`OTID_REAL_MAP_FACIT`, Playwright banlaggning-beskrivningsforslag, banlaggning, banlaggning-mobil lokalt; CI grönt. Idé: ägaren skickar en .ppen med egna beskrivningar, så kan D och G mätas på riktigt.

### 2026-11-02 – Notiser: rita, kartfel och ta bort (grenen notiser, ADR-0181 beslut 8, migration 0037)
- Notiser tas bort (den som skrev eller den med ändra; svar och foto med; genom telefonens kö; andra editorer ser det). Ritning i notisen (`SKETCH`, ≤ 20 delar/1 000 punkter): dra eller klicka, ett finger ritar och två flyttar kartan, färg per slag, "är fel"/"ska vara här"; ritningen är markeringen och väljs på kartan, aldrig i utdata.
- Slaget kartfel (bara punkt eller ritning), filter öppna/klara/alla och slag i listan och på kartan; "Rita kartfel" under Mer i fältläget.
- `/course-setting/map-errors`: utskrift/PDF och GeoJSON (georefererad med `crs`, annars kartans mm) utan banor, koder, bannamn eller vem; slumpvis förskjutet utsnitt, varning nära kontroll (inte med som förval), foto av som förval.
- Rollen Kartritare (`COURSE_MAP`/nivå MAP): bara kartfilen och kartfelen (utan bana och foto) på `/map-errors`, svarar och markerar klart; aldrig dokumentet (integrationstest).
- Återstår: GeoJSON i OCAD inte provad med riktig fil; ägaren provar ritläget i terrängen.

### 2026-11-02 – Banans utseende och etiketten vid kontrollen (grenen utseende, ADR-0180 beslut 12)
- `SET_APPEARANCE` skriver om `<course-appearance>` som Purple Pen bara när något ändrats; mm på papperet per skala och varningar mot ISOM 2017-2/ISSprOM 2019-2; konfliktnycklar per fält.
- Inställningar → Utseende: snabbval (standard, förstorat 1:10 000, ISSprOM:s ring, 3,0 mm nummer), fria kvoter, skalning, avbrott vid sträckor, tabell per skala.
- Banor → Vid kontrollen: Nummer/Kod/Nummer och kod (1, 31, 1-31), poäng bara för poängbanor, samma för alla stafettbanor eller banor; texter som Purple Pen (3/7-31, 31(30)).
- Verifierat: lint, typecheck, test (Purple Pens 151 filer fram och tillbaka med ändrat utseende), Playwright banlaggning-utseende lokalt (1280/390), CI grönt med test:integration och alla specar. Återstår: ägaren provar en riktig nattbana; centrumpunkt, typsnitt och vit kant runt numren finns inte i O-Tid.

### 2026-11-02 – Steg 65: PDF för tryck med dekorfärger och övertryck (grenen steg65-pdf, ADR-0184)
- Paketet `print-pdf` (pdf-lib + fontkit, MIT): arken ur steg 64 som PDF utan omräkning; kartan som vektorer via `drawMap` med en PDF-kontext (`MapDrawingContext`, ingen dubbel geometri), ett Form XObject per utsnitt; Roboto/Roboto Condensed (OFL) inbäddade som delmängd.
- Färger: kartans dekorfärger som `/Separation`/`/DeviceN` (typ 4) med filens CMYK och övertryck (kartläsarna behåller nu separationerna), banan i profilens dekorfärg ("Purple") med /OP /op /OPM 1, vitt som knockout, skärmarker i `/All`; lägena tryckeri, tryckeri med kartan i CMYK och kontorsskrivare. Baksidor upprätt med /Duplex DuplexFlipLongEdge.
- Servern: kön `course_setting_print_job` (migration 0036), `print-worker` som egen process (nice 19, CPU-vikt 64, 384 MB, pool 2, SKIP LOCKED, livstecken), bara admin, 3 aktiva per tävling, 2 000 sidor/150 MB, PDF:er 7 dagar och utanför säkerhetskopian. Förhandsvisningen: förhandskontrollen mot PDF:ens förmåga, "Skapa PDF för tryck/kontorsskrivare", jobblista och nedladdning.
- Verifierat: lint, typecheck, test, test:integration (steg-65-tryck: avläsning på <2 s medan arbetaren skriver 1 800 sidor), Playwright banlaggning-pdf; qpdf --check, poppler och Ghostscript tiffsep: lilan på egen plåt. Högdalen/SBN26_2: 40 sidor 6 s 5 MB; 300 löpare med baksidor 4,8 s, 5,7 MB, 130 MB minne.
- Inte verifierat: provtryck, PDF/X/ICC (stöds inte), RIP:ar och Acrobats förhandsvisning. Undre lila ritas efter kartan (övertryck gör det lika i plåtarna, inte på kontorsskrivaren).

### 2026-11-01 – Steg 64: banpåtryck och utskriftslayout (grenen steg64-tryck, ADR-0180 beslut 11)
- Paketet: Purple Pens 16 specialobjekt tolkade bredvid `raw` (orörda om fälten inte ändrats, annars skrivna som Purple Pen) och ritade enligt CourseObject.cs och ISOM 2017-2/ISSprOM 2019-2 (korsraster 0,2/1,2 mm, gräns 0,7/1,0 mm, undre lila för passage, gräns, första hjälpen, vatten); beskrivningen på kartan med `layoutDescription` (också i spalter); figurerna i Purple Pens målningsordning (WHITE … COURSE). Siffrornas em-höjd nu som Purple Pen (5,57 mm för 4 mm siffror).
- Ändringar ADD/MOVE/UPDATE/DELETE_SPECIAL och SET_PRINT_AREA (också i samarbetets uppspelning: specialobjektens id översätts); tryckytan `printArea` per bana och för Alla kontroller, `allControlsPrintScale`.
- `layoutCoursePage`: papper, tryckyta (automatisk som Purple Pen eller fast ram), utskriftsskala, flera sidor, rubrik, variant per sida; bara data (kartklipp, transform, figurer med färgroll) för förhandsvisningen och steg 65.
- Editorn: verktyget Objekt (O) och flikarna Objekt (rita yta/linje med klick och Enter/Klar, ett klick för text, passage och beskrivning; banor, text, storlek, färg, spalter) och Utskrift (papper, riktning, marginal, skala, tryckyta, ram på kartan att dra). Förhandsvisningen `/course-setting/print`: kartan ur Workern (300 dpi) och påtrycket som SVG, en @page per pappersstorlek, raden om utkast.
- Verifierat: lint, typecheck, test (med `OTID_REAL_PPEN`=SBN26_2), test:integration (101 filer, 413 tester); Playwright banlaggning-utskrift (ny, och med ägarens filer via `OTID_E2E_SBN_DIR`), banlaggning, banlaggning-samarbete, banlaggning-mobil, kontrollbeskrivning gröna; skärmbilder av Högdalen/SBN granskade.
- Spärrar (ägarens krav): `routeBarriers` ger banans förbjudna/farliga områden, konstruktioner, gränser och förbjudna vägar som spärrar och valfria passager som öppningar; motorn rastrerar dem som BLOCK/CROSSING i samma rutnät (`LegInput.barriers`, bakåtkompatibelt). Editorn och kontrollkartans vägval skickar dem (kontrollkartan läser banläggningens dokument om det finns); analysen räknas om när ett objekt ändras. Ny varning LEG_THROUGH_FORBIDDEN. SBN26_2: sträckan genom området 534 m utan spärren, 716 m runt med den (bild i scratchpad).
- Utskriftsprofil, layoutmallar och en karta per löpare (ADR-0183 skriven): kartans färger per OCAD-färg utan att kartfilen ändras (`drawMap` colorAdjust), förhandskontroll, mallar med flera kartor per A4/A3, platshållare, logotyp, remsa och skärmarker; per löpare ur kartbuntarna med baksida eller remsa och kontroll av varianter och antal. Telefonen: Objekt och Utskrift bakom "Mer" (main 7046e91).
- Återstår: steg 65 (PDF med dekorfärger, övertryck, PDF/X/ICC); en sida per bana-del (`part`) och bilder via editorn finns inte; textbredder är uppskattade; varningen prövas inte mot kartfilens egna förbjudna områden (709/520).

### 2026-11-01 – Kartritningen: stolpar och färger (grenen kartritning, paketet map-file)
- Linjesymbolernas punktsymboler ritas: OCAD hörn/start/slut/sekundär (flaggorna i 870) och primär med slutlängd, antal per ställe och jämn fördelning; Mapper strecksymbol (streckpunkter, flagga 32), start/slut och mittsymboler. Kraftledningarnas stolpar (510/511) syns nu, liksom brons vingar, staketens och murarnas tecken. OCAD:s luckor (x 8 huvudlinje, x 4/y 4 kantlinjer) och ytornas stängande kantsträcka ritas rätt.
- Skärmfärgen ur CMYK med Purple Pens SWOP-tabell (BSD, notis i `swop-table.ts`) i stället för (1−c)(1−k): grön C80 Y100 blir (12, 177, 75), inte neon. Mappers naiva RGB ersätts; egen RGB behålls. CMYK orört. Purple Pen visar dessutom kartan i 70 % styrka som standard; övertryck simuleras inte (som Purple Pen som standard).
- Verifierat: map-file lint/typecheck/test, real-map (Djurgården OCAD+Mapper, Högdalen), rot typecheck/test, Playwright kartfil och banlaggning; före/efter-bilder på Högdalen och Djurgården granskade.

### 2026-11-01 – Steg 68: träningsgrupper (grenen steg68-grupper, ADR-0182)
- Migration 0035: `training_group` (kod i länken /g/<kod>, synligheten med standard länk/förnamn/bara ledarna, poängserie, mall), `training_group_member` (LEADER/MEMBER, läggs till med e-post), `training_group_series`, `training_group_request`, kartbiblioteket (`training_group_map`, `_source`, `_course_setting`) och `race_map_agreement`; `event.training_group_id`/`_series_id`. Inga nycklar från gruppen till tävlingar eller konton (purge följer nycklarna). Klubb med flera grupper: en tabell och en nullbar kolumn senare.
- Behörighet: `activeEventAdministrationGrant` ger en ledare ADMIN på gruppens tävlingar (efter egen ägare/admin, före funktionär); därmed `requireRaceRole`, banläggningen, förhandsvisningen och kopian. Gruppens tillfällen har inga egna administratörer. Att ta en tävling ur gruppen kräver en egen roll på evenemanget.
- Ny träning ur mall/förra/valt tillfälle via `copyRaceContent` (+ loppets inställningar och starttid); upprepning skapar alla i förväg, "Ångra framtida" tar bort framtida orörda (inga anmälda, inga avläsningar) med purge. Vanlig kopia av en ledare hamnar i gruppen; andras blir fristående.
- Kartbiblioteket KOPIERAR bild, kartfil och banläggning (in och ut), säkrast mot borttagning; avtalet följer som kopia per tävling och uppdateras när biblioteket ändras. Utgånget/"inte publik visning" spärrar kartbilden publikt (och därmed vägvalskartan, GPS-rutterna) tills admin väljer "Visa publikt ändå"; utgånget eller "bara träning" för en tävling stoppar ny träning tills ledaren går vidare.
- Namnen: gruppens val gäller gruppsidan och tävlingens egna publika sidor (de cachade listorna: resultat, stafett, mellantider, Live, startlista, deltagarsidan; fastställda listor, GPS-rutter, kontrollkartan); IOF XML publikt 404 utom vid fullt namn; inställningen ingår i innehållsversionen. Gruppens tävlingar listas inte på startsidan; "bara medlemmar" gäller också tävlingens sidor (privat cache). /g/ är noindex (robots.txt, X-Robots-Tag, meta).
- Deltagare känns igen på namnet (närvaro och poäng ur publicerade resultat); självanmälan på gruppsidan för dagens träning minns förra anmälan i telefonen.
- Verifierat: lint, typecheck, test, test:integration (101 filer, 413 tester; uppgraderingstestet steg 28 behövde de nya kolumnerna), Playwright traningsgrupp (ny), arbetsyta, publikt, kopiera, sjalvregistrering och sjalvregistrering-tavling gröna i dev; CI grönt (66 specar mot driftbygget); skärmbilder 1280/390 granskade.
- Återstår: inte provat av ägaren med en riktig grupp; säsongen räknar om alla tillfällens resultat vid varje visning (högst 60).

### 2026-11-01 – Steg 67: fältläget i mobilen (grenen steg67-falt)
- Kollad per kontroll i egen tabell (migration 0034 `course_setting_inspection`, PUT/GET `course-setting/inspections`), inte i dokumentet: bankontrollanten (läsa och kommentera) får bocka, en bock ger ingen version, inget förslag och ingen konflikt, en ny .ppen tar inte bort bockarna, och .ppen/banpåtryck/överföring är orörda (integrationstest). Den senaste vinner med tiden från telefonen (avbockning står kvar som rad); export ja, kopia nej. Diskret bock på kartan (orange om kontrollen flyttats efter kollen), fliken Kollat med "Ej kollade".
- Fältraden: Kollad, Notis här (kameran öppnas direkt, `capture="environment"`; vald kontroll eller positionen), Lista, Offline. Kompassens kon (`deviceorientationabsolute`, iOS `webkitCompassHeading` med lovfrågan), Följ släpper när kartan dras, ±m och varning över 15 m. Läsa och kommentera ser raden utan flyttknapparna.
- Utan nät: editorns osparade åtgärder (med versionen de bygger på och requestId för den som var på väg) och en kö med notiser (foton) och bockar i IndexedDB (`otid-course-setting`; ersätter localStorage-kopian), raderas först när servern svarat. Sidan öppnas ur telefonen utan nät eller utloggad; "Utan nät – N ändringar väntar", "Nätet är tillbaka: …" och avvisat i klartext; utloggad: logga in i ny flik, sidan skickar sedan (CSRF läses vid varje anrop).
- "Spara kartan för offline" (storleken visas): kartfilen i IndexedDB (används också med nät när sha256 stämmer) och service workern `/course-setting-sw.js` med scope `/admin/<tävling>/course-setting` (bara sidan och `/_next/static/`, aldrig API eller publika sidor; avläsningens `/readout/` orörd). Workerns filer: startas via blob när sidan styrs, annars styr ingen service worker dem.
- Verifierat: lint, typecheck, test, test:integration (100 filer, 408 tester); Playwright banlaggning-falt (ny), banlaggning-mobil, banlaggning-mobil-kartan, banlaggning, banlaggning-samarbete gröna i dev; banlaggning-falt med omladdning utan nät grön mot driftbygget bakom HTTPS lokalt och i CI (a27d58f, 65 specar). Utan nät i Playwright = `setOffline` + route som avbryter allt (setOffline gäller inte service workerns anrop); omladdningen utan nät provas bara mot driftbygget (dev-servern startar inte ur service workern).
- Återstår: ägaren provar i terrängen (iPhone och Android: kompassen, kameran, flygplansläge och omladdning, en riktig kartfil på 20–60 MB).

### 2026-11-01 – Steg 66: samarbete i banläggningen (grenen steg66-samarbete)
- Behörighet för banläggning per person och tävling (migration 0033 `course_setting_grant`, ändra/föreslå/läsa och kommentera), given under Inställningar → Personer som andra roller; `requireCourseSettingAccess` och tabellen `COURSE_SETTING_ROUTES` i race-roles.ts avgör alla banläggningens routes och kartfilens GET; ägare/admin har ändra, överföring och arbetssätt kräver admin. Resten av tävlingen nås inte (ingen roll på eventet). Mina tävlingar visar loppet med "Öppna banläggningen".
- Åtgärder i stället för hela dokument (`POST course-setting/edits`): paketets `replayEdits` (tillägg i `packages/course-setting`, med `PUT_OBJECTS` för ångra) spelar upp på aktuell version, översätter nya id, avvisar det som någon annan ändrat sedan (`course_setting_change`, den första vinner) och det som bygger på avvisade; samma requestId ger samma svar. Editorn ombaserar osparade åtgärder och ångra-historiken (`lib/course-setting-sync.ts`).
- Notiser (`course_setting_note`, svar, öppen/klar, foto ≤ 2 MB förminskat i webbläsaren) på punkt, kontroll, sträcka eller bana; markeringar som går att dölja; aldrig i banpåtryck, beskrivning, .ppen eller överföring (integrationstest jämför utdata). Förslag (`course_setting_suggestion`): förslagsläge för den som föreslår, granskning streckad ovanpå banan, godkänn helt/delvis eller avböj. Arbetssätt (Huvudbanläggare/Gemensamt) i lådans Inställningar.
- Ström per tävling (`course-setting/events`, SSE): ny version, notiser, förslag, arbetssätt och närvaro. Ett nav i processen utan databasfrågor (allt inloggat går till `web`, ADR-0177), så avläsningen påverkas inte.
- Arbetsytan i helskärm (ägarens önskemål): smal rad överst (banväljare, sparstatus, ångra/gör om, Fil-meny, helskärm), verktygsrad med ikoner och tangenter, låda med flikar (fäll ihop, dra bredd, varje flik skrollar), blad nerifrån under 900 px med fältläget (på 390 px namnet bara på vald flik), kryss i vald kontroll; rutan med vald kontroll bara med Välj (annars hamnade klick på den); vägvalens alternativ som lista (klick markerar linjen).
- Sidouppdraget (404 på POST map/source i dev): anropet nådde aldrig routen – Next (Turbopack) svarade med sin 404-sida och loggade "Failed to find Server Action" medan den kompilerade annat. Gick inte att framkalla med curl. Klienten skickar nu om en sådan 404 (inte appens JSON-404) och specarna förvärmer banläggningens routes.
- Verifierat: lint, typecheck, test, test:integration (99 filer, 407 tester; migrationen är 0033 efter main:s 0032_tomt_loppnamn), Playwright banlaggning-samarbete (två–tre användare, skärmbilder 1440×900 och 390×844 granskade), banlaggning, banlaggning-mobil, banlaggning-mobil-kartan, kontrollbeskrivning, kartfil, vagval-analys; CI grönt på 7afb4b1. Utvecklingslägets dubbla laddning monterade om editorn (ett klick försvann); rättat.
- Återstår: inte provat av ägaren med flera personer på riktigt; foton bara provade i tester.

### 2026-11-01 – Tomt loppnamn (gren tomt-loppnamn)
- Etapp/lopp är valfritt på riktigt: tomt sparas som "" (inte "Lopp 1") vid skapande, i Inställningar och vid kopiering; kontrakten tar emot och tål tomt.
- `raceTitle`/`raceDetails` i domänen: evenemangets namn och loppets bara när det finns, på alla rubriker, publika sidor, listor, utskrifter, kvitto, speaker och kartbuntar. Mina tävlingar: ensamt lopp utan namn visar datumet, flera "Lopp N".
- Migration 0032: skapandeförsökens loppnamn får vara tomt; det enda loppet i ett evenemang som heter exakt "Lopp 1" får inget namn (versionen räknas upp).

### 2026-11-01 – Ringklipp i banpåtrycket (grenen ringklipp, ADR-0180 beslut 10)
- Valbart i `event.circleCutting` (skrivs inte till .ppen): överlapp (bågen inne i den andra ringen bort, kraftig överlappning behåller en hel ring, högst hälften per ring, också målets inre) och detaljer (`detailCircleGaps`, symboltabell ISOM 2017-2/ISSprOM 2019-2, högst en fjärdedel, inte vid sträckorna, gap per ringstorlek).
- Webben: kartans Worker räknar detaljgapen 400 ms efter senaste ändringen (Högdalen/SBN26: 34 ringar 6–60 ms, första gången med index 70–210 ms); kryssrutorna och "Gör klippen fasta (för Purple Pen)" i egen komponent, sju rader i editorn.
- Verifierat: lint, typecheck, test (överlapp också över Purple Pens 151 testfiler); ägarens karta med `OTID_REAL_MAP`/`OTID_REAL_MAP_PPEN`; före/efter-bilder granskade; Playwright banlaggning (med kryssrutorna och fasta klipp) och banlaggning-mobil gröna.
- Idé: ringar med tre gap ser splittrade ut i översikt; ett tak på antal gap per ring kan prövas.

### 2026-11-01 – Vägvalsmodellen (grenen vagval-modell, ADR-0179)
- Kurvpassage = ekvidistans × (climbFactor 8 + descentFactor 3) / 2 (descentFactor minst 0,5); lutningsfaktor 0,2 ur kurvtätheten i marken, inte på stig/väg; passerbara branter/vallar/staket 2–15 m per passage.
- Alternativ upp till 25 % sämre, högst fyra, tydligt skilda; ±15 % gäller "ungefär lika". Ritningen: blå bästa väg, numrerade streckade alternativ ("1 · +8 %") med vit kant.
- Högdalen A 8–9 (OTID_SBN_DIR, SBN26_2.ppen): bästa vägen följer stigen runt kullen i stället för vit skog nedanför den; över kullen +13 % (ungefär lika).
- Verifierat: route-choice lint/typecheck/test, pnpm typecheck, pnpm test, Playwright vagval-analys och kontrollkarta; 1,5 km i Djurgården 0,88 s (last 3,8), lika snabbt som före ändringen.

### 2026-11-01 – Fältläget, snabbversion (grenen faltlage-snabb; hela fältläget är steg 67)
- Min position (WGS 84 → kartans mm med kartfilens georeferens, som kartans Worker nu skickar med), Flytta hit (medel under 5 s, avvikare > 2 × medianen kastas), pilar 1 m; under 700 px kartan på hela skärmen med stora knappar och "Uppgifter" (F, G). Permissions-Policy `geolocation=(self)` på `/admin/:raceId/course-setting`.
- Osparade ändringar ligger i localStorage tills servern sparat och erbjuds vid nästa öppning; statusen säger "Inte sparat – försöker igen". Logiken i `lib/course-setting-field.ts` och `-geo.ts` med enhetstester.
- Verifierat: lint, typecheck, test; Playwright banlaggning-mobil (390 × 844, fejkad position, nätfel och återställning) och banlaggning gröna. Inte provat på en riktig telefon i skogen.

### 2026-11-01 – Steg 63: kontrollbeskrivningar (paketet steg63-paket, webben steg63-webb, ihopslagna i main)
- Paketet: symbolerna ur Purple Pens `symbols.xml` (201, 2004 och 2018, sv/en/nb/fi/de; 20 kB gzip), `layoutDescription` och `describeControl` som Purple Pen (11 + 13 jämförelser tecken för tecken), SET_DESCRIPTION/…_TEXT_LINE.
- Editorn: beskrivningen för vald bana/variant (eller Alla kontroller) i spalten bredvid kartan, ritad som SVG ur `layoutDescription` och symbolernas figurer (vända rätt, i mm); rad ↔ kartval åt båda hållen, rutorna nås med Tab.
- Väljaren (C–H och riktningsraden "all"): `symbolsForBox`, ikon och namn på valt språk, sökning på namn/id, senast använda överst (i webbläsaren), "Ingen", fri text bara i F (paketet avvisar text i G, som Purple Pen), pilar/Enter/Escape. Textrader före/efter (`SET_DESCRIPTION_TEXT_LINE`); banans egna textrader visas men ändras inte.
- Kontrollens textbeskrivning (`describeControl`) i Vald-rutan. Inställningar: standard (SET_EVENT), språk (paketets fem) och visningssätt.
- Språket ligger i dokumentet (`event.descriptionLanguage` ↔ .ppen `<descriptions lang>`, SET_EVENT); visningssättet i webbläsaren.
- Utskrift `/admin/[raceId]/course-setting/descriptions` (bara admin): banor och varianter, symboler/text/båda, 5–7 mm, kopior; tätt i kolumner på A4 (`@page` utan marginal, 8 mm kant) med skärmarker; "Skriv ut" och "Ladda ned SVG" per bana. Bara svart.
- Verifierat: lint, typecheck, test; Playwright kontrollbeskrivning och banlaggning gröna. Ostadigt: uppladdningen av kartfilen gav 404 (POST map/source i dev-servern) i 2 av 6 körningar, i båda specarna; samma fel som steg 62 noterade, inte utrett.

### 2026-10-31 – Steg 62: banläggning – .ppen och editorn (paketet steg62-paket, webben steg62-webb, ihopslagna i main)
- `packages/course-setting`: .ppen in/ut utan förlust (Purple Pens 151 läsbara testfiler, nu fixturer i `fixtures/purplepen`), ändringar, varianter portade från Purple Pens QueryEvent (SBN26_2.ppen = SBN26_1.xml i namn och kodsiffror), kontroller, banpåtryck med Purple Pens mått; 201 tester.
- Migration 0031 `course_setting` (dokument, version, ändrad av/när, inläst .ppen orörd) och `course_setting_revision` (högst 50; autosparandet behåller en version per 10 min, alltid vid inläsning/återställning). Spara med `expectedVersion` (409 med aktuell version), lås per tävling, inte tävlingen (ADR-0177). Med i adminexporten och kopian, aldrig publikt.
- API `administrator/course-setting*` (läge/spara, import, versioner, återställ, originalfilen, överför); bara admin, skrivningar med CSRF.
- "Överför till tävlingen": dokumentet blir en `CourseFileProjection` som Purple Pens IOF-export (familj + Purple Pens variantkod, längd till 100 m, klasser ur undertiteln, MapPosition, Position med kartfilens georeferens) och går genom banfilens förhandsvisning och `applySyncAsAdmin`. Ägarens SBN26_2.ppen ger samma banor och varianter som SBN26_1.xml (manuellt, filen inte committad).
- Editorn `/admin/[raceId]/course-setting` (länk under Banor): kartfilen ritad i en Worker per vy, banpåtrycket i eget lager, zoom/panorering/nyp, banlista, verktyg (välj/flytta, ny kontroll/start/mål/passage, lägg in, brytpunkt), gaffling/slinga, flytta nummer, ångra/gör om, tangenter, autosparande med konfliktbesked, kontrollerna i klartext, vald sträckas vägval (route-choice-workern), .ppen in/ut, tidigare versioner.
- Logiken i `lib/course-setting-*` (kartvy, träff-test mot `ref`, editorns tillstånd, autosparande, texter) med enhetstester; fixturen `fixtures/course-setting/kartfil.ppen`.
- Verifierat: lint, typecheck, test, test:integration (97 filer, 401 tester), Playwright banlaggning, kartfil, kontrollkarta, vagval-analys. Ostadigt: banlaggning föll en gång av fem vid uppladdningen av kartfilen (okänd status, nu loggad); kartfil en gång när tävlingen skapades (kall dev-server).
- Återstår/ej gjort: stafettlagens varianter (Purple Pens relay-teams) förs inte över; banläggningen i editorn är bara provad i Playwright, inte av ägaren på en riktig bana.

### 2026-10-31 – Steg 60: vägvalsanalys (motorn steg60-motor, webben steg60-webb, ihopslagna i main)
- `packages/route-choice`: standardtabell (ISOM/ISSprOM + egna tumregler), kostnadsmodell, rutnät per sträcka (2 m / 0,5 m sprint, större ruta
  vid behov), A* med 16 grannar och två fält, stråk ≤ 5 %, upp till 3 alternativ, stigning ur höjdkurvorna, ±15 % → "ungefär lika", kalibrering.
- Migration 0030 `race_route_choice` (inställningar, publicerade bästa vägar med kartfilens sha256). Worker räknar i webbläsaren; servern lagrar.
- Kontrollkartans läge "Vägval": tabell, summa, varningar, karta med bästa väg, stråk och alternativ; inställningar, kalibrering, "Visa bästa vägval publikt".
- Djurgården H21, 20 sträckor: OCAD och Mapper samma besked (±10 m); 3 vägval, 13 tydligt bästa, 4 ungefär lika; ingen saknar väg.
- Prestanda: 1,5 km i terräng (≈ 690 000 celler) 0,66–0,90 s i Node på 2 kärnor; kostnadsmodellen 0,1–0,2 s.
- Kalibreringen bara provad på syntetiska spår; branter/vallar/staket som går att passera kostar inget extra ännu.
- Verifierat: lint, typecheck, test, test:integration (96 filer, 397 tester), Playwright vagval-analys, kartfil, kontrollkarta, strackanalys, banhemlighet, kartbuntar.
- Ostadigt: strackanalys föll två gånger i en serie av flera specar (kartbilden syns inte inom 15 s, rad 115) men går igenom ensam; inte utrett.

### 2026-10-31 – Steg 61: gafflingar till start och karta (agent C, gren steg61-gafflingar)
- Domän `map-bundles.ts`: en plan (`planMapBundles`) för tryckantal (löpare + lediga tider med efteranmälans variantregel + reserv i
  procent eller antal), kartbuntslistan (startnummer i startordning, per starttid eller per klass och variant) och baksidorna
  (`mapBackPages`: avdelare per variant, sidor = tryckantal) och ändringar sedan utskriften (`mapPrintChanges`). `wrongMapVariants`
  (fel karta, samma matchning/neutralisering som bedömningen) och `forkingReadiness` (kontrollen före tävlingen).
- Migration 0029: `map_print` (senaste utskriften per tävling och lista med läget då) och `race.map_reserve`.
- Webben: sidan Kartor till starten (länk under Start när någon klass är gafflad; funktionären läser och skriver ut, reserven kräver
  admin), baksidor med A4/A3, riktning, textens läge, spegling och provsida. Variantkod även i startlistan per starttid och per klubb
  (skärm och CSV). Fel karta i avläsningens besked och kvitto, deltagarkortet ("Godkänn på BD" via `changeEntryVariantAsAdmin` med
  orsaken i auditposten) och Anmälda-listan. Kontrollraden under Banor. IOF StartList skrev redan varianten (verifierat).
- Verifierat: se slutrapporten (lint, typecheck, test, test:integration, Playwright `kartbuntar` + gafflingar/avläsning/listor).
- Kvar: utskriften av baksidorna är bara provad i webbläsarens förhandsvisning, inte på papper mot tryckta kartor.

### 2026-10-31 – Steg 59: läsarna (agent A, gren steg59-lasare)
- `packages/map-file`: `readMapFile` för OCAD 12/2018+ och Mapper v9 till modellen i `model.ts`; georeferens SWEREF 99 TM, lokala zoner och RT 90 2,5 gon V
  (Lantmäteriets räkneexempel och 14 kontrollpunkter < 1 mm; RT 90 bara rundresa). 200 slumpfiler per format hänger inte.
- Djurgården 2025 (`OTID_REAL_MAP_DIR`, filerna committas inte): OCAD och Mapper ger samma 10 877 objekt och samma geometri per symbol; banfilens
  25 kontroller via kartfilens georeferens inom 0,07 m (OCAD) och 0,36 m (Mapper) från `Position`. Läses på < 0,5 s.

### 2026-10-31 – Steg 59: kartfilen i webben (agent B, gren steg59-webb)
- Skärmritning i `packages/map-file/src/render` (`drawMap`, `renderSize`): färgordning, ytor med raster/punktmönster (tonad yta när
  mönstret är för tätt), linjer med alla streck/dubbellinjer/upprepade tecken, punkter, text och kombinerade symboler; förenklingar på svenska.
- Webbläsaren läser och ritar i en Worker (`lib/map-file-worker.ts`, `OffscreenCanvas` → PNG, 8/10/12 px/mm, ritar om mindre över 30 MB)
  och räknar tre hörn till WGS 84 så att `race_map`s georeferens används. Uppladdningen (multipart) sparar `race_map_source` (migration 0028)
  och ersätter `race_map` i en transaktion med auditpost; ny kartbild tar bort kartfilen. Originalet bara till admin; Caddy 100 MB för sökvägen.
- Kontroller med `MapPosition` placeras på kartfilens mm (domänen `layoutControlMap` med `mapFile`), annars "Banfilen verkar inte vara gjord på
  den här kartan" och dagens ordning; samma på den publika vägvalskartan. Djurgården 2025 (OCAD och Mapper) med Natt-KM:s banfil: alla 25 på kartan.
- Verifierat: lint, typecheck, test, test:integration (94 filer), Playwright kartfil, kontrollkarta, strackanalys, banhemlighet, sakerhetshuvuden.
- Kvar: banläggarens kartfil i Banor (bara hänvisning från kontrollkartan); registerfärg och text längs linje förenklade.

### 2026-10-27 – Steg 57: placering vid avläsningen (agent I)
- Kvittot från servern har `placement` per godkänd avläsning: "2:a av 12 i mål · +2:14 efter Ada Ek", "Leder · 1:05 före tvåan",
  stafett "Laget 3:e av 12 efter sträcka 2 …" och "Sträcktid 23:10 · 4:e av 10 på sträckan …"; märkt preliminärt.
- Räknas i `web` ur den senast räknade arrangörs-/stafettlistan (`latest` i cachen) med avläsningarna sedan listan började
  räknas inlagda (`lib/readout-placement.ts`); domänen `readoutStanding`/`relayReadoutStanding`. ADR-0177 beslut 10.
- Avläsningsrutan och papperskvittot visar raden; utan nät "Placering visas när nätet är tillbaka".
- Lasttest (docs/lasttest.md): kvitto p95 514 → 589 ms, p99 1 007 → 812 ms, 150/150 med placering.
- Verifierat: lint, typecheck, test, test:integration (93 filer), build; Playwright placering, avlasaren, kopiera, avlasning-ko,
  stafett, stafett-steg50, gafflingar, rogaining, lanad-bricka, traningskvall, tavlingsfunktioner gröna en i taget;
  funktionarer 2 av 4 (fel i speakerns "Senast i mål" och i createRace, inte i avläsningen).
- Kvar: klassnamn matchas mot listan (två klasser med samma namn rankas ihop); teamsprint med utläsning efter sista
  sträckan placeras efter löparens första sträcka.

### 2026-10-27 – Steg 58: tävlingar över midnatt (agent A)
- Tävlingsdygnet till kl 12 dagen efter (`inRaceDay`): stämplingar efter 00:00 är tävlingens; "annan dag", radiopollern och övningsstationen följer det.
- Klockslag nära masstart/första start/klassens start (`parseRaceClockNear`): omstart 00:30 efter masstart 22:00 blir natten efter (stafettformulär, Start, lottning, starttid, rättad tid).
- Avläsningsskalet läser om kön innan beskedet visas (tidigare kunde "0 väntar" vara gammalt bredvid beskedet).
- E2E: tävlingen alltid i Stockholm, tävlingsdagen = startens datum (`raceStartedAgo`), kvitto per avläsning (`expectSaved`), `E2E_FAKE_CLOCK` för webbläsaren.
- CI-felen: de sista avläsningarna saknades (stafettens lag 2, listornas Eva); troligen kön, men inte återskapat lokalt med falsk klocka eller strypt processor.
- Övningsbrickan dras ur 400 ms efter stationens senaste svar (inte efter isättningen): med falsk klocka föll stafett-steg47 annars med "lästes inte färdigt" när webbläsaren hackade.
- Tester: domän `race-over-midnight`, webb `readout` (hackande utläsning), integration `steg-58-over-midnatt`, Playwright `avlasning-ko`; listor och stafett-steg47 med falsk klocka vid 21:59, 23:30, 00:10, 13:00 (TZ=UTC, driftbygget). Verifierat: lint, typecheck, test, test:integration, build, alla Playwright-specar en i taget (fest och tavlingstyper mot driftbygget: utvecklingsservern dödades av minnesgränsen).
- Kvar: fem specar med `ongoingRaceTimeZone`; ADR-0178.

### 2026-10-26 – Steg 54: tävlingen först (agent F)
- ADR-0177: `web` (tävlingen) och `web-public` + `web-public2` (publiken) bakom Caddy (`deploy/Caddyfile`, inloggade alltid
  till `web`), `cpu_shares` och minnestak, separata pooler med tidsgränser för publiken, lastavlastning (`lib/public-load.ts`).
- Avläsningen läser bara löparens/lagets del (`loadRaceSnapshot` med scope); stafett utan flygande omstart låses per lag.
  Arrangörens resultatlista cachas per version och Kvar i skogen delas i 2 s, båda med ändringsgenerationen i nyckeln.
- Efter CI:s driftjobb: tillträdet cachas inte (avpublicering/döljande syns direkt), en ändring i arbetsytan räknar upp
  generationen (Kvar i skogen och listorna räknas om, ingen äldre lista); publikt, konton, statusval, funktionarer 5 × gröna.
- Mätt (`docs/lasttest.md`): 1 000 besökare + målrusning: kvitto p95 6,8 → 0,68 s, arbetsytan p95 4,0 → 0,69 s, publiken
  p95 under 5 s men uppdatering p50 5 s (före 2,6 s). 25-manna 300 lag: kvitto p50 26,6 → 2,0 s, p95 91 → 11 s.
- `/om`: "Hur stora tävlingar klarar O-Tid?". Verifierat: lint, typecheck, enhets- och integrationstester (ny
  `steg-54-tavlingen-forst`), bygget, Playwright i utvecklingsläge och mot Caddy med tre produktionsinstanser (17 specar).
- Kvar: Docker-läget (`cpu_shares`, `mem_limit`, tre webbtjänster) provas först i CI:s driftjobb; tät 25-manna når inte 1 s.

### 2026-10-26 – Steg 55: bana utan klass (agent G)
- "Ny bana" kräver inte längre klass: utan klassnamn sparas bara banan (kontrakt, `createManualCourseClassAsAdmin`, journalens `class_id` NULL i `0027_bana_utan_klass`, audit `MANUAL_COURSE_CREATED_BY_ADMIN`). Startsätt och rogaining visas först med klassnamn; knapp och besked följer.
- Fälten i "Ny bana" och "Ny klass" linjeras överst (`fieldRowTop`), också när ett fält visar fel. Kontrollerat på 1280 och 390 px.
- "Ny klass" på en gafflad bana (tom grundföljd, bara varianter) avvisades som konflikt; nu går den att välja.
- Verifierat: lint, typecheck, enhets- och integrationstester (bana utan klass, omspelning, dubblettnamn, ändring, gaffling, klass, stafettsträcka, kontrollkarta), bygget, Playwright `bana-utan-klass` och specarna som använder formuläret.

### 2026-10-26 – Steg 56: stafettformuläret (agent H)
- "Ny stafettklass"/"Ändra stafettklass"/"Nytt lag": fel vid fälten (`relay-form-validation.ts`, `relay-fields.tsx`), sammanfattning överst, fokus på första felet; nekat sparande visas i formuläret, upptaget namn vid klassnamnet.
- Ingen klassbana i formuläret: "Bana sträcka N" krävs, snabbval "Samma bana på alla sträckor"; servern sätter klassens bana till sträcka 1:s och sparar alla sträckors banor (ADR-0174 beslut 10). Lagkort, publika resultat och startlista visar bana per sträcka när banorna skiljer sig; klasstabellen visar sträckornas banor.
- Mallar som en rad med val (vanlig, teamsprint, ungdom, linjestafett) med besked; "Fler inställningar" öppnas av mall eller fel. Tider 18:30, 18.30, 1830.
- Verifierat: lint, typecheck, enhetstester (web 410), integration (382, nytt fall i `adr-0174-stafett`), bygget; Playwright `stafett-steg56` (ny) och `stafett`, `stafett-steg47/48/50`. Kvar: arbetsytans startlista visar fortfarande klassens rubrikbana (sträcka 1:s) för stafett.
### 2026-10-26 – Steg 51: lasttest (agent C)
- `docs/lasttest.md`: scenarier, uppställning (produktionsbygget, PostgreSQL 17, cgroup 2 kärnor/4 GB), resultat och gränser; skripten i `scripts/lasttest/`.
- Före: 100 besökare på 3 000 löpare mättade CX23 (publika anrop 30 s, avläsningspaketet kom aldrig).
- Rättat: publika listor en gång per tävlingsversion (`lib/public-race-cache.ts`, gzip/ETag, versionsnyckel), stora listor inte i sidan, SSE samlar och väcker efter uträkningen, sidorna sprider hämtningen och hämtar mer sällan med öppen ström.
- Rättat: stafettsynk bara för laget utan flygande omstart (25-manna 1,1–1,6 s → 0,33 s per avläsning), starttidsflytt bara för klassen (15 s → 1–2 s), `= any()` i stället för `inArray`, omförsök vid 40001, två webbinstanser (`web2`) bakom Caddy.
- Efter: 300 besökare p95 0,5–0,95 s publikt, uppdatering p95 4,0 s; kvitto p95 1,3–1,7 s (målet 1 s nås inte); 500 besökare p95 1,2–1,5 s.
- Verifierat: lint, typecheck, enhets- och integrationstester (ny `steg-51-lasttest`), bygget, Playwright publikt/live/listor/stafett/gafflingar; `funktionarer.spec.ts` fallerar på speakern även på main ac2e06d.
- Kvar: avläsningen läser hela avläsningspaketet (se Idéer); 25-manna med täta växlingar; docker-läget i `server.sh` och `web2` i drift är inte provade (inga bilder i miljön).
- Efter sammanslagningen med main (steg 50, 52, 53): CI:s driftjobb såg inaktuella publika listor (live, stafett 47/48, listor, gafflingsbild). Rättat i cachen: äldre lista bara när enbart nya resultat kommit in och då märkt `x-otid-stale` (sidan hämtar igen efter 3–4 s), annars väntar anropet på den nya listan; uträkning från före en ändring görs om; sidorna läser versionen direkt; reserven med öppen ström 10 s. Provat med två produktionsinstanser bakom en lastbalanserare (least_conn och slumpvis).
- Live inom 5 s med två instanser: instansen som bara får hämtningarna lyssnar nu på resultatströmmen och räknar om i förväg, väckningen ger alltid den nya versionen, äldre lista direkt bara om högst 1 s gammal, ny hämtning efter 1,5–2,5 s. Mätt bakom Caddy 2.11: avläsning till Live 0,5–2,0 s (förut upp till 5 s), också under full last.
### 2026-10-26 – Steg 53: snabbare utläsning av nyare brickor (agent E)
- SI10/11/SIAC och SI6 läses block för block efter antalet stämplingar i block 0 (som MeOS); SIAC läser också block 1.
  20 stämplingar: 2 svar (SIAC 3) i stället för 5 eller 8; vid 4 800 baud ca 0,6–0,9 s i stället för 1,4–2,3 s.
- Oväntat svar (NAK, fel block, tidsgräns, fel bricka, block som inte går ihop) ger "alla block" direkt för samma bricka och
  en post i felsökningsloggen. Inställningen "Snabb utläsning av SI10/11/SIAC" (på) kan stänga av det.
- Felsökningsloggen har nu `notes`: stationens inställningar, utläsningssätt, svar och ms per bricka.
- Tester: `packages/sportident/test/fast-read.test.ts` (plan, reserv, bit för bit, natt-KM), webb `readout.test.ts`,
  Playwright `avlasaren`. Bara provat med den falska stationen; ägaren provar SIAC, SI10, SI8 och SI5 på riktigt.

### 2026-10-26 – Steg 52 del 2: kontrollkartan (agent D)
- Banor → "Kontrollkarta" (dialog): belastning (färg, storlek, tabell; planerade eller stämplingar) eller en bana/variant med linjer och nummer. SVG utan bibliotek, kartbilden under när den är georefererad.
- Lägen: WGS 84, annars kartlägen (MapPosition mm + Map/Scale, sparas nu vid inläsning, kopiering och synk; migration 0026).
- Deltagarkortet och den publika deltagarsidan (när banorna är publika): "Visa på kartan" med saknade, fel ordning och ur funktion.
- Tester: domän `control-map`, iof `parser`, webb `control-map`, integration `steg-52-kontrollkarta`, Playwright `kontrollkarta`.
- Playwright `gafflingar` faller i den här miljön även på main (75ce9d9) vid deltagarkortets resultat; inte undersökt vidare.

### 2026-10-26 – Steg 52 del 1: banhemlighet (agent D)
- Ny regel (ADR-0176, `courseSecrecy`): banorna är publika när alla ej strukna har resultat eller beslut, när resultaten är fastställda eller när arrangören valt "Visa banorna publikt nu" (`race.courses_public_at`, migration 0026, auditpost, går att ångra).
- Innan dess publikt: ingen gafflingsbild i resultatlistan och på deltagarsidan och ingen bana på vägvalskartan. Variant och sträcktider står kvar.
- Arrangören och funktionärerna ser allt, även på de publika sidorna när de är inloggade (svaret cachas då inte delat). Läget visas under Publicera.
- Tester: domän `course-secrecy`, integration `steg-52-banhemlighet` och `adr-0171-map-routes`, Playwright `banhemlighet`.

### 2026-10-26 – Steg 50: teamsprint med utläsning efter varje sträcka (agent A)
- Förval som MeOS (`class.relay_readout_mode`, migration 0024): utläsningen går till löparens första sträcka utan resultat och bedöms mot stämplingarna efter förra utläsningens mål; ingen växlingskontroll behövs. Steg 48:s sätt är ett val.
- Dubblett = omläsning; tidigare måltid eller alla sträckor utlästa blir okänd utläsning med besked. Glömd utläsning: växlingskontrollen om den finns, annars banorna i tur och ordning och "Utläsning efter sträcka X saknas".
- En sträcka som saknar start (föregående saknar växling) räknas som ute, inte felstämplad. Delningen räknas ur sträckornas resultatrevisioner.
- Avläsningens besked "Lag 12 Ek – sträcka 3 (Ada Ek, andra sträckan)"; lagkortet visar varje sträckas utläsning; övningsstationen har en bricka per sträcka.
- Rättat: teamsprint vid okända utläsningar (journalens brickkoppling hör till brickan) och omläsning; löpare, växlingskontroll och utläsningssätt kan ändras när lag finns.
- Tester: domän `team-sprint-steg50`, integration `adr-0174-teamsprint-utlasning`, Playwright `stafett-steg50`; `stafett-steg48` provar valet efter sista sträckan.

### 2026-10-26 – Steg 48: flera löpare per sträcka och teamsprint (agent A)
- Parallella sträckor (migration 0022: `relay_leg.runners`, växlings- och godkännanderegel, `entry.relay_leg_order`): FIRST/LAST, ALL/ANY.
- Teamsprint: växlingskontroll per klass, brickan på löparens första sträcka (`entry.relay_card_entry_id`), avläsningen delas i resultatmotorn; saknad växling ger besked.
- Lagformulär, lagkort, resultatlista ("växlade"), avläsningsskalet (alla sträckor på brickan), mallen Teamsprint.
- IOF EntryList TeamEntry (Leg, LegOrder) importeras; LegOrder i resultatlistan; startlistan tar flera löpare per sträcka.
- Rättat: klassynken upprepas tills starterna är stabila (avläsning i omvänd ordning, teamsprintens sista sträcka); stafettens skrivningar får 64 KiB (25 sträckor gick inte att spara med 4 KiB).
- Tester: domän `relay-steg48`, integration `adr-0174-flera-lopare`, Playwright `stafett-steg48`.
- Kvar: Eventors `TeamSequence`; teamsprintdelar i okänd-bricka-lösningen och omläsning; ändra löpare/växlingskontroll bara innan lag finns.

### 2026-10-25 – Steg 47: stafett på riktigt (agent A)
- Bana per sträcka (`relay_leg.course_version_id`, migration 0021, underlagshash per sträcka), AllowedOnLeg i IOF, banan per sträcka i startlista/export.
- Ändra stafettklass med besked och omräkning; ändra/ta bort/stryk lag, hela laget ej start, byt variant per sträcka.
- Omstart: flyttad tid räknas om, flygande omstart (ledarens växling + gräns), klassynk under lås per klass, SOFT TR 5.8.2 som förval.
- Rättvis gaffling (utjämnad/fulgaffling) med kontroll per lag i lagvyn; funktionärsvy för omstarter; radio, Live, speaker och vägval för sträcklöpare; 30 sträckor.
- Tester: domän `relay-steg47`, integration `adr-0174-stafett` (25 × 300: avläsning 0,35 s, publik lista 0,25 s), Playwright `stafett-steg47`.
- Kvar: längd per variant (kräver steg 49:s variantlängd). Två Playwright-test behöver sex timmar av dygnet: tävlingen läggs i New York-tid när det inte ryms i Stockholm.
### 2026-10-25 – Steg 49: gafflingar som struktur och bild (ADR-0175)
- Domän `course-forking.ts`: enkel gaffling och fjäril (Purple Pen fork/loop) i följd, varianter med OCAD/Purple Pen-koder, härledning ur banfilens varianter, graf, rättvisa per gafflingssätt (Utjämnad/Fulgaffling, stoppar aldrig), längd ur lägen; `buildLegSplitTable` (sträcktider per kontrollpar).
- Migration 0023: `course_version.forking`, `course.forking_mode`, start/mål-lägen, `course_variant.length_meters`, `control.latitude/longitude`. Redigera bana tar en struktur: löparna behåller kontrollföljden under ny kod, försvunna får ny variant genom fördelningen; omräkning i samma transaktion.
- Banor: bilden (SVG) med anmälda/avlästa per gren, Gafflingssätt, längd och skillnad per variant, "Gaffla banan", "Redigera gafflingar" (klick på kontroll/sträcka i bilden, fält per alternativ, varianterna direkt), "Gör om till struktur".
- Publikt: "Visa gafflingar" i resultatlistan och på deltagarsidan; sträcktidsanalysen per sträcka (förval) eller per variant; banan på vägvalskartan.
- Tester: domän `course-forking`, `split-table`; iof-xml `parser`; webb `forking-diagram`; integration `steg-49-gafflingsstruktur`, `adr-0171-map-routes`; Playwright `gafflingsbild` (ny), `gafflingar`, `stafett`, `listor`, `strackanalys`.
- Kvar: gaffling inuti fjäril går inte att bygga; banan ritas inte på en egen karta i arbetsytan.

### 2026-10-25 – Steg 44: rättelser efter genomlysningen (stopp och fest)
- Speakern: strukna löpare filtreras i urvalet av de 25 senaste (gav 500). Migratorn bokför per tagg (ny kolumn `tag`; äldre rader matchas på `when` eller hash och får taggen), kör varje saknad migration i journalordning oavsett `when`; journalens `idx` är nu 0..n (0014–0018 numrerades om).
- Manuella beslut följer med vid omräkning (banredigering, starttid, lottning): beslutet tas bort och läggs på nytt ovanpå den nya tekniska revisionen (`carryManualDecisions`), med samma innehåll (manuell tid: måltiden står kvar, starten följer den kända starten). Godkännande som inte behövs längre tas bara bort. "N löpare har manuella beslut" i banändringens besked. Placeringar och "Resultaten är klara" fungerar efter banredigering (motor #2 och #8).
- Fest: `card_readout.simulated` (0019, ifylld ur råmeddelandet); övningsstationens köp räknas inte i summeringen, CSV eller fest-sidan, bardisken varnar. "Ta bort incheckning/utcheckning" (admin, `party_presence_void`, auditpost); samma målstämpling checkar inte ut igen. Personalens läge gäller en utläsning. Dubbelstämpling mot senast räknade köpet (0/4/8/12 s → 2 köp). Självregistrering på en pinne med köp avvisas ("gå till bardisken"). Namnrutan 20 s med kö.
- Tester: domän `decision-carry`, `party`; webb `party`; integration `steg-44-migrator`, `speaker-board`, `adr-0169-course-edit`, `administrator-start-time`, `entry-changes`, `steg-40-fest`, `steg-41-sjalvregistrering`; `migration-journal`. Verifierat: lint, typecheck, test, test:integration (340, med `--testTimeout=60000`), build, Playwright `fest`, `sjalvregistrering`, `redigera-bana`, `manuellt`, `lottning`, `avslut`.
- Beslut utan avläsning (manuell tid för tappad bricka, brutit, disk) läggs på nytt när de bygger på ett äldre underlag; i en klass med lottad start följer den manuella tidens start den nya starttiden.
- Risk: "Ta bort in-/utcheckning" är bara för admin (som ångra köp). `notRecalculatedCount` blir alltid 0 och kan tas bort ur kontrakten. Integrationstester med 5 s-gräns faller under last (tre agenter samtidigt).

### 2026-10-25 – Steg 45: rättelser efter genomlysningen (avläsning, regler, drift)
- Avläsningskön: 400/404/409 skickas om en och en och hålls åt sidan ("Försök igen"), 429 väntar; resten av kön går. Stationsklocka > 6 h fel: datorns klocka (clockSource device) och besked.
- Otolkade avläsningar (SiTimeError): råramarna skickas till `uninterpreted-readouts` (råmeddelande, parser_status uninterpreted), "Ladda ner listan"; Avläsning → "Otolkade avläsningar" läser om med datorns klocka eller angiven tid (ny avläsning, okänd bricka under Okända brickor).
- Regler: rättad starttid/manuell tid efter tidsjustering (`preparedReadoutTimes`); omräkning tar aldrig en avläsning som någon annans resultat bygger på (NO_READOUT); "Beslut att se över" (deltagarkort, kopplingskvitto, Efterarbete) när ett beslut döljer en senare avläsning; station ALL = alla enheter; disk/utom tävlan ovanpå manuell tid; utom tävlan på rogaining.
- Migration 0020 (station ALL, index card_readout(race_id, read_at)). Drift: backup varje timme 08–23 (48 + dagsbackup, atomärt), `sh /backup.sh dump`, scp, återställning, misslyckad migrering, build före up -d, swap, loggstorlek.
- Tester: webb `readout`, `clock`, `failed-readouts`, `decision-review`; domän `station-corrections`, `decision-review`, `manual-decision`, `rogaining`; integration `steg-45-rattelser`, `steg-31-lanad-bricka`, `entry-status-times`.
- Motor 0.6.0: vid lika många matchade kontroller väljs stämplingar mellan start och mål (oröjd bricka); "Godkänd, men inga sträcktider" i avläsningens besked.
- Kvar: otolkade avläsningar stoppar inte "Resultaten är klara"; varningen för godkänt utan sträcktider finns bara på avläsningssidan.

### 2026-10-25 – Steg 46: rättelser efter genomlysningen, säkerhet och integritet
- Huvuden: nosniff, Referrer-Policy och X-Frame-Options DENY på alla svar (`next.config.ts`); strikt CSP med nonce på Next-sidorna (`src/proxy.ts`, `lib/content-security-policy.ts`, rotlayouten renderar vid förfrågan); avläsningen/bardisken får serial/usb på `/admin/{id}/readout` och `/readout/`. Inga sidor bäddas in, så inga undantag. Playwright `sakerhetshuvuden` läser de riktiga huvudena.
- Fest: "Visa namn på den publika sidan" av för nya fester (`partyShowsPublicNames`); formuläret och fest-sidan säger "Dina köp visas med ditt visningsnamn på den här sidan." när namnen visas.
- /integritet och /om: fest, självregistrering och IP-hash, bricknummer i startlistan, live och sträcktider, noindex, lagring och radering.
- Tävling: självregistrerade märks "självreg." i den publika startlistan (enklast och syns direkt; att vänta på bekräftelse kräver ett nytt flöde), 100 per tävling och dygn, "Stryk alla självregistrerade som inte läst ut" under Anmälda (förhandsvisning, auditpost per deltagare, idempotent).
- Spärrar: HMAC med `OTID_THROTTLE_SECRET` (reserv `DATABASE_URL`, inget behöver läggas till i drift), rader äldre än två dygn rensas vid skrivning; inloggningen spärras också per IP (30 fel/15 min). Spärren per e-post var redan tidsbegränsad (15 min).
- Bardiskens namn och klubb normaliseras; hjälpen och Personer med behörighet säger att funktionären ser fullt namn och kan ladda ner CSV.
- Tester: domän `party-public-names`, integration `steg-46-sakerhet` (+ `steg-41` med namn på), Playwright `sakerhetshuvuden`, `sjalvregistrering-tavling`, `fest`, `sjalvregistrering`.

### 2026-10-24 – Steg 42: fest – Eventor-nyckel, kvällens sträcktider och QR-skylt
- Fest-typen visar Eventor-nyckeln och löpardatabasen under Inställningar (utan tävlingsval och import).
- "Kvällens sträcktider" (`#stracktider`) på `/fest/{kod}`: en rad per gäst med köp (flest först, vid lika tidigaste första köpet), In, varje köp ("21:14 Margarita" med färgprick per grupp/vara), Mål och "+18:30" sedan förra händelsen; Totalt = antal köp och tid från incheckning (eller första köpet) till utcheckning (eller senaste köpet). Bara köp som räknas (`partyLedger`: start, dubbelstämpling, ångrade bort). Rullar i sidled med namnet fast; var 10:e sekund.
- Namn bara visningsnamnet via JavaScript; namn av ger "Gäst N" (numrerade efter när gästen först syntes). Kontraktet `splits` är strikt (bara `guestNumber`, valfritt `name`, tider, varunamn, grupp); `superRefine` avvisar namn när namnvisning är av.
- Raden under rubriken: "Registrera din pinne" utfällbar (knapp med aria-expanded, stängd, bara när självregistreringen är öppen), länk "Kvällens sträcktider" och tre rader om hur man betalar (i18n).
- QR-skylt `/fest/{kod}/qr` (A4 stående, @page, 100 %): rubrik och logga i festens utseende, QR till `/fest/{kod}`, adressen och hur man betalar, inga namn; samma grind, X-Robots-Tag och robots-meta. "Skriv ut QR-skylt" i fest-arbetsytan.
- Tester: domän `party` (sträcktider, sortering, Gäst N), webb `party-splits`, integration `steg-40-fest` (steg 42, båda namnlägena utan bricka/fullt namn/belopp), Playwright `fest` och `sjalvregistrering`. Verifierat: lint, typecheck, test, test:integration (330), build. Skärmbilder granskade på 390 och 1280 px.
- Risk: "Summan dras från ditt klubbkonto" är ett antagande i texten (`party-public-sv.ts`); ändra om betalningen sker på annat sätt. Ett köp efter utcheckningen står före Mål-kolumnen.

### 2026-10-24 – Steg 41: självregistrering på tävlingsdagen
- "Tillåt självregistrering på tävlingsdagen" (`race.self_registration`, migration 0018, av som standard): sparas via Inställningarnas anrop med auditpost; i fest-arbetsytan och under Inställningar (inte stafett).
- "Registrera din pinne" på `/fest/{kod}` och `/t/{kod}` utan inloggning (`/api/public/races/{id}/self-registration`, publika grinden + tjänstens egen kontroll: på, publicerad, tävlingsdagen i tävlingens tidszon; en fest även natten efter till kl 06). Exakt Origin, 4 KiB-body, spärr 20 per 10 min per IP (hashad) och 300 per dygn per tävling, dolt fält som fälla, normaliserade namn (60/80 tecken), auditpost med källa PUBLIC_SELF_REGISTRATION utan IP.
- Upptagen bricka (aktiv koppling eller festgäst med namn) avvisas, inget skrivs över. Fest: gästen namnges (även en okänd avläsning), bardisken känner igen brickan vid nästa hämtning (5 s). Andra typer: ny deltagare i vald klass med brickan; en okänd avläsning bedöms direkt (UNKNOWN_READOUT_RESOLUTION).
- "Självregistrerad" i deltagarlistan och gästlistan; festen har "Koppla bort pinnen" (admin, auditpost). Deltagare ändras och stryks som vanligt.
- Fest: visningsnamn (smeknamn, högst 40 tecken, förval förnamn + efternamnets första bokstav) i formuläret, bardiskens namnruta och arbetsytan; den publika sidan, det publika API:et och kiosken visar bara visningsnamnet. Arbetsytan och CSV har fullt namn och visningsnamn i egna kolumner.
- Tester: domän `party` (visningsnamn), integration `steg-41-sjalvregistrering` (6), `steg-40-fest` (visningsnamn publikt), Playwright `sjalvregistrering`. Verifierat: lint, typecheck, test, test:integration, build, Playwright `sjalvregistrering`, `fest`, `publikt`. Skärmbilder granskade på 390 och 1280 px.
- Utseendet "Centrum OK 20 år" (förinställningens röda som huvudfärg, `partyLook`): rubriker och stora siffror i Poppins Bold (`@fontsource/poppins` 5.2.7, SIL OFL, självhostad, bara 700 latin/latin-ext), centrumröd #AE1917 i rubrikband och kortens rubrikrader, grönt #62C83A bara i staplar och dekor, mörkgrön #2E7D18 för grön text, #F2F2F2 med vita kort, röd topplist på kioskens bekräftelse. Kontrast mätt (vit på rött 7,1:1, rött på vitt 7,1:1, mörkgrönt 5,2:1/4,6:1). Andra fester och tävlingssidor oförändrade. Playwright `fest` kontrollerar Poppins.
- Risk: spärren per IP slår till om många gäster delar lokalens wifi (20 per 10 min). Löpardatabasens förslag i bardiskens namnruta visar fortfarande fulla namn när man söker.

### 2026-10-24 – Steg 40: fest-läge med bardisk (Centrum OK 20 år)
- Tävlingstypen "Fest" (PARTY, migration 0016): delarna Fest, Publicera och Inställningar. Varor = kontrollenheter med kod, namn och pris (öre, prishistorik så att gamla köp behåller priset). Köpen räknas fram ur avläsningarnas stämplingar (`domain/party.ts`): varukod efter festens start, samma stämpling som läses ut igen ger ett köp, samma kod igen är ett nytt köp men inom "Dubbelstämpling inom (sekunder)" (förval 5) ett. Startstämpling checkar in, målstämpling checkar ut; bardiskens in-/utcheckning är egna rader (idempotenta på enhet + löpnummer). Ångra köp är en ny rad med orsak och auditpost. Gäst = egen tabell bricka → namn per fest (ingen entry: festen har inga klasser eller banor och ingen bedömning).
- Bardisken = avläsningssidan för en fest (samma station, Web Serial/WebUSB, automatisk anslutning, ljud, avläsningskö): ett fönster i automatiskt läge (första utläsningen "Välkommen", sedan nya köp och kvällens summa, "Inga nya köp" med neutral ton, mål = "Utcheckad"). Okänd bricka: namnruta med förslag ur löpardatabasen och kvällens gäster; exakt brickträff sparas direkt ("Inte du? Ändra"). In-/utcheckning och namn köas i IndexedDB (`otid-party`). "Personal" (bekräftelse, 30 s) har Checka in, Köp/verifiera och Checka ut, stationsknappar och länkar. Hela skärmen.
- Arbetsytan: start, dubbelstämpling, namn publikt, utseende (förinställning Centrum OK 20 år, logga PNG/JPEG ≤ 1 MB), varor, köp med summa per person, in-/utcheckade, varning för nästan full SI5/SI8/SI9, ångra (admin), CSV (UTF-8 med BOM, semikolon). Funktionären köper, sätter namn och checkar ut men ändrar inte varor och ångrar inte.
- Publik sida `/fest/{kod}` (från `/t/{kod}`): siffror, vad som säljer bäst, köp per kvart, senaste köpen, rolig statistik; namn bara via JavaScript, belopp och bricka aldrig. X-Robots-Tag (next.config), robots-meta och robots.txt bara för `/fest/` och `/api/public/parties/`.
- Förinställningen "Centrum OK 20 år" (rubrik Jubileumsbaren, röd/grön, prislistan 31–38 läggs till efter bekräftelse om koden saknas), grupp per vara (migration 0017, "Drinkar totalt") och "Skyltar till enheterna" (etiketter 45 × 30/60 × 35/90 × 45 mm, A4, 100 % skala).
- Tester: domän `party` (14), webb `party` och `help-sv`, integration `steg-40-fest` (5), Playwright `fest`. Verifierat: lint, typecheck, test, test:integration (323), build, Playwright `fest`, `traningskvall`, `tavlingstyper`, `avlasaren`, `hjalp`. Skärmbilder granskade på 390 och 1280 px.
- Risk: provat bara med övningsstationen, inte med riktig station och SIAC på plattan. Gamla stämplingar på oröjda brickor kan fylla SI5/SI8 (30) – ha en töm-enhet vid ingången.

### 2026-10-21 – Steg 38: avsluta tävlingen
- Rotorsak H12: fastställandet frös bara beslut i en fast lista; manuell tid, godkända kontroller och rättad tid (revision utan avläsning) föll igenom till "kan inte kontrolleras" (`INVALID_RESULT_REVISION`). Med omläsning (steg 36) ligger ett sådant beslut kvar ovanpå. Nu fryses alla beslut (`frozenManualDecisionCauseSchema`).
- Hinder per löpare: "Resultaten är klara" listar vem (t.ex. "H21: Dan Borta har inget resultat …") med "Öppna" till deltagarkortet.
- "Bekräfta felstämplad" (valfri orsak) och "Ta bort bekräftelsen": beslut som revision (MANUAL_MISPUNCH_CONFIRMATION, migration 0015) med auditpost, ligger kvar över ny avläsning och omräkning. Bekräftade (och manuell tid som felstämplad) räknas inte som att titta på; obekräftade stoppar inte, "N felstämplade är inte bekräftade" visas som information.
- Brutit, disk, utom tävlan och deltog utan tid behåller avläsningens start och sträcktider fram till sista stämplade kontrollen (utan mål räknas de om ur avläsningen), utan tid och placering: publikt, sträcktidsanalys, deltagarkort och IOF (DidNotFinish/NotCompeting med SplitTime).
- Tester: domän `manual-decision`, kontrakt, `iof-xml`, integration `steg-38-avslut` (H12, hinder, bekräftelse, sträcktider, hel klubbtävling med IOF mot XSD via xmllint när IOF_XSD är satt), Playwright `avslut`. Verifierat: lint, typecheck, test, test:integration, build, Playwright `avslut`, `listor`, `statusval`, `manuellt`, `omlasning`.
- Risk: 0015 har `when` 1798819200000; steg 37:s 0013 måste få högre `when` om den slås ihop efter att 0015 körts (se steg 36).

### 2026-10-21 – Steg 37: Om O-Tid, kontakt och hjälp
- `/om` (utan inloggning): vad O-Tid är, beta och gratis, hur det är gjort (Joel Berring med AI-stöd, Next.js/TypeScript, PostgreSQL, egen server), elva tekniska funktioner kontrollerade mot koden (bricktyperna med förbehåll: inte alla provade i skarpt läge), kontakt och skapa konto.
- Sidfoten "O-Tid · beta · Frågor: otid@berring.se · Om O-Tid · Personuppgifter" på publika sidor (layouten) och längst ned i arbetsytan (länkar i ny flik), dold vid utskrift; avläsningssidan har ingen. Adressen bara i `lib/contact.ts`; `OTID_CONTACT_EMAIL` har den som förval (/integritet visar alltid en adress).
- "Hjälp" i arbetsytans toppbalk (även på 390 px), på Mina tävlingar och på avläsningssidan: modal `<dialog>` vid högra kanten med sökfält, stegets artiklar först, sedan resten; Esc (även med text i fältet) och Stäng stänger, fokus tillbaka till knappen. 15 artiklar i `i18n/help-sv.ts` med vyer.
- Tester: `help-sv` (varje citerad knapp/väg finns som UI-text, 3–8 meningar, varje vy har artiklar), `help-search` (å/ä/ö, versaler, alla ord, vyn först), Playwright `hjalp`. Verifierat: lint, typecheck, test, build, Playwright `hjalp`, `arbetsyta`, `publikt`, `avlasaren`, `traningskvall`, `funktionarer`. Skärmbilder granskade på 390 och 1280 px.
- Risk: hjälptexterna måste hållas i takt med UI; testet fångar ändrade knappnamn men inte ändrat beteende.

### 2026-10-21 – Steg 39: lokalt stoppade avläsningar avkodas på nytt
- Natt-KM: SIAC-avläsningarna med skräpstämplingar (kod 0 ur block 1) stoppades i webbläsaren (LOCAL_INVALID) och kom aldrig till servern, så "Läs om från rådata" hade inget att läsa om. `requeueLocallyInvalid` avkodar nu sådana avläsningar på nytt från råramarna (`decodeRecordedFrames`, samma tidsreferens som vid avläsningen och tävlingens tidszon) och lägger dem i kön med samma löpnummer. Går ramarna inte ihop ligger avläsningen kvar; inga stämplingar hittas på.
- Tester: `readout/requeue` (3, med kvällens riktiga block, bricknumret utbytt). Verifierat: lint, typecheck, webbtester.

### 2026-10-20 – Steg 36: läs om avläsningar från rådata
- Avläsning → "Läs om avläsningar från rådata" (bara admin): varje deltagares avläsning (den resultatet bygger på) avkodas på nytt från originalets råramar (`sportident` `decodeRecordedFrames`) med stationens klocka/offset ur nyttolasten och tävlingens tidszon. Övningsstationen och simulatorn läses inte om; ej start hoppas över. Listan visar bara ändrade (bricka, deltagare, stämplingar/status/tid före → efter) och "går inte att läsa om" (fel CRC, saknade block); "Spara och räkna om" för valda, konflikt om något ändrats.
- Lagring: nytt råmeddelande (`transport` `sportident-reread`, enheten = originalets råmeddelande, nyttolasten pekar på originalet och avläsningen den ersätter), ny `card_readout` (lästid + 1 ms så att den blir brickans senaste) och revision med orsaken READOUT_REREAD (migration 0014) för samma deltagare (`evaluateReadoutForEntry`); auditpost per omläsning. Original och råmeddelanden ändras aldrig.
- Manuella beslut ligger kvar ovanpå och visas i förhandsbeskedet med hur de tas bort. Deltagarkortet: "Avläsningen kan läsas om från rådata" + "Läs om".
- Tester: `sportident` `recorded` (5), integration `steg-36-omlasning` (natt-KM 14 stämplingar, OK 53:23; rätt avläst och övning listas inte; trasiga ramar; manuellt beslut; behörighet; idempotens), Playwright `omlasning`.
- Risk: migratorn hoppar över en migration med lägre `when` än den senast körda; slås steg 35:s 0013 ihop efter att 0014 körts måste 0013 få ett högre `when` (testdatabaserna här saknade 0009 av just det skälet och skapades om).

### 2026-10-20 – Steg 36 (brådskande): nio ramar från station som skickar alla åtta block
- Efter steg 34 gav en BSM8 som skickar alla åtta block detektering + 8 block = 9 råramar, men avläsningens schema tillät högst 8: avläsningen markerades "rejected" (`LOCAL_INVALID`) i webbläsaren och skickades aldrig. Schemat tillåter nu 12 (detektering, åtta block, uttagsram, marginal); samma schema används vid mottagningen.
- Avläsningssidan prövar vid laddning om lokalt avvisade avläsningar mot det nuvarande schemat; giltiga läggs tillbaka i kön som väntande med samma löpnummer (servern har aldrig sett det) och skickas som vanligt.
- Tester: `readout/requeue` (omprövning, samma löpnummer, skickas), integration `steg-36-nio-ramar` (9 och 12 ramar tas emot oförändrade, 13 avvisas).

### 2026-10-20 – Steg 35 (del 3, steg 35 klart): ljud vid avläsning
- Avläsningssidan: tre korta toner i C-dur uppåt (0,3 s) vid Godkänd och tre i a-moll nedåt vid felstämplat, maxtid, okänd bricka och fel i avläsningen (Web Audio, OscillatorNode, ingen ljudfil). Ett ljud per besked; övningsstationen låter också.
- AudioContext skapas/återupptas vid första klicket (anslutknapparna eller var som helst på sidan); efter en automatisk anslutning utan klick visas "Ljudet hörs när du har klickat någonstans på sidan."
- Kryssrutan "Ljud vid avläsning" (på som standard, sparas i localStorage med try/catch).
- Tester: `sound` (dur/moll, längd, val, lagring), Playwright `avlasaren` (tonerna fångas vid övningsstationens avläsningar, avslaget ljud ger inga toner, valet står kvar efter omladdning). Verifierat för hela steget: lint, typecheck, test, test:integration, build, Playwright `statusval`, `avlasaren`, `traningskvall`, `manuellt`, `listor`, `live`, `lanad-bricka`, `lopardatabas`. Ljudet på riktig läsplatta provas av ägaren.

### 2026-10-20 – Steg 35 (del 2): avläsaren ansluter själv
- Avläsningssidan sparar en lyckad anslutning (Web Serial eller WebUSB, tillverkare/produkt/serienummer, localStorage) och ansluter själv när sidan öppnas (när tävlingsdatan är inläst) och vid `connect` (stationen sätts i), till en redan godkänd enhet (`getPorts`/`getDevices`, CP210x). Flera godkända: den senast använda, annars får funktionären välja. "Ansluter automatiskt till stationen …" och "Sluta ansluta automatiskt"; manuell frånkoppling pausar till nästa gång sidan öppnas. Befintliga `connectPort`/`BAUD_RATES` återanvänds.
- Tips om en egen flik; länkarna Hantera tävling och Resultat öppnas i en ny flik.
- Tester: `station-memory` (val av enhet, lagring, blockerad lagring), Playwright `avlasaren` (tomma listor, utan Web Serial/WebUSB). Måste provas av ägaren med riktig station på dator och läsplatta.

### 2026-10-20 – Steg 35 (del 1): fler statusval
- Deltagarkortets "Ändra status" (det enda stället där en löpares status sätts; kontrollvyn, deltagarlistan och kvar i skogen öppnar kortet, avläsningssidan och starten sätter ingen status utom ej start) har nu Ej start, Brutit, Diskvalificera, Utom tävlan och Deltog utan tid även utan avläsning. "Öppna" i kontrollvyns Kvar i skogen.
- Domänen: disk och utom tävlan utan avläsning ger ett utfall utan tid; "Deltog utan tid" (NT, tidigare "utan tidtagning") går med och utan avläsning och har aldrig tid. Ingen migration behövdes (orsakerna och databasens villkor fanns).
- NT visas "Deltog" sist i klassen (efter ej start), exporteras och fastställs som IOF NotCompeting utan tid (Finished betyder "inte kontrollerad"). Ett gällande beslut utan avläsning räknas som i mål i kvar i skogen.
- Tester: domän `manual-decision`, integration `steg-35-fler-status` (+ ändrade `entry-status-overlays`, `entry-status-did-not-start`), Playwright `statusval`. Verifierat: lint, typecheck, test, test:integration, build, Playwright `statusval`, `traningskvall`, `manuellt`, `listor`, `live`.

### 2026-10-20 – Steg 34: SIAC från station som skickar alla åtta block (fel på natt-KM)
- Natt-KM: två SIAC blev felstämplade med "gamla stämplingar" fast brickan var tömd. Råloggen från en av brickorna (avläst i efterhand) visade att BSM8:an skickade block 0–7 för "alla block"; O-Tid tog de fem första som 0, 4, 5, 6, 7 och läste block 1 (brickans inställningar) som stämplingar.
- `sportident`: blocken placeras efter blocknumret i svaret (`cardImageBlocks`), läsningen av "alla block" (SI6, SI10/11/SIAC) slutar vid block 7 eller åtta svar, och tas brickan ur efter stämplingsblocken räcker det som kom. `decodeCard` vägrar en ofullständig bild i stället för att tyst ta färre stämplingar. Falska stationen kan skicka alla åtta block (`eightBlocks`).
- Tester: `siac-eight-blocks` (7, med kvällens riktiga block, bricknumret utbytt), `decode`. Verifierat: lint, typecheck, test, build, Playwright `traningskvall`, `lanad-bricka`.
- Kvällens två avläsningar: läs om brickan (otömd) efter uppdateringen, eller ange tiden manuellt.

### 2026-10-20 – Steg 33 (tillägg): uppdatera startlistan löpande
- Start → Publicera startlistan: "Uppdatera startlistan löpande" (av som standard, migration 0012, sparas via Inställningarnas anrop med auditpost). På: `getPublicStartList` ger samma projektion som en publicering men läst nu (`live: true`, samma strikta kontrakt och grind, bricka bara när den visas, ingen IOF-länk); sidan hämtar om var femte sekund. Statusraden säger "Uppdateras löpande", Publicera/Avpublicera döljs.
- Av igen: besökare ser den senast publicerade listan (ingen ny ögonblicksbild skapas); statusraden visar då "har ändrats sedan dess" och Publicera.
- Typer utan Start-steg (Träning, Rogaining) har ingen publicerad startlista och därmed inget val.
- Tester: integration `steg-33-tavlingsinfo` (ny anmäld syns bara när valet är på), Playwright `tavlingsinfo`.

### 2026-10-20 – Steg 33: tävlingsinfo och bricka i startlistan
- Inställningar → "Information till löparna": "Kort info om tävlingen" (ren text, högst 1000 tecken, radbrytningar behålls), "Första start" (TT:MM, bara information: påverkar inte tävlingsklocka, lottning eller starttider) och "Visa bricknummer i den publika startlistan" (på som standard). Migration 0011 (kolumner på `race`, på även för befintliga tävlingar), auditpost i `RACE_SETTINGS_SAVED_BY_ADMIN`.
- Infon visas överst på tävlingssidan (/t/{kod}) och i arbetsytans Start-steg (Avläsning för typer utan Start), för admin och funktionärer. Tomma fält visas inte.
- Den publicerade startlistan har aktiv bricka i ögonblicksbilden; `getPublicStartList` tar bort den när inställningen är av (gäller direkt, även redan publicerad lista). En ändrad bricka syns efter ny publicering. Live, resultat, speaker och IOF-exporten är oförändrade.
- Tester: kontrakt `start-list-publication`, web `lists`/`public-start-list-route`, integration `steg-33-tavlingsinfo` (+ `steg-28` lägger till kolumnerna för den gamla databasen), Playwright `tavlingsinfo`, `listor` (publika listan visar nu bricka).

### 2026-10-20 – Steg 32: avläsning på läsplatta (Android) via WebUSB
- Chrome på Android ser inte stationens CP210x-chip som serieport ("Inga kompatibla enheter hittades"). `device-transport/src/webusb-cp210x-port.ts`: CP210x över WebUSB med samma styrkommandon som Linux `cp210x.c` (IFC_ENABLE, SET_BAUDRATE, SET_LINE_CTL 8N1, SET_MHS DTR/RTS, PURGE), samma gränssnitt som en Web Serial-port, så att `WebSerialTransport` och avläsningen är oförändrade.
- Avläsningssidan: "Anslut via USB (läsplatta)" på Android (eller utan Web Serial); en annan app som håller stationen ger ett tydligt besked. `usb=(self)` i avläsningens Permissions-Policy.
- Tester: `webusb-cp210x-port` (4). Verifierat: lint, typecheck, test, build, Playwright `traningskvall`. Måste provas av ägaren på riktig platta med riktig station (iPhone/iPad går inte: ingen WebUSB i iOS).

### 2026-10-20 – Steg 31 del A: rättningar för hela tävlingen (del A klar)
- A1: Avläsning → Rättningar för hela tävlingen → "Justera tid för en station" (Start, Mål eller Kontroll med kod, Tidigare/Senare, minuter och sekunder, Varför) → "Visa vad som händer" → "Spara och räkna om". Migration 0009 (`race_station_correction`, bara borttagning får skrivas), domänens `prepareReadoutForEvaluation` är enda stället där justeringen läggs på brickans tider, paketet till avläsningen har justeringarna, underlagshashen tar med aktiva rättningar (oförändrad utan). Manuellt rättad tid räknas inte om (antal i beskedet). "Ta bort" räknar om tillbaka; borttagna står kvar som historik.
- A2: "Kontroll ur funktion" (kod, Varför): koden krävs inte på någon bana, även gafflade; stämplingen ger ingen sträcktid och sträckan räknas från kontrollen före; deltagarkortets sträcktider visar "Ur funktion", IOF-exporten utelämnar kontrollen. Ersätter den gamla strykningen per klass (`class-control-neutralization.ts`, utan gränssnitt): kod, tabell och `result_revision.control_neutralization_id` borttagna i 0009 (underlagshashen oförändrad). Banredigeringen fungerar som förut.
- A3: Start → Startlistan → "Flytta starttider" (Klass, Senare/Tidigare, Minuter, Varför): alla tilldelade tider i en klass med minutstart (även gemensam start; inte stafett) flyttas och de avlästa räknas om; beskedet påminner om att publicera startlistan igen. Ångra = flytta tillbaka. Lottningens vakanta tider (oföränderliga) flyttas inte.
- A4 (motor 0.5.0): oröjd bricka – stämplingar > 12 h före avläsningen och kontrollstämplingar > 10 min före clear/check räknas inte (bara den inledande följden i brickans minne; check efter startstämplingen används inte; start/mål bara 12 h-regeln). `card_readout` får `check_punched_at`/`clear_punched_at` (ifyllda från rådatan). Avläsningens besked och deltagarkortet: "N gamla stämplingar räknades inte (brickan var inte tömd)", även vid godkänt; stämplingslistan märker dem "före check, räknas inte".
- A5: Resultat → Efterarbete → "Räkna om hela tävlingen" → "Visa vad som händer" (antal, statusbyten) → "Spara och räkna om".
- Tester: domän `station-corrections` (11), `evaluate-card-readout`/`course-variants`/`course-edit` (ur funktion), integration `steg-31-tavlingsdag`, `adr-0169-result-basis`, Playwright `tavlingsdag-rattningar`, `redigera-bana`, `traningskvall`.

### 2026-10-20 – Steg 31 B4: samma bricka hos två löpare
- `application/src/card-reuse.ts`: har brickans deltagare redan ett resultat från en annan avläsning av brickan och brickan använts i ett nytt lopp efter den avläsningens mål (start- eller kontrollstämpling senare), sparas ingen revision; avläsningen blir okänd. Exakt dubblett och samma lopp med ändrad tid fungerar som förut.
- Kontrollvyn → Okända brickor: "Brickan har redan lästs ut för X … lånad bricka?"; koppla till annan anmäld eller direktanmäl (brickan flyttas, X:s resultat står kvar) eller välj X ("samma löpare", den nya avläsningen gäller). Avläsningssidan: samma varning (säker vid en tidigare annorlunda avläsning här eller när servern svarat okänd, annars "Servern kontrollerar"), anmälan/koppling med `borrowedCard`, och "Det är samma löpare – använd den nya avläsningen". Utan valet skrivs den förstes resultat aldrig över.
- Omräkning (deltagare, klass, banändring, klassbyte) utgår från deltagarens egen avläsning och bedömer den för just deltagaren (`evaluateReadoutForEntry`), utom när deltagaren fått en annan bricka sedan dess.
- Tester: integration `steg-31-lanad-bricka` (4) och banändring i `adr-0169-course-edit`, avläsning `already-read-out` (2), Playwright `lanad-bricka`.

### 2026-10-20 – Steg 31 B5: avläsningens robusthet
- Avläsningssidan: tid som inte går att placera med stationens klocka prövas med datorns; går det inte heller sparas bricka, tid och råramar i webbläsaren och visas under "Brickor som inte kunde tolkas". En avläsning som ger serverfel (5xx) skickas om en och en och hålls sedan åt sidan ("N avläsningar kunde inte skickas" + "Försök igen") så att resten av kön går fram. Övningsstationen varnar på tävlingsdagen. Deltagarkortet: "Räkna om från avläsningen" även utan resultat.
- Tester: `readout.test` (kön vid serverfel), `participant-status-choices`, Playwright `manuellt` (varningen) och `traningskvall`.

### 2026-10-20 – Steg 31 B: nödlägen för en löpare (B1–B3)
- Domänen (`manual-decision.ts`, ny `manual-time.ts`, `entry-readout.ts`): beslut ligger på varandra som en stapel och följer med över senare avläsningar och omräkningar, även rättad mål- och starttid (förut ersattes de). Nya orsaker `MANUAL_TIME`, `MANUAL_CONTROL_APPROVAL`, deras återtaganden och `MANUAL_RESULT_REMOVED` (manuellt resultat utan avläsning borttaget), migration 0010. Nya beslut bygger på senaste tekniska bedömningen under besluten (inga återvändsgränder efter ett återtagande). Resultatmotorn är oförändrad.
- Deltagarkortet: "Ange tid manuellt" (måltid/starttid/löptid som klockslag, status, orsak, förhandsbesked "Löptid 45:00, godkänd."), "Godkänn saknade kontroller", "Ta bort manuell tid"/"Ta bort godkända kontroller", orsaken visas i kortet, "Manuell tid" i deltagarlistan. Brutit och ej start går utan avläsning; "Godkänn manuellt" kräver orsak.
- Tester: domän `manual-time` (10), integration `steg-31-manuellt` (3) och uppdaterade förväntningar (återvändsgränder borta), Playwright `manuellt`.

### 2026-10-20 – Steg 30: Live för publiken (steg 30 klart)
- `/t/{kod}/live` (länk från tävlingssidan och resultatlistans rubrik), `GET /api/public/races/{id}/live` bakom samma grind (`publicRaceAccess`, opublicerad/dold ger 404). `application/src/public-live.ts`: ren `projectPublicLive` över den publika resultatlistan, radiotiderna och när resultatet kom in (första avläsningen); kontraktet `public-live.ts` är strikt utan bricka, interna id:n, orsaker och strukna.
- Sidan: Senast i mål (namn, klubb, klass, tid, "1:a"; felstämplad som "✗ Felstämplad" utan placering), Ledare per klass med "▲ Ny ledare" i 5 min, radiopassager ("passerade Radio 1 6:12, 2:a"), "Uppdaterad 21:03:12" och lugnt besked utan nät, tomläge "Inga målgångar än – sidan uppdateras av sig själv". Uppdateras med resultatströmmen + hämtning var 5:e s (gemensam `usePublicRaceData`).
- Följ: ☆/★ vid löpare i Live och resultatlistan, klubb i "Per klubb" och "Följ en klubb" i Live; "Följer" överst. Bara `localStorage` (`lib/follow-store.ts`); fungerar inte lagringen gäller valet i minnet och en varning loggas.
- Tester: enhet `public-live-projection` (7), `follow-store` (3), `public-live-view` (3), `public-live` (2), listorna (stjärnor); integration `steg-30-live` (2); Playwright `live` (ny), `publikt` (Live bakom grinden).
- Verifierat: install (frozen), lint, typecheck, test, test:integration (70/290), build, Playwright `live`+`publikt`, `radio`+`traningskvall`, `listor` gröna (`live` föll en gång när radiodelen lästes in på nytt efter ifyllnad; testet fyller nu i tills formuläret håller värdena). Skärmbilder 1280/390 granskade (Följer smalare på bred skärm, klassetiketten i linje med ledaren).

### 2026-10-20 – Steg 29: löpardatabas från Eventor (steg 29 klart)
- Löpardatabas per Eventor-klubb (migration 0008, `runner_database*`), hämtad med tävlingens sparade nyckel (`cachedcompetitors` med klubbens och tillagda klubbars id, eller hela Sverige; `/api/organisations`) och ersatt i en transaktion; Inställningar → Eventor → Löpardatabasen: uppdatera, fler klubbar, "Ta med hela Sverige (stor hämtning)", radera. Bara admin uppdaterar/raderar; admin och funktionär får förslag; inget publikt (`/integritet`, `docs/security-privacy.md`). Dataminimering: födelseår, kön, klubb, bara SI-brickor; auditposten bara antal.
- Adapter: strömmande, härdad läsning element för element (`eventor/src/stream.ts`; gränser 32 MB klubbar, 256 MB hela landet, 5 min), IOF 3.0 CompetitorList och Eventors äldre OrganisationList (typ 1/2/3 = förbund/distrikt/klubb är vår tolkning; alla typer behålls).
- Avläsningspaketet: `runnerLookup` (egna och tillagda klubbars löpare, högst 10 000, egen klubb först, och klubbarna) och `readOutEntryIds`; hela landet söks på servern när nätet finns. Mätt: 10 000 löpare = 1,53 MB JSON; 40 000 löpare hämtas och sparas på 9 s.
- Okänd bricka (även offline): namn och klubb fylls i ur databasen, domänens `rankClassesByCourseFit` (gafflingarnas bästa-passning) förväljer klassen ("Passar H21 (Lång) …"), anmälda utan bricka eller utan avläsning i de klasserna föreslås överst ("Koppla brickan till Anna Ek"); kopplingen köas som direktanmälan (`target: "EXISTING_ENTRY"`, utfall `LINKED`, idempotent). Namnfält föreslår löpare och klubbfält klubbar, även i Ny deltagare; Eventors person- och klubb-id sparas på deltagaren för IOF-exporten. Övningsstationen kan läsa en bricka ur löpardatabasen.
- Tester: adapter `competitors` (10), domän `class-course-fit` (5), avläsning `runner-lookup` (4), integration `steg-29-lopardatabas` (6), route-behörighet, Playwright `lopardatabas`; falska Eventor svarar på de nya adresserna.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (69/288; `steg-28` läser nu migrationerna ur journalen), build, Playwright alla 20 specar gröna i sex grupper (ny `lopardatabas`; `tavlingsfunktioner` förväljer nu klassen); efter omförsök under last: `funktionarer`/`tavlingstyper` (speakern som tidigare), `traningskvall`, `gafflingar`; `radio`+`redigera-bana` omkörda efter att utvecklingsservern dödats (minnesbrist). Skärmbilder 1280/390 granskade (för bred förslagsknapp på 390 px rättad). Måste provas av ägaren mot riktiga Eventor: hela landets `cachedcompetitors` (storlek, tid) och `/api/organisations` (format och `OrganisationTypeId`).

### 2026-10-20 – Steg 28: vanlig PostgreSQL i stället för PostGIS (steg 28 klart)
- `postgres:17` (alla arkitekturer) i stället för `postgis/postgis:17-3.5` + `platform: linux/amd64` i dev-compose, drift-compose (db och backup) och CI. Samma PG 17 och PGDATA `/var/lib/postgresql/data`: befintlig volym används som den är. Efter `git pull`: säkerhetskopia, `docker compose up -d postgres` byter bild, datan finns kvar, `pnpm db:migrate` (README).
- `CREATE EXTENSION postgis` borttagen ur baslinjen (migratorn jämför `created_at`, inte innehåll, så körda databaser påverkas inte). 0007: `DROP EXTENSION IF EXISTS postgis` (utan CASCADE; inget använder PostGIS) och, bara vid glibc-byte (bullseye → trixie), REINDEX av tabellerna + `REFRESH COLLATION VERSION`.
- Provat på en kopia av en databas från main (PostGIS, 6 lopp/21 anmälda, sorteringsversion 2.31) med PostGIS-filerna borttagna från servern som i `postgres:17`: 0007 körs, data identisk (md5), inga varningar. Integration `steg-28-utan-postgis` (ny databas utan tillägg; uppgradering utan förlust).
- Playwright: `radio`, `listor`, `strackanalys`, `tavlingsfunktioner` kör tävlingen i `ongoingRaceTimeZone()` (Stockholm, men New York 23–02 i Stockholm) i stället för att falla efter midnatt; ingen klocka fryses, fungerar mot driften i CI. `docs/drift.md`: serveralternativ (Hetzner CX23/CAX11, Oracle Always Free, e2-micro, Cloudflare Tunnel) och DNS-exempel.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (68/282, utan PostGIS på servern), build, `docker compose config` (dev, prod), Playwright `radio`, `listor`, `strackanalys`, `tavlingsfunktioner` gröna både med tvingad New York-tid och i Stockholm, `traningskvall` grön (`tavlingsfunktioner` fick inget svar från klassändringens rutt vid kall utvecklingsserver: rutten värms nu i förväg, grön kall). Inte provat: riktig Docker-bild och ARM-server (ingen Docker här); CI-jobbet `production` är grinden.

### 2026-10-19 – Steg 27: rättelser efter första piloten (steg 27 klart)
- Brickans stämplingar: domänens `cardPunchList` (ordning, kod, tid, på banan/extra/utanför tävlingsdagen, check/start/mål, "från ons 14 okt", "ingen startstämpling") i deltagarkortet och kompakt i avläsningens besked för felstämplad/okänd bricka; aldrig publikt. "Inte avläst ännu" i stället för "publicerat resultat". "Ny klass" listar alla banor och läser in dem själv.
- Ta bort/stryk (migration 0006 `entry.struck_at`): utan resultatrevision tas deltagaren bort med `purgeRows` (lottad tid blir vakant); med revision stryks den – dold i alla listor, paketet, lottning, speaker, kvar i skogen, IOF och fastställande, bricka släppt, historik kvar. Ta bort klass/bana när inget hänger på dem, annars besked. Eventors "struken" ger fortfarande ej start.
- "Resultaten är klara" (0006 `race.official_result_finalization_id`): en knapp fastställer klasserna och loppet i en transaktion, listorna blir "Officiella resultat", IOF-filen laddas ner, "Gör resultaten preliminära igen" ångrar; klassvis under Avancerat. Rättat: OK med kontroll stämplad före start gick inte att frysa (500), saknat resultat gav också "ogiltigt resultat".
- "Exportera tävlingen" (Inställningar): JSON `otid-race-export` v1 med allt (`docs/export.md`). Mina tävlingar: idag/kommande först, sedan gångna. Varning vid gamla Eventor-namn, "(se drift-instruktionen)", tom tävlingslista i klartext, radiopollern väntar 20/40/60 s vid databasfel, Mac-drivrutin och stödmatris (SI9 `field-verified` för nummer/antal/tider) i `docs/sportident.md` och README.
- Tester: domän `card-punch-list` (5), webb (texter, ordning, Eventor-miljö, pollervänta), integration `steg-27-rattelser` (6; `steg-25-competition` använder nya knappen), Playwright `traningskvall` (stämplingar, ta bort/stryk, klass, bana), `listor` (Resultaten är klara/ångra, publikt Officiella), `kopiera` (Mina tävlingar).
- Verifierat: install (frozen), lint, typecheck, test, test:integration (67/280), build, Playwright alla 19 specar gröna i grupper; `radio`, `listor`, `strackanalys` och `tavlingsfunktioner` föll strax efter midnatt (tider "för 30–45 min sedan" hamnade på gårdagen) och gick igenom efter 01:00 (de två sista efter omförsök), `tavlingstyper` efter omförsök. Skärmbilder 1280/390 granskade; klubbvyns kolumner smalare på 390 px.
- Kvar: import av exportfilen (Idéer); ett lopp i ett arrangemang med flera lopp kan fortfarande inte bli "klart" (`MULTI_RACE_EVENT`); strykning går inte att ångra i ytan.

### 2026-10-19 – Steg 26: avancerad lottning (steg 26 klart)
- Lottning: enkla läget som förut; under "Avancerat" (öppnas själv när något avviker, sparas med lottningen i `race.start_draw_settings`) kryssa i alla/olottade klasser, startgrupp av de första 1–3 kontrollerna, max starter per minut totalt och per startfålla, sista start, startordning (upp/ned) och senare start per klass (klockslag eller minuter efter första start), seedning per löpare och ranking från CSV (bricka, annars namn och klubb).
- Domänen (`start-draw.ts`, `start-draw-order.ts`): befintliga tider rörs inte och nya läggs runt dem; gafflad klass hör till startgruppen om **någon** variant delar början (grupper slås ihop i kedja); fålla = samma första kontroll; vakanser räknas i taket, masstart som en start; senare start placeras först; seedade sist eller jämnt utspridda, bäst sist. Regelbrott blir varningar, aldrig fel.
- Förhandsvisningen: regelbrott med sista start som behövs, klasser som behåller sina tider, "Minut för minut" med nya tider märkta Ny, seedade märkta. Sparandet skriver tider, seedning och inställningar i en transaktion (befintlig väg med omräkning).
- Migration 0005 (`entry.seed_rank`, `race.start_draw_settings`). Lottningens anrop får större body (768 KiB; 4 KiB räckte bara till ~30 klasser).
- Tester: domän `start-draw-advanced` (16), integration `steg-26-lottning` (2), CSV-läsaren (3), kontrakt, Playwright `lottning-avancerad`.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (66/274), build, Playwright alla 19 specar gröna i fem grupper (ny `lottning-avancerad`); efter omförsök under last: `gafflingar`, `funktionarer`, `strackanalys` och `tavlingsfunktioner`. Skärmbilder 1280/390 granskade.
- Kvar: efteranmäld i lottad klass följer fortfarande första kontrollen (inte N kontroller eller taken). IOF-ranking (`Score`) inte gjord, bara CSV.

### 2026-10-19 – Steg 25: saknade tävlingsfunktioner (steg 25 klart)
- Minutstart: lottad tid gäller; startstämpling mer än 60 s (`START_PUNCH_TOLERANCE_MS`) från den ger varning i avläsningen, deltagarkortet och arbetsytans lista ("! Sen start"), aldrig publikt. Utan lottad tid används startstämplingen (notis). Motor 0.4.0.
- Direktanmälan av okänd bricka på avläsningssidan, även utan nät: egen kö i IndexedDB med egen idempotensnyckel (servern: `readout_registration`), beskedet bedöms om lokalt, anmälningar skickas före avläsningarna; servern kopplar okänd avläsning via bricknumret, "Brickan fanns redan anmäld som …" om någon hann före.
- Maxtid per klass (Klasser, kopieras): `OVERTIME/MAX_TIME_EXCEEDED` efter godkända, utan placering, IOF `OverTime`; inte rogaining. "Markera alla kvar i skogen som ej start" i Resultat: förhandsvisning, en bekräftelse, radio/avprickade listas som "Saknas i mål – kontrollera", idempotent.
- Banlängd/stigning från banfil och Banor ("Bana Lång · 4,2 km · 120 m"), kopieras. IOF-listor med Eventor-id för person/klubb, ControlCard (admin), Course och OverTime, validerade mot IOF 3.0 XSD. "Preliminära resultat"/"Officiella resultat (fastställda …)". Disk med valfri orsak (bara arrangören, publikt "Disk."). Hyrbricka: "HYRBRICKA – samla in" och "Lämna tillbaka hyrbrickan" på kvittot.
- Migration 0004 (maxtid, banlängd, Eventor-id, `result_revision.note`, `readout_registration`). Nya tester: domän (start/maxtid/kvar), integration `steg-25-*` (11), avläsningskön (8), Playwright `tavlingsfunktioner`.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (65/272), build, IOF-XML mot XSD, Playwright alla 18 specar gröna i fem grupper (ny `tavlingsfunktioner`; `gafflingar`/`listor` anpassade till Längd-kolumnen och tidig-start-varningen); efter omförsök under last: `funktionarer`, `radio`, `strackanalys`, `tavlingstyper` (speakern som tidigare) och `kopiera`.

### 2026-10-19 – Steg 24: enklare arbetsyta (steg 24 klart)
- Flöde: "Skapa tävling" går direkt till arbetsytan; tomlägen har en primärknapp (Ny bana, Ny deltagare, Lag). Ny deltagare i ett steg med Enter, raden "Anna Ek är anmäld i H21." och fokus tillbaka i Förnamn; minutstart utan tid före lottningen ("Lämna tomt – lottas senare", servern lottar in löparen). Tre deltagare: 13 → 6 klick.
- Låsning: bara en skrivning (`writingRef`) låser, och bara formuläret som sparas; läsningar avbryts av användaren, och läsningar som startar själva väntar på `operation.current`. Sidopanelen är aldrig inaktiv; "Slutför eller avbryt …" visas först vid försök att byta steg.
- Start: 1 Lottning, 2 Startlistan, 3 Publicera startlistan. Publicera bara i checklistan (länk från Inställningar). Avläsning läser in läget själv. "Flytta till kortare bana" och dess rutt/tjänst/kontrakt borttagna (tabellerna står kvar utan skrivare).
- Ord: startsätten bara i `i18n/start-rule-sv.ts`; jargong omskriven (avläsningssidan, import, Eventor, ROC-id, "Tävlingens namn" + "Etapp/lopp (valfritt)", tidszon under "Mer"); språkvakten förbjuder interna ord.
- Fältfel: `noValidate` och svenska fel per fält (`lib/form-validation.ts`, `Field error`), datum som ÅÅÅÅ-MM-DD (`DateInput`). Kompakt mobilhuvud med Meny, kompakta rader, numrerade steg, vanlig lottningstabell.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (63/261), build, Playwright alla 17 specar gröna i fem grupper (ny `arbetsyta`); efter omförsök under last: `lottning`, `traningskvall`, `listor`, `strackanalys` och speakerns "Senast i mål" i `funktionarer`/`tavlingstyper` som tidigare. Fler uppvärmda rutter i e2e.

### 2026-10-19 – Steg 23 (del 2): ett statusflöde, en session, ingen versionsgrind (steg 23 klart)
- Ett skrivställe: `appendResultRevision`/`evaluateAndStore` (`result-revisions.ts`) skriver alla revisioner. Ett statusflöde: `setEntryStatus` (beslutsunion med återta, idempotent på begärans id, `expectedRevision`) + domänens `applyManualDecision` ersätter de tolv besluts-/återtagandetjänsterna; en rutt `…/entries/[entryId]/status` i stället för 24 (migration 0001).
- En session: `requireRaceRole` på kontosessionen; `pairing_admin_*`, delegationer, kakor per tävling och capability-enumen borta, journalerna har `actor_account_id` (0002). "Öppna med mitt konto" borta; avläsningsskalet och demot använder kontosessionen.
- Ingen `expectedSnapshotVersion` i adminåtgärder; `race.snapshot_version` är bara paketversion via `bumpReadoutPackageVersion` (0003). En `security-policy.ts`, ett suffix `AsAdmin` (kontonivån utan suffix: `createOrganizerEvent`, `listMyEvents`; `copyRaceAsAdmin`), UUID i `contracts/src/ids.ts` och SHA-256 i `serialization.ts`.
- TS-rader 108 759 → 81 771 (utan tester 69 497 → 52 932); tabeller 102 → 80; rutter 131 → 103; kontraktsfiler 73 → 59; applikationsfiler 106 → 93. Integration 74/300 → 64/264 (besluts-/sessionstesterna skrivna om mot `setEntryStatus`/`requireRaceRole`).
- Verifierat: install (frozen), lint, typecheck, test, test:integration, build, demo på tom databas (inloggningen öppnar arbetsytan direkt), Playwright alla 16 specar gröna i fem grupper (`funktionarer` efter omförsök, speakerns "Senast i mål" som i del 1; `traningskvall` efter omförsök i gruppen, tidsgräns under last, grönt direkt ensam). Ingen användarsynlig ändring; e2e: bara tävlingssessionssteget och uppvärmning av borttagna rutter.

### 2026-10-18 – Steg 23 (del 1): död kod, baslinjemigration, tester och dokument
- Borttaget: `packages/infrastructure` (MinIO), 16 applikationsmoduler och 14 kontrakt som inget anropade (PM-kedjan, avläsningshistoriken, manuella om-länkningar m.m.), Android-transporten, `apps/participant`, `apps/worker`, `packages/route-xml` (GPX nu i `iof-xml`), 14 cookie-filer, 1 319 av 1 436 nycklar i `i18n/sv.ts`, betalstatus, MinIO i compose och döda miljövariabler.
- TS-rader 123 711 → 108 776 (utan tester 78 340 → 69 497); tabeller 114 → 102; rutter 131 → 131; migrationer 106 (7 790 rader) → 1 baslinje (4 469), pg_dump identisk med gamla kedjan; befintliga databaser skapas om (`docs/drift.md`).
- Kvar med flit: `/imports` (EntryList/StartList-filer, Playwright använder sidan), hyrbricksflödena (knappar i deltagarkortet), enum-värdena för borttagna capabilities (försvinner med `pairing_admin_*` i del 2).
- Tester: `task-001` delad i 14 filer efter beteende, övriga `task-NNN` omdöpta; enhet 230 filer/1 492 → 205/1 269; integration 72/391 → 74/300 (borta = tester av borttagen kod). `docs/architecture.md`/`domain-rules.md` nyskrivna, gamla i `docs/archive/`.
- Verifierat: install (frozen), lint, typecheck, test, test:integration, build, pg_dump baslinje = gamla kedjan; Playwright 15 av 16 specar gröna (eventor, redigera-bana, tavlingstyper, traningskvall efter omförsök), `funktionarer` faller (speaker/kvar i skogen) men faller likadant på orörd HEAD i kväll. Kvar i steg 23: punkt 2–5 (statusflöde, versionsgrind, en session, ett skrivställe).

### 2026-10-18 – Steg 22: buggarna från granskningen (steg 22 klart)
- Resultatmotorn 0.3.0: en aligner (`alignControls`, ordnad delföljd, flest obligatoriska sedan strukna, tidigaste stämpling vid lika) för alla
  vägar, även gaffling och neutralisering. Extra-/dubbelstämplingar och återkommande kontroller (fjäril) ger godkänt; fel ordning = en saknad kontroll
  som finns på annan plats. Motorversionen ingår inte i underlagshashen (databasfunktionen känner inte TS-konstanten, ingen produktionsdata, varje
  revision bär `engine_version`, omräkning finns); gamla resultat flaggas alltså inte. `docs/domain-rules.md` regel 6–7 uppdaterade.
- Tid: handskakningen frågar stationens klocka (`GET_TIME`), offset mot datorn blir referens (datorn som reserv), tolerans 2 h, `SiTimeError` i stället
  för gissad tid, varning i avläsningsvyn vid >5 min skillnad, `clockSource`/`clockOffsetMs` i nyttolasten och på `card_readout` (migration 0104).
- Övningsstationen: tider relativt fast starttid och tävlingsdagen, stationens klocka ställs efter brickan, ny bricka tar ur den gamla först,
  bricka som sitter i före handskakningen läses (sessionen sparar detekteringsramen). Falska stationen svarar på `GET_TIME`.
- Dubbla klass-/bannamn: `duplicate-name` → 409 `DUPLICATE_NAME` med svensk text i alla skrivvägar, unika index (migration 0104), banfilen avvisar
  med namnet. Kvar i skogen räknas från tävlingsdagen (`raceDayStarted`, `raceDate` i skogsrapporten). Speakerns "Senast i mål" bara med målgång.
  IOF EntryList validerar `ControlCard` som Eventor och 422 bär felen. Sessionsfrågorna (organizer, tävling) svarar 200 `authenticated: false`.
- Verifierat: lint, typecheck, test, test:integration (72 filer; `adr-0169-draw` flyttad till 2027 eftersom vakanstiderna måste ligga efter nu,
  `task-001`/`task-008` gick igenom vid omkörning efter tidsgräns under last), build, e2e (se nedan).

### 2026-10-06 – Steg 21: kopiera tävling och kvitto vid avläsning (steg 21 klart)
- "Ny tävling som …": "Kopiera" per lopp i Mina tävlingar (ej funktionär) och under Inställningar. Dialog: namn, loppnamn, datum (samma veckodag
  nästa gång om källan passerat), "Ta med funktionärer och administratörer" (förval på; kopieraren blir ägare, källans ägare blir administratör).
- `copyRaceAsUserAccount` i en transaktion (källan låst): typ, tidszon, kontroller/poäng, banor med alla versioner och varianter, klasser (startsätt,
  maxantal, rogaining), sträckor (starttid samma klockslag nytt datum), karta med georeferens, radiokontroller (avstängda) – nya rader. Inte: deltagare,
  lag, lottning, avläsningar, resultat, rutter, radiostämplingar, Eventor (klassernas Eventor-id tas bort), publicering (ny kort kod). Migration 0103 (journal).
- Avläsningen: "Skriv ut kvitto" efter beskedet, "Skriv ut kvitto automatiskt", QR på skärmen och kvittobredd 80/58 mm per enhet (localStorage).
  Kvittot: tävling, datum, löpare, klass, klubb, bricka, status, tid, sträcktider med mål, rogainingpoäng/straff, QR (`qrcode` i skalet) till löparens resultat
  eller `/t/{kod}`. Paketet bär kort kod och publika resultat-id, så allt fungerar utan nät. Ingen placering: offline känner enheten bara sina egna avläsningar.
- Verifierat: lint, typecheck, test (nya `receipt.test`, `race-copy.test`), test:integration (71 filer, nytt `steg-21-copy-race`), build, e2e alla 16 specar gröna i grupper (nytt `kopiera`;
  funktionarer, admin-access, listor efter omförsök; publikt, radio, redigera-bana var för sig sedan servern dött av minnet). Skärmbilder granskade.

### 2026-10-06 – Steg 20: radiokontroller via ROC/OResults (steg 20 klart)
- Inställningar → Radiokontroller (ej Träning/Rogaining, bara admin): källa ROC/OResults, enhetens id, radiokontroller ur banorna med namn, på/av;
  läget (senaste hämtning, stämplingar, okända brickor, oläsbara rader, fel i klartext) och "Hämta nu". Stafettens sträcklöpare får inga mellantider än.
- `packages/roc`: tolerant läsning (BOM, CRLF, trasiga rader räknas, dubbletter, id som inte ökar, lokal tid → tävlingens tidszon) och tunn klient.
  Migration 0102: `race_radio_link`, `race_radio_control`, `radio_punch` (rå rad, oföränderlig, unik på källa+enhet+id och bricka+kontroll+tid).
- Pollern i webbprocessen (`instrumentation.ts`): var 10:e s på tävlingsdagen, PostgreSQL-lås (en instans), 20/40/60 s efter fel, stämplingar och lastId
  i en transaktion. `OTID_RADIO_POLLER=off` stänger av; `OTID_ROC_BASE_URL` bara för test (falsk ROC på 4331, även i CI:s driftjobb).
- Domänen `radio-controls.ts` (tid och plats vid kontrollen, bricka matchas vid läsning). Resultatlistan och sträcktidsanalysen: "Ute i skogen" och
  "Vid radiokontroll"; speakern: senaste radiostämplingar, ledare vid kontrollen, "på väg in"; tävlingssidan: "Radiokontroller live".
- Verifierat: lint, typecheck, test, test:integration (70 filer, nytt `adr-0172-radio`), build (pollern provad i driftbygget: lås, fel, väntan), e2e alla
  15 specar gröna (nytt `radio`; grupp med publikt dödades av minnestaket och kördes om; funktionarer, lottning, stafett efter omförsök). ROC-adressen ska provas av ägaren.

### 2026-10-06 – Steg 19: publik startsida och tävlingssida (steg 19 klart)
- Migration 0101: `race.published_at` (NULL = inte publicerad) och `race.short_code` (6 tecken utan 0/1/i/l/o, unik, sätts av databasen).
  Synlig = publicerad och inte dold; en grind (`publicRaceAccess` + `lib/public-race-gate.ts`) för alla publika sidor, API:er, resultatströmmen och exporter.
- Arbetsytan: steget Publicera (före Avläsning, status Publicerad/Inte publicerad/Dold) och samma del under Inställningar: publicera/sluta publicera,
  tävlingssidans adress, kopiera länk, "Skriv ut QR-kod". Texten förklarar att startlistan har egen publicering och att resultaten syns vid avläsning.
- Opublicerad: "Tävlingen är inte publicerad" (404, inget namn). Ägare/administratör/funktionär inloggad med kontot ser publika sidor med
  bannern "Förhandsvisning – inte publicerad" (svaren `private, no-store`).
- Startsidan: sök på namn, Pågår nu (dagen i tävlingens tidszon), Kommande, Senaste med "Visa fler", inga adminlänkar. `/t/{kod}`: tävlingssidan
  (startlista, resultat, sträcktider, vägval, senast uppdaterad); `/t/{kod}/qr`: QR-kod (`qrcode`), A4/A5, ren utskrift. Listorna länkar dit.
- Verifierat: lint, typecheck, test (nytt `public-race-gate.test` över alla publika routes), test:integration (nytt `adr-0172-public-race`), build,
  e2e alla 14 specar var för sig gröna (nytt `publikt`; `listor` efter omförsök, avläsningens timing). Utvecklingsservern kräver lokalt `--max-old-space-size=1536`.

### 2026-10-05 – Steg 18: funktionärer och städning av gamla behörigheter (steg 18 klart)
- Rollen Funktionär (migration 0100: `FUNCTIONARY`, delegeringen `RACE_FUNCTIONARY`). Inställningar → "Personer med behörighet": ägare, administratörer och
  funktionärer i en lista; admin lägger till funktionär med e-post till befintligt konto ("Be personen skapa ett konto … först"), ägaren även administratörer.
  Medadministratörer på /organizer är borta (samma lista). Borttagen behörighet gäller direkt även för öppna sessioner; en session per enhet.
- Funktionären: Mina tävlingar "Funktionär", arbetsyta med bara Start (startlistor, utan export) och Avläsning (avläsning, direktanmälan av okänd bricka –
  inte koppling till anmäld –, kvar i skogen med återkomst/startläge, speaker). En tabell i `lib/race-roles.ts` + `requireRaceRole`; tjänsterna och DB kontrollerar igen.
- Borttaget: funktionärskoder, stationsparning/-credentials/-paket/device-batches, `apps/station`, incheckningsappen `/checkin` med egna sessioner och
  återställningskoder, egen inloggning för kvar i skogen, `api/events` (CREATE_EVENT), `/me` med deltagarkoder och följningar; 20 tabeller (migration 0100).
- Verifierat: lint, typecheck, test (nytt `race-roles.test` anropar alla adminroutes som funktionär/admin), test:integration (nytt `adr-0172-functionaries`),
  build, e2e i grupper (nytt `funktionarer`, två enheter på samma konto). Skärmbilder 1280/390 granskade.

### 2026-10-05 – Steg 17: konton och superadmin (steg 17 klart)
- Konto med e-post (normaliserad, unik oavsett versaler) i stället för inloggningsnamn; medadministratör läggs till med e-post. Öppen registrering
  spärras per IP och timme (`OTID_REGISTRATION_LIMIT_PER_HOUR`, förval 10) utöver inloggningsspärren. Demo: `demo@o-tid.local`.
- Glömt lösenord: engångslänk via SMTP (nodemailer, `OTID_SMTP_URL`/`OTID_MAIL_FROM`), hash i databasen, en timme, en gång, alla sessioner spärras,
  samma svar oavsett adress. Utan SMTP: "kontakta den som driver O-Tid" och superadmin skapar länken. Kodflödet i fil, inbjudningar och deras CLI borta.
- Superadmin sätts bara med `pnpm account:superadmin grant <e-post>` (driften: `node superadmin.mjs` i webbens avbildning). `/superadmin`: sök konton och
  tävlingar, dölj/visa, ta bort tävling (skriv namnet), spärra/släpp, ta bort konto (skriv adressen), återställningslänk; allt loggas i append-only
  `superadmin_action`. Kontrollen i `requireSuperadmin`; publika sidor och API:er visar inte dolda tävlingar (`isRacePubliclyVisible`).
- Ägaren tar bort sin tävling (Inställningar); Mitt konto (`/konto`): namn, lösenord, ta bort konto – tävlingar man äger (alltid ensam ägare) listas och
  tas bort samtidigt. Borttagningen följer databasens nycklar (`purge.ts`). `/integritet` med `OTID_CONTACT_EMAIL`. Migration 0099.
- Verifierat: lint, typecheck, test, test:integration (77 filer, nya `adr-0172-accounts`, `adr-0172-delete-race`), build, e2e varje spec för sig grön (nytt
  `konton` mot falsk SMTP). Hela sviten i en process: utvecklingsservern dödas av minnestaket (OOM, ~5 GB) efter fyra flöden. Skärmbilder granskade.

### 2026-10-05 – Steg 16: sträcktidsanalys och vägval (steg 16 klart)
- Publik `/results/{id}/splits?class=…` (länk från resultatlistornas klassrubrik, "Med sträcktider" och sidhuvudet): löpare × sträckor med
  sträcktid och placering, förlust mot bästa, totaltid med placering; bästa sträcka fetstil + ★; sortering per sträcka; vyn "Tidsförlust" med idealtid.
- Domänen `split-table.ts`: sträcka bara mellan två kända tider (missad kontroll/stämpling före start ger "–", även i steg 13-listan), sträckidentitet
  från–till, gafflat per variant, felstämplade under utan placering. Stafett: inte stödd (besked på sidan); rogaining: ingen länk.
- Vägval: Resultat → Karta och vägval (admin): kartbild, georeferens med tre punkter (klick + koordinat), GPX per löpare med "täcker x av y sträckor".
  `/results/{id}/routes` visar sträckans del av rutten på kartan (SVG, zoom/dra) med andras vägval att jämföra; aldrig före start/efter mål.
- ADR-0171, migration 0098: `race_map` och `participant_route` i PostgreSQL (bytea). Borttaget: 17 kart-/rutt-/geometritabeller, MinIO-adaptrarna
  för karta/rutt, deltagarlänkar för uppladdning, gamla kart-/ruttsidor och API:er, `route-metadata`, privata rutter i "Mina resultat".
- Verifierat: lint, typecheck, test, test:integration (78 filer, nytt `adr-0171-map-routes`; ett tidsfel efter omstart av maskinen gick igenom vid
  omkörning), build, e2e (nytt `strackanalys` grönt ensamt; hela sviten 13 flöden gröna, fyra efter omförsök av last). Skärmbilder 1280/390 granskade.
- Idéer nedan: tidsförskjutning GPS–station, KMZ/världsfil för georeferens, kontrollernas lägen från banfilen, stafettanalys.

### 2026-10-05 – Steg 15: rogaining (steg 15 klart)
- Migration 0097: `class.rogaining_time_limit_seconds`/`_penalty_points_per_minute` (rogainingklass), `control.points` (NULL = förval) och journalen
  `rogaining_change_request`. Underlagshashen tar med tidsgräns, straff och poäng (v3) bara för rogainingklasser; övriga hashar oförändrade.
- Domän `rogaining.ts` (via `evaluateCardReadout`, så även offlinepaket, omräkning och rättad tid): banversionen är kontrollmängden, förval = kodens
  tiotal (31 → 3, 102 → 10), en gång per kontroll, straff per påbörjad minut, summa ≥ 0; rangordning på summa, sedan tid, delad plats vid lika.
- Kontroller & poäng: tidsgräns och straff per klass och poäng per kontroll i raderna; sparas direkt när ingen summa/status ändras, annars besked
  och omräkning med nya revisioner. "Förbered bana och klass" har tidsgräns (60) och straff (1) i rogainingtävlingar.
- Avläsningen visar summa stort, kontrollpoäng − straff, tid mot gränsen, "För sen" med symbol och de räknade kontrollerna; övningsstationen har "för sen".
- Listor: kolumner Poäng/Straff/Summa/Tid, "med sträcktider" visar räknade kontroller, CSV och IOF XML (`<Score type="Score">`, `Penalty`, placering utan TimeBehind).
- Verifierat: lint, typecheck, test, test:integration (84 filer, nytt `adr-0170-rogaining`), build, e2e (nytt `rogaining`; i hela sviten gav lasten
  tidsfel i listor/gafflingar/admin-access, som går igenom var för sig med omförsök). Skärmbilder 1280/390 granskade.

### 2026-10-05 – Steg 14: Eventor och banfiler, med uppdateringar (steg 14 klart)
- Inställningar → Eventor (Tävling, gafflade banor, Stafett): klubbens API-nyckel sparas krypterad per tävling (AES-256-GCM, `OTID_EVENTOR_MASTER_KEY`
  i miljön; utan den startar appen och visar "inte påslaget"), visas som "Nyckel sparad", testas, byts eller tas bort. Tävlingen väljs ur klubbens lista eller med nummer.
- "Hämta/Uppdatera från Eventor" och Banor → "Läs in (ny) banfil" sparar källan som ögonblicksbild (migration 0096) och visar nya, ändrade, strukna och
  "lös själv"; rader kan bockas ur och beskedet följer urvalet. Klassbyte, ny bana och ny banversion räknas om som Redigera bana (besked, bekräftelse, ny revision).
- Matchning på Eventors id, annars namn+klubb+klass mot deltagare från fil ("matchad på namn"); direktanmälda rörs aldrig. Struken utan resultat blir ej start;
  avläst/med resultat blir konflikt. Ny bricka efter avläsning behåller resultatet. Stafettlag med sträcklöpare (vakant sträcka fylls i senare).
- Eventor-klasser utan banfil står på banan "Bana saknas" tills banfilen läses in. Adaptern `packages/eventor` omskriven (tolerant men härdad läsning, client).
- Borttaget: CLI-anslutning och grants (`scripts/eventor-*.ts`, fyra `package.json`-skript), tabellerna `eventor_*`, gamla kontrakt och tester.
- Verifierat: lint, typecheck, test, test:integration (83 filer, nytt `adr-0170-eventor-sync`), build, e2e (9 flöden, nytt `eventor` mot falsk Eventor; i hela sviten
  gav maskinens last tidsfel i listor/stafett/gafflingar, som går igenom var för sig utan omförsök). Skärmbilder granskade.
- Återstår: prov mot riktiga Eventor med klubbens nyckel (svarsformatet är byggt efter dokumentationen, fixtures är konstruerade).

### 2026-10-05 – Steg 13: start- och resultatlistor (steg 13 klart)
- Ett listmönster (`components/lists/`, modeller i `lib/lists/`, sträckplaceringar i domänens `split-table.ts`) i Start, Resultat och de publika sidorna:
  fast verktygsrad med vy, sök, klass, "Skriv ut" (egen A4-layout med tävling, lista och utskriftstid) och "Exportera" (IOF XML, CSV med BOM och semikolon).
- Start: per klass (bana, startsätt, vakanser, fri start/masstart, stafettlag), per starttid (minut för minut per startfålla, vakanser, "Nu"), per klubb.
  Publiceringen läses in av sig själv: läget i en mening och "Publicera startlistan". Lottningen överst som förut.
- Resultat: per klass, med sträcktider (per variant, bästa sträcka), per klubb; stafett som lag med sträcklöpare och sträckresultat. Efterarbete under listorna.
- Startfålla, startsätt, vakanser och bana i deltagarlistan och publiceringen; IOF StartList med TeamStart; publik IOF-resultatlista utan externa id:n.
- Borttaget: gamla publika resultat-, stafett- och startlistkomponenter, följ/favorit och ruttval i listan, adminens startunderlag och exportpanel.
- Stämpling före start eller efter mål: kontrollen räknas som stämplad men får ingen sträcktid ("–", IOF SplitTime utan Time), statusen följer vanliga regler
  och deltagarkortet visar en notis. En ogiltig rad visas utan sträcktider i stället för att fälla hela den publika listan.
- Verifierat: lint, typecheck, test, test:integration, build, e2e (8 flöden, nytt `listor`). Skärmbilder 1280/390 och utskrifts-PDF granskade.

### 2026-10-04 – Steg 12: tävlingstyp, nytt utseende och egen speakersida (steg 12 klart)
- Tävlingstyp (migration 0095) väljs i "Skapa tävling" och under nya Inställningar (namn, datum, typ, funktionärer, import). `lib/race-sections.ts`
  avgör delar och funktioner: Träning (Banor & klasser, Deltagare, Avläsning, Resultat; alltid fri start), Liten tävling, Tävling (lottning, import,
  speaker, fastställande), gafflade banor (varianter utfällda), Stafett (Klasser & sträckor, Lag), Rogaining (Kontroller & poäng med notis).
- Skal: fast toppbalk (tävling, typ, avlästa/kvar i skogen, Öppna avläsningen/speaker) och sidopanel ritad som en bana med status per del; mobil: remsa överst.
- Formspråk: tokens + Barlow/Barlow Semi Condensed (självhostat, även i avläsningens offlineskal via esbuild och manifest, `font-src 'self'`),
  komponenter i `components/ui/`, platta avsnitt och täta tabeller. Färg bara för status, åtgärd och vald del. Avläsningen är bara ljus.
- Speakern är egen sida `/admin/{id}/speaker` (senast i mål med placering, ledare per klass, kvar i skogen, stafett per sträcka); panelen i arbetsytan borta.
- Nya klasser får fri start; lottningen sätter minutstart. Parkerat bort ur arbetsytan: ruttlänkar, betalstatus (kort, lista, route) och
  kontokoppling (komponent, adminroutes); applikationskoden finns kvar. Löptider och sträcktider visas som m:ss/h:mm:ss utan millisekunder.
- Verifierat: lint, typecheck, test, test:integration (83 filer), build, e2e (7 flöden, nytt `tavlingstyper`). Skärmbilder 1280/390 granskade i två omgångar.

### 2026-10-04 – Steg 11: stafett (steg 11 klart)
- Migration 0094: `relay_leg` (sträcka, startsätt MASS_START/CHANGEOVER/RESTART, tid, valfri variant), `team` (nummer, namn, klubb),
  `entry.team_id`/`relay_leg` och journalen `relay_request`. Varje sträcklöpare är en vanlig deltagare: bricka, avläsning, revisioner och underlag fungerar som förut.
- Domän `relay.ts`: sträckans start (växling = föregående sträckas mål; omstart när laget inte växlat före tiden), lagresultat (godkänt först när alla
  sträckor är godkända; lagets tid = summan av sträcktiderna), placering med delade platser, sträckresultat per sträcka och varianter roterade över lagen.
- Sträckans start sparas som fast starttid och ingår därmed i underlaget. Ny måltid (avläsning, okänd bricka, måltidsrättning) eller nya tider räknar
  om senare sträckor i samma transaktion. En sträcka som läses före föregående sträcka får "ingen starttid" tills föregående läses av.
- Arbetsytan: "Ny stafettklass" (Klasser), lagvy med lagkort och "Byt löpare på sträcka N" (Anmälda), masstart/omstart (Start), "Lag ute" (Avläsning).
  Avläsningen visar lag och sträcka, växling eller lagets tid; övningsstationen lägger sträckorna efter varandra. Publikt: lagresultat med sträckor och
  sträckresultat, startlistan per lag. IOF: ResultList med TeamResult/TeamMemberResult, `TeamCourseAssignment` ger varianter per sträcka.
- Verifierat: lint, typecheck, test, test:integration (82 filer, nytt `adr-0169-relay`), build, e2e (6 flöden, nytt `stafett`).

### 2026-10-04 – Steg 10: gafflingar i individuella klasser (steg 10 klart)
- Migration 0093: `course_variant` + `course_variant_control` (oföränderliga, per banversion), `entry.course_variant_code` och journalen
  `course_variant_assignment_request`. Underlagshashen tar med variant och varianternas kontroller (v2) bara för gafflade banor; övriga oförändrade.
- Domän `course-variants.ts`: bedömning mot löparens variant (utan giltig variant: den variant stämplingarna passar bäst), gafflingskontroll
  (samma sträckor i alla varianter), jämn fördelning med frö, minst använd variant. Slumpen med frö ligger i `seeded-random.ts`.
- IOF: `Course` med samma `CourseFamily` blir en bana med varianter ("Lång-AC" → AC), `ClassCourseAssignment` via familj eller namn,
  `PersonCourseAssignment` (EntryId, annars namn + klass) ger löparens variant. Fixtures `*-forked.xml` (fjärilar, fyra varianter).
- Varianter ges av lottningen, "Fördela gafflingar" (avlästa får sin stämplade variant), efteranmälan (minst använd) och direktanmälan vid
  avläsning (stämplad variant). Redigera bana gäller en variant åt gången; deltagarkortet byter variant med besked när resultatet ändras.
- Variant visas i Banor (utfällbar lista, varning), Klasser, deltagarkort, lottning, startlistor, avläsningens besked, publika resultat,
  IOF-export och fastställande. Övningsstationen stämplar löparens variant.
- Verifierat: lint, typecheck, test, test:integration (81 filer, nytt `adr-0169-forking`), build, e2e (5 flöden, nytt `gafflingar`).

### 2026-10-04 – Steg 9: lottning på riktigt (steg 9 klart)
- Start: tabell med Startsätt (Fri start / Lottad minutstart / Masstart), intervall, vakanser (st eller %) och "Lotta" per klass;
  första start som klockslag och klubbseparering. "Visa lottning" visar startlistan som den blir (tider, "Vakant", startfållor).
- Domän `start-draw.ts`: blandning med frö, klubbseparering, jämnt spridda vakanser, startfållor (samma första kontroll startar aldrig
  samma minut; masstart först, största klassen först, första lediga minut) och placering av efteranmälda. Jaktstart flyttad till "Efter målet".
- Migration 0092: `start_draw_request/class/slot` (fröet sparas, visas aldrig), `class.start_draw_id`. Gamla enklasslottningen,
  slotplanen och tilldelningsjournalerna är borttagna. Ersätts tider med resultat räknas avlästa löpare om i samma transaktion.
- Efteranmälan i lottad klass: appen ger första lediga vakanta tid efter nu, annars första fria minut efter klassens sista start i fållan.
- Verifierat: lint, typecheck, test, test:integration (80 filer, nytt `adr-0169-draw`), build, e2e (4 flöden, nytt `lottning`).

### 2026-10-04 – Steg 8.5–8.6: checklista, kontrollvy och vanligt språk (steg 8 klart)
- Checklistan Banor → Klasser → Anmälda → Start → Avläsning → Resultat ersätter arbetslägen och undermenyer. Varje steg har status
  i ord och symbol (`lib/admin-checklist.ts`). Översikten och förberedelseguiden är borttagna.
- Avläsning = tävlingsdagens kontrollvy: "Öppna avläsningen", kvar i skogen (lista), okända brickor (kopplas direkt i vyn),
  felstämplade med "Öppna" till deltagarkortet och senaste avläsningar. Läses in när arbetsytan öppnas.
- Inga id, hashar, versioner, slumpfrö eller UTC-offset i vyerna: tider som klockslag, starttider och lottningens första start
  skrivs som klockslag (`parseRaceClock`). Nytt enhetstest granskar arbetsytans textfiler.
- Omförsök i `operations.ts` (`fetchWithRetry`, även rättningarna); "svaret saknas" → "Kunde inte nå servern. Försök igen."
  Namn, bricka, betalning, bana+klass, ny klass, maxantal och publicering sparas direkt; klassbyte, starttid, lottning kvar med bekräftelse.
- Verifierat: lint, typecheck, test, test:integration (83 filer), build, e2e (3 flöden via checklistan och kontrollvyn).

### 2026-10-04 – Steg 8.3–8.4: klasser som tabell och deltagarkort
- Klasser som tabell (klass, bana, startsätt, anmälda, avlästa/resultat, status) med namn, bana och startsätt i raden. Byte av bana
  eller startsätt ger besked i klartext och räknas om i samma transaktion (`editClassAsAdministrator`, migration 0091); bara namn sparas direkt.
- Deltagarkort: klick var som helst i raden. Namn/klubb, klass, bricka, starttid (klockslag), resultat i ord, sträcktider och kort historik.
  "Ändra status" ersätter åtta knappar: ett val, en mening om följden, en bekräftelse. Träningskvällens godkännande: två steg i stället för fem.
- Disk/godkännande m.fl. på ett omräknat resultat räknas som aktuellt (`isEffectiveResultCurrent`), inte längre "äldre underlag".
- Borttaget ur gränssnitt och routes: klassnamn, startregel, klassöversikten, uppföljning av starttider/klassomräkning i Klasser, åtta beslutsformulär.
- Verifierat: lint, typecheck, test, test:integration (83 filer, nytt `adr-0169-class-edit`), build, e2e (3 flöden; `redigera-bana` byter även klassens bana och använder kortet).

### 2026-10-04 – Steg 8.2: Redigera bana
- Banor visas som tabell (bana, kontroller, klasser, anmälda, avlästa) med "Redigera" i raden. "Visa vad som händer" prövar
  varje avläsning mot nya kontrollföljden med resultatmotorn och ger beskedet i klartext; bekräftelse krävs bara när någon byter status.
- Sparande i en transaktion: ny banversion, alla klasser på banan flyttas, tävlingsversionen +1 och avlästa löpare räknas om
  (ny revision, historik kvar). Ej start och manuellt rättad tid räknas inte om; disk/godkännande m.fl. gäller som förut.
- Migration 0090 (`course_edit_request`, idempotent journal). Gamla verktygen för omlänkning, banrättning efter resultat,
  resultatpåverkan och neutralisering är borttagna ur gränssnitt och routes; applikationsfunktionerna finns kvar.
- Verifierat: lint, typecheck, test, test:integration (82 filer, nytt `adr-0169-course-edit`), build, e2e (3 flöden, nytt `redigera-bana`).
- Återstår: en disk eller ett godkännande på ett omräknat resultat visas fortfarande som "äldre underlag" (beslutsrevisionen bär gamla underlaget).

### 2026-10-03 – Steg 8.1: resultat är aktuella per löpare
- Migration 0089: `result_revision.basis_hash`, sätts av databasen vid insert (klass, startsätt, banversion med
  kontroller, strukna kontroller, fast starttid). Äldre revisioner utan hash jämförs som tidigare.
- Alla ställen som avgjorde "äldre underlag" via tävlingsversionen använder nu `isResultCurrent`. Godkännande av en
  felstämplad löpare kräver inte längre omräkning efter en direktanmälan (träningskvällstestet har en omräkning mindre).
- Verifierat: lint, typecheck, test, test:integration (81 filer, nytt `adr-0169-result-basis`), build, e2e.

### 2026-10-03 – Förberedelse för steg 7
- Avläsningssidan loggar all stationstrafik i minnet. "Ladda ner rålogg" ger trafiken och loppets råramar som JSON
  (inga namn). Täcks av enhetstest och träningskvällstestet.

### 2026-10-03 – Steg 2 klart
- `race-administrator-workspace.tsx` 4 301 → 189 rader: session, laddning och navigering. Områdena (förberedelse,
  deltagare, resultatbeslut, tävlingsdag, efter tävlingen) ligger i `components/race-administrator/` (22 filer, största 543).
- En gemensam anrops-/operationshjälp (`operations.ts`); de fem likadana resultatbesluten laddas med samma funktion.
- `race-administrator-route-handlers.ts` 1 382 → 84 rader (dispatcher) + fyra gruppfiler; testerna delade likadant.
- Borttaget: inloggning med åtkomstkod via `POST /session` (ger nu 405) och 1 200 rader oanvänd CSS.
- Ingen fil i `apps/web/src` över 800 rader (största: `globals.css` 629). Markup, etiketter och roller oförändrade.
- Verifierat: lint, typecheck, test, build, e2e (utvecklingsläge och driftbygge bakom HTTPS).

### 2026-10-03 – Steg 6 klart
- `Dockerfile` (Next standalone + paketerad migrering som körs före start), `docker-compose.prod.yml` med PostgreSQL,
  webb, Caddy (automatisk HTTPS) och backup (`pg_dump` vid start och varje natt, 14 dagars rotation). `docs/drift.md`.
- Verifierat lokalt utan Docker (registren nås inte här): produktionsbygget bakom Caddy med HTTPS – båda webbläsarflödena
  gröna, även offline-avläsningen. Backup, rotation och `pg_restore` provade; samma antal rader efter återställning.
- Verifierat i CI-jobbet `production`: `docker compose up --build`, webbläsartesterna mot https://localhost och att en
  backupfil skapas. CI är grönt för första gången: avbildningen `postgis/postgis:17-3.6` fanns inte (nu 17-3.5).
- Rättat: IOF-exporten avvisade svar som Caddy komprimerat (ETag/content-length). Innehållshashen kontrolleras fortfarande.

### 2026-10-03 – Steg 5 klart
- `tests/e2e/traningskvall.spec.ts`: 10 löpare genom hela kedjan – två banor/klasser (fri start är standard), åtta
  förhandsanmälda, avläsning med övningsstationen (delvis offline, omladdning offline), två okända brickor
  direktanmäls, kvar i skogen = 2, felstämplad räknas om och godkänns manuellt, publikt resultat, IOF XML-export.
- "Kvar i skogen" visas som eget tal i Under tävlingen (anmälda som varken lästs av eller är ej startande).
- `pnpm demo` ersätter `demo:provision`, `demo:access:copy`, `db:seed` och utvecklingsinloggningen för demotävlingar.
- `simulatedRun`/`readSimulatedCard` i `packages/sportident` används av övningsstationen, demon och tester.
- Övningsstationens okända bricka springer vald deltagares bana. `readout.spec.ts` ingår nu i träningskvällstestet.
- Verifierat: lint, typecheck, test, test:integration (80 filer), build, e2e (2 flöden).

### 2026-10-03 – Steg 4 klart
- `/admin/<lopp>/readout` leder till appskalet `/readout/` (esbuild + service worker, `build:shells`). Det startar utan nät.
- Web Serial (38 400, sedan 4 800 baud) eller övningsstation (`FakeSiStation` genom samma protokollkod). Stort besked med
  symbol och text, sträcktider, statusrad (station, internet, kö, underlagsversion). Serverns bedömning gäller och avvikelser visas.
- Kö i IndexedDB per lopp med stabilt enhets-/sessions-id och löpnummer. Raderas aldrig; status ändras bara vid kvittens.
  Utgången adminsession förnyas via kontot. Nya routes `readout-package` och `readouts` på adminsessionen.
- Kontrakt: transport `sportident` med råramar (hex). Mål får saknas (migration 0088); bedöms som felstämplad.
- Den gamla simulatorsidan är borttagen. Stationsappens bearer-ingest finns kvar (parkerad).
- Verifierat: lint, typecheck, test, test:integration (81 filer), build, e2e (`readout.spec.ts`: offline-avläsning → omladdning
  offline → synk → publikt resultat → okänd bricka direktanmäls i Hantera). Hårdvara: fortfarande `untested`.

### 2026-10-03 – Steg 1 klart
- Självregistrering på `/organizer`. Kontoinloggningen gäller i 30 dagar (migration 0087).
- `/manage` öppnas med kontot, utan behörighetskod. En kontoinloggad admin (MANAGE_RACE) får alla funktioner i tävlingen.
- IOF-importen använder adminsessionen. Eventor-importen är borttagen från sidan (parkerad).
- Borttaget: 27 dubblettsidor, ~75 API-routes, 33 behörighetsskript, kontoinbjudningskoder, CREATE_EVENT-sidorna,
  skrivstoppet (`ops/systemd`, `proxy.ts`) och 154 gamla webbläsartestfiler (38 konfigurationer, mest röda vid baslinjen).
- Nytt: en Playwright-konfiguration, `tests/e2e/admin-access.spec.ts` (konto → tävling → bana/klass/deltagare →
  medadmin → publik/401), integrationstestet `adr-0168-two-levels` och routetester för registrering. CI kör e2e igen.
- **Avvikelse från planen:** tabeller och applikationskod för de gamla rollerna ligger kvar men nås inte från webben.
  Stationsparning/-credentials, start-/målpersonalens koder och claim-koder finns kvar (parkerade, steg 4 tar stationen).
  Publik speakervy är inte gjord. Demo (`demo:provision`) fungerar inte längre och ersätts i steg 5.

### 2026-10-03 – Steg 3 klart (gjort före steg 1–2, oberoende av dem)
- Nytt paket `packages/sportident`: ramtolkning med CRC, tillståndsmaskin för avläsningsstation,
  avkodning av SI5/6/8/9/10/11/SIAC/pCard, tidstolkning med tidszon samt `FakeSiStation`.
- 55 tester: alla chunkgränser, fel CRC/ETX, trunkering, dubbletter, alla bricktyper, uttagen bricka,
  tidsgräns, station utan handskakning, fel inställd station, AM/PM, midnatt, vintertid.
- CRC verifierad mot publicerade ramar. Minneslayouterna är jämförda mot en oberoende öppen avkodare
  (bara som referens, inte kopierad): allt stämmer utom SI6-kontrollkoder >255, där referensen har fel.
- Hårdvara: alla rader `untested` i `docs/sportident.md` tills steg 7.

### 2026-10-03 – Steg 0 klart
- Git och GitHub (`joelberring/otid`). TASK-filer, gamla status- och plandokument är flyttade till `docs/archive/`.
- **Fel i migreringarna:** drizzles migrator kör allt i en transaktion, och PostgreSQL vägrar då använda nya
  enum-värden. `pnpm db:migrate` kraschade på ny databas och vid uppgradering över flera migrationer.
  `@o-tid/database` har nu en egen `migrate` som committar enum-värden först och sedan kör en transaktion per fil.
- Borttaget (parkerat enligt ADR-0168, testerna krävde macOS): backup/replikering och PM-skannerns Docker-isolering.
- Röda tester som var föråldrade är rättade: formatversioner 10/12/14 → 15, motorversion 0.1.1, ett tidsberoende
  test (TASK160), ett för strikt namnkrav på testdatabas (TASK153), kortbyte med extra fält (TASK030), TASK300/301.
- Gröna: lint, typecheck, `pnpm test`, `pnpm test:integration` (ett test om begränsade roller hoppas över tills steg 1), `pnpm build`.
- **Webbläsartester:** `pnpm test:e2e` går inte att köra som helhet. Det finns 38 separata Playwright-konfigurationer
  och flera specar kräver egna databaser och miljövariabler. Adminflödets svit: 22 av de första 24 testerna föll
  (tidsgränser). Ersatt i steg 1.
- CI kör nu lint, typecheck, test, integration och build. Android-jobbet är borttaget (parkerat).

### 2026-10-03 – Omstart
Granskning visade 301 uppgifter på fem veckor men ingen riktig brickavläsning,
en Android-app som aldrig byggts och för mycket behörighetsmaskineri.
Ägaren beslutade om ny plan (`PLAN.md`) och ADR-0168: ett mål (körbar
klubbträning), avläsning i webbläsaren via Web Serial, eget SPORTident-protokoll
nu, två behörighetsnivåer (admin och alla andra) och parkering av GPS,
deltagarkonton med mera. `AGENTS.md` har bantats från 210 KB. Den gamla finns i
`docs/archive/AGENTS-2026-10-03.md`.

Kvarstår för ägaren: begära *PC Programmer's Guide* från SPORTident
(support@sportident.com), välja server för drift (steg 6), skaffa station och
brickor till steg 7.

## Idéer (inte i planen än)

- Ägaren 2026-11-08: **engelska** i hela appen (språkval från början; texterna finns till stor del i `i18n/*-sv.ts`, men svensk
  text ligger också direkt i komponenterna). Den engelska guiden ska säga att verifierade klubbar bara finns via svenska
  Eventor, att fler länder kan gå att lösa och att förslag mejlas till O-Tid (`OTID_CONTACT_EMAIL`, förval otid@berring.se).
- Ägaren 2026-11-08: **ny förstasida**: tävlingar och resultat stort, men personanpassad för den som är inloggad och kopplad
  till en klubb; tydligare att appen gör mer än tidtagning, hur den är byggd, vilka program som körs i den och att koden är fri.
- Ägaren 2026-11-08: **demoläge** utan inloggning: en demotävling på en demokarta (t.ex. Kungshatt) att klicka runt i.
- Ägaren 2026-11-08: **omriktning mot magnetisk nord** (deklinationen ändras): deklination ur WMM (NOAA, fri), alla objekt
  vrids kring referenspunkten, nordlinjerna ritas om raka och parallella, och banor och kontroller knutna till kartversionen
  följer med så att gamla banor inte hamnar fel. WMM också som förval i "Ny karta".
- Ägaren 2026-11-08: **underlag utan svenskt API** (K4): ladda upp laser (LAS/LAZ), höjdmodell och ortofoto (GeoTIFF),
  vektorer och georefererade bilder själv; samma behandling som det hämtade.
- Ägaren 2026-11-08: **etapper** (delområdena, K4–K6b): ett revideringsdatum per etapp i ett lager som inte skrivs ut men kan
  öppnas; nytt underlag (t.ex. vegetation) hämtas och körs bara för en etapp.
- Ägaren 2026-11-08: **normkontroll i kartritningen** (K6): symbolerna enligt ISOM 2017-2/ISSprOM 2019-2 och ett läge som går
  att slå på och av som visar brott mot normen på kartan (avstånd mellan kurvor och andra linjer, minsta storlekar och
  längder, luckor, linjebredder i utskriftsskalan).

- Inomhusorientering (ägaren 2026-11-08), i både banläggning och kartritning: rita kartan ur PDF-ritningar (tolka och
  generalisera), våningsplan som lager ovanpå varandra i rätt läge, banor med numrerade trapphus och avspärrningar, och
  vägvalsmotorn mellan våningarna via trapphusen (svårt att lägga och prova inomhusbanor utan den).

- Tvåstegsregelns steg 2 för migration 0087 (städrundan C5), i en driftsättning efter den med 0087: `ALTER TABLE email_verification_token
  DROP COLUMN salt_hex, DROP COLUMN verifier_hex` (och kolumnerna ur schema/accounts.ts). Ingen kod läser eller skriver dem sedan 0087.

- Steg 54: en utläsning i 25-manna gör 84 databasfrågor i följd (individuell 38); under last väntar varje fråga på
  processorn. Färre frågor (lagets sträckor, starter och resultat i en fråga) skulle ge snabbare kvitto vid täta växlingar.
- Steg 54: Kvar i skogen och "Kvar att läsa ut" skickar hela tävlingen (1,7 MB för 3 000 löpare, 4 MB för 25-manna) varje gång.
- Steg 51: resultatlistan är 411 kB packad för 3 000 löpare och hämtas hel; en lista per klass skulle minska trafiken.

- Import av "Exportera tävlingen" (`otid-race-export` v1) till en ny tävling; ångra strykning; Eventors "struken" som strykning i stället för ej start.

- Start: incheckningsappen (offline, krypterad lista) togs bort i steg 18 (halvfärdig, nåddes bara via funktionärskoderna). Funktionären sätter startläget
  online under Avläsning → kvar i skogen; avprickning direkt i startlistan (per starttid) och offline vore bättre vid starten.

- Radio: mellantider för stafettens sträcklöpare; speakerns klassfilter även för radioklasser; radiostämpling som starttid vid fri start.

- Vägval: justera tidsförskjutning mellan GPS-klocka och stationer per rutt; georeferens från KMZ eller världsfil (OCAD) i stället för tre punkter;
  kontrollernas lägen från banfilens koordinater; sträcktidsanalys för stafett (per sträcka); uppladdning av flera GPX-filer matchade på namn.

- Rekning med flera ritare: nu stegen K0–K7 i PLAN.md (ADR-0219).

- Stafett: bana per sträcka finns bara via en gafflad bana (variant per sträcka). Det fastställda resultatets IOF-export skriver inte lag än. Kvar i skogen räknar även sträcklöpare som inte startat.

- Gafflingar: en klass som byter till en gafflad bana (Redigera klass) får inga varianter automatiskt; "Fördela gafflingar" gör det. (Rättat steg 61: IOF StartList och ResultList skriver varianten som bana, "Lång-AC".)
- Klassbyte till en lottad klass ger inte automatiskt en vakant tid; arrangören anger tid som förut.
- Fastställande jämför beslutsrevisionens bana med klassens: en disk som ligger kvar efter banändring kan ge "fel bana" där. Pröva i steg 8.5/8.6.
- …
