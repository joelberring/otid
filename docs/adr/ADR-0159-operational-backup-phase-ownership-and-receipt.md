# ADR-0159: en fasägare och hemlighetsfri kvittens för operativ backup

- Status: Accepterad för TASK177:s isolerade syntetiska komposition
- Datum: 2026-09-23

## Kontext

ADR-0140 kräver privat state före varje sidoeffekt, verifierad målversion,
regelrensning och en kvittens med endast backup-id, manifesthash och antal
objekt. TASK172:s `captureOperationalBackupSource` skriver `DUMP_PENDING` och
`TARGET_PREPARATION_PENDING`. Den äldre abstrakta
`captureOperationalBackup` skriver dessutom `REPLICATION_MAY_EXIST`,
`CLEANUP_REQUIRED` och `CLEANUP_VERIFIED` runt uppdelade ports. TASK175:s
verkliga en-store-port skriver **samma tre faser själv**, eftersom den måste
kunna rensa efter ett förlorat `mc`-svar och ge en separat kraschåterhämtning.
Att koppla den direkt som äldre `startReplication` ger ogiltiga dubbla
stateövergångar. Den äldre typens ”receipt” innehåller dessutom hela det
privata manifestet med PM-nycklar och är inte ADR-0140:s operatörskvittens.

## Beslut

1. Application äger källordningen och de två första varaktiga faserna via
   `captureOperationalBackupSource`. Infrastructure/TASK175 äger som **en
   sammanhållen managed port** replikeringsrisk, exakt målläsning och
   normal cleanup från `REPLICATION_MAY_EXIST` till `CLEANUP_VERIFIED`.
   Application skriver inte dessa tre faser en gång till. Återhämtning efter
   abrupt död använder TASK175:s separata privata recovery-väg.
2. Den fulla application-ordningen får ett enda `replicateAndCleanup`-anrop
   med det validerade källbeviset efter att nytt privat mål har förberetts.
   Denna port får bara returnera lyckat efter TASK175:s målverifiering och
   nollregelläsning. Ett fel, även efter att en regel kan ha skapats, ger
   ingen kvittens; cleanup följer portens fail-closed/fel- och recoveryväg.
3. Efter portens lyckade retur gör en **separat final proof-port** en ny
   kontroll av samma backup-id/hash/store: privat state är varaktigt
   `CLEANUP_VERIFIED`, källan har noll regler, varje manifestbunden
   målversion läses via vanlig PM-läsare **efter** cleanup och privata
   dumpbytes matchar manifestets identitet/hash/längd. Fel stoppar kvittens
   men ändrar inte historik eller städar inte om ett okänt mål.
4. Application returnerar till den betrodda anroparen endast en hemlighetsfri
   kvittens `{ backupId, manifestSha256, verifiedPmObjectCount }` **efter**
   slutbeviset. Det fulla manifestet finns fortsatt privat som källbevis,
   aldrig i kvittens, logg eller allmän API-respons. Denna TASK177-väg är
   avgränsad till en store; multi-store avvisas före målsidoeffekter.

## Konsekvenser

Den tidigare uppdelade application-portytan ersätts för den fulla
capturevägen; annars skulle två fasägare kunna kringgå samma statefil.
TASK175:s redan verifierade en-store-port och recovery-semantik ändras
inte. Syntetiska opt-in-prov får bevisa sammansättningen, men detta beslut
är inte ett produktions-CLI, tekniskt skrivlås, produktionsmässigt exklusivt
regelägande, writer-release eller restore. ADR-0140:s driftgrindar står kvar.
Ingen migration, ny tjänst, domänstatus eller ändring av resultatlogik görs.

## Tillägg 2026-09-23: privat beständig överlämning för TASK179

TASK178 visar att en kvitterad syntetisk backup kan återställas **i samma
process**. Den hemlighetsfria kvittensen räcker däremot inte för en senare
restore: det fulla manifestet med exakta PM-versioner finns bara i minnet.
Operation-state och målbindning lagrar inte denna historiska referenslista.

1. **Valbar backup kräver ett nytt immutable completion-underlag.** Först
   efter att `captureOperationalBackup` och dess separata final proof har
   returnerat lyckat får en betrodd privat adapter publicera en write-once
   artefakt. Den innehåller `formatVersion`, backup-id, manifesthash,
   verifierat objektantal, exakt normaliserat backupmanifest samt målets
   `targetId` och hash av den canonicalt återlästa privata målbindningen.
   Den innehåller varken credential, endpoint, ARN eller absoluta sökvägar.
   PM-nycklar i manifestet gör hela artefakten **privat**, aldrig till en
   publik kvittens. Applicationens befintliga tre fält förblir den enda
   hemlighetsfria returtypen.
2. Artefakten skrivs i en uttryckligen vald 0700-katalog utanför repository,
   som 0600-fil med strikt ägare, storleksgräns, `O_EXCL|O_NOFOLLOW`, synkad
   fil, atomisk **no-replace**-publicering och synkad katalog. Befintligt
   backup-id får inte ersättas; en krasch före slutlig publicering lämnar
   backupen icke valbar. Orphan-temporärfiler blir aldrig automatiskt
   completion. Readern avvisar symlink, hardlink, fel UID/mode, korruption,
   icke-canonicalt innehåll och avvikande backup-id/hash/antal/target-bindning.
3. En ny process får bara öppna artefakten med backup-id plus **separat
   explicit privata** operation-state-, dump- och målbindningskataloger.
   Dumpvägen härleds från dumpkatalogen och manifestets säkra filidentitet;
   den lagras inte i artefakten. Readern återläser `CLEANUP_VERIFIED`, binder
   manifesthash/store-id/target-id mot målbindningen och ommäter privata
   dumpbytes. Det är en ny kontroll, inte ett löfte att den gamla
   slutkontrollen fortfarande är färsk.
4. En färdig MinIO-målmiljö öppnas genom en **separat completed-target-väg**
   som kräver `CLEANUP_VERIFIED`, redan färdiga start-/ready-markörer,
   bevarad dataområdesidentitet och credentialfilens identitet/hash enligt
   bindningen. Den får starta samma pinnade lokala mål för läsning men inte
   skapa ny bucket, ny reservation, ny readiness-attestation, replikeringsregel
   eller skriva PM-objekt. TASK174:s `resumePinnedOperationalBackupTarget`
   för `TARGET_PREPARATION_PENDING` ändras inte till en allmän phase-bypass.
   Efter omstart läser den vanliga PM-läsaren alla exakta manifestversioner
   innan restore får godkännas.
5. Restore skriver endast till en separat uttryckligen vald **ny tom**
   PostgreSQL/PostGIS-miljö och kör sedan ADR-0140:s befintliga läsande
   dump-/PM-/historikverifiering. En tvåprocesssyntetisk acceptans ska visa
   att captureprocessen kan avslutas före den separata restoreprocessen.

Detta tillägg ger ingen produktions-CLI, automatisk credentialöverlämning,
serveromfattande tekniskt skrivstopp, exklusivt ägande av källans MinIO-
regler, writer-release eller fältgodkännande. Misslyckad återöppning gör
backupen olämplig för restore; den repareras inte genom att skriva ovanpå
en okänd eller partiellt återställd målmiljö.

## Avvisade alternativ

- Anropa TASK175 inuti äldre `startReplication` och sedan låta application
  skriva cleanup-faserna igen: den privata recorder:n avvisar ordningen.
- Tvinga TASK175 att hoppa över sin varaktiga riskmarkör/cleanup: förlorat
  `mc`-svar och abrupt processdöd skulle bli svårare att återhämta säkert.
- Kalla det privata fulla manifestet för operatörskvittens: PM-nycklar hör
  inte hemma där och motsäger ADR-0140.
