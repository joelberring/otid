# Migrationer

`0080_task_153_account_public_result_follow.sql` lägger additivt till en
immutable, kontobunden följ/avfölj-journal för exakta offentliga resultatpar.
Ingen lokal favorit eller resultathistorik bakfylls eller ändras. Vid incident
stäng följ-/läsrutterna och behåll journalen; rätta framåt eller återställ en
verifierad full PostgreSQL-backup. Skriv inte om följhistorik. Se ADR-0147.

`0000_task_001.sql` är en additiv första migration. Den aktiverar PostGIS och
skapar TASK 001-tabeller samt immutabilitetstriggers.

## Restore/rollback

`0079_task_152_participant_entry_claim.sql` lägger additivt till tre immutable
journaler för exakt race-/entrybunden engångskod, kontoinlösen och spärr.
Endast kodens SHA-256 lagras; ingen äldre anmälan eller resultatrevision
bakfylls/ändras. Vid incident stängs issue/redeem/read-rutterna och berörda
grants spärras. Rätta framåt eller återställ verifierad full PostgreSQL-backup;
droppa eller skriv inte om journalerna. Rena koder kan inte återskapas efter
restore och måste utfärdas på nytt. Se ADR-0146.

`0077_task_150_organizer_account_event_ownership.sql` lägger additivt till
ett separat användarkonto, lösenordsverifierarhistorik, inloggningsspärr,
kontosessioner/spärrar, eventadministrationsgrant, två muterbara MVCC-vakter, kontobunden
skapandejournal och race-delegationslänk. Inget historiskt event eller äldre
credential kopplas automatiskt till konto. Vid incident: inaktivera de nya
kontorutterna och provisionerings-CLI:n, spärra sessioner och rätta framåt;
droppa eller skriv aldrig om identitets-/auditbevis i en databas med data.
Återställ annars verifierad full backup. Se ADR-0144.

`0076_task_143_returned_rental_card_reuse.sql` ersätter bara den tidigare
fulla race+brick-unikheten med högst en aktiv koppling och lägger en immutable,
racebunden reuse-journal. Gamla assignmenter och hyr-/returjournaler behålls;
återanvändning skapar alltid en ny assignment för målet. Vid incident:
inaktivera writer/UI och rätta framåt. Droppa aldrig index, assignmenter eller
journal i en databas med data; återställ annars verifierad full backup.

`0075_task_142_entry_payment_status.sql` lägger additivt till en privat
administrativ betalstatus och en immutable `MANAGE_RACE`-journal med en egen
version per deltagare. Det är ingen transaktion, skuld, faktura eller publik
uppgift och ändrar inte start, resultat eller tävlingssnapshot. Vid incident:
inaktivera writer/UI och rätta framåt; droppa aldrig statuskolumner eller
journal i en databas med data. Återställ annars en verifierad full backup.

`0073_task_129_public_result_event_stream.sql` lägger additivt till en
begränsad teknisk markörjournal och en `AFTER INSERT`-trigger på redan
publicerade `result_revision`-rader. Triggern fattar inga resultatbeslut och
ändrar inga resultatrevisioner, rådata, auditrader eller finaliseringar. Vid
incident stängs SSE-routen så att klienter faller tillbaka till polling; skriv
inte om resultat eller migrationshistorik. Rätta framåt med en explicit senare
migration eller återställ en verifierad full PostgreSQL-backup.

`0071_task_117_public_participant_route_release.sql` lägger additivt till en
immutable offentlig releasejournal som binder exakt GPX-, raster- och
georeferensversion. Vid incident ska release-writer och publik route-läsning
stängas; droppa eller skriv aldrig om journalen. Återställ verifierad
PostgreSQL- och objektlagringsbackup eller rätta framåt. Samtycke, rå GPX,
karta och resultat ändras inte av migrationen.

`0070_task_116_participant_route_publication_consent.sql` lägger additivt till
en immutable privat deltagarjournal för samtycke/återtagande på exakt GPX-
manifestversion. Vid incident ska consent-writer/UI stängas; droppa eller skriv
aldrig om journalen. Rätta framåt eller återställ en verifierad PostgreSQL-
backup. Migrationen publicerar inga rutter och ändrar inga kartor/resultat.

`0069_task_114_private_raster_georeference.sql` lägger additivt till en
immutable, privat kalibreringsjournal för en exakt tidigare lagrad rasterkarta.
Vid incident ska georeferens-writer/UI stängas; droppa eller skriv aldrig om
kalibreringsjournalen. Rätta framåt med ny revision eller återställ en
verifierad PostgreSQL-backup. Kartpublicering och ruttdata påverkas inte.

`0067_task_110_assigned_fixed_start_slot_registration.sql` lägger additivt
till en separat immutable journal som binder en direktanmälan till exakt en
tidigare lottad starttid. Vid incident ska writer/UI stängas; droppa aldrig
registrerings- eller slotjournalen. Rätta framåt eller återställ en verifierad
PostgreSQL-backup som innehåller båda journalerna.

`0066_task_109_assigned_fixed_start_slot_transfer.sql` lägger additivt till
en immutable journal som binder ett klassbyte till exakt en tidigare lottad
starttid. Vid incident ska writer/UI stängas; droppa aldrig transfer- eller
slotjournalen. Rätta framåt eller återställ en verifierad PostgreSQL-backup som
innehåller båda journalerna.

`0062_task_101_production_eventor_read_profile.sql` utvidgar enbart den
slutna, befintliga Eventor-profilchecken med `production-se`; den ändrar inga
äldre Testeventoranslutningar, krypterade envelopes eller importjournaler. Vid
incident: stäng provisionering för produktionsprofilen och spärra berörd
anslutning. Ta inte bort immutable provenance; rätta framåt eller återställ en
verifierad PostgreSQL-backup.

`0058`–`0059` för TASK093 lägger additivt till en immutable journal och
proveniens för en explicit rättning av redan observerad måltid. En rollback får
inte droppa journal eller resultatrevisioner: inaktivera writer/UI, rätta framåt
eller återställ en verifierad PostgreSQL-backup. Se ADR-0111.

`0061_task_098_testeventor_entry_import_grant.sql` lägger additivt till en
serverintern, återkallelig bro från en exakt tidigare Testeventor-import till
en exakt racebunden `IMPORT_IOF`-credential samt en immutable
anmälningimportjournal. Ingen API-nyckel, ny credentialhemlighet eller historisk
entry skrivs in i tabellerna. Vid incident inaktiveras writer/rutter och grant
eller Eventoranslutning spärras; droppa inte grant-, receipt- eller entryhistorik.
Rätta framåt eller återställ en verifierad PostgreSQL-backup.

`0053_task_084_manual_course_result_bearing_relink.sql` lägger additivt till
en separat immutable `MANAGE_RACE`-journal för hash-bunden omlänkning av en
manuell klass med befintliga resultat. Produktionsrollback får inte droppa
journal, banversion eller resultathistorik: inaktivera writer/UI, rätta framåt
additivt eller återställ en verifierad full PostgreSQL-backup. Se ADR-0106.

`0052_task_082_manual_course_version_class_relink.sql` lägger additivt till den
immutable `MANAGE_RACE`-journalen för en ny manuell banversion och omlänkning av
en resultatfri klass. Produktionsrollback får inte droppa journalen eller någon
banversion: inaktivera writer/UI, rätta framåt additivt eller återställ en
verifierad full PostgreSQL-backup. Se ADR-0104.

`0051_task_081_manual_course_class.sql` lägger additivt till den immutable
`MANAGE_RACE`-journalen för atomisk manuell bana/klass och skyddar även
`course_control` mot update/delete. Produktionsrollback får inte droppa
journalen eller kontrollföljder: inaktivera writer/UI, rätta framåt additivt
eller återställ en verifierad full PostgreSQL-backup. Se ADR-0103.

`0050_task_076_rental_card_return.sql` lägger additivt till en obligatorisk
återlämningsmarkering på brickkopplingen och en separat append-only journal
för `MANAGE_RACE`-ändringar. Default `false` är inte fysisk inventeringssanning.
Produktionsrollback får inte droppa kolumn eller journal: inaktivera writer/UI,
rätta framåt additivt eller återställ en verifierad full backup. Se ADR-0101.

`0049_task_073_card_rental_status.sql` lägger additivt till en obligatorisk
hyrmarkering på varje brickkoppling och en separat append-only journal för
MANAGE_RACE-ändringar. Inga råavläsningar, resultat eller startlistor skrivs om.
Produktionsrollback får inte droppa kolumnen eller journalen: inaktivera skrivaren
och UI:t, rätta framåt additivt eller återställ en verifierad full backup. Se
ADR-0100.

I en tom lokal miljö återställs migrationen genom att databasen slängs och skapas
om. I en miljö med data ska migrationen inte backas med `DROP`; återställ i stället
hela PostgreSQL-databasen från backup. Framtida ändringar ska vara nya additiva
migrationer enligt expand/migrate/contract.

`0001_task_005c_ingest_outcome.sql` lägger endast till det append-only
serverutfall som gör duplicate-retry återvinningsbar även för okända brickor.
Produktionsrollback får inte droppa tabellen automatiskt. Exportera dess data och
återställ en verifierad full backup, eller använd en korrigerande roll-forward-
migration. Se ADR-0013.

`0003_task_005e_station_pairing.sql` lägger additivt till kortlivade grant,
spärrar, försök och engångsinlösen för stationsparning. Tabellerna är
append-only. Produktionsrollback sker inte med `DROP`: ta en verifierad full
backup före migration och återställ den vid behov, eller rätta framåt med en ny
additiv migration. Se ADR-0015.

`0004_task_005f_pairing_admin.sql` lägger additivt till loppbundna
åtkomstcredentialer, kortlivade sessioner och deras append-only-spärrar. Den
utökar pairing-grant och audit med nullable metadata så äldre CLI-utfärdade
grant förblir läsbara. Produktionsrollback får inte droppa tabeller, kolumner
eller enumtyper: ta en verifierad full backup före migrationen och återställ den
vid behov, eller inaktivera 005F-routes och rätta framåt med en ny additiv
migration. Se ADR-0016.

`0005_task_005g_authenticated_iof_import.sql` utökar det racebundna
säkerhetssubstratet med capabilityn `IMPORT_IOF` och auditaktören
`IOF_IMPORT_ACCESS_CREDENTIAL`. Den skapar ett append-only requestspår med
request-UUID som ADR-beslutad retryidentitet och gör `import_file` oföränderlig.
Produktionsrollback får inte försöka ta bort enumvärden, tabell eller triggers
destruktivt. Inaktivera 005G-routes/CLI och rätta framåt med en additiv migration,
eller återställ en verifierad full backup. Se ADR-0017.

`0006_task_005h_authenticated_entry_class_change.sql` utökar samma smala
säkerhetssubstrat med capabilityn `CHANGE_ENTRY_CLASS` och auditaktören
`ENTRY_CLASS_ACCESS_CREDENTIAL`. Den lägger till en capabilityspecifik
åttatimmarsgräns och en append-only requestjournal för exact retry av
klassändring. Produktionsrollback får inte ta bort enumvärden, journal eller
trigger destruktivt. Inaktivera 005H-routes/CLI och rätta framåt med en additiv
migration, eller återställ en verifierad full backup. Se ADR-0018.

`0007_task_005i_authenticated_result_recalculation.sql` utökar additivt
säkerhetssubstratet med capabilityn `RECALCULATE_RESULT`, auditaktören
`RESULT_RECALCULATION_ACCESS_CREDENTIAL` och revisionsorsaken
`EXPLICIT_RECALCULATION`. Den lägger till en capabilityspecifik
åttatimmarsgräns och en append-only requestjournal som binder fryst intent till
exakt en immutable resultatrevision. Produktionsrollback får inte ta bort
enumvärden, journal, revisioner eller trigger destruktivt. Inaktivera
005I-routes/CLI och rätta framåt additivt, eller återställ en verifierad full
backup. Se ADR-0019.

`0008_task_005j_authenticated_race_overview.sql` utökar additivt samma
säkerhetssubstrat med den separata read-only-capabilityn `VIEW_RACE_OVERVIEW`
och en capabilityspecifik åttatimmarsgräns. Inga tabeller eller auditaktörer
tillkommer. Produktionsrollback får inte ta bort enumvärdet destruktivt.
Inaktivera 005J-route och CLI, spärra berörda credentials och rätta framåt med
en additiv migration, eller återställ en verifierad full backup. Se ADR-0020.

`0009_task_005k_authenticated_event_creation.sql` skapar ett separat globalt
men fast avgränsat, hash-only säkerhetssubstrat för `CREATE_EVENT`, dess
append-only requestjournal och auditaktören
`EVENT_CREATION_ACCESS_CREDENTIAL`. Migrationen gör även befintlig
`audit_event`-barriär från migration 0002 till en uttrycklig del av
acceptansbeviset; den befintliga triggern dupliceras inte. Produktionsrollback
får inte droppa bevisdata eller enumvärdet.
Inaktivera create-route/CLI, spärra credentials och rätta framåt additivt, eller
återställ en verifierad full backup. Se ADR-0021.

`0010_task_005n_authenticated_readout_result_history.sql` utökar additivt det
racebundna säkerhetssubstratet med read-only-capabilityn
`VIEW_READOUT_RESULT_HISTORY`, dess åttatimmarsgräns och ett racebundet
keysetindex för mottagna rawmeddelanden. Inga raw-, readout- eller resultatrader
skrivs om. Produktionsrollback får inte ta bort enumvärdet destruktivt.
Inaktivera historyroute/CLI, spärra credentials och rätta framåt additivt, eller
återställ en verifierad full backup. Se ADR-0024.

`0011_task_006a_iof_startlist_import.sql` lägger enbart additivt till
`StartList` i `import_kind`. Inga befintliga rader, tabeller, resultatrevisioner
eller capabilities ändras. Produktionsrollback får inte ta bort enumvärdet
destruktivt; inaktivera StartList-stöd och rätta framåt, eller återställ en
verifierad full backup. Se ADR-0025.

`0012_task_006b_iof_resultlist_export.sql` utökar additivt det racebundna
säkerhetssubstratet med read-only-capabilityn `EXPORT_IOF_RESULT_LIST` och en
capabilityspecifik åttatimmarsgräns. Inga event-, race-, entry- eller
resultatrader skrivs om. Produktionsrollback får inte ta bort enumvärdet
destruktivt. Inaktivera exportroute/CLI, spärra berörda credentials och rätta
framåt additivt, eller återställ en verifierad full backup. Se ADR-0026.

`0013_task_006d_individual_result_finalization.sql` utökar additivt det
racebundna säkerhetssubstratet med write-capabilityn `FINALIZE_RESULTS` och
auditaktören `RESULT_FINALIZATION_ACCESS_CREDENTIAL`. Den lägger till en enda
append-only `result_finalization`-tabell för scope `CLASS` och `RACE`, med
fryst JSON-projektion och, enbart för lopp, exakt `Complete`-XML samt SHA-256.
Tabellens scope-/hash-/XML-constraints, scope-lokala revisionsindex och
update/delete-trigger skyddar det historiska beslutet. En additiv komposit
uniknyckel på `class(id, race_id)` låter databasen dessutom bevisa att en
klassfinalisering tillhör sitt lopp. Produktionsrollback får inte droppa
enumvärden, finaliseringar, audit eller trigger destruktivt. Inaktivera
finaliseringsroutes/CLI, spärra berörda credentials och rätta framåt med en
additiv migration, eller återställ en verifierad full backup. Se ADR-0028.

`0014_task_006e_explicit_did_not_start.sql` utökar additivt det racebundna
säkerhetssubstratet med write-capabilityn `DECIDE_DID_NOT_START`, auditaktören
`DID_NOT_START_ACCESS_CREDENTIAL` och revisionsorsaken
`MANUAL_DID_NOT_START`. Den lägger en immutable besluts-/idempotensjournal och
en explicit, unik beslutskoppling på resultatrevisionen. `readout_id` blir
nullable endast tillsammans med den validerade källconstrainten: DNS saknar
readout men måste ha beslut; alla äldre orsaker kräver readout och förbjuder
beslut. De två korsvisa käll-FK:erna är deferred inom samma transaktion så att
beslut och revision kan committas atomiskt. Produktionsrollback får inte droppa
enumvärden, beslut, revisioner eller audit. Inaktivera DNS-routes/CLI, spärra
berörda credentials och rätta framåt med en additiv migration, eller återställ
en verifierad full PostgreSQL-backup. Se ADR-0029.

`0015_task_006f_did_not_start_withdrawal.sql` lägger additivt till den
separata capabilityn `WITHDRAW_DID_NOT_START`, auditaktören
`DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL`, starkare kompositbevis för
decision↔DNS-revision och en immutable `did_not_start_withdrawal`-journal.
Migrationen får inte skriva om befintliga beslut, resultatrevisioner eller
publiceringsflaggor. Produktionsrollback får inte droppa enumvärden,
withdrawals eller audit; inaktivera routes/CLI, spärra credentials och rätta
framåt med en additiv migration, eller återställ en verifierad full
PostgreSQL-backup. Se ADR-0030.

`0016_task_006g_manual_result_disqualification.sql` utökar additivt det
racebundna säkerhetssubstratet med de separata write-capabilities
`DISQUALIFY_RESULT` och `WITHDRAW_DISQUALIFICATION`, var sin auditaktör och
revisionsorsakerna `MANUAL_DISQUALIFICATION` respektive
`MANUAL_DISQUALIFICATION_WITHDRAWAL`. Två nullable provenienskolumner på
`result_revision`, två immutable requestjournaler och deferred komposit-FK:er
bevisar exakta target-, beslut-, observerat-head-, restaureringskälla- och
skapad-revision-par utan att lägga aktuell-head- eller JSON-businesslogik i en
trigger. Manuella revisioner har null direkt readout och når kortprovenansen
endast genom sin exakta källrevision. Befintliga resultat- och DNS-rader skrivs
inte om. Enumvärden och historik får inte droppas vid produktionsrollback:
inaktivera 006G-routes/CLI, spärra berörda credentials och rätta framåt med en
additiv migration, eller återställ en verifierad full PostgreSQL-backup. De
sammansatta indexen och constraint-valideringen kan ta produktionslås och ska
planeras därefter. Se ADR-0031.

`0017_task_006h_manual_result_approval.sql` utökar additivt samma mönster med
de separata write-capabilities `APPROVE_RESULT` och
`WITHDRAW_RESULT_APPROVAL`, två auditaktörer, två revisionsorsaker, två
nullable provenienskolumner och immutable decision-/withdrawal-journaler.
Deferred komposit-FK:er fryser target, observerat huvud, restaureringskälla och
skapad revision utan att flytta resultathuvudlogik till databasen. Befintliga
rader skrivs inte om. Produktionsrollback inaktiverar 006H-routes/CLI, spärrar
credentials och rättar framåt additivt, eller återställer en verifierad full
PostgreSQL-backup. Se ADR-0032.

`0018_task_006i_explicit_did_not_finish.sql` lägger additivt till capabilityn
`DECIDE_DID_NOT_FINISH`, auditaktören `DID_NOT_FINISH_ACCESS_CREDENTIAL`,
revisionsorsaken `MANUAL_DID_NOT_FINISH`, en nullable unik
DNF-provenienskolumn och en immutable `did_not_finish_decision`-journal.
Unika request-, entry-, target- och resultnycklar samt tre deferred
komposit-FK:er bevisar exakt tekniskt target och reciprocal skapad
DNF-revision. Källconstrainten kräver null direkt readout och
`DNF/DID_NOT_FINISH` för den manuella revisionen. Befintliga rader skrivs inte
om. Enumvärden och historik droppas inte vid incident: inaktivera
006I-routes/CLI, spärra credentials och rätta framåt additivt, eller återställ
en verifierad full PostgreSQL-backup. Se ADR-0033.

`0019_task_006j_did_not_finish_withdrawal.sql` inför den separata capabilityn
`WITHDRAW_DID_NOT_FINISH`, auditaktören
`DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_DID_NOT_FINISH_WITHDRAWAL`, en nullable unik provenienskolumn och den
immutable `did_not_finish_withdrawal`-journalen. Deferred komposit-FK:er fryser
ursprungligt target, DNF-revision, observerat absolut huvud, exakt teknisk
restaureringskälla och reciprocal skapad revision. Migrationen ersätter den
uttryckligen tillfälliga entry-unika DNF-indexen med ett icke-unikt
race-/entry-/revisionsindex utan att skriva om befintliga rader. Vid incident
droppas inga enumvärden, kolumner, journaler eller historiska revisioner:
inaktivera 006J-routes/CLI, spärra credentials och rätta framåt, eller återställ
en verifierad full PostgreSQL-backup. Se ADR-0034.

`0020_task_006k_explicit_out_of_competition.sql` utökar additivt samma
racebundna säkerhets- och revisionsmodell med capabilityn
`DECIDE_OUT_OF_COMPETITION`, auditaktören
`OUT_OF_COMPETITION_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_OUT_OF_COMPETITION`, en nullable unik OOC-provenienskolumn och den
immutable `not_competing_decision`-journalen. Unika request-, entry-, target-
och resultnycklar samt tre deferred komposit-FK:er fryser det exakta tekniska
targetet och reciprocal skapad OOC-revision. Policy, status och reason låses
exakt till `out-of-competition-v1`, `OOC` och `OUT_OF_COMPETITION`; befintliga
rader skrivs inte om. Entry-unikheten är avsiktligt tillfällig medan inget
withdrawal finns. Vid incident droppas inga enumvärden, kolumner, journaler
eller historiska revisioner: inaktivera 006K-routes/CLI, spärra credentials och
rätta framåt med en additiv migration, eller återställ en verifierad full
PostgreSQL-backup. Se ADR-0035.

`0021_task_006l_out_of_competition_withdrawal.sql` lägger additivt till den
separata capabilityn `WITHDRAW_OUT_OF_COMPETITION`, auditaktören
`OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_OUT_OF_COMPETITION_WITHDRAWAL`, en nullable unik
withdrawalprovenienskolumn och den immutable
`not_competing_withdrawal`-journalen. Deferred komposit-FK:er fryser
ursprungligt tekniskt target, reciprocal OOC-revision, observerat absolut
huvud, exakt teknisk restaureringskälla och reciprocal skapad revision.
Migrationen ersätter 0020:s uttryckligen tillfälliga entry-unika OOC-index
med ett icke-unikt race-/entry-/revisionsindex utan att skriva om historiska
rader. Vid incident droppas inga enumvärden, kolumner, journaler eller
historiska revisioner: inaktivera 006L-routes/CLI, spärra credentials och
rätta framåt additivt, eller återställ en verifierad full PostgreSQL-backup.
Se ADR-0036.

`0022_task_006m_explicit_without_timing.sql` lägger additivt till capabilityn
`DECIDE_WITHOUT_TIMING`, auditaktören `WITHOUT_TIMING_ACCESS_CREDENTIAL`,
revisionsorsaken `MANUAL_WITHOUT_TIMING`, en nullable unik
without-timing-provenienskolumn och den immutable
`without_timing_decision`-journalen. Journalens request-, entry-, target- och
resultnycklar, exakta checks (`without-timing-v1`, `NT`, `WITHOUT_TIMING`) och
tre deferred komposit-FK:er fryser targettuple och reciprocal NT-revision;
credentials med denna capability får gälla högst åtta timmar. Migrationen
skriver inte om befintlig historik och implementerar ingen targetsemantik i
trigger eller SQL-view. Vid incident droppas inga enumvärden, kolumner,
journaler eller historiska revisioner: inaktivera 006M-routes/CLI, spärra
credentials och rätta framåt med en additiv migration, eller återställ en
verifierad full PostgreSQL-backup. Se ADR-0037.

`0023_task_006n_without_timing_withdrawal.sql` lägger additivt till den
separata capabilityn `WITHDRAW_WITHOUT_TIMING`, auditaktören
`WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_WITHOUT_TIMING_WITHDRAWAL`, en nullable unik withdrawalprovenienskolumn
och den immutable `without_timing_withdrawal`-journalen. Deferred
komposit-FK:er fryser originaltarget, reciprocal NT-revision, observerat
absolut huvud, exakt teknisk restaureringskälla och reciprocal skapad
restoration. Migrationen ersätter endast 0022:s uttryckligen tillfälliga
entryunika NT-index med ett icke-unikt race-/entry-/revisionsindex utan att
skriva om befintliga rader. Vid incident droppas inga enumvärden, kolumner,
journaler eller historiska revisioner: inaktivera 006N-routes/CLI, spärra
credentials och rätta framåt additivt, eller återställ en verifierad full
PostgreSQL-backup. Se ADR-0038.

`0024_task_006o_entry_start_time.sql` inför capabilityn
`CHANGE_ENTRY_START_TIME`, auditaktören `ENTRY_START_TIME_ACCESS_CREDENTIAL`
och immutable `entry_start_time_change_request`. Journalen binder aktör,
request, race/entry/klass, tidigare/ny tid och versionsökningar. Befintliga
data skrivs inte om. Vid incident inaktiveras nya routes/CLI och credentials
spärras; rätta framåt additivt eller återställ verifierad full backup. Radera
inte journaler eller enumvärden. En felaktig starttid rättas med en ny
versionsbunden request, inte genom ändring av journalen. Se ADR-0039.

`0025_task_006p_entry_card.sql` lägger till `CHANGE_ENTRY_CARD`, dess auditaktör,
åttatimmarsgräns och immutable `entry_card_change_request`. En ny trigger
skyddar card_assignment mot delete eller ändring av identitetsfält; aktivflaggan
är fortsatt ändringsbar. Befintliga rader och race+bricknummer-index behålls.
Tidigare flera aktiva brickor repareras inte automatiskt. Rollforward eller
verifierad backuprestore används vid incident; stäng den nya ytan och spärra
dess credentials innan rättning. Droppa inte journaler eller enumvärden.

`0026_task_006q_entry_registration.sql` inför `REGISTER_ENTRY`, dess auditaktör,
åttatimmarsgräns och immutable `entry_registration_request`. Journalen fryser
normaliserat intent, actor, request, skapat entry-/assignment-id och snapshot.
Inga befintliga deltagare eller resultat skrivs om. Vid incident stängs nya
routes/CLI och credentials spärras. Rätta framåt med additiv migration eller
återställ verifierad full backup; radera inte journaler eller enumvärden.
Se ADR-0041.

`0027_task_006r_private_operational_start_list.sql` utökar endast det
racebundna säkerhetssubstratet med read-only-capabilityn `VIEW_START_LIST` och
dess åttatimmarsgräns. Inga tabeller, auditaktörer eller tävlingsdata ändras.
Vid incident inaktiveras startlistans routes/CLI och berörda credentials spärras;
rätta framåt med en additiv migration eller återställ verifierad full backup.
Ta inte bort enumvärden eller credentials destruktivt. Se ADR-0042.

Integrationssviten kör migrationsfiler utan filparallellism, eftersom varje
integrationsfil etablerar samma Drizzle-migrationsjournal i sin `beforeAll`.
Det förhindrar konkurrerande schema- och migrationsskapande mot en ny testdatabas.

`0028_task_006s_explicit_start_list_publication.sql` lägger additivt till
`PUBLISH_START_LIST`, dess auditaktör, åttatimmarsgräns och immutable
publiceringsjournal. Incidenthantering sker genom routeavstängning, spärr eller
explicit withdrawal; radera inte beslut, credentials eller enumvärden.

`0031_task_006v_eventor_import.sql` lägger additivt till krypterad, immutable
Testeventoranslutning, separat spärr och importjournal med externa referenser.
Journalens owner- och event/race-FK samt globala externa event-unikhet skyddar
isolerat och atomärt skapande. Inga gamla tävlingar eller credentials ändras.
Vid incident stängs importytan och anslutningen spärras. Rätta framåt eller
återställ verifierad full databasbackup med separat lagrade masterkeys.
Radera inte provenans/journal för att möjliggöra en ny import. Masterkey får
aldrig ingå i databasbackupen. Se ADR-0046.

`0034_task_006w_checkin_recovery.sql` lägger additivt till immutable,
kortlivade recovery-grants, frysta manifestposter, separata spärrar och
delivery-proveniens för exakt befintliga avprickningsoperationer. Den ändrar
inte ursprungscredentialer, enhetsbindningar eller operationer och inför ingen
route eller CLI. Vid incident inaktiveras recovery-ytan; droppa aldrig grant,
kö- eller deliveryhistorik. Rätta framåt med en additiv migration eller
återställ en verifierad full PostgreSQL-backup. Se ADR-0055.
`0035_task_006w_conflict_review.sql` inför immutable granskningsheader/items
enligt ADR-0056. Scope/hash/effect-FK tillåter endast exakt CONFLICT-operation,
och varje originalrequest kan granskas en gång. Gamla rapporter/kvittenser/
resultat ändras inte. Rollback stänger granskningsvägen och bevarar tabellerna;
rätta framåt eller återställ verifierad full PostgreSQL-backup, aldrig delete
för att göra om ett granskningsbeslut.

`0036_task_008_speaker_board.sql` utökar endast det racebundna
säkerhetssubstratet med read-only-capabilityn `VIEW_SPEAKER_BOARD` och dess
åttatimmarsgräns. Inga nya tabeller, index eller auditaktörer införs och inga
tävlingsdata ändras.
Vid incident inaktiveras speakervyns routes/CLI och berörda credentials spärras;
rätta framåt med en additiv migration eller återställ verifierad full backup.
Ta inte bort enumvärden eller credentials destruktivt. Se ADR-0058.

`0037_auth_revocation_mvcc_guard.sql` backfillar en separat härledd MVCC-grind
per race-admincredential och installerar atomiska create/revocation-triggers.
Credential/session/spärrhistorik förblir immutable. Migration krävs före ny
protected-read-helper. Stoppa adminwriters före EXCLUSIVE-tabellåsen;
lock_timeout är fem sekunder. Tabellordning ensam skyddar inte olika
login/logout-låssekvenser. Timeout/deadlock ska avbryta migrationen och följas
av kontrollerat underhållsstopp före retry. Stäng privata läsvägar
vid incident; rulla inte tillbaka till den sårbara låsmodellen. Bevara guards,
rätta framåt eller återställ verifierad full backup och ny helper/triggers.
Ingen generation återställs och inga spärrar raderas. Se ADR-0059.

`0038_task_013_pm_upload.sql` lägger additivt till capabilityn
`MANAGE_PM_DOCUMENT`, dess åttatimmarsgräns och den durabla privata
PM-uppladdningsgrunden: immutable reservationer med raceunika slotar,
debiterade försök, exakt versionsmanifest och ett initialt mutable scanjobb.
Manifestet och dess PENDING-jobb har en deferred korsreferens och måste skapas
i samma transaktion. Inga credentials, objekt eller historiska rader får
raderas för att frigöra kvot; avbrutna reservationer räknas tills en separat
betrodd reconciliation har beslutats. Worker-fencing, scanrapporter,
publicering och HTTP/CLI-aktivering ingår inte i migrationen. Vid incident
stängs den framtida PM-ytan och berörda credentials spärras; rätta framåt eller
återställ verifierad PostgreSQL-backup tillsammans med exakt refererade
objektversioner. Droppa inte enumvärden, reservationer, försök eller manifest.
Se ADR-0061.

`0039_task_013_pm_scan_attempt.sql` lägger en immutable journal per
upload/generation med DB-tidsbaserad femminuterslease. Ingen gammal lease
backfillas med påhittad historik. Stäng PM-worker vid incident; bevara attempts,
jobb och manifest. Rätta framåt eller återställ verifierad PostgreSQL-backup
tillsammans med refererade objektversioner. Återanvänd aldrig äldre fencing-
generation efter restore medan en gammal worker kan leva: stoppa samtliga
workers före restore och starta nya worker-identiteter efteråt. Ingen tabell
eller historik ska droppas som rollback. Migrationen aktiverar inte worker.

`0040_task_013_pm_scan_report.sql` lägger immutable rapporter med exakt
attempt/owner-FK, evidenshash och DB-recorded_at. Alla rapporter i första
profilen har publishable=false, även PASSED; ingen godkänd produktionsprofil
är beslutad genom denna migration. Befintliga FINISHED-jobb får inga
fabricerade rapporter. Stäng worker/PM-vägar vid incident, bevara rapporter
och rätta framåt. Restore kräver verifierad PG-backup med objektversionerna
och stoppade gamla workers enligt 0039-noten. Droppa inte historik eller
återanvänd generationer som rollback. Ingen scanner eller route aktiveras.

`0041_task_026_entry_identity.sql` lägger separat capability/actor och immutable
namn-/klubbrättningsjournal med racebundna entry/class/actor-FK. Inga befintliga
entries eller resultat uppdateras. Vid incident stäng rättningsytan, spärra
dess credentials och rätta framåt eller återställ verifierad PostgreSQL-backup.
Radera inte journaler eller enumvärden som rollback. Tidigare exporter och
offlinepaket ska bevaras. Se ADR-0067; migreringen är inte UI-acceptans.

`0042_task_029_race_administrator.sql` lägger explicit MANAGE_RACE och sann
administratörsaktör samt högst åtta timmars credentiallivslängd. Inga gamla
credentials uppgraderas och ingen tävlingsdata ändras. Stäng nya adminroutes
och spärra administratörscredentials vid incident; radera inte enumvärden eller
journaler. Använd additiv rättning eller verifierad backuprestore. Migrationen
inför inte platsgränser eller nytt klass-/startbyteskontrakt. Se ADR-0069.

`0043_task_029_entry_transfer.sql` lägger immutable journal för atomiskt byte
av klass och starttid. Äldre entries/journaler ändras inte av migrationen.
FK binder entry, båda klasser och sann administratör till race. Stäng nya
transfer-routes vid incident, bevara historiken och rätta additivt eller
återställ verifierad backup. Radera inte journaler för att ångra ett byte.
Platstak införs inte här; se ADR-0069/TASK029.

`0044_task_029_class_capacity.sql` lägger nullable klassgräns, separat positiv
capacityVersion och immutable ändringsjournal. Befintliga klasser har null,
ingen deltagare flyttas och resultat/snapshot ändras inte av migrationen.
Vid incident stäng setters och bevara gränser/journaler; rätta additivt eller
återställ verifierad backup. Alla rosterwriters måste driftsättas tillsammans
med setters, annars kan äldre kod kringgå taket. Se ADR-0070.

`0046_task_054_administrative_checkin_source.sql` utökar device-källans check
med MANAGE_RACE och lägger unik credential per sådan källa. Stäng den
administrativa skrivvägen före incident; ta inte bort check/index medan källor
eller journalrader finns. Rätta framåt eller återställ verifierad backup utan
att radera historik. Se ADR-0091.

`0054_task_085_unknown_readout_resolution.sql` lägger den särskilda tekniska
revisionsorsaken `UNKNOWN_READOUT_RESOLUTION` och en immutable, racebunden
journal som binder exakt ursprunglig `card_readout`/råpost till beslutad Entry,
brickkoppling och skapad resultatrevision. Den första `device_ingest_outcome`
ändras inte. Vid incident stängs writer/UI; bevara rådata, journal,
brickkopplingar och revisioner och rätta framåt eller återställ en verifierad
full PostgreSQL-backup. Droppa aldrig enumvärdet eller en befolkad journal som
enskild rollback.

`0058_task_093_manual_finish_time_correction.sql` lägger den särskilda
revisionsorsaken `MANUAL_FINISH_TIME_CORRECTION`, dess append-only journal och
en deferred reciprok FK mellan journalen och precis en skapad resultatrevision.
Journalen fryser källa, readout, gammal/korrigerad måltid, racebunden aktör,
versionslås, hash och request/response. Inga rådata, readouts eller äldre
revisioner ändras. Vid incident stängs writer/UI; bevara journal och
proveniens, rätta framåt eller återställ verifierad full PostgreSQL-backup.
Droppa aldrig enumvärdet eller en befolkad journal som enskild rollback.

`0060_task_094_manual_finish_time_correction_withdrawal.sql` lägger en separat
append-only återtagandejournal och enbart den nya revisionsorsaken
`MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL`. Den binder exakt TASK093-källa,
rättad revision och en ny återställningsrevision genom deferred reciproka FK.
Vid incident stäng writer/UI och bevara journaler/revisioner; rätta framåt eller
återställ verifierad full PostgreSQL-backup. Droppa aldrig enumvärde, index eller
befolkad journal som enskild rollback.

`0078_task_151_event_coadministration.sql` lägger enumvärdet `ADMIN`, behåller
unikheten för en `OWNER` per konto/event och ersätter den globala rollunikheten
så att återkallade ADMIN-grants kan bevaras och en senare tilldelning får nytt
grant-id. Den skapar `event_administration_access_request` med immutable
GRANT/REVOKE-request-id, actor-, event-, target- och grant-FK samt index för
event- och actortidslinjer. Befintliga grants och spärrar skrivs inte om.
Vid incident stäng TASK151:s grant-rutter och bevara grants, återkallelser och
requestjournaler; rätta framåt eller återställ verifierad full PostgreSQL-
backup. Droppa aldrig ADMIN-enumvärdet eller journalen som enskild rollback.
Se ADR-0145.
