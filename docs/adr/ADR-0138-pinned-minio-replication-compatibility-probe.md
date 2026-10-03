# ADR-0138: pinnat MinIO-replikeringsprov före versionsbunden objektrestore

- Status: Accepterad för TASK133 endast
- Datum: 2026-09-22

## Kontext

TASK099:s PostgreSQL-manifest binder varje PM-objekt till MinIOs exakta
`versionId`. Den vanliga PM-läsaren avvisar ett objekt som inte svarar med
samma version-ID. `putObject`, `mc cp` och `mc mirror` är därför inte en
återställning till en ny lagringsmiljö: MinIO skapar eller lämnar nya/fel
versionidentiteter.

MinIOs aktuella AIStor-dokumentation pekar i stället ut server-till-server
bucket-replikering som en väg som synkroniserar alla versioner,
versionsinformation och metadata. Den är dock inte samma sak som bevis för
O-Tids pinnade OSS-server `RELEASE.2025-07-23T15-54-02Z`. Projektets nuvarande
driftprofil har bara en MinIO-instans och saknar replikeringskonfiguration.

En produktionsaktivering skulle tillföra en andra lagringsmiljö, nya
credentials, nät- och driftansvar. Det vore ett större teknik- och
domängränsbeslut än den återställningsspärr som måste undersökas här.

## Beslut

TASK133 får bygga **endast ett isolerat kompatibilitetsprov**. Det är inte en
backup, restoreport, driftprofil eller aktivering av replikering i O-Tid.

1. Provet startar två nya privata loopback-MinIO-instanser med exakt
   `RELEASE.2025-07-23T15-54-02Z`, skilda data-kataloger, portar, credentials
   och tomma versionerade buckets. Det använder en kompatibel, explicit
   testad `mc`-klient. En lokalt tillgänglig men annan serverrelease får inte
   användas som ersättning.
2. Provet får konfigurera server-till-server bucket-replikering bara mellan
   dessa två instanser och bara med syntetiska objekt. Källan skriver minst
   två immutabla versioner av samma PM-nyckel före den explicit aktiverade
   regeln med `existing-objects`, läser därefter regelns target-ARN lokalt och
   begär en explicit aktiv resync mot just det ARN:et. Det kontrollerar också
   att målet var tomt före synken. ARN:et får endast gå som privat child-arg
   till `mc`; det och credentials får inte gå till konsol eller repo, och
   credentials får aldrig gå i argument.
3. Framgång kräver att målet läser båda historiska objekt med **källans
   oförändrade** `versionId`, bytehash och längd via den befintliga
   `createPmObjectStore(...).read(...)`-grinden. En ny target-version med
   identiska bytes godkänns inte. Saknad versionsheader, fel version, bara
   senaste objektet eller timeout avvisar provet.
4. Testcredentials får endast finnas i den privata testprocessens miljö eller
   restriktiva temporära filer. De får inte hamna i argument, kod, repo,
   konsolutskrift eller testrapport. Data-kataloger bevaras efter misslyckande
   för felsökning men rör aldrig en användar- eller driftmiljö.
5. Ingen produktionskonfiguration, Docker-compose-fil, databasreferens,
   bucketpolicy eller O-Tid-writer ändras. TEST133 skapar inte en
   PostgreSQL-dump, PM-export, objektrestore eller ett påstående om att
   TASK099 är klar.

Först om provet passerar får ett senare ADR välja om och hur en
versionsbevarande replikering kan bli del av en operativ backup/restore.
Ett sådant ADR måste särskilt hantera skrivstoppets ögonblick,
replikeringsfärdighet, driftcredentials, återställningsmål och rollback.

## Konsekvenser

- Projektet får empiriskt svar på den enda kända kandidatlösningen utan att
  riskera tävlingsdata eller smyga in en andra produktionskomponent.
- Ett godkänt prov är fortfarande bara kompatibilitetsbevis för ett par
  syntetiska objekt och den aktuella releasekombinationen; det bevisar inte
  full PM-historik, databasdump eller katastrofåterställning.
- Ett avvisat eller omöjligt prov lämnar TASK099 spärrad. Det får inte
  kringgås med copy/mirror eller genom att skriva om historiska manifest.

## Avvisade alternativ

- Aktivera en ständig MinIO-replika i `docker-compose.yml`: introducerar ny
  driftarkitektur innan kompatibilitet och återställningssemantik är bevisad.
- Använda den senaste lokalt tillgängliga MinIO-versionen: bevisar inte den
  release som O-Tid faktiskt pinnar.
- Godta hash-lika målobjekt med nya versions-ID:n: bryter befintliga
  `pm_object_manifest` och PM-läsarens kontrakt.
- `mc cp`, `mc mirror` eller vanlig S3-put: officiell dokumentation beskriver
  dem inte som en versionsbevarande kopia.
- Översätta databasmanifestets versioner: ändrar bevarad historik och kräver
  ett annat, separat arkitekturbeslut.
