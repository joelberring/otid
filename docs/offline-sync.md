# Offline-synk och idempotens

## TASK 001

TASK 001 bygger inte den fulla offline-stationen, men simulatorn etablerar samma
uppströmskontrakt. Lokal beständighet är webbläsarens `localStorage`: stabilt
`deviceId`, nästa sekvens och ännu inte kvitterade batcher med den paketversion
som gällde när posten skapades. Vid sidstart och när nätet återkommer försöker
simulatorn skicka kön i sekvensordning. Senaste batchen återställs också så att
en uttrycklig dublett kan skickas efter omladdning. Det är ett demonstrationsskal,
inte den crash-säkra SQLite-lösningen för fältbruk.

## Batchkontrakt

Varje batch innehåller:

- `deviceId` och `sessionId`,
- `packageVersion`,
- `firstSequence` och `lastSequence`,
- en eller flera händelser med `localSequence`, mottagningstid, transporttyp,
  rå payload och SHA-256-hash.

Servern validerar att intervallet och hasharna stämmer. Den unika nyckeln
`(device_id, local_sequence)` är den primära idempotensbarriären.

## Kvittens

Svaret skiljer mellan `stored`, `duplicate` och `rejected` per sekvens och anger
högsta sammanhängande sekvens som servern har permanent lagrat. Varje kvittens
innehåller både sekvens och innehållshash. Svaret anger även aktuell
serverpaketversion, `current | stale | ahead` och om stationen behöver hämta ett
nytt paket. Ett serverresultat märks med motor- och snapshotversion.

Varje simulatorpost fryser ett lokalt `queueId`, `deviceId`, `sessionId`,
paketversion, sekvens och hash. Simulatorn runtimevaliderar hela svaret och tar
endast bort exakt en köpost efter `stored` eller `duplicate` för samma identitet.
Ett HTTP-fel eller ogiltigt svar lämnar posten kvar och stoppar ordnad flush
eftersom commitläget då är okänt.

Äldre eller skadade localStorage-poster som inte kan ges en säker, fullständig
identitet flyttas bytebevarande till en lokal karantännyckel och skickas inte
automatiskt. En borttagen global device-nyckel ändrar inte identiteten på nya
formatets redan köade poster.

Samma sekvens med annan hash är en konflikt och avvisas. Rådata från den första
committade händelsen ändras aldrig. Samma sekvens/hash med ändrat lopp, session,
paketversion eller mottagningstid avvisas som en kontextkonflikt.

En stale eller ahead paketversion avvisar inte i sig rådata. Servern beräknar
med sin aktuella snapshot och gör avvikelsen synlig; endast `stale` sätter
`packageUpdateRequired`.

## Transaktionsgräns

För varje ny händelse sparas i en PostgreSQL-transaktion:

1. råmeddelande,
2. normaliserad avläsning,
3. eventuell resultatrevision.

En kvittens lämnas först efter commit. Ett nätverksfel efter commit är ofarligt:
klienten skickar samma batch igen och får `duplicate`.

Samtidiga resultatrevisioner använder PostgreSQL-radlås enligt
`race -> entry -> revision`. Delat race-lås ger en sammanhängande snapshot;
entry-låset gör revisionsallokeringen atomär per deltagare. Se ADR-0010.

## TASK 005A: Androidstationens beständiga kärna

Servern skapar ett deterministiskt paket för en låst snapshotversion och
signerar exakt de UTF-8-bytes som transporteras i kuvertet. Stationen får den
betrodda publika SPKI-nyckeln separat, jämför key-id och verifierar RS256 innan
payloaden tolkas eller skrivs. Kuvertets egen nyckel etablerar aldrig förtroende.

Androids `OtidStationStore` äger app-privat SQLite:

- installerade paket är append-only och gamla versioner behålls,
- aktiv version byts i samma transaktion som ett nytt paket installeras,
- samma version/hash är idempotent,
- samma version/annan hash och rollback avvisas,
- `deviceId` skapas en gång i databasen,
- sekvensallokering och full outboxpost committas tillsammans,
- skickning ändrar inte posten,
- exakt `stored`/`duplicate` markerar `ACKNOWLEDGED`, medan `rejected` sparas
  med orsak; ingen av posterna raderas.

SQLite använder foreign keys, WAL och `synchronous=FULL`. Hela databasen är
utesluten från både cloud backup och device transfer så att deviceidentitet och
sekvensutrymme inte klonas till en annan platta.

TASK 005A använder fortfarande endast simulatorns normaliserade payloadtyp. Det
bevisar paket-, lagrings- och kvittensgränsen men inte SPORTidenttolkning, lokal
resultatmotor, två timmars fältdrift eller full enhetsparning.

## TASK 005B: lokal bedömning efter säker enqueue

Stationen läser aktivt pakets payload från SQLite, verifierar den lagrade
SHA-256-hashen och runtimevaliderar paketet. Simulatorpayload och innehållshash
committas först till outboxen med nästa lokala sekvens.

Om paketets motorversion matchar appens `RESULT_ENGINE_VERSION` kör stationen
samma rena domänfunktion som servern. Motorversion, snapshotversion, pakethash
och bedömning sparas sedan i en separat append-only-rad knuten till sekvensen.
UI:t visar inte OK/MP/okänd bricka innan även denna rad har committat.

Ett motorversionsfel, evalueringsfel eller appstopp efter enqueue lämnar därför
en synkbar outboxpost utan lokalt besked. Schema 2 behåller v1-poster utan att
fabricera retroaktiva bedömningar. Lokal och serverberäknad bedömning jämförs
inte förrän ett senare konfliktsnitt kopplar stationssynken till UI:t.

## TASK 005C: synk, retry och central observation

Stationen läser den tidigaste pending-posten och skickar den ensam via native
HTTP. Fryst payload, hash och kontext omvalideras före sändning. Svaret måste
runtimevalideras och exakt motsvara skickad device, sekvens och hash innan det
får nå SQLite. `highestContiguousSequence` kvitterar aldrig något implicit.

Ett nätfel, timeout, HTTP-fel, trasig body eller lokalt commitfel lämnar posten
pending och stoppar ordnad flush. Ett tappat svar efter servercommit återhämtas
med samma request och `duplicate`. Servern sparar därför ett append-only
ingestutfall för varje rawpost, även okänd bricka, i samma transaktion.

SQLite schema 3 sparar både rå receipt och en strukturerad append-only
ackobservation. En identisk retry är idempotent; ett nytt giltigt serverbesked
appenderas. Den lokala bedömningen skrivs aldrig över. UI-jämförelsen härleds ur
senaste lokala bedömning och centralobservation och skiljer match, faktisk
avvikelse och annan versionsgrund. Servern är alltid auktoritativ.

Bas-URL får lagras som icke-hemlig konfiguration. Token och betrodd SPKI hålls
endast i minnet. Ingest-routen saknar ännu produktionsautentisering och 005C
utgör därför inte färdig enhetsparning. Se ADR-0013.

## TASK 005D: autentiserad synk utan köförlust

Varje native synkrequest använder en tidsbegränsad credential bunden till
stationens beständiga `deviceId`, loppet och `READOUT`. Native kod läser den
Keystore-krypterade credentialen, validerar URL/rutt och injicerar bearerheadern.
Token lämnas inte tillbaka till TypeScript efter installation.

Auth sker före serverns bodyparsning och ingest. `401` eller `403` är därför ett
säkert negativt besked om requestens behörighet, men aldrig en kvittens för
outboxeventet. Stationen lämnar posten `PENDING`, stoppar ordnad flush och visar
att operatörsåtgärd krävs. Den raderar varken event eller credential automatiskt.
Nätfel, timeout och 5xx behåller samma tidigare retrysemantik och
idempotency-key.

Credentialfilen ingår inte i SQLitebackup eller device transfer. Om filen,
Keystore-nyckeln eller GCM-taggen saknas/är ogiltig fortsätter offlineavläsning
och lokal bedömning; endast synk blockeras. Ny credential kan installeras utan
att ändra deviceidentitet, paket, outbox eller historik. Se ADR-0014.

## TASK 005E: crash-säker parning och återupptagning

Före första inlösen skapar native kod credential-secret och attempt-id och
committar dem tillsammans med grant och bas-URL i en Keystore-krypterad
AtomicFile. Inget nätanrop får starta innan denna pendingstate är beständig.

`beginDevicePairing` committar pendingstate utan att öppna nätverk. Först ett
separat `redeemDevicePairing` får använda den beständiga staten.

Servern ser endast credential-secretens SHA-256-hash. Grantets unika redemption
och samma attempt/device/hash gör ett tappat svar idempotent: retry returnerar
samma metadata och skapar ingen ny credential. Native installerar den lokalt
konstruerade credentialtokenen före pendinghemligheterna ersätts av en
icke-hemlig completed-markör. Processdöd före eller efter servercommit eller ett
tappat pluginsvar kan därför återupptas utan att ändra SQLite, outbox eller
sekvensutrymme.

HTTP-, auth-, rate-limit-, kontrakts-, decrypt- eller installationsfel lämnar
pendingstate och outbox orörda. Operatören kan uttryckligen återuppta samma
försök. En skadad pendingfil ger ett säkert felläge; automatisk rensning eller
nytt grant får inte dölja att servern kan ha committat. Se ADR-0015.

## TASK 005F: onlineadministration ändrar inte stationens offlineväg

Pairingadmin, accesscredential och webbsession är serverberoende och används
endast innan ett grant förs över till stationen. Webbläsaren genererar grantets
secret lokalt och kan explicit retrya samma issue medan secret finns kvar i
minnet. Efter omladdning kan servern endast visa metadata; en okänd aktiv
utfärdning spärras och ersätts, aldrig återskapas från serverhashen.

Stationens redan beständiga TASK 005E-pendingstate, credentialpromotion,
SQLite, outbox och ordnade retry påverkas inte. När grantet väl finns fortsätter
stationen kunna läsa och bedöma offline; arrangörssessionen behövs inte för
inlösen, paket, ingest eller återupptagning. Se ADR-0016.

## TASK 005G: autentiserad import ändrar inte stationens offlineväg

IOF-importsessionen och dess request-id gäller endast serverns onlineimport före
eller under tävlingsadministration. En committad import ökar fortsatt racets
snapshotversion atomärt; stationen ser ändringen först när ett nytt signerat
paket hämtas och installeras enligt TASK 005A. Ingen importsessionscookie,
accesscredential, fil eller importrequest överförs till stationen.

Okänd HTTP-commit hanteras i importwebbläsaren med exakt request-id och explicit
retry. Det är skilt från stationens SQLite-outbox och ändrar varken device-id,
sekvensutrymme, pending pairingstate, ingestkvitton eller lokal evaluering. En
redan installerad paketversion och hela readoutflödet fortsätter fungera offline
utan import- eller arrangörssession. Se ADR-0017.

## TASK 005H: autentiserad klassändring ändrar inte stationens offlineväg

Klassadminsessionen och dess request-id gäller endast serverns onlineändring av
en entry. En committad ändring ökar loppets snapshotversion, men skapar ingen
resultatrevision och skickas inte direkt till stationen. Stationen ser den nya
klasskopplingen först i ett nytt signerat paket som hämtas och installeras enligt
TASK 005A.

Okänd HTTP-commit hanteras endast i klassadminwebbläsaren med samma interna
request-id och explicit retry. Credential, cookie, CSRF, requestjournal och
pending browserstate överförs aldrig till stationen och påverkar inte SQLite,
outbox, device-id, lokala sekvenser, pairingstate, ingestkvitton eller lokala
bedömningar. Befintligt installerat paket och readout fortsätter fungera offline.
Se ADR-0018.

## TASK 005I: explicit omräkning ändrar inte stationens offlineväg

En serveromräkning skapar en ny auktoritativ, publicerad resultatrevision men
ändrar inte loppets snapshotversion eller signerade tävlingspaket. Stationens
aktiva paket, lokala evaluation, SQLite-outbox, device-id, sekvenser, pairingstate
och ackhistorik påverkas därför inte.

Okänd HTTP-commit hanteras i omräkningswebbläsaren med samma interna request-id
och explicit retry. Credential, cookie, CSRF, fryst intent och requestjournal
överförs aldrig till stationen. Stationen fortsätter läsa, bedöma och köa offline;
den centrala omräkningen syns endast som serverns senare auktoritativa
resultatrevision. Se ADR-0019.

## TASK 005J: tävlingsöversikten ändrar inte stationens offlineväg

Overviewcredential, webbsession och PII-fria DTO används endast för en
serverberoende arrangörsläsning. GET gör ingen domän-, audit- eller journalwrite
och ändrar inte snapshotversion, signerat paket, stationcredential, SQLite,
outbox, device-id, sekvenser, pairingstate, ingestkvitton eller lokala
bedömningar.

En otillgänglig eller utloggad overview påverkar därför inte readoutstationens
offlinearbete. Simulatorn tas bort från overviewytan, men dess befintliga
utvecklingskö får inte rensas eller migreras av overview-login/logout. Ingen
overviewcredential, cookie eller DTO överförs till stationen. Se ADR-0020.

## TASK 005K: eventskapande ligger utanför stationens offlineväg

Event och första lopp skapas server-side innan ett stationspaket kan hämtas.
Den globala `CREATE_EVENT`-credentialen, dess browsercookies och
requestjournal distribueras aldrig till stationen och får inte återanvändas för
ingest, pairing eller pakethämtning.

Okänd commit hanteras med en serverbeständig idempotencyjournal och explicit
browserretry. Det ändrar inte stationens lokala kö, ackgräns eller regel att den
enda lokala kopian aldrig raderas för att ett nätanrop skickades.

## TASK 005L: simulatorgrinden rör ingen lokal kö

Den fail-closed grinden ligger endast före serverrenderingen av
`/admin/{raceId}/simulator`. När den avvisar hydreras ingen klient och inget nytt
`localStorage`-tillstånd skapas, men befintliga device-id:n, sekvenser,
okvitterade poster och senaste batch får aldrig rensas eller migreras.

När lokal utveckling uttryckligen tillåts är kö-, hash-, sekvens-, retry- och
acksemantiken oförändrad. Den autentiserade device-batch-routen och stationens
SQLite-outbox påverkas inte; stationen kan fortsatt läsa, bedöma och köa offline
även när webbsimulatorn är 404. Se ADR-0022.

## TASK 005M: ingressavslag raderar aldrig pending

Servern autentiserar race/`READOUT` före body och begränsar därefter varje
device-batch-kuvert till 4 MiB faktisk UTF-8-JSON. Androidstationens egen
single-event-policy är fortsatt 512 KiB och ligger långt under servergränsen.

400, 413 och 415 är definitiva HTTP-avslag för just requestkuvertet men är inte
en serverkvittens för outboxposten. Stationen anropar därför aldrig
`applyAcknowledgements`, lämnar posten `PENDING` och stoppar ordnad flush. En
korrigerad klient/request kan skicka exakt samma lokala sekvens och hash igen;
endast ett strikt validerat `stored` eller `duplicate` får kvittera posten.

Ingen lokal payload, hash, sekvens, evaluation eller ackhistorik migreras eller
rensas av TASK 005M. Se ADR-0023.

## TASK 005N: privat historikläsning ändrar inte offlinevägen

Historycredential, browsersession, cursor och DTO används endast för en
serverberoende read-only arrangörsyta. GET skapar ingen domän-, audit- eller
journalwrite och ändrar inte signerat paket, snapshotversion, stationcredential,
SQLite, outbox, device-id, sekvens, pairingstate, ingestutfall eller lokal
evaluation.

En otillgänglig, utloggad eller spärrad historysession påverkar därför inte
stationens läsning, lokala bedömning eller ordnade synk. Historikens
revisionsvattenmärke är en browsercursor, inte en stationkvittens, och överförs
aldrig till stationen. Se ADR-0024.

## TASK 006A: StartList skapar nytt stationssnapshot vid faktisk delta

En lagrad `StartList` ökar loppets snapshotversion endast när minst en
startregel eller fast starttid faktiskt ändras. Nästa signerade tävlingspaket
innehåller `FIXED`, normaliserade fasta starttider och det nya snapshotnumret.

Redan installerade paket och lokala evaluationer är immutable och fortsätter
fungera offline. Ingen import rensar SQLite-outbox, device-id, sekvenser,
pairingstate eller kvittenser. När gamla paket synkas behåller servern rådata och
signalerar paketstatus enligt den befintliga stale/current/ahead-policyn. En
central omräkning är ett separat explicit operatörsval. Se ADR-0025.

## TASK 006B: ResultList-export ändrar inte offlinevägen

Exportcredential, browsersession och XML används endast för en serverberoende
read-only arrangörsläsning. GET skapar ingen domän-, audit- eller journalwrite
och ändrar inte snapshotversion, signerat paket, stationcredential, SQLite,
outbox, device-id, sekvens, pairingstate, ingestutfall eller lokal evaluation.

En otillgänglig, utloggad eller spärrad exportsession påverkar därför inte
stationens läsning, lokala bedömning eller ordnade synk. XML-filen och dess ETag
är inte en stationkvittens och överförs aldrig till stationen. Se ADR-0026.

## TASK 006C: härledd ranking ändrar inte offlinevägen

Position och tid efter beräknas server-side från senaste publicerade immutable
revisioner när publikresultat eller ResultList läses. Rankingen lagras inte,
skapar ingen audit och ändrar inte snapshot, paket, SQLite, outbox, lokal
evaluation, ackhistorik eller stationens operatörsbesked.

En station behöver inte känna till andra deltagares tider för att ge sitt
omedelbara lokala OK/MP-besked. Ranking är därför inte del av lokal evaluation
eller serverkvittens. Samtidig ingest syns i en read-only projektion helt före
eller efter commit enligt befintliga transaktionsgränser. Se ADR-0027.

## TASK094: återtagande av observerad måltidsrättning ändrar inte offlinevägen

Återtagandet är en serverberoende, `MANAGE_RACE`-skyddad GET/POST-åtgärd med
idempotent requestjournal. Den får varken ändra stationens paket, lokala kö,
device-id, råbytes, CardReadout eller lokala bedömning. En station kan alltså
fortsätta läsa och köa offline medan administratören återtar en felaktig
måltidsrättning. Först när den nya append-only revisionen är committad får
senare synkade/publika läsningar se den centrala återställningen. Se ADR-0112.

## TASK 006D: finalisering är ett centralt beslut, inte en stationkvittens

Klass- och loppsfinalisering körs endast på servern under ett kort exklusivt
lopplås. Låset serialiserar beslutet mot samtidig ingest och omräkning men
ändrar inte råmeddelande, resultatrevision, snapshotversion, signerat paket,
stationcredential, SQLite, outbox, device-id, sekvens, pairingstate,
ingestutfall, lokal evaluation eller ackhistorik.

En station får fortsatt läsa och bedöma offline medan servern är otillgänglig.
Sena lokala poster kan synkas efter en finalisering; de skriver aldrig om den
frysta projektionen eller dess XML, utan kräver nya explicita
finaliseringsrevisioner om arrangören vill utfärda ett uppdaterat `Complete`.

Finaliserings-id, klassgrundhash och XML-hash är server-/browsermetadata. De är
inte paketversioner eller stationkvittens och överförs aldrig till stationen.
Se ADR-0028.

## TASK 006E: ej-startbeslut ändrar inte stationens offlineväg

DNS registreras endast i serverns separata, autentiserade arrangörsflöde och
skapar ingen rawpost, normaliserad avläsning, stationsevaluation eller
stationkvittens. Beslutscredential, webbsession, CSRF, requestjournal och audit
överförs aldrig till stationen.

Beslutet ändrar inte race-snapshot, signerat paket, SQLite, outbox, device-id,
sekvens, pairingstate, ingestutfall eller lokal bedömning. En offlineavläsning
kan därför synkas senare: om DNS redan committat appendar servern kortresultatet
som nästa resultatrevision; om ingest vinner före beslutet avvisas det stale
DNS-intentet. Ingen lokal post raderas eller markeras kvitterad av DNS. Se
ADR-0029.

## TASK 006F: DNS-återtagande ändrar inte stationens offlineväg

Återtagandet registreras endast i serverns separata autentiserade arrangörsflöde
och är varken en avläsning, resultatrevision eller stationkvittens. Credential,
session, CSRF, intent, withdrawaljournal och audit överförs aldrig till
stationen och ändrar inte race-snapshot, signerat paket, SQLite, outbox,
device-id, sekvenser, pairingstate eller lokal evaluation.

Efter ett committat återtagande kan en redan köad offlineavläsning fortfarande
synkas. Ingest appendar då nästa vanliga resultatrevision under entrylåset. Om
ingest vinner låset först blockeras det stale återtagandet; om återtagandet
vinner först blir kortresultatet revision 2. I inget fall raderas eller
kvitteras en lokal post av arrangörsåtgärden. Se ADR-0030.

## TASK 006G: DSQ-livscykeln ändrar inte stationens offlineväg

Diskvalifikation och återtagande är separata serverbundna arrangörsbeslut.
Deras credentials, cookies, CSRF, requestjournaler, actor-audit och manuella
resultatrevisioner överförs aldrig till stationen. De ändrar inte tävlingspaket,
snapshotversion, SQLite, outbox, device-id, sekvenser, pairingstate,
ingestutfall eller lokal kortbedömning.

En avläsning som redan ligger offline får synkas medan ett DSQ är aktivt.
Servern bevarar rawpost, readout, evaluation och nästa tekniska revision i
vanlig ordning, men den centrala levande projektionen visar fortsatt den aktiva
DSQ-revisionen tills ett explicit withdrawal committar.

Withdrawal väljer under entrylåset en exakt intentbunden senaste underliggande
`OK`/`MP`-revision och appenderar en restaureringsrevision. Samtidig ingest
serialiseras i samma `race SHARE -> entry UPDATE`-ordning; ett stale browser-
intent byter aldrig källa automatiskt. Ingen lokal post raderas, avpubliceras
eller markeras kvitterad av någon av arrangörsåtgärderna. Se ADR-0031.

## TASK 006H: approval-livscykeln ändrar inte stationens offlineväg

Godkännande och återtagande är separata serverbundna arrangörsbeslut. Deras
credentials, cookies, CSRF, requestjournaler, audit och manuella revisioner
överförs aldrig till stationen och ändrar inte tävlingspaket, snapshotversion,
SQLite, outbox, device-id, sekvenser, pairingstate, ack eller lokal evaluation.

En redan köad avläsning får synkas medan approval är aktivt. Servern bevarar
rawpost, readout, evaluation och nästa tekniska revision, men den centrala
levande projektionen visar fortsatt det manuellt godkända resultatet tills ett
explicit withdrawal committar. Därmed skrivs den manuella åtgärden inte över
tyst av senare offlinedata.

Withdrawal binder under samma `race SHARE -> entry UPDATE`-ordning både
observerat absolut huvud och exakt senaste giltiga tekniska `OK`/`MP`-källa.
Stale intent ger konflikt och väljer aldrig om källan. Ingen lokal post raderas,
avpubliceras eller markeras kvitterad av approval-livscykeln. Se ADR-0032.

## TASK 006I: DNF-beslut ändrar inte stationens offlineväg

DNF är ett serverbundet arrangörsbeslut med separat credential, session, CSRF,
requestjournal, audit och manuell resultatrevision. Inget av detta överförs till
stationen eller ändrar tävlingspaket, snapshotversion, SQLite, outbox,
device-id, sekvenser, pairingstate, ack eller lokal evaluation.

En redan köad avläsning får synkas medan DNF är aktivt. Servern bevarar
rawpost, readout, evaluation och nästa tekniska revision, men den centrala
levande projektionen visar fortsatt den frysta DNF-revisionen. TASK 006I har
inget withdrawal, så senare offlinedata kan inte tyst upphäva beslutet.

DNF-intentet binder entryns absoluta aktuella tekniska target under samma
`race SHARE -> entry UPDATE`-ordning. Om ingest vinner först blir intentet
stale och skriver inget; om DNF vinner får ingest appendera efteråt. Ingen lokal
post raderas, avpubliceras eller markeras kvitterad av DNF-beslutet. Se
ADR-0033.

## TASK 006J: DNF-återtagande ändrar inte stationens offlineväg

Återtagandet är en separat serverbunden arrangörsåtgärd. Credential, cookies,
CSRF, fryst intent, withdrawaljournal, restaureringsrevision och actor-audit
överförs aldrig till stationen och ändrar inte tävlingspaket, snapshotversion,
SQLite, outbox, device-id, sekvenser, pairingstate, ack eller lokal evaluation.

Under samma `race SHARE -> entry UPDATE`-ordning binder withdrawal både det
observerade absoluta huvudet och en exakt teknisk `OK|MP`-källa. Om ingen
senare teknik finns används DNF-beslutets originaltarget. Om en offlinepost har
synkats senare måste dess direkta tekniska revision vara både absolut huvud och
källa. Ett stale intent söker aldrig bakåt eller väljer om källa.

Om ingest vinner först avvisas withdrawal utan write. Om withdrawal vinner
appenderas restorationen först och senare ingest får därefter appendera nästa
tekniska revision. Ingen lokal post raderas, avpubliceras eller markeras
kvitterad av återtagandet. Se ADR-0034.

## TASK 006K: OOC-beslut ändrar inte stationens offlineväg

OOC är ett serverbundet arrangörsbeslut med separat credential, session, CSRF,
requestjournal, audit och manuell resultatrevision. Inget av detta överförs till
stationen eller ändrar tävlingspaket, snapshotversion, SQLite, outbox,
device-id, sekvenser, pairingstate, ack eller lokal evaluation.

En redan köad avläsning får synkas medan OOC är aktivt. Servern bevarar
rawpost, readout, evaluation och nästa tekniska revision, men den centrala
levande projektionen visar fortsatt den frysta OOC-revisionen. TASK 006K har
inget withdrawal, så senare offlinedata kan inte tyst upphäva beslutet.

OOC-intentet binder entryns absoluta aktuella tekniska target under samma
`race SHARE -> entry UPDATE`-ordning. Om ingest vinner först blir intentet
stale och skriver inget; om OOC vinner får ingest appendera efteråt. Ingen lokal
post raderas, avpubliceras eller markeras kvitterad av OOC-beslutet. Se
ADR-0035.

## TASK 006L: OOC-återtagande ändrar inte stationens offlineväg

Återtagandet är en separat serverbunden arrangörsåtgärd. Credential, cookies,
CSRF, fryst intent, withdrawaljournal, restaureringsrevision och actor-audit
överförs aldrig till stationen och ändrar inte tävlingspaket, snapshotversion,
SQLite, outbox, device-id, sekvenser, pairingstate, ack eller lokal evaluation.

Under samma `race SHARE -> entry UPDATE`-ordning binder withdrawal både det
observerade absoluta huvudet och en exakt teknisk `OK|MP`-källa. Om ingen
senare teknik finns används OOC-beslutets originaltarget. Om en offlinepost har
synkats senare måste dess direkta publicerade tekniska revision vara både
absolut huvud och källa. Ett stale intent söker aldrig bakåt eller väljer om
källa.

Om ingest vinner först avvisas withdrawal utan write. Om withdrawal vinner
appenderas restorationen först och senare ingest får därefter appendera nästa
tekniska revision. Ingen lokal post raderas, avpubliceras eller markeras
kvitterad av återtagandet. Se ADR-0036.

## TASK 006M: NT-beslut ändrar inte stationens offlineväg

Utan tidtagning är ett serverbundet arrangörsbeslut med separat credential,
session, CSRF, requestjournal, audit och manuell resultatrevision. Inget av
detta överförs till stationen eller ändrar tävlingspaket, snapshotversion,
SQLite, outbox, device-id, sekvenser, pairingstate, ack eller lokal evaluation.

En redan köad avläsning får synkas medan NT är aktivt. Servern bevarar rawpost,
readout, evaluation och nästa tekniska revision, men den centrala levande
projektionen visar fortsatt den frysta status-only NT-revisionen. TASK 006M har
inget withdrawal, så senare offlinedata kan inte tyst upphäva beslutet.

NT-intentet binder entryns absoluta aktuella publicerade tekniska
`OK/COMPLETE`-target under samma `race SHARE -> entry UPDATE`-ordning. Om
ingest vinner först blir intentet stale och skriver inget; om NT vinner får
ingest appendera efteråt. Ingen lokal post raderas, avpubliceras eller markeras
kvitterad av NT-beslutet. Se ADR-0037.

## TASK 006N: NT-återtagande ändrar inte stationens offlineväg

Återtagandet är en separat serverbunden arrangörsåtgärd. Credential, cookies,
CSRF, fryst intent, withdrawaljournal, restaureringsrevision och actor-audit
överförs aldrig till stationen och ändrar inte tävlingspaket, snapshotversion,
SQLite, outbox, device-id, sekvenser, pairingstate, ack eller lokal evaluation.

Under samma `race SHARE -> entry UPDATE`-ordning binder withdrawal både det
observerade absoluta huvudet och en exakt teknisk `OK|MP`-källa. Om ingen
senare teknik finns används NT-beslutets ursprungliga `OK/COMPLETE`-target. Om
en offlinepost har synkats senare måste dess direkta publicerade tekniska
revision vara både absolut huvud och källa. Ett stale intent söker aldrig
bakåt eller väljer om källa.

Om ingest vinner först avvisas withdrawal utan write. Om withdrawal vinner
appenderas restorationen först och senare ingest får därefter appendera nästa
tekniska revision. Ingen lokal post raderas, avpubliceras eller markeras
kvitterad av återtagandet. Se ADR-0038.

## TASK 006O: ändrad fast starttid

En individuell starttidsändring ökar racesnapshot och följer samma paketregel
som StartList-importen. Nästa signerade paket innehåller den nya tiden, medan
installerade paket, lokal bedömning, outbox och tidigare kvittenser bevaras.
Gammal köad ingest tas emot och bedöms med aktuell hel snapshot; svaret anger
`packageVersionStatus: stale` och behov av paketuppdatering.

Arrangörens onlineformulär har explicit same-id-retry vid okänt commitsvar.
Det är inte en offlinekö och lagrar inte credential eller intent i Web Storage.
Efter omladdning läser operatören aktuella tider. En separat omräkning ändrar
endast serverns append-only-resultathistorik. Se ADR-0039.

## TASK 006P: brickbyte och sena avläsningar

Nytt snapshot/paket innehåller rätt aktiv bricka och bevarade gamla inaktiva
kopplingar. Redan installerade paket och outboxposter ändras inte. En ny
servermottagning från avaktiverad bricka sparas som UNKNOWN_CARD, aldrig på en
annan deltagare. Befintlig race+bricknummer-unikhet och permanent ägarskap
hindrar återanvändning mellan entries i samma lopp.

Retry av redan committad råpost returnerar det historiska ingestutfallet, även
om brickan bytts därefter. Tidigare okänd avläsning kan användas av separat
explicit omräkning efter koppling; originalkvittensen skrivs inte om. UI har
endast minnesburet retryintent, inte en ny offlinekö. Se ADR-0040.

## TASK 006Q: direktanmälan och tidigare okänd avläsning

Direktanmälan är serverberoende. Nästa signerade paket innehåller deltagare,
eventuell bricka och ny snapshot; äldre paket/outbox/kvittenser ändras aldrig.
En station med gammalt paket kan fortfarande visa okänd bricka lokalt. Servern
bevarar råposten och använder aktuell hel snapshot vid ny ingest.

Redan kvitterad okänd avläsning förblir okänd i originalkvittensen. Efter
registrering kan endast separat explicit omräkning skapa första revisionen
från den tidigare avläsningen. Registreringsvyn behåller okänt commitsvar i
minnet för same-id-retry. Efter omladdning måste aktuell deltagarlista granskas
innan ny registrering; ingen namnbaserad automatisk deduplicering. Se ADR-0041.

## TASK085: administrativ resolution av en vald okänd avläsning

En `MANAGE_RACE`-administratör kan på servern välja en redan lagrad
`UNKNOWN_CARD`-avläsning och atomiskt koppla exakt den till befintlig Entry eller
en strikt ny direktanmälan. Requesten binder readoutId, bricknummer, snapshot,
resultatmotor och mål; den får aldrig välja senaste eller någon annan avläsning
med samma bricka. Den ursprungliga råposten, `card_readout` och
ingestkvittensen ändras inte. Servern append:ar en ny resultatrevision och en
immutable journal/audit, och samma idempotensnyckel återger samma kvittens.

Detta är en online-adminåtgärd, inte en stationskö eller automatisk synkning.
Efter ny snapshot hämtar stationen normalt ett nytt paket; redan installerade
paket, outboxposter och deras tidigare kvittenser bevaras. Senare avläsningar
blir inte automatiskt resultat, och olösta okända avläsningar fortsätter att
blockera finalisering. Se ADR-0107.

## TASK 006R: startlistan är inte en offline stationslista

Startlistan läses server-side vid login och explicit uppdatering. Vid nätfel
behålls tidigare browserlista endast med tydlig varning om gammalt underlag,
snapshot och lästid. Vid authfel/logout tas personuppgifterna bort. Inga
uppgifter eller credentials sparas i Web Storage; omladdning kräver servern.

Denna vy ersätter inte stationens signerade beständiga paket. Readout,
SQLite/outbox, aktiva paket och tidigare kvittenser ändras inte. Startpersonal
kan inte kvittera en avläsning eller skapa faktisk start genom att läsa listan.
Se ADR-0042.

## TASK 006S: offentlig startlista och återtagande

Publicering kräver server. Okänt commitsvar behåller granskat intent/request-id
i minnet för explicit återförsök; detta är ingen beständig offlinekö. Den
publika sidan hämtar utan credentials, med no-store, var femte sekund och vid
återgång till synlig flik. Hämtfel/404/ogiltigt svar rensar tidigare persondata;
en hängande hämtning avbryts efter tio sekunder. Browserns timers kan fördröjas
i bakgrunden. Redan sparade kopior kan inte återkallas.

Stationens signerade paket, rådata, outbox och kvittenser är oförändrade.
Ingen internetberoende publiceringsvy ersätter stationens offlineflöde. ADR-0043.

## TASK 006T: XML-nedladdning

XML är en fryst serverexport, inte en ny lokal tävlingskälla eller synkkö.
Nedladdning kräver nät; fel ger inget XML-innehåll. Ny hämtning efter withdrawal
avvisas, men redan sparade filer och pågående hämtningar kan inte återkallas.
En legacy-publicering saknar export tills arrangören publicerar på nytt.
Stationens paket och ingest påverkas inte. Se ADR-0044.

## TASK 006U: klasslottning

Lottning är ett serverberoende arrangörsbeslut, ingen lokal stationsfunktion.
Sparande ändrar hela klassen atomärt och ökar racesnapshot en gång. Nästa
signerade paket hämtar nya tider genom befintlig snapshotfunktion. Gamla paket,
rådata och kvittenser är orörda; gammal ingest följer befintlig stale-policy.
Resultat kräver separat omräkning, och publicerade listor separat nytt beslut.

Preview och bekräftat intent hålls endast i webbläsarminne. Efter okänt commitsvar
återanvänds samma request-id/seed/parametrar; ingen ny lottning skickas automatiskt.
Efter sidomladdning krävs granskning av aktuell lista innan nytt beslut.
No-store och authfel/logout döljer privata uppgifter. Se ADR-0045.

## TASK 006V: serverimport

Testeventorimport behöver server och extern nätkontakt för nytt underlag.
Den är inte en offlinekälla för stationen. Nyckel och masterkey får aldrig
överföras i signerade stationspaket eller i browser. Exact-retry använder
committad importjournal utan nytt Eventoranrop eller dekryptering. Browsern
behåller request-id och granskat intent endast i minnet efter osäkert svar;
nytt sökunderlag rensar föregående preview. Omladdning/logout kan förlora
pendingintent, så användaren ska kontrollera befintliga tävlingar innan nytt
försök. Global extern-ID-unikhet förhindrar dubbletter även vid nytt request-id.
Ingen stationskö, kvittens eller tidigare tävling ändras av importen.

## TASK 006W: offlinekrav och implementationsläge

Startpersonalens mobiler ska kunna behålla roster och markeringar i
transaktionsstyrd IndexedDB över omladdning, och använda separat cachat
persondatafritt appskal. Lokal sparindikator kräver färdig transaktion.
Serverkvittens binder operationens device/sekvens/id/hash och durabel effekt;
nätfel, authfel eller konflikt får aldrig radera enda lokala kopian.

Målpersonalens kvar-i-skogen-lista visar endast senast synkad kunskap.
Servern vet inte vilka nya markeringar en offlineenhet ännu inte har skickat.
Senast kända kontakt och osäkerhet ska därför synas även på utskrifter.
Se ADR-0049 för DNS-effekt, rättning, integritet och acceptans.

ADR-0050 låser operationsidentitet, canonical hash och separat kvittens för
mottagen kontra genomförd uppgift. dependsOnRequestId binder en efterföljande
lokal rättning till dess föregångare; DEPENDENCY_CONFLICT kräver granskning,
inte automatisk ombasering. Kontrakt, atomisk synktjänst och skyddade
HTTP-anrop finns nu; krypterad lokal IndexedDB-kö finns enligt ADR-0053.
Integrerat offline-appskal och start-/rättnings-UI återstår.
HTTP 200 med STORED/CONFLICT betyder mottagen men inte genomförd markering.
HTTP 409 utan kvittens får inte tolkas som lagrad operation. Se ADR-0052.

Autentiserad enhetsregistrering använder nu deviceId som stabil
registreringsidentitet. Ny session med samma giltiga credential kan få exakt
samma registreringsmetadata; annan actor/race/capability eller ändrat label
får konflikt. Detta är verifierat i PostgreSQL men är inte klientens
persistens- eller köåterhämtning. Utgången eller spärrad credential ger ingen
automatisk ägarflytt och inget tillstånd att radera lokal kö.

Målpersonalens första läs-/utskriftsvy behåller gammalt underlag endast i
minnet vid nätfel och visar uttrycklig varning även i rapporten. Authfel,
sessionexpiry och lokal utloggning döljer persondata; pågående läsning avbryts
så sent svar inte återvisar listan. Inget sparas i Web Storage. Denna vy är
inte offline-appskalet och ersätter inte kravet på beständig lokal avprickning.

Kön har nu separat lokal passfras, krypterad roster/operationshistorik/kvittens,
atomisk sekvensallokering och lokalt CAS mellan flikar. Låsning stänger åtkomst
utan radering. Strict-IDB måste stödjas; begäran om persistent storage läser
faktiskt utfall. UI för uttryckligt lagringssamtycke/riskacceptans återstår.
Enstegstransport skickar första okvitterade operationen exakt, validerar
kvittensens identitet/hash/revision och väntar på lokal commit före nästa steg.
HTTP 409, authfel, timeout eller lokalt CAS-fel stoppar försöket utan köförlust.
Krypterat exportarkiv finns; import och överlåtelse vid spärrad/utgången
credential saknas. Browserprov använder riktig IndexedDB/Web Crypto, men
simulerat transportsvar. Komplett offline-omladdning via appskal och faktisk
HTTP/PG-återhämtning är ännu inte verifierade. Ingen persondata/API/RSC får
läggas i service worker-cache när appskalet kopplas in.

ADR-0054:s appskal är nu kopplat: separat statisk React-entry under /checkin/,
fast hashverifierad HTML/JS/CSS-cache, ingen API/RSC-cache och ingen skipWaiting.
Explicit cachekontroll binder den laddade JS-versionen innan offline redo visas.
Förberedelse kräver shellkontroll, faktiskt persist-utfall, separat samtycke
och vid avslag uttrycklig riskacceptans. Behörighet och lösenfras sparas inte;
registrering/roster sparas krypterat med återläsning. Efter reload väljs opakt
lokalt vault-id och lösenfras; namn visas först efter upplåsning. Pagehide/lås
släpper nyckel, döljer namn och tömmer lösenordsfält. Avbrutet sent svar får
inte öppna listan. Browserproven har simulerade auth-/rostersvar; faktisk
serverintegration samt skrivknappar/synk/konfliktgranskning återstår.

Skriv-/synkkopplingen finns nu. En markering visas som lokalt sparad först
efter IDB-commit/återläsning. Pending, serverns gamla underlag och mottagen
konflikt skiljs åt. Låsning stänger skrivläge och automatisk synk; återupplåsning
aktiverar inte dem igen. Lokal CAS-konflikt ger omläsning och avstängt skrivläge.
Synk återregistrerar exakt samma device/actor, skickar i ordning och uppdaterar
roster först efter kvittenser. Nätfel bevarar samma intent. En opt-in finns för
synk vid online-event medan listan är upplåst; ingen bakgrundssynk av låst kö.
Ny session kan begäras med samma credential. Annan/spärrad/utgången credential
ger ingen automatisk ägarflytt och behöver ännu ett administrativt återhämtnings-
flöde. Historiska konflikter kvarstår; inget UI-granskningsbeslut finns ännu.

Riktigt HTTP/PG-browserprov täcker offlineavprickning, reload/upplåsning,
servercommit följd av tappat svar, byteidentiskt retry utan dubblett,
avpricknings-DNS, målrättning med separat DNS-withdrawal och en sen negativ
rapport som inte ersätter återkomst. Testdata är syntetiska; fysisk mobil,
spärrad credentials återhämtning och auto-online-kapplöpningar är inte bevisade
av detta prov.
## TASK 006W: privat återhämtningsunderlag

En upplåst mobilkö kan nu exportera ett strikt manifest med endast scope-ID,
capability och pending-posternas request-id/sekvens/hash enligt ADR-0055.
Exporten ändrar inte kö, kvittenser eller krypterat arkiv och stänger skrivläge.
Den innehåller inte namn, lösenfras, credential eller operationernas innehåll.
Tom eller låst kö ger ingen export. Underlaget är privat och ger i sig ingen
behörighet. Administrativ serverutfärdning/spärrning och separat HTTP-leverans
finns nu, liksom mobilens explicita token-/kvittensflöde för återhämtning.
Originalkön måste därför bevaras även efter en lyckad manifestnedladdning.

Recovery använder samma ordnade receiptvalidering och durabla CAS-commit som
vanlig synk. Token finns bara i minnet under försöket; skrivläge och automatisk
synk stängs av. Låsning avbryter och sena svar får inte återöppna listan eller
kvittera lokalt. Efter omladdning/upplåsning kan samma giltiga token återanvändas
för exakt retry. Ingen rosterläsning sker: även lyckad recovery lämnar det gamla
underlaget tydligt daterat och ger inte fortsatt arbetsbehörighet. Syntetiskt
browserprov visar att token/lösenfras/namn saknas i plaintext i IDB, Web Storage
och appcache efter återföring; fysisk mobil/lagerutrymning är inte fältverifierad.
## TASK 006W: granskning ändrar inte offline-intents

ADR-0056 beslutar om en separat onlinegranskning, inte en ny lokal operations-
typ. Lokal historisk CONFLICT-kvittens får aldrig skrivas om till APPLIED eller
raderas. En framtida ny autentiserad rosterhämtning kan visa exakt vilka
rapporter som har granskats; recovery-token eller lokal reset får inte göra det.
Nya rosterfält ska begäras uttryckligen med reviewDetails=1 så äldre strikta
klienter fortfarande kan läsa standardroster. Äldre vault utan reviewmetadata
fortsätter att visa sin konflikt som ogranskad. Detta kontrakt är beslutat men
projektionen/klientkopplingen är nu implementerad. Ny mobilklient begär
reviewDetails=1; standardroster utelämnar fältet. Endast journalvaliderade,
scopebundna request-id läggs i underlaget. Lokal vy räknar granskade respektive
ogranskade historiska konflikter separat, men spelar aldrig upp en CONFLICT-
operation som genomförd. Krypterad roster bevarar metadata efter offline reload.
Gammalt underlag utan fältet behåller konservativ konfliktvisning. Riktig
browser/HTTP/PostgreSQL verifierar flödet och oförändrad originalhistorik.

## TASK 008: speaker är serverläsning, inte stationskö

ADR-0058 beslutar minnesburet underlag med tydlig lästid vid nätfel. Authfel,
logout och sessionexpiry ska dölja data och avbryta anrop; sent svar får inte
återöppna vyn. Ingen speakerdata lagras i Web Storage eller service worker.
Polling hämtar nya effektiva resultat även med oförändrad raceSnapshotVersion.
Signerade paket, SQLite/outbox, avprickningsvault och ingestkvittenser påverkas
inte. Första UI/klient finns nu med ett genomgående HTTP/PG-browserprov för
offline/återanslutning, authspärr och sent svar efter logout. Dold flik avbryter
pågående läsning; pagehide/bfcache döljer data och kräver ny inloggning.
Exakt sessionexpiry och dessa eventhandlers har nu separata browserprov,
inklusive ett redan pågående svar som aborteras och inte får återvisas.
Fliksynlighet och pagehide/pageshow är emulerade; verklig bfcache-inträde är
inte därmed bevisat. Ett riktigt DNS-återtagande syns dessutom genom automatisk
browserpoll trots oförändrad raceSnapshotVersion.

## TASK 013: PM är ett serverbundet dokumentflöde

ADR-0061:s PM-uppladdning/publicering kräver nät. En skickad fil är inte
kvitterad förrän objektmanifest och scanjobb är committade; pending scan är
inte godkänd eller publicerad fil. UI ska hålla exakt retryintent i minnet
vid okänt svar, inte skapa en ny beständig klientkö eller tyst ny publicering.
Privata dokument och metadata läggs inte i Web Storage eller appskalets cache.
Resultatmotor, avprickningsvault, stationspaket och befintliga kvittenser
ändras inte. Detta är beslutad gräns; PM-runtime är ännu inte implementerad.

## TASK026: textändring och stationspaket

Namn-/klubbrättning kräver server och ökar racesnapshot. Nytt signerat paket
innehåller rättad text; redan installerade paket, raw, outbox och kvittenser
bevaras. Gammal paketversion följer befintlig stale-policy. Framtida UI ska
hålla exakt same-id-retry endast i minnet, inte införa en ny offlinekö. Äldre
frysta startlistor/Complete-bytes förändras inte; ny publicering är ett separat
beslut. Ny finalisering följer fortsatt konservativ snapshotaktualitet och
kan kräva uttrycklig omräkning även efter textändring. Se ADR-0067.

## TASK029: gemensamt klass-/starttidsbyte

Transfer kräver server och sparar klass/starttid tillsammans med en ny
snapshot. Nytt signerat paket använder dessa uppgifter; installerade paket,
raw, outbox och kvittenser bevaras. Befintlig stale-package-policy gäller.
Klientens exakta retryintent hålls endast i minnet; detta är ingen ny
offlinekö. Tidigare resultat och frysta exporter ändras inte automatiskt.
Platsgräns kontrolleras vid servercommit enligt ADR-0070. Läst ledigt antal
är ingen reservation och ingen minutstartlucka utlovas. En ren gränsändring
ökar endast capacityVersion, inte racesnapshot eller stationspaketversion.
Även gränssättning kräver server; exakt retryintent hålls bara i minnet.

TASK030 ansluter brickbyte till samma onlinearbetsvy. Ny aktiv koppling ger
ny entry-/snapshotversion och används i nästa stationspaket. Installerade
paket, rådata, outbox och gamla kvittenser ändras inte. Exakt brickbytesretry
är minnesburet; ingen ny offlinekö. Logout/omladdning kräver kontroll av
aktuellt tillstånd om ett sparutfall var okänt. Se ADR-0071.

TASK031 kopplar befintlig individuell starttidsrättning till samma onlinevy.
Ingen ny lokal kö eller dold omräkning: ny snapshot används i nästa paket,
gamla paket/raw/resultat bevaras. Granskat tidsintent fryser presentationszon
och kan återförsökas exakt med samma aktör; byte av formulär är spärrat medan
utfallet är okänt. Se ADR-0072 och befintlig ADR-0039.

TASK032:s explicita omräkning kräver server och färskt kandidatunderlag, men
ändrar inte entry-/snapshotversion eller stationspaket. Ny teknisk revision
och requestjournal sparas atomiskt; gamla raw/outbox/kvittenser bevaras.
Okänt commitsvar behåller samma minnesintent för explicit retry. Manuella
beslut och frysta exporter påverkas inte av denna retry eller omräkning.

TASK033:s resultatremsa är senast läst serverkunskap med lästid, inte offline-
kvittens eller livebevakning. Den rensas före nytt försök och vid läsfel/byte/
logout. En lyckad mutationskvittens bevaras även om efterföljande resultat-
läsning misslyckas. Inga persondata eller resultat läggs i beständig klientcache.

TASK034 återanvänder namn-/klubbrättningens onlinekrav med samma adminsession.
Okänt svar fryser samma request i minnet; inga namn eller intents skrivs till
Web Storage. Ny snapshot innehåller rättad text, medan gamla stationspaket,
rådata, köer, kvittenser och frysta publiceringar bevaras enligt ADR-0067/0075.

TASK035:s direktanmälan återanvänder serverregistreringens snapshot/paketregel
och gemensamt minnesburet retryintent. Okänt svar får inte skapa en ny request
automatiskt. Skapad deltagare väljs först efter validerad kvittens; utebliven
efterläsning återtar inte registreringen. Ingen ny beständig offlinekö införs.

TASK036 kräver giltig kandidatsökning före ny registreringsgranskning, inte
före retry av redan skickat intent. Nätfel/stale svar är inte noll träffar.
Kandidater och checkbox är flyktigt granskningsunderlag, aldrig offlinebevis
eller global identitetsmatchning. Authfel/logout döljer panelen enligt samma
gemensamma operation/låslivscykel. Inga personuppgifter läggs i URL eller cache.

TASK039:s historiksidor kräver server och är inte offlineunderlag. Aktuell
sida rensas före läsning, vid deltagarbyte och auth/logout; fel ger ingen
gammal sidvy. Exklusiv deltagarversionsgräns hämtar äldre journaler, medan
explicit uppdatering börjar om. Rådata, signerade paket, outbox och befintliga
kvittenser ändras aldrig. Ingen ny beständig klientlagring tillkommer.

TASK040:s manuella DNS och återtagande är serverberoende beslut, inte mobilens
offlineavprickning. Exakt granskat intent finns bara i minnet och återförsöks
med samma request-id efter okänt svar. Efter kvittens bevaras sparad-status
även om efterläsningen misslyckas. Inga paket, raw/outbox eller tidigare
kvittenser ändras; återtagande är inget bevis på fysisk start eller återkomst.

TASK041:s DNF och återtagande kräver också server. Fryst intent och samma
idempotensnyckel finns i minnet för exakt retry, inte en beständig offlinekö.
Senare avläsning bevaras under aktivt DNF; återtagande binder den uttryckligen
granskade tekniska källan. Ingen raw/outbox/paketkvittens ändras. Ett DNF-beslut
är inte i sig bevis på fysisk återkomst från skogen.

TASK042:s diskvalificering och återtagande är serverberoende adminåtgärder.
Fryst intent och idempotensnyckel återanvänds efter okänt svar, men finns bara
i minnet. Senare offlineingest appendar teknik utan att upphäva aktiv DSQ.
Återtagande återställer exakt granskad källa i en ny revision. Ingen rådata,
outbox, paket eller stationskvittens ändras av adminintegrationen.

TASK044:s godkännande/återtagande kräver server och samma administratörssession.
Fryst intent återförsöks med exakt request-id efter okänt svar; bara minne,
ingen ny offlinekö. Senare tekniska avläsningar bevaras under aktivt manuellt
godkännande. Återtagandet binder granskad teknisk källa i ny revision och
ändrar inte stationens raw/outbox/paket eller kvittensprotokoll.

## TASK081: manuell bana och klass är serverförberedelse

Skapandet kräver server och befintlig `MANAGE_RACE`-session. Ett okänt
commitsvar behåller exakt request-id och intent i minnet för explicit retry;
det är ingen ny offlinekö. Efter en validerad kvittens är mutationen bekräftad
även om roster-efterläsningen misslyckas.

Ny bana, banversion och klass ökar racesnapshot exakt ett steg. Redan
installerade stationspaket, råmeddelanden, lokal outbox, kvittenser och
resultatrevisioner skrivs inte om. Stationen får den nya strukturen först i
nästa signerat paket och befintlig stale-package-policy gäller. Se ADR-0103.

## TASK082: omlänkad resultatfri klass använder nästa paket

En lyckad ADR-0104-mutation skapar en ny banversion och flyttar endast den
valda resultatfria manuella klassens aktuella CourseVersion-koppling. Den ökar
racesnapshot exakt ett steg. Redan installerade paket, råmeddelanden, lokal
outbox, kvittenser och lokal resultathistorik skrivs inte om; stationen ser
ändringen först i nästa signerade paket enligt den vanliga stale-package-
policyn. Finns någon resultatrevision blockeras skrivvägen, så den kan inte
ändra en stations eller servers historiska bedömning.

## TASK084: resultatbärande omlänkning skriver aldrig om stationen

ADR-0106:s hash-bundna omlänkning skapar bara nästa CourseVersion, ny
klasskoppling och ett nytt race-snapshot. Installerade stationspaket,
råmeddelanden, lokal outbox, kvittenser och lokala/serverbaserade
resultatrevisioner ändras inte. Stationen fortsätter bedöma med sitt redan
installerade paket tills den uttryckligen hämtar nästa signerade paket enligt
den vanliga stale-package-policyn. En eventuell ny serverrevision kräver alltid
den separata individuella omräkningen; banomlänkningen skickar ingen sådan
begäran och får inte fabricera ett lokalt eller centralt resultat.

## TASK104: PUNCH-starttid är serverberoende

Rättning av observerad starttid kräver server och `MANAGE_RACE`-session. Ett
okänt commitsvar behåller exakt request-id och granskat intent endast i minnet
för retry; ingen offlinekö, cache eller stationstransport införs. En lyckad
commit skriver varken råmeddelande, CardReadout, redan installerat paket eller
lokal stationshistorik. Den rättade revisionen blir synlig från central server
när vanliga läsprojektioner hämtas på nytt.

## TASK105: PUNCH-starträttning återtas endast på servern

Återtagandet är en `MANAGE_RACE`-servermutation med exakt request-id för
säker retry. Det går inte i stationens offlinekö och ändrar varken råtransport,
CardReadout, installerat paket eller lokal stationshistorik. En lyckad ny
revision syns först när klienter hämtar central projektion igen.

## TASK143: hyrbricksåteranvändning är serverberoende

ADR-0142:s återanvändning av en registrerat återlämnad hyrbricka kräver en
aktuell `MANAGE_RACE`-session, CSRF och samma serverlåsade rostergrund för
källa och mål. Det granskade intentet och dess idempotency-nyckel finns endast
i arbetsvyns minne; ett okänt svar får endast återförsökas med exakt samma
begäran och skapar ingen offlinekö eller lokal inventeringssanning.

En lyckad mutation höjer race-snapshot ett steg. Redan installerade paket,
råmeddelanden, lokal outbox, kvittenser och lokala bedömningar skrivs aldrig
om; stationen ser den nya aktiva brickkopplingen först efter vanlig hämtning av
ett nytt signerat paket. Källa och mål får inte behandlas som synkade bara för
att browsern har skickat begäran.

## TASK144: reuse-historik är en serverläst administrativ projektion

TASK144 använder ingen lokal journal eller offlinekö. Historikraden blir
synlig först när den privata administratörsvyn läser serverns bevarade
TASK143-journal genom den vanliga historievägen. Den ändrar inte stationpaket,
rawdata, lokal outbox, avprickning eller tidigare kvittenser.

## TASK159–160: kontoinbjudningar är enbart online

Betrott utfärdande, ägarutfärdande, status, spärr och mottagarens
kontoaktivering kräver den centrala servern. Browsern får hålla ett exakt
owner-issue-/revoke-intent och en ny engångskod endast i sidminnet för
okänd-commit-retry; den lagrar inte koden i URL, Web Storage, lokal kö,
stationspaket eller analytik. Efter omladdning kan koden inte återskapas:
aktiv OWNER ser bara icke-hemlig status och kan spärra pending kod innan
en ny utfärdas. A2:s separata ADMIN-grant är också serverberoende.
Stationsavläsning, start-/målkö, rawmeddelanden och idempotent synk
fortsätter oförändrat när kontoservern eller nätet är nere.

## TASK161: kontoåterställning är enbart online

Betrodd issue/status/spärr och mottagarens inlösen behöver central server.
Recoverykoden och det nya lösenordet finns endast i privat CLI-fil
respektive browserns tillfälliga sidminne; okänd commit får bara retry med
exakt samma begäran. Varken kod, hash, lösenord eller resetrequest läggs i
start-/målpersonalens cache, stationsoutbox, signerat paket eller GPS-kö.
När lösenordsrevisionen committas faller äldre konto-/race-sessioner vid
nästa serverkontroll. Stationsavläsning och offlinearbete förblir oförändrat.

## TASK162: privat ruttuppspelning är en skyddad onlineläsning

Det relativa uppspelningsunderlaget läses via samma kontoskyddade privata
overlay-API som kartan, med `no-store` och fortsatt aktuell anmälnings-
och versionskontroll. Detta snitt inför ingen offline-cache, uppladdningskö
eller lokal bevaring av koordinater på en annan användares enhet.
Stationernas råkö och deltagarappens ännu osynkade GPS-journal ändras inte.

## TASK163: publicerade sträcktider intill rutten är bara onlineläsning

Resultatets sträcktider läses `no-store` tillsammans med den skyddade
privata overlayen och kan ändras vid en senare explicit resultatrevision.
Varken browsern, stationspaketet eller GPS-journalen får spara dem som
auktoritativ offlinekälla. Vid nät-/authfel visas ingen kvarhängande privat
resultatlista från en tidigare anmälan.

## TASK164: manuell GPX-klockjustering är inte synkdata

Den signerade sekundojusteringen är endast tillfälligt sidtillstånd och
nollställs när rutt-/kontext-/resultatrevision byts. Den lagras inte i
browsercache, URL, stationspaket, GPS-journal eller server. Skyddad läsning
av aktuell resultatstart kräver onlinekonto som TASK162–163; ett nätfel får
inte visa ett tidigare kontos startankare.

## TASK165: valt kontrolltidsläge stannar på den lästa sidan

Kontrolltidsvalet och GPX-hoppet är tillfälligt sidtillstånd på samma
`no-store`-skyddade privata läsning som TASK164. De får inte sparas i
URL, cache, stationspaket, GPS-journal eller serverns resultat. Vid ny
overlay, förlorad behörighet eller läsfel ska inget tidigare kontos
kontrolltid kunna användas som aktuell källa. Ingen offlinefunktion
utlovas av detta efterloppssnitt.

## TASK185: privata adminläsningar och synlig speakerpolling

Banöversikt, personresultat och administratörsspeaker kräver serverkontakt
och befintlig adminsession. De lagras inte beständigt i browsern och är inte
en ny offlinefunktion. Speaker läses var femte sekund endast när fliken
är monterad och dokumentet synligt. Begäran avbryts vid byte/dold sida,
har 15 sekunders timeout och överlappar inte nästa läsning. Nätfel markerar
senaste underlaget som gammalt; 401/403 rensar det. Kvar-i-skogen-läsning
kan hämtas vid inträde till lägesbilden men är fortfarande bara sist
synkroniserad kunskap, aldrig bevis för mobilernas osynkade rapporter.
