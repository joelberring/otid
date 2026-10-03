# TASK224: läsande kontroll av systemds laddade writerprofil

Status: läsande kontroll kodad och syntetiskt verifierad 2026-09-27;
Linuxacceptans återstår.

## Användarutfall

En operatör på en disponibel Linux-installation ska kunna kontrollera att
systemd faktiskt har laddat samma tre writer-enheter som TASK213/214 har
förberett på disk. Ett grönt filprov ensamt räcker inte om manager-minnet har
en gammal version, en drop-in, ett alias eller en extra `otid-*`-enhet.

## Gräns och beslut

Detta är ett ytterligare **läsande** förprov inom ADR-0160:s redan beslutade
systemd-v1-gräns. Teknikval, writeruppsättning och domängränser ändras inte;
ingen ny ADR krävs. Kontrollera bara den befintliga allowlistan med webb,
databasmigration och fast speaker-spärrning. Börja och sluta med TASK213:s
diskpreflight. Mellan dessa läses systemds laddade effektiva egenskaper och
dess inventering. Avvikelse, okänt format, otillgänglig manager eller
ofullständig bevisning ska ge `NOT_ACCEPTED`, inte antas vara säkert.

Använd endast läsande `systemctl`-anrop utan shell, exempelvis `show`,
`list-units` och `list-unit-files`. Kontrollera kanoniska unitnamn,
fragmentväg, inga drop-ins/transientkällor, ingen väntande reload, identitet,
exekveringsväg, gemensam stängd-markör och credentialkällornas **namn och
vägar**. Läs aldrig credentialinnehåll. Rå systemd-output får inte skrivas i
logg eller feltext. Programmet får inte köra `daemon-reload`, installera,
enable/start/stop/restart, skapa eller ta bort markör, skriva kvittens eller
åberopa backupspärr. Aktiva tillstånd redovisas, men ingen aktiv process
anses därigenom dränerad.

Den exakta parsningen är avsiktligt fail-closed och behöver provas mot
den senare valda Linux-/systemd-versionen. Ett syntetiskt grönt test visar
endast att kontrollens beslutsregler fungerar. Källor för systemds
`show`/unitinventering och credentialmodell: [systemctl-manualen](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html),
[systemd D-Bus-egenskaper](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.systemd1.html)
och [systemd credentials](https://systemd.io/CREDENTIALS/).

## Riktad kontroll

Syntetiska, injicerade kommandosvar ska täcka godkänd exakt profil, stale
manager/reloadbehov, drop-in/alias/transient/extra enhet, felaktig
identitet/credential/kommando och felaktig eller osäker råoutput. Kör riktad
Node-test, lint och syntaxkontroll; kör inte hela produktens testmatris.

Ingen sådan kontroll ersätter TASK180:s verkliga negativa Linuxprov med
process-/credentialisolering, dränering och in-flight-objektsteg. Den
tekniska writer-stop-grinden förblir öppen tills den acceptansen finns.

## Utfall

`ops/systemd/check-loaded-writer-profile.mjs` läser bara systemmanager
med absoluta `systemctl`-anrop och en fast minimal processmiljö. Det
återanvänder TASK213:s diskpreflight och enda allowlista före/efter
managerläsningen. Exakt tre laddade och installerade `otid-`-enheter måste
finnas; annan unittyp, alias, drop-in, transient källa och väntande reload
avvisas. Laddad identitet, startkommando, markör och credentialnamn/-vägar
jämförs. Aktivt tillstånd återges endast som observation. Råoutput och
credentialinnehåll loggas inte. CLI:n ger uttryckligen `NOT_ACCEPTED` även
efter grön preflight.

Riktade Node-prov för ny och befintlig preflight: **10/10, exit 0**.
Riktad ESLint för ändrade `.mjs`-filer: **exit 0**. `node --check` för
de tre filerna: **exit 0**. Ingen typecheck/build finns för detta rena
Node-ops-snitt och ingen bred produktmatris kördes. Värdena kom från
syntetiska, injicerade kommandosvar; varken Linuxmanager, PostgreSQL,
MinIO, riktig tävling eller hemliga credentials användes.
Direkt CLI-anrop på Mac nekades som avsett med **exit 1** och
`LOADED_WRITER_PROFILE_PREFLIGHT_FAILED; NOT_ACCEPTED`.

Kvarvarande antagande är att den senare valda systemd-versionens
`show`-fält och listformat motsvarar den strikta parsningen. Avvikande
format ger avslag. Särskilt full fysisk writer-/credentialisolering,
in-flight-dränering, återöppning och installationsägt stopp är ännu inte
bevisade.
