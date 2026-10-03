# ADR-0082: manuellt godkännande i gemensam administration

Status: Accepterad. Datum: 2026-09-12. TASK044.

ADR-0069 utökas uttryckligen med APPROVE_RESULT och WITHDRAW_RESULT_APPROVAL.
ADR-0032:s krav på separata funktionssessioner ersätts för MANAGE_RACE, inte
för äldre begränsade roller. Audit använder sann adminprincipal; exakt retry
förblir bundet till ursprunglig aktör och hela intentet.

Befintlig resultatpolicy behålls: tidskomplett tekniskt MP/MISSING_CONTROL
eller WRONG_ORDER kan bli OK/MANUAL_APPROVAL utan fabricerade stämplingar.
Senare ingest bevaras under aktivt beslut. Återtagande binder exakt absolut
huvud och teknisk restaureringskälla och appendar en revision, utan fallback.

Gemensamma admincookies, MANAGE_RACE-preflight, Origin/CSRF, strikt4KiB body
och no-store används. UI fryser underlaget och återförsöker samma request-id
efter okänt svar. Kvittens binder nästa revision och restaurerad status/reason.
Resultatpåverkan visas direkt, tekniska detaljer i utfällbar sektion. Ingen
beständig offlinekö eller ny resultatmotor införs. Ingen migration behövs;
befintlig actor-FK/audittyp stödjer admin. Ingen ny domän-/teknik-/licensgräns.
Vid incident stängs nya adminåtgärder och historiska beslut/revisioner bevaras.
