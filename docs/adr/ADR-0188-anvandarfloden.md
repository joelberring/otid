# ADR-0188: Användarflöden efter granskningen 2026-11-02

Status: beslutad 2026-11-02 (grenen `ux-flode`). Ändrar ADR-0170 beslut 1 (tävlingstyperna), steg 9/26 (lottningens formulär),
steg 33 (första start) och ADR-0172 beslut 3 (Personer med behörighet).

## Bakgrund

En granskning av användarflödena 2026-11-02 fann att lottning av tio klasser krävde 41 inmatningar och gav en förhandsvisning
på cirka 25 000 px, att "Första start" fanns på två ställen, att datumet låstes när tävlingen var lottad, att Banor och Klasser
gick utanför skärmen på 390 px, att importerade klasser fick fri start i en vanlig tävling, att en gafflad klass kunde vara
"Klar för start" med löpare utan variant, att banläggningen var tät och dubblerad i mobilen, att "Tävling med gafflade banor"
var en egen tävlingstyp och att formuläret för behörigheter avslöjade om en e-postadress hade ett konto.

## Beslut

1. **Lottningens gemensamma inställningar.** Över klasstabellen finns "Gemensamt för klasserna": startsätt, intervall, klassernas
   första start (valfritt klockslag) och vakanser, med knapparna "Använd för alla" och "Använd för valda (n)". Värdena läggs på
   klassernas rader; raderna står kvar för avvikelser. Klassernas första start blir klassens senare start under Avancerat (tomt
   fält = oförändrad). Lotta-kolumnen har en kryssruta för alla klasser, och en ny klass med lottad start, anmälda och utan
   starttider är ikryssad från början. Förhandsvisningen visar en rad per klass (startsätt, löpare och vakanser, första och sista
   start) och löparna bakom ett klick ("Visa alla löpare" fäller ut alla). Lottningens begäran och regler är oförändrade.
2. **En första start.** Tävlingens första start (`race.first_start_time`) är den enda. För typer med lottning skrivs den i
   Start → Lottning och sparas med lottningen (samma transaktion); Inställningar visar den och länkar till Lottning. Typer utan
   lottning skriver den under Inställningar som förut (bara information).
3. **Datumet flyttas med starttiderna.** Ett nytt datum när tävlingen har starttider visar först vad som händer (antal löpare,
   lottade klasser och stafettsträckor, tiderna före och efter, om startlistan behöver publiceras igen) och sparas först när
   arrangören bekräftar (`moveStartTimes`). Alla fasta starttider, gällande lottningar och stafettsträckornas masstart och
   omstart får samma klockslag på det nya datumet i tävlingens tidszon (`moveToRaceDate`; en tid efter midnatt stannar dagen
   efter, ett klockslag som inte finns vid sommartidens början flyttas en timme fram). Lottningarna är oföränderliga, så varje
   gällande lottning får en ny lottningspost på det nya datumet som klasserna pekar på. Allt görs i inställningarnas
   transaktion med en journalpost för flytten och en per löpare (gammal och ny tid). Flytten stoppas om någon har läst ut, det
   finns radiostämplingar, någon är incheckad vid starten eller det finns resultat.
4. **Startsätt för importerade klasser.** Klasser som skapas från en banfil eller Eventor får lottad start (FIXED) i en vanlig
   Tävling och fri start i Träning, Liten tävling, Rogaining och Fest (`defaultStartRule`). Stafettklasser har egna regler.
   En gafflad klass med löpare utan variant är inte "Klar för start" i Klasser; statusen säger hur många som saknar variant.
5. **Tävlingstyperna.** "Tävling med gafflade banor" (`FORKED`) slås ihop med Tävling: gaffling följer av banorna, och Tävling
   visar varianterna när en bana har dem. `FORKED` behandlas som alias för `STANDARD` (samma vy, Inställningar visar Tävling och
   sparar `STANDARD`, en ny tävling som begärs som `FORKED` sparas som `STANDARD`). Värdet står kvar i databasens tillåtna
   värden och i kontraktet så att äldre klienter och befintliga tävlingar fungerar; att skriva om de gamla raderna och ta bort
   värdet är steg två i en senare driftsättning (AGENTS.md, migrationsregeln).
6. **Behörigheter avslöjar inga konton.** "Lägg till person" svarar likadant oavsett om adressen har ett konto: behörigheten
   sparas för adressen och gäller när personen loggar in med den och har bekräftat den (ADR-0186). Listan visar adressen som
   "väntar på inloggning" tills dess. När ett konto skapas och adressen bekräftas får kontot de väntande behörigheterna.

## Konsekvenser

- Migration 0043 (endast tillägg): väntande behörigheter per e-postadress.
- Lottningsspecarna öppnar förhandsvisningens klasser med "Visa alla löpare".
- `FORKED` kan tas bort ur databasens tillåtna värden när inga rader har det (steg två).
