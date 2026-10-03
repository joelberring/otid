# ADR-0087: explicit finalisering i gemensam administration

Accepterad 2026-09-12, TASK049.

MANAGE_RACE integrerar FINALIZE_RESULTS. Befintlig separat roll behålls.
Verklig adminprincipal journalförs som RACE_ADMIN_ACCESS_CREDENTIAL, inte
som begränsad finaliseringsroll. Samma låsning, aktörsbundna idempotens och
versions-/basis-kontroller som befintlig application används.

Adminroute validerar 4KiB body, key, kvittens och gemensam Origin/CSRF/session.
UI visar blockerare i vald scope, fryser avsikt för explicit bekräftelse och
behåller den vid osäkert svar. Andra mutationer blockeras under granskning/retry.
Lopp kan fastställas först när befintliga klass-/täckningskrav är uppfyllda.
Ingen ny resultatpolicy, domängräns, migration eller offlinefinalisering.
Frysta tidigare filer bevaras. Återställning tar bort endast nya adminvägen.
