# Domänregler

Gäller från steg 23. Äldre version med regler per TASK och de borttagna behörighetsnivåerna:
`docs/archive/domain-rules-2026-10-18.md`. Koden för reglerna finns i `packages/domain`.

## Modellgränser

- `Event` är arrangemanget; `Race` är en tävling (ett lopp) inom arrangemanget.
- `Class` hör till ett lopp och pekar på en bestämd `CourseVersion`.
- `Course` är den stabila identiteten. `CourseVersion` är append-only och äger en ordnad följd
  `CourseControl` som pekar på `Control`. En gafflad bana har varianter per version.
- `Entry` är deltagandet i ett lopp, inte personen. Stafettens sträcklöpare är en `Entry` per sträcka i ett lag.
- `CardAssignment` kopplar ett bricknummer till en `Entry` för loppet (`is_rental` markerar hyrbricka).
- `NormalizedCardReadout` är en tolkad representation av oföränderlig rådata (`raw_device_message`).
- `ResultRevision` är en append-only lagrad bedömning med orsak, motorversion och underlag.

Alla interna identiteter är UUID. Externa identiteter (Eventor, IOF) lagras med källsystem och används aldrig
som primärnyckel.

## Resultatutvärdering

`evaluateCardReadout(readout, snapshot)` gör ingen I/O och läser inget globalt tillstånd. Den kräver bara
bricknummer, valfri start- och målstämpling och stämplingar.

1. Aktiv brickkoppling saknas: `UNKNOWN_CARD`; inget tävlingsresultat skapas. Den lagrade avläsningen kan
   sedan kopplas uttryckligen (direktanmälan eller befintlig deltagare); kopplingen lägger till en revision
   och ändrar aldrig råmeddelandet eller den första bedömningen.
2. Starttid väljs från startstämpling när klassens startsätt är `PUNCH`, annars från deltagarens fasta
   starttid. Saknar en löpare med fast start lottad tid används startstämplingen (notis "starttid från
   startstämpling"). En startstämpling mer än `START_PUNCH_TOLERANCE_MS` (60 s) före eller efter den lottade
   tiden är en varning i avläsningen, deltagarkortet och arbetsytans resultatlista, aldrig publikt; den lottade
   tiden gäller (motor 0.4.0, PLAN.md steg 25).
3. Målstämpling krävs för en sluttid. Saknad start eller mål ger `MP` med stabil förklaringskod.
4. Kontroller matchas som en ordnad delsekvens. Extra stämplingar ignoreras för godkännandet men redovisas. Motor 0.6.0
   (steg 45): vid lika många matchade kontroller väljs stämplingar mellan start och mål (oröjd bricka med ett varv tidigare
   samma dag), så att sträcktiderna finns; antalet matchade avgör först, så ingen blir felstämplad av regeln. Ett godkänt
   utan sträcktider varnas i avläsningens besked.
5. Saknad obligatorisk kontroll ger `MP/MISSING_CONTROL`.
6. En obligatorisk kontroll som är stämplad men bara utanför sin plats i följden (före föregående matchade
   kontroll eller efter en senare obligatorisk kontroll) ger `MP/WRONG_ORDER`. En extra stämpling av en
   kontroll som också finns på rätt plats påverkar inte bedömningen (motor 0.3.0, PLAN.md steg 22).
7. Om banan kräver samma kod flera gånger måste lika många förekomster matchas i rätt ordning. Övriga
   förekomster (även dubbelstämplingar vid kontroller som återkommer i fjärilsslingor) redovisas som extra.
8. Ett godkänt resultat får status `OK`; löptid och sträcktider räknas i hela millisekunder från vald start
   till kontroller och mål.
9. Har klassen maxtid (`class.max_time_minutes`, inte rogaining) och ett annars godkänt resultat har längre
   löptid blir det `OVERTIME/MAX_TIME_EXCEEDED`: tid och sträcktider står kvar, ingen placering, ordnas direkt
   efter godkända och exporteras som IOF `OverTime`. Exakt maxtid är godkänt; felstämpling går före. En rättad
   start- eller måltid avgör maxtiden på nytt.

10. Okänd bricka (PLAN.md steg 29): `rankClassesByCourseFit` jämför stämplingarna mot varje klass bana med samma
   bästa-passning som gafflingar (godkänd först, sedan färst saknade kontroller; struken kontroll krävs inte; gafflad
   bana: bästa varianten) och vid lika den bana som förklarar flest stämplingar, sedan klassnamnet. Rogainingklasser och
   banor utan kontroller ingår inte. Det är bara ett förslag; ingen koppling eller anmälan görs utan arrangörens val.

11. Rättningar för hela tävlingen (PLAN.md steg 31, motor 0.5.0) läggs på brickans tider på ett ställe,
   `prepareReadoutForEvaluation`, innan bedömningen: en tidsjustering per station (start, mål eller kontrollkod) ändrar
   stämplingstiderna från stationen; en kontroll ur funktion är frivillig på alla banor (även gafflade), ger ingen
   sträcktid, och sträckan räknas från kontrollen före. Den lagrade avläsningen ändras aldrig. Ändringen räknar om alla
   avlästa; en manuellt rättad tid räknas inte om. Steg 45: stationen ALL (alla enheter) gäller start, mål och alla
   kontroller och läggs ihop med en justering för en enskild enhet. Besluten (rättad starttid, manuell tid) utgår från
   tiderna efter justeringen (`preparedReadoutTimes`).
12. Oröjd bricka (steg 31): kontroll-, start- och målstämplingar mer än 12 timmar före avläsningen räknas inte, och
   kontrollstämplingar mer än 10 minuter före brickans clear- eller checkstämpling (från i kväll och inte efter
   startstämplingen) räknas inte. Bara den inledande följden av gamla kontrollstämplingar i brickans minnesordning tas
   bort, så en enstaka kontroll med fel klocka bland kvällens stämplingar räknas som förut. Antalet visas i avläsningens
   besked och deltagarkortet.

Motorn returnerar stabila koder. Svenska texter hör till `apps/web/src/i18n`. Avläsningsskalet kör samma
funktion lokalt; dess besked är preliminärt och serverns revision är auktoritativ.

## Gafflingar (steg 49, ADR-0175)

- En gafflad bana kan ha en struktur (`course_version.forking`): grundföljd med enkla gafflingar (2–4 alternativ) och
  fjärilar (2–4 slingor från en central kontroll, alla ordningar), i följd. Varianterna genereras ur strukturen, högst 100;
  koderna följer OCAD/Purple Pen (bokstäver i följd över gafflingspunkterna, fjärilens slingor i springordning utom sista).
- När en struktur sparas behåller en löpare sin kontrollföljd under den nya koden; försvinner kontrollföljden får löparen
  en ny variant genom fördelningen (avläst: den som stämplingarna passar). Omräkning i samma transaktion som sparandet.
- Varianter utan struktur (banfil) får en härledd struktur för bilden; den kan sparas ("Gör om till struktur") när den
  klarar reglerna.
- Rättvisekontroll per gafflingssätt (`course.forking_mode`): Utjämnad varnar för varje sträcka som inte finns lika många
  gånger i alla varianter; Fulgaffling gör sträckor i enkla gafflingars alternativ till en upplysning. Kontrollen stoppar
  aldrig sparande, lottning eller avläsning.
- Sträcktidsanalysen för en gafflad klass jämför varje kontrollpar mellan alla som sprungit det (`buildLegSplitTable`);
  per variant (`splitTablesByVariant`) är ett val.

## Banhemlighet (steg 52, ADR-0176)

- Banorna (gafflingsbilden, kontrollernas lägen och kontrollkartan) är publika när arrangören valt "Visa banorna publikt
  nu", när resultaten är fastställda eller när det finns deltagare och alla ej strukna har ett resultat eller beslut (även
  ej start; ett borttaget beslut räknas inte). Utan deltagare är de hemliga. Läget räknas vid varje fråga (`courseSecrecy`).
- Innan dess visar inget publikt svar gafflingsbilden eller kontrollägen; variantkoden och sträcktiderna står kvar.
  Arrangören och funktionärerna ser allt. Valet sparas med en auditpost och går att ångra.

## Statusbeslut

- Arrangören kan sätta ej start, ej fullföljt, disk, utom tävlan, deltog utan tid, godkänt manuellt samt
  ändra start- eller sluttid. Alla beslut går genom ett flöde (`setEntryStatus`) och lägger till en ny
  revision med orsak och aktör (kontot).
- Ett återtagande är också en ny revision; den återställer det tidigare utfallet men räknar inte om.
- Steg 31: beslut ligger som en stapel ovanpå avläsningarna och följer med över ny avläsning och omräkning (disk,
  godkännande, brutit, utom tävlan, deltog utan tid, rättad mål- och starttid, manuell tid och godkända kontroller); ett
  återtagande tar bort det översta. Bara ej start ersätts av en senare avläsning. Nya beslut bygger på senaste tekniska
  bedömningen under besluten. Manuell tid (`MANUAL_TIME`) bedömer avläsningen med arrangörens start- och måltid (eller
  bara tiden utan avläsning) och arrangörens status; tas ett beslut utan avläsning bort blir det inget resultat
  (`MANUAL_RESULT_REMOVED`). Brutit går utan avläsning. Orsaken sparas i `result_revision.note`.
  Historiken för en löpare är dess revisioner; det finns inga separata besluts- eller återtagandetabeller.
- Ett beslut bär löparens senaste revisionsnummer (`expectedRevision`). Har en annan revision tillkommit sedan
  formuläret öppnades avvisas beslutet (konflikt), och arrangören får se det nya läget. Tävlingens version
  jämförs inte (steg 23).
- Steg 35: disk, utom tävlan (`OOC`) och "Deltog utan tid" (`NT`, tidigare "utan tidtagning") går med och utan avläsning,
  precis som brutit. Utom tävlan behåller avläsningens tid och sträcktider men placeras aldrig; utan avläsning har den
  ingen tid. Deltog utan tid har aldrig tid (steg 38: med avläsning sträcktiderna), visas som "Deltog" sist i klassen (efter
  ej start) och exporteras i IOF XML som `NotCompeting` utan `Time` (steg 38: med avläsningens sträcktider) (IOF 3.0 har ingen egen status;
  `Finished` betyder "inte kontrollerad ännu"). Ett gällande beslut utan avläsning räknas som i mål i kvar i skogen.
  Tas ett beslut utan avläsning bort blir det inget resultat (`MANUAL_RESULT_REMOVED`).
- Steg 38: brutit, disk, utom tävlan och deltog utan tid med avläsning behåller avläsningens start och sträcktider fram
  till sista stämplade kontrollen (utan målstämpling bedöms avläsningen med ett mål långt efter starten), men aldrig mål,
  löptid eller placering. IOF: DidNotFinish respektive NotCompeting med SplitTime (banans övriga kontroller "Missing"),
  utan Time. Utan avläsning är besluten bara status.
- Steg 38: "Bekräfta felstämplad" (`MANUAL_MISPUNCH_CONFIRMATION`, valfri orsak i `note`) är ett beslut ovanpå en
  felstämplad bedömning med samma utfall (MP med sträcktider); "Ta bort bekräftelsen" är återtagandet. Det ligger kvar
  över ny avläsning och omräkning som andra beslut. En bekräftad felstämpling (och manuell tid som felstämplad) räknas inte
  som "att titta på"; felstämplade stoppar aldrig "Resultaten är klara".
- Steg 45: disk och utom tävlan går även ovanpå en manuell eller rättad tid (att ta bort dem återställer den manuella tiden).
  Ett kvarliggande beslut som döljer en senare avläsning med annat utfall (`decisionHidingReadout`) visas som "Beslut att se
  över" i deltagarkortet, kopplingskvittot och Efterarbete; samma avläsning igen ger inget besked.
- Disk kan ha en valfri orsak (`result_revision.note`, bara på `MANUAL_DISQUALIFICATION`); den syns bara för
  arrangören. Publikt står "Disk." och orsaken exporteras inte.
- "Markera alla kvar i skogen som ej start" (Resultat) sätter ej start på alla utan avläsning och beslut, efter
  en förhandsvisning och en bekräftelse; den som stämplat vid radio eller prickats av vid starten listas för
  kontroll i stället. Samma begäran igen ändrar inget.
- "Resultaten är klara" (PLAN.md steg 27) fastställer i en transaktion varje klass med anmälda vars senaste fastställande
  inte stämmer och sedan hela loppet, och loppet pekar på det (`race.official_result_finalization_id`). Listorna är
  "Officiella resultat" så länge varje icke struken löpares senaste revision är den fastställda; annars preliminära tills
  arrangören trycker igen. "Gör resultaten preliminära igen" nollställer bara pekaren. Steg 38: varje avgjort resultat kan
  fastställas, även manuell tid, rättad tid och godkända kontroller; bara oklart stoppar (saknat resultat, inaktuellt
  underlag, okänd bricka, ogiltig revision), och hindret anges per löpare. Klassvis fastställande finns under
  Avancerat. Fastställda resultat fryses och senare revisioner ändrar inte en fastställd export.
- Ta bort och stryk (steg 27): en deltagare utan resultatrevision tas bort helt med det som bara hör till den (journaler,
  brickkoppling), och en lottad tid blir vakant igen. Med en revision (avläst, beslut) stryks deltagaren i stället:
  `entry.struck_at` döljer den i alla listor, avläsningspaketet, lottning, kvar i skogen, speaker, IOF-export och
  fastställande, och brickan släpps. Revisionerna och de råa avläsningarna står kvar. Eventors "struken" ger fortfarande
  ej start (ADR-0170 beslut 4). En klass utan anmälda och en bana som ingen klass använder och inget resultat bedömts mot
  kan tas bort.

## Stafett (ADR-0169 beslut 3, ADR-0174)

Koden finns i `packages/domain/src/relay.ts`, `relay-starts.ts`, `relay-forking.ts`, `relay-parallel.ts` och `team-sprint.ts`.

- En sträcka springer sin egen bana (`relay_leg.course_version_id`) eller klassens; `entryCourseVersionId` är regeln.
  Underlagshashen använder sträckans bana.
- Startsätt per sträcka: masstart, växling, omstart (fast tid) och flygande omstart (ledarlagets växling till sträckan plus
  en gräns i minuter; ledaren är första laget som växlade, oavsett status). Sträcka 1 är masstart. Starterna räknas för
  hela klassen (`relayClassLegStarts`) och sparas som sträcklöparens fasta starttid; ändrad start räknar om sträckan.
  Saknad avläsning eller brutit utan mål på föregående sträcka ger omstartstiden.
- Lagets tid är summan av sträcktiderna. Ett lag är godkänt när alla sträckor är godkända. Lag som deltagit i omstart
  placeras efter lag med enbart vanliga växlingar (SOFT TR 5.8.2, förval) eller efter tid med övriga (klassinställning).
- Gaffling per klass: utjämnad (rättvisa kombinationer, varning per lag som inte springer samma kontrollsträckor som de
  flesta) eller fulgaffling (jämn spridning, bara upplysning). Fördelningen är deterministisk med klassens frö.
- Ändrad stafettklass eller variant: ändringen görs och avlästa sträckor med ändrat underlag räknas om i samma
  transaktion; byter någon status visas först ett besked. En sträcka med resultat tas inte bort. Ett lag utan resultat tas
  bort helt; med resultat stryks det (`team.struck_at`, sträcklöparnas `entry.struck_at`).
- Upp till 30 sträckor.
- Flera löpare per sträcka (2–4, `relay_leg.runners`; löparens ordning `entry.relay_leg_order`, NULL = 1): sträckan växlar
  när första i mål (förval) eller sista i mål (när alla har ett resultat, senaste måltiden) och är godkänd när alla är
  godkända (förval) eller minst en. Sträckans tid är från sträckans start till växlingen.
- Teamsprint (`class.relay_readout_mode`, NULL = ingen): en bricka per löpare (sitter på löparens första sträcka; övriga
  sträckor pekar på den med `entry.relay_card_entry_id`).
- Teamsprint med utläsning efter varje sträcka (`EACH_LEG`, förval, som MeOS): varje utläsning går till löparens första
  sträcka utan resultat och bedöms mot stämplingarna efter föregående utläsnings mål och brickans mål; sträckans start är
  föregående sträckas växling. Samma måltid igen är en omläsning; en tidigare måltid eller en utläsning när alla sträckor
  har resultat blir en okänd utläsning med besked. Glömd utläsning: delas vid växlingskontrollen om klassen har en, annars
  efter banorna i tur och ordning – då får bara sista sträckan resultat och de tidigare visas som "Utläsning efter
  sträcka X saknas" tills manuell tid. Vilken utläsning varje sträcka bygger på står i sträckans resultatrevision.
- En stafettsträcka som saknar start för att föregående sträcka saknar växling (`MISSING_START`) räknas som ute i
  lagresultatet, inte som felstämplad.
- Teamsprint med utläsning efter sista sträckan (`LAST_LEG`, steg 48): avläsningen delas vid klassens växlingskontroll (`class.relay_changeover_code`, dubbel
  stämpling inom 60 s räknas en gång); del j bedöms mot löparens j:e sträcka från sträckans start och slutar vid den j:e
  växlingsstämplingen, lagets sista sträcka vid målet. Saknad växlingsstämpling: delen får inget mål (felstämplad) och
  beskedet "Växlingsstämpling saknas".
- Klassynken upprepas tills inga starter ändras: en omräknad sträcka kan få ett mål och ge nästa sträcka en start.

## Lottning

Koden finns i `packages/domain/src/start-draw.ts` (ordningen inom en klass i `start-draw-order.ts`). Samma underlag och
samma frö ger alltid samma tider.

- Minutstart: löparna blandas med fröet (en egen ström per klass), klubbsepareras och får tider med klassens intervall.
  Vakanser sprids jämnt. Masstart: alla i klassen får samma tid.
- Startgrupp: klasser vars banor börjar med samma 1–3 kontroller ("Startgrupp avgörs av de första N kontrollerna",
  standard 1) startar aldrig samma minut. En gafflad bana har en följd per variant; klasser hör till samma grupp om
  **någon** variant delar början (den säkra regeln), och grupperna slås ihop i kedja.
- Startfålla: klasser vars banor (någon variant) har samma första kontroll. Tak per minut gäller totalt och per fålla;
  varje minutstart och vakant tid räknas, en masstart som en start. Med en kontroll som avgör är fållan och gruppen samma.
- Klasser som inte lottas behåller sina tider (löpare och vakanta tider) och de nya tiderna läggs runt dem. Klasser med
  senare start (klockslag eller minuter efter första start) placeras först, på sin tid eller första tillåtna minut efter
  (varning); övriga fyller runt dem i egen ordning eller automatiskt (masstart först, sedan största klassen).
- Seedade löpare (`entry.seed_rank`, 1 = bäst) lottas sist i klassen med bäst sist, eller jämnt utspridda med bäst sist;
  övriga lottas fritt före. Ranking kan läsas från en CSV-fil (bricka, annars namn och klubb).
- Regelbrott som inte går att undvika (sista start räcker inte, senare start flyttad, befintliga tider över taket eller i
  samma grupp samma minut) är varningar i förhandsvisningen, aldrig fel. Inställningarna sparas med lottningen
  (`race.start_draw_settings`).
- Efteranmäld i lottad klass: första lediga vakanta tid, annars första minut efter klassens sista start som ingen annan
  klass med samma första kontroll använder.

## Revisionsregler

- En ny avläsning skapar en ny revision när brickan är känd. Steg 31: har brickans deltagare redan ett resultat från en
  annan avläsning av brickan och brickan använts i ett nytt lopp efter den avläsningens mål, blir den nya avläsningen
  okänd ("redan avläst för X – lånad bricka?") och den förstes resultat står kvar. Kopplas den till någon annan flyttas
  brickan; omräkning utgår från deltagarens egen avläsning (resultatet följer avläsningen, inte brickan), utom när
  deltagaren fått en annan bricka sedan dess. Steg 45: brickans senaste avläsning används bara om ingen annan deltagares
  resultat bygger på den; annars NO_READOUT.
- Ändrad bana, redigerad klass, ny lottning och ändrad starttid räknar om berörda löpares avlästa resultat
  med en ny revision (`EXPLICIT_RECALCULATION`) och en auditpost; tidigare revisioner skrivs aldrig om.
- Revisionen lagrar motorversion, avläsningspaketets version (`snapshot_version`), banversion, orsak och
  underlagshash. Paketversionen höjs bara när avläsningspaketets innehåll ändras; underlagshashen per löpare
  (ADR-0169) avgör om ett resultat är aktuellt.
- Placering och tid efter lagras inte; de härleds från de senaste publicerade revisionerna i klassen.
- Samtidig mottagning och omräkning serialiserar nästa revisionsnummer per deltagare (deltagarraden låses).

## Import

- IOF `EntryList` innehåller anmälan men ingen starttid, och `CourseData` klass–bana men inget startsätt.
  Nya klass–ban-kopplingar börjar därför som `PUNCH`.
- En individuell `StartList` får sätta klassen till `FIXED` och varje täckt deltagares starttid (med
  UTC-offset). Namn används aldrig som identitet.
- Dubbla klass- eller bannamn i samma tävling avvisas.

## Immutabilitet

Applikationslagret erbjuder ingen ändring eller borttagning av råmeddelanden, banversioner,
resultatrevisioner, importfiler eller journaler. Databasen avvisar `UPDATE` och `DELETE` på dessa tabeller
med triggers. Undantagen körs med purge-flaggan (`otid.purge`) i samma transaktion: superadminens borttagning av en
hel tävling eller ett konto, och (steg 27) borttagning av en deltagare, klass eller bana, där resultatrevisioner,
avläsningar, råa meddelanden och fastställanden är skyddade och stoppar borttagningen.

## Publik resultatidentitet

`Entry.publicResultId` är en slumpmässig, stabil visningsidentitet för en publik resultatlänk. Den är inte
Entryns interna UUID, bricka eller behörighet. Publika svar väljer uttryckliga fält; interna id:n, rådata och
audit ingår aldrig.
