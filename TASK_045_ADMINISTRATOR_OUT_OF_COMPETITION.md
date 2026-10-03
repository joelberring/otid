# TASK045: utom tävlan och återtagande med samma administratör

Status: klart avgränsat snitt 2026-09-12. ADR-0083 före implementation.

Anslut befintligt individuellt OOC-beslut och återtagande till MANAGE_RACE och
kompakt gemensam adminvy. ADR-0035/0036 gäller oförändrat: aktuellt direkt
tekniskt OK/MP krävs, fakta bevaras och OOC deltar inte i placering. Senare
ingest upphäver inte beslutet; rättning återställer exakt granskad teknisk källa.

Berör application policy/audit, web routes/helpers/UI och riktade tester.
Acceptans: admin/äldre roller, exakt retry och sann audit, senare teknik,
restaurering till OK/MP och rådata/historik intakta. Kompakt före/efter med
utfällbara revisioner. PG/HTTP/browser samt lint/typecheck/build. Ingen ny
migration, dependency, teknik-/domängräns, extern API eller hårdvara.

Verifierat: berörda paket lint/typecheck/build exit0; policy2, klienthelpers4
och riktad riktig HTTP/PG-browser1 godkända. Ingen bred regressionskörning.
Browser bevarar raw/revision1–3, återställer exakt källa3 i revision4 och
retryar båda besluten byteidentiskt. Begränsade roller enbart policyprovade
i detta snitt; ingen ny separat PG-matris. Fysisk mobil/produktion ej provade.
Nästa minsta uppgift: utan tidtagning och återtagande i samma adminvy.
