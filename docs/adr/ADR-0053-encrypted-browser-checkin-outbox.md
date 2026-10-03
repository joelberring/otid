# ADR-0053: Krypterad beständig avprickningskö i webbläsaren

- Status: Accepterad; TASK 006W under implementation
- Datum: 2026-09-05
- Konkretiserar ADR-0049/0050. Inga nya teknikval, beroenden eller domängränser.

## Lokal upplåsning och behörighet

Förberedelse kräver fungerande nät, uttryckligt samtycke till privat lokal
lagring, registrering av device och hämtad full roster för samma race.
Servercredential/session/CSRF sparas aldrig i lagringen. Mobilen får en
separat lokal lösenfras (minst 16 tecken, inte en kort PIN), som operatören
måste bevara separat. Passfrasen skickas aldrig till servern och lagras inte.
Web Crypto PBKDF2-HMAC-SHA-256 (600 000 iterationer, slumpat 16-byte salt)
härleder en icke-exporterbar AES-256-GCM-nyckel. Varje krypterad post får nytt
slumpat 12-byte IV och AAD som binder format, vault-id, posttyp och version
eller sekvens. Namn/roster, registreringsmetadata, operationsintents och
kvittenser lagras krypterade. Endast opakt vault-id, räknare, salt och
krypteringskuvert behöver ligga öppet för IndexedDB-uppslagning. SHA-256 över
device-id lagras dessutom som unik uppslagsnyckel så två lokala vaults inte
kan skapa separata sekvensköer för samma registrerade enhet.

Upplåsning ger lokal läs-/skrivåtkomst till redan förberett material, aldrig
ny serverbehörighet. Ny onlinesession med samma giltiga credential används
för synk. Utgången/spärrad/annan credential stoppar synk och bevarar kön.
Ingen automatisk device-/actorflytt, ny sekvensserie eller ombasering tillåts.
Krypterat återhämtningsarkiv får exporteras utan att ändra originalkön;
arkivimport/administrativ credentialöverlåtelse är separata ej implementerade
flöden. Glömd lokal lösenfras kan inte återställas från servern. Vid detta
läge behålls filerna; ingen automatisk radering eller ny tom kö över dem.

Låsning/logout släpper nyckelreferensen och persondata från UI, inte IndexedDB.
En låst kö kan inte synkas i bakgrunden. Om offlinebehörighet spärrats kan
servern inte återkalla redan upplåsta lokala kopior. XSS, skadlig same-origin-
kod, komprometterad enhet eller radering av webbläsarprofil skyddas inte av
denna kryptering. Enhetslås och betrodd drift krävs; ingen full säkerhets-
eller återställningsgaranti utlovas. Lokal lagring är originbunden och får
inte klonas till en annan aktiv mobil med samma device/sekvensidentitet.

## Transaktioner och samtidighet

En IndexedDB-databas innehåller separata stores för vaultmetadata, roster,
immutable operationsposter och immutable kvittenser. Roster krypteras inte
om vid varje kryss. Metadata har en monoton CAS-version; kryptering/dekryptering
sker före en kort readwrite-transaktion, aldrig över await-WebCrypto inne i
en aktiv IDB-transaktion. Under transaktionen jämförs observerad metadataversion.
Sekvensallokering, operation och ny metadata committar atomärt. En andra flik
med gammal version får synlig konflikt och måste läsa om, inte skriva över.

Alla writes begär durability=strict och avvisas om browsern inte rapporterar
strict. Endast transaction complete ger lokalt sparbesked; quota/abort ger inget
sparat. Förberedelsen ska begära navigator.storage.persist och visa faktiskt
utfall. Persist-avslag får inte döljas som garanterad lagring; operatören måste
uttryckligen acceptera best-effort-risk eller använda annan enhet. Läs tillbaka
och validera efter förberedelse. Skadade poster avvisas utan automatisk rensning.

## Ordnad kö och bevarad historik

Operation byggs från den lokalt observerade roster-/avprickningsversionen.
START_CHECKIN får endast MARK_START, FINISH_FOREST_WATCH endast FINISH_CORRECTION,
exakt som serverns befintliga skrivgrind. Osynkbara roll/actionkombinationer får
inte skapas som pending och därmed blockera enhetens ordnade sekvenskö.
Alla fält och canonical SHA-256 fryses före write. Efterföljande lokal ändring
för samma entry binder föregående request och förväntad resulterande revision.
Transporten läser tidigaste ännu ej kvitterade sekvens; inget nätanrop raderar
eller ändrar dess intent. Serverns exakta kvittens binder request, device,
race/entry, sekvens och hash. APPLIED måste ha expectedRevision+1, UNCHANGED
expectedRevision. CONFLICT är durabelt mottagen men inte genomförd.

Kvittens och metadatas mottagningspekare committar tillsammans. Samma kvittens
är idempotent; ändrad kvittens eller fel ordning avvisas. Operationshistorik
och konfliktkvittenser behålls. Rosteruppdatering ändrar aldrig köade intents.
Ingen reducerare räknar resultat/DNS eller förvandlar en lokal markering till
officiell starttid; serverns befintliga domänplan äger verksamhetseffekten.

Rensning får ske separat, uttryckligen och versionsbundet först när inga
okvitterade operationer eller ogranskade konflikter finns. Osynkade/konflikt-
poster får inte raderas av logout, ny login, formatfel eller uppdaterat appskal.
Återhämtningsarkiv behåller krypterade bytes och är inte en importfunktion.

## Appskal och verifiering

Transporten för en upplåst kö skickar högst en operation per steg och binder
sin URL statiskt till vaultens race och start-/målcapability. POST använder
same-origin, no-store, redirect:error och aktuell CSRF från cookie, aldrig en
lagrad credential. Hela request inklusive body har tidsgräns. HTTP 200 måste
innehålla giltig exakt matchande STORED-kvittens. Ingen annan HTTP-status,
inklusive 409, är kvittens. Kvittensen måste committa lokalt före nästa steg.
Lokalt CAS-fel, nät-/authfel, låsning eller abort stoppar steget och bevarar
operationen. Nytt försök läser första okvitterade operationen igen; inget intent
ombaseras. Servern validerar registrerad actor/device mot aktuell session.
En serverlagrad CONFLICT kvitteras som mottagen men visas som ej genomförd.
Transporten fattar inga start-, DNS- eller resultatbeslut.

Persondatafritt separat appskal/service worker ska integreras efter lagringen.
Cache får aldrig innehålla API, RSC, credentials, roster eller kartor. En
testad IDB-adapter ensam uppfyller inte användarens offline-/omladdningsflöde.

Riktig browser-IDB ska provas för omladdning/upplåsning, fel lösenfras och
manipulerad post, samtidiga flikversioner, atomisk operation/sekvens, felaktig
kvittens, durabel konflikt, säkert rensningsavslag och låsning utan köförlust.
Slutacceptans kräver sedan offline-appskal och faktisk HTTP/PG-synk med tappat
svar, credentialåterhämtning och målpersonalens rättnings-/granskningsflöde.
Se docs/research/browser-checkin-storage.md för faktaunderlag.
