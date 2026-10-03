# TASK047: aktuell IOF-export i gemensam administration

Klart avgränsat snitt 2026-09-12. ADR-0085 före implementation.

Tävlingsadministratören laddar ner aktuell IOF 3.0 ResultList från samma
inloggning, utan deltagarval eller separat exportcredential. Exporten är
Snapshot, aldrig ett påstående om officiellt slutresultat. Visa antal resultat,
utelämnade deltagare och äldre resultatunderlag efter nedladdning.

Berör application-behörighet och web route/UI. Återanvänd befintlig export,
metadata- och hashkontroll. Ingen migration, ny dependency eller domänlogik.
NT-spärr och övriga exportkonflikter behålls. Ingen finalisering, Eventor-
uppladdning eller förändring av resultat ingår.

Acceptans: riktat policyprov, gemensam HTTP-gräns och ett syntetiskt
HTTP/PostgreSQL-browserprov för nedladdning. Lint/typecheck/build för berörda
paket. Ingen bred regressionsmatris.

Verifierat: lint/typecheck/build exit0. Policy2, HTTP1 och browser1pass
(slutlig browserkörning7,4s). Kontrollerad filhash/Snapshot, utelämnad deltagare,
oförändrade revisioner och ingen download vid konflikt eller ändrad fil.
Första HTTP/typecheck hittade fel413-kontrakt; rättat och omkört grönt.
Kvar: ingen fysisk mobil/produktion/full regression; NT-spärr återanvänds utan
ny separat servermatris. Nästa minsta uppgift: hämta redan finaliserade
officiella resultat med samma inloggning, utan att skapa ny finalisering.
