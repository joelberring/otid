# TASK169: faktisk syntetisk PostgreSQL-dump till nytt mål

Status: syntetisk PostgreSQL/PostGIS-rundtur verifierad 2026-09-23;
produktionskedja och MinIO-restore fortfarande öppna.

## Användarutfall

Driftansvarig får ett reproducerbart delbevis för att O-Tids syntetiska
PostgreSQL/PostGIS-historik kan tas ut med `pg_dump -Fc`, återställas med
`pg_restore` till en **annan, ny och tom** databas och därefter godkännas av
den befintliga läsande restoreverifieraren. Detta minskar en konkret lucka
inför D1b:s verkliga isolerade backup-/restoreövning.

## Gräns

- Två uttryckligen valda, isolerade testdatabaser krävs: syntetisk källa och
  ett tomt mål. Inga demo-, tävlings- eller användardatabaser.
- `TEST_PG_BIN_DIR` väljer uttryckligen katalogen med matchande `pg_dump` och
  `pg_restore`; ingen tyst fallback till värdens `PATH`. På denna värd är
  servern PostgreSQL 17.11 medan `PATH` pekar på 16.15.
- Provet använder en privat, unik temporär custom-format-arkivfil. Den mäts
  före restore; **samma fil** läses av `pg_restore` och kontrolleras därefter
  mot manifestbeviset. Databasnamn får finnas i processargument, men aldrig
  URL, lösenord eller annan credential.
- Målet seedas eller migreras inte efter restore. Det ska vara tomt innan
  `pg_restore`. Testet läser mål-DB med befintliga application-verifieraren.
- Endast PostgreSQL-delen av ADR-0140 provas. PM-verifierarporten använder
  syntetisk referens; riktig versionsbevarande MinIO-replikering och
  produktions-CLI ingår inte. Testet får inte ge full backupkvittens.

ADR-0140 täcker redan ordning och mekanism; ingen teknik- eller domängräns
ändras, så ingen ny ADR behövs för detta delprov.

## Acceptans

1. Testet avvisar icke-lokala eller felbenämnda databas-URL:er och ett mål
   som redan har användarschema/tabeller.
2. Riktig `pg_dump` skapar ett läsbart custom-format-arkiv av en syntetisk
   sammanhängande historikkedja. SHA-256 och längd mäts på färdiga bytes.
3. Riktig `pg_restore` återställer exakt arkivet till det tomma målet.
   Källans unika event-/anmälansidentitet och manifestbundna PM-referens
   finns i målet; läsande migrations-/PostGIS-/historikverifiering passerar.
4. Inga riktiga credentials, privata källvägar eller dumpbytes hamnar i
   kvittens/logg. Provet körs sekventiellt och inte samtidigt med andra
   databasskrivare i samma testdatabas.

## Utanför

Produktionsdump, automatisk databasprovisionering, fysisk restoreövning,
MinIO-regelhantering, ändrade objektversioner, komplett tävlingsarkiv,
stationers offlinekö, Eventor och verkliga tävlingsdata. Den fulla D1b-
grinden förblir öppen även om detta delprov passerar.

## Verifiering 2026-09-23

- Källa och mål skapades som två nya tomma `otid_task169_`-databaser i lokal
  PostgreSQL 17.11, med `template0`. Båda kontrollerades tomma före provet.
  Explicit `TEST_PG_BIN_DIR=/opt/homebrew/opt/postgresql@17/bin` gav
  `pg_dump` och `pg_restore` 17.11; standard-`PATH` hade inkompatibel 16.15.
- Ett riktat integrationstest körde en verklig custom-format-dump, mätte
  SHA-256 och längd, listade arkivet, återställde samma privata fil med
  `--exit-on-error --single-transaction` till det tomma målet och körde
  befintlig läsande restoreverifiering **utan migration eller seed i målet**.
  Resultat: 1 fil, 3/3 tester, exit 0. Separat läsning av målet gav 1 event,
  1 anmälan, 1 PM-referens och 1 finalisering.
- Efter sista teständringen: riktad ESLint exit 0, application-typecheck
  exit 0 och application-build exit 0. Den privata temporära dumpkatalogen
  togs bort av testet. De två exakta syntetiska databaserna kontrollerades
  utan aktiva anslutningar, togs bort och bekräftades frånvarande.
- Separat negativt guardprov med en ny syntetisk käll-/målparning och endast
  tabellen `task169_existing_marker` i målet gav avsiktligt **exit 1**:
  1 avvisat fall (`TASK169_DATABASE_NOT_EMPTY`), 2 överhoppade. Efteråt
  fanns bara markörtavlan kvar i målet, alltså inga O-Tid-tabeller från
  `pg_restore`. Även dessa två exakta testdatabaser togs bort efter kontroll
  av noll aktiva anslutningar.

Kvarstående antaganden: testet använder en syntetisk PM-verifierarport,
inte verklig versionsbevarande MinIO-restore. Den privata 0700-katalogen
skyddar testfilens sökväg men är inte ett produktionsbevis mot byteutbyte av
en annan process med samma OS-identitet. Migrationsidentiteten jämför dagens
senaste Drizzle-hash, inte en komplett historisk migrationsserie. Inga
produktionscredentials, faktisk skrivstoppskoordinering eller
återställnings-CLI har prövats.
