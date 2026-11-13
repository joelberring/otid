# ADR-0224: Arkiv för vilande kartinnehåll och uppdelad lagring utanför servern

Status: beslutad av ägaren 2026-11-13, inte byggd. Underlag: projektdokumentet `claude/plan-lagring-och-backup-2026-11-13.md`.

## Bakgrund

Allt kartinnehåll ligger i PostgreSQL på serverns disk (ADR-0189). Det är enkelt och säkert men dyrt att växa på, och
laserkörningarnas resultatfiler fyllde ägarens konto 2026-11-13. Ägaren vill hushålla (egna gränser per konto, ADR-0189
tillägg 2026-11-13), ha backupen utanför servern och på sikt billigare lagring för det som inte används.

## Beslut

1. **Två platser utanför servern, till var sin sak.** Backupen går till en Storage Box med restic (finns redan, docs/drift.md).
   Arkivet för vilande kartinnehåll är S3-kompatibel objektlagring, som appen kan hämta enskilda filer ur. De hålls isär så
   att en störning i objektlagringen inte drabbar backupen.
2. **Bara innehåll flyttas, aldrig projektets uppgifter.** Projekt, medlemmar, ändringshistorik och miniatyrer ligger kvar i
   databasen. Innehållet behåller sin sha256 som nyckel i arkivet.
3. **Ett innehåll flyttas först när allt som pekar på det är vilande.** En enda aktiv användning håller kvar det.
4. **Aldrig flyttat:** det som hör till en tävling eller träning som är planerad, pågår eller avslutades de senaste 30
   dagarna; publicerade tävlingars kartbilder; banläggningar ändrade de senaste 90 dagarna och kartan under dem; kartprojekt
   med öppna förslag, pågående laserkörning eller aktiv AI-koppling; innehåll under 1 MB; projekt som ägaren markerat "Håll
   aktivt". Ingen flytt på en tävlingsdag (ADR-0178); flytten körs nattetid med låg prioritet.
5. **Flyttas, i den här ordningen** (startvärden, som inställningar):
   - laserkörningars resultatfiler utom den senaste klara körningen: 30 dagar efter körningen;
   - ortofoton och andra hämtade underlagsbilder: projektet orört i 60 dagar;
   - uppladdade grundkartor och underlag: projektet orört i 90 dagar;
   - hela kartprojektets innehåll: projektet orört i 180 dagar, eller stängt i 30 dagar;
   - klubbarkivets kart- och banfiler: inte använda eller öppnade på 12 månader;
   - avslutade tävlingars kartfil (inte kartbilden): 12 månader efter tävlingen.
   "Orört" = ingen har öppnat, ändrat eller exporterat projektet och ingen koppling har läst det. Det kräver att senaste
   öppning sparas per projekt.
6. **Tillbaka:** hela projektets innehåll hämtas på en gång när projektet öppnas, med besked om förloppet och nya försök vid
   fel. En karta ur arkivet hämtas redan när en träning eller tävling planeras med den. Det som hämtats ligger kvar i minst
   30 dagar. Användaren kan själv välja "Arkivera nu".
7. **Säkerhet vid flytten:** innehållet laddas upp och sha256 jämförs; först därefter markeras det som arkiverat, och raden
   ligger kvar i databasen i ytterligare 7 dagar. Arkivet har versionering eller objektlås. Ett borttaget projekts innehåll
   raderas i arkivet först när backupens sparade kopior har gått ut.
8. **Resultatfiler från misslyckade och avbrutna körningar tas bort, inte arkiveras.**
9. **Första tiden loggas flytten bara** ("skulle ha flyttats") innan den slås på.

## Öppet (ägaren)

- Hur arkiverat innehåll räknas mot kontots gräns (förslag: en fjärdedel).
- Om "Håll aktivt" ska finnas och hur många projekt per konto.
- Om tröskelvärdena för klubbarkivet (12 månader) och kartprojekt (180 dagar) stämmer med hur klubbarna arbetar.

## Följder

- Objektlagringen blir en ny beroendepunkt; återhämtningen måste tåla att ett anrop misslyckas.
- Återställning efter haveri får ett steg till: databasen och arkivet måste stämma överens.
- Tävlingsdagens flöden (avläsning, resultat, publika sidor) berörs inte: inget av deras innehåll flyttas.
