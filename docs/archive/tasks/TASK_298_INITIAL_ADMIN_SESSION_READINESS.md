# TASK298 – spärrad inloggning tills första sessionskontrollen är klar

## Evidens och avgränsning

TASK297:s första browserkörning stannade vid inloggning, men orsaken är
inte bevisad. Gamla requests granskas med generation före401-hantering.
Ett konkret glapp finns i första renderingen: busy=false gör credentialfält
och Logga in aktiva innan hydrering och initial sessionskontroll.

Den första privata sessionskontrollen ska starta i synligt spärrat läge.
Ingen ändrad credential, deadline, serverbehörighet, utvecklingsbypass eller
resultatregel. Befintlig checking-text används; ingen ny ruta eller ADR.

## Acceptans

- Ursprunglig HTML har spärrat fält/knapp före hydrering.
- Fördröjd initial GET-session håller inloggningen spärrad.
- Efter401 är fält/knapp aktiva; explicit inloggning ger exakt en POST och
  läser deltagarunderlaget. Gamla generationer får inte låsa nytt tillstånd.
- Befintlig auto-login initieras fortfarande av effekten, inte användarklick.
- Återanvänd TASK297:s enda databasfria browserfall. Håll browser-JavaScript
  och initial GET med explicita gates, inte tidsbaserad sleep.
- Kör baseline före produktfix, sedan samma prov och riktade kontroller.

## Verifiering

- Baseline på oförändrad produkt: exit1. Före hydrering var
  credentialfältet enabled när disabled förväntades (5 s assertion).
  Ingen manuell POST eller UI-assertion nåddes.
- Efter fix: `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK298`:
  exit0, samma enda browserfall1/1 på15,9 s. SSR-spärr, spärr under fördröjd
  GET, aktivering efter401, exakt en manuell POST och deltagarunderlag.
  Befintlig deltagar-/ban-/403-acceptans och noll oavsiktliga skrivningar kvar.
- Web lint och typecheck: exit0 vardera.
- E2E-TypeScript med `tests/e2e/tsconfig.task167-payment-filter.json`:
  exit0. Riktad ESLint för samma browserfil/projekt: exit0.
- `CI=true pnpm --filter @o-tid/web build`: exit0, Next16.3.3,
  22/22 statiska sidor genererade.

Produktfixen är endast initiala `busy` och `busyRef` satt till true.
Den befintliga effekten initierar även utvecklingsåtkomst och avslutar
busy på samma sätt; denna gren är kodgranskad men inte separat browserkörd.
Generation/deadline/lock och serverns autentisering är oförändrade.

## Kvarvarande antaganden

Första TASK297-timeoutens orsak är fortfarande inte bevisad. Snittet
bevisar och åtgärdar ett prehydrering-glapp, inte alla inloggningsfel.
Syntetiska HTTP-svar ersätter inte riktig sessionsdatabas/TLS eller fysisk
mobil. Ingen verklig credential eller tävlingsdatabas användes.

Nästa minsta uppgift: gå igenom en sammanhängande Före-resa i befintlig
testtävling och identifiera det första konkreta hindret för klass-/banupplägg,
utan fler kosmetiska mikrosnitt eller nya testsviter.
