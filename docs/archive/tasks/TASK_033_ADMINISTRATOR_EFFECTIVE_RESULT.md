# TASK033: Gällande resultat vid vald deltagare

Visa resolverat publicerat resultat och eventuellt styrande manuellt beslut
i samma administratörsvy efter ändring/omräkning. Se ADR-0074 före kodning.
Berör contracts, application och web. Ingen migration eller ny resultatregel.

Acceptans: ingen publicering skiljs från återtaget resultat; effektiv äldre
DSQ över teknisk ny revision visas korrekt. Historisk klass bevaras, inga
rådata exponeras. Privata GET-svar är scopebundna. PG/browser och riktad
lint/typecheck/test/build. Ingen ny parallell klientoperation eller offlinekö.

Status: avgränsat implementerat och verifierat. 18 riktade testfall godkända;
lint, typecheck och build för berörda paket exit 0. Exakta kontroller och
avgränsningar finns i docs/status.md. Full produkt-/produktions-/hårdvaruacceptans
kvarstår.
