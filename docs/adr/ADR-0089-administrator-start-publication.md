# ADR-0089: startlistepublicering i gemensam administration

Accepterad 2026-09-12, TASK051.

MANAGE_RACE integrerar PUBLISH_START_LIST. Befintlig separat roll och
publiceringspolicy behålls. Audit anger faktisk adminprincipal. Granskning
är privat; endast explicit PUBLISH gör fryst innehåll offentligt. WITHDRAW
stoppar nya hämtningar men raderar inte redan sparade externa kopior.

Samma lås, versions-/hashkontroller, aktörsbunden retry och gemensam
Origin/CSRF/session. Klientens intent fryser granskade uppgifter och
kvittensen binds till race/request/revision/action och för publicering hash.
Ingen ny teknik/domängräns/migration eller automatisk offentliggörande.
Återställning av nya UI/routes förändrar inte bevarad publiceringshistorik.
