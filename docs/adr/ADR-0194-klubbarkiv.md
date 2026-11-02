# ADR-0194: Klubben och klubbarkivet för träningar

Status: beslutad 2026-11-02 (grenen `klubbarkiv`, migration 0059–0061, ägarens önskemål samma dag). Första klubbfunktionen
enligt ADR-0182 beslut 8. Bygger på ADR-0189 (kartinnehållet lagras en gång), ADR-0188 beslut 6 (behörighet sparad per
e-postadress) och ADR-0182 beslut 4 (kartans rättigheter).

## Bakgrund

Ägaren (OK Älvsjö-Örby) har åtta års träningsmaterial (2018–2026) i nio zip-filer från Google Drive: cirka 165 mappar
`ÅÅÅÅ/MM-DD Plats [Ledare]/…` med OCAD- och Mapper-filer, Purple Pen-filer (.ppen), IOF CourseData och mycket annat (PDF,
Word, Excel, bilder). Samma karta finns kopierad i många mappar (76 .ocd blir 39 unika), en .ppen pekar ofta på en karta i en
annan mapp, och samma område finns i flera versioner ("Älvsjöskogen 2018-08-12 V11.ocd"). Träningarna ska kunna hittas och
användas igen, och andra i klubben ska kunna bjudas in. Ägarens regel: filerna går direkt från hans dator till hans egen server,
inte via Claude eller någon tredje part.

## Beslut

1. **Klubben** (`club`) är en egen nivå över träningsgrupperna: namn, medlemmar med rollerna ägare (`OWNER`), administratör
   (`ADMIN`) och läsare (`READER`). Den som skapar klubben är ägare. Medlemmar läggs till med e-postadressen och sparas för
   adressen (`club_invitation`) som ADR-0188 beslut 6: svaret är detsamma med och utan konto, och inbjudan blir ett medlemskap
   när ett konto med adressen och bekräftad e-post loggar in, bekräftar adressen, öppnar Mina tävlingar eller klubben. Bara
   ägare och administratörer bjuder in, ändrar och importerar; en ägare kan bara läggas till eller tas bort av en ägare, och den
   sista ägaren kan inte tas bort. Läsare ser arkivet, laddar ner originalen och använder träningarna igen i sina egna tävlingar.
   `training_group.club_id` (nullbar) låter en klubb äga grupper senare utan att grupperna görs om (ADR-0182 beslut 8); den
   sätts inte än.
2. **Kartan är logisk och har versioner.** `club_map` är ett område ("Älvsjöskogen") med kartans rättigheter (samma fält som
   ADR-0182 beslut 4: klubbens egen eller extern, ägare, avtalet, giltighet, kontakt, bara träning, avgift per utskrift, inte
   publik visning). `club_map_version` är en fil: innehållet i `map_content` (ADR-0189, sha256), filnamn, format (OCAD eller
   Mapper), versionens datum, anteckning, vem som laddade upp och när. Samma innehåll är en version en gång per klubb. En ny
   version läggs till när kartan revideras; inget skrivs över. Versionerna går att slå ihop till en karta och att dela ut till
   en ny karta i arkivet ("Slå ihop med …", "Flytta till ny karta").
3. **Arkivets träning** (`club_archive_entry`): datum, plats, rubrik, ledare (fri text, valfri), taggar (fri text med förslag),
   anteckning och källans sökväg. Till träningen hör banfilerna (`club_archive_course_file`: .ppen eller IOF CourseData,
   orörda, högst 5 MB, med en sammanfattning av banorna) och kartorna i mappen (`club_archive_entry_map`). En banfil pekar på
   **den kartversion den gjordes med**, så att historiken är exakt även när kartan får nya versioner. Banfilerna lagras som
   egna rader (de är små och kan innehålla annat än kartor) och räknas med i klubbens användning.
4. **"Använd igen"** gör en ny träning (tävlingstypen Träning, valfritt i en träningsgrupp där kontot är ledare) med kartan och
   banorna genom de befintliga vägarna: tävlingen skapas som Ny tävling, gruppen kopplas som "Lägg i grupp", banfilen läses in
   som i banläggningen (.ppen) eller som banfil (CourseData), och kartan ritas i webbläsaren som vid uppladdning. Kartfilen
   laddas inte upp igen: tävlingen pekar på samma innehåll (ADR-0189), bara bilden skickas. **Förvalet är kartans senaste
   version.** När den skiljer sig från banans version jämförs versionerna ("Flytta banorna till senaste kartversionen"):
   - samma georeferens (koordinatsystem och transformation) och samma yta: kontrollerna behåller sina lägen;
   - båda georefererade i samma koordinatsystem men olika: lägena räknas om via koordinaterna (kartans mm → terrängen → nya
     kartans mm);
   - annars (ingen georeferens, olika koordinatsystem eller ytor som inte möts): en varning och en förhandsvisning av banorna
     på nya kartan med en förskjutning som går att justera innan man går vidare.
   Det sparade arkivet ändras inte; flytten gäller den nya träningen.
5. **Träningsgruppernas kartbibliotek kan peka på klubbens karta** (`training_group_map.club_map_id`, nullbar). En karta i
   gruppens bibliotek som kommer från klubben följer klubbens senaste version och dess rättigheter, så att en revision når alla
   som använder den. Bibliotekets egen bild och fil står kvar som förut tills ledaren tar den nya versionen.
6. **Importen körs på ägarens dator.** `pnpm archive-import <mapp>` (paketet `@o-tid/club-archive`) läser zip-filerna med
   strömmar (centralkatalogen, en post i taget, ZIP64) eller mappar, och tar bara .ocd, .omap, .xmap, .ppen och XML vars rot är
   `CourseData`. Allt annat (PDF, Word, Excel, bilder, GPX, KMZ, annan XML) läses aldrig och skickas aldrig; det räknas bara i
   rapporten. Mappnamnet ger datum, plats och ledare (`[…]`, eller inget med `--utan-ledare`); ord i mapp- och filnamn ger
   föreslagna taggar. Kartorna hashas och varje unikt innehåll laddas upp en gång (servern svarar vilka den redan har); en
   .ppen:s `<map>` (ofta en Windows-sökväg) löses mot kartfilerna i samma mapp, annars på filnamnet i hela arkivet (närmast i
   tid först), annars "karta saknas". Kartfiler grupperas till logiska kartor på namnet utan datum, versionsbeteckning och
   kopiemärkning; ägaren slår ihop och delar i arkivet efteråt. `--dry-run` skriver rapporten (antal, unika kartor och MB,
   träningar med karta och banor, bara banor med löst karta, karta saknas, mappar utan något att importera) utan att kontakta
   servern, och en rapportfil sparas lokalt. Importen är idempotent: träningen känns igen på källans sökväg, banfilen på
   träningen och innehållet, versionen på innehållet. Ett avbrott fortsätter där det slutade.
7. **Importnyckeln.** Importen loggar inte in med lösenord: en ägare eller administratör skapar en nyckel i arkivet ("Skapa
   importnyckel"), som visas en gång, gäller i 12 timmar och bara för importen till den klubben (`club_import_token`, hashad).
   Nyckeln går att återkalla. Anropen under `/api/club-import/` kräver nyckeln i `Authorization: Bearer`, inga kakor.
8. **Storlek.** En kartfil i arkivet får vara högst 100 MB (Mapper-filer blir stora); `map_content` får därför ta emot filer upp
   till 100 MB (migration 0061 vidgar villkoret). Tävlingens kartfil har kvar sin gräns (60 MB). Uppladdningen strömmas till
   databasen som i ADR-0189 och räknas mot kontots och serverns kvot; arkivet visar klubbens användning (unika kartfiler och
   banfiler i MB). Innehållet som arkivet pekar på tas inte bort när sista tävlingen som använder det tas bort
   (`otid_map_content_release` och underhållet räknar arkivets referenser).
9. **Synlighet.** Arkivet är aldrig publikt och aldrig indexerat (noindex som arrangörens övriga sidor). Ledarnas namn är
   personuppgifter: de importeras bara när ägaren vill och kan tas bort i arkivet.

## Följder

- Migration 0059 (klubben, medlemmarna, inbjudningarna, importnyckeln, journalen och `training_group.club_id`), 0060 (kartorna,
  versionerna, träningarna och banfilerna) och 0061 (arkivet i kartinnehållets referenser, 100 MB, gruppens koppling till
  klubbens karta). Bara tillägg och ett vidgat villkor.
- Kartor över 60 MB kan arkiveras och laddas ner men inte bli tävlingens kartfil förrän den gränsen höjs.
- Gruppbibliotekets uppdatering till klubbens nya version är ett val i gruppen (beslut 5); inget byts automatiskt i en tävling.
