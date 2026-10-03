# TASK041: Avbrutit lopp och rättning med samma administratör

Status: klart avgränsat snitt 2026-09-12. ADR-0080 före implementation.

Gemensam arbetsvy får Avbrutit lopp (DNF), både beslut och återtagande med
samma MANAGE_RACE-session. Befintlig ADR-0033/0034 återanvänds: beslut kräver
aktuellt direkt tekniskt OK/MP-underlag. DNF utan avläsning stöds alltså inte
i detta integrationssnitt och UI måste förklara det. Ingen automatisk DNF från
saknad målavläsning. Resultatmotor, station och ingest ändras inte.

Återtagande binder exakt granskad restaureringskälla och appendar en ny
resultatrevision; original och senare teknik bevaras. Samma pendingintent/
idempotensnyckel vid okänt svar, inga nya inloggningar. Ny resultatremsa efter
kvittens, sparatmeddelande bevaras om efterläsning misslyckas.

Berör application policy/audit och web HTTP/workspace. Ingen migration.
Acceptans: admin/äldre roller, besluta/återta, verklig audit, exactretry, senare
teknik under DNF, oförändrad raw/history, återställd teknisk källa. Riktad PG,
HTTP/browser och lint/typecheck/build; inga verkliga tävlings-/hårdvarudata.

Verifierat: application/web lint, typecheck och build exit0. Policy2,
PostgreSQL2, HTTP/helpers21 och browser5 godkända (30 olika fall).
Browserkedjan avläsning → DNF → senare avläsning → återtagande provar exakt
retry efter tappade svar vid båda besluten. Revision1–3 och rådata bevaras;
revision4 återställer exakt teknisk revision3. Kvittensvalidering binder även
nästa revisionsnummer och återställd status/reason till granskat underlag.
Detaljerade kommandon/resultat och initialt rättat typfel finns i docs/status.md.

Kvar: DNF utan avläsning eller direkt på manuell restaurering stöds inte.
Fysisk mobil, produktionslast och verklig hårdvara är inte verifierade.
Nästa minsta snitt: diskvalificering och rättning med samma administratör.
