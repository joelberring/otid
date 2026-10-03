# TASK052: kvar-i-skogen-lista med gemensam administratör

Klart avgränsat snitt 2026-09-12. ADR-0090 före implementation.

Läs befintlig privat rapport i adminvyn, filtrera på klass/namn/klubb/bricka.
Behåll totalantal, konflikter, okänd start och varningar om osynkade enheter.
Ingen ny tolkning av återkomst och inga checkin-mutationer/offlineköer.

Application read-wrapper och web route/UI. Återanvänd rapport/filter.
Riktat syntetiskt HTTP/PG-browserprov för okänd→registrerad återkomst,
filtervarning och misslyckad uppdatering; relevanta lint/typecheck/build.

Verifierat: lint/typecheck/build exit0, browser1pass7,2s. Oförändrade
resultatrevisioner vid läsning,401 utan session, filtertotaler/nätfelsvarning
och rensning vid logout. Timer gammalmärker efter30s; timergränsen inte
separat provad. Ingen full regression/fysisk mobil/produktion.
Nästa minsta uppgift: utskrift av rapporten från adminvyn.
