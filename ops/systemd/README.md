# O-Tid writer-start, endast exempelfiler

Denna katalog är ett delsteg i [TASK180](../../TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md),
inte en körklar eller accepterad Linux-installation. Installera eller aktivera
**inte** `.service.example`-filerna i demo eller produktion; TASK214 förbereder
endast en icke aktiverande filinstallation för en senare isolerad Linuxacceptans.
Ingen fullständig controller, dränering,
sessionskontroll, återöppning eller backupkvittens ingår.

[TASK213](../../TASK_213_WRITER_PROFILE_PREFLIGHT.md) lägger en Linux-/root-
bunden, läsande fail-closed preflight ovanpå den deklarerade profilen. Den
installerar, aktiverar eller startar ingenting och dess syntetiska tester läser
inte verkliga `/etc`, `/opt` eller credentials. Även ett framtida grönt utfall
på Linux är endast en ögonblicksbild, inte fysisk systemd-/credentialisolering,
dränering eller ett tekniskt stoppbevis.

[TASK214](../../TASK_214_NONACTIVATING_WRITER_PROFILE_INSTALL.md) förbereder en
separat Linux-/rootbunden installerare för exakt de tre granskade enheterna.
Den kräver en redan giltig stängd markör, förprovisionerade privata källfiler,
`otid-writer` och en strikt icke-hemlig `writer-config` med samtliga elva
kanoniskt validerade värden. Körning kräver exakt
`--confirm install-closed-systemd-v1-writer-profile`. Den laddar aldrig om
systemd och aktiverar, startar, stoppar eller restartar aldrig en unit. En
delinstallation lämnas synlig för granskning; ingen
automatisk rollback eller öppning görs. Koden är endast syntetiskt provad och
är inte Linux-/systemd-acceptans eller ett tekniskt stoppbevis.

[TASK224](../../TASK_224_LOADED_WRITER_PROFILE_PREFLIGHT.md) lägger en andra,
helt läsande kontroll av systemds **laddade** tre writer-enheter ovanpå
TASK213:s filpreflight. Den jämför managerinventering, kanonisk fragmentväg,
avsaknad av drop-ins/reloadbehov och valda effektiva start-, identitets-,
markör- och credentialegenskaper. Den gör ingen `daemon-reload`, aktivering
eller credentialläsning. Endast injicerade kommandosvar har provats på Mac;
systemds verkliga textformat och hela processgränsen måste fortfarande
verifieras på disponibel Linux. Även grönt utfall är `NOT_ACCEPTED`.

[TASK194](../../TASK_194_DURABLE_WRITER_ADMISSION_CLOSE.md) har en separat
root-/Linux-bunden, ännu ej driftaccepterad `close-writer-admission.mjs` som
skapar den exakta beständiga markören med exklusivt 0600-skapande och
fil-/katalogsynk. Det är bara stängning av **nytt insläpp**. Den stoppar
ingen unit, väntar inte på pågående arbete och får inte tolkas som ett
tekniskt skrivstopp. Markören tas aldrig bort av detta kommando.

[TASK196](../../TASK_196_LINUX_ADMISSION_ACCEPTANCE_FIXTURE.md) har en
separat, syntetisk oneshot-fixture under `fixtures/` och ett protokoll för
senare prov i en disponibel Linux-VM. Fixturen är inte installerad, inte
en fjärde tillåten produktionswriter och får inte aktiveras på en verklig
O-Tid-installation. Inget Linux/systemd-prov har ännu körts.

## Deklarerad första profil

| Writer | Startväg i exemplet | Credential | Status |
| --- | --- | --- | --- |
| Next standalone-webb | `otid-web.service.example` → `writer-start.sh` | separat DB-writer samt privata map/route/Eventor/signering där funktionen används | endast mall |
| Databasmigration | `otid-db-migrate.service.example` → samma launcher | separat DB-writer | endast mall |
| Speaker-spärrning | `otid-speaker-revoke.service.example` → samma launcher, fast revoke-only-kommando | DB-writer och privat JSON-begäran via separata credentials | endast mall; inte installerad |
| Övriga betrodda `scripts/*.ts` | ingen godkänd unit; 40 filer öppnar egna DB-pooler via 77 deklarerade CLI-kommandon totalt | ingen annan CLI får installationens writer-credential ännu | **förbjudna i profilen** |
| `db:seed` | separat `packages/application/src/seed.ts`, skriver demo-/importdata | ingen credential eller produktionsstart | **förbjuden i profilen** |
| `apps/worker` | ännu endast placeholder, ingen writer-unit | inga writer-credentials ska ges | **öppet vid aktivering** |
| Externa DB-/MinIO-klienter | ingen | inga oinventerade writer-credentials får finnas | **måste granskas per installation** |

`writer-inventory.test.mjs` håller listan över de 40 självständiga DB-CLI-
filerna i takt med källkoden och kontrollerar att bara webb, migration och
den fasta speaker-spärrningen har exempelenheter med samma markör. Detta är en driftspärr för **granskning**, inte
ett skydd mot direktstart med en redan åtkomlig DB-credential. Även
`demo:access:copy` saknar DB-pool men behandlar hemligt demomanifest och är
inte en server-writer i denna profil. `db:seed` är en separat verklig DB-
writer som inte får räknas bort bara för att den ligger utanför `scripts/`.

Många `issue`-/`rotate`-/återställningskommandon skriver nya bearerhemligheter
till stdout. En generell systemd-CLI-enhet skulle journalföra dem som
standard. Ingen sådan enhet får därför aktiveras. [TASK193](../../TASK_193_FIXED_SPEAKER_REVOKE_START.md)
har endast ett fast, idempotent revoke-kommando. Begäran kommer från en
privat credentialfil, kvittensen reserveras som ny 0600-fil i
`/var/lib/o-tid-private-cli-results` (0700), och stdout/stderr kastas bort.
Operatören får bara lita på kvittensen efter lyckad unit-exit. Samma begäran
kan retryas avsiktligt med ett nytt `INVOCATION_ID`; inget befintligt resultat
skrivs över. Requestkällan under `/etc/o-tid/cli-requests` ska ägas av root,
vara privat och provisioneras separat från unitfilen; den får inte ändras av
`otid-writer`. Resultatkatalogen är en syskonkatalog till stoppmarkörens
root-ägda `/var/lib/o-tid`, så systemds katalogägande inte kan byta ägare på
controllerkedjan. Kvittensfilen är bara läsbar för samma UID som writern och
är inte ett bevis för least-privilege gentemot annan kod med samma UID.
Inget `issue` eller annat CLI-kommando är därmed godkänt. Varje framtida
tillåten CLI-start kräver samma fasta granskning. CLI-förbudet omfattar också ett startförsök under en stängd markör;
enbart launcherns två kontroller kan inte dränera ett redan påbörjat kommando.

Profilen förutsätter exakt `/var/lib/o-tid/controller/closed` som beständig
markör. Hela katalogkedjan ska vara verkliga root-ägda kataloger utan
grupp-/världsskrivrätt; den dedikerade `otid-writer`-identiteten får inte
kunna skapa, ta bort eller döpa om markören. En betrodd controller måste
skapa och synkronisera den **innan** dränering. Både webbens HTTP-grind och
samtliga writer-enheter måste peka på **samma** sökväg. Ett tidigare
startförsök kan redan vara i gång när markören skrivs; startgrinden är därför
inte ett stoppbevis.

`writer-start.sh` kontrollerar markören före credential-läsning och igen
precis före `exec`, sedan ersätter målprocessen shellens PID. Den kräver
`CREDENTIALS_DIRECTORY` från systemd och en icke-tom `database-url`.
Valfria credentialnamn för map/route/Eventor/signering mappas till befintliga
servermiljövariabler; saknad valfri fil rensar motsvarande ambient variabel,
medan en tom eller oläsbar befintlig fil nekar start. Inga credentials hör
hemma i `Environment=`, `EnvironmentFile=`, argument eller journal.
Webbenhetens exempel laddar **alla** uppräknade credentials och startar inte
om någon källfil saknas. En riktig installation får bara ta bort en sådan
rad efter att motsvarande funktion och credentialbehov dokumenterats som
avstängt; launcherns valfria mappning är inte ett installationsbeslut.
`writer-config` i webbexemplet får bara ha icke-hemliga värden såsom
objektstore-ID, endpoint, bucket, region och publik origin. `LoadCredential=`
får bara peka på privata, provisionerade källfiler. Systemd levererar dessa
som filer under `$CREDENTIALS_DIRECTORY`; se
[systemds egen credentialbeskrivning](https://systemd.io/CREDENTIALS/).
Eftersom nuvarande webb/CLI läser miljövariabler gör launchern en övergång
från credentialfil till processmiljö. Det är en kvarvarande exponeringsyta
för kod med samma process-/servicebehörighet, inte ett bevis för färdig
least-privilege. Exempelenheterna anger `PrivateMounts=true`, men faktisk
isolation av credentials måste prövas på Linux.

En verklig Linux-installation måste först låsa fast Node/pnpm-/releasevägar,
ägare, filrättigheter, DB-principal, privata bucketbegränsningar och alla
tillåtna CLI-starter. De nuvarande Compose-nycklarna är utvecklingsnycklar,
inte denna profil. Webbmallen hindrar automatisk omstart efter grindens
exitkod 78; senare start kräver ett explicit controllerbeslut. Unitfilerna behöver provas
med `systemd-analyze verify` och riktiga process-/credentialprov på Linux;
denna Mac-värd kan inte göra det. En ny writer får inte bli driftgodkänd bara
genom att lägga till en unit: controllerinventering, faktisk utestängning av
direkt credentialåtkomst och TASK180:s negativa samtidighetsprov återstår.
