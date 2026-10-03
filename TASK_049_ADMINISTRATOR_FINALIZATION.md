# TASK049: fastställa resultat med gemensam administratör

Klart avgränsat snitt 2026-09-12, ADR-0087 före implementation.

Integrera befintlig klass-/loppsfinalisering i adminvyn: läs underlag och
blockerare, välj klass eller lopp, granska, bekräfta explicit. Osäker kvittens
behåller exakt request/idempotency-key. Befintlig täckningspolicy och fryst
Complete behålls. Ingen automatisk klassfinalisering eller fabricerat DNS.

Application policy/audit och web route/UI. Ingen migration eller dependency.
Riktat policyprov och browserprov med riktig syntetisk HTTP/PG för blockerad
start, klass→lopp, retry och sann adminaudit. Web lint/typecheck/build.

Verifierat: policy2pass, browser1pass8,4s. Application/web lint/typecheck/build
slutligt exit0; första typechecks hittade imports/textnyckel/testtabell, rättat.
Ingen ny full matris för finaliseringsregler; befintlig application återanvänd.
Fysisk mobil/produktion och offlinefinalisering ej verifierade/stödda här.
Nästa minsta uppgift: minutstartslottning med samma admininloggning.
