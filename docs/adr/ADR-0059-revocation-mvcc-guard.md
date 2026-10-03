# ADR-0059: MVCC-spärrgrind för privata repeatable-read-läsningar

- Status: Accepterad
- Datum: 2026-09-06
- Korrigerar låsantagandet i ADR-0020/0058, inte resultatdomänen.

## Bevisat problem

TASK008:s pg_blocking_pids-styrda regression visar att sessionfrågan etablerar
ett repeatable-read-snapshot innan credentiallåset erhålls. Credential och
session är immutable. En konkurrerande revocation inserterar en separat rad,
men uppdaterar ingen tuple som läsaren låser. Läsaren kan därför missa en
redan committad spärr. Radlås ensamma gör inte gammalt snapshot aktuellt.

## Beslut

En separat `pairing_admin_revocation_guard` innehåller credential-id (PK/FK)
och en monoton bigint-generation. Detta är en härledd säkerhetsgrind, inte
behörighetskälla, resultatrevision eller audit. En INSERT-trigger på credential
skapar grinden. INSERT på credentialrevocation eller sessionrevocation ökar
credentialens generation i samma transaktion. Sessionsspärr identifierar
credentialen genom sin immutable session. Saknad guard avvisar spärrwrite;
inget undantag får tyst sväljas. Befintliga credentials backfillas vid migration.

Den gemensamma protected-read-helpern låser session SHARE → credential SHARE
→ guard SHARE före läsning av revocationrader. Om guard ändrats sedan snapshot
kastar PostgreSQL 40001 vid det låsande uppslaget. Helperns eget savepoint
rullas tillbaka och returnerar unauthorized utan domändataläsning. Den gamla
transaktionen får aldrig retrya auth från sitt gamla snapshot. Övriga fel
propageras och får inte maskeras. Lyckad savepoint behåller låsen tills yttre
läsning committar. Saknad guard ger unauthorized.

Revocationtabeller förblir enda spärrsanningen: generation får aldrig användas
för att återaktivera credential/session. Alla befintliga immutable tabeller,
tokens, kontrakt, capabilitygränser, audit och resultat är oförändrade.
En annan sessions logout kan konservativt avvisa en redan påbörjad läsning
under samma credential; nästa färska request gör normal auth igen. Den spärrar
inte andra sessions permanent. GET gör inga writes.

Triggern är en säkerhets-/lagringsinvariant, aldrig resultatlogik. Den krävs
för att ingen legitim revocationinsertväg kan glömma MVCC-markören. Ordinarie
writers behåller session → credential → guard. Ingen separat DB-anslutning
behövs. RC-konsumenter fortsätter fungera; RR-konsumenter kan inte missa spärren.

## Migration/drift

Additiv migration 0037 skapar/backfillar guard och installerar triggers under
EXCLUSIVE-lås på session → credential → spärrtabellerna, med fem sekunders
lock_timeout. Adminwriters ska vara stoppade före migration; login och logout
har olika låssekvenser, så tabellordning ensam är ingen deadlockgaranti.
Timeout/deadlock avbryter hela migrationen; åtgärda stoppet före nytt försök.
Deploya migration
före ny helper. Ingen riktig tävlingsdatabas migreras av utvecklingstester.
Guards får inte raderas eller få identitet/generation tillbakaspolad.
Vid incident stäng privata läsvägar; rulla inte tillbaka till sårbar helper.
Rätta framåt eller återställ verifierad full backup med nya triggers/helper.

## Avvisade alternativ

- NOWAIT: skyddar väntan men inte spärr som committat mellan snapshot och lock.
- READ COMMITTED för alla queries: förstör sammanhängande resultatsnapshot.
- Mutation av immutable credential/session: bryter historikregler.
- Två connections med yttre RC-auth och inre RR-data: kan tömma poolen och
  introducerar ny nästlad anslutningslivscykel i alla privata läsare.
- Retry i samma RR-transaktion: använder fortfarande det gamla snapshotet.
- Enbart UI-fix eller speaker-specialfall: övriga konsumenter förblir sårbara.

## Acceptans innan implementationsspärren tas bort

Det befintliga röda credentialprovet ska passera utan försvagad assertion.
Tillkommande prov: logout vinner före läsning, läsning vinner före revoke,
spärr committad efter snapshot men före guarduppslag, befintlig credential
backfill, annan sessions logout/färsk retry, saknad guard avvisas, endast
40001 mappas, immutable historik bevaras och hela PostgreSQL-sviten passerar.
Ingen speaker-HTTP/UI aktiveras enbart för att första regressionsprovet är grönt.

## Kvarvarande separat säkerhetsarbete

Garantin gäller protected-read-helperns konsumenter. Eventuella kvarvarande
rena auth-preflight-läsare omfattas inte automatiskt och måste granskas
före generell produktionsberedskap. Mutationers preflight ersätter
inte deras befintliga auktorisering under slutlig skrivtransaktion.

TASK009 tillämpar nu gränsen på listEntryClassesAsAdmin efter att riktat
PostgreSQL-prov reproducerat en committad credential-/sessionsspärr mellan
preflight och privat lista. Befintlig READ COMMITTED och race SHARE behålls;
authgrindens lås hålls i samma transaktion till listans commit. Ingen migration,
capabilityändring eller omdefinition av andra legacy-läsare ingår. Se TASK009
och docs/status.md för verifieringsläge.

TASK011 för även listResultRecalculationCandidatesAsAdmin till samma
protected-read-gräns. Credential-/sessionsspärr i den gamla preflightluckan
reproducerades före ändringen. READ COMMITTED, race SHARE, capability och
kandidatprojektion behålls; omräkningsmutationen ändras inte. Se TASK011
för testresultat och avgränsning.

TASK012 omfattar nu listPairingGrantsAsAdmin: protected-read-auth, granturval
och varje metadatauppslag använder samma READ COMMITTED-transaktion.
Regressionen pausar metadatajoinen och reproducerar den gamla spärrluckan.
Inga race/grant-lås eller ändringar av grantstatus/utfärdning/inlösen tillkommer.
Detta är inte ett generellt produktionssäkerhetsgodkännande.
