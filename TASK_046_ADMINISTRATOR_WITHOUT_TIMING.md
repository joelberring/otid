# TASK046: utan tidtagning och återtagande

Status: klart avgränsat snitt 2026-09-12. ADR-0084 före implementation.

Integrera befintlig NT/withdrawal i gemensam MANAGE_RACE-vy. Endast direkt
tekniskt OK/COMPLETE får bli NT. Ingen aktiv tid/placering; rådata bevaras.
Återtagande återställer exakt granskad teknisk OK/MP. UI måste varna att
aktiv NT blockerar IOF-export och finalisering enligt ADR-0037/0038.

Application policy/audit, web routes/helpers/UI. Ingen migration/dependency.
Riktade policy/helpertester och ett HTTP/PG-browserfall, lint/typecheck/build.
Ingen bred regressionsmatris eller verklig tävlings-/hårdvarudata.

Verifierat: lint/typecheck/build exit0; policy2, helpers4 och browser1pass
(14,0s). NT döljer tid, varningen är synlig, senare teknik bevaras och
återtagande/retry skapar exakt en restaurering. Mobilbild granskad.
Kvar: endast tekniskt OK kan bli NT; aktiv NT blockerar IOF/finalisering.
Fysisk mobil/produktion och full regression ej provade.
Nästa minsta uppgift: IOF-resultatexport med samma administratörsinloggning.
