# TASK048: redan fastställda resultat i gemensam administration

Klart avgränsat snitt 2026-09-12. ADR-0086 före implementation.

Visa befintliga loppfinaliseringar och ladda ner vald oföränderlig IOF
Complete-fil med samma adminsession. Kompakt väljare, revision/datum och
antal deltagare; historiska filer påstås inte motsvara dagens resultat.

Web route/UI återanvänder application-tjänster, contracts och hashkontroll.
Ingen ny behörighet, resultatändring, migration eller finaliseringsåtgärd.
Riktat routeprov och ett HTTP/PG-browserprov, lint/typecheck/build för web.
Ingen bred regression. Inga verkliga personuppgifter eller externa anrop.

Verifierat: riktade HTTP2pass (TASK047/048); Snapshot-browser godkänt och
Complete-browser1pass6,6s efter rättad testselektor. Riktig application-
finalisering som syntetisk fixture; senare ingest ändrar inte exporterade
historiska bytes/hash eller finaliseringsrader. Historik rensas vid logout.
Lint/typecheck/build redovisas i docs/status.md. Ingen fysisk mobil eller
produktionsverifiering, ingen ny finaliseringsrätt i adminvyn.
Nästa minsta uppgift: granska och uttryckligen fastställa resultat i samma adminvy.
