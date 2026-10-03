# ADR-0068: Begränsad dubblettsökning vid direktanmälan

- Status: Accepterad
- Datum: 2026-09-12
- Implementationsuppgift: TASK028

## Kontext och ändrad läsbehörighet

ADR-0041 ger REGISTER_ENTRY endast klassunderlag inför registrering.
Operatören behöver också kunna upptäcka en möjlig tidigare anmälan utan att
öppna en fullständig deltagarlista med en annan roll. Detta beslut utökar
uttryckligen den läsbehörigheten med en begränsad kandidatsökning; den gamla
klasslistan och alla skriv-/idempotensregler i ADR-0041 är oförändrade.

## Beslut

Ett separat POST /api/admin/races/{raceId}/entry-registration-candidates
använder befintlig REGISTER_ENTRY-session, Origin och CSRF. Autentisering
sker före läsning av högst 4 KiB strikt JSON. Namn får inte skickas i URL,
loggas eller lagras i browserns beständiga lagring. Alla svar har no-store.

Frågan innehåller formatVersion=1, expectedSnapshotVersion, givenName,
familyName och cardNumber|null. Namnlängder och brickformat följer befintlig
registrering. Det är en läsning: ingen requestjournal, auditmutation,
snapshotökning eller automatisk registrering.

Application kontrollerar skyddad session/credential med CSRF och låser race
för snapshotläsning. Avvikande snapshot ger konflikt. Alla entries i just
detta lopp granskas, högst befintlig gräns 10 000; övergräns eller trasiga
klassrelationer får inte tyst ge ett partiellt sökresultat. Klassjoin binder
både klass-id och race-id. En separat brickfråga kontrollerar samtliga
historiska kopplingar för just frågans bricknummer, även inaktiva.

SAME_NAME betyder att både för- och efternamn matchar efter NFC, trim,
sammanpressning av whitespace till ett blanksteg och svensk gemenjämförelse.
Diakritik, bindestreck och namnordning bevaras; ingen fuzzy-/delnamnssökning.
Klubb eller klass får inte filtrera bort namnträffar. CARD_ALREADY_ASSIGNED
betyder befintligt historiskt brickägarskap enligt ADR-0040. Träfforsakerna
kan förekomma tillsammans men en entry visas bara en gång.

Svar: formatVersion, raceId, snapshotVersion, totalMatches och candidates.
En kandidat innehåller entryId, classId, className, givenName, familyName,
organisationName|null och reasons. Historisk klubbtext tillåter 240 tecken
enligt befintlig visningsmodell; nya registreringar behåller max200.
Inga externa person-id, kontaktuppgifter, resultat eller andra bricknummer.
Sökningen prioriterar brickträff och därefter entry-id i deterministisk
ordning. Högst20 kandidater returneras, med exakt totalt träffantal före
begränsningen. Detta är en tidsbunden varning, inte bevis på unik person.

## Granskning, samtidighet och retry

UI binder svaret till fryst frågeintent och samma snapshot som klassunderlaget.
Ändrat formulär eller nytt underlag förkastar granskningen. Namnträff kräver
lokal uttrycklig bekräftelse att skapa en annan deltagare; detta är inte ett
nytt servervillkor eller ett identitetsbeslut. Brickkonflikt går inte att
åsidosätta genom checkbox. Befintlig atomisk registrering kontrollerar
snapshot och brickägarskap igen vid commit och hindrar samtidiga förändringar
från att smyga igenom. API-klienter får fortfarande avsiktligt skapa skilda
personer med samma namn enligt ADR-0041.

Nätfel, ogiltigt eller stale svar är inte noll träffar. UI kräver lyckad
sökning före ett nytt registreringsförsök. Efter okänt commitsvar gäller
däremot exakt gammalt request-id och intent utan omsökning: den egna redan
committade entryn får inte blockera idempotent återförsök.

Allt privat underlag hålls endast i minnet. Authfel/sessionexpiry döljer även
granskningspanelen; sent svar kan inte öppna den. Explicit lokal logout och
pagehide rensar underlaget och avbryter anrop även om serverlogout misslyckas.
Efter förlorat retryintent ska operatören kontrollera befintliga deltagare
innan ny anmälan. Ingen ny offlinekö införs.

## Konsekvenser

Begränsad sökning minskar oavsiktliga dubbletter, men hittar inte felstavade
namn och kan visa flera verkliga personer med samma namn. Befintliga
REGISTER_ENTRY-credentials får den nya begränsade läsrätten när endpointen
aktiveras; ingen full rosteråtkomst eller rättningsbehörighet följer med.
Ingen migration, ny teknik, externa anrop eller AGPL-återanvändning behövs.
Resultatmotor, immutable rådata, stationspaket och historiska exporter ändras
inte. Att stänga endpoint/UI återtar funktionen utan dataåterställning.
