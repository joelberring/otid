# ADR-0209: Klubbtillhörighet – klubblistan, Mina klubbar, klubbytan i Eventor, Från klubben och tävlingen i klubbarkivet

Status: beslutad 2026-11-03 (grenen `klubbtillhorighet`, migration 0076, ägarens önskemål och tillägg samma dag); ändrad
2026-11-04 (grenen `kartbank-forval`, migration 0079): kartbankens förval är alla medlemmar (beslut 5). Bygger på
ADR-0194 (klubbarkivet), ADR-0196 (kartorna), ADR-0188 beslut 6 (inbjudan per adress, inga konton röjs), ADR-0186 (bekräftad
e-post), ADR-0176 (banhemlighet), ADR-0172 (konton) och ADR-0170 beslut 4 (Eventor-nyckeln).

## Bakgrund

Ägaren: man ska vid registreringen kunna välja klubb (ur listan över alla klubbar eller fritt), sedan enkelt bjuda in folk ur sin
klubb till tävlingar och klubbytor, och tävlingar ska kunna lyftas in i klubbens arkiv när de är klara – före tävlingen ska inte
alla i klubben se den. Tillägg samma dag: det ska vara mycket lättare att komma igång. Kopplingen mellan klubbyta och klubb bevisas
med klubbens egen Eventor-nyckel, medlemmar bekräftas automatiskt ur Eventors medlemslista, och klubben väljer vem som ser vad.

## Beslut

1. **Klubblistan** (`organisation`): Eventors organisationer (id, namn, kortnamn, typ, organisationen ovanför, land, uppdaterad).
   `node superadmin.mjs clubs refresh` hämtar `GET /api/organisations` med `OTID_EVENTOR_API_KEY` (eller en klubbnyckel som ett
   klubbarkiv sparat) högst en gång per dygn (Eventors villkor; `--force` vid behov), `clubs import <fil.xml|->` läser en fil.
   En organisation som försvinner märks borttagen men står kvar. Sökningen är utan accenter, stora bokstäver och skiljetecken och
   träffar namn, kortnamn och initialer (förkortningar hela: "OK Älvsjö-Örby" → "okao"), `@o-tid/domain` `clubSearchText`.
   Eventors äldre format för förälder och land är inte provat mot riktiga Eventor.
2. **Mina klubbar** (`account_club_membership`): klubbar ur listan eller "Annan klubb" (fritext), med status väntar, bekräftad
   eller avböjd, vem som beslutade och när (`decided_by/at`), och hur (`confirmed_via`: för hand eller Eventor). Steget "Vilken
   klubb tillhör du?" visas i Mina tävlingar efter registreringen (och för befintliga konton) tills det är besvarat eller överhoppat
   (`account_club_prompt`); registreringens anrop ändras inte, så att det fortsatt svarar likadant oavsett konto (ADR-0186).
   Ändras under Mitt konto. **En egen anmälan ger ingenting.** Raderna har nyckel till kontot och tas bort med det.
3. **Klubbytan kopplas till Eventor med klubbens nyckel** ("Koppla till Eventor", ägare och administratörer): servern frågar
   `GET /api/organisation/apiKey` och får klubben som nyckeln tillhör; det är den bevisade kopplingen (`club_setting`). Nyckeln
   sparas krypterad med `OTID_EVENTOR_MASTER_KEY` (som tävlingarnas, bunden till klubbytan), loggas aldrig och skickas aldrig till
   webbläsaren; bara "nyckel …abcd" visas. "Byt nyckel" och "Ta bort kopplingen". En klubb kopplas till högst en klubbyta; annars
   "kontakta ägaren av den klubbytan"; superadmin kan frigöra klubben (`clubs unlink <eventor-id>`). En klubbyta utan nyckel visar "Inte kopplad till Eventor". Den som skapar en klubbyta är
   ägare som förut; ingen blir administratör av att vara först (ägarens förslag om de fem första byggs inte).
4. **Medlemmarna ur Eventor.** Med nyckeln hämtas `GET /api/persons/organisations/{id}?includeContactDetails=true` en gång per dygn
   (underhållet i webben) och med "Hämta medlemmar nu" (högst en gång i timmen). Bara Eventors person-id och HMAC-SHA256 av den
   normaliserade e-postadressen (nyckel härledd ur masternyckeln med HKDF) sparas (`club_eventor_member`); namn, födelsedatum,
   adresser och telefon lämnas redan i tolkningen. Ett konto med bekräftad adress vars hash finns blir bekräftat ("bekräftad via
   Eventor", journalfört) när listan hämtas och när kontot öppnar Mina tävlingar, Mitt konto eller klubbytan (det sker direkt efter
   inloggning och bekräftad adress; inloggningens kod ändras inte). Slutar personen i Eventor tar nästa hämtning bort det som
   Eventor gav; bekräftelser för hand står kvar. Administratören ser bara siffror ("312 medlemmar i Eventor, 41 har O-Tid och är
   bekräftade"). Andra adresser bekräftas för hand: "Väntar på bekräftelse" med Bekräfta/Avböj (anmälda till den kopplade klubben
   och fritexter som liknar klubbens namn); "Ta bort" vid en bekräftad. Allt journalförs.
5. **Roller och Vem ser vad.** Klubbytans roller är Medlem (`READER`: bekräftad eller inbjuden), Ledare (`LEADER`, ny, sätts av
   administratörer i listan eller vid inbjudan), Administratör och Ägare. Klubben väljer under "Vem ser vad": träningsarkivet
   (träningar, småbilder, banfiler) och kartbanken (kartfiler, Använd igen, nedladdning), var för sig för alla medlemmar (förval
   för båda) eller ledare och admin (`requireClubArea`; "Välj karta från klubbarkivet" och Använd igen frågar `mayUseClubMap` i
   ADR-0210, som har samma regel). Ändrat 2026-11-04, ägaren: kartorna döljs bara som undantag. Först var kartbankens förval
   ledare och admin; nu står "Alla medlemmar" först och förvald, med tipset "Välj Ledare och admin om kartorna inte ska delas med
   alla medlemmar". **Ägare och administratörer ser och
   använder alltid allt**: arkivet, kartbanken, alla kartversioner och medlemslistan, oavsett inställningarna och kartans egna
   rättigheter. För medlemmar och ledare gäller kartans rättigheter (ADR-0196) ovanpå; den strängaste vinner. Klubbytor från före
   migration 0076 fick en rad med kartbanken för alla medlemmar, så att de uttryckligen inbjudna läsarna behöll det de hade.
   Inställningen "Bekräftade medlemmar kan läsa arkivet" (första utkastet) ersätts av de två.
6. **Integritet.** Bekräftade medlemmar ser namnen (aldrig adresser) på andra bekräftade medlemmar i samma klubb, och bara i
   väljaren "Från klubben". Den som inte är med ser ingen lista; klubbytans existens röjs inte (404). Det finns ingen
   kontoexport i O-Tid; borttagningen av ett konto tar raderna med sig (nycklarna). Integritetssidan beskriver vad som sparas.
7. **Från klubben**: överallt där man bjuder in (tävlingens personer och behörigheter inklusive banläggningens roller, klubbytans
   medlemmar, träningsgrupper) finns en sökbar lista med bekräftade medlemmar i den inloggades klubbar (och klubbytans egna).
   Valda personer bjuds in för kontots adress genom de befintliga vägarna, så att mejlet och godkännandet fungerar som förut;
   den som bjuder in ser aldrig adressen, inte heller i listorna efteråt (`invitation_club_source`). Adressfältet står kvar.
8. **Tävlingen och klubbarkivet.** En tävling har en arrangörsklubb ur listan (`race_organiser`, förval: skaparens bekräftade
   klubb), synlig bara för tävlingens behöriga; före tävlingen visas ingenting för klubben. "Lägg i klubbarkivet" (bara den som är
   administratör både i tävlingen och i klubbytan) gör en träning i klubbytan som är kopplad till arrangörsklubben: kartfilen som
   kartversion (samma innehåll en gång per klubb, ADR-0194), banläggningens dokument som .ppen och banorna som IOF XML (annars den
   senast inlästa banfilen) och en länk tillbaka. Inga startlistor, resultat eller deltagare. Före dagen efter tävlingen, eller medan
   banorna är hemliga (ADR-0176), krävs en bekräftelse av banhemligheten. "Ta ur klubbarkivet" tar bort träningen (och kartan och
   versionen som inlyftet skapade om inget annat använder dem); tävlingen ändras inte. En påminnelse i Resultat efter tävlingen:
   "Tävlingen är klar – lägga banorna i klubbarkivet?". Inget läggs in automatiskt.

## Följder

- Migration 0076: nya tabeller, rader i `club_setting` för befintliga klubbytor och vidgade rollvillkor (`LEADER`). Inga
  borttagningar.
- Migration 0079 (beslut 5 ändrat): kolumnens förval `club_setting.map_bank_access` blir `MEMBERS` (också `CLUB_AREA_DEFAULTS`
  i domänen, som gäller för en klubbyta utan rad). Raden sparar inte om värdet är förvalet eller ett val; ett val syns bara i
  klubbens journal. Därför blir varje `LEADERS` alla medlemmar, utom där journalen har `CLUB_ACCESS_CHANGED` med kartbanken från
  `MEMBERS` till `LEADERS` (en administratör valde det). Det är en omskrivning av data i ett steg, vilket `AGENTS.md` annars inte
  tillåter: den godtas här eftersom ingen driftsatt server har fått 0076 än, så bara utvecklings- och provdatabaser har sådana
  rader, och koden läser värdet som det står (gammalt och nytt fungerar lika). Ingen kolumn för "valt av administratör" behövs.
- Drift: `OTID_EVENTOR_API_KEY` (valfri, bara för `clubs refresh`) i `web`. Masternyckeln krävs för kopplingen och medlemslistan.
- Matchningen hashar varje bekräftad adress vid en hämtning (en gång per klubb och dygn); det räcker för tusentals konton.
- Grenen `inbjudan-mejl` skickar mejl i webbens anrop; när den är med skickas avsändaren också i `clubPickerRoute`.
