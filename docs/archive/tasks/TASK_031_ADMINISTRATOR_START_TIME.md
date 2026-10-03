# TASK031: Individuell starttidsrättning med gemensam inloggning

Administratören ska kunna rätta fast starttid utan klassbyte från samma
deltagarvy som klass-/brickbyte. Åtgärdsväljare håller bara ett formulär öppet.
ADR-0072 beslutad före implementation; befintliga ADR-0039/0063 bevaras.

Berör application (roll/audit/precisionskontroll) och web (route/editor).
Ingen migration, ny dependency, startregel eller resultatmotorändring.

Acceptans: FIXED kan rättas, PUNCH kan inte skrivas, full intentkvittens,
exakt retry, verklig adminaudit och skydd mot tyst SQL-tidsavrundning.
Riktig PostgreSQL och browser i mobil-/datorbredd; riktad lint/typecheck/
tester/build. Inga privata tävlingar eller riktiga credentials i prov.

Status: avgränsat flöde implementerat och verifierat 2026-09-12. Riktig
browser/HTTP/PostgreSQL provar tidsrättning utan klassbyte och exakt retry,
med samma session som klass-/brickbyte. Se docs/status.md för slutkontroller.
Fullt medlemsregister, automatisk omräkning och
produktions-/hårdvaruacceptans ingår inte. Huvudmålet kvarstår.
