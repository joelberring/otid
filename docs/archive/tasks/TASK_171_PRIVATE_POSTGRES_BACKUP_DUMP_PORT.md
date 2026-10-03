# TASK171: privat PostgreSQL-dumpport för den betrodda backupkedjan

Status: implementerad och syntetiskt verifierad 2026-09-23; inte operativ backup.

## Användarutfall

En framtida betrodd backupåtgärd ska kunna skapa **en verklig, uppmätt**
PostgreSQL/PostGIS `pg_dump -Fc` i en ny privat katalog och lämna exakt
identitet, SHA-256 och byte-längd till den befintliga
`captureOperationalBackup`-ordningen. Det är första konkreta skrivporten
efter TASK170:s sammansatta men testägda restorebevis. Den får inte ensam
utfärda en backupkvittens.

## Beslutad gräns

- ADR-0140 styr ordningen: operatörens verkliga skrivstopp och
  `DUMP_PENDING` ska finnas **före** porten anropas. TASK171 skapar inte
  maintenance mode eller verifierar operatörens intyg. Ingen ny ADR behövs
  så länge teknik och domängräns behålls.
- Porten är i `packages/infrastructure`; den tar explicit server-/verktygs-
  och privat katalogkonfiguration från betrodd processmiljö. Varken
  `DATABASE_URL`, `TEST_DATABASE_URL`, PATH-fallback eller befintligt
  backupmål väljs tyst. URL/lösenord får inte hamna i argument, manifest,
  konsol eller felmeddelande.
- Reservera en ny 0600-fil i en redan existerande 0700-katalog utanför
  repositoryt. Kör `pg_dump` med absolut binärväg, databasnamn i argv och
  anslutningshemligheter enbart i child-miljön. Skriv dumpbytes direkt till
  den reserverade filbeskrivaren, synka och mät samma färdiga fil med
  `measureOperationalBackupPostgresDump`.
- Avvisa oprivat/symlänkad katalog, befintlig fil, fel verktygsversion,
  misslyckat eller avbrutet `pg_dump`, tom/ändrad fil och osäker indata.
  Bevara en ofullständig privat fil för felsökning, men lämna **inget**
  godkänt dumpbevis efter fel.

## Minsta acceptans

1. En uttryckligen isolerad syntetisk PostgreSQL17/PostGIS-källa kan dumpas
   genom den nya produktionsporten; samma fil kan listas/återställas till
   ett nytt tomt testmål och mätas om med identiskt SHA-256 och längd.
2. Portens resultat kan lämnas till `captureOperationalBackup` som dess
   `createPostgresDump`-bevis **efter** `DUMP_PENDING`. Fortsatta MinIO-portar
   får vara testdubblar i detta snitt; kvittot är då inte operativt.
3. Dubbelt backup-id/fil, felaktig katalog, versionsmismatch eller felaktig
   databasanslutning avvisas utan att någon tidigare dump skrivs över.
4. Riktad lint/typecheck, små fil-/processprov och en opt-in-rundtur mot två
   nya tomma syntetiska PostgreSQL-databaser räcker. Ingen bred testsuite.

## Ingår inte

MinIO-replikeringsport, målpreparering, verklig state-/dump-/preflight-
sammansättning, återhämtnings-CLI, backupkvittens, produktionscredential,
verkligt skrivstopp, användartävling eller fältacceptans. De är följande
D1b.4-snitt, inte något TASK171 får påstå vara klart.

## Utfall och bevisnivå

`packages/infrastructure` har nu en enanvändningsport som får en explicit
anslutning, en absolut `pg_dump`-väg och en redan privat katalog. Den reserverar
filen först när `createPostgresDump` anropas, efter att anroparen har lagrat
`DUMP_PENDING`. Den lämnar bara uppmätt filidentitet, hash och längd. Vid fel
blir ingen dump godkänd; en eventuell privat delfil lämnas för operatören.

Riktat portprov: 1 fil, 6/6 tester. Infrastructure lint, typecheck och build:
exit 0 var för sig. Den befintliga TASK170-runnern använder nu porten i ett
opt-in-prov: en riktig syntetisk PostgreSQL 17.11-custom-dump återställdes
från **samma fil** till nytt tomt PostgreSQL/PostGIS-mål tillsammans med en
exakt historisk PM-version i nya lokala MinIO-instanser; slutkörning exit 0.
Två tidigare opt-in-försök gav exit 1 innan restore på grund av testharnessens
icke-kanoniska macOS-tempväg respektive Homebrews versionssuffix. Båda
korrigerades och provades om mot nya tomma databaspar. Alla sex skapade
syntetiska databaser och nio körningsunika MinIO-/mc-kataloger togs därefter
bort efter kontroll; de kan inte återställas. Inga verkliga tävlingsdata,
credentials eller produktionsmål användes.

Detta är fortfarande inte en betrodd capture-/restoreåtgärd: den verkliga
runnern komponerar dump, state och restore som ett **test**, medan portens
`captureOperationalBackup`-ordning bara provas med övriga portar som
testdubblar. Nästa minsta D1b.4-del är en explicit betrodd källsides-
sammansättning av state, denna dump och befintlig PM-/migrationspreflight,
utan MinIO-mål eller backupkvittens.
