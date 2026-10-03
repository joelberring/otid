# ADR-0081: Diskvalificering i gemensam administration

Status: Accepterad. Datum: 2026-09-12. TASK042.

Enligt ADR-0069 integreras DISQUALIFY_RESULT och WITHDRAW_DISQUALIFICATION
uttryckligen i MANAGE_RACE. ADR-0031:s separata funktionslogin ersätts för
tävlingsadministratören, inte för äldre begränsade roller. Verklig principal
och RACE_ADMIN_ACCESS_CREDENTIAL ska journalföras; exakt retry binds till
ursprunglig aktör. Befintliga lås, revisionsmodell och resultatpolicy behålls.

Gemensamma adminroutes för kandidater, beslut och återtagande använder samma
cookie, MANAGE_RACE-preflight, Origin/CSRF, no-store och strikt 4KiB request.
UI fryser granskad entry/klass/bana/snapshot och exakta resultatversioner.
Återtagande binder absolut huvud och teknisk restaureringskälla. Kvittens
validerar exakt nästa revision och återställd status/reason. Samma intent och
request-id återanvänds efter okänt svar; ingen beständig offlinekö påstås.

DSQ kräver befintligt aktuellt direkt tekniskt OK/MP-underlag. Senare ingest
bevaras utan att upphäva beslutet. Återtagande appendar exakt restaurering;
rådata och originalhistorik muteras aldrig. Begränsningarna visas i UI.
Ingen ny resultatstatus, domängräns, teknik, dependency eller migration.
Vid incident stängs nya adminåtgärder; historiska beslut och revisioner bevaras.
