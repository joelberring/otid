# ADR-0046: Testeventorimport med krypterad servernyckel och explicit loppval

- Status: Accepterad
- Datum: 2026-09-04

## Omfattning

TASK 006V importerar en vald tävling och ett uttryckligt valt EventRace till
nya interna event/race. Det är ingen komplett Eventor-synk. Ingen deltagar-,
kontakt-, klubb-, dokument-, betalnings- eller kartdata importeras. Noll lopp
avvisas för skapande; flera lopp kräver val, inte implicit första loppet.
Klassregler, tidszon och faktiskt startad-status härleds aldrig från Eventor.
Operatören väljer tidszon uttryckligt. Date används endast som kalenderdatum;
Clock skapar ingen faktisk eller planerad deltagarstart.

Eventors XML har ingen targetNamespace. Adaptern läser Event och dess direkta
EventRace-barn och bevarar externa IDs som opak text, inte heltal. Endast
standardformaten YYYY-MM-DD och HH:MM:SS stöds; alternativa format avvisas
utan gissning. O-Tids egna storleksgränser är säkerhetspolicy, inte XSD-regler.

Endast svensk Testeventor tillåts i detta snitt, med fast HTTPS-origin
https://eventor-sweden-test.orientering.se. Ingen klientvald URL, redirect,
proxy eller produktionsfallback. Privat GET /api/event/{id} använder ApiKey
header; aldrig nyckel i URL. Timeout ska omfatta hela responsebody och en
storleksgräns ska stoppa obegränsad XML. Ingen extern write sker.

Konkreta gränser: högst 2 MiB UTF-8-XML och 1 000 lopp, tio sekunders timeout
för hela HTTP-läsningen, XML-content-type och strikt UTF-8. Namn måste passa
intern skapandemodell (2–160 tecken); externa IDs är 1–256 tecken utan
kontrolltecken/omgivande whitespace. Exakta dot-path-ID:n avvisas. Datum är
giltiga kalenderdatum år 0001–9999. Dessa gränser är en avgränsad adapterpolicy.
Källhash är SHA-256 över hela mottagna XML-byteföljden, även ignorerad metadata:
ett förändrat källdokument kräver ny granskning. Råa bytes sparas inte.

Databasplan: immutable eventor_connection (ägare, etikett, miljö, keyId,
krypterad envelope, utfärdandetid och lokal operatörsetikett), separat immutable
connection_revocation och eventor_import_request som även bär extern provenans.
En unik miljö+EventId-referens i importjournalen hindrar dubbletter globalt,
inte bara per anslutning. Journalen binder internt event/race med sammansatt
FK och sparar vald minimal metadata samt mappningsversion 1. Ingen fristående
generell integrationsplattform behövs. Utfärdande/spärr är serveroperativa,
spårbara CLI-beslut; importen använder befintlig racebunden audit med aktören
EVENT_CREATION_ACCESS_CREDENTIAL. Låsordning är session → ägarcredential →
connection → request-advisory → extern-event-advisory. Ingen nätläsning sker
under databaslås. Auth och connection kontrolleras igen vid commit; återkallad
anslutning avvisas även för retry, medan giltig exakt retry inte dekrypterar
nyckeln och inte kräver nät. Ägarcredentialens åttatimmarsgräns ändras inte.

## Nyckel och behörighet

En serveradministrerad anslutning binds till en specifik CREATE_EVENT-access-
credential. Det ger inte generell användning av serverns Eventornycklar till
alla skapare. Befintligt icke-racebundet sessionsubstrat används; racebundna
FK:n och capabilities försvagas inte. En lyckad import ger inga nya rättigheter
till det skapade loppet. Kopplingar och importer auditförs.

Nyckeln konfigureras via lokal säker CLI/inmatning, aldrig browser eller chat.
Databasen får endast AES-256-GCM-krypterad nyckel, 12-byte slumpnonce och
16-byte autentiseringstagg. Masterkey levereras separat av driftens secret-
hantering, inte i DB/backup/repository. Ett icke-hemligt keyId möjliggör rotation.
AAD binder formatversion, keyId, Testeventor-miljö, connection-id och tillåten
skapandecredential. Flyttad/manipulerad ciphertext eller fel masterkey avvisas.
Ingen plaintextnyckel, ciphertext, responsebody eller underliggande fetch-/
decrypt-exception ska ingå i generella loggar eller browserfel.

## Import och historik

Privat granskning visar endast whitelisted event/loppmetadata, externa IDs och
källhash/hämtningstid. Originalets kontakt-/person-/organisationsmetadata
behöver inte lagras; ingen rå Eventor-dump exponeras. En självständig adapter
mappar Eventors modell till O-Tids DTO, inte till domänen direkt.

Bekräftelsen binds till vald anslutning, EventId/EventRaceId, tidszon och
granskad källhash. Ny import omvaliderar källa och behörighet; förändring ger
konflikt. Event/race, externa referenser, requestjournal och audit skapas i
en transaktion. Exakt retry ska returnera sparad kvittens utan nätberoende.
Externa IDs är aldrig PK; samma Testeventor-event ska inte skapa dubbletter
med ett nytt request-id. Befintligt importerat event avvisas i detta snitt:
uppdatering eller tillägg av etapp kräver ett senare uttryckligt flöde.

Ingen automatisk publicering av start-/resultatlistor följer med. Befintlig
publik rubrikmetadata från eventskapande följer ADR-0021; granskning varnar
för att bekräftat event/loppnamn och datum blir synliga där.

## Migration, licens och verifiering

Additiva tabeller för krypterad anslutning/behörighet, externa referenser och
immutable requestjournal planeras före writes. Rollback stänger integration
och spärrar anslutningen; inga externa-ID-/beslutsjournaler raderas. Backup och
masterkey måste återställas tillsammans under separata åtkomstregler.

Använd Node:s inbyggda crypto och befintlig XML-parser vid adapterbehov;
ingen AGPL-kod, genererad extern struktur eller ny tjänst. Syntetiska adapter-
och HTTP-fixtures är inte livebevis. Slutlig acceptance kräver en riktig
autentiserad läsning av användargodkänd testtävling samt intern atomisk import.
Saknad nyckel hindrar livebevis men inte den avgränsade implementationen.
