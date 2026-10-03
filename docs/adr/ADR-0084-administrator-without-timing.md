# ADR-0084: utan tidtagning i gemensam administration

Accepterad 2026-09-12, TASK046.

MANAGE_RACE integrerar DECIDE_WITHOUT_TIMING och WITHDRAW_WITHOUT_TIMING.
Separata funktionssessioner i ADR-0037/0038 ersätts endast för administratören.
Verklig adminprincipal journalförs; äldre roller och exakt aktörsbundet retry
behålls. Befintlig OK/COMPLETE-policy, status-only NT, exportspärr och exakt
append-only restaurering ändras inte. Ingen migration eller ny domängräns.

Gemensamma cookies/Origin/CSRF/no-store, strikt4KiB request. UI fryser intent,
visar statuspåverkan/exportspärr direkt och revisioner utfällbart. Kvittens
binder nästa revision och restaurerad status/reason. Ingen ny offlinekö.
Vid incident stängs nya adminåtgärder; rådata och journalhistorik bevaras.
