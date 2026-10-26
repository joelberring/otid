# ADR-0174: Stafett på riktigt – banor per sträcka, omstart, rättvis gaffling och flera löpare per sträcka

Status: beslutad 2026-10-25 (steg 47 och 48, PLAN.md), beslut 9 2026-10-26 (steg 50), beslut 10 2026-10-26 (steg 56). Kompletterar ADR-0169 beslut 2–3.

## Bakgrund

Stafetten från steg 11 hade en bana per klass, enkel rotation av varianter, en fast omstart och ingen möjlighet att ändra
klassen eller lagen efter att de skapats. Ägaren vill kunna köra klubbstafetter, ungdomsstafetter med flera löpare per
sträcka, teamsprint, linjestafetter med flygande omstart (som "Mot centrum" från Rotebro till City) och 25-manna, och se
omstarter och gafflingar i resultatlistorna.

## Beslut (steg 47)

### 1. Bana per sträcka
`relay_leg.course_version_id` (migration 0021) är sträckans egen banversion; NULL = klassens. Avläsningspaketet och
domänen bär banan på sträcklöparen (`Entry.courseVersionId`), och `entryCourseVersionId(entry, class)` är den enda regeln
för vilken bana en löpare springer. Underlagshashen använder sträckans bana, så att en ändrad sträcka gör just dess
resultat inaktuella; för alla andra deltagare är hashen oförändrad. "Redigera bana" flyttar sträckor med banan till den
nya versionen och räknar bara om löpare som springer banan. IOF: `ClassCourseAssignment` med `AllowedOnLeg` ger
sträckans bana (klassens bana är den för den lägsta sträckan), `TeamCourseAssignment` prövas mot sträckans bana, och
exporten skriver sträckans bana som `Course` i `TeamMemberStart` och `PersonResult`. En stafettklass skapad i O-Tid
kopplas till banfilens klass med samma namn.

### 2. Ändra stafettklass och lag
"Ändra stafettklass" ändrar namn, antal sträckor (läggs till eller tas bort sist), startsätt och tider, bana och variant
per sträcka och klassens inställningar. Ändringen görs, starterna räknas om och varje avläst sträcka vars underlag ändrats
räknas om i samma transaktion. Byter någon status, eller tas löpare bort med en sträcka, rullas transaktionen tillbaka och
ett besked i klartext visas ("Lag 1 sträcka 2, Bo Ek: godkänd → felstämplad"); arrangören bekräftar med en ny begäran.
En sträcka där någon löpare har resultat går inte att ta bort. Nya sträckor får en vakant löpare per lag.
Lag: ändra namn, klubb och lagnummer; ta bort ett lag utan resultat (laget, löparna och brickkopplingarna); stryk ett lag
med resultat (`team.struck_at` och `entry.struck_at`, brickorna släpps, revisionerna står kvar, auditpost); "Hela laget
ej start" sätter ej start på sträckor utan resultat. "Byt variant" per sträcka i lagkortet, med samma besked.

### 3. Omstart och placering
- Fast omstart (`RESTART`): som förut; tiden kan ändras på tävlingsdagen under Start och berörda sträckor räknas om.
- **Flygande omstart** (`FLYING_RESTART`, `relay_leg.restart_after_minutes`): omstartstiden för sträcka n är **ledarlagets
  växling till sträckan** plus gränsen. Ledaren är det lag som växlade först, oavsett status – felstämpling blir känd först
  vid avläsningen och påverkar inte när nästa löpare faktiskt gick ut. Gränsen räknas mot ledarens växling (som är samma
  som ledarens start på sträckan). SOFT:s tävlingsregler säger inget om flygande omstart; detta är hur den brukar beskrivas
  i PM ("lag mer än en timme efter ledaren startar i omstart"). Innan något lag växlat finns ingen omstartstid.
- Sträckans start räknas för hela klassen i domänen (`relayClassLegStarts`), eftersom ett lags växling kan ändra andra lags
  starter. Synkningen tar ett lås per klass, så att avläsning på flera datorer samtidigt (linjestafett) ger samma starter.
  En rättad måltid för ledaren ger ny omstartstid och omräkning.
- Lag som saknar avläsning på föregående sträcka eller brutit utan mål startar i omstarten. Föregående löpares resultat
  ändras aldrig av en omstart.
- **Lagets tid är summan av sträcktiderna** (SOFT TR 5.8.2: "summan av dessa lags individuella tider avgör placeringen").
- **Förval (SOFT TR 5.8.2): lag som deltagit i omstart placeras efter lag med enbart normala växlingar**, sinsemellan efter
  summan; placeringen fortsätter i en följd. Alternativ som klassinställning: alla lag efter summan (`BY_TIME`).
- "Omstart" visas per sträcka i lagkortet, den publika resultatlistan, sträckresultaten och speakern, och "deltog i
  omstart" per lag. Funktionärsvyn (Avläsning) visar per omstart tiden ("omstart kl. 11:00 (ledaren växlade 10:00 + 60
  min)") och lagen som inte växlat till sträckan.

### 4. Gafflad stafett: rättvis fördelning
En stafettgaffling är rättvis när alla lag totalt springer samma kontrollsträckor. Sträckor med samma gafflade bana är en
grupp. Klassinställning:
- **Utjämnad gaffling (förval):** för varje lag väljs en rättvis kombination av varianter – de multimängder vars
  kontrollsträckor tillsammans är exakt `k/v` gånger alla varianters (k sträckor, v varianter). Det klarar fler varianter
  än sträckor (t.ex. två gafflingspunkter med tre val = nio varianter på tre sträckor) och flera banor. Bland
  kombinationerna väljs den som ger jämnast användning över lagen, och den läggs på sträckorna så att varje variant används
  så jämnt som möjligt per sträcka. Saknas rättvisa kombinationer sprids varianterna som vid fulgaffling. Deterministiskt
  med ett frö ur klassens id; ett efteranmält lag fördelas utifrån de befintliga lagen.
- **Fulgaffling:** varianterna behöver inte vara likvärdiga; de sprids jämnt per sträcka och över lagen.
Rättvisekontrollen per lag (`unfairRelayTeams`) jämför varje lags kontrollsträckor med de flesta lagens. Vid utjämnad
gaffling är det en varning i lagvyn med vad laget saknar och har extra; vid fulgaffling en upplysning. Den gamla varningen
per variant ("Varianterna täcker inte samma sträckor") visas inte för en bana som bara används i stafett. Längd per variant
kräver variantens längd från banfilen, som steg 49 (agent B) lägger till; den visas därför inte här än.

### 5. Synlighet och storlek
Radiokontroller, Live och speakern tar med stafettlöpare (klassen "Klass · sträcka N" och laget). Vägval på kartan går för
sträcklöpare (rutt per sträcklöpare, samma sträcknycklar). Upp till 30 sträckor (25-manna med marginal).
Mätt (integrationstest, 25 sträckor × 300 lag = 7 500 sträcklöpare, utvecklingsdator): första starterna 0,5–0,9 s,
avläsning med klassynk 0,35 s, flyttad omstart 0,35–0,4 s, publik lagresultatlista 0,25 s.


## Beslut (steg 48)

### 6. Flera löpare per sträcka (parallella sträckor)
En sträcka kan ha 2–4 löpare i samma lag (`relay_leg.runners`, migration 0022) som springer samtidigt, var och en med egen
bricka och egen variant. Löparens plats inom sträckan är `entry.relay_leg_order` (IOF `LegOrder`; NULL = 1, så att
befintliga sträcklöpare är oförändrade); det unika indexet är (lag, sträcka, ordning). Inställning per sträcka:
- "Växlar när": första i mål (`FIRST`, förval) eller sista i mål (`LAST`: när alla löpare har ett resultat, den senaste
  måltiden bland dem som gått i mål – en löpare som brutit utan mål hindrar alltså inte växlingen).
- "Godkänt när": alla är godkända (`ALL`, förval) eller minst en är godkänd (`ANY`).
Sträckans tid för laget är tiden från sträckans start till växlingen; nästa sträcka startar vid växlingen (eller i
omstarten). Varje löpare bedöms som en individuell avläsning från sträckans start. Domänen: `relayParallelChangeover` och
`relayParallelLegOutcome` (`relay-parallel.ts`).

### 7. Teamsprint med utläsning efter sista sträckan (valet "Utläsning efter sista sträckan (växlingskontroll)")
Steg 48:s sätt. Sedan steg 50 är det ett val per klass; förvalet är utläsning efter varje sträcka (beslut 9).
Praxis med SPORTident (IOF:s regler för sprintstafett och mixed sprint relay, och hur MeOS beskriver teamsprint): varje
löpare har en egen bricka och springer flera sträckor; växlingen sker i ett växlingsområde där löparen stämplar en
växlingskontroll (eller målenheten) när sträckan är slut och lagkamraten går ut. Brickan läses ut först efter löparens
sista sträcka och innehåller då stämplingar från flera sträckor. MeOS delar avläsningen per sträcka med hjälp av banornas
kontroller och växlingsstämplingen; O-Tid gör samma sak med en uttrycklig växlingskontroll:
- Klassen har en växlingskontroll (`class.relay_changeover_code`). Varje sträckas bana slutar vid den (koden ingår inte i
  banan); lagets sista sträcka slutar vid målet.
- Sträcklöparen pekar på brickans ägare (`entry.relay_card_entry_id`, löparens första sträcka); brickan sitter bara där.
- Avläsningen delas vid växlingsstämplingarna (dubbelstämpling inom 60 s räknas en gång): del j slutar vid löparens j:e
  växlingsstämpling och bedöms mot löparens j:e sträcka med sträckans start (`teamSprintReadoutPart`). Delningen görs i
  resultatmotorn, så avläsning, omräkning och avläsningsskalet använder samma regel.
- Sträcka n startar när sträcka n−1 växlade, även när den tiden kommer från lagkamratens bricka (växlingen är den delens mål).
- En felstämplad del gör bara den sträckan felstämplad. Lagets tid är summan av sträcktiderna, alltså sista målgång minus
  start när ingen omstart skett.
- Saknas en växlingsstämpling får delen inget mål (felstämplad, saknat mål) och avläsningen och lagkortet säger
  "Växlingsstämpling saknas" (`teamSprintChangeoverProblem`) – aldrig ett tyst fel. Alternativet att dela på banornas
  kontroller (utan växlingskontroll) valdes bort: det blir tvetydigt när sträckorna har gemensamma kontroller.
- Mallen "Teamsprint" i stafettklassformuläret: två löpare × fyra sträckor (A på 1 och 3, B på 2 och 4) och växlingskontroll.

### 8. Klassynk till stabila starter, IOF och begränsningar
- Klassynken räknar starter, räknar om de sträckor som fick ny start och upprepar tills inga starter ändras (högst en
  gång per plats). En omräknad sträcka kan nämligen få ett mål först då: teamsprintens del vars växling står på
  lagkamratens bricka, eller en sträcka som lästes av före föregående sträcka på en annan avläsningsdator.
- IOF EntryList: `TeamEntry` med `TeamEntryPerson` (`Leg`, `LegOrder`) blir lag i stafettklassen (klassens IOF-id, annars
  samma namn); en plats utan person blir vakant, en okänd sträcka eller ordning ger en varning i rapporten. Startlistan
  har en `TeamMemberStart` per löpare (samma `Leg` flera gånger) och resultatlistan `LegOrder` när sträckan har flera löpare.
- Eventors eget lagformat (`TeamSequence`) läses inte än; lagen kommer via IOF EntryList.
- Steg 50: löpare per sträcka, växlingskontroll och utläsningssätt kan ändras även när lag finns (beslut 9).

## Beslut (steg 50)

### 9. Teamsprint med utläsning efter varje sträcka (förval, som MeOS)
Det vanliga med SPORTident är att varje teamsprintlöpare stämplar mål och läser ut efter varje sträcka utan att tömma
brickan; så gör MeOS. Den andra utläsningen har då kvar första sträckans stämplingar, och målstämplingen är den nya (brickan
sparar bara den senaste). Förvalet är därför "Utläsning efter varje sträcka" (`class.relay_readout_mode = 'EACH_LEG'`,
migration 0024), och mallen "Teamsprint (2 löpare × 4 sträckor)" ger det. Steg 48:s sätt finns kvar som val
(`LAST_LEG`, beslut 7); en klass utan teamsprint har `NULL`, och steg 48:s klasser med växlingskontroll fick `LAST_LEG`.
- **Fördelning** (`teamSprintRoute`): en utläsning av brickan går till löparens första sträcka som ännu saknar resultat. Den
  sträckan bedöms mot stämplingarna efter föregående utläsnings måltid och mot brickans mål. Sträckans start är föregående
  sträckas växling i laget, även när den kommer från lagkamratens bricka; lagkamratens växlingstid är alltså
  målstämplingen i hens utläsning. Ingen växlingskontroll behövs.
- **Dubblett**: samma bricka utläst igen med samma måltid är en omläsning av den sträckan, inte nästa. En måltid före
  föregående sträckas mål, eller en utläsning när löparen redan har resultat på alla sina sträckor, sparas som en okänd
  utläsning med tydligt besked ("Måltiden är tidigare än sträcka X:s mål – kontrollera brickan"). Den kan sedan kopplas
  till vald sträcka under okända brickor.
- **Glömd utläsning**: kommer första utläsningen först efter löparens sista sträcka finns bara en måltid. Har klassen en
  växlingskontroll delas utläsningen vid växlingsstämplingarna som i beslut 7, och alla sträckor får mål. Annars läggs
  sträckornas banor i tur och ordning på stämplingarna (en bana räknas när den är fullbordad och nästa bana till minst
  hälften finns efter). Bara den sista sträckan får då ett resultat. De tidigare visas med "Utläsning efter sträcka X
  saknas – läs ut efter varje sträcka" i avläsningen och lagkortet, och en funktionär rättar med manuell tid. Ingen sträcka
  blir felstämplad av den glömda utläsningen: en sträcka som saknar start för att föregående sträcka saknar växling räknas
  som ute (`MISSING_START` visas inte som felstämplad i lagresultatet och de publika listorna).
- **Delningen följer resultaten**: vilken utläsning varje sträcka bygger på står i sträckans resultatrevision
  (`readout_id`). Ögonblicksbilden räknar fram varje sträckas del ur det (`teamSprintEachLegLayout`), så omräkning,
  manuella beslut och avläsningsskalet använder samma delning. När en tidigare utläsning kommer efter en senare (två
  datorer) räknas löparens andra sträckor om mot den nya delningen.
- **Okänd utläsning och omläsning från rådata**: en okänd utläsning kan kopplas till vald teamsprintsträcka, och brickan
  stannar på löparens första sträcka. Journalens koppling hör därför till tävlingen och brickan, inte till den valda
  sträckan (migration 0024). En omläsning flyttar alla sträckor som byggde på den gamla utläsningen till den nya (gäller
  också beslut 7).
- **Ändra när lag finns**: löpare per sträcka kan ändras (nya platser blir vakanta, en borttagen plats får inte ha
  resultat). Växlingskontrollen och utläsningssättet kan också ändras, med besked och omräkning som för andra klassändringar.
  En sträcka kan byta mellan "samma löpare som sträcka X" och egen löpare när ingen av de berörda sträckorna har resultat.
  Ett namnbyte gäller löparens alla sträckor.
- Alternativet att alltid kräva växlingskontroll (beslut 7) valdes bort som förval: det kräver en extra enhet och en
  stämpling som löparna glömmer. Med utläsning efter varje sträcka får varje sträcka sin måltid från målenheten.

## Beslut (steg 56)

### 10. Banor per sträcka i formuläret; klassens bana är sträcka 1:s
Ägaren: "man väljer aldrig bara en bana till en stafettklass utan man kopplar banor per sträcka". Formulären "Ny
stafettklass" och "Ändra stafettklass" har därför inget fält för klassens bana. Varje sträcka har ett obligatoriskt fält
"Bana sträcka N" (variantvalet som förut när banan är gafflad), och snabbvalet "Samma bana på alla sträckor" fyller i alla
på en gång. Modellen behåller klassens bana (`classes.course_version_id`, NOT NULL och läst på många ställen): den sätts
i bakgrunden till **sträcka 1:s bana**, både när klassen skapas och när den ändras, och visas inte för en stafettklass
(klasstabellen visar sträckornas banor och klassredigeraren hänvisar till "Ändra stafettklass"). Alla sträckors banor sparas
uttryckligen i `relay_leg.course_version_id`; NULL (= klassens) finns kvar för äldre klasser och IOF-import och läses som
förut (`entryCourseVersionId`). En sträcka som går från NULL till samma bana uttryckligen räknas som oförändrad (ingen ny
variantfördelning, ingen omräkning). Lagkortet, den publika resultatlistan och startlistan visar sträckans bana på varje
sträcka när klassens sträckor springer olika banor, annars ingen. Inga regler i domänen ändras.
Formulären visar fel vid fälten (sammanfattade överst, fokus till det första), tider skrivs 18:30, 18.30 eller 1830, och
mallarna (vanlig stafett, teamsprint, ungdomsstafett, linjestafett) sätter sträckor och inställningar men inte namn eller banor.
