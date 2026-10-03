# TASK057: deltagarens start- och återkomsthistorik

Status: implementerad 2026-09-12 enligt ADR-0094; riktad acceptans passerad.

Visa journalen för vald deltagare i gemensam adminvy: startmarkering,
återkomsträttning, källroll, observationstid, serverns mottagningstid och
faktisk effekt. Konflikter får inte se ut som genomförda ändringar.
Kompakt tabell med högst50 rader per sida och explicit äldre/nästa sida.
Inga nya skrivfunktioner, roller eller inloggningar.

Berör contracts, application readservice och web route/UI. Befintlig journal
är källa; ingen migration, ny resultatlogik eller offlinekö. Återanvänd
mönstret för deltagarens avläsningshistorik, inte hela loppets rosterhämtning.

Riktad acceptans: admin/start/målkälla, APPLIED/UNCHANGED/CONFLICT, stabil
sidgräns vid samma mottagningstid, fel deltagare/lopp/cursor, läsning utan
mutation samt rensning vid logout/deltagarbyte. Utöka befintligt syntetiskt
PG-underlag och ett browserfall; berörda lint/typecheck/build. Ingen full
regression eller fysisk hårdvara behövs för lässnittet.

## Utfall

Privat paginerad lästjänst, route och kompakt journal i adminvyn är klara.
UI visar25 rader per sida (tjänsten tillåter1–50), exakt cursor och separat
observation/mottagning. Deltagarbyte, logout och andra operationer rensar
journalunderlaget. Ingen beständig browsercache eller mutation tillkom.

Ett PostgreSQL-prov passerade (1,04s): tre källroller/effekter, lika tider,
scope/cursor och oförändrad journal/resultat. Tre andra grupper valdes bort.
Ett browserfall passerade (6,9s):25+3 rader, konflikt, tom deltagarjournal,
deltagarbyte/logout och oförändrad lagring. Exakta lint/typecheck/build-
resultat och första misslyckade testförsök finns i docs/status.md.

Endast serverlagrad historik visas. Osynkade observationer saknas tills de
lagrats; tidsordningen är mottagningsordning, inte orsakssamband. Fysisk mobil,
produktion och full offline/recovery-regression är inte verifierade.
