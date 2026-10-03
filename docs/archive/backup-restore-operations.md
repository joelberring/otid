# Backup och återställning: avsedd driftmodell

Detta är den operativa ramen för TASK099, inte ännu en körbar
produktionsinstruktion.

Före backup stoppar operatören alla O-Tid-writers och väntar tills pågående
skrivningar har avslutats. Därefter tas PostgreSQL/PostGIS-dumpen och ett
privat manifest över de PM-objektversioner som databasens objektmanifest
refererar till. Manifestet ska ange backup-id, tidsstämpel, dump-hash,
migrationsnivå och för varje objekt: bucket, objektidentitet, version, storlek
och SHA-256.

Restore får bara användas mot en ny tom isolerad miljö. Målmiljön behöver
PostgreSQL med PostGIS och en privat versionerad objektlagring. Credentials,
API-nycklar, master keys, sessioner och Android-stationers lokala köer följer
inte med; de återutfärdas eller hanteras enligt respektive driftflöde.

En restore räknas inte som godkänd förrän manifestets dump- och objekthashar,
migrationsnivån och den läsande tävlingskedjan i ADR-0115 har verifierats.
Misslyckade försök repareras inte genom att radera eller skriva ovanpå en
tidigare miljö.

## MinIO-versioner är en uttrycklig spärr

O-Tids PM-manifest sparar serverns MinIO-`versionId`. Den vanliga PM-läsaren
begär sedan exakt den versionen. En vanlig S3/MinIO-läsning följd av
`putObject`, `mc cp` eller `mc mirror` till en ny målmiljö är därför inte en
återställning: målmiljön tilldelar nya version-ID:n men PostgreSQL-dumpen
pekar kvar på de gamla. Använd inte dessa kommandon som restoremetod.

Före en körbar objektrestore ska driftprofilen välja en dokumenterad metod som
bevarar version-ID:n och metadata, och ett isolerat återställningsprov ska
läsa varje manifestobjekt med den vanliga PM-läsaren och dess ursprungliga
`versionId`. Att skriva om databasens bevarade referenser är inte ett tillåtet
workaround utan ett separat arkitekturbeslut. Se
`docs/research/minio-version-restore-2026-09-19.md`.

## Vald mekanism, ännu inte körbar implementation

ADR-0140 väljer en avsiktligt tillfällig objektväg för varje backup-id:
server-till-server MinIO-replikering från den skrivstoppade källan till en ny,
tom, privat och versionerad MinIO-målmiljö. Käll- och mål-buckets har samma
konfigurerade namn per `storeId`. Regeln omfattar `existing-objects`, startas
med explicit resync och tas bort igen innan O-Tid-writers får återupptas.

Backupen får inte kallas redo förrän den vanliga PM-läsaren i målet har läst
varje manifestbunden historisk objektversion med exakt `versionId`, hash och
längd. Sedan återställs PostgreSQL-dumpen endast till en ny tom PostGIS-miljö
som använder denna målmiljö som sin privata PM-lagring. Credentials, endpoint-
uppgifter, target-ARN och lokala arbetskataloger är privata driftinmatningar
och får inte hamna i manifest eller rapport.

Detta dokument är fortfarande inte en instruktion att konfigurera en riktig
replika. Den kommande privata CLI-kedjan måste implementera och testa
ADR-0140:s dump-/preflight-/resync-/regelrensningsordning mot en helt
syntetisk isolerad miljö först.

TASK169 har verifierat **endast PostgreSQL-delen** i en sådan syntetisk
miljö: en riktig custom-format-dump återställdes till en andra ny tom
PostgreSQL/PostGIS-databas, och den befintliga läsande verifieraren godkände
den återställda historiken. Testets PM-port använde en syntetisk referens;
ingen MinIO-replikering, regelrensning, faktisk samordnad konsistenspunkt
eller produktions-CLI följde av detta. En operatör får därför inte använda
TASK169 som en körbar instruktion för tävlingsbackup eller återställning.

TASK178 har därefter i ett **enda isolerat syntetiskt opt-in-förlopp** kört
TASK177:s kvitterade fulla capture och återställt just dess dump i ny tom
PostgreSQL17/PostGIS-databas mot samma versionsbevarande MinIO-mål. Den
befintliga läsande verifieraren godkände exakt historisk PM-referens och
tävlingshistorik. TASK179 sparar efter slutbevis ett privat, write-once
completion-underlag. I ett separat syntetiskt tvåprocessprov avslutades
captureprocessen; en ny restoreprocess återöppnade backup-id, manifest,
dump, state och det bundna MinIO-målet och verifierade samma historiska
PM-version mot en ny tom PostgreSQL17/PostGIS-databas. Opt-in gav exit 0.
Detta är fortfarande ingen produktionsinstruktion: tekniskt skrivstopp,
exklusivt ägande av produktionsregler, betrodd operatörsåtgärd,
produktionscredentials och driftsatt restoreväg saknas.

ADR-0160 väljer för nästa snitt ett **synligt installationsstopp**: stäng ny
ingress och nya server-writers, dränera hela pågående operationer inklusive
objektlagringssteg och verifiera därefter noll writer-DB-sessioner medan
spärren hålls. Det är ännu ett arkitekturbeslut, inte ett körbart kommando.
Nuvarande lokala Compose har ingen controller för web/CLI och ett nollvärde
från `pg_stat_activity` ensamt bevisar inte att en ny writer inte kan starta.
Använd därför inte TASK179:s syntetiska kvittens som operativ backup.
