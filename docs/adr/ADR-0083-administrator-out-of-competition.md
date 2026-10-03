# ADR-0083: utom tävlan i gemensam administration

Status: Accepterad. Datum: 2026-09-12. TASK045.

MANAGE_RACE integrerar uttryckligen DECIDE_OUT_OF_COMPETITION och
WITHDRAW_OUT_OF_COMPETITION enligt ADR-0069. Separata funktionssessioner i
ADR-0035/0036 ersätts för administratören, inte för äldre begränsade roller.
Verklig principal och RACE_ADMIN_ACCESS_CREDENTIAL journalförs. Exakt retry
förblir bundet till aktör och hela intentet.

Resultatpolicy, teknisk källunion, lås och append-only livscykel behålls.
OOC bevarar tekniska fakta men är orankat. Senare teknik lagras under aktivt
beslut; återtagande binder absolut huvud/exakt källa och appendar restaurering.
Ingen OOC utan direkt tekniskt OK/MP eller direkt på manuell restaurering.

Gemensamma cookies, MANAGE_RACE-preflight, Origin/CSRF, strikt4KiB request och
no-store. UI visar status/placeringspåverkan direkt och revisioner utfällbart.
Fryst intent återförsöks med samma request-id; kvittens binder nästa revision
och restaurerad status/reason. Bara minne, ingen ny beständig offlinekö.
Ingen migration, ny dependency eller ändrad teknik-/domän-/licensgräns.
Vid incident stängs de nya adminåtgärderna; beslut och rådata bevaras.
