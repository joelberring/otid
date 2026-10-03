# TASK099: Operativ backup och verifierad återställning

Påbörjad 2026-09-19. ADR-0115 och ADR-0140 är skrivna före den återstående
skrivande backup-/restorekoden.

## Användarvärde

En arrangör kan bevara en O-Tid-installations tävlingshistorik och bevisa att
den går att återställa till en separat ny miljö utan att förlora rådata,
resultathistorik eller refererade PM-dokument.

## Avgränsning

- Full PostgreSQL/PostGIS-backup och ett manifest över de exakt
  versionsbundna privata PM-objekt som databasens manifest refererar till.
  En skrivande objektrestore väntar på en versions-ID-bevarande MinIO-mekanism
  enligt ADR-0115; en vanlig S3-kopia är inte en restore.
- Privat, operativ CLI och manifest med hash- och migrationskontroller.
- Återställning enbart till en ny tom, uttryckligen vald testmiljö och en
  läsande verifieringsrapport för en liten syntetisk tävlingskedja.
- Dokumenterat skrivstopp före backup.

## Utanför uppgiften

- Backup av credentials, API-nycklar, master keys, sessionsdata eller
  Androidstationens SQLite/outbox.
- En tävlingsspecifik portabel arkivfil, PITR, HA, automatisk drift eller
  återställning ovanpå en existerande databas.
- GPS, karta/rutt, stafett, betalning eller SPORTident-protokoll.

## Acceptans

1. Backupmanifestet binder dumpens SHA-256, migrationsnivå och varje refererad
   PM-objektversion med dess hash och storlek till ett backup-id.
2. Backup utan uttalat skrivstopp avvisas före kopiering.
3. Restore avvisar fel hash, ofullständigt objektunderlag, saknad PostGIS eller
   icke-tom målmiljö före någon felaktig verifieringsrapport.
4. En lyckad restore till isolerad miljö kan läsande verifiera tävling,
   deltagare, raw data, resultatrevision, journal, publicerat/fryst resultat
   och ett PM-objekt utan ny skrivning till återställd historik.
5. Arkiv, manifest, CLI-output och loggar innehåller inga credentials eller
   Eventor-/masterhemligheter.
6. Riktad test kör mot privata syntetiska PostgreSQL/PostGIS- och MinIO-
   instanser; ingen befintlig demo- eller tävlingsdatabas används.
7. PM-acceptans kräver att varje återställd `pm_object_manifest.versionId` kan
   läsas av den vanliga PM-läsaren. `putObject`, `mc cp` och `mc mirror` till
   ny miljö är uttryckligen otillåtna eftersom de skapar/för över fel
   versionsidentitet.

## Berörda delar

`packages/infrastructure`, `packages/database`, befintliga PM-manifest och
driftsdokument. Domänmotor, publikvy, station och resultatregler ändras inte.
En ändring som översätter historiska PM-versioner i databas är inte berörd och
kräver separat ADR.

## Nästa avgränsade implementation

ADR-0140 väljer nu den enda tillåtna skrivande objektvägen: en explicit
skrivstoppad, tidsbegränsad source-to-empty-target MinIO-replikering med
`existing-objects`, aktiv resync och efterföljande läsning av varje
manifestversion genom den vanliga PM-läsaren. Application har nu den rena
ordningsmotorn för dump → source-preflight → tomt mål → replikering →
målverifiering → regelrensning. TASK139 lägger först ett strikt
hemlighetsfritt state-kontrakt och fail-closed fasordning före en framtida
filadapter. Därefter får nästa kodsnitt endast lägga till privata
infrastructure-/CLI-adaptrar för dessa portar och restore till ny tom
målmiljö. Ingen produktion, kontinuerlig replikering eller verklig
tävlingsdata används under utvecklingen.

TASK139 har lagt den rena, fail-closed statefasordningen från `DUMP_PENDING`
till `CLEANUP_VERIFIED`; den kräver samma manifesthash/storeunderlag efter
preflight och försäkrar cleanupförsök vid sent statefel. TASK140 kan därför
lägga en lokal privat 0600-filadapter utan MinIO-koppling. Före en
infrastructure-adapter som anropar MinIO eller `mc` måste TASK137 fortfarande
bevisa att den pinnade mc-klienten kan rensa den tillfälliga bucketregeln och
privat bevisa noll återstående regler utan att de redan replikerade versionerna
raderas. ADR-0140 kräver dessutom separat privat `storeId` → källa/mål-
konfiguration; den är inte en del av backupmanifestet. TASK137:s runner och
statiska paketkontroller är klara, men dess verkliga kompatibilitetsprov väntar
på de exakta privata hashpinnade binärerna.

TASK140 är riktat verifierad med syntetiska 0700-kataloger: den reserverar
exklusivt en fil per backup-id, skriver monotona faser atomärt/synkat med
mode 0600 och läser bara rätt strict state tillbaka. Den är ännu inte
instansierad av en drift-CLI eller recoveryprocess och innehåller ingen
source-/targetkonfiguration eller credential.

TASK141 använder den filadaptern i ett enda riktat
application/infrastructure-kompositionsprov. Det går med minnesdubblar hela
vägen från dump till cleanup och visar att den läsbara slutfilen får samma
manifesthash/store-id:n som application-kvittensen. Det är inte en drift-CLI,
återhämtningsprocess eller verkligt objektanrop; TASK137:s exakta pinnade
regelrensning är fortsatt nödvändig före sådan koppling.

## Genomfört hittills

`packages/contracts` har ett strikt, canonicaliserbart och hemlighetsfritt
`operationalBackupManifest`. Det binder backup-id/tid, explicit
skrivstoppbekräftelse, PostgreSQL-dumpens identitet/hash/längd,
migrationsidentitet och varje PM-objekts exakta `storeId`, nyckel, version,
hash och längd. PM-objektdelen återanvänder den befintliga
`pmObjectManifestSchema` i stället för en svagare backupvariant. Dubbletter,
hemliga extrafält och ogiltiga hashar avvisas.

Riktad contracts lint/typecheck passerar och manifestprovet passerar 2/2.
Ingen dump, objektexport, restore eller anslutning till databaser/MinIO har
körts ännu.

Efter ADR-0140 har `packages/application` en ren, portinjicerad
`captureOperationalBackup`-orkestrering. Den validerar skrivstopp innan dump,
binder den validerade dumpidentiteten till den befintliga source-preflighten,
kräver ett tomt mål, kontrollerar varje manifestobjekt genom en separat
målport och vägrar kvittens tills replikeringsregeln har rensats. Ett osäkert
svar från regelstart behandlas som att regeln kan finnas och rensas ändå.
Den öppnar ingen databas, process eller MinIO-anslutning själv.

Riktad verifiering 2026-09-22: contracts lint/typecheck/build och manifestprov
3/3 passerade. Application lint/typecheck/build passerade, och capture-,
source-preflight- och restoreverifieringsproven passerade 7/7. Proven använder
enbart portar/dubblar; ingen dump, MinIO, credential, regel, restore eller
databas kördes av detta snitt.

`packages/infrastructure` har nu en liten `readOperationalBackupPmObject`-
port. Den accepterar endast ett redan validerat backupobjekt, för vidare exakt
`storeId`, nyckel och `versionId` till befintlig PM-läsning och verifierar längd
och SHA-256 en gång till. Fel, version- eller byteavvikelse avvisas fail-closed.
Riktad infrastructure lint/typecheck passerar och objektportprovet passerar
3/3. Den kopierar ännu inga objekt och ansluter inte till MinIO i testet.

Samma paket har även `buildOperationalBackupManifest`, en ren planfunktion som
sorterar PM-referenser på `storeId`, nyckel och version före strict validering,
canonical JSON och SHA-256. Samma underlag i annan databasordning får därför
identiska manifestbytes och hash. Infrastructure lint/typecheck passerar;
de två riktade backupmodulproven passerar 6/6. Nästa steg är fortfarande en
läsande databasport, inte en produktionsdump eller restore.

Den läsande databasporten finns nu i `packages/application`. Den projicerar
alla `pm_object_manifest`-rader till strikt validerade, stabilt sorterade
backupreferenser och hämtar migrationsidentiteten från den senast faktiskt
tillämpade Drizzle-raden, aldrig från repositoryts migrationsfiler. Tom eller
ogiltig journal och felaktiga/dubbla PM-rader avvisas. Application
lint/typecheck passerar och det riktade läsmodellprovet passerar 3/3. Ingen
databasskrivning, dump eller extern anslutning har körts.

En kontroll av MinIO:s officiella versionssemantik har upptäckt en spärr före
objektexport och restore: MinIO tilldelar målmiljön nya version-ID vid vanlig
objektskrivning, medan O-Tids databas behåller original-ID i
`pm_object_manifest`. `putObject`, `mc cp` och `mc mirror` kan därför inte
utgöra restore. ADR-0115 och driftsunderlaget kräver nu en dokumenterat
versions-ID-bevarande mekanism plus isolerat bevis med den vanliga PM-läsaren
innan TASK099 får påstå ett komplett återställningsprov. Källor och avgränsning
finns i `docs/research/minio-version-restore-2026-09-19.md`. Den befintliga
läsporten är enbart källverifiering, inte en kopieringsport.

## Beslutad driftgrind före skrivande kod

Den befintliga driftprofilen har fortfarande bara en MinIO-instans och
bucket-initiering. ADR-0140 väljer därför inte en långlivad replika, utan en
ny tom privat målmiljö per backup-id. TASK133:s aktiva resync är det enda
versions-ID-bevarande objektunderlag som får återanvändas. Skrivande kod måste
bevisa dumpens hash, målmiljöns tomhet, resyncens avslut, varje exakt
manifestversion och regelrensning innan writers kan återupptas. PostgreSQL-
dump/restore utan den delen får inte beskrivas som en komplett O-Tid-
återställning.

ADR-0138/TASK133 är nästa förutsättning: ett tvåinstansprov mot exakt pinnad
OSS-MinIO får pröva om server-till-server bucket-replikering faktiskt bevarar
originalens `versionId`. Det väljer inte replikering i drift och kan inte
minska denna spärr förrän den vanliga PM-läsaren har godkänt båda syntetiska
historiska versionerna i målet.

TASK133 passerade 2026-09-22 med den aktiva resync-vägen och den vanliga
PM-läsaren för två syntetiska historiska källversioner. ADR-0140 begränsar
dess operativa användning till exakt en skrivstoppad backup per tom målmiljö,
med privat credentialhantering, bekräftad resync-färdighet och rollback före
återupptagna writers. Ingen writer är ännu implementerad eller körd.

TASK134 passerade 2026-09-22 och bygger bara källbeviset före detta beslut:
efter operatörens explicita skrivstopp läses migration och PM-referenser i en
enda read-only-snapshot, varje immutabel PM-version läses genom den vanliga
kontrollerande läsaren och ett hemlighetsfritt canonicalt manifest returneras.
Det skriver inte dump, objekt eller manifest och väljer inte replikering som
driftmekanism.

## Genomförd läsande grund (2026-09-22)

Före en eventuell dump- eller objektrestore byggdes endast en skrivskyddad
preflight och restore-verifierare. Den tar ett redan framtaget hemlighetsfritt
manifest och läser en uttryckligen vald separat målmiljö för att kontrollera
migrationsidentitet, PostGIS, exakt PM-referensuppsättning och den minsta
historikkedjan. Den kontrollerar ännu inte dumpfilens bytes/hash eller läser
PM-objektets bytes; de stegen hör till en framtida återställningsport efter
versions-ID-beslutet. Verifieraren ska kunna avvisa en felaktig målmiljö, fel
migration eller fel PM-versionbevis utan att skapa revisions-, journal- eller
objektdata.

TASK134 har kompletterat samma grund på källsidan: den läser migration och
PM-referenser i en enda skrivskyddad snapshot och läser därefter varje exakt
PM-version före manifestresultat. Ingen ny skrivande backup- eller
återställningskod är tillåten innan ADR-0140:s valda driftmekanism och
målmiljö är implementerade med sina riktade syntetiska kontroller.

Berörda delar är `application` och ett riktat integrationstest. Acceptance är
riktade read-modelprov plus ett isolerat PostgreSQL/PostGIS-prov med
syntetiskt underlag. Ingen ny ADR krävs för detta
läsande steg: ADR-0115 täcker det. En versions-ID-bevarande objektmekanism,
skrivande dump/restore eller en översättning av gamla PM-referenser kräver
fortsatt separat beslut innan implementation.

## Genomfört: läsande målmiljöverifiering (2026-09-20)

`packages/application` innehåller nu `verifyOperationalRestoreDatabase`. Den
öppnar en enda `REPEATABLE READ, READ ONLY`-transaktion och kontrollerar samma
snapshot av: senast tillämpad Drizzle-hash i
`drizzle.__drizzle_migrations`, PostGIS, den stabilt sorterade exakta
PM-manifestuppsättningen samt minst en event-/lopp-/deltagar-/råavläsnings-/
avläsnings-/resultatrevisions-/audit-/slutresultatrad. Avvikande migration,
PostGIS, PM-referens eller saknad historik avvisas med en stabil felkod. Den
skriver ingenting och hävdar inte att dumpfilen eller PM-bytes är återställda.

Riktade enhetsprov passerar 5/5. Ett nytt PostgreSQL17/PostGIS-prov passerar
1/1 på en helt ny loopbackdatabas med en syntetisk sammanhängande kedja och
avvisar ett förändrat PM-`versionId`. Ingen MinIO, dump, restore, Eventor,
användarfil eller befintlig tävlingsdatabas användes. Den temporära instansen
stoppas efter kontrollen och dess arbetskatalog bevaras för felsökning.
