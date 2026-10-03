# TASK061: tid sedan rapporterad start i kvar-i-skogen

Status: implementerad 2026-09-12 enligt ADR-0096; riktad acceptans passerad.

Visa tydligt märkt tid sedan rapporterad start för startad utan återkomst.
Använd startmarkeringens observationstid och rapportens generatedAt, aldrig
planerad start eller mobilens aktuella klocka. Saknad/framtida tid är okänd.

Berör rent domain-stöd, separat adminprojektion/contracts, application och
webrapport/print. Personalens offlinekontrakt förblir oförändrat.

Acceptans: start→återkomsträttning behåller startobservationen; ändrad
startstatus nollställer den; ny start väljer ny observation; konflikt/no-op
flyttar inte tiden; ofullständig kedja avvisas. Riktat PG-prov av källval
och oförändrat personalresponse, ett UI-prov av känd/okänd/gammal rapporttid.
Berörda lint/typecheck/build, ingen full regression eller fysisk hårdvara.

Delsteg klart: rent reportedStartAt-stöd väljer början på aktuell STARTED-
period och avvisar ofullständig/motsägande revisionskedja. Ett riktat prov
passerar (216ms); domain lint/typecheck/build exit0. Dessa första kontroller
gällde bara domänstödet före integrationen nedan.

Integration klar: separat administratorForestWatchResponseSchema innehåller
reportedStarts medan personalens response är oförändrad. Application använder
hela verifierade APPLIED-kedjan endast för adminutvidgningen. UI/print visar
hela minuter vid generatedAt för STARTED_NO_RETURN, uttryckligen ej löptid.
Saknad/framtida observation ger okänd tid; gammalmarkering behålls.

PG1pass (996ms) inklusive schema/legacy-kompatibilitet och oförändrat resultat;
UI2pass (457ms) inklusive gammal/framtida tid; browser1pass (8,9s) genom verklig
route. Orelaterade grupper valdes bort. Fysisk mobil, verkliga klockfel och
produktion är inte verifierade. Exakta kommandon/resultat finns i status.
