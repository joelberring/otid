# ADR-0212: Nivåstöd – grön, vit, gul … på begäran

Status: beslutad 2026-11-04 (grenen `nivastod`, ägarens önskemål samma dag, med tillägget om tips och guider per nivå). Bygger på
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
     508 rågång, 514/517 raserad mur och staket, 521 husvägg. Öppen mark (401–404) räknas som på ledstången.
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
   | C_ON_HANDRAIL | Grön | ≤ 10 m till tydlig ledstång (öppen mark = 0) |
   | C_NEAR_HANDRAIL | Vit | ≤ 50 m till ledstång (SOFT K4) |
   | C_CLEAR_FEATURE | Vit | föremålet inte litet (utom på stigen) |
   | C_SOME_DISTANCE | Gul | ≤ 150 m till ledstång (K7) |
   | C_SMALL_NEAR | Gul | litet föremål bara ≤ 50 m från ledstång |
   | C_SMALL_REACH | Orange | litet föremål bara ≤ 150 m från ledstång |
   | C_RELOCATION | Orange | något att läsa in sig på ≤ 150 m (Violett klarar detaljfattig terräng, K15) |
   | C_ATTACK | Violett | litet föremål bara med stor angreppspunkt ≤ 150 m |
   | L_FOLLOW_CLEAR | Grön | ≥ 90 % längs tydliga ledstänger, ≤ 30 m utan |
   | L_FEW_DECISIONS | Grön | ≤ 4 byten mellan ledstänger |
   | L_NO_SHORTCUT | Vit | att gena sparar < 10 % |
   | L_FOLLOW | Vit | ≥ 70 % längs ledstänger, ≤ 60 m utan |
   | L_EASY_CONTOURS | Gul | ≤ 50 m kurvläsning (K9) |
   | L_SHORT_OFF | Gul | ≤ 200 m utan ledstång (K7–K8) |
   | L_CONTOURS | Violett | ≤ 150 m kurvläsning |
   | L_OFF | Violett | ≤ 400 m utan ledstång |

   Talen utan SOFT-källa är egna tumregler, valda försiktigt (hellre en nivå för lätt än för svår). Banans sammanfattning:
   "Banan motsvarar ungefär Gul–Orange" (medianen till 85:e percentilen av alla kontroller och sträckor) och "3 sträckor och
   2 kontroller är svårare än Gul" (målnivån, annars den lägre).
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
9. **Sprint:** inte tillämpligt. Banläggningen med ISSprOM 2019 eller en karta som `detectPressNorm` (ADR-0211) säger är
   sprint ger "Nivåstödet gäller inte sprint".
10. **Hjälp:** "Nivåstöd – grön, vit, gul …" och en guide per nivå ("Så lägger du en gul bana", Blå och Svart tillsammans)
    med föremål, avstånd, sträckor, angreppspunkter, SOFT:s banlängder och en vanlig fallgrop. "Hur lägger man en gul bana?"
    vid fältet Nivå och i panelen.

## Avgränsningar och risker

- Verktyget ser inte sikt, löpbarhet utöver kartans klasser, säsong eller hur tydlig en detalj är i verkligheten.
- Kurvläsningen är en grov approximation (kurvtäthet och föremål runt vägen), utan riktning eller formtolkning.
- Startens och målets sträckor bedöms som andra sträckor; markerade vägar (snitsel) räknas inte som ledstång.
- Gränserna ska stämmas av mot riktiga banor med kända nivåer; tabellen är samlad på ett ställe för det.
