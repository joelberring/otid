# TASK177: managed en-store-capture med slutlig kvittensgrind

Status: syntetiskt verifierad 2026-09-23; inte operativt driftsatt. D1b.4d enligt
[produktmålplanen](docs/product-goal-roadmap-2026-09-23.md). Beslutet om
fasägarskap och kvittensyta finns i
[ADR-0159](docs/adr/ADR-0159-operational-backup-phase-ownership-and-receipt.md).

## Användbart avgränsat utfall

Application-lagrets fulla backupordning anropar samma **faktiska** TASK172-
källfångst, TASK174-bundna mål och TASK175-managed en-store-port som TASK176
redan komponerat i test. Endast efter en ny slutkontroll av privat state,
noll källregler, exakt PM-målversion och dump får den betrodda anroparen en
kvittens med enbart backup-id, manifesthash och verifierat objektantal.
Ingen kvittensfil, publik API-route eller writer-release skapas här.

## Ordning och felgränser

1. Källintyg `writeStopConfirmed: true` valideras före I/O. Source-only-
   ordningen skriver `DUMP_PENDING`, skapar verklig privat `pg_dump -Fc`,
   verifierar migration/PM och skriver `TARGET_PREPARATION_PENDING`.
2. Avvisa noll/flera store-id:n och mismatcher före målpreparering. Skapa
   ett nytt TASK174-mål, återläs privat bindning/credential och TASK173-
   readiness. Ingen återanvändning av failed `started`-mål.
3. Anropa TASK175 exakt en gång. Den porten, inte application, skriver
   risk-/cleanupfaserna och utför resync, målversionläsning samt verifierad
   regelrensning. Normalfel ger ingen kvittens; abrupt död kräver separat
   recovery innan writers kan släppas.
4. Efter lyckad portretur: läs state **från disk**, kräv `CLEANUP_VERIFIED`
   med samma backup-id/hash/store, läs källregler oberoende (noll), läs exakt
   manifestbunden PM-version på målet igen, mät samma privata dumpfil igen.
   Allt måste matcha. En verifierad städning utan giltigt slutbevis ger
   fortfarande ingen kvittens.
5. Returnera bara det hemlighetsfria kvittensfältet från application. Ett
   fullt manifest, PM-nyckel, endpoint, bucket, ARN, credential, dumpväg
   eller rått SDK-fel får inte bli kvittens/utskrift.

## Riktad acceptans

- Små application-prov: fasordningen saknar dubbel risk/cleanup-skrivning;
  ogiltig store före mål; fel i managed port eller i vart och ett av
  slutbevisets state/regel/mål/dumpsteg ger ingen kvittens; lyckad kvittens
  saknar privata fält.
- Riktat infrastructure-prov med privat recorder och stubbad managed port:
  de fem faserna skrivs exakt en gång i giltig ordning.
- Ett opt-in-prov med **nya** isolerade syntetiska PostgreSQL17/PostGIS-
  databaser och hashpinnad MinIO/`mc` återanvänder TASK176:s faktiska
  källa/mål. Det anropar application-full-capture, kräver slutbevis före
  hemlighetsfri kvittens och håller mål-DB tom. Ingen riktig tävling,
  Eventor-nyckel eller produktionscredential används.
- Kör endast berörda paketens lint, typecheck, riktade tester och build.
  Redovisa exakta utfall. Städ bara exakt identifierad syntetisk DB efter
  noll-anslutningskontroll; bevara felartefakter för diagnos.

## Utanför

Operatörs-CLI, tekniskt bevisat skrivstopp, produktionsmässigt exklusivt
regelägande, fler PM-stores, kvittensarkiv, restore, writer-release,
produktions-TLS/credentials och fysisk tävlingsacceptans.

## Utfall och återstående antaganden

Full `captureOperationalBackup` använder nu en managed port för replikering
och cleanup; application skriver endast de två första privata faserna.
Slutbeviset återläser state och målbindning, kräver noll källregler, läser
exakta PM-versioner och mäter samma privata dump på nytt. Bara
`backupId`, `manifestSha256` och `verifiedPmObjectCount` returneras.

Riktade kontroller: application lint/typecheck/build exit 0 och 8/8 tester;
infrastructure lint/typecheck/build exit 0 och 9/9 berörda tester. Runnerns
typecheck och ESLint exit 0. Opt-in med två nyskapade isolerade PostgreSQL17-
databaser och hashpinnad MinIO/`mc` gav exit 0, inklusive tom mål-DB och
slutkvittens. Exakt dessa två syntetiska databaser togs därefter bort efter
kontroll av noll anslutningar; frånvaro bekräftades. Detta är ett lokalt
kompatibilitetsbevis, inte ett tekniskt intyg om verkligt skrivstopp,
produktionsmässig regel-exklusivitet, hållbar kvittenslagring eller restore.
