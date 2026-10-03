# O-Tid: aktuell produktmålplan

Datum: 2026-09-23. Detta är det samlade **arbetsmålet**, inte ett accepterat
ADR eller ett påstående om att funktionerna nedan är implementerade. Varje
etapp blir en eller flera små TASK-filer när arbetet når dit. Den äldre, mer detaljerade
[projektgenomgången](project-review-and-plan-2026-09-19.md) är historiskt underlag;
[funktionsmatrisen](meos-feature-matrix.md) följer format och arbetsflöden. Vid
konflikt gäller accepterade ADR:er, kod och verifierad status framför denna plan.

## Produktmål

O-Tid ska vara ett kraftfullt men lättanvänt tävlingssystem där arrangören kan
arbeta på dator, funktionärer på lämplig mobil eller station och deltagare/publik
på sina egna enheter. Servern är gemensam sanning; avläsning och nödvändiga
operativa mobilflöden ska tåla nätavbrott. Svenska vyer ska vara informationstäta
utan onödig scroll, och kritiska tillstånd ska synas utan att enbart färg används.

### Arbetsmålet i tydliga delar

Detta är checklistan att arbeta mot. En ruta bockas av först när **hela**
användarresan har det bevis som anges, inte när en enskild skärm eller ett
syntetiskt test blir grönt. Detaljer, beroenden och hittillsvarande delbevis
finns i A–E nedan. Status för de sex rutorna är för närvarande **öppen**;
flera underfunktioner är syntetiskt verifierade men ingen är fältklar.

- [ ] **1. Arrangera tillsammans:** en inloggad ägare skapar/återöppnar en
  tävling, ger och återkallar medadministratörsrätt för just den tävlingen.
  Vanliga ändringar, inklusive platskontrollerat klassbyte, fungerar i en
  kompakt arbetsyta på dator och lämplig mobil. Kontoinförande, återställning
  och faktisk behörighetsgräns är prövade på riktiga enheter (A1–A3).
- [ ] **2. Genomföra en individuell tävling:** blandad fri/minutstart, riktig
  SPORTident-avläsning, offline start/mål, synk, avvikelser och kvar-i-skogen
  fungerar sammanhängande. Backup/restore och en liten pilot har oberoende
  facit; ingen deltagare försvinner tyst vid nätavbrott (D1).
- [ ] **3. Följa tävlingen utan konto:** startlista, live-/slutresultat,
  sträcktider och deltagardetalj är läsbara på dator och fysisk mobil, med
  begriplig status vid avbrott och återanslutning. Publik åtkomst kräver
  varken konto eller operatörsrätt (befintlig publikvy + D1-pilot).
- [ ] **4. Vara inloggad deltagare:** rätt konto hittar enbart sina verifierade
  anmälningars publicerade resultat och kan följa/avfölja andra **offentliga**
  resultat; valen finns kvar mellan enheter. Fel konto och återkallad koppling
  ger inte privat åtkomst (B1–B2 samt A3:s kontoinförande).
- [ ] **5. Se och skapa egna spår:** deltagaren ser en exakt privat rutt på
  bevisad karta/bana, med analys enbart av uppmätta data, och kan spela in
  och synka privat GPS från en uttryckligen verifierad mobilklient under
  loppet. Publicering kräver separat samtycke/släpp; inspelning får inte
  innebära publik liveposition (C1–C3).
- [ ] **6. Bredda tävlingsformer:** välj en faktiskt efterfrågad form i taget
  och verifiera dess egna regler från förberedelse till resultat. MeOS-
  likvärdighet bedöms per arbetsflöde i funktionsmatrisen, aldrig som ett
  generellt löfte för ännu oprövade format (E1, E2 …).

**Arbetsordning:** sikta först på del 1–3 som en individuell fältpilot och
verifiera del 4 på riktiga deltagarenheter. Del 5:s privata rutt kan redan
prövas, medan fysisk GPS kräver en egen mobilgrind. Del 6 upprepas först när
ett konkret format valts. Hårdvara och återställning i del 2 är parallella
fältblockerare, inte något som får skjutas upp till efter fler skärmar.
För varje del används nivåerna planerad → implementerad → syntetiskt
verifierad → fysiskt/fältverifierad; endast den sista nivån bockar av rutan.
Nästa minsta D1b-snitt och de oberoende A-/C-spåren anges längst ned i planen.

Tre produktnivåer visar vad checklistan sammantaget ska leda till. ”Alla typer”
är ett långsiktigt riktmärke, inte ett löfte om att en generell regelmotor redan
täcker ospecificerade format:

| Nivå | Vad användaren faktiskt kan göra | Grind för att markera nivån klar |
| --- | --- | --- |
| 1. Sammanhängande individuell pilot | Arrangör och medadministratör förbereder och driver ett litet individuellt lopp; start/mål kan arbeta vid nätavbrott; publiken ser resultat utan konto. | D1:s riktiga avläsning, återställning och dokumenterade start–mål–resultat-pilot. Syntetiska A/B-prov räcker inte. |
| 2. Användbar deltagarprodukt | Deltagaren kommer åt sitt konto och sina verifierade resultat på mobil/dator, följer valda offentliga resultat och kan se respektive spela in en privat rutt utan oavsiktlig publicering. | A3:s fungerande kontoinförande, B1/B2, C2 och C1 på uttryckligen verifierad mobilklient; tydlig privat/offentlig gräns och användarprovning. |
| 3. Bred tävlingsprodukt | Ytterligare efterfrågade tävlingsformer och MeOS-likvärdiga vardagsflöden fungerar utan att tävlingen blir svåröverskådlig. | En hel acceptansresa per format/flöde i funktionsmatrisen; inte en generell stödetikett för oprövade varianter. |

Nivåerna är målgrindar, inte en strikt byggordning: C2 kan levereras före C1,
och D1:s fältblockerare ska bearbetas parallellt. Servern ska kunna användas via
mobil och dator över nätet, men stations- och kritiska funktionärsflöden måste
fortsätta lokalt när förbindelsen bryts. En grön lokal browserkörning är inte
ett bevis på säker eller fungerande internetdrift.

### Sex avprickningsbara delmål

Det här är avprickningsbara **användarresor**, inte sex nya tekniska plattformar.
En del får status `fältverifierad` först när dess sammanhängande resa, relevanta
felväg och verkliga enheter/drift är provade. `Syntetiskt verifierad` betyder
att avgränsade kod-, PostgreSQL- eller browserprov har passerat; det betyder
inte att arrangören kan köra en riktig tävling. Delarna kan utvecklas parallellt
där deras beroenden tillåter det, men varje TASK ska ha ett enda litet utfall.
Varje del avprickas med datum, provad enhet, oberoende facit och kvarvarande
begränsningar. Del 1–3 bildar den första sammanhängande individuella piloten;
del 4–5 gör den användbar för inloggade deltagare, medan del 6 upprepas för
varje konkret vald tävlingsform. Ingen del får ett allmänt ”klart” av ett
syntetiskt delprov.

| Del | Mål för användaren | Läge nu | Nästa bevis för att kunna bocka av |
| --- | --- | --- | --- |
| 1. Arrangera tillsammans (A1–A3) | Logga in, skapa och återöppna sin tävling, bjuda in och återkalla medadministratör; behöriga gör vanliga ändringar i samma kompakta arbetsyta. | A1/A2 och betrott A3-kontoinförande är syntetiskt verifierade. Klassbyte tävlingsklass↔öppen med platskontroll finns. | Pröva identitetskontroll, privat kodöverlämning, inloggning/återställning och återkallelse på verklig mobil/dator. Visa att administratören hittar och kan rätta en vanlig uppgift utan parallell funktionsinloggning. |
| 2. Genomföra individuell tävling (D1) | Förbered blandad fri/minutstart; start och mål arbetar även vid nätavbrott; verklig brickavläsning, avvikelser, kvar-i-skogen, resultat och restore hänger ihop. | Resultatmotor, offlinekö och start-/målavprickning finns. TASK137/169/170 bevisar isolerad MinIO-/PostgreSQL-historik tillsammans; TASK171–177 ger privat syntetisk capture, versionsbevarande objektsväg och kvittens. TASK178 återställer samma kedja till nytt tomt mål; TASK179 återöppnar den i separat process. Ingen betrodd operatörsåtgärd, tekniskt skrivstopp eller fältacceptans finns. | Bevisa först skrivstopp och exklusiv regelkontroll, bind därefter en fail-closed operatörsåtgärd. Pröva internet/mobil, verifiera en namngiven SPORTident-kort/station-kombination och kör sedan en 30–100-personers pilot med oberoende facit. Utan detta är individuell orientering inte fältklar. |
| 3. Visa tävlingen öppet (befintlig publikvy) | Oinloggad hittar aktuell startlista, live-/slutresultat, sträcktider och deltagardetalj på mobil eller dator utan konto. | Publika vyer och avgränsad liveuppdatering finns; fysisk mobil och verklig tävlingsdrift är inte accepterade. | Prova samma publicerade resultatkedja på riktiga enheter under piloten, även vid avbrott/återanslutning. Skilj preliminärt live från fryst slutresultat och ge en begriplig väg tillbaka när sök/filter ger tomt. |
| 4. Ge deltagaren ett eget läge (B1–B2) | Inloggad deltagare ser **sina verifierade anmälningars publicerade resultat** och väljer offentliga deltagare att följa; valen följer kontot mellan mobil och dator. | B1/B2 är syntetiskt verifierade. Anonyma favoriter finns separat i webbläsaren. | Pröva kontoinförande och exakt anmälningskoppling på verkliga enheter, samt fel konto, återkallad koppling och att följning aldrig öppnar privat data. Publikläget ska fortsätta fungera utan inloggning. |
| 5. Visa och skapa egna spår (C1–C3) | Deltagaren ser sin privata rutt på rätt karta/bana, kan förstå mätta sträcktider och senare spela in/synka privat GPS under loppet. Publicering kräver separat samtycke och släpp. | C2a–c/C3a–d och uppladdning är syntetiskt verifierade; C1a har kod men saknar native-/telefonbevis. Ingen automatisk GPS-kontrollpassage är bevisad. | Slutför C1a:s nativegrind före C1b; bygg därefter konto-/anmälansval, privat idempotent synk och fysisk GNSS-/skärmlås-/offlineacceptans på vald Androidtelefon. Pröva riktig objektlagring och kartprecision separat. |
| 6. Bredda format utan att tappa enkelheten (E1, E2 …) | Arrangören väljer en efterfrågad tävlingsform och kan förbereda, genomföra och publicera den med egna korrekta regler. | Individuell orientering är huvudspåret; stafett, poäng, flerdagars och andra varianter är inte generellt stödda. | Välj **en** form efter arrangörsbehov, besluta domängränsen i ADR och acceptera ett representativt lopp från start till resultat innan nästa form tas in. Bedöm MeOS-likvärdighet per arbetsflöde i funktionsmatrisen. |

Den korta genomförandeordningen är: få del 1–3 att fungera tillsammans i en
individuell pilot och verifiera del 4 på verkliga deltagarenheter; leverera del
5:s privata upplevelse och fysiska GPS-klient
utan att vänta med del 2:s fältblockerare; välj först därefter nästa konkreta
format i del 6. Detta är en prioritering av **bevis**, inte ett krav på att
bygga om allt i ordning. För varje del redovisas `planerad` → `implementerad`
→ `syntetiskt verifierad` → `fysiskt/fältverifierad` med datum och kvarvarande
antaganden. Ett grönt test för en underfunktion flyttar inte hela delmålet.

TASK168 levererade därefter en liten, oberoende produktförbättring i del 3:
en publik besökare kan rensa aktiva resultatfilter direkt från ett tomt
sökresultat. Det är endast ett syntetiskt verifierat UI-snitt; det ersätter
inte C1a:s nativegrind eller D1:s fältbevis.

MeOS är en funktions- och användbarhetsreferens, inte källkod eller UI-mall.
Kartor och rutter ska vara O-Tids egna, utan Livelox-data eller beroende.
Likvärdighet ska bedömas per verkligt arrangörsflöde i
[funktionsmatrisen](meos-feature-matrix.md), inte genom att räkna skärmar eller
kopiera gränssnitt. En form eller enhet märks inte som stödd förrän dess
sammanhängande arbetsflöde har klarat angiven acceptansnivå.

## Utgångspunkt och öppna luckor

- Individuell tävlingskärna, blandad fri/minutstart, revisionsbaserade resultat,
  offentlig resultatsida, lokala browserfavoriter, administrativa roller via
  kortlivade credentials, Androidstationsskal och offlinekö finns i avgränsade
  former. Detta är inte en uppmätt produktionstävling.
- A1/A2 har infört ett beständigt konto, eventägarskap och återkallelig
  medadministration. A3a har syntetiskt verifierad betrodd engångsinbjudan
  med mottagarstyrd aktivering; A3b låter eventets OWNER skapa och spärra
  ett nytt kontos kod i browsern men ger ADMIN först efter separat A2-grant.
  A3c/TASK161 har dessutom syntetiskt verifierad betrodd återställning av
  befintligt lösenord. Verklig identitetskontroll/kodöverlämning och
  självregistrering saknas. Äldre
  racebundna operatörsbehörigheter blir inte automatiskt konton. Se
  ADR-0144, ADR-0145, ADR-0152 och ADR-0153.
- `publicResultId` är en publik länkidentitet, inte bevis på deltagarägarskap.
  B1:s separata anmälningskoppling är beslutad i ADR-0146 och TASK152 är
  syntetiskt verifierad; kontosäker överlämning ska redovisas separat.
- B2/TASK153 har syntetiskt verifierad kontosynkad följning av **publika**
  resultat. Anonyma favoriter ligger fortfarande lokalt i webbläsaren och
  förs inte tyst över till kontot. Följning ger ingen rätt till privat data.
- Privat GPX-filuppladdning, samtycke och begränsad eftertävlingsjämförelse
  finns. C1a har kod för en separat lokal Android-GPS-inspelare, men nativebygge
  och fysisk inspelning är ännu inte verifierade; kontosynk, OMAP-import och
  full spåranalys saknas. Ett inspelat spår får aldrig automatiskt bli publik
  liveposition.
- En lagrad privat GPX är knuten till exakt anmälan och uppladdningsversion.
  TASK155 kan nu dessutom binda en **uttryckligen vald** kart-, georeferens-,
  geometri- och historisk ban-/resultatversion för deltagarens privata
  efterloppsvy. Det är syntetiskt verifierat, inte bevis för kartprecision,
  verklig objektlagring, fysisk mobil eller att rutten är offentlig.
- ADR-0155/TASK162 har syntetiskt verifierat relativ uppspelning av samma
  exakta **privata** GPX-version när alla källtider är kompletta och monotona.
  Saknas tidsbevis visas rutten utan uppspelning. Detta mäter inte
  kontrollpassager eller sträcktider.
- ADR-0156/TASK163 har syntetiskt verifierat en separat läsning av den
  aktuella effektiva publicerade resultatrevisionens sträcktider för samma
  anmälan och bana. Även publicerade tider kan vara preliminära; de
  linjerar inte GPS-markören mot kontroller.
- ADR-0157/TASK164 har syntetiskt verifierat en tillfällig manuell
  GPX-klockjustering mot samma anmälans aktuella publicerade resultatstart.
  Den flyttar bara uppspelningsmarkören inom faktisk GPX-tidsserie och
  varken rättar resultat eller bevisar fysisk start/kontrollpassage.
- ADR-0158/TASK165 har syntetiskt verifierat ett tillfälligt val av en
  publicerad kontrolltids **tidpunkt** på samma privata GPX-tidslinje.
  Utanförliggande tid klampas inte och en segmentlucka ger ingen påhittad
  kartposition eller verifierad kontrollpassage.
- Verklig SPORTident-parser/avläsning och end-to-end backup/restore är
  fältblockerare. Syntetiska prov eller delbevis får inte benämnas som full
  hårdvaru- eller driftacceptans.
- D1b har nu tre syntetiska kompatibilitetsbevis: TASK137 läser två
  historiska PM-versioner från en ny MinIO-målinstans efter resync och
  regelrensning; TASK169 återställer en riktig PostgreSQL-dump till en ny tom
  databas; TASK170 binder **samma** historiska PM-referens till **samma**
  återställda databashistorik med vanlig målläsare. Ingen samordnad
  produktionsbackup, driftsatt restore eller fältacceptans är därmed klar.
- TASK171 lägger till den första verkliga privata dump-skrivporten och provar
  dess bytes i TASK170:s syntetiska restorekedja. Källpreflight, mål-/regel-
  portar och en återstartsbar operatörsåtgärd är fortfarande separata grindar.
- TASK172 kopplar privat state, samma verkliga dump och källans läsande
  migrations-/PM-preflight i ett syntetiskt källbevis. Det stannar uttryckligen
  på `TARGET_PREPARATION_PENDING`; inget operativt backupkvitto finns.
- TASK173 kontrollerar ett explicit nytt, tomt versionerat MinIO-mål före
  regelstart i samma syntetiska kedja. Portens fristående färskhetsintyg
  är inte i sig en återstartsbar provisionerings-/exklusivitetsgaranti.
- TASK174 binder källbeviset till en egen ny lokal pinnad MinIO-målmiljö och
  provar reservation/bindning med abrupt workerkrasch. Det ger lokalt
  syntetiskt målbevis, inte produktions-TLS eller färdig backup; ett av två
  source-only-försök stannade säkert före målstart av ännu okänd orsak.
- TASK149 (delning av redan publicerade ruttlänkar) är syntetiskt verifierad
  i arbetskopian: exakta deltagar- och jämförelselänkar, neutral felåterkoppling,
  390 px samt bygge. Verklig Web Share-dialog på fysisk mobil återstår som
  fältantagande, inte som krav för detta snitt.

## Etapper och beroenden

| Etapp | Användbart delmål | Avprickningsbar effekt | Beror på | Läge 2026-09-23 |
| --- | --- | --- | --- | --- |
| A1 | Inloggad arrangör skapar, hittar och öppnar sin tävling | Samma konto återöppnar eventet efter ny session; annat konto nekas | Befintlig event- och raceadministration | TASK150 syntetiskt verifierad 2026-09-23; riktade tester och berörd lint/typecheck/build gröna efter sista ändringen; inte fältklar |
| A2 | Ägare ger och återkallar medadministration för ett redan provisionerat konto | ADMIN kan arbeta i rätt event, inte i ett annat; återkallelse stoppar även gammal session | A1 | TASK151 syntetiskt verifierad 2026-09-23; inte fältklar |
| A3 | Arrangör och deltagare får ett användbart kontoinförande | Betrodd inbjudan/överlämning och återställning fungerar utan att mottagaren får operatörens credential; konto och exakt deltagarkoppling kan spärras | A1/B1:s befintliga gränser | A3a/TASK159, A3b/TASK160 och A3c/TASK161 syntetiskt verifierade; verklig identitetskontroll/överlämning och fysisk acceptans saknas |
| B1 | Inloggad deltagare ser verifierat eget resultat på valfri enhet | Verifierad anmälningskoppling ger samma egna resultat efter inloggning på annan enhet; fel konto nekas | Kontobas från A1; separat anmälningskoppling | TASK152 syntetiskt verifierad 2026-09-23; inte fältklar; kontoöverlämning/återställning är inte prövade i verklig drift |
| B2 | Deltagare följer valda publika resultat mellan enheter | Följ/avfölj på mobil syns efter inloggning på dator; anonym lokal favorit fungerar fortsatt | B1 och befintlig publik resultatkälla | TASK153 syntetiskt verifierad 2026-09-23 med 390/1280 px-browserflöde; inte fysisk mobil-/fältklar |
| C1 | Deltagare spelar in och synkar privat GPS-spår i vald mobilklient | Start/stopp, lokal kö och exakt retry fungerar på fysisk målenhet vid nätavbrott och skärmlås | B1, GPS-ADR och faktisk enhetsacceptans | ADR-0151/TASK157 väljer separat Androidapp; C1a/TASK158 har lokal kod och 5 riktade webbtester, men nativebygge och fysisk verifiering återstår. C1b–d är ej påbörjade |
| C2 | Deltagare hittar sin privata GPX efter loppet, får korrekt kart-/bankontext och kan skilja privat vy från uttryckligt publikt släpp | Kontobunden läsning av exakt egen rutt, fail-closed om kart-/banversion inte kan bevisas; endast separat samtycke och släpp gör en exakt version publik | B1 och befintlig GPX-/karta-/samtyckesgräns; kräver inte C1 | C2a/TASK154, C2b/TASK155 och C2c/TASK156 syntetiskt verifierade; verklig objektlagring/kartprecision, fysisk mobil och användarprovning återstår |
| C3 | Efterloppsanalys på egna kartor och uppmätta data | Deltagaren kan förstå verkliga sträcktider, tidsatt rutt där spåret har tider och jämföra uttryckligen kompatibla rutter | C2b och relevanta mätdata; C1 behövs inte för redan tidsatt GPX | C3a/TASK162 uppspelning, C3b/TASK163 resultatsplittar, C3c/TASK164 manuell startlinjering och C3d/TASK165 vald kontrolltidpunkt syntetiskt verifierade; faktisk passage och bredare analys saknas |
| D1 | Individuell tävling fältverifierad med avläsning, offlineväg, internetdrift och restore | Sammanhängande pilot med riktiga enheter och återställning har dokumenterat facit utan dataförlust | D1a hårdvara, D1b drift/restore, D1c pilot kan löpa parallellt med A/B/C; krävs före fältklar | Flera delbyggen finns, sammanhängande acceptans saknas |
| E1, E2 … | En ny tävlingsform per leverans, med egen regel och facit | Ett representativt lopp i vald form kan förberedas, genomföras och publiceras korrekt | Stabil individuell bas och valt arrangörsbehov | Ej vald/planerad |

A1 → A2 och A1 → B1 → B2/C1/C2 är produktberoenden, inte skäl att vänta med
D1:s hårdvaru- och återställningsarbete. En anonym besökare ska under hela
resan kunna se publicerade resultat utan konto. Befintliga stations- och
funktionärsflöden måste fortsätta fungera när konton tillkommer. A3 är en
införandegrind före bred kontoanvändning, inte ett förarbete som blockerar
små syntetiska B/C-snitt.

### Avprickningsbar arbetskö från dagens läge

Detta är ordningen för **en ny användbar leverans i taget**, inte en beställning
att bygga alla rader samtidigt. Statusen avser verifierat utfall, inte hur
mycket kod som finns. D1:s två fältblockerare undersöks tidigt och oberoende av
deltagarvyn.

| Nästa del | Konkret leverans och stoppunkt | Redan känt / återstår |
| --- | --- | --- |
| 0. Arrangörsgrund | Ägare skapar/återöppnar event; ger och återkallar ADMIN i just det eventet. | A1/TASK150 och A2/TASK151 syntetiskt verifierade; fysisk och operativ acceptans återstår. Ingen ny kontoplattform byggs som förarbete. |
| 1. B1 beslut | ADR-0146 och TASK152 avgränsar en återkallelig koppling till **exakt anmälan**; operatören intygar identitet utanför systemet och deltagaren löser in en engångskod i sitt konto. | Beslutat, inte ett påstående om självregistrering, juridiskt vårdnadshavarbevis eller säkert överlämnad kontocredential. |
| 2. B1 fungerande resa | En deltagare med godkänd koppling loggar in på en annan enhet och hittar ”Mitt resultat” med samma publicerade status/sträcktider som i den öppna resultatvyn. | TASK152 syntetiskt verifierad med isolerad PostgreSQL och nytt browsercontext på 390 px. Saknat/opublicerat resultat visas neutralt; fel konto nekas. Fysisk enhet/överlämning återstår. |
| 3. B2 följning | Inloggad väljer/avmarkerar publika deltagare och får samma lista på mobil och dator. | TASK153 syntetiskt verifierad på 390/1280 px och isolerad PostgreSQL. Anonyma lokala favoriter finns kvar; ingen privat resultaträtt. Fysiska enheter återstår. |
| 4. C2a privat ruttåtkomst | Rätt konto listar och öppnar **en uttryckligen vald, lagrad GPX-version** för sin aktiva exakta anmälan efter ny session. | ADR-0148/TASK154 syntetiskt verifierad: lista och faktadetalj, utan karta och utan ny skriv-/publiceringsrätt. Fysisk mobil kvarstår. |
| 5. C2b korrekt kart-/bankontext | Bind exakt GPX-, kart-, georeferens-, geometrirevisions- och publicerad historisk ban-/resultatversion; visa endast pixelrutt och verkliga GPX-mätdata för rätt konto. | ADR-0149/TASK155 syntetiskt verifierad med explicit `MANAGE_RACE`-beslut och immutable kontextjournal. Två GPX-versioner prövade i PostgreSQL; 390 px-browserprovet simulerade endast kartbildsbytestransporten. Inte fysisk mobil eller verklig objektlagrings-/kartacceptans. |
| 6. C2c separat delning | Gör det begripligt vilken privat version som finns och vilken exakt version som efter samtycke och administratörens kart-/ruttsläpp är offentlig. | ADR-0150/TASK156 syntetiskt verifierad: samtycke, administrativt släpp och faktisk offentlig åtkomst visas separat för vald GPX-version. Återtagande stoppar offentlig länk men inte behörigt kontos privata original. Fysisk mobil/objektlagring återstår. |
| 7. C1 GPS i vald app | Start/stopp, lokalt beständigt privat spår och idempotent synk vid nätavbrott på **en uttryckligen vald fysisk mobilklient**. | ADR-0151/TASK157 väljer separat Androidapp. C1a/TASK158 är kodad men ska nativeverifieras före C1b enligt TASK158; Android SDK-licensbeslut, SDK, nativeprov och fysisk enhet återstår. C1b mobilkonto/exakt val får därefter eget ADR/TASK, utan inspelning/synk. C1c privat synk och C1d fysisk acceptans återstår. Ingen automatisk liveposition eller stöddeklaration för oprövade plattformar. |
| 8. C3 analys i små snitt (paus efter C3d) | C3a: relativ uppspelning av exakt egen tidsatt GPX. C3b: aktuell publicerad resultatsplit i separat lista. C3c: tillfällig manuell klockjustering mot aktuell resultatstart. C3d: en vald publicerad kontrolltids tidpunkt i GPX. | ADR-0155/TASK162, ADR-0156/TASK163, ADR-0157/TASK164 och ADR-0158/TASK165 syntetiskt verifierade med 390px-browser och isolerad PostgreSQL. Vidare C3 väntar på C1a:s nativegrind och därefter möjlig C1b-resa. Ingen GPS-kontrollpassage är bevisad. OMAP, automatisk passagekoppling, bred analys och fler rutter får egna TASK:ar senare. |
| 9. A3 kontoinförande | Enkel betrodd inbjudan/överlämning och återställning för arrangör och deltagare, med tydlig spärrväg. | A3a/ADR-0152/TASK159, ägarstyrd A3b/ADR-0153/TASK160 och betrodd A3c/ADR-0154/TASK161 är syntetiskt verifierade. Verklig identitetskontroll, privat kodöverlämning och fysisk mobil återstår före bred lansering. Kontoaktivering/återställning ger varken nytt eventgrant eller rätt till en anmälan. |
| 10. D1a hårdvara | En verklig SPORTident-station/kortkombination klarar rådata → lokal/offlinebedömning → idempotent serversynk. | Märk kombinationen fältverifierad först med faktiskt kort/station och bevarad rådata; syntetiska bytes räcker inte. |
| 11. D1b drift och restore | En internetnåbar testinstallation med TLS fungerar på mobil/dator, medan avläsning/start-/målkö fortsätter offline; samordnad backup och restore verifieras i ny isolerad miljö. | TASK166 binder läsande dumpbevis. TASK137/169/170 ger isolerat MinIO-/PostgreSQL-/kompositbevis; TASK171–179 ger privat syntetisk capture, cleanup, kvittens och separat återöppning/restore av **samma** kedja. Faktiskt skrivstopp, exklusiva produktionsregler, betrodd återstartsbar operatörsåtgärd/credentials och fysisk internetdrift är öppna. Ingen riktig tävling som provunderlag. |
| 12. D1c liten fältpilot | Kör ett individuellt lopp start–mål–publikt resultat på verkliga enheter med oberoende facit och återställningsövning. | Fri/minutstart, klassbyte, okänd/hyrbricka, avprickning och kvar-i-skogen prövas; först här får individuell fältklarhet hävdas. |
| 13. E per format | Välj en efterfrågad tävlingsform, dokumentera egna regler och leverera ett representativt lopp hela vägen till resultat. Upprepa sedan för nästa form. | Stafett, patrull, flerdagars, poäng och kval/final är synliga framtida mål, inte redan stödda varianter. |

Varje rad är avklarad först när dess **egen** användarresa och negativa
behörighets-/felväg har prövats på relevant nivå. För B1–C2 räcker inte att en
tabell, API-route eller skärm har lagts till. För D1 krävs fysisk och operativ
verifiering; gröna syntetiska prov ersätter den inte. Om en rad kräver ett nytt
förtroendeantagande, tekniskt vägval eller en ny domänregel skrivs ADR före kod.

**Arbetsregel:** endast en *nästa minsta TASK* är aktiv åt gången inom ett
spår. En etapp är inte ”klar” för att datamodellen finns: dess användarresa,
behörighetsgräns, fel-/offlinefall där relevant och minst en riktad verklig
enhets- eller PostgreSQL-kontroll måste vara redovisade. Syntetiskt verifierad
och fältverifierad är olika nivåer.

## Ordning: små vertikala leveranser

Välj **ett** snitt i taget per arbetsström. Varje snitt ska ge ett begripligt användarutfall,
behålla äldre data och kunna verifieras utan en bred omskrivning. Nedanstående
ordning styr produktarbetet; hårdvara och återställning har dessutom en egen
tidig beroendegrind före fältpilot.

### A1. Arrangörskonto, tävlingsägarskap och ”mina tävlingar”

Identitets-, konto-/organisations-, ägarskaps- och credentialgränsen är beslutad
i [ADR-0144](adr/ADR-0144-organizer-account-event-ownership.md). Den första
leveransen är specificerad i [TASK150](../TASK_150_ORGANIZER_ACCOUNT_EVENT_CREATION.md)
och har syntetiskt verifierats genom konto-login, kontobundet skapande,
”Mina tävlingar” och delegerad öppning av befintlig `/manage`. Riktat PostgreSQL-,
kontrakts-, CLI-, webb- och browserprov passerade, liksom berörd
lint/typecheck/build efter sista produktändringen. Detta visar inte
fältberedskap. Behåll befintlig
Next.js/Node, modulär monolit och PostgreSQL/PostGIS tills ett ADR säger annat.

**Första leveransen:** en inloggad arrangör skapar en tävling och ser den under
”Mina tävlingar” med rätt att öppna dess befintliga adminarbetsyta. En annan
inloggad person får inte rätt via publik länk, namnlikhet eller äldre bootstrap-
credential. Skapandet behåller säker retry och spårbar aktör. Besluta separat om
och hur historiska tävlingar kan kopplas till konto; ingen automatisk övertagning.

**Minsta acceptans:** ett konto skapar och återöppnar samma tävling efter ny
session; exakt retry skapar inte dubbel tävling; obehörigt konto får avslag;
befintlig kontofri publikvy och stationsflöde fungerar fortfarande. Riktad
kontrakts-/PostgreSQL-kontroll och ett desktop-/390 px-browserflöde.

### A2. Medadministratör för ett event

Första snittets exakta gräns och återtilldelning efter spärr är beslutade i
[ADR-0145](adr/ADR-0145-event-coadministrator-grants.md) och specificerade i
[TASK151](../TASK_151_EVENT_COADMINISTRATION.md). Det avgränsade flödet är
nu syntetiskt verifierat mot PostgreSQL, riktig Next/browser och 390 px-viewport,
men inte på fysisk mobil eller i fält.

Tävlingsägaren ger ett **redan provisionerat konto** rätt till just ett event,
kan se tilldelningen och återkalla den. TASK151 är direkt tilldelning, inte
e-postinbjudan, självregistrering eller kontoåterställning; sådana
användarflöden kräver ett separat senare snitt om de behövs. Börja med
befintliga uppgifter och minsta användbara scope; utöka inte alla klubb-/
systemroller på en gång.
Start-, mål- och stationscredentials får finnas kvar tills en uttrycklig
övergång är säker, även offline.

**Minsta acceptans:** den andre administratören kan utföra en tillåten vanlig
åtgärd i rätt tävling men inte i en annan; återkallelse stoppar nya åtgärder
även med tidigare session; ägarens och operatörens historik förblir läsbar.
Ett lyckat och ett avvisat PostgreSQL-/browserflöde räcker som kärnprov.

### A3. Kontoinförande före bred användning

A1/B1 använder i dag betrott provisionerade konton. [ADR-0152](adr/ADR-0152-trusted-account-invitation-activation.md)
och [TASK159](../TASK_159_TRUSTED_ACCOUNT_ACTIVATION.md) väljer A3a: en betrodd
CLI utfärdar en kortlivad engångsinbjudan till ett nytt konto och mottagaren
aktiverar det med ett eget lokalt genererat lösenord. Ingen kontocredential
delas från operatören, men kodöverlämningen är fortfarande manuell och
bevisar inte e-postadress eller anmälan. A3a är **syntetiskt verifierad**,
inte fältverifierad.
[ADR-0153](adr/ADR-0153-owner-issued-account-invitation-explicit-admin-grant.md)
och [TASK160](../TASK_160_OWNER_ACCOUNT_INVITATION.md) levererar A3b:
en aktiv OWNER bjuder in ett nytt konto i sin arbetsyta och kan spärra
en väntande kod. Mottagarens aktivering ger fortfarande ingen eventrätt;
ägaren måste ge ADMIN separat med A2. Detta är syntetiskt verifierat på
390 px och PostgreSQL, inte verkligt överlämnad kod eller mobilpilot.
ADR-0154 och TASK161 har därefter syntetiskt verifierat A3c: en betrodd
serveroperatör utfärdar efter manuell identitetsattest en engångskod till
exakt befintligt konto. Mottagaren skapar ett eget lösenord i `/recover`,
gamla sessioner upphör och existerande grants/kopplingar består. Detta är
inte verkligt verifierad identitet eller privat överlämning. Självregistrering
är ett senare, uttryckligt val om behov och
verifieringsmetod finns; den får inte antas ingå i första snittet.

**Minsta acceptans:** en ny arrangör kan aktivera sitt konto, skapa en tävling
och bjuda in ett redan betrott medadministratörskonto; en deltagare kan få ett
eget konto och därefter separat verifiera sin exakta anmälan. Tappad credential
kan spärras och ersättas utan att någon tar över event eller anmälan genom
namnlikhet. ADR krävs före ändrad identitets- och återställningsgräns.

### B1. Deltagarkonto och eget resultat

ADR-0146 och TASK152 avgränsar första kontokopplingen: en aktiv raceoperatör
utfärdar en kortlivad engångskod för exakt anmälan efter kontroll utanför
systemet; deltagaren löser in den med ett redan provisionerat konto. Detta är
inte ett bevis på självregistrering eller juridiskt vårdnadshavarskap.
Arrangörsinloggning från A1 är inte i sig bevis på deltagarägarskap. Bygg först ”Mitt resultat” och relevanta
sträcktider/statusar på samma befintliga resultatkälla som publiken använder.
Koppling får inte härledas
enbart från namn, klubb, bricknummer eller `publicResultId`. Bestäm hur
flera lopp, felkoppling och korrigerad anmälan hanteras utan att skriva om
resultathistoriken.

**Beslutsgrind före implementation (uppfylld av ADR-0146):** skilj autentisering av kontot från bevis
för en viss anmälan. ADR:n namnger vem som får utfärda kopplingen, hur
deltagaren faktiskt får och bekräftar den utan att en publik länk blir
ägarkod, hur den återkallas/rättas, samt hur kontoöverlämning, återställning
och minderårigas/vårdnadshavares åtkomst avgränsas. Nuvarande konton
provisioneras betrott; självregistrering, e-postbevis och kontoåterställning
finns inte och får inte antas finnas. Den separata privata
ruttuppladdningsbehörigheten är inte ett generellt identitetsbevis. Ingen
automatisk matchning eller bakfyllnad från namn, klubb eller bricka.

**Första fungerande snittet:** ett konto kan ha flera uttryckligen verifierade
anmälningar i olika lopp. Servern resolverar kopplingen till exakt anmälan
och återanvänder endast den redan publicerbara resultatprojektionen;
anmälnings-ID, råavläsning, brickhistorik, privata rutter och opublicerade
resultat lämnar inte deltagarvyn. Ett saknat resultat ger ett begripligt
vänteläge. En namn-/klassrättning eller ny publicerad resultatrevision ska
synas genom samma källa utan att ägarkopplingen gissas om. Felkoppling kräver
en spårbar återkallelse och ny verifiering, inte tyst flytt.

**Minsta acceptans:** rätt konto ser sitt resultat efter ny inloggning på en
annan enhet, fel konto ser inte privata uppgifter, och den publika resultatvyn
fortsätter fungera helt utan inloggning. Prova även saknat/opublicerat resultat,
flera lopp, återkallad koppling och en korrigerad publicerad revision.

### B2. Följda deltagare mellan enheter

ADR-0147 och TASK153 avgränsar och syntetiskt verifierar första snittet:
en separat kontopreferens för redan offentliga resultat. Det är inte en ägarkoppling
och kan inte öppna privat resultat eller rutt. Lokala favoriter behålls för
anonyma besökare och importeras inte automatiskt vid inloggning.

Återanvänd dagens publika resultatlänkar och favorithandling i UI, men spara
inloggade deltagares val per konto på servern. Behåll anonyma lokala favoriter
utan tvångsinloggning. Ingen följfunktion får ge tillgång till privata fält.

**Minsta acceptans:** välj/avmarkera i mobil, återöppna på dator och få samma
val; en anonym besökare kan fortfarande följa lokalt; återtaget eller saknat
publikt resultat ger inget läckage. Inget eget realtidsflöde om befintlig
publik resultat-SSE räcker.

### C1. Privat GPS-inspelning under loppet

ADR-0151 och [TASK157](../TASK_157_ANDROID_PARTICIPANT_GPS_DECISION.md) väljer
en separat Androiddeltagarapp med befintlig Capacitor-/Kotlinverktygskedja som
första mål. Stationsappen behåller USB och operatörscredentials. Valet är ett
arkitekturbeslut, inte en verifierad GPS-funktion. Följ befintlig privat
GPX-/samtyckes-/kartsläppsgräns; ingen publik liveposition som bieffekt.

| Ordning | Minsta nästa bevisbara leverans | Stoppunkt |
| --- | --- | --- |
| C1a: lokal inspelare | Synlig start/stopp/status i separat Androidapp; native foreground location service; app-privat sekvensjournal som bevaras genom avbrott och visar luckor. | Riktade native-/UI-prov och APK i utvecklarflöde; ännu ingen kontobunden produktfunktion, serverkvittens eller påstående om skärmlås på verklig telefon. |
| C1b: mobilkonto och anmälningsval | Efter eget ADR kan installerad app logga in, välja en exakt serververifierad anmälningskoppling och behålla ett scoped underlag för lokal offlinestart. | Fel/återkallat konto eller koppling nekas; annat konto på samma enhet ser inte den privata kön. Browsercookie, publikt resultat och namn är inte skriv-/ägarbevis. |
| C1c: privat synk | Efter **eget ADR för skrivbehörighet** överför ett aktivt konto med exakt anmälningskoppling en stoppad GPX-version med stabil identitet/hash och exakt retry; servern kvitterar först varaktigt lagrad version. | Isolerat PostgreSQL-/objektlagringsprov och en smal klientresa; återkallad koppling stoppar skrivning, lokal kopia består. Ingen liveposition. |
| C1d: fysisk acceptans | Samma privata resa provas på en namngiven Androidtelefon med verklig GNSS, skärmlås, batterisparläge, nätavbrott och processomstart. | Jämför punktsekvens, luckor och serverkvittens mot facit. Endast den provade enheten kan märkas fältverifierad; iOS/browser förblir oprövade. |

Först när C1a–d är uppfyllda kan deltagarprodukten lova inspelning på den
prövade klienten. Ingen produktkod får hävda automatisk återstart från
bakgrunden eller luckfri inspelning utan bevis. Om service avbryts ska
inspelningen visa avbrottet och kräva synlig användarhandling för fortsättning.

**C1:s sammanhängande första användarresa:** en inloggad deltagare startar en inspelning, ser tydligt
om den pågår och om punkter ligger osynkade, stoppar den och hittar den privata
rutten efter återanslutning. Samma batch/retry skapar inte dubbla punkter.
Publik ruttpublicering kräver fortfarande ett separat uttryckligt beslut enligt
gällande samtycke. Prova på minst en fysisk målenhet med nätavbrott, omstart
och skärmlås; märk andra plattformar som overifierade tills de provats.

### C2. Egen rutt och analys efter loppet

Återanvänd befintlig privat GPX-uppladdning och den separata gränsen för
samtycke och kart-/ruttsläpp. C2 väntar inte på GPS-inspelning: redan uppladdad
GPX är ett riktigt första underlag. Dela leveransen i tre steg:

1. **C2a, privat åtkomst (TASK154 syntetiskt verifierad):** ”Mitt resultat” leder rätt konto till sina lagrade
   ruttversioner för en aktiv, exakt anmälningskoppling. Kontot får läsrätt,
   inte den tidigare separata uppladdningssessionens rättigheter. Vald privat
   version, punktantal och tidsunderlag kan visas utan råkoordinater. En
   återkallad koppling, ett annat konto och anonym publik nekas.
2. **C2b, korrekt karta och bana (TASK155 syntetiskt verifierad):** ADR-0149
   binder en uttryckligen vald GPX-version till exakt rastermanifest,
   georeferens, geometrirevision och den historiska publicerade
   resultatrevisionens bana i en immutable journal. Ruttmanifestet ensamt
   räcker fortfarande inte. Endast bevisad aktuell kombination ger privat pixelrutt och
   kontrollpositioner; annars visas vänteläge. Osläppt karta blir inte
   publik som bieffekt. Browserbildens bytes är ännu simulerade.
3. **C2c, begriplig delning (TASK156 syntetiskt verifierad):** den valda
   privata detaljen visar senaste exakta samtycke och kart-/ruttsläpp separat
   från den faktiska publika routens tillgänglighet. Endast samma publika gate
   får ge länk. Ett återtagande stänger publik åtkomst men raderar inte
   ägarens privata original.

**C2 är inte fältklar efter C2c.** Minsta slutacceptans: rätt konto ser sin
exakta privata rutt på rätt bevisad karta/bana efter ny session; fel konto och
anonym publik nekas; publicering och återtagande påverkar bara avsedd exakt
publik version. Testa med minst två privata versioner för samma anmälan, så
att ett tyst ”senaste”-val inte döljer fel version.

### C3. Efterloppsanalys utan fabricerade fakta

Den befintliga publika jämförelsen av upp till tre rutter och relativa
uppspelningen av kompletta, monotona tidsserier är en grund, inte färdig
Livelox-likvärdig analys. Återanvänd först dessa verifierade beräkningar i
den egna efterloppsvyn där behörighet och versioner tillåter det; leverera
sedan sträck- och ruttjämförelse endast mellan historiskt kompatibla
ban-/kartversioner. Visa tydligt när en tidsstämpel, kontrollpassage eller
jämförelse saknar bevis. Egna kartor och spår används;
varken Livelox-data, -kartor eller -UI kopieras. OMAP-import, flera rutter,
tempo/höjd och mer avancerad vägvalsanalys är skilda senare snitt med egna
acceptansfall, inte ett löfte från första ruttvyn.

C3a är nu syntetiskt verifierad enligt ADR-0155/TASK162: egen GPX kan spelas
upp relativt sin första uppmätta punkt, eller visas utan uppspelning om
tidsserien inte håller. C3b/ADR-0156/TASK163 visar separat samma anmälans
aktuella publicerade resultatsträckor, eller ett saknat-läge. C3c/ADR-0157/
TASK164 visar aktuell publicerad resultatstart bredvid GPX-klockan och låter
deltagaren göra en tillfällig manuell tidsförskjutning. C3d/ADR-0158/TASK165
låter deltagaren välja **en** publicerad kontrolltid och hoppa till samma
tidpunkt i den privata GPX-serien. Ett segmentbrott ger ingen kartmarkör.
Detta är varken slutresultatbevis eller GPS-verifierad kontrollpassage.
Ytterligare C3-analys får en ny avgränsad TASK efter C1a:s nativegrind och
den därefter möjliga C1b-resan; inte fler automatiska passageantaganden i
den här leveransen.

### D1. Fältgrind: verklig avläsning, internetdrift, återställning och pilot

Detta spår behöver starta tidigt även om kontoflöden byggs först. D1a provar
en verklig SPORTident-station/korttyp enligt ADR-0007 hela vägen från råbytes
till lokalt offlinebesked och idempotent serversynk. D1b gör en testinstallation
internetnåbar med TLS för riktiga mobil-/datorprov, utan att den lokala
stationens fortsatta funktion beror på servern. Koppla samtidigt ihop redan
beslutade backupdelar till en körbar, samordnad backup och restore i **ny
isolerad miljö**. Ingen privat/demo-/tävlingsdatabas får användas som testmål.
D1c är först därefter en liten dokumenterad fältpilot.

**Pilotgrind:** 30–100 deltagare, minst två banor, riktiga mobiler och verifierad
station; fri och minutstart, klassbyte, okänd/hyrbricka, nätavbrott,
start-/målavprickning, kvar-i-skogen och slutresultat. Jämför med oberoende
facit och dokumentera förlust/dubletter, kvarvarande kö samt restoreutfall.
Utan detta är produkten fortsatt utvecklingsversion, oavsett gröna syntetiska
sviter. Se den tidigare planens H1–H2 och C2–C3 för delkrav.

**D1b som tydliga, avprickningsbara delar.** Dessa bevis är ordnade så att ett
grönt delprov inte förväxlas med en återställbar tävling. D1a:s fysiska
SPORTident-underlag drivs separat; det kan inte ersättas av D1b-proven.

| Del | Leverans och stoppunkt | Status 2026-09-23 |
| --- | --- | --- |
| D1b.1: objekthistorik | Två exakta historiska PM-versioner läsbara i en ny, versionerad MinIO-instans efter pinnad resync **och** bekräftad regelrensning. | TASK137 verifierad i isolerad syntetisk loopbackmiljö; en opt-in-runner exit 0. Inte en backupadapter eller driftacceptans. |
| D1b.2: databashistorik | En färdig uppmätt `pg_dump -Fc` återställs med `pg_restore` till ny tom PostgreSQL/PostGIS; målverifieraren läser bevarad event-, anmälans-, PM- och resultathistorik utan efterföljande target-seed/migration. | TASK169 verifierad med 3/3 riktade integrationstester. PM-verifierarporten var syntetisk. |
| D1b.3: gemensamt delbevis | Samma historiska PM-`versionId`/hash/längd som käll-DB:ns manifest anger läses via vanlig PM-läsare i MinIO-målet **före** kontroll av faktiskt återställd mål-DB. Saknad version och icke-tomt mål avvisas. | [TASK170](../TASK_170_COMPOSITE_PM_POSTGRES_RESTORE_PROOF.md) är syntetiskt verifierad med en sammansatt opt-in-runner exit 0 och separat negativt guardprov. Inte en betrodd operatörsåtgärd. |
| D1b.4: körbar betrodd backup/restore | Bind ADR-0140:s privata operation-state, verkligt skrivstopp, source/target-konfiguration, dump, versionsbevarande resync, regelrensning och återstartsbar felhantering till en avsiktlig operatörsåtgärd. Prova i **ny isolerad miljö** med endast syntetiska data; ingen kvittens före verifierad cleanup. | Påbörjad, inte levererad. TASK171–177 har syntetiska bevis för privat dump, mål/resync/cleanup och hemlighetsfri kvittens. TASK178 återställde samma kedja till nytt tomt PostgreSQL17-mål; TASK179 gjorde completion-underlaget beständigt och öppnade det i separat restoreprocess, full opt-in exit 0. En tidigare TASK176-körning stoppade säkert vid mål-bucketkonfiguration; senare gröna körningar bevisar inte starttillförlitlighet. Faktiskt skrivstopp, exklusivt produktionsägande av regler och betrodd återstartsbar operatörsåtgärd återstår. |
| D1b.5: internet- och återställningsövning | Testinstallation med TLS nås från riktig mobil och dator; kritisk station/start/mål fortsätter vid avbrott och synkar efteråt. Återställ en komplett syntetisk tävlingskedja i ny miljö och jämför med oberoende facit. | Ej fältverifierad. Produktionscredentials, riktig tävlingsdata och bred driftsättning ingår inte i de tidigare syntetiska proven. |

D1c kan påbörjas först när D1a:s namngivna hårdvarukombination och D1b:s
relevanta återställnings-/internetbevis är redovisade. Därefter väljs ett
litet pilotlopp; ingen senare tävlingsform eller GPS-funktion tas in som
förutsättning för just den individuella piloten.

D1b.4 delas i små leveranser som kan stoppas var för sig: **4a privat dump**
(TASK171, syntetiskt verifierad), **4b betrodd källsidesordning**
([TASK172](../TASK_172_TRUSTED_BACKUP_SOURCE_CAPTURE.md), syntetiskt verifierad:
explicit skrivstoppsintygande + privat state + samma dump + befintlig
migrations-/PM-preflight; ingen backupkvittens), **4c privat mål och resync**
([TASK173](../TASK_173_PRIVATE_MINIO_TARGET_READINESS.md) läser målberedskap,
syntetiskt verifierad; [TASK174](../TASK_174_PRIVATE_MINIO_TARGET_PROVISIONING.md)
har lokalt verifierad privat bindning, nyprovisionerare och avgränsad
`SIGKILL`-/reservationsåterstart mot pinnad MinIO. Bindningen låser även
credentialfilens identitet/hash. Ett säkert stopp i ett source-only-omprov
utan känd orsak följs upp före drift; [TASK175](../TASK_175_PRIVATE_ONE_STORE_REPLICATION.md)
har lokalt syntetiskt verifierat en privat regel-/resync-/cleanup-kedja för
en manifestbunden store och separat SIGKILL-återhämtning;
[TASK176](../TASK_176_SOURCE_REPLICATION_COMPOSITION.md) har komponerat en
faktisk syntetisk TASK172-dump och enda DB-refererade PM-version med kedjan,
utan kvittens eller restore),
**4d verifierad cleanup och kvittens**
([TASK177](../TASK_177_MANAGED_BACKUP_RECEIPT_GATE.md) syntetiskt verifierad:
full application-capture, noll källregler, återläst state och exakt mål-/dump-
bevis före en hemlighetsfri kvittens), och **4e restore i ny tom
miljö** ([TASK178](../TASK_178_RECEIPTED_BACKUP_RESTORE_COMPOSITION.md)
syntetiskt verifierad med samma kvitterade manifest/dump/mål och bevarad
historisk DB-/PM-referens), följt av **4f beständig privat överlämning**
([TASK179](../TASK_179_DURABLE_BACKUP_RESTORE_HANDOFF.md) syntetiskt
verifierad: ett slutverifierat backup-id öppnas av en **ny process** via
privat immutable underlag enligt ADR-0159, och samma historiska PM-version
återställs i en ny tom DB). Nästa beroendeordning är **4g tekniskt
skrivstopp** ([TASK180](../TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md):
[ADR-0160](adr/ADR-0160-technical-writer-stop-process-boundary.md) har valt
installationsgränsen och Linux/systemd som första målprofil; konkreta
enheter/controller, täckningsinventering, stoppa nya writes, dränera
pågående och explicit återöppning), **4h exklusiv kontroll över källans
MinIO-regler** (egen liten TASK med bevis att andra aktörer inte kan ändra
regler under intervallet), och **4i betrodd återstartsbar operatörsåtgärd**
(egen TASK som binder redan bevisade gränser och privata credentials).
Ingen av 4g–4i får antas klar för att 4f är grön. Varje del kräver syntetisk
isolerad acceptans innan nästa kopplas på. Verklig produktionsdrift, fler
stores, fysisk internetövning och fältpilot ligger därefter i egna grindar.

### E1, E2 … Fler tävlingsformer, en konkret form i taget

Första nya formen väljs efter ett faktiskt arrangörsbehov och får egen ADR,
domänregel, resultatprojektion, UI och facit. Synlig restlista: stafett,
patrull/gaffling, flerdagars/jaktstart, poängorientering/rogaining och
kval/final. Ändra inte individuell motor med ett generellt flaggpaket för
ospecificerade format. Ingen form markeras klar förrän ett helt representativt
lopp kan förberedas, genomföras och publiceras med sin egen resultatsemantik.

## UX och enheter som tvärgående acceptans

| Enhet/vy | Avsett arbete | Krävt bevis innan den anges som stödd |
| --- | --- | --- |
| Datorwebb | Arrangörens kompakta arbetsyta och publik resultatläsning. | Samma tävling, behörighet och publicerade version visas efter ny session. |
| Mobilwebb | Medadministration, start-/målpersonal och publika/deltagarvyer där respektive flöde är byggt. | Fysisk mobil, läsbart 390 px-läge och avbrott/återanslutning för operativa flöden. |
| Androidstation | Lokal avläsning och beständig kö. | Namngiven verklig SPORTident-station/kortkombination, offlinebesked och idempotent synk. |
| Androiddeltagarapp | Privat GPS-inspelning under lopp. | Namngiven telefon med nativebygge, verklig GNSS, skärmlås, processomstart och nätavbrott. |

Detta är separata stöddeklarationer: ett grönt browserprov på mobilstorlek
bevisar inte fysisk mobil, Androidstation eller GPS i deltagarappen. iOS-GPS
och andra oprövade plattformar ligger utanför första acceptansen.

- En tydlig ingång: ”Mina tävlingar” för arrangör, rollanpassad huvudvy för
  funktionär, ”Mitt resultat” för deltagare och kontofria publika listor.
- En administratör ska från samma tävlingsarbetsyta kunna göra de vanliga
  ändringar hen har rätt till, exempelvis kapacitetskontrollerat byte mellan
  tävlingsklass och öppen klass. Visa varför en ändring inte går, i stället
  för att införa generella lås för allt tävlingsupplägg.
- TASK167 ger en liten privat arbetslista för redan befintlig betalstatus:
  omarkerade/obetald anmälningar kan filtreras och öppnas direkt i den
  individuella, versionskontrollerade rättningen. Det är syntetiskt verifierat
  vid 390/1280 px, inte en betalplattform eller fältgodkänd expedition.
- Behåll den befintliga kompakta `/manage`-arbetsytan och för in återstående
  vardagsåtgärder där ett flöde i taget. Undvik parallella inloggningar och
  långa sidor med upprepade instruktioner. Desktop ska visa relevanta fält i
  listan; padda och desktop ska utnyttja bredden för samtidig lista/detalj och
  fler direkt synliga fakta. 390 px ska prioritera en uppgift i taget och ha
  läsbar lista/detalj utan sidscroll. Likvärdiga funktioner kräver inte
  identisk layout eller samtidiga fält på alla enheter.
- [TASK182](../TASK_182_ADMIN_WORKFLOW_NAVIGATION.md) är det avgränsade
  presentationssnittet efter en [läsande jämförelse med MeOS 5.0-handbokens
  arbetsflöden](research/meos-guide-workflow-2026-09-23.md): deltagare först,
  sedan befintliga moment ordnade före/under/efter tävlingen. En ny flik är
  inte ett bevis för stöd för stafett, gaffling eller andra tävlingsformer.
- [TASK183](../TASK_183_PARTICIPANT_DESKTOP_TABLET_DENSITY.md) är nu
  syntetiskt verifierad genom TASK187: minst fem deltagarrader och vald persons
  fakta syns samtidigt i 1280×800, med separat läsbar mobildetalj. TASK188–189
  har därefter renodlat aktiv ändring och informationshierarki; fysisk
  användbarhetsacceptans återstår.
- [TASK184](../TASK_184_COMPETITION_WORKSPACE_OVERVIEW.md) kompletterar
  TASK182 efter användarens önskemål om ett sammanhållet UI-pass:
  Översikt blir landningsläge före formulären, med klass-/start-/kapacitetsbild
  och uppföljning. Före/Deltagare/Under/Efter är arbetsområden, inte
  begränsande tävlingsstatusar. [UI-riktningen](ui-workspace-design-2026-09-24.md)
  anger var funktionerna hör hemma och skiljer mobil från padda/dator.
  [Jämförelsen](research/competition-ui-comparison-2026-09-24.md) omfattar
  officiella guider för MeOS, Ór och RACE RESULT.
- [TASK185](../TASK_185_SETUP_AND_RACE_DAY_WORKSPACE.md) gör arbetsytorna
  konkreta: sexstegs förberedelser med egna områden, gemensam sökbar
  deltagartabell/personkort med historiska kontrolltider och separat
  administratörsspeaker. ADR-0161 dokumenterar de två smala privata
  läsutökningarna. Inga nya tävlingsformer eller ändrade resultatregler.
- [TASK191](../TASK_191_COMPETITION_NAVIGATION_BRIDGE.md) knyter ihop
  arrangörens Mina tävlingar, den kompakta arbetsytan och den separat
  behöriga läsöversikten. Det är navigering, inte sammanslagna rättigheter.
- [TASK215](../TASK_215_NEUTRAL_ADMIN_VISUAL_LANGUAGE.md) gör den redan täta
  `/manage`-ytan visuellt lugnare: neutral vardagskrom, tunnare avgränsningar
  och få textbundna signalfärger för verkliga undantag. Speakerledare får
  ingen påhittad färg innan en projektion faktiskt visar ledare/tidsavstånd.
  Användarens Codex-referens bekräftar riktningen: gråvita ytor, mörkgrå
  vardagskontroller, kompakt gemensam typografi och endast små, textstödda
  statusaccenter. Rött betyder avvikelse/felstämpling, gult saknad uppgift
  och grönt verifierad klassledare; normal navigation ska inte signalera larm.
- [TASK216](../TASK_216_ADMIN_SPEAKER_PUBLIC_CLASS_LEADERS.md) ger enligt
  ADR-0164 en syntetiskt verifierad, manuellt hämtad bild av publika
  klassledare i administratörens speakerflik. Den frikopplas från de 25
  senaste underlagsraderna och är inte en livepassage eller automatisk
  ledarpollning.
- [TASK217](../TASK_217_MOBILE_ADMIN_FOCUS_CHROME.md) gör den inloggade
  mobilens tävlingshuvud och Under-navigering kortare utan att dölja
  tävlingsstatus eller minska tryckmål. Speaker och klassledarknappen nås
  tidigare; desktop/padda behåller sin täta layout.
- [TASK218](../TASK_218_MOBILE_PREPARATION_NAVIGATION.md) visar alla sju
  förberedelseområden på två mobila rader med 44 px mål och fullständiga
  tillgängliga namn, utan att gömma delar i en meny.
- [TASK219](../TASK_219_QUIET_ADMIN_SURFACES.md) förfinar samma adminyta
  med neutral, platt navigering och tätare speakerlista. Rött/gult/grönt
  är reserverade för verifierad avvikelse/saknad uppgift/klassledare, inte
  allmän dekor; motsvarande princip ska prövas per framtida arbetsyta.
- [TASK220](../TASK_220_QUIET_SEPARATE_SPEAKER.md) ger den separata privata
  speakerrollen samma lugna, täta formspråk utan att ändra urval, behörighet
  eller polling; den får ingen påhittad ledar-/placeringssignal.
- [TASK221](../TASK_221_RACE_DAY_ATTENTION.md) gör befintliga
  skogs- och okänd-avläsningsavvikelser synliga direkt i tävlingsdagens
  lägesvy. Det är två separata daterade läsunderlag, inte en fältklar
  säkerhetssignal eller ny resultatutvärdering.
- [TASK222](../TASK_222_PARTICIPANT_SEQUENCE.md) låter operatören beta av
  ett aktuellt deltagarurval i personkortet utan list-/detaljväxling eller
  tappat filter. Det ändrar inte persondata eller serverprojektion.
- [TASK223](../TASK_223_NEUTRAL_ORGANIZER_ENTRY.md) ger vägen in via
  `/organizer` samma neutrala, kompakta visuella språk som `/manage` utan
  att ändra publik-/stationsfärger eller tävlingsfunktioner.
- [TASK225](../TASK_225_AFTER_RESULT_ACTIONS.md) skiljer synligt
  fastställande från filhämtning i Efter. Det bevarar Complete-gaten och
  osäkra återförsök men är ännu bara syntetiskt browserprovat, inte
  funktionärs- eller fältaccepterat.
- [TASK226](../TASK_226_COMPACT_RECALCULATION_STEP.md) ordnar samma
  Efter-vy omberäkning → fastställande → export och tar bort en stor tom
  omberäkningspanel. Samma serverflöden används; användbarhet i skarpt
  funktionärsarbete är fortfarande oprövad.
- [TASK227](../TASK_227_CLASS_FINDER_AT_SCALE.md) låter en funktionär söka
  rätt klass eller bana i Före → Klasser med 60 syntetiska klasser utan att
  dölja tävlingens globala beredskapsbild eller ändra deltagarunderlaget.
  Verklig funktionärsacceptans återstår.
- [TASK228](../TASK_228_OVERVIEW_CLASS_ATTENTION.md) lyfter klasser med
  saknade fasta tider överst redan på tävlingens förstasida och ger en
  liten sökning där. Detta är en lokal UI-prioritering av hämtad data,
  inte ett nytt löfte om att tävlingen i övrigt är redo.
- [TASK229](../TASK_229_COMPACT_COURSE_OVERVIEW.md) komprimerar Före → Banor
  vid tolv banor: klasskoppling och kontrollantal är synliga direkt,
  exakt kontrollföljd öppnas per bana och saknad version varnar överst.
  Detta ändrar inte banlogik eller validerade kontrakt.
- [TASK230](../TASK_230_NAMED_MISSING_COURSE_VERSIONS.md) gör banvarningen
  mer konkret genom att namnge berörda klassrader och tilldelade
  banversioner, utan att påstå databasfrånvaro eller läcka interna ID:n.
  Många rader förblir hopfällda tills de behövs.
- [TASK231](../TASK_231_EXACT_CLASS_FROM_COURSE_WARNING.md) gör varje sådan
  rad till ett exakt, läsande klassval även vid dubbla visningsnamn.
  Målraden markeras utan att starta banomkoppling eller annan ändring.
- [TASK232](../TASK_232_COURSE_WARNING_CONTEXT_IN_CLASS.md) bevarar
  orsaken som tidsbunden uppgift på vald klassrad och ger en liten
  återgång till Banor. Nytt deltagarunderlag rensar sammanhanget.
- [TASK233](../TASK_233_COURSE_FINDER_AT_SCALE.md) låter funktionären
  hitta en läst bana via dess namn eller tilldelade klass utan att
  bläddra i hela banlistan; varningen för saknad version förblir global.
- [TASK234](../TASK_234_COMPACT_MOBILE_ADMIN_NAVIGATION.md) prioriterar det
  aktiva arbetets höjd på mobil med två märkta valfält i stället för
  knappgaller. Detta omprövar enbart TASK218:s mobilpresentation; alla
  arbetsvägar, statusmått och desktopflikar finns kvar.
- [TASK235](../TASK_235_NEUTRAL_LEGACY_OPERATIONAL_SURFACES.md) gör också den
  äldre översikten och startlistan neutrala utan att försvaga faktiska
  fel-, saknad-info- eller verifierade speakerledarsignaler.
- [TASK236](../TASK_236_DENSE_NEUTRAL_PUBLIC_RESULTS.md) gör den publika
  resultatlistan tätare och neutral på dator och mobil utan att ta bort
  resultatfakta, deltagarlänkar, favorit, sträcktider eller ruttjämförelse.
  Syntetisk CSS-browserkontroll är gjord; verklig Next/DB- och fysisk
  deltagaracceptans återstår.
- [TASK237](../TASK_237_NEUTRAL_PUBLIC_PARTICIPANT_DETAIL.md) låter den
  enskilda publika deltagardetaljen följa samma språk, utan fyra faktakort
  eller grön ruttpanel. Print behåller nu personhuvudet. Kontrakt,
  uppdatering och ruttens behörighetsgräns är oförändrade.
- [TASK238](../TASK_238_NEUTRAL_PUBLIC_ROUTE_VIEW.md) gör också den
  publicerade deltagarrutten neutral och tät utan att ändra ruttlinje,
  kontrollgeometri, GPX-uppspelning eller releasegräns.
- [TASK239](../TASK_239_PUBLIC_ROUTE_MAP_ZOOM.md) ger samma rutt en
  textmärkt 1×–4×-zoom och native panorering av hela befintliga SVG:n.
  Syntetisk komponent/browserkontroll är gjord; fysisk mobil/touch,
  kartprecision och faktisk publiceringsgrind är fortfarande öppna.
- [TASK240](../TASK_240_PUBLIC_ROUTE_COMPARISON_VIEW.md) för över samma
  neutrala kompakta språk och kartzoom till jämförelsen av två eller tre
  släppta rutter. Ruttfärgerna har kvar textetiketter; två-ruttstabellen
  blir lokalt svepbar på smal telefon. Verklig releasegrind och fysisk
  touch är inte provade i detta UI-snitt.
- [TASK241](../TASK_241_NEUTRAL_PUBLIC_MAP_VIEW.md) ger även den fristående
  publika tävlingskartan samma neutrala språk och en begränsad, rullbar
  1×–4×-zoom. Kartbildens naturliga proportioner, sidbredd och print
  provas syntetiskt; verklig publiceringsväg och fysisk touch återstår.
- [TASK242](../TASK_242_COMPACT_PRIVATE_MAP_ADMIN.md) förtätar det privata
  kartsläppet och låter frivillig kalibrering/kontrollpositioner öppnas
  var för sig. Status för en misslyckad läsning får inte bli ett falskt
  tomläge; release/withdrawal är fortfarande uttryckliga beslut.
- [TASK263](../TASK_263_COMPACT_OUT_OF_COMPETITION_UI.md) för över den
  neutrala basen till gemensamma standardytor och den separata Utom tävlan-
  vyn. [TASK264](../TASK_264_COMPACT_OUT_OF_COMPETITION_WITHDRAWAL_UI.md)
  ger återtagandet samma täta presentation med exakt revisionshuvud och
  restaureringskälla. Båda är syntetiskt verifierade, inte fältaccepterade.
- [TASK265](../TASK_265_COMPACT_WITHOUT_TIMING_UI.md) ger den separata
  Utan tidtagning-vyn samma täta svenska presentation, fryst granskning
  och explicit retry. Nätläge skiljs från verifierad session; läsfel
  ger inget falskt kontrolläge. Beslutspolicy och exportspärr är oförändrade.
  Ett syntetiskt browserfall är verifierat; fysisk användbarhet återstår.
- [TASK266](../TASK_266_COMPACT_WITHOUT_TIMING_WITHDRAWAL_UI.md) ger även
  den separata NT-återtagningen täta desktoprader och ordnade mobilfält.
  Exakt OK/MP-källa och fryst granskningsunderlag syns före bekräftelse
  och retry. MP får en liten röd, textstödd signal; normalytor är neutrala.
  Syntetiskt browserprov är verifierat, inte servercommit eller fältbruk.
- [TASK267](../TASK_267_COMPACT_CLASS_START_DRAW_UI.md) förtätar den separata
  klasslottningens parametrar och gamla/nya-start-lista. Alla deltagare är
  åtkomliga via lokal scroll; bekräftelse och fryst retry ligger före listan.
  Ett syntetiskt 60-personersprov är verifierat, inte servercommit/maxlast.
- [TASK268](../TASK_268_COMPACT_START_LIST_PUBLICATION_UI.md) förtätar även
  separat startlistepublicering. Fryst granskning/retry ligger före den
  sökbara listan; avpublicering fungerar fortsatt med ogiltigt aktuellt
  underlag. Syntetisk layout/klientretry är verifierad, inte riktig
  publicering, XML eller fältbruk.
- [TASK269](../TASK_269_COMPACT_READOUT_HISTORY_UI.md) förtätar skyddad
  avläsningshistorik: radlista för dator, mobilprioritering, aktuell
  deltagaridentitet och ordnade stämplingar/revisioner. Små MP-/saknad-
  signaler ersätter färgade paneler. Syntetisk browser är verifierad;
  databas-, skärmläsar- och fältacceptans återstår.
- [TASK270](../TASK_270_COMPACT_EVENT_CREATION_UI.md) gör bootstrap-
  skapandet kompakt och begripligare. Okänt commit granskas med hela frysta
  intentet, och kvitto ersätter det gamla ifyllda formuläret så nästa
  tävling kräver ett nytt uttryckligt val. Skapandet får fortfarande ingen
  automatisk raceadministratörsbehörighet; bara syntetisk browser verifierad.
- [TASK271](../TASK_271_COMPACT_ORGANIZER_EVENTS_UI.md) ger kontots
  Mina tävlingar mer desktoputrymme och tätare event-/lopprader med synlig
  faktisk roll. Befintligt raceinträde och medadministratörsgräns bevaras;
  bara syntetisk browser verifierad, inte verklig session eller fältbruk.
- [TASK272](../TASK_272_ORGANIZER_ENTRY_STATES_UI.md) gör samma kontovys
  utloggade och tomma lägen begripliga: återkoppling intill login,
  kontoinbjudan skild från eventåtkomst och två verkliga vägar från
  tomlistan. Endast syntetisk browser verifierad; authserver och fältbruk
  är inte omprövade.
- [TASK273](../TASK_273_ACCOUNT_EVENT_CREATION_UI.md) förtätar det
  kontobundna skapandet och visar fryst fullständigt intent före same-id-
  retry. Kvitto ersätter gammal form och syns efter listuppdatering,
  medan ny blank form kräver ett uttryckligt val. Browserprovet är
  syntetiskt; faktisk PostgreSQL-commit och fältbruk prövas separat.
- [TASK274](../TASK_274_COMPACT_COADMIN_UI.md) förtätar ägarens eventbundna
  medadministration med aktiv/återkallad historik, exakt eventkontext och
  fryst retry-underlag. Kontoinbjudan förblir en separat åtgärd, och dess
  sidminneskod överlever enbart panelkollaps. Syntetisk browser är grön;
  faktisk auktorisering, kodöverlämning och fältbruk återstår.
- [TASK275](../TASK_275_COMPACT_ACCOUNT_INVITATION_UI.md) gör den separata
  kontoinbjudan kort i normalvyn och granskbar vid osäkert svar. En
  bekräftad engångskod blockerar ny issue tills den rensas från sidan;
  privat överlämning och den separata ADMIN-gränsen är uttryckliga.
  Syntetisk browser är grön, men verklig kodleverans/DB-/fältacceptans
  återstår.
- [TASK276](../TASK_276_ACTIVATED_INVITATION_GRANT_REVIEW_UI.md) binder
  samman tvåstegsvägens UI utan att binda ihop dess behörigheter: en
  inlöst inbjudan kan förifylla och fokusera en separat OWNER-granskad
  ADMIN-tilldelning. Aktiv grant och läsfel ges konservativ textstatus;
  ingen automatisk POST sker. Syntetisk browser är grön, verklig
  auth-/databas-/mobilacceptans återstår.
- [TASK277](../TASK_277_ISOLATED_OWNER_INVITATION_ACCEPTANCE.md) verifierar
  tvåstegsvägen med riktig HTTP, Chromium och en ny isolerad PostgreSQL
  17/PostGIS-källbas. Kontoaktivering gav inte eventåtkomst; granskning
  skickade ingen POST; separat OWNER-grant aktiverade åtkomsten. Fysisk
  mobil, privat kodöverlämning och funktionärsbruk återstår.
- [TASK278](../TASK_278_ORGANIZER_EVENT_FINDER.md) låter ett konto hitta
  ett redan auktoriserat event via event- eller loppnamn utan att blanda
  roller eller skapa en serversökning. Ett kompakt 320/390/1280 px-
  browserprov är grönt; fysisk mobil återstår.
- [TASK279](../TASK_279_ORGANIZER_FINDER_SESSION_ACCEPTANCE.md) prövar
  därefter ny session och sent skapat event med riktig Next-HTTP och
  isolerad PostgreSQL 17/PostGIS. Ägaren hittade/öppnade rätt lopp,
  medan ett annat konto varken såg eller kunde gå in i det. Fysisk
  funktionärsacceptans kvarstår.
- TASK280–297 har fortsatt det neutrala, informationstäta adminpasset:
  deltagarens INFO skiljer aktuell tilldelad bana från historiskt resultat
  ([TASK290](../TASK_290_PARTICIPANT_ASSIGNED_COURSE.md), med riktig
  isolerad HTTP/PG-kontroll i [TASK291](../TASK_291_ASSIGNED_COURSE_DB_ACCEPTANCE.md)).
  Deltagare → exakt banversion → klassupplägg och klass → bana är nu
  sammanhängande läsande navigation
  ([TASK292](../TASK_292_PARTICIPANT_COURSE_NAVIGATION.md),
  [TASK293](../TASK_293_COURSE_ASSIGNED_CLASS_NAVIGATION.md),
  [TASK294](../TASK_294_CLASS_ASSIGNED_COURSE_NAVIGATION.md)).
  Klassnamn öppnar befintliga klassinställningar och registrerat antal
  öppnar hela klassens deltagarlista utan kvarvarande specialfilter eller
  gammalt personkort ([TASK295](../TASK_295_DIRECT_CLASS_SETUP_SELECTION.md),
  [TASK296](../TASK_296_CLASS_PARTICIPANT_LIST_NAVIGATION.md)).
  [TASK297](../TASK_297_PARTICIPANT_RESULT_PRIORITY.md) prioriterar
  gällande resultat före banans kontrollföljd och planar ut mobila
  faktasektioner. Första browserinloggningen stannade, omkörningen passerade;
  initial sessionsläsning/manuell inloggning behöver isoleras innan en
  autentiseringsfix eller fältstabilitet får påstås.
  [TASK298](../TASK_298_INITIAL_ADMIN_SESSION_READINESS.md) har därefter
  bevisat ett aktivt credentialfält före hydrering och spärrat denna
  första render tills sessionskontrollen är klar. Ett styrt återanvänt
  browserfall passerar; serverbehörighet och deadline är oförändrade.
  Den ursprungliga timeoutens orsak är inte därmed bevisad. Nästa UI-arbete
  ska prioritera en sammanhängande Före-resa och ett konkret funktionellt
  hinder, inte en ny serie kosmetiska mikrosnitt.
  [TASK299](../TASK_299_STAFF_WORKFLOW_HANDOFF.md) har granskat kedjan
  källbaserat och lagt till saknade destinationslänkar i funktionärsåtkomsten.
  Det syntetiska provet utfärdar ingen kod eller offlineförbereder en enhet.
  Nästa konkreta uppläggssnitt är ADR/TASK för manuell klass på exakt befintlig
  banversion; dagens manuella skapande binder alltid ny bana och klass
  tillsammans. Inga banor ska dupliceras eller länkas via namn som genväg.
  [ADR-0166](adr/ADR-0166-manual-class-on-existing-course-version.md) är nu
  accepterad före implementation och [TASK300](../TASK_300_MANUAL_CLASS_ON_EXISTING_COURSE.md)
  har levererat källsnittet för delad bana: kontrakt/journal/transaktion och
  kompakt route/UI, med2 kontrakt-,2 isolerade PG-,1 route- och1 syntetiskt
  browserfall gröna samt paketlint/typecheck/build exit0. Verklig HTTP→UI→PG-
  kedja/fysisk mobil och driftsättning återstår; ingen demodatabas migrerades.
  Nästa minsta funktionella lucka är manuell klassnamnsrättning med stabilt
  ID, inte kopierad bana eller bredare tävlingsformat.
  [TASK301](../TASK_301_MANUAL_CLASS_NAME_CORRECTION.md) har startats efter
  [ADR-0167](adr/ADR-0167-manual-class-name-correction.md): rätta manuell
  klassrubrik från vald klassrad, med samma klass/bana och historiska frysta
  publiceringar. Backend/UI och isolerad verifiering pågår; inga nya testbevis
  finns ännu. Importägda namn behöver uttrycklig omimportpolicy i ett eget snitt.
  Speaker skiljer senaste privata resultatuppdateringar från publika
  klassledare, med lokal sökning och exakt publik deltagarlänk
  (TASK284–287). Detta är avgränsade syntetiska UI-/databasbevis, inte
  fältacceptans eller MeOS-likvärdighet. De sex produktresorna förblir öppna.
- Visa alltid nät-/synkstatus och när en uppgift senast uppdaterades där det
  påverkar beslut. Mobilernas osynkade start-/målmarkeringar är inte ännu
  serverkända; ”kvar i skogen” får inte framställas som absolut facit.
- Dokumentera stöd per enhet och flöde: datorwebb, mobilwebb, Androidstation
  och vald GPS-klient. Simulerad browser, fysisk mobil och fältverifierad
  station är skilda bevisnivåer.
- Före anspråk på ”lättanvänt”: prova huvuduppgifterna med en arrangör,
  start-/målpersonal och en deltagare på relevanta enheter. Mät om de hittar
  nästa handling, ser avgörande tillstånd utan onödig scroll och kan rätta
  ett vanligt misstag utan att tappa historik. Notera konkreta hinder som
  små efterföljande TASK:ar; skapa inte ett nytt parallellt admin-UI.

## Arbetsdisciplin och spårning

- Varje snitt får en kort TASK med användarutfall, avgränsning, beroenden,
  filägare, acceptans och explicit ”ingår inte”. ADR krävs före ny beständig
  identitetsmodell, GPS-transport/privatgräns eller ändrad resultatregel.
- Kör riktad lint/typecheck, relevanta små tester och build för berörda paket
  efter sista kodändringen. PostgreSQL-beteende provas mot isolerad PostgreSQL,
  inte SQLite; en relevant browser-/fysisk kontroll väljs där den ger bevis.
  Full workspace-svit hör till releasekandidat eller ändring över flera kärnlager.
- Håll en enkel spårningsrad per snitt: `planerad` → `ADR accepterad` →
  `implementerad` → `syntetiskt verifierad` → `fysiskt/fältverifierad`.
  Ange alltid faktisk nivå, exakta testresultat och kvarvarande antaganden.
- Använd agent bara för ett oberoende, avgränsat delarbete. Föredra 6 Luna
  där den räcker; en ägare per schema/kontrakt/gemensam UI-fil och
  inga parallella skrivare i samma testdatabas. Ingen bred refaktorering som
  förhandskrav för en liten användbar leverans.

**Nästa minsta uppgift i C-spåret:** avsluta [TASK158](../TASK_158_LOCAL_ANDROID_GPS_RECORDER.md)
genom låst/verifierad nativegraf, nativebygge, Android lint och riktade
journal-/telefonprov på den separata Androidappen. Koden och de små
webbkontrollerna finns och en hashverifierad temporär JDK 21 startar Gradle,
men Android SDK kräver ett nytt licensbeslut och ingen fysisk GNSS-acceptans
har gjorts.
C1a får inte kallas färdig på den grunden. Därefter kommer mobilkonto/exakt
anmälningsval i C1b, separat skriv-ADR/C1c för privat synk och C1d:s
sammanhängande bevis på en namngiven fysisk telefon. C1 som produktfunktion
är fortfarande öppen.
**Nästa minsta oberoende uppgift i A-spåret:** verifiera ett enda
manuellt attesterat A3c-flöde från privat kodöverlämning till ny inloggning
på en fysisk mobil i en uttryckligen vald testinstallation, utan riktig
tävling eller användarkonto. ADR-0154/TASK161 är syntetiskt verifierade;
identitetskontroll, överlämningskanal, TLS/drift och fysisk enhet är ännu
oprövade. Ingen e-post-, SMS- eller självregistreringsplattform antas.
Om tillgänglig riktig SPORTident-utrustning eller driftmiljö gör ett konkret
D1-fältblockerande snitt möjligt kan det prioriteras separat; blanda inte
spåren i samma TASK. C2a–c är syntetiskt verifierade men inte fysisk mobil,
verklig objektlagring/kartprecision eller hela deltagarprodukten. A3 måste
vara löst innan bred kontolansering; A1/A2/B1/B2 är inte fältaccepterade.

**Nästa minsta oberoende uppgift i D1b-spåret:**
[TASK180](../TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md) har nu
[ADR-0160](adr/ADR-0160-technical-writer-stop-process-boundary.md) som väljer
ett synligt stopp av installationens skrivande processer och ingress. En
dedikerad Linux/systemd-installation är vald som första målprofil. TASK190:s
HTTP-grind och TASK192:s icke aktiverade webb-/migrationsmallar med
startkontroll samt TASK211:s styrda stängning av öppen publik SSE är
partiella delsteg, inte ett stoppbevis. Nästa steg är att
göra alla tillåtna CLI-/worker-starter installationsägda, låsa deras
credentials och först verifiera hela webbanropets avslut vid SIGTERM,
inklusive klientavbrott under ett blockerat objektsteg, i en disponibel
Linux/systemd-miljö. Se
[dräneringsgranskningen](research/next-standalone-writer-drain.md).
[TASK212](../TASK_212_NEXT_STANDALONE_DRAIN_PROBE.md) förbereder ett riktat
opt-in-prov av just den byggda Next-standalone-
processens ruttuppladdning med ansluten respektive TCP-avbruten klient, men
har ännu bara klarat statiska kontroller på macOS. Det är inget Linux-,
systemd- eller controllerbevis.
[TASK213](../TASK_213_WRITER_PROFILE_PREFLIGHT.md) förbereder en läsande
Linux-/root-kontroll av de tre nu tillåtna unit- och credentialkällorna;
den installerar ingenting och har ännu bara syntetiskt provats på macOS.
[TASK214](../TASK_214_NONACTIVATING_WRITER_PROFILE_INSTALL.md) förbereder
en separat, icke aktiverande filinstallation av samma tre units bakom en
redan stängd markör. Endast syntetiska kontroller är gjorda; varken installerad
systemd-profil eller fysisk credentialgräns är verifierad.
[TASK224](../TASK_224_LOADED_WRITER_PROFILE_PREFLIGHT.md) förbereder ett
ytterligare läsande förprov av manager-laddade enheter efter filinstallationen.
Det avvisar okänd/stale laddning och extra O-Tid-enheter, men är ännu bara
syntetiskt provat på Mac och ger inget Linux-, dränerings- eller stoppbevis.
Först efter fysisk verifiering av standalone-avslut och installationsägd
credentialgräns kan controller/dränering implementeras utan att ett
process-stopp förväxlas med ett färdigt anrop. Därefter måste faktisk
stoppa/dränera/återöppna-gräns provas mot isolerad syntetisk PostgreSQL och
objektlagring. Nuvarande `writeStopConfirmed` är endast
operatörens intygande,
inte ett lås. Om täckning av alla writer-vägar inte kan visas får snittet
stanna vid dokumenterat blockerad kontroll; ett delat advisory lock får inte
antas fungera utan att varje writer deltar. MinIO-regelägande och betrodd
operatörsåtgärd kommer som **separata** efterföljande snitt. Inget verkligt
lopp, produktionscredential eller fältpåstående. Fysisk TLS-/nät-/
stationsacceptans ligger kvar i D1b.5/D1c.
