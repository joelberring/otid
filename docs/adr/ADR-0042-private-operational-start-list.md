# ADR-0042: Privat operativ startlista

- Status: Accepterad
- Datum: 2026-09-04

## Beslut

TASK 006R ger startpersonal en read-only-lista för ett individuellt lopp.
Den återanvänder befintlig entry, klass, fast starttid och aktiv brickkoppling.
Ingen startlottning, närvaromarkering, faktisk start, resultatutvärdering eller
frånvarostatus härleds. Detta är inte en offentlig publicerad startlista.

Separat racecapability `VIEW_START_LIST` med prefix `otid_org_start_list_v1`,
egna cookies, åtta timmars access och en timmes session återanvänder befintlig
raceadministrativ säkerhet. Startpersonal får inte automatiskt rätt att ändra
starttid eller deltagare. Login/logout använder samma Origin/CSRF-gräns;
GET gör inga databaswrites och sätter private/no-store.

Läsaren låser session → credential → race SHARE och väljer explicit endast
race-id, snapshotversion, eventets tidszon, lästid samt klasser med namn och
startregel och deras entries med id, displayName, organisationName,
fixedStartTime, cardNumber och multipleActiveAssignments. Max 1 000 klasser,
10 000 entries totalt och 20 000 aktiva kopplingar; overflow avvisas utan
trunkerad lista. Saknad koppling ger null; flera aktiva ger null och en tydlig
varning, aldrig ett godtyckligt brickval. Historiska inaktiva brickor visas inte.
Inga resultat, rawdata, externa identiteter eller credentialfält ingår.

FIXED visar befintlig starttid, eller uttryckligen att tiden saknas. PUNCH
visar startstämpling och fixedStartTime=null även om en gammal tid finns lagrad.
Klasser sorteras namn/id; FIXED-deltagare efter tid (saknad sist), därefter namn/id;
PUNCH efter namn/id. Detta är presentationsordning, inte tävlingsranking.

Vyn visar datum och klockslag i tävlingens explicita tidszon samt UTC-offset,
inte i browserns lokala zon. Ingen tid avrundas bort om millisekunder finns.
Ogiltig tidszon avvisas av kontraktet. Val av klass är lokal filtrering av
samma sammanhängande snapshot; inga personuppgifter lagras i URL/Web Storage.

Listan hämtas vid login och explicit uppdatering. Lästid och snapshot visas;
vid nätfel markeras föregående lista tydligt som gammal. Vid authfel/logout
tas personuppgifter bort från vyn. Ingen automatisk utloggning av stationen,
ändring av paket eller lokal readoutkö sker.

## Migration och återställning

0027 lägger endast till enumcapability och åttatimmarsgräns i befintliga
credentialtabellen. Ingen ny domäntabell eller auditaktör behövs för läsning.
Vid incident stängs startlistans routes/CLI och credentials spärras. Rätta
framåt eller återställ verifierad backup; radera inte befintliga enumvärden,
credentials eller audit. Inga dependencies eller teknikval ändras.
