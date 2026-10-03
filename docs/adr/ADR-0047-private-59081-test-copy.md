# ADR-0047: Privat testkopia av 59081 utan Blå 3,0

- Status: Accepterad för denna lokala testkopia, inte produktionsimport
- Datum: 2026-09-05

## Kontext och tillstånd

Användaren tillåter verkliga namn i en testtävling och har uttryckligen bett
att Blå 3,0 utelämnas. Originalens IOF-subset passar inte den befintliga
importören: Course saknar Id och StartList saknar EntryId. En allmän MeOS-
eller IOF-importutvidgning är en annan uppgift.

## Beslut

Skapa en härledd, tydligt märkt privat testdataset från den tillhandahållna
StartList och CourseData. Originalen ändras inte. MeOS och ResultList används
inte som importkällor och inga råavläsningar eller resultat fabriceras.

- Roster är startlistans 221 poster minus de tio i exakt klassen Blå 3,0:
  211 deltagare i 37 klasser. Tomma klasser i andra filer importeras inte.
- Bannamn och klassnamn används enbart för granskad entydig koppling inom
  dessa frysta filer. Dubbla namn, saknad koppling eller dubbla person-/klass-
  referenser avvisar prepareringen. Ingen fuzzy matching eller namnuppdelning.
- Härledda IOF EntryId, ClassId och Course/Id är uttryckligen lokala
  testreferenser, namngivna med källfilhash och källreferens. De utger sig
  inte för att vara Eventors EntryId. Interna UUID skapas av befintlig service.
- Strukturerade Given/Family, klubb och tillgänglig bricka kommer från
  StartList. Kontaktuppgifter, födelsedata, avgifter och GPS importeras inte.
- Testkonfigurationen använder FIXED för de 12 klasser där alla har tider
  och PUNCH för övriga 25. Detta är en explicit testpolicy baserad på filens
  grupper och användarens förtydligande om blandad start, inte ett påstående
  om verifierad historisk regel för varje klass. Saknade tider fabriceras inte.
- Endast de fullständigt tidsatta klasserna ingår i härledd StartList-import;
  PUNCH-klasserna behåller befintlig nyklassregel. ADR-0025 ändras inte.
- Testdatum 2026-08-23 och tidszon Europe/Stockholm används; XML-tidernas
  explicita offset bevaras och normaliseras av befintlig importör.

Privata härledda filer/manifest sparas utanför repositoryt med begränsad
åtkomst. Ny isolerad loopback-PostgreSQL-databas används; inga befintliga
tävlingar ändras. Skapande och import går via befintliga capabilityskyddade
applikationstjänster med journal, hash och retry. Ingen ny produktionsrutt,
SQL-genväg för domändata, dependency eller schemaändring införs.

## Verifiering och avgränsning

Före write: validera alla härledda dokument med befintlig parser och lokal
IOF-XSD, kontrollera exakt coverage, unika referenser, oförändrade namn,
bankontrollföljder och starttider samt explicita exklusionsantal.
Efter write: kontrollera 211 entries, 37 klasser, 12 FIXED/25 PUNCH, 70 fasta
tider, inga Blå-poster, noll resultat/råavläsningar/publiceringar. Exakt retry
ska ge samma kvittenser och oförändrade antal/versioner.

Testet är inte full produktionsimport, Testeventor-liveacceptans eller
hårdvaruverifiering. Ingen karta, stafett, GPS, USB eller offentlig startlista
aktiveras. Eventor-API-nyckeln används inte.

## Återställning och integritet

Ingen migration behövs utöver befintliga migrationer i den nya testdatabasen.
Stoppa den lokala tjänsten för att göra testkopian otillgänglig. Originalen
finns kvar; testdatabasen och privata filer behålls tills användaren vill
radera dem. Ingen automatisk destruktiv rollback eller publicering görs.
