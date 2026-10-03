# ADR-0160: tekniskt skrivstopp vid installationsgränsen

- Status: Accepterad som målgräns för TASK180; ingen driftimplementation eller
  acceptans är därmed godkänd
- Datum: 2026-09-23

## Kontext

ADR-0140 kräver att alla O-Tid-writers stoppas och pågående writes avslutas
före dump och källpreflight. Dess `writeStopConfirmed` är uttryckligen ett
operatörsintygande, inte ett tekniskt lås. TASK171–179 har endast syntetiskt
verifierat backup-/restorekedjan **efter** detta antagande.

Nuvarande webbserver har en gemensam `createDatabase(DATABASE_URL)`-pool, men
muterande HTTP-flöden omfattar tävling, ingest, konto/session och uppladdning.
Uppladdning kan skriva till privat objektlagring mellan två DB-transaktioner.
Betrodda `scripts/*` startar dessutom egna DB-pooler; `apps/worker` är ännu en
placeholder. Befintliga rad-/race-/requestlås är inte ett gemensamt
installationslås. Lokal Compose startar bara Postgres och MinIO; inget i
repositoryt styr eller inventerar ännu alla webb-/CLI-processer vid stopp.

## Beslut

1. För TASK180 väljs en **synlig installations-/processgräns**, inte ett nytt
   dolt advisory lock eller en flagga i enstaka routes. En betrodd controller
   för en uttryckligen avgränsad installation ska kunna stänga ny ingress,
   avaktivera omstart/schemaläggning av **alla** server-writers, dränera
   redan pågående webb-/worker-/CLI-operationer inklusive objektlagringssteg
   och därefter bevisa att inga writer-processer eller writer-DB-sessioner
   återstår. Controller och backupens läsande process har skilda roller.
2. Stoppet är installationstäckande. Det omfattar HTTP-ingest, admin- och
   deltagarmutationer, login/session-sidoeffekter, privata uppladdningar,
   bakgrundsjobb, betrodda CLI-skrivare och migrationer. En kort katalog över
   **faktiskt tillåtna** processer, deras identitet, DB-principal och sätt att
   startas måste finnas för vald installation. En okänd writer eller en
   oinventerad direkt DB-/MinIO-credential gör stoppbeviset ogiltigt. Den
   lokala Compose-filens delade `otid`-databasanvändare och MinIO-rootnycklar
   är utvecklingsunderlag, inte bevis för avskilda produktionswriters.
3. Stopp är ett varaktigt, observerbart tillstånd som sätts **före** dränering.
   Förlorad controller, timeout eller processomstart får inte återöppna
   ingress/writers. Först när nya writes inte kan starta, alla pågående
   operationer är färdiga och writer-DB-sessioner/aktiva transaktioner är
   noll får ett separat tekniskt stoppbevis bindas till backup-id och den
   valda källinstallationen. Ett ensamt `pg_stat_activity`-ögonblick eller en
   processlista är aldrig ett admission-bevis utan den hållna controller-
   spärren.
4. Ingen läsbar offentlig webbtjänst garanteras under denna första
   installationstäckande paus. Läsning får fortsätta endast om den uttryckligen
   ingår i den bevisade controller-profilen utan sidoeffekter. Androidstationens
   och startpersonalens lokala offlineköer får fortsatt lagra lokalt; deras
   serversynk väntar tills webb/ingress öppnas igen. UI måste skilja lokalt
   lagrat från serverkvitterat efter avbrottet.
5. Återöppning är en separat avsiktlig operatörsåtgärd **efter** att ADR-0140:s
   replikeringsregler bevisligen är rensade eller ett misslyckat försök har
   hanterats enligt dess fail-closed-rutin. TASK180 får endast prova lokal
   stoppa/dränera/återöppna-semantik utan aktiv replikeringsregel; den får
   inte utfärda produktionsmässig writer-release.
6. Den befintliga `writeStopConfirmed`-strukturen får inte räknas som teknisk
   evidens eller automatiskt uppgraderas av ett grönt syntetiskt test. En
   senare operatörsåtgärd måste konsumera ett verifierbart, färskt stoppbevis
   från den controller som faktiskt äger ingress och writer-processer.

## Verifieringsgrind

Första valda implementeringsprofil är **en dedikerad Linux-installation med
systemd som processansvarig**, inte dagens lokala Compose eller ett nytt
mikrotjänstlager. En avgränsad serviceidentitet och separat writer-DB-principal
ska användas av den enda tillåtna webbprocessgruppen samt eventuella worker-
och betrodda CLI-/migrationsenheter. En betrodd controller äger ett beständigt
stoppbeslut, stänger ny HTTP-ingress, hindrar alla deklarerade writer-enheter
från omstart, väntar tills deras processer/hela pågående anrop är avslutade
och kontrollerar därefter writer-DB-sessioner. Backupens läsande process har
separat credential och får inte starta en writer. Om en process utanför denna
supervisor kan behålla en skrivcredential kan profilen **inte** godkännas;
ett ögonblicksprov kan inte avslöja en sådan framtida start.
Root/OS-administratör och lagringsadministratör är uttryckliga
förtroendegränser; de kan inte spärras av en O-Tid-process.

Beslutet i sig levererar ingen controller eller credentialrestriktion.
TASK192 har senare lagt icke aktiverade exempelenheter och en startgrind,
men ingen installations- eller dräneringsacceptans. Det är alltså **inte**
ett tekniskt stoppbevis.

### Avslutningskälla före process-stopp (2026-09-27)

Den pinnade Next 16.3.3-standalone-servern försöker vid SIGTERM vänta ut
öppna HTTP-svar, men TASK180 har ännu inget bevis för anrop vars klient
kopplar ned medan serverarbete fortsätter. HTTP-proxyn ser bara insläppet;
den kan inte intyga avslutet. `systemctl stop`, tom cgroup eller noll
DB-sessioner får därför **inte** ensamma användas som dräneringsbevis.
Innan en controller stoppar webben som ett säkert skrivstopp måste ett
syntetiskt blockerat objektsteg och ett klientavbrott provas mot den
faktiska standalone-processen på Linux. Om SIGTERM-vägen inte klarar det
krävs ett nytt ADR-beslut för process-/ingresslösningen; en egen Next-server
kan inte läggas till tyst eftersom `standalone` och custom server inte
stöds tillsammans. Se
[källgranskningen](../research/next-standalone-writer-drain.md).

### Inkrementellt HTTP-insläpp i den valda profilen (2026-09-25)

Första kodsteget under TASK180 får lägga ett enda, installationsstyrt
HTTP-insläpp före alla Next-rutter, även läsningar, statiska resurser och
server actions. I `systemd-v1`-profilen pekar miljön på en absolut sökväg
under en betrodd, beständig controllerkatalog. Controller ska skapa och
synkronisera en spärrmarkör **före** dränering; markörens närvaro eller
osäker/otillgänglig katalog nekar anrop. Endast säkert konstaterad frånvaro
av markören i den kända katalogen tillåter insläpp. Ett anrop som redan
passerat grinden före markören är pågående arbete och måste dräneras helt.
Profilen får inte ha undantag för `GET`: vissa läsvägar har sessionsbiverkningar
och ADR:ns första profil lovar inte publik läsning under stopp.

Utan någon profil- eller markörkonfiguration är den befintliga utvecklings-/
testinstallationen oförändrat **omanagerad**. Felaktig eller ofullständig
profilkonfiguration, inklusive en ensam markörsökväg, ska däremot stängas.
Markörkatalogen måste finnas i förväg, vara en verklig katalog och inte vara
skrivbar av grupp/andra; installeraren måste dessutom verifiera dess ägare
och att webbidentiteten inte kan ändra markören. En sådan HTTP-grind är bara
ett tidigt delsteg:
controller, systemd-enheter, credentialägande, CLI-/migrationsinsläpp,
process-/objektdränering, sessionskontroll och tekniskt bevis återstår.
En grön routekontroll får aldrig användas som `writeStopConfirmed`.

Med isolerad syntetisk
PostgreSQL/PostGIS och privat objektlagring ska ett test visa: en pågående
mutation inklusive objektsteg dräneras före bevis; en ny mutation/CLI-start
stoppas efter att stopp inletts; krascher/omstarter behåller stoppet; läsning
är antingen uttryckligen tillåten och verifierad eller avstängd; release är
explicit. En separat sessionskontroll efter dränering ska visa noll
writer-sessioner. Täckningsmatrisen ska omfatta varje writer-klass i beslut 2.
Acceptansen måste köras mot faktiska systemd-enheter i en disponibel Linux-
miljö. Källkodens enhetstester eller en processimitation på macOS räcker inte.

Om vald driftprofil inte kan hindra **nya** writer-processer och nya
DB-/objektlagringsanslutningar medan backupen pågår, finns inget godkänt
tekniskt skrivstopp. Då stannar TASK180 vid ADR/inventering och D1b.4 kan
inte markeras operativt färdig. Ingen mängd riktade route-tester får ersätta
denna installationsgrind.

### Icke aktiverad startprofil för nästa delsteg (2026-09-25)

För att göra processgränsen konkret utan att påstå ett färdigt stopp införs
en enda startkontroll för systemd-ägda writers. Ett startförsök kräver
`systemd-v1`, den installerade beständiga markörsökvägen och en katalogkedja
som är verkliga root-ägda kataloger utan grupp-/världsskrivrätt. Finns
markören, saknas katalogen eller är kontrollen osäker får processen inte läsa
sin writer-credential eller starta målkommandot. En andra kontroll görs
omedelbart före `exec`; redan passerade starter är fortfarande pågående
arbete som controllern måste dränera.

Första exempelenheterna deklarerar webb och migration som fasta systemd-
kommandon under särskild writer-identitet. Hemligheter levereras via
`LoadCredential=` och läses av en liten launcher innan den ersätter sig
med målprocessen; de läggs inte i unittext eller argument. Samma mönster
krävs för **varje** tillåten betrodd CLI. Inga exempelenheter får aktiveras
eller användas som stoppbevis förrän alla tillåtna writers och direktåtkomst
till DB-/objektcredentials är inventerade och spärrade i vald installation.
Ingen ny tjänst, domänstatus eller databasmigration införs av detta delsteg.

## Konsekvenser och avvisade alternativ

### Fast speaker-spärrning som första CLI-exempel (2026-09-27)

TASK193 får lägga **en** icke aktiverad oneshot-enhet för idempotent
`VIEW_SPEAKER_BOARD`-spärrning. Den får inte vara en generell CLI-enhet och
får inte utfärda credentialer. Begäran läses som privat systemd-credential,
resultatet skrivs till en ny privat fil före/efter en enda DB-transaktion,
och stdout/stderr får inte kopplas till journalen. Enheten använder samma
beständiga stoppmarkör och launcher som webb/migration. Detta konkretiserar
beslutet ovan men varken dränerar redan påbörjat arbete eller bevisar att
direkt DB-credentialåtkomst saknas. Installation och Linux-acceptans återstår.

### Beständig stängning före dränering (2026-09-27)

TASK194 får implementera endast controllerns första irreversibla steg:
root skapar den exakta, tomma markören med exklusivt filskapande och synkar
fil samt katalog innan den rapporterar att **insläppet** är stängt. En
befintlig giltig markör får bekräftas utan överskrivning; osäker katalog
eller markör ger fel och lämnas stängd/okänd. Ingen release körs vid fel,
processavslut eller omstart. Detta är inte hela controllern: varken pågående
operationer, objektsteg, cgroups, writer-DB-sessioner eller direktåtkomst
till credentials kontrolleras av markören. Ingen teknisk stoppkvittens eller
`writeStopConfirmed` får härledas från TASK194.

### Samma fasta markör även för HTTP (2026-09-27)

TASK195 skärper den tidigare HTTP-grinden till den redan beslutade
`systemd-v1`-startprofilens exakta `/var/lib/o-tid/controller/closed`.
Webbprocessen får bara släppa igenom på Linux när varje katalog i kedjan
är en verklig root-ägd, inte grupp-/världsskrivbar katalog och markören
säkert saknas. Katalogkedjan kontrolleras igen efter markörens frånvaro och
förälderns enhets-/inodeidentitet måste vara oförändrad. Annan sökväg,
plattform, markörnärvaro eller osäker läsning stänger. Helt omanagerad
utveckling utan någon av profilvariablerna behålls, men ingen testbakdörr
införs i den styrda profilen. Ett Mac-test med temporär markör kan därefter
endast bevisa fail-closed HTTP; öppen HTTP under den pinnade profilen kräver
Linux-acceptans. Detta är inte dränering eller ett tekniskt stoppbevis.

En kort avsiktlig paus i publika och administrativa servervyer accepteras
hellre än en skenbart tillgänglig men inkonsistent backup. Ingen ny tjänst,
domänstatus, migration, resultatregel eller dependency införs av **detta
beslut**. En konkret controller/deploymentändring får egen liten
implementation och riktad acceptans före driftanspråk.

- Endast `writeStopConfirmed`: mänskligt intygande utan teknisk admission.
- Global advisory lock i några application-transaktioner: betrodda CLI,
  andra DB-skrivningar och objektlagringssteg deltar inte automatiskt.
- Endast stoppad HTTP-ingress: redan pågående uppladdning och separat CLI kan
  fortfarande skriva.
- Endast noll DB-sessioner vid en tidpunkt: en ny process kan ansluta senare.
- Låsa tabeller under dump: täcker inte MinIO-skrivningar eller nya
  processer och ändrar inte kravet på ett helt writer-stopp.
