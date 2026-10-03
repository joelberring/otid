# TASK051: startlistepublicering med gemensam administratör

Klart avgränsat snitt 2026-09-12. ADR-0089 före implementation.

Granska och publicera/avpublicera befintlig startlistekopia med samma login.
Visa exakt offentligt underlag och tydlig personuppgiftsvarning. Frys intent
och bevara exakt retry vid tappat svar. Senare ändringar publiceras inte
automatiskt. Application-policy/audit och web routes/UI; ingen migration.

Riktat policyprov och syntetiskt HTTP/PG-browserprov för publicering,
oförändrad publicerad kopia efter ändring, retry och avpublicering.
Berörda lint/typecheck/build, ingen bred regressionssvit.

Verifierat: policy2pass, browser1pass9,5s; lint/typecheck/build slutligt exit0.
Första webtypecheck hittade saknad rubriknyckel; rättat. Oförändrad fryst
publicering efter syntetisk namnändring, exakt retry och avpublicering med
två korrekta adminauditposter. Inga verkliga uppgifter publicerades.
Kvar: fysisk mobil/produktion och full regressionsmatris ej verifierade.
Nästa minsta uppgift: kvar-i-skogen-lista med samma admininloggning.
