# TASK147: sammanhållen skrivskyddad restoreverifiering

Status: genomförd och riktat verifierad 2026-09-22.

## Syfte

Slut ihop det redan befintliga versionsbundna PM-objektbeviset och den
befintliga skrivskyddade PostgreSQL/PostGIS-historikverifieringen till ett
enda restorebeslut. Det gör inte en backup eller restore körbar; det verifierar
endast att ett redan återställt, isolerat mål har både de exakta privata
PM-versionerna och den minsta bevarade tävlingshistoriken.

ADR-0140 kräver denna ordning. Ingen ny ADR behövs: detta snitt ändrar inte
lagringsmekanism, version-ID-policy, skrivstopp eller återställningsmål.

## Ägda lager

- `packages/application/src/operational-restore-verification.ts`: en
  portinjicerad, skrivskyddad orkestrering.
- `packages/application/test/operational-restore-verification.test.ts`:
  ordning och fail-closed PM-fall.
- `packages/application/test/integration/task-099-operational-restore-verification.test.ts`:
  ett isolerat PostgreSQL/PostGIS-fall med syntetiskt PM-underlag.

`packages/infrastructure` återanvänds endast av den som injicerar sin
befintliga versionsbundna PM-läsare; application får inte importera den.

## Acceptans

1. Manifestet valideras och varje PM-objekt verifieras med exakt `storeId`,
   key, original-`versionId`, SHA-256 och längd innan databasen läses.
2. Saknat objekt, fel version, fel bytes/hash eller längd avvisar fail-closed
   och startar inte databasverifieringen.
3. Efter godkänt PM-underlag återanvänds befintlig `REPEATABLE READ, READ ONLY`
   PostgreSQL/PostGIS-verifiering för migration, referenser och den minimala
   tävlingskedjan.
4. Kvittensen innehåller endast canonical manifesthash, antal verifierade
   PM-objekt och redan hemlighetsfri databasbevisning.
5. Riktade enhets- och isolerade PostgreSQL/PostGIS-prov använder bara
   syntetiska data.

## Utanför uppgiften

Dumpfilsläsning eller hashkontroll, dump-/restoreprocess, MinIO- eller
`mc`-kommandon, credentials, målmiljöskapande, bucketregler, manifestskrivning,
migration, resultat-/journaländring, PM-skrivning, GPS, karta/rutt, stafett,
SPORTident och USB ingår inte.

## Resultat

`verifyOperationalRestoreTarget` validerar det hemlighetsfria manifestet,
läser varje manifestbunden PM-version genom en injicerad verifieringsport och
anropar först därefter databaskontrollen. `verifyOperationalRestore` binder
samma ordning till den befintliga läsande PostgreSQL/PostGIS-verifieraren.
Kvittensen innehåller bara canonical manifesthash, verifierat objektantal och
redan hemlighetsfri databasbevisning.

Application lint, typecheck och build passerade. Det rena provet passerade
5/5 och det isolerade PostgreSQL17/PostGIS-provet 1/1, båda med syntetiskt
underlag. Ingen dump, MinIO, `mc`, credential, objektwrite eller
återställningsprocess kördes.
