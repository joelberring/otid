# TASK050: minutstartslottning med gemensam administratör

Klart avgränsat snitt 2026-09-12. ADR-0088 före implementation.

Återanvänd befintlig lottning för FIXED-klasser i gemensam adminvy. Välj klass,
första start och intervall; granska gamla/nya tider innan explicit sparande.
Fri start berörs inte. Ingen klubbseparering/seedning eller automatisk
omräkning/publicering tillkommer. Exakt retry vid osäkert svar.

Application policy/audit, web routes/klient/UI. Ingen migration/dependency.
Policytest och ett riktat syntetiskt HTTP/PG-browserprov för preview→commit,
retry, oförändrad fri-startklass och sann audit. Berörda lint/typecheck/build.

Verifierat: lint/typecheck/build exit0; policy2pass och browser1pass9,1s.
Granskning kan avbrytas utan write; två nya minutstarter sparas med exakt
retry och en auditpost. Fri-startdeltagaren är oförändrad. Ingen testkörning
misslyckades. Fysisk mobil/produktion/full regression inte provade.
Kvar: endast FIXED, ingen klubbseparering/seedning, manuellt datum med offset.
Nästa minsta uppgift: publicera startlistan med samma admininloggning.
