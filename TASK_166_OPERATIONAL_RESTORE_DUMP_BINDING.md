# TASK166: bind privat dumpbevis före läsande restoreverifiering

Status: riktat syntetiskt verifierad 2026-09-23, inklusive ett isolerat
PostgreSQL-integrationsfall. Ingen verklig dump/restore utförd.

## Syfte

ADR-0140 kräver att backupmanifestets PostgreSQL-dump är exakt verifierad.
TASK148 kan mäta en redan tillhandahållen privat dumpström, medan TASK147
ännu bara kontrollerar manifestbundna PM-versioner och återställd databashistorik.
Detta snitt binder de två bevisen i rätt ordning utan att skapa en dump eller
utföra restore.

## Ägda lager och gräns

- Applicationens befintliga restoreorkestrering kräver en injicerad läsare
  som lämnar dumpens uppmätta identitet, SHA-256 och byte-längd.
- Applicationen validerar själv alla tre fälten mot det stricta manifestet
  **före** någon PM- eller databasläsning. Saknat/felaktigt dumpbevis eller
  läsfel ger ett enda hemlighetsfritt fel.
- Infrastructure-adaptern från TASK148 återanvänds i ett riktat syntetiskt
  sammansättningsprov. Inga lager byter ägare och ingen ny dependency behövs.

## Acceptans

1. Ett korrekt uppmätt, redan tillhandahållet dumpunderlag ger ordningen
   manifest → dump → varje exakt PM-version → skrivskyddad databashistorik.
2. Fel identitet, hash, längd, ogiltigt bevis eller strömfel stoppar före
   PM/databas och röjer inte dumpbytes, källa eller privat sökväg i felkod.
3. Befintlig PM-/databasavvisning och kvittensens manifesthash består.
4. Riktade enhetstester och ett syntetiskt adapter-/orkestreringsprov räcker;
   ingen bred svit, PostgreSQL-writer eller browser behövs för detta snitt.

## Ingår inte

`pg_dump`, `pg_restore`, filöppning/reservation, credential, MinIO-resync,
objektwrite, ny databas, riktig restore, GPS, stafett, SPORTident och USB.
En lyckad kontroll bevisar **inte** att den kontrollerade måldatabasen faktiskt
återställdes från just de kontrollerade dumpbytesen. Det kräver ett senare
isolerat, körbart restoreprov. ADR-0140 täcker ordningen och beviskravet;
ingen teknik- eller domängräns ändras här, därför behövs ingen ny ADR.

## Verifiering 2026-09-23

- Application och infrastructure: riktad ESLint, TypeScript-typecheck och
  paketbygge, alla exit 0 med installerade lokala binärer.
- Riktade prov: 2 filer, 13/13 godkända. Ett prov sammanbinder den verkliga
  TASK148-strömmätaren med applicationens nya kontroll utan fil, databas
  eller credential.
- Befintligt PostgreSQL-integrationsfall, uppdaterat till den obligatoriska
  dumpporten, passerade **1 fil/1 test** mot en ny namngiven, tom syntetisk
  databas i lokal PostgreSQL 17.11. `CI=true pnpm --filter @o-tid/application
  exec vitest run test/integration/task-099-operational-restore-verification.test.ts`
  gav exit 0. Det tidigare försöket att starta en helt ny server med `initdb`
  stoppade på macOS delat minne; det ändrar inte utfallet för detta senare
  isolerade databasprov. Testdatabasen kontrollerades utan aktiva anslutningar
  och togs bort efteråt; inga befintliga databaser eller delat-minne-segment
  ändrades.

Kvarstående antagande: detta provar manifestbunden läsning av syntetisk
databashistorik, inte att en riktig dump har skapats, återställts och är
orsaken till innehållet i måldatabasen. Den senare TASK169 har separat
provat just PostgreSQL-rundturen med syntetiska data; TASK166:s avgränsade
resultat och den fulla MinIO-/driftgrinden ändras inte av det.
