# ADR-0225: Bingoorientering och Sänka skepp med telefonen

Status: beslutad och byggd 2026-11-15 (ägarens önskemål samma dag, ungdomarnas vinterträning tisdag 2026-11-17). Migration
0125 och 0126. Bygger på ADR-0192 (träningsläget), ADR-0172 (publika sidor), steg 41 (självregistrering) och ADR-0189
(gallring).

## Bakgrund

Ägaren vill köra bingoorientering: ett rutnät över skogen, olika stora rutor för olika grupper, besök så många rutor som
möjligt. Helst publicerat som träning med anmälan på plats utan konto, där telefonen följer spåret, plingar för varje tagen
ruta och visar sträckan; annars bara utskrivna rutor. Samma dag kom ett andra läge, Sänka skepp, på samma grund. Det här är
GPS-följning, som ADR-0168 parkerade, och den första publika skrivningen av löpardata utan inloggning utöver steg 41.

## Beslut

1. **Rutnätet är en träningsform i banläggningen.** En grupp är en bana utan kontroller med `CourseTraining.bingo` (område i
   kartans mm, rutans sida i meter, valfritt eget område och skeppens längder). Rutorna följer kartans papper (kartans norr,
   ADR-0223), heter kolumnens bokstav och radens siffra från övre vänstra hörnet, och en kantruta med mindre än 40 % inne i
   området tas bort (`bingoCells`). Banpåtrycket ritar rutnätet och namnen i banans lila, så förhandsvisningen, PDF:en,
   .ppen och ångra fungerar som för andra träningsformer. Utskriften är den vanliga.
2. **Telefonen slås på per tävling** (`bingo_race`, admin, auditpost) med läget Bingo eller Sänka skepp. Grupperna och
   rutorna läses ur banläggningens dokument; georeferensen ur kartfilen (`race_map_source`). Utan georeferens kan telefonen
   inte räkna rutorna och sidan säger det.
3. **Bara den dagen.** En tävling med bingo på syns på startsidan bara under Pågår nu och aldrig i Kommande eller Senaste.
   Löparens sida (`/t/<kod>/bingo`) och topplistan är öppna bara på träningsdagen i tävlingens tidszon; arrangören och
   funktionären kan prova alla dagar. Tävlingen måste vara publicerad (samma grind som andra publika sidor).
4. **Anmälan på plats utan konto.** Namnet (det enda löparen skriver), gruppen och Starta. Telefonen slumpar ett id för loppet
   och skickar hela sitt läge; servern tar emot idempotent på tävling + id och slår ihop (`mergeBingoProgress`, `mergeShots`).
   Exakt Origin, högst 512 kB, spärr per IP (3 000 per 10 minuter, mobilnät delar adresser) och 400 nya löpare per tävling
   och dygn. Telefonen sparar loppet i localStorage vid varje ändring och tar bort det först när servern kvitterat den
   senaste versionen.
5. **Reglerna är rena funktioner i `packages/domain`.** Bingo: en ruta är tagen med en position ≤ 25 m noggrann minst 10 m in
   i rutan, eller två sådana i rad i rutan; sträckan räknas med positioner ≤ 30 m, steg minst 5 m (eller halva noggrannheten)
   och fart ≤ 8 m/s; efter mer än 30 s utan position är det ett glapp, och ingen sträcka räknas över det. Sänka skepp: egna
   skepp ur ett frö (servern behåller det första), raka och inte intill varandra; ett skott tar en position ≤ 20 m inom 20 s;
   rätt ruta är inne i rutan eller inom max(10 m, noggrannheten), högst 25 m, från kanten; +1 per träff, +2 per sänkt skepp,
   −1 per fel ruta; varje ruta kan skjutas en gång. Servern bedömer skotten på nytt med samma funktioner.
6. **Fickläget.** Under loppet visar sidan en nästan svart skärm med stora siffror, brickan eller skottbrädet och gruppens
   topplista, aldrig kartan eller positionen. Mål och Avbryt kräver ett långt tryck (2 s) eller en bekräftelse. I Bingo hålls
   skärmen tänd med Wake Lock (tas igen när sidan syns), och ett glapp visas som "GPS var avbruten mm:ss–mm:ss". I Sänka
   skepp behövs ingen kontinuerlig GPS och telefonen får vara låst mellan skotten. Kartan med spåret eller skotten och
   skeppen visas efter Mål.
7. **Integritet.** Publikt syns bara topplistan (namn, rutor eller poäng, tid, sträcka) och bara den dagen; sidorna indexeras
   aldrig. Spåren och skottens positioner läser bara admin (`/admin/<tävling>/bingo`). Löparna följer inte med i
   säkerhetskopian; gallringen (ADR-0189) tar bort dem.

## Följder

- iPhone: Safari ger ingen position när skärmen är låst eller sidan dold, och vibration finns inte. Ljudet följer ljudlöst-
  knappen utom i Safari 17+ (`navigator.audioSession`). Instruktionen säger att skärmen inte ska låsas.
- ADR-0168 beslut 5 (GPS-följning parkerad) gäller fortfarande tävlingar; det här gäller bara bingo och Sänka skepp.

## Tillägg 2026-11-16: Sänka skepp som lagspel

- **Gemensamma och egna skepp.** Gruppen har två fält: «Gemensamma skepp» (samma för alla i gruppen, placeras ur gruppens frö
  `bingoGroupSeed` = FNV-1a av tävlingens och banans id, ingen migration) och «Egna skepp» (ur löparens frö, utanför de
  gemensamma och deras grannrutor, `placeGroupShips`). Båda tomma ger förvalet efter rutnätets storlek (`defaultShipSplit`:
  litet gemensamt 2 och egna 1, 1; stort gemensamma 4, 3 och egna 2, 2). Det äldre fältet «Skepp» (`ships`) är egna skepp
  utan gemensamma. Poängen är oförändrade; topplistan och ledarens tabell visar sänkta gemensamma för sig.
- **Prickar för andras skott.** Topplistans svar har per grupp antalet löpare som stått i rutan och skjutit (vatten, träff
  eller sänkt, inte fel ruta; `shotCellCounts`), utan namn och positioner. Löparens skottbräde visar de andras prickar
  (utan löparen själv) i rutans hörn, en per person upp till fyra, sedan en siffra, neutrala så att de inte säger om det var
  träff. Tävlingssidan visar samma prickar som ett rutnät per grupp («där gruppen har varit»). Hämtas var 15:e sekund.

### Handledning (ledaren)

Banläggning → fliken Träning → Bingo: rita området, lägg till grupper; per grupp rutstorlek, skala, «Eget område»,
«Gemensamma skepp» och «Egna skepp» (tomma = förval). Längst ned «Med telefonen»: bocka i och välj läget Sänka skepp.
Publicera träningen. Löparna: tävlingssidan → «Bingo: anmäl dig och starta».
