# TASK161: förlorat lösenord till befintligt konto (A3c)

Status: avgränsad i ADR-0154 före implementation; syntetiskt verifierad
2026-09-23 mot isolerad PostgreSQL17 och riktig 390px-browser/HTTP. Ingen
verklig identitetskontroll, kodöverlämning eller fysisk mobil är verifierad.

## Användbart utfall

En person som inte längre kan logga in kan efter **manuell identitetskontroll
av betrodd serveroperatör** få en engångskod, skapa och spara ett nytt
lösenord på egen mobil eller dator, och logga in igen. Gamla sessioner
upphör. Samma konto behåller sina redan separata event- och anmälnings-
kopplingar utan att någon ny rätt skapas av återställningskoden.

## Bygg endast detta

1. Additiv migration0084 och Drizzle-schema: immutable recovery-issue,
   -revoke och -redemption, konto-/verifierarversionsbindning, idempotens,
   unik kodhash, at-most-once samt beständig gissningsspärr. Rollback-/
   restore-not. Ingen äldre rad eller grant skrivs om.
2. Riktade kontrakt och applicationtransaktioner för betrodd issue/status/
   revoke och mottagarens inlösen. Exakt konto-ID plus loginName måste
   matcha. Inlösen appenderar ny `scrypt-v1`-verifierare och redemption
   atomiskt; samma request/intent återger samma version. Gammal kod,
   gammal verifierarversion eller spärrat konto ger neutralt avslag.
3. Betrodd CLI med privat stdin och en ny 0600-fil **före** issue-write;
   separata retry/status/revoke. En missad commit återförsöks med exakt
   manifest. Ingen kod eller permanent hemlighet i argv, URL eller logg.
4. `/recover`, `POST /api/account/recovery` och små länkar från arrangörs-
   och deltagarinloggningen. Svensk 390px-vy, Web Crypto-lösenord,
   spara-/kopiera-bekräftelse och minnesburet säkert retry. Neutrala
   negativa svar, Origin, liten kropp, `no-store`, ingen auto-login.
5. Kort driftanvisning för identitetsattest, privat kodöverlämning,
   okänt commitläge, spärr och misstänkt stulen enhet. Behåll A3a/A3b,
   befintlig login och separat `rotate` som incidentväg.

## Minsta verifiering

- Kontrakts-/schema- och route-/komponentprov för kanoniska värden,
  hemlighetsfri projektion, neutral felväg och spara-steg.
- Ett isolerat PostgreSQL-prov med syntetiskt befintligt OWNER/ADMIN-
  och deltagarkonto: issue → inlösen → gammal session och race-delegering
  avvisas → ny login fungerar; redan existerande grant-/claim-ID:n består.
  Exakt retry/ändrad avsikt, revoke, expiry, unknown/redeemed, throttle
  och två samtidiga inlösare prövas riktat. Ingen demo/privat/riktig DB.
- Ett 390px-browserfall med riktig HTTP/isolerad PostgreSQL där
  mottagaren får syntetisk kod, sparar nytt lösenord, återställer och
  loggar in; frånvaro av horisontell scroll och Web Storage-läcka.
- Kör berörd lint, typecheck, riktade tester och build. Redovisa exakta
  resultat, antaganden och vad som **inte** är fältverifierat.

## Ingår inte

Självbetjänt issue, e-post/SMS, verifierad personidentitet, OWNER-
reset av annans konto, automatisk ADMIN-/entrykoppling, ändrade
resultat/offlineköer, GPS, SPORTident, stafett eller produktionspilot.
TASK161 är en liten A3-delresa, inte hela konto- eller tävlingsprodukten.
