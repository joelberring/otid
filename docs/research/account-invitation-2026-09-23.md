# Underlag: betrodd kontoinbjudan och aktivering

- Granskat: 2026-09-23
- Avser: A3:s första kontoinförandesnitt, inte bevisad e-postadress,
  personidentitet eller rätt till en tävlingsanmälan.

## Befintlig produktgräns

ADR-0144 ger ett betrott CLI-provisionerat konto med versionsmärkt
`scrypt`-verifierare, kortlivad opak session och omedelbar serverspärr.
ADR-0145:s event-ADMIN tilldelas endast ett redan existerande konto.
ADR-0146 kräver dessutom en separat operatörsattesterad engångskod för
**exakt anmälan** innan en deltagare får ”Mitt resultat”. Ett vanligt
inloggningsnamn, visningsnamn, klubb eller publikt resultat-ID är inget
identitets- eller anmälningsbevis.

## Externa primärkällor

- [NIST SP 800-63A: Subscriber Accounts](https://pages.nist.gov/800-63-4/sp800-63a/accounts/)
  skiljer ett unikt konto och dess autentiserare från andra attribut. Vi
  använder detta som begreppsgräns; O-Tid påstår inte NIST-identitetsnivå.
- [NIST SP 800-63B: Authenticator Event Management](https://pages.nist.gov/800-63-4/sp800-63b/events/)
  behandlar bindning, förlust och spärr av autentiserare som explicita
  livscykelhändelser. Det stödjer att aktivering och senare återställning
  inte tyst blandas ihop.
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
  rekommenderar kryptografiskt slumpade, tillräckligt långa, lagrade på ett
  säkert sätt, tidsbegränsade och engångsanvända koder samt neutral respons
  för okänt konto. En nykontoinbjudan är inte ett lösenordsåterställningsflöde,
  men samma kodhygien är relevant.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
  skiljer autentisering från identitetsprövning och avråder från avslöjande
  felmeddelanden vid login/kontoskapande. Det är inte ett argument för att
  ett privat överlämnat inbjudningsbevis intygar en juridisk identitet.

## Tillämpning i O-Tid

En manuellt överlämnad aktiveringskod kan vara ett smalt, tillfälligt bevis
på att mottagaren fått **just den koden** från en betrodd utfärdare. Den
bevisar varken kontroll över en e-postadress, arrangörsroll, vårdnadshavarskap
eller en viss `entry.id`. Sådana rättigheter kräver befintliga, separata
grants eller senare uttryckliga beslut. En framtida e-postkanal behöver
egen leverans-, verifierings- och återställningsgräns; dagens system har
ingen sådan.
