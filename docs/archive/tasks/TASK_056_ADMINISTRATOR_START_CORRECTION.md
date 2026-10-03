# TASK056: rätta startmarkering från gemensam admin

Status: implementerad 2026-09-12 enligt ADR-0093; riktad acceptans passerad.

Välj deltagare i befintlig adminvy, uppdatera kvar-i-skogen, välj korrekt
startmarkering, granska och bekräfta. Behåll återkomst, rådata och historik.
Startmarkering är inte planerad starttid eller startstämpling.

Berör contracts (målstatus och kvittens), application (gemensam serverkälla,
separat MARK_START-wrapper och källvalidering), web (route och befintlig
rapportyta). Ingen ny tabell, roll, offlinekö eller resultatmotor.

Riktad acceptans: felaktig ej startande→startad återkallar checkin-DNS;
manuell återkomst bevaras; negativ markering efter återkomst ger konflikt;
gamla versioner och ändrad avsikt ger konflikt; exakt replay efter senare
rättning får inte ändra aktuellt läge. Återkomstanrop får fortsatt inte byta
startstatus. Ett genomgående browserfall inklusive tappat svar och exakt
retry; berörda lint/typecheck/build. Ingen bred regressionsmatris.

## Utfall

Separat versionsbundet kontrakt och POST-anrop använder samma administrativa
källa, journal och domänplan som återkomstflödet. Granska/bekräfta i befintlig
rapportyta med fryst retry, inga nya inloggningar. MARK_START skiljer avsikten
från återkomstanropens FINISH_CORRECTION. Källvalidatorer läser båda.

Tre kontraktsprov (431ms), tre PostgreSQL-prov (1,45s) och ett browserprov
(8,1s) passerade. PG omfattar även gammal personalroster efter rättning.
Browser: ej startande→startad, avbryt, tappat svar, exakt retry och uppdaterad
kvar-i-skogen. Ingen fysisk mobil, startstation eller produktion verifierad.
Administrativ markering förutsätter korrekt mänsklig observation och nät;
den får inte tolkas som en tidtagningsstämpel. Full offline/recovery-regression
ingår inte. Exakta kontroller och första misslyckade försök finns i status.
