# TASK044: manuellt godkännande med samma administratör

Status: klart avgränsat snitt 2026-09-12. ADR-0082 före implementation.

Anslut befintligt manuellt godkännande och återtagande till MANAGE_RACE och
gemensam kompakt arbetsvy. ADR-0032 gäller: endast tidskomplett tekniskt MP
med MISSING_CONTROL/WRONG_ORDER kan godkännas. Inga tider/stämplingar skapas.
Beslut kvarstår över senare teknik; återtagande återställer exakt granskad
teknisk OK/MP-källa i en ny revision. Historik och rådata bevaras.

Berör application policy/audit, web routes/helpers/UI och riktade tester.
Acceptans: admin/äldre roller, sann audit, inga fabricerade resultat, exakt
retry, sen ingest och granskad restaurering. Kompakt statuspåverkan direkt,
tekniska revisionsdetaljer utfällbara. PG/HTTP/browser samt lint/typecheck/build.
Inga nya teknikval, migrationer, dependencies, externa API:er eller hårdvara.

Verifierat: application/web lint, typecheck och build exit0. Policy2, PG3,
HTTP/helpers24 och browser7 godkända (36 olika fall). Browser visar MP→OK,
senare MP under aktivt godkännande och explicit återtagande till exakt MP.
Kompakt review, tangentbordsdetaljer, tappade svar och byteidentiskt retry
provas. Raw och originalrevisioner bevaras. Mobil/desktop visuellt granskade.
Se docs/status.md för kommandon/resultat och initialt rättat testmockfel.

Kvarvarande begränsningar enligt ADR-0032: inget godkännande utan tidskomplett
tekniskt MP/MISSING_CONTROL eller WRONG_ORDER. Ingen fysisk hårdvaru- eller
produktionsacceptans i detta snitt. Nästa minsta uppgift: utom tävlan och
återtagande med samma administratörsinloggning.
