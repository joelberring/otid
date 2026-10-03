# ADR-0050: Identitet och kvittens för mobil avprickning

- Status: Accepterad; genomförandet av TASK 006W är inte färdigt
- Datum: 2026-09-05
- Konkretiserar ADR-0049 utan ändrade teknikval eller stationskontrakt.

## Beslut före lagringsimplementation

Avprickning får ett eget enhets- och operationsjournal i PostgreSQL, inte
fabricerade raw_device_message eller utökad READOUT. En registrerad enhet
binds permanent till race, accesscredential och en av funktionerna
START_CHECKIN eller FINISH_FOREST_WATCH. En ny session med samma giltiga
credential får fortsätta samma kö. En annan credential får inte överta
enhetsidentiteten automatiskt. Spärr/utgången credential stoppar synk men
förstör inte lokal kö; explicit administrativ återhämtning behövs då.

Förberedelsen registrerar deviceId från mobilen med ett fryst label under
separat START_CHECKIN- eller FINISH_FOREST_WATCH-session (egen tokenprefix,
högst åtta timmars accesscredential och en timmes session). DeviceId är också
registreringens idempotensidentitet. Exakt race/actor/capability/label ger
samma metadata efter retry eller ny session; ändrad bindning ger konflikt.
Registrering och enhetsaudit committar tillsammans efter auth, CSRF,
race-lås och globalt namespacat device-advisory-lås. Registreringen skriver
ingen roster, avprickning, DNS, resultatrevision eller stationsidentitet.

Varje fryst operation innehåller formatVersion 1, requestId, deviceId,
actorCredentialId, raceId, entryId, localSequence, packageVersion,
expectedEntryVersion, expectedRevision, dependsOnRequestId, observedAt och action. MARK_START
innehåller state (UNMARKED, STARTED eller REPORTED_NOT_STARTED).
FINISH_CORRECTION innehåller state och manualReturnRegistered. Startpersonal
kan aldrig sätta eller radera en manuell återkomst. Korrigering av en sådan
uppgift vid mål skapar en ny operativ revision, aldrig OK eller en måltid.

Alla räknare ryms i PostgreSQL integer. Sekvenser börjar på 1, operativ
revision på 0. observedAt är UTC med exakt millisekundprecision och är endast
operatörens uppgivna observationstid. Innehållshash är lowercase SHA-256 över
UTF-8 canonical JSON av hela den validerade operationen, utan hashfält.
Kuvertet är { operation, contentHash }; hashen räknas om av servern.
Ingen token, namnuppgift eller godtycklig metadata hör till operationen.

Första transporten skickar en operation per request. Enhetens sekvenser
behandlas i ordning. Samma request eller samma device/sequence kräver exakt
samma frysta operation och hash; annars konflikt utan overwrite. Auth och
hashvalidering sker före journalskrivning. En trasig eller obehörig request
blir aldrig en durabel mottagningskvittens.

dependsOnRequestId är null för en ändring grundad på hämtat servertillstånd.
Flera lokala ändringar för samma deltagare binds däremot i en explicit kedja:
en efterföljare pekar på föregående lokala request och dess förväntade
resulterande revision. Servern kräver samma device/actor/race/entry samt att
föregångaren committat APPLIED eller UNCHANGED med exakt den revisionen.
Annars lagras DEPENDENCY_CONFLICT utan verksamhetseffekt. Självreferens
avvisas. Därmed kan en avvisad första ändring inte låta en senare lokal
ändring råka matcha samma revisionsnummer från en annan mobil. UI får inte
radera beroendekopplingen eller automatiskt basera om konflikten.

## Lagring och transaktion

start_checkin_device är immutable registreringsmetadata. Den lagrar ingen
hemlighet och delar inte station_device-identiteten. start_checkin_operation
bevarar varje giltigt mottaget intent, mottagningstid och ett exakt utfall.
start_checkin_revision lagrar bara genomförda operativa ändringar och bär
både startState och manualReturnRegistered. Aktuellt tillstånd är högsta
revision för race/entry; frånvaro betyder UNMARKED/false/revision 0.

Låsordning för kommande service är session → credential → race SHARE →
request advisory → device → entry UPDATE. Ingest tar fortsatt race → entry;
den behöver aldrig avprickningsenhetens lås. Importens race UPDATE skyddar
roster/klassgrund. Skrivaren validerar aktuell entryversion och paketversion
innan ny effekt, men exakt retry läses före aktuell verksamhetsgrund.

Utfall är APPLIED, UNCHANGED eller CONFLICT. Alla tre kan vara durabelt
mottagna, men endast APPLIED betyder en ny operativ revision. CONFLICT
bevarar försöket utan att ändra avprickning eller resultat. Kvittensen har
därför separata storage=STORED och effect-fält; den binder request, device,
sekvens, hash, race/entry, servermottagningstid och resulterande revision.
En konfliktpost ska behållas lokalt för granskning, inte presenteras som
genomförd eller automatiskt skickas om med ny versionsgrund. En separat,
explicit korrigering får referera det konfliktförsöket i UI/historiken.

Journal, eventuell operativ revision, DNS-källa/återtagande och audit måste
committa tillsammans. JSON-kvittensen är fryst transporthistorik, inte en
alternativ resultatkälla. Tjänsten måste kontrollera dess schema och
ömsesidiga bindningar; databasen skyddar identitet, scope, unikhet och
immutabilitet men implementerar inte domänregler i triggers.

## DNS och leveransgrind

ADR-0049:s separata DNS-provenans gäller fortsatt. Befintligt manuellt
did_not_start_decision och dess revision-1-regel försvagas inte. Den nya
resultatkällan, dess återtagande och samtliga läsare ska integreras innan
MARK_START/FINISH_CORRECTION exponeras som fungerande skriv-API. En tjänst
får inte kvittera APPLIED för ej-startmarkering utan den atomiska DNS-effekt
eller uttryckliga konflikt som ADR-0049 kräver. Journalmigrationen ensam
aktiverar ingen write-route och producerar inga DNS-resultat.

Den lokala rosterlagringens upplåsning/logout och service worker återstår
att konkretisera och verifiera. Detta ADR beskriver inte en färdig offlinekö.

## Migration och återställning

Migration 0032 är expand-only: nya journal/revisionstabeller, nya racebundna
capabilityvärden och unika scope-index på befintliga identiteter. Ingen
befintlig rad ändras eller backfylls med gissad start-/återkomstinformation.
Rollback är att stänga nya routes och behålla journalerna. Radera inte
operationer för att återanvända sekvenser. Full återställning kräver verifierad
databasbackup; gammal appversion får inte köras med aktiva nya write-routes.

## Acceptans för detta lagringssteg

Riktig PostgreSQL ska avvisa scope-/credentialkonflikt, dubbel request eller
device/sequence, dubbel entryrevision och update/delete av historik. En
forcerad transaktionsrollback ska lämna både journal och revision oskrivna.
Kontrakttester ska avvisa okända nycklar, felaktiga räknare/tider/hashar,
otillåtna actionfält och falsk APPLIED-kvittens utan revisionsreferens.
Full TASK 006W kräver fortfarande service-, DNS-, auth- och offlinetester samt
privat, utskrivbar kvar-i-skogen-lista enligt uppgiftsfilen.

## Konkret skrivgrind

Synkskrivaren serialiserar enhetens sekvenser under device UPDATE efter
requestlåset; nästa nya sekvens måste vara föregående + 1. Luckor eller
återanvänd identitet med annat innehåll ger transportkonflikt, ingen kvittens.
Giltiga sekvenser med stale roster/paket/revision eller blockerat beroende
lagras däremot som CONFLICT utan operativ/resultatmässig effekt.

Negativ startpersonalrapport efter manuell återkomst ger
RETURN_ALREADY_REGISTERED. Avläsning kopplad via deltagarens aktuella eller
historiska brickkoppling, eller någon teknisk resultatrevision, blockerar
negativ rapport även om readout ännu inte omräknats till resultat. Ingen
annan resultatkälla får ersättas med avpricknings-DNS. Målpersonal kan rätta
manuell återkomst, men aldrig upphäva verkliga avläsningsfakta. Operativt
state och manualReturnRegistered planeras i domain; SQL hämtar endast fakta.
Samma race SHARE → entry UPDATE som ingest/brickbyte skyddar granskat underlag.
Återkommande DNS kräver enbart återtagen avpricknings-DNS i resultathistoriken.
