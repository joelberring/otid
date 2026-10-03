# ADR-0091: ärlig administrativ källa för manuell återkomst

Accepterad 2026-09-12 som implementeringsriktning för TASK054.
Ingen funktion är aktiverad av detta dokument.

## Bakgrund

`start_checkin_device` begränsar capability till START_CHECKIN eller
FINISH_FOREST_WATCH. Dess composite-FK binder aktör, lopp och capability till
en riktig credential. Operationer binds i sin tur till denna källas scope.
En MANAGE_RACE-session får därför inte maskeras som en målpersonalscredential.

## Beslut

Inför en serverhanterad administrativ källa med faktisk MANAGE_RACE-capability
i befintlig checkin-journal. Källan är onlineadministration, inte en fysisk
avprickningsenhet eller offlinekö. Behåll en stabil källa per admincredential;
servern tilldelar sekvens under källans lås. Ingen ny credential skapas.

Ett nytt smalt adminintent innehåller request-id, deltagare, granskade
entry-/checkin-/underlagsversioner och observationstid. Det får endast sätta
manuell återkomst till true och behålla granskad startstatus. Det får inte
fabricera STARTED, nollställa återkomst eller generera valfri FINISH_CORRECTION.
Race/actor/device/sequence härleds på servern efter riktig MANAGE_RACE-auth.

Återanvänd befintlig interna checkin-writer/domänplan. Granskningen måste
upplysa om eventuell checkin-DNS-effekt; konflikt avvisas/kvitteras enligt
befintlig journal, aldrig som lyckad återkomst. Retry binds till ursprunglig
avsikt och aktör även efter senare ändringar; historik skrivs inte om.

## Kompatibilitet och verifiering

Migration utvidgar device-check till MANAGE_RACE och skyddar den stabila
admin-källans unikhet. Credential-FK behålls. Historiska source-/DNS-validatorer
måste förstå nya källan innan den får skriva operationer. Audit använder
RACE_ADMIN_ACCESS_CREDENTIAL. Befintliga offline-/recovery-registrerings-
kontrakt för personal utvidgas inte.

Rosterprojektionens enhetslista ska fortsatt beskriva personalens synkkällor,
inte framställa onlineadmin som en offlineenhet. Administrativa operationers
effekt måste ändå ingå i rapporten. Kontrollera särskilt äldre strikta
rosterkontrakt och konfliktunderlag innan någon ny källa aktiveras; inget
okänt capability-värde får oavsiktligt bryta offlineklientens inläsning.

## Återställning

Stäng skrivvägen först. Rulla inte tillbaka utvidgad check medan administrativa
källor finns. Behåll läs-/källkompatibilitet och historik; återgång till äldre
schema kräver verifierad återställning från backup, inte borttagna journalrader.
Ingen ny teknik eller ändrad domängräns; migration och riktade PG-prov krävs
innan uppgiften kan kallas klar.
