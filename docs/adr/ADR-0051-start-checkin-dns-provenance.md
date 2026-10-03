# ADR-0051: Separat DNS-provenans från avprickning

- Status: Accepterad; integration under implementation
- Datum: 2026-09-05
- Konkretiserar ADR-0049/0050 utan ändrat teknikval.

## Beslut

Avprickningens DNS använder resultatrevisionsorsaken
START_CHECKIN_DID_NOT_START och en separat immutable
start_checkin_dns_decision. result_revision får en nullable
start_checkin_dns_decision_id. Alla äldre källor måste ha null i det nya
fältet; den nya källan måste ha null i samtliga äldre källfält och readout_id.
Status/reason förblir DNS/DID_NOT_START med befintligt strikt status-only
ResultOutcome. Kortmotorn och stationskontrakten får ingen ny resultatstatus.

Beslutet binder exakt APPLIED-operation och operativ revision, race/entry,
actor, klass/bana/snapshot, observerat föregående absoluta resultatrevisions-
nummer och skapad DNS-revision. Operativ rapport måste vara explicit
REPORTED_NOT_STARTED utan styrkt återkomst. Servern verifierar hela kedjan,
inklusive operationens canonical hash, sparade kvittens och reciproka länkar.
En referens som bara ser ut som ett UUID är aldrig källbevis.

Den första DNS-revisionen kan följa tom resultathistorik. En senare sådan
revision får endast följa en styrkt återtagen avpricknings-DNS, utan teknisk
avläsning eller annan manuell resultatkälla. Befintligt separat manuellt DNS
med revision-1-regel försvagas inte. En negativ rapport efter verklig
avläsning eller registrerad manuell återkomst blir synlig konflikt, inte DNS.

start_checkin_dns_withdrawal binder en senare APPLIED-korrigeringsoperation
till exakt beslut och DNS-revision. Återtagande skapar ingen falsk avläsning,
status, tid eller restaurering från äldre resultat. Med den återtagna
DNS-revisionen som valt huvud är utfallet NO_ACTIVE_RESULT; ett senare
tekniskt huvud fungerar normalt. Läsare måste välja huvud före overlay och
får aldrig återuppliva en äldre revision genom fallback.

Den gemensamma huvudresolven får återanvända domänens rena exakta
DNS-targetregel även för denna källtyp. Det innebär ingen återanvändning av
den gamla manuella databasjournalen: den nya kedjan valideras separat och
dess verkliga källfält behålls i applikationens state/provenans. Publik och
Snapshot använder samma verifierade källa, medan historik och Complete
kräver egna versionsstyrda källprojektioner innan de aktiveras.

En riktig avläsning efter avpricknings-DNS får fortsatt skapa nästa tekniska
revision under entrylåset. Gamla operationer, DNS och withdrawals förblir
historik. Alla genomförda operativa och resultatrelaterade effekter samt
audit måste ligga i samma transaktion innan synkkvittens lämnas.

## Gränser vid införande

Migration 0033 inför provenans och reciproka deferrable foreign keys.
Databasens checks skyddar källform och identitetsbindning, inte beslutet att
en människa faktiskt startat eller återkommit. Det beslutet ligger i
applikation/domain. Äldre källor och deras historiska constraints behålls.

Ingen write-route får aktiveras förrän strict stored-result-validering,
central huvudresolver, manual-writer-grind, publikprojektion, historik,
Snapshot och nya finaliseringar hanterar den nya källan och återtagandet.
Historiska finaliseringsformat och deras frysta XML får inte skrivas om.

Privat readout-historik får format 10. Den nya source-varianten behåller
START_CHECKIN_DID_NOT_START och binder startCheckinDnsDecisionId,
operationRequestId, startCheckinRevisionId samt operationalRevision.
withdrawal är null eller den exakta senare rättningens id, operationRequestId,
startCheckinRevisionId och operationalRevision. Historisk DNS försvinner inte
ur historiken vid återtagande. Actor, device, receipt och hash används vid
servervalidering men lämnas inte ut i denna DTO. Äldre historikformat förblir
oförändrade. Den nya källan får inte maskeras som MANUAL_DID_NOT_START.

En ofullständigt implementerad läsare ska avvisa ny källa, inte kalla den
manuellt beslutad eller fabricera readoutprovenans.

Nya frysta klass-/loppsfinaliseringar använder format 9. Den nya strikta
START_CHECKIN_DID_NOT_START-källan binder entryId, resultRevisionId,
revision, courseVersionId, startCheckinDnsDecisionId, operationRequestId,
startCheckinRevisionId och operationalRevision samt withdrawal: null.
Endast verifierat aktiv DNS får frysas som DNS/DidNotStart. Återtaget DNS
utan senare resultat blockerar finalisering via WITHDRAWN_DID_NOT_START.
Namn och övriga XML-fält fryses som tidigare; senare rättning eller ingest
ändrar inte en redan lagrad slutexport. Format 1–8 och deras historiska XML
behålls utan omskrivning. Racefinalisering kräver som tidigare aktuell,
heltäckande klassuppsättning; en äldre klassfinalisering måste vid behov
finaliseras på nytt till aktuellt format innan ett nytt lopp kan frysas.

## Återställning och acceptans

Expand-only migration, ingen backfill eller omskrivning av resultat.
Rollback innebär avstängda nya writes med bevarade källor/journaler. Kör
inte gammal app mot aktiva nya resultat. Full återställning kräver verifierad
DB-backup; radera aldrig DNS/withdrawal för att kunna retrya.

Tester ska bevisa reciprocal scope, null-exklusiv källform och immutabilitet,
avvisa manipulerad/okänd/motsägande provenance och verifiera både DNS→ingest
och ingest→sen rapport, withdrawal→ny DNS samt utebliven historisk fallback.
TASK 006W förblir ofärdig tills hela offline- och målpersonalflödet fungerar.
