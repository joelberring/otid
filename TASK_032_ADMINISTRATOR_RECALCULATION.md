# TASK032: Explicit omräkning i gemensam arbetsvy

Administratören ska kunna granska och räkna om vald deltagare efter en
klass-/brick-/starttidsändring utan en ny inloggning. ADR-0073 beslutad före kod.
Ingen automatisk omräkning, nytt resultatstatus eller ändring av manuella beslut.

Berör application (roll/audit), web (skyddade routes, kandidat-/kvittensbindning
och en fjärde åtgärd). Befintliga contracts/schema återanvänds utan migration.
Acceptans enligt ADR: verklig PostgreSQL och browser, exakt retry och bevarad
historik, riktad lint/typecheck/test/build. Inga privata tävlingar i prov.

Status: avgränsat flöde implementerat och verifierat 2026-09-12. Browser
provar faktisk starttidsrättning→omräkning med samma session och tappat svar;
PG provar bevarad manuell DSQ. Exakta kontroller i docs/status.md.
Full produkt-/hårdvaru-/produktionsacceptans kvarstår.
