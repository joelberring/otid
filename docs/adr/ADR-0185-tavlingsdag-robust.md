# ADR-0185: Tävlingsdagen robust (översynen 2026-11-02)

Status: beslutad 2026-11-02 (grenen tavlingsdag-robust). Ersätter ADR-0168 beslut 6. Ändrar steg 31 och 45 (avläsningar som
hålls åt sidan) och steg 22/29 (brickkopplingar).

**Bakgrund.** En översyn av tävlingsflödet inför Stockholm by Night (9 december, gafflad nattävling, cirka 300 löpare) hittade
risker som alla är verifierade i koden: 500-fel som inte loggades, avläsningar som hölls åt sidan vid varje 5xx, direkt
import av banor efter avläsning som gav blandade banversioner, brickbyten som inte gick att rätta, okända avläsningar som inte
kopplades vid Byt bricka och Ny deltagare, ett tomt 409 vid om-import av anmälningar och en migrationsregel som inte längre
stämmer. Appen används publikt.

**Beslut.**
1. **Migrationer (ersätter ADR-0168 beslut 6).** Inga borttagande eller förstörande migrationer utan en övergång i två steg
   (lägg till och låt koden klara båda, ta bort i en senare driftsättning). Index på stora tabeller byggs med
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS`; migratorn kör sådana satser utanför filens transaktion och bygger om ett
   ogiltigt index från ett avbrutet bygge. Ingen driftsättning eller migrering på en tävlingsdag utom för att rätta ett fel
   som stoppar tävlingen. Migration 0038 lägger `result_revision_readout_idx`.
2. **Serverfel.** Varje 500 i API:t loggas som en rad JSON (`server-error-log.ts`): område, åtgärd, felets namn, felkod
   (SQLSTATE eller Node), constraint, tabell, ett tvättat meddelande och stacken. PostgreSQL:s `detail` loggas aldrig;
   citerade värden, e-postadresser och sifferföljder med fem siffror eller fler tas bort ur meddelandet. En databas som inte
   går att nå ger 503 med `retry-after` till avläsningen. Poolens transaktioner görs om vid 40001 och 40P01, högst tre
   försök (`createDatabase`); transaktionerna har inga sidoeffekter utanför databasen.
3. **Avläsningens kö.** 502, 503 och 504 skickas om automatiskt (två omförsök inom synken, 0,5 och 1,5 s, sedan väntar appen
   2, 4, 8, 16 och högst 30 s mellan synkarna) och hålls aldrig åt sidan. En avläsning hålls åt sidan bara när samma svar
   kommer två gånger för just den, och bara för 400, 404, 409 och 500. Ett 500 räknas bara när andra avläsningar gick igenom
   i samma omgång, så att ett fel på hela servern inte märker kön. Statusraden visar "Servern svarar inte" och att
   avläsningarna köas på datorn.
4. **Brickregler (`card-assignment.ts`).** En bricka är aktiv hos högst en deltagare. En inaktiv koppling är historik och
   hindrar aldrig. Är brickan aktiv hos någon annan säger svaret vem (409 `CARD_IN_USE`), och "Byt bricka med …" byter två
   löpares brickor i en transaktion; avläsningar som redan gjorts räknas om för den som nu har brickan, och den som har kvar
   ett resultat från den andras bricka får det ersatt när hen läses ut. En okänd avläsning av brickan kopplas och räknas
   i alla vägar som ger en löpare en bricka: Byt bricka, Ny deltagare, direktanmälan vid avläsningen, självregistrering,
   filimporten och kandidatsökningen (där tidigare ägare visas som `CARD_PREVIOUSLY_ASSIGNED` utan att hindra).
   Stafett, hyrbrickans återanvändning och okänd avläsnings koppling har kvar sina egna vägar men samma historikregel.
5. **Direkt import efter avläsning.** CourseData när någon har läst ut eller har ett resultat går samma väg som
   "Läs in ny banfil": löpare som sprungit behåller sin variant och resultaten räknas om i samma transaktion. Ändras någons
   resultat avvisas importen (409 `COURSE_FILE_SYNC_REQUIRED`) med vilka och en hänvisning till banfilsjämförelsen, som visar
   ändringen och bekräftar. EntryList visar skillnaderna mot de anmälda (vem, vad, nu och i filen) före sparandet: brickbyten
   bekräftas (`x-otid-confirm-changes: 1`, samma fil och begärans-id), och en ny klass för någon som läst ut, en bricka som en
   annan löpare har kvar och ett rättat namn avvisas med vad som måste rättas först. Ett eget källslag för anmälningsfiler i
   synken (med ögonblicksbild) byggdes inte; listan räcker för filimporten.
6. **IOF XML-tolkningen.** Felen säger elementet och raden i filen (`Rad 22: ClassStart[0].PersonStart[1]…`). En startlista
   utan `EntryId` matchas på `Person.Id` (anmälans `Person.Id` sparas som Eventors person-id). Filer i ISO-8859-1 läses när
   XML-deklarationen säger det; annan kodning avvisas med ett begripligt besked.

**Konsekvenser.** Fler 409-svar bär innehåll som klienten visar. Äldre tester som krävde att inaktiv historik hindrar är
ändrade. En löpare som får ett resultat från den andras bricka vid ett brickbyte syns med det resultatet tills hen läses ut.
