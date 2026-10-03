# TASK030: Brickbyte i gemensam tävlingsadministration

Administratören ska välja deltagare och byta bricka i samma arbetsvy och
inloggning som klass-/starttidsbyte. Se ADR-0071, beslutad före implementation.

Berörda paket: contracts (sammanhängande underlag), application (roll/audit
och projektion), web (route/kompakt editor). Ingen databasmigration behövs.

Acceptans: gemensam session, aktuell bricka och tydlig konflikt vid flera
kopplingar, explicit granskning, exakt retry, sann auditaktör, bevarade gamla
brickkopplingar/rådata/resultat. PostgreSQL-regression och två browserbredder,
riktad lint/typecheck/test/build. Inga verkliga tävlingar eller hemligheter.

Status: avgränsat flöde implementerat och verifierat 2026-09-12. Samma riktiga
browserkedja som TASK029 utför nu även brickbyte med tappat svar/exakt retry.
Se docs/status.md för exakta kontroller och begränsningar.
Fullt administratörskonto/medlemsregister och automatisk
omräkning ligger utanför detta snitt; huvudmålet för produkten kvarstår.
