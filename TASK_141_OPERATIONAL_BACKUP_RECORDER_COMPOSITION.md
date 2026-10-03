# TASK141: verifierad sammansättning av backupkedja och privat statusfil

Status: slutförd och riktat verifierad 2026-09-22.

## Syfte

Visa att TASK139:s rena backupordning kan använda TASK140:s verkliga privata
state-recorder utan en översättning, borttappad fas eller mindre strikt
filformat. Det är ett litet integrationsprov vid application/infrastructure-
gränsen, inte en ny driftväg.

## Arkitekturbeslut

Ingen ny ADR behövs. ADR-0140 kräver redan att den privata operation-statusen
skrivs före externa förändringar, och TASK139/TASK140 har var sin halva av
samma etablerade port. Detta snitt ändrar inte den porten, dess faser,
backupmanifestet eller den accepterade MinIO-modellen.

## Avgränsning

- Ett infrastructure-test anropar `captureOperationalBackup` med en
  minnesbaserad, verifierad källpreflight och minnesdubblar för dump, mål,
  replikering, objektkontroll och regelrensning.
- Den enda beständiga komponenten är TASK140:s recorder i en av provet skapad
  privat 0700-katalog under `/private/tmp`; den injiceras direkt som
  `recordOperationState`.
- Provet ska bevisa hela fasföljden till läsbar `CLEANUP_VERIFIED`, exakt
  manifesthash och canonicala, sorterade `storeId`:n efter preflight samt att
  den privata 0600-filen inte innehåller drifthemligheter.
- Det får inte skapa PostgreSQL-dump, ansluta PostgreSQL/MinIO, starta `mc`,
  skriva tävlingsdata, använda credential eller utfärda en driftkvittens.

## Acceptans

1. Samma recorder tar exakt TASK139:s fem direkta faser när application-
   orkestreringen lyckas.
2. Den beständigt lästa slutfasen är `CLEANUP_VERIFIED`, bunden till
   application-kvittensens canonicala manifesthash och manifestets logiska
   `storeId`:n.
3. Alla externa backupportar är minnesdubblar; deras observerade ordning är
   dump, tomt mål, replikering, varje målobjekt och regelrensning.
4. Det kortlivade privata stateunderlaget rensas bara av testet självt och
   testar inget mot verklig databas, MinIO, `mc` eller binär.

## Proportionell verifiering

- Ett nytt riktat infrastructure-test plus TASK140:s befintliga statefilprov
  och backupmanifest-/objektprov.
- Infrastructure lint, typecheck och build med `CI=true`.

## Utanför uppgiften

Ingen CLI-komposition, kraschåterställnings-writer, dump, restore, verklig
MinIO-regel, binärnedladdning, databas, användarfil eller fältacceptans ingår.
TASK137:s hashpinnade riktiga regelrensningsprov är fortsatt spärren före
driftkoppling.

## Utfört 2026-09-22

Ett enda riktat infrastructure-test kopplar nu den rena
`captureOperationalBackup`-orkestreringen till TASK140:s riktiga
`recordOperationState`-recorder. Dump, source-preflight, målpreparering,
replikering, två versionskontroller och cleanup är minnesdubblar. Testet
observerar hela operationens fem faser och läser därefter den privata filen:
den slutliga `CLEANUP_VERIFIED`-raden har exakt receipt-hash och manifestets
sorterade logiska store-id:n.

Slutlig riktad verifiering:

- `CI=true pnpm --filter @o-tid/infrastructure exec vitest run
  test/operational-backup-recorder-composition.test.ts
  test/operational-backup-operation-state.test.ts
  test/operational-backup-manifest.test.ts
  test/operational-backup-object.test.ts`: exit 0, 4 filer / 11 tester.
- `CI=true pnpm --filter @o-tid/infrastructure lint`, `typecheck` och `build`:
  samtliga exit 0.

Inga verkliga backupportar eller CLI:er komponerades. Testet skapade och tog
bort endast sin egen kortlivade katalog under `/private/tmp`; ingen databas,
dump, MinIO, `mc`, binär, credential eller tävlingsdata användes.
