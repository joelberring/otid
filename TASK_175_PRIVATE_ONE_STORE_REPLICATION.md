# TASK175: privat replikeringsregel, resync och cleanup för en PM-store

Status: infrastrukturport och syntetisk kraschåterhämtning verifierade lokalt;
komposition med en faktisk TASK172-källdump och driftgrinden återstår. D1b.4c i
[produktmålplanen](docs/product-goal-roadmap-2026-09-23.md). Beslutet om
MinIO/`mc`, skrivstopp, versionsidentitet och privat state finns redan i
[ADR-0140](docs/adr/ADR-0140-operational-version-preserving-backup-restore.md);
TASK175 ändrar inte teknikval eller domängräns.

## Användbart avgränsat utfall

En betrodd, återanvändbar infrastructure-port kan ta **ett** redan verifierat
TASK172-källbevis och **ett** exakt bundet, nytt TASK174/TASK173-mål genom
en tidsbegränsad `existing-objects`-regel, explicit resync, vanliga
PM-läsarens kontroll av **varje** manifestversion och slutlig verifiering att
källbucketens regelmängd är tom. Minst två historiska versioner av samma
syntetiska PM-nyckel måste överleva med oförändrade `versionId`, hash och
längd. Detta är fortfarande inte en godkänd backup eller restore.

## Förutsättningar och ordning

1. Avvisa före sidoeffekt om manifestet har noll eller flera `storeId`, om
   källbevis/manifesthash, privat state, målberedskapsbevis, återläst privat
   målbindning, endpoint, bucket eller credentials inte pekar på samma
   backup-id/store/mål. Verifiera att inga regler finns på källbucketen.
   Endast uttryckligen vald, isolerad syntetisk source/target får användas i
   acceptansprovet; aldrig Eventor, demo- eller tävlingsdata.
2. Skriv och synka privat `REPLICATION_MAY_EXIST` **före** första möjliga
   `mc replicate add`. Regeln får ett deterministiskt ID bundet till backup-id
   och samma enda store. `mc` får source/target-credentials endast via privat
   processmiljö och 0700-konfiguration; aldrig i argv, manifest, state,
   kvittens, repo eller läckande feltext. Endast den pinnade klienten används.
3. Efter `add`, lista om reglerna och godta bara operationens enda ID med
   `ExistingObjectReplication=Enabled` och mål-ARN för exakt mål-bucket.
   Starta explicit resync mot **det lästa ARN:et**. Ett accepterat resync-
   kommando är inte ett objektbevis: pollning har en begränsad deadline och
   använder vanlig PM-läsare för exakta manifestversioner/bytes.
4. Även om `add` tappar sitt svar, resync misslyckas, målläsning saknas eller
   processen får ett normalt undantag: skriv `CLEANUP_REQUIRED`, läs reglerna
   på nytt och rensa konfigurationen endast om den består av **exakt en**
   regel med eget ID, rätt destination och aktiverad befintlig-objekt-
   replikering. Den pinnade servern avvisar `remove --id` för sista regeln;
   därför används `remove --all --force` enbart i detta bevisat ensamma
   läge enligt ADR-0140:s förtydligande. Gör därefter en ny läsning som visar
   **noll** källregler. Okänd/annan regel får aldrig utlösa all-rensning.
   Cleanup-fel dominerar tidigare fel,
   lämnar state utan `CLEANUP_VERIFIED` och tillåter inte writer-release.
   Efter lyckad cleanup kan `CLEANUP_VERIFIED` skrivas; en tidigare felad
   replikerings-/målläsning ger fortfarande ingen backupkvittens.
5. Abrupt processdöd kan inte få en JavaScript-`finally` att köra. En
   efterföljande betrodd cleanup-väg måste därför kunna läsa privat state och
   exakt målbindning och rensa just det deterministiska ID:t innan writers
   släpps. Om denna återstart inte ryms i snittet ska porten uttryckligen
   stanna med `REPLICATION_MAY_EXIST`/`CLEANUP_REQUIRED` och TASK175 förbli
   öppen; ingen lyckad driftacceptans får påstås.

## Implementation och begränsning

- Lägg en privat MinIO-/`mc`-adapter i `packages/infrastructure`. Återanvänd
  `packages/application`-ordningen och kontrakten; flytta inte resultatlogik
  till adapter eller SQL. Den befintliga TASK137-testhärvan är kompatibilitets-
  underlag, inte produktionsport. Korrigera dess cleanup på felväg om den
  återanvänds i provet.
- Skriv inte en bred backup-CLI, generellt multi-store-flöde, backupkvittens,
  restore, nytt globalt skrivlås, produktionscredential eller release av
  writers. Ändra inte SPORTident, GPS, Eventor, rutt eller resultat.
- Bevara privata felkoder utan endpoint, bucket, ARN, filväg eller hemlighet.
  Varje processanrop har timeout och begränsad utdata; osäkert/okänt utfall
  är fail-closed.

## Riktad acceptans

- Små portprov: felaktigt bevis/state eller befintlig regel ger inget `add`;
  svarsbortfall efter `add`, resyncfel och saknad målversion försöker cleanup
  endast efter exakt en ägd regel; okänd/ytterligare regel rörs inte;
  cleanupfel ger inte `CLEANUP_VERIFIED`.
- Ett opt-in-prov med hashpinnad MinIO/`mc`, ny privat source och nytt privat
  target, en PM-store och två historiska syntetiska versioner: båda läses
  genom normal PM-läsare före och efter riktad regelrensning; ny listning
  visar noll regler. Ett kontrollerat fel efter regelstart prövas separat.
- Riktad lint, typecheck, tester och build för berörda paket redovisas med
  exakta resultat. Testdata/privata kataloger tas bort endast efter exakt
  identifiering, processstopp och bekräftelse; borttagning rapporteras.

## Klargräns

Snittet är klart först när både normal felväg och återstart efter abrupt
avbrott har bevisat att **endast den ensamma ägda konfigurationen** rensas och att en ny läsning
visar noll källregler. Det ger fortfarande ingen full backupkvittens, inget
restorebevis och ingen fält-/produktionsacceptans. Nästa minsta D1b-del blir
att låta samma port använda ett **faktiskt** TASK172-källbevis från en ny
syntetisk PostgreSQL/MinIO-kedja; först därefter kan kvittensfrågan tas upp.
Testhärvans nuvarande manifest har uttryckligen en syntetisk dumpidentitet,
inte en TASK172-dump. Produktionsbruk kräver dessutom exklusivt ägande av
källbucketens regelkonfiguration under jämför-och-rensa, faktiskt skrivstopp
och granskad credential-/TLS-hantering enligt ADR-0140. Återhämtningsanropet
tar ett betrott intyg om att ursprungsprocessen är stoppad; det verifierar
ännu inte processfrånvaro på egen hand.
