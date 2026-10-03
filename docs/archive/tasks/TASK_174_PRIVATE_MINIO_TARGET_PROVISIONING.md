# TASK174: ny privat MinIO-målmiljö med återstartsbar bindning

Status: avgränsat lokalt syntetiskt verifierad 2026-09-23; ingen operativ backup
eller produktions-/fältacceptans.

## Användarutfall

En betrodd backupåtgärd ska kunna skapa **ett nytt exklusivt mål per backup-id**
och efter ett processavbrott återfinna exakt samma mål och bucketbindningar.
TASK173:s läsande kontroll ska få sin färskhets-/målidentitet från detta
skapande, inte från en fristående boolesk operatörsuppgift. Utfallet är
fortfarande bara ett förberett mål, aldrig en backupkvittens.

## Arkitekturgräns

ADR-0140 har redan beslutat om en ny, tom, privat och versionerad MinIO-
målmiljö per backup-id samt en separat privat återhämtningsfil. TASK174
väljer inte en ny lagringstjänst eller ändrar domängräns. Det första
genomgående kompatibilitetsprovet får använda den redan hashpinnade lokala
MinIO-binären och en ny privat katalog på loopback. Detta är **inte** ett
godkännande av produktionsprocess, TLS, host-isolering eller fältbackup.

## Minsta vertikala snitt

1. En betrodd provisionerare får endast skapa under en uttryckligen vald,
   kanonisk, ägarägd privat 0700-katalog utanför repository. Den reserverar
   ett nytt backup-id/target-id med exklusiv fil-/katalogskapning; en redan
   existerande miljö får aldrig adopteras som ny. Den skapar ett eget tomt
   MinIO-dataområde och enbart exakt de avsedda privata bucketsen med aktiv
   versionering. Ingen källa eller produktionsmiljö får väljas implicit.
2. Före målstart eller annan fjärrändring skrivs en separat privat 0600-
   bindning atomärt och synkat. Den innehåller backup-id, target-id,
   provisioneringsidentitet/dataområdets filidentitet, manifesthash,
   kanonisk endpoint, sorterad `storeId`→käll-/mål-bucketbindning och en
   uttrycklig referens till **separat** privat credentialkälla. Själva
   credentialen, API-nycklar och PM-nycklar får inte stå i bindning,
   operation-state, manifest, kvittens, argv eller logg.
   Den privata credentialfilens filidentitet och SHA-256 för de syntetiskt
   genererade bytesen binds däremot i samma 0600-underlag, så en ny 0600-
   fil på samma sökväg inte kan bytas in tyst vid återstart. Digesten är
   inte en credential och får aldrig lämna den privata återhämtningsgränsen.
3. Återläsning måste verifiera filägare/läge, katalognärhet, format,
   backup-id/hash, unika target-/store-id:n, dataområdets filidentitet och
   samma endpoint/buckets före TASK173. Saknad, trasig eller ändrad
   bindning ger stopp; den får inte ersättas med en ny miljö under samma
   backup-id. Credentials löses endast från den explicita privata källan.
4. Den betrodda adapter som själv startade just det nya dataområdet lämnar
   bindningen till TASK173. TASK173:s nuvarande punkt-i-tid-kontroll av
   exakta buckets, versionering och tom historik körs på **återläst**
   bindning. Ingen osignerad/fristående `freshlyProvisioned: true` från en
   anropare får räknas som operativt färskhetsbevis.

För det första opt-in-snittet är adaptern en **pinnad lokal loopback-MinIO**,
inte Compose-/produktionsorkestrering. Den väljer lediga 127.0.0.1-portar och
binder API-endpointen i den privata återhämtningsfilen, skapar ett exklusivt
backup-id-reservationsnamn innan den läser
andra bindningar, skapar ett nytt direkt dataområde och en separat privat
0600-credentialfil med syntetiskt genererade värden, skriver bindningen
före processstart och startar endast den hashverifierade binären mot just
det dataområdet. Secrets skickas bara i barnprocessens miljö och till
MinIO-klienten. Efter stopp läser en ny adapter bindning/credentialfil från
disk och startar **samma** dataområde; är endpointen redan upptagen får den
inte adoptera processen. Misslyckad provisionering lämnar reservation och
privat underlag för avsiktlig felsökning, inte ett nytt försök under samma
backup-id. Inga filer raderas automatiskt av den betrodda adaptern.

Om processen dör **efter bindning men före första målstart** får återstarten
slutföra bucketinitiering endast när det bundna dataområdet bevisligen ännu
är tomt och samma privata credentialfil finns kvar. Efter första godkända
TASK173-readiness behöver en privat, write-once initieringsmarkör skilja det
tillståndet från en senare tömd eller ändrad målmiljö. Då får återstart bara
verifiera det befintliga målet; den får inte tyst skapa ett nytt tomt mål under
samma backup-id. Om partiell initiering inte kan bevisas säker gäller stopp
och ett nytt backup-id enligt ADR-0140, inte automatisk reparation.

## Acceptans

- Ett opt-in-prov använder en ny lokal pinnad MinIO-instans, syntetiska
  credentials och samma TASK172-källbevis. Bindningen läses i ett nytt
  process-/adapterobjekt före TASK173 och samma target-id/hash/store-id:n
  återkommer; ingen regel, resync eller kvittens skapas.
- Återanvänt backup-id/target-id, befintlig eller förorenad katalog,
  symlink/hardlink, fel filägare/läge, utbytt endpoint/dataområde,
  saknad/ändrad credentialreferens och fel manifest/store/bucket avvisas.
  Utbytt credentialfil med samma referens och giltiga men andra hemliga
  bytes måste också avvisas före processstart.
  Testerna använder endast egna temporära mål och syntetiska data.
- Riktad lint, typecheck, små tester och build för berörda paket. Ingen
  bred workspace-svit eller verklig tävling.
- Ett separat opt-in-kraschprov dödar endast sin egen syntetiska worker vid
  deterministiska punkter: efter exklusiv reservation men före bindning,
  samt efter synkad bindning men före målstart. Före bindning är samma
  backup-id förbrukat och både resume och ny provisionering avvisas; efter
  bindning får resume bara använda det exakta oförändrade dataområdet och
  den bundna credentialfilen. En kvarlevande endpoint efter workeravbrott
  får aldrig adopteras. Provet kontrollerar exakt egen barnprocess innan
  den stoppas och lämnar ingen regel, resync eller kvittens.

## Ingår inte

Produktionsorkestrering eller generell MinIO-installation, distribution av
credentials, tekniskt skrivlås, replikeringsregel, resync, cleanup,
backupkvittens, restore-CLI, internet-/fältacceptans, Eventor, GPS,
SPORTident/USB eller andra tävlingsfunktioner. En lyckad lokal körning
gör inte hela D1b.4 eller TASK099 operativ.

## Delutfall 2026-09-23

`packages/infrastructure` kan nu skriva en separat 0600-bindning atomärt och
write-once i en kontrollerad 0700-katalog utanför repository samt läsa om
den efter ett nytt adapterobjekt. Den validerar backup-id, manifesthash,
target-id, canonical endpoint, sorterade unika store-/bucketpar,
credentialreferens utan hemlighet och dataområdets sökväg/filidentitet.
Återanvänt target-id eller dataområde bland tidigare bindningar, ändrat
dataområde, symlink/hardlink och osäkra filrättigheter avvisas.

Riktat test: **4/4**, exit 0. Infrastructure lint, typecheck och build:
exit 0 var för sig. Testet använder endast tillfälliga privata kataloger
och syntetiska uppgifter; ingen MinIO-instans eller credential användes.

Bindningen **ensam** är inte ett färskhets- eller exklusivitetsbevis:
dess fält kan fortfarande tillhandahållas av en annan anropare.

En separat betrodd, darwin-arm64-begränsad loopback-provisionerare skapar
nu ett exklusivt backup-id-reservationsnamn och nytt eget 0700-dataområde,
skriver syntetiskt genererade credentials enbart till en separat 0600-fil,
kontrollerar den pinnade MinIO-binärens SHA-256 och skriver/återläser
bindningen **före** processstart. Den startar enbart sitt eget barn,
skapar/versionerar de avsedda bucketsen och kör TASK173 på den återlästa
bindningen. En återstartsoperation läser samma privata underlag och
avvisar upptagen endpoint, osäker credentialfil och förorenat mål.
Provisioneraren startar ingen regel/resync och utfärdar ingen kvittens.

Riktade standardprov: **6/6 passerade, ett opt-in-fall avsiktligt hoppat
över**; separat opt-in med riktig hashpinnad lokal MinIO: **3/3**, exit 0.
Infrastructure lint, typecheck och build gav var för sig exit 0 efter
sista ändringen. Det isolerade provet täckte nyprovisionering,
TASK173-kontroll, kontrollerat stopp/återstart med samma target-id,
upptagen endpoint, osäker credentialfil och syntetiskt förorenad bucket.
Processfrånvaro kontrollerades dessutom med `pgrep`; inga matchande
MinIO-processer fanns efter proven. Endast de exakt identifierade 20
syntetiska privata testkatalogerna rensades och bekräftades frånvarande;
deras data/credentials kan inte återställas. Inga verkliga tävlingar,
produktionscredentials eller Eventoranrop användes.

Ett separat explicit opt-in-läge i TASK170:s härva har därefter kört
**verklig TASK172-source-capture** med privat state och PostgreSQL17-dump,
syntetiska historiska PM-versioner i pinnad MinIO-källa och därefter
provisionerarens **enda** nya mål. TASK173 gav samma backup-id, manifesthash,
target-id och store-id som den återlästa bindningen. Läget körde ingen
replikeringsregel, resync, restore eller backupkvittens: **exit 0**.
Det äldre TASK170-kompositprovet kördes separat efter härvans uppdelning
och gav också **exit 0**, inklusive versionsbevarande resync/cleanup och
syntetisk PostgreSQL-/PM-restore i dess eget isolerade mål. Fyra exakt
skapade testdatabaser hade noll anslutningar vid städning, togs bort och
bekräftades frånvarande; det nya source-only-provets två privata MinIO-
kataloger och regressionsprovets tre kataloger kontrollerades efter
processstopp, togs bort och bekräftades frånvarande. Äldre testkataloger
från andra körningar lämnades orörda.

Vid detta delutfall var TASK174 **inte fullt stängd**: provet visar kontrollerat stopp/
återstart men inte abrupt processkrasch före/efter bindning. Lokal macOS-
loopback är inte produktions-TLS eller host-/containerisolering. Nästa
minsta del är den avgränsade krasch-/reservationacceptansen med samma
syntetiska mål, fortfarande utan ny regel, resync eller kvittens.

En efterföljande avgränsad hårdning ändrar den privata bindningens format till
v2 och binder credentialfilens `dev`/`ino` samt SHA-256 över exakt filinnehåll.
En giltig men utbytt 0600-fil på samma sökväg avvisas före processstart;
en kvarlämnad reservation utan bindning får varken återupptas eller provisioneras
om under samma backup-id. Äldre v1-bindningar avvisas avsiktligt; TASK174 har
ännu bara syntetiska, privata testmål och ingen produktionsmigrering görs.
Riktade Vitest: **6 passerade**, ett MinIO-opt-in-fall hoppades över; berörd
ESLint, infrastructure typecheck och build: exit 0. Ändringen har ännu inte
omprovats med riktig pinnad MinIO, och abrupt krasch är fortsatt oprövad.

## Krasch- och reservationsutfall 2026-09-23

Ett separat opt-in-prov dödar en egen isolerad Node-worker med `SIGKILL` vid
två deterministiska punkter: efter backup-id-reservation/före bindning och
efter synkad bindning/före MinIO-start. Före bindning avvisas både resume och
ny provisionering för samma id. Efter bindning återstartas **exakt** bundet
dataområde och credentialfil, skapar bara de väntade tomma/versionerade
bucketsen och får TASK173-readiness. Privata synkade `started`/`ready`-
markörer gör att en avbruten partiell initiering stängs säkert och ett tidigare
redo mål inte tyst nyskapas om dess data saknas.

Slutliga berörda kontroller: infrastructure lint **exit 0**, typecheck
**exit 0**, riktade standardtester **6 passerade, 2 opt-in hoppade över**,
build **exit 0**. Med hashpinnad lokal MinIO passerade samtliga **4/4**
tester, inklusive två faktiska workerkrascher och tidigare återstarts-/
kontaminationsfall. TASK172-source-capture→nytt mål→TASK173 kördes sedan
source-only mot nya isolerade PostgreSQL17-testdatabaser: första försöket
stoppade säkert efter `started`-markören utan målbevis av okänd tillfällig
orsak; ett helt nytt backup-id/databaspar gav **exit 0**. Den första orsaken
är inte fastställd och lokal starttillförlitlighet måste följas upp före
operativ drift. Ingen regel, resync, restore eller kvittens skapades i dessa
source-only-försök.

De fyra exakt skapade testdatabaserna hade noll anslutningar före borttagning.
De två source-only-försökens två käll-/målkatalogpar och opt-in-testernas åtta
egna privata kataloger kontrollerades utan kvarvarande processer eller
symlänkar, togs bort och bekräftades frånvarande. Deras syntetiska data och
credentials kan inte återställas. Inga verkliga tävlingar eller Eventoranrop
användes. TASK174:s lokala delbevis är klart; nästa snitt gäller privat
regel-/resync-/cleanup-koppling enligt ADR-0140, inte en bredare målprovisionerare.
