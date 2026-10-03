# ADR-0146: kontobunden, verifierad anmälningskoppling för eget resultat

- Status: Accepterad för TASK152
- Datum: 2026-09-23

## Kontext

ADR-0144 ger ett beständigt `user_account` med inloggning, sessionsspärr och
CSRF-skydd. Det är ännu endast betrott provisionerade konton, inte öppen
självregistrering, e-postverifiering eller kontoåterställning. ADR-0108:s
`publicResultId` är en öppen navigationsidentitet och ADR-0123:s
ruttuppladdningsgrant är en avgränsad privat filcapability; ingendera bevisar
kontroll över en anmälan. En deltagare behöver ändå kunna logga in på en annan
enhet och hitta sina publicerade resultat utan namn-/brickmatchning.

## Beslut

Första B1-resan återanvänder det befintliga kontot och dess session, men har
en **separat, explicit koppling till exakt `entry.id` i ett lopp**. En aktiv
`MANAGE_RACE`-operatör väljer anmälan i den befintliga raceadministrationen,
intygar att mottagaren/kontoinnehavaren kontrollerats utanför systemet och
utfärdar en engångskod för just denna anmälan. Detta är en operatörsattest och
privat överlämning, inte ett automatiskt identitetsbevis från Eventor, namn,
klubb, bricka eller publik länk. Kod kan lämnas direkt till tävlande eller
behörig vårdnadshavare. Operatören ansvarar för att kontrollera relationen;
systemet har ännu ingen ålders-/vårdnadshavarverifiering och påstår inte det.

Browsern skapar 16 kryptografiskt slumpmässiga byte (128 bitar) och skickar
endast kodens SHA-256 till servern vid utfärdandet. Servern lagrar hash, exakt
race/entry, utfärdande operatör, request-id och en utgångstid högst sju dagar
bort. Den rena koden visas endast under det pågående utfärdandet i browsern;
operatören kan uttryckligen kopiera den till urklipp för privat överlämning
och ska därefter rensa urklippet. Koden överförs aldrig i offentlig URL, logg,
fil, resultat-API eller browserlagring.
Om den tappas utfärdas en ny kod efter spärr/utgång; servern kan inte återskapa
den. Högst en ospärrad, ej utgången kod eller aktiv kontokoppling finns per
anmälan. En inloggad deltagare anger koden i en privat POST med exakt Origin,
CSRF, begränsad kropp och `no-store`. Koden löses upp server-side, förbrukas
en gång och binder det aktuella kontot till exakt anmälan. Ett konto får ha
flera verifierade anmälningar i olika lopp, till exempel för flera starter
eller som kontrollerad vårdnadshavare. Även redan använt, utgånget, spärrat
eller okänt kodvärde ger neutralt avslag utan att röja anmälan.

Utfärdande, inlösen och spärr är append-only journaler. Samma request-id,
actor och intent ger samma utfall vid tappat svar; återanvänt request-id med
ändrat intent är konflikt. Alla mutationer låser först den exakta entry-raden
innan de kontrollerar kod, aktiv koppling och spärr. Därmed serialiseras olika
samtidiga requests för samma anmälan utan en ny generell låstjänst. En
`MANAGE_RACE`-operatör kan spärra en exakt kod/koppling med orsak och utfärda
en ny kod efter felkoppling. Historisk koppling flyttas aldrig tyst till ett
annat konto eller en annan entry. Deltagaren ser en tydlig väg att kontakta
arrangören för felkoppling; självtjänst-överlåtelse ingår inte. Kontospärr,
lösenordsrotation och sessionsutgång stoppar skyddade läsningar enligt
ADR-0144. En klass-/namnrättning som behåller samma entry behåller kopplingen;
en ersatt anmälan kräver spärr och ny verifiering. Resultatrevisioner ändras
aldrig av kopplingen.

”Mitt resultat” resolverar aktiva kopplingar under kontosession och hämtar
bara samma validerade, **redan publicerade** resultatfält/sträcktider som den
anonyma publika detaljen. Vyn kan visa offentligt event-/loppsnamn och ett
neutralt vänteläge för en koppling utan publicerat resultat. Den får inte
returnera internt entry-/revision-/course-id, brick-/rådata, privata rutter,
opublicerade resultat eller extra ägarfält. En felaktig koppling kan alltså
inte användas för att läsa mer än den öppna resultatprojektionen. Offentlig
lista och detalj förblir kontofria. B1-kopplingen ger inte i sig rätt att se
eller publicera GPX, samtycka till ruttpublicering, sända GPS, administrera
tävlingen eller få annan privat data; dessa gränser kräver egna beslut.

Ingen automatisk bakfyllnad görs för existerande anmälningar eller konton.
Ingen ny resultatranking, statusregel eller publiceringssemantik införs.

## Migration, säker drift och återställning

TASK152 lägger additivt till en immutable utfärdandetabell, en högst-en-gång
inlösentabell och en immutable spärrtabell, med FK till exakt race/entry och
befintliga konto-/operatörsidentiteter. Hash är unik; bara hash och metadata
finns i PostgreSQL. Exakt entry-radlås och kontosessionslås används vid
mutation/läsning. Incidentåtgärd är att stänga de nya issue/redeem/read-
rutterna och spärra berörda grants, inte radera journaler eller historiska
resultat. Återställ hela databasen ur verifierad backup; kodhemligheter kan
inte återskapas efter restore och får utfärdas på nytt vid behov.

All verifiering använder en explicit isolerad migrerad PostgreSQL/PostGIS med
syntetiska personer, aldrig demo-/verklig tävling eller en verklig Eventor-
nyckel. Ingen verklig kod lämnas i testlogg. Riktade test täcker fel konto,
utgång, replay/ändrat intent, två samtidiga inlösare, spärr, flera lopp,
opublicerat resultat, korrigerad publicerad revision, revokerad kontosession
och anonym publik läsning. Fysisk mobil och fältacceptans är separat.

## Alternativ och framtida luckor

Direkt matchning på namn, klubb, bricknummer eller `publicResultId` avvisas:
det är varken stabilt eller ett ägarbevis. Att återanvända ruttuppladdnings-
granten avvisas eftersom den har annan mottagare och mindre rätt. En direkt
administratörskoppling utan deltagarens kodinlösen avvisas i första B1, då en
felvald kontorad annars aktiveras utan mottagarens kontroll av kontot.

Första kontot måste ännu provisioneras betrott och överlämnas säkert; det är
ett synligt användbarhetsgap före bred publik lansering. Självregistrering,
återställning av konto, verifierad kontaktkanal, formell vårdnadshavarrelation
och retention/erasure-processer kräver separata beslut. B1 ger inte full
fältberedskap eller privat rutt-/GPS-behörighet.
