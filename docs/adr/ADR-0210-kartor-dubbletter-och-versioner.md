# ADR-0210: Dubbletter och versioner av klubbarkivets kartor, och kartan ur klubbarkivet i en ny tävling

Status: beslutad 2026-11-03 (grenen `kartor-sammanfoga`, migration 0077, ägarens önskemål samma dag). Bygger på ADR-0194
(klubbarkivet, kartan är logisk och har versioner), ADR-0196 (kontrollen och bilderna ritas i webbläsaren) och ADR-0189
(kartinnehållet lagras en gång).

## Bakgrund

OK Älvsjö-Örbys arkiv (åtta års träningar) visar många kartor flera gånger i Kartor-fliken. Samma karta har sparats under
olika filnamn ("Älvsjöskogen 2019.ocd", "alvsjoskogen_ny.ocd", "Älvsjöskogen rev 2021.omap"), och importen grupperar bara
på namnet utan datum och versionsbeteckning (ADR-0194 beslut 6). Varje fil blev en egen karta i stället för en version.
Ägaren vill att O-Tid hittar troliga dubbletter, slår ihop dem till en karta med versionerna i årsordning och gör det lätt
att sätta samma uppgifter på alla versioner. Han vill också kunna välja en karta ur klubbarkivet när en ny träning eller
tävling skapas, i stället för att ladda upp kartfilen igen.

## Beslut

1. **Troliga dubbletter** räknas per par av kartor i klubben (`@o-tid/domain`, `map-duplicates.ts`, ren funktion):
   - **Georeferensen:** båda georefererade i samma koordinatsystem ger överlappet av ytorna i terrängen. Skärning genom
     union ≥ 0,5 (eller ≥ 0,85 av den mindre ytan, en utökad karta) är starkt (+0,6); ≥ 0,2 (eller 0,5) ger +0,3. Under
     0,05 är det olika områden och paret föreslås aldrig, vad kartorna än heter.
   - **Namnet:** gemener, utan accenter (å, ä → a, ö → o), filändelse, datum och år, och utan orden ny, rev, reviderad,
     version, v2, karta, ocad, final, kopia och siffror. Likheten är det största av ordens överlapp och teckenparen i de
     hopskrivna orden (Dice). Samma namn +0,45, liknande (≥ 0,75) +0,35, svagt (≥ 0,5) +0,15. Har båda namnen ett eget ord
     som inte liknar det andra ("norra" mot "södra") blir likheten högst 0,6. Versionernas filnamn jämförs också.
   - **Innehållet:** utan jämförbar georeferens kartytan i kartans mm med samma skala (≥ 0,6 +0,3), symbolerna (samma
     +0,15, Jaccard ≥ 0,8 +0,1) och samma skala (+0,05).
   - **Träningarna** som använder båda kartorna: +0,1 (+0,05 till vid tre eller fler).

   Poängen ≥ 0,75 är "Troligen samma karta", ≥ 0,45 "Kanske samma". Paren blir grupper (sammanhängande par); gruppen är
   säker när de säkra paren ensamma binder ihop den. En grupp med fler än 8 kartor delas i de säkra grupperna och de osäkra
   paren. Inget slås ihop av sig självt.
2. **Fingeravtrycket** sparas när en kartversion kontrolleras i webbläsaren (ADR-0196): kartytan i mm, ytan i terrängen (hörnen
   genom georeferensen när koordinatsystemet är känt), skalan, symbolkoderna som används (högst 600) med en hash, och antalet
   objekt (`club_map_version_check.fingerprint`, högst 32 kB). Servern läser aldrig om kartfilerna. En fungerande version
   utan fingeravtryck kontrolleras igen (sex per besök som förut, eller "Kontrollera alla kartor igen").
3. **"Möjliga dubbletter (n)"** överst i Kartor-fliken för ägare och administratörer: kartorna sida vid sida med bild, namn,
   "1 version, 2019", filnamnen och ytan, och skälen ("Samma område (82 % överlapp)", "Liknande namn", "Samma symboler",
   "Används i samma träning"). "Behåll namn och uppgifter från" väljer kartan som behålls (förval: flest träningar, sedan
   nyaste versionen); i en grupp med fler än två kartor kan en karta tas bort ur sammanslagningen. "Slå ihop till en karta"
   och "Inte samma karta" (alla par i gruppen sparas i `club_map_duplicate_dismissal` och föreslås aldrig igen). Kartorna
   kan också kryssas i listan och slås ihop med "Slå ihop markerade". ADR-0194:s "Slå ihop med …" är borta ur gränssnittet;
   anropet finns kvar och gör samma journalförda sammanslagning.
4. **Sammanslagningen är bara metadata.** De uppgångna kartornas versioner byter karta, träningsgruppernas kartor som pekade
   på en uppgången karta pekar på den som behålls (deras sparade rättigheter ändras inte förrän kartans rättigheter ändras
   nästa gång), och de tomma kartorna tas bort. Kartinnehållet (ADR-0189), dess referenser och kvoten är orörda. Banfilerna
   och träningarna pekar på sin exakta version och ändras inte; en banfil som gjordes på en uppgången karta visar nu den
   behållna kartans namn och samma version. Journalen får `CLUB_MAP_MERGED`.
5. **"Ångra sammanslagning"** under kartans "Historik": `club_map_merge` sparar de uppgångna kartornas rader, versionerna och
   gruppernas kartor som flyttades, och den behållna kartans versioner och ändringstid direkt efteråt. Ångra återskapar
   kartorna med samma id, namn och rättigheter och flyttar tillbaka versionerna och gruppernas kartor (`CLUB_MAP_MERGE_UNDONE`).
   Det går så länge den behållna kartan har samma versioner och inte har ändrats (namn, rättigheter, ny eller flyttad version);
   ändrade år och uppgifter på versionerna hindrar inte. Annars svarar servern 409 och historiken säger det.
6. **Varje version har ett år** (`club_map_version.version_year` när någon har skrivit in det). Annars gissas det när arkivet
   visas, i ordningen: ett år i filnamnet (det senaste om flera), ett år i en mapps namn i importens sökväg, importens
   årsmapp ("2019", "2019 träningar"), versionens datum (importen sätter det ur filnamnets datum eller den första träningen
   som använde kartan) och sist dagen för uppladdningen. OCAD- och Mapper-filerna har inget eget datum att läsa, så
   "filens metadata" finns inte som källa. Versionerna står nyaste först (år, datum, uppladdning) och kartans kort säger
   "5 versioner, 2014–2023". "Ändra år och uppgifter" skriver in året (tomt = gissa igen), kartritaren och anteckningen.
7. **Uppgifterna sätts en gång på kartan:** namn, beskrivning och kartritare (`club_map.description`, `club_map.maker`) under
   "Namn och beskrivning", rättigheterna som förut. Versionerna har egen kartritare och anteckning. "Kopiera till alla
   versioner" (från en version: kartritaren och/eller anteckningen; från kartan: kartritaren) och "Från kartan" (en version
   tar kartans kartritare) visar först vad som ändras. Varje ändrad version och dess tidigare värden står i journalen
   (`CLUB_MAP_VERSIONS_COPIED`). Skalan står i fingeravtrycket per version och är inget fält att kopiera.
8. **"Välj karta från klubbarkivet"** i formuläret "Skapa tävling" och i banläggningens start när tävlingen saknar kartfil:
   kartorna i kontots klubbar med bild, namn och "5 versioner, 2014–2023", sammanslagna kartor som en karta med versioner,
   senaste versionen förvald och en annan valbar. Kartan blir tävlingens kartfil med samma väg som "Använd igen" (ADR-0194
   beslut 4): versionen ritas i webbläsaren, tävlingen pekar på arkivets innehåll och bara bilden skickas, och kartans
   rättigheter följer med. Skapa tävling med en vald karta öppnar banläggningen. Kartans villkor (avtalet har gått ut, bara
   träning, avgift per utskrift) sägs i listan men stoppar inte.
9. **Behörighet.** Förslagen, sammanslagningen, ångra, "Inte samma karta" och kopieringen kräver ägare eller administratör
   i klubben (`requireClubRole(…, "ADMIN")`). Om kontot får använda en karta i en egen tävling avgör en enda funktion,
   `mayUseClubMap` (`club-map-use.ts`), som både listan och `saveClubMapVersionToRace` frågar: i dag alla medlemmar.
   Klubbens inställning för vem som får använda kartbanken (grenen `klubbtillhorighet`) läggs till där.

## Följder

- Migration 0077: nullbara kolumner (`club_map.description`, `club_map.maker`, `club_map_version.version_year`,
  `club_map_version.maker`, `club_map_version_check.fingerprint`) och tabellerna `club_map_duplicate_dismissal` och
  `club_map_merge`. Bara tillägg. De bortvalda paren och sammanslagningarna pekar inte på kartorna med främmande nycklar,
  så att en karta kan tas bort och återskapas.
- Första besöket efter uppdateringen ritar om de kontrollerade versionerna (för fingeravtrycken); tills dess jämförs de
  kartorna på namnet och träningarna ("Inte kontrollerad än").
- Gränserna är provade lokalt mot klubbarkivets riktiga OCAD-filer (som inte committas): samma karta i tre filer gav 0,95–1,25,
  två filer med samma yta men olika innehåll 0,65, och en OCAD 8-fil utan koordinatsystem med 86 % samma kartyta och 85 %
  samma symboler som en nyare version 0,45. Inga andra par av de 66 nådde 0,45.
