# ADR-0212: Nivåstöd – grön, vit, gul … på begäran

Status: beslutad 2026-11-04 (grenen `nivastod`; omkalibrerad samma dag i grenen `nivastod-2`, se "Omkalibrering" nedan, ägarens önskemål samma dag, med tillägget om tips och guider per nivå). Bygger på
ADR-0179 (vägvalsmotorn), ADR-0180 (banläggningen), ADR-0199 (varningar och godtagna) och ADR-0211 beslut 3 (kartans norm).
Ingen migration: målnivån och valet för Varningar står i banläggningens dokument (jsonb).

## Bakgrund

Ägaren vill att banläggaren ska kunna få en känsla för om banorna motsvarar Svensk Orienterings färgnivåer, särskilt
oerfarna ungdomsledare. Det ska bara räknas "om man frågar", vara ett råd och aldrig stoppa eller störa.

Källor (sammanfattade, inget kopierat ordagrant utöver korta citat):
- SOFT, *Klasser, svårighetsnivåer, beräknade segrartider samt banlängder* (2022-03-25), avsnitt 2–4
  (https://www.orientering.se/media/vyqhrgmw/klasser-svarighetsnivaer-beraknade-segrartider-samt-banlangder-20220325.pdf):
  nivåbeskrivningarna, klass → nivå (H/D10 Vit … 18–65 Svart, 70– Blå; Inskolning Grön … Svår 3 km Blå, 5/7 km Svart),
  banlängderna och att sprint saknar färgskala.
- SOFT:s banläggarträff *Banläggningens grunder – svårighetsgrader* (träff 3, 2025,
  https://www.orientering.se/media/yjhcojkl/banläggningens-grundersvårighetsgrader-träff-3-2025.pdf): Vit K4 kontroll
  "max 50 m" från ledstången med tydligt stopp, K6 gena över öppet högst 200 m; Gul K7 gena "typ 150 m som max", K8
  grovorientering 200–300 m, K9 lätt kurvbild, säker inläsningspunkt högst 200 m före; Grön "ej för många K3".
- SOFT:s banläggarkurs steg 1 (https://www.orientering.se/media/tzolc25d/banl-kurs-steg-1-20-del1o2.pdf): Orange "ingen
  tydlig uppfångare bakom, men det ska gå att läsa in sig på rimligt avstånd", Violett "kontrolltagning utan tydlig
  uppfångare", Blå "grovorientering i svår kurvbild, finorientering i detaljrik terräng". "Frågor om banläggning" gick inte
  att hämta (robots).

## Beslut

1. **Målnivå per bana** (`Course.level`, Grön … Svart, `UPDATE_COURSE level`, null tar bort). Fältet "Nivå" i banans
   egenskaper; med klasser i undertiteln föreslås nivån ur SOFT:s tabell (`levelFromClassNames`, den svåraste när
   klasserna har olika nivå), med "Använd". Bara O-Tid: skrivs inte till .ppen och följer med när en ny .ppen läses in
   (`carryCourseLevels`, samma bana id och namn, annars namn). Kopian av en bana får nivån.
2. **Bara på begäran.** "Bedöm nivån" i vald banas panel och "Bedöm alla banor" i Banor. Inget räknas annars, och inget
   visas förrän man frågat. Körningen går i vägvalens Worker (ny begäran `level`): samma motor, och sträckornas längder
   skrivs i den gemensamma tabellen (`useRouteResults`). Workern sparar sträckornas mätning per indata (`legInput`-nyckeln)
   så att bara ändrade sträckor räknas om. Vald sträcka går före (avbryter); bedömningen tar vid när Workern är ledig, och
   varningarnas vägval väntar medan en bedömning pågår. Telefonen fryser inte (allt i Workern).
3. **Bara kartans symboler och vägvalet.** Tabellerna i `level-symbols.ts` (ISOM 2017-2-nummer, reserv på kolumn D för
   kartor med egna nummer via förslagens namnregler):
   - *Tydliga ledstänger (STRONG):* 301 strand, 304/305 bäck, 401/402 öppen marks kant, 502–506 väg och stig, 509 järnväg,
     510/511 kraftledning, 513/515 mur, 516/518 staket. *Svagare (WEAK):* 105/106 jordvall, 107 fåra, 201 opasserbar brant,
     306 dike, 308 sankmarkens kant, 309 smalt kärr, 403/404, 415/416 beståndsgräns, 501 belagd ytas kant, 507 otydlig stig,
     508 rågång, 514/517 raserad mur och staket, 521 husvägg. Öppen mark (401–404) är en yta: bara kanten mot skogen är en
     ledstång; inne på öppen mark hjälper sikten att läsa in sig (inläsning = 0) men det är ingen ledstång (omkalibreringen).
   - *Föremålets storlek:* kolumn D (IOF 2018) → BIG (höjd 1.9, stenbrott, sjö, göl, byggnad, ruin, torn, bro, glänta …),
     MEDIUM (sten 2.4, brant, sänka, sankmark, stensamling …), SMALL (liten höjd 1.10, liten grop 1.13, grop 1.14,
     småkuperat, myrstack, vattenhål, källa, stubbe, specialföremål), LINE (stigen, diket själv). Kartans nummer går före
     (204 sten, 205/206 stor sten, 109–112 små detaljer); en sten med höjd ≥ 1,5 m i kolumn F är stor. Utan kolumn D:
     kartans föremål inom 10 m, annars ledstången om kontrollen ligger på den. Små slutna höjdkurvor är höjder (≥ 30 m
     tvärs = tydlig höjd).
   - *Per kontroll:* avstånd till närmaste tydliga och närmaste ledstång (sökning 250 m), föremålet, angreppspunkt
     (närmaste stora föremål eller tydliga ledstång utom kontrollens eget), inläsning (ledstång eller stort/medelstort
     föremål), och förslag: närmaste stigkorsning (502–508), närmaste punkt på tydlig ledstång, närmaste stora föremål.
   - *Per sträcka, längs bästa vägvalet:* andel längs tydliga/alla ledstänger (inom 12 m, mätt var 5:e m), längsta bit utan,
     byten mellan ledstänger (annan ledstång som följs ≥ 15 m och går > 30° annorlunda eller är en annan symbol), om det
     lönar sig att gena (motorns nya väg längs vägar, stigar och öppen mark: `LegInput.follow`, `LegAnalysis.following`,
     övrig mark × `FOLLOW_PENALTY` = 20 i sökningen, mätt med riktiga farter), och kurvläsning (längsta bit utan ledstång
     inom 40 m där höjdkurvorna inom 25 m är ≥ 100 m eller föremålen ≥ 3).
4. **Regler som krav per nivå** (`level-rules.ts`, `LEVEL_LIMITS`). Ett krav gäller till och med en nivå; en kontrolls
   eller sträckas nivå är den lägsta där alla krav som gäller där uppfylls. Skälet är det första kravet som brister på
   nivån under ("ligger 80 m från närmaste stig eller annan ledstång – mer än Vit tillåter (50 m)"). Blå och Svart är samma
   tekniska steg ("Blå–Svart"); skillnaden är fysisk och mäts inte.

   | Regel | Gäller t.o.m. | Krav |
   |---|---|---|
   | C_ON_HANDRAIL | Grön | ≤ 10 m till tydlig ledstång |
   | C_NEAR_HANDRAIL | Vit | ≤ 25 m till ledstång, stort föremål ≤ 50 m (SOFT K4) |
   | C_CLEAR_FEATURE | Vit | stort föremål, eller ≤ 10 m från ledstången |
   | C_SOME_DISTANCE | Gul | ≤ 30 m till ledstång, stort föremål ≤ 75 m |
   | C_SMALL_NEAR | Gul | litet föremål bara ≤ 10 m från ledstången (punkthöjd, sänka är Orange i SOFT:s exempel) |
   | C_SMALL_REACH | Orange | litet föremål bara med ledstång eller angreppspunkt ≤ 100 m |
   | C_RELOCATION | Orange | något att läsa in sig på ≤ 150 m (Violett klarar detaljfattig terräng, K15) |
   | C_ATTACK | Violett | litet föremål bara med stor angreppspunkt ≤ 150 m |
   | L_FOLLOW_CLEAR | Grön | ≥ 90 % längs ledstänger, ≤ 20 m utan |
   | L_FEW_DECISIONS | Grön | ≤ 4 byten mellan ledstänger |
   | L_NO_CHOICE | Grön | inga likvärdiga vägval ("Vägval: Inga") |
   | L_NO_SHORTCUT | Vit | att gena sparar < 50 % |
   | L_FOLLOW | Vit | ≥ 70 % längs ledstänger, ≤ 30 m utan |
   | L_SOME_DECISIONS | Vit | ≤ 6 byten och ≤ 4 stigkorsningar |
   | L_EASY_CONTOURS | Gul | ≤ 50 m kurvläsning (K9) |
   | L_SHORT_OFF | Gul | ≤ 100 m utan ledstång |
   | L_NETWORK | Gul | ≤ 10 byten och ≤ 8 stigkorsningar (tätt stignät) |
   | L_ROUTE_CHOICE | Gul | högst ett likvärdigt vägval inom 10 % (V2 enkla vägval; flera = V3, Orange) |
   | L_CONTOURS | Violett | ≤ 150 m kurvläsning |
   | L_OFF | Violett | ≤ 250 m utan ledstång |
   | L_HARD_CHOICE | Violett | inte två likvärdiga vägval med ≥ 16 byten (V4 svår vägvalsbedömning, Blå) |

   Talen utan SOFT-källa är egna tumregler, valda försiktigt (hellre en nivå för lätt än för svår). Banans sammanfattning:
   "Banan motsvarar ungefär Gul–Orange" (medianen till 85:e percentilen av alla kontroller och sträckor) och "3 sträckor och
   2 kontroller är svårare än Gul" (målnivån, annars den lägre). Sedan omkalibreringen: "Banan motsvarar ungefär Orange
   (Gul–Orange)" där nivån är punkten där två tredjedelar av kontrollerna och sträckorna är högst så svåra (`typical`).
5. **Tips per avvikelse** (ägarens tillägg). Varje regel har ett tips (`LEVEL_TIPS`); mot målnivån visas tipset för det
   första krav som brister där, under skälet. Tydligt lättare (minst två steg under en målnivå från Gul) har egna regler:
   `E_CONTROL_EASY`, `E_LEG_NO_SHORTCUT` ("Här lönar det sig inte att gena – flytta kontrollen så genvägen blir tydlig"),
   `E_LEG_EASY`. "Visa förslag på kartan" markerar regelns förslag (stigkorsning, närmaste stig, stort föremål, biten utan
   ledstång) där de finns.
6. **Presentation.** Panelen "Nivåstöd" under banans egenskaper i Banor (i telefonen i bladet nertill): "Ett stöd – du som
   banläggare avgör", målnivån, sammanfattningen och en hopfällbar lista med märket i nivåns färg, skälet, tipset, "Visa på
   kartan" (väljer kontrollen eller sträckan) och "Visa förslag på kartan". Små märken vid kontroller och mitt på sträckor
   för vald bana efter en bedömning, "Nivåmarkeringar" under Visa (per webbläsare, på).
7. **Inaktuell, inte omräknad.** Resultatet sparas per bana i minnet med en signatur (sträckornas indata med spärrar,
   kontrollerna med kolumn D och F, kartfilen). Ändras något står det "Inaktuell – bedöm igen"; inget räknas om av sig självt.
8. **Varningar bara när man ber om det.** Med en målnivå finns "Visa avvikelser mot nivån i Varningar" (`event.levelNotices`,
   `SET_EVENT`, av som förval). Då blir avvikelserna i ett aktuellt resultat notiser (`LEVEL_DEVIATION`, aldrig fel eller
   varningar), nyckel `LEVEL_DEVIATION/<målnivå>/<kontroll>` eller `…/<från>/<till>` utan bana, som godtas som andra
   (ADR-0199, gäller tills något flyttas mer än 25 m).
9. **Sprint:** inte tillämpligt. En karta i sprintskala (1:4 000, 1:5 000), eller banläggning med ISSprOM 2019 *och* kartskala
   1:5 000 eller mindre, ger (tillägg 2026-11-04: ISSprOM-påtryck ensamt räcker inte; Stockholm by Night läggs med
   ISSprOM-påtryck på en skogskarta och ska bedömas)
   "Nivåstödet gäller inte sprint". (Före omkalibreringen användes `detectPressNorm`, som räknar Djurgårdens parkkarta i
   1:15 000 som sprint för att den har ISSprOM-symboler; en sådan park är skogsnorm.)
10. **Hjälp:** "Nivåstöd – grön, vit, gul …" och en guide per nivå ("Så lägger du en gul bana", Blå och Svart tillsammans)
    med föremål, avstånd, sträckor, angreppspunkter, SOFT:s banlängder och en vanlig fallgrop. "Hur lägger man en gul bana?"
    vid fältet Nivå och i panelen.

## Avgränsningar och risker

- Verktyget ser inte sikt, löpbarhet utöver kartans klasser, säsong eller hur tydlig en detalj är i verkligheten.
- Kurvläsningen är en grov approximation (kurvtäthet och föremål runt vägen), utan riktning eller formtolkning.
- Startens och målets sträckor bedöms som andra sträckor; markerade vägar (snitsel) räknas inte som ledstång.
- Gränserna ska stämmas av mot riktiga banor med kända nivåer; tabellen är samlad på ett ställe för det.

## Omkalibrering 2026-11-04 (grenen `nivastod-2`)

**Varför.** Ägaren lade natt-KM-banorna på Djurgården själv och väntade sig Gul–Orange; första versionen gav Vit–Gul.
Koordinatorn lämnade också klubbens träningsbank: 83 anonymiserade .ppen med märkt nivå i bannamnet (grön 12, vit 110, gul
103, orange 52, ingen 50) och 40 kartor. 72 filer gick att läsa (övriga saknar bilddata eller har trasiga referenser efter
anonymiseringen), med 238 märkta banor. Filerna ligger bara lokalt och committas aldrig; bara sammanställningar redovisas.
Ägarens varning: inte varje bana är perfekt för sin nivå, och skogarna nära klubben har så många ledstänger att det är svårt
att lägga svåra banor.

**Fler källor.** SOFT:s *Checklista gul bana* (2014, https://koncept.orientering.se/documents/986/checklista-gul.pdf): gena
"mindre än 300 meter genom obanad terräng", grovorientering med "stora och tydliga hållpunkter", kontroll "uppe på en tydlig
höjd", V2 "bedömning av längd och löpbarhet". SOFT:s *OL-introduktion del 2*
(https://koncept.orientering.se/documents/1379/OLIntroduktion_del2.pdf): Gul-exemplen har kontroll vid en stor sten eller en
sten nedanför en brant, Orange-exemplen vid en punkthöjd eller i en sänka. SOFT:s *Pub vit bana* och *Pub gul bana*
(https://nya.orientering.se/media/skogluiz/pub-vit-bana.pdf, https://nya.orientering.se/media/fm5feku3/pub-gul-bana.pdf): Vit
har "vägval, kontroller vid sidan av ledstången och gena över öppen mark"; Gul "i huvudsak" ledstänger, sträckor utan ledstång i
"lättlöpt och bra sikt". *Pub orange bana* (https://nya.orientering.se/media/xx2fuiq5/pub-orange-bana.pdf): kontroller vid
"åsar och sänkor", vägval "lite svårare än på tidigare nivåer". *Checklista violett*
(https://koncept.orientering.se/documents/985/checklista-violett.pdf): K14 och K15. *Banläggningens grunder – svårighetsgrader,
träff 1 2025* (https://www.orientering.se/media/kqrlvevx/banläggningens-grundersvårighetsgrader-träff-1-2025.pdf): "Det
svåraste momentet avgör sträckans svårighet"; H16 natt nämns som exempel på svår bana. Träff 2 och "Frågor om banläggning"
gick inte att hämta (robots). Ingen källa ger egna regler för parker: en park på en skogskarta bedöms med skogsnormens nivåer.

**Ändrat.**
1. Öppen mark är en yta, ingen ledstång (bara kanten). Inne på öppen mark räknas inläsningen som 0 (sikt).
2. Föremålet väger mer: Vit kräver ett stort föremål eller kontrollen ≤ 10 m från ledstången; små föremål (punkthöjd, liten
   grop, liten sten under 1 m i kolumn F, särpräglat träd 4.9, beståndsgräns 4.7) är Orange utom på stigen.
3. Vägvalets komplexitet: nya mått `junctions` (stigkorsningar som vägen passerar, där minst tre armar möts; en stig i flera
   delar ände mot ände räknas inte) och `closeAlternatives` (motorns skilda vägval inom 10 % av det bästa), och reglerna
   L_NO_CHOICE, L_SOME_DECISIONS, L_NETWORK, L_ROUTE_CHOICE och L_HARD_CHOICE.
4. Genandet: 10 % sparat räckte för att en sträcka skulle bli Gul, men små vinster finns på nästan alla sträckor (median 17 %
   på klubbens vita banor, 27 % på gula, 22 % på orange) och skiljer inte nivåerna. Gränsen är 50 %; att gena långt genom
   skogen fångas i stället av längsta biten utan ledstång, som nu skiljer nivåerna (75:e percentilen vit 30 m, gul 60 m,
   orange 100 m) när öppen mark inte räknas som ledstång.
5. Avstånden till ledstång stämdes mot de märkta banorna (75:e percentilen vit 8 m, gul 12 m, orange 24 m till närmaste
   ledstång): Vit 25 m (stort föremål 50 m, SOFT K4), Gul 30 m (stort 75 m), sträckor Vit 30 m, Gul 100 m och Violett 250 m
   utan ledstång. Gränserna valdes som runda tal ur en grovsökning med mål att flest banor hamnar inom ±1 steg och att varje
   nivå ligger nära sitt medelvärde, utan att Djurgården blir lättare än Gul–Orange.
6. Banans nivå är två tredjedelar-punkten (`typical`), med spridningen median–85:e percentilen.
7. Natt: varken tävlingen eller banläggningen har ett nattval, så "Natt: upplevs svårare" visas inte (SOFT: samma nivåer).

**Före och efter** (märkt nivå i raderna, bedömd i kolumnerna Grön/Vit/Gul/Orange/Violett/Blå–Svart):

| Märkt | Före (75:e percentilen) | Efter (två tredjedelar) | Medel före → efter |
|---|---|---|---|
| Grön (10) | 4/2/4/0/0/0 | 7/3/0/0/0/0 | 1,00 → 0,30 |
| Vit (95) | 12/13/69/1/0/0 | 16/33/41/5/0/0 | 1,85 → 1,37 |
| Gul (90) | 8/8/72/2/0/0 | 14/6/50/20/0/0 | 1,96 → 1,84 |
| Orange (43) | 1/2/35/5/0/0 | 3/1/18/21/0/0 | 2,02 → 2,33 |

Inom ±1 steg: 93 % före och 90 % efter; exakt rätt: 39 % före och 47 % efter. Före hamnade nästan allt på Gul (vita och
orange banor likaså); efter ligger nivåerna i rätt ordning med en dryg halv nivås marginal. Orange bedöms fortfarande oftare
som Gul än tvärtom, vilket stämmer med ägarens varning om ledstångstäta skogar.

Djurgården natt-KM (12 banor, 0,9–9,9 km): före 2–2 (Gul) på åtta banor och 1–2 (Vit–Gul) på fyra; efter spridningen 2–3
(Gul–Orange) på nio banor, 3–3 på två och 2–2 på en, och banans nivå Orange på nio av tolv, bland dem alla fem banor på
6,8–9,9 km (de tre på Gul är 2,0, 2,3 och 3,4 km). Sträckorna gick från
10/6/99/18/0/0 till 0/2/55/71/0/5 och kontrollerna från 8/82/31/0/0/0 till 5/36/54/26/0/0.

