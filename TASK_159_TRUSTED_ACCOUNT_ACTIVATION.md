# TASK159: betrodd inbjudan och mottagarstyrd kontoaktivering (A3a)

Status: A3a syntetiskt verifierad 2026-09-23; inte fältverifierad. ADR-0152
accepterades före implementation. Snittet är separat från C1/GPS och
kontorecovery.

## Användbart utfall

En betrodd operatör kan utfärda en engångsinbjudan till ett **nytt** konto.
Mottagaren kan på egen mobil eller dator ange koden, skapa och spara sitt
eget slumpade lösenord och aktivera kontot. Därefter fungerar befintlig
inloggning, ”Mina tävlingar” för framtida/egna grants och ”Mitt resultat”
endast efter den **separata** exakta anmälningskopplingen. Operatören får
aldrig mottagarens återanvändbara kontolösenord.

## Bygg endast detta

1. Additiv PostgreSQL-migration med per-loginName reservations-/låsrad,
   immutable issue/redemption/revocation-journaler, unik kodhash,
   idempotens- och at-most-once-constraints samt beständig
   aktiveringsspärr. Lägg rollback-/restore-not i migrationsdokumentationen.
2. Riktade kontrakt och applicationfunktioner för betrodd issue/status/revoke
   samt online redemption. Använd exakt befintlig normalisering,
   `scrypt`-verifierare och authvakt från ADR-0144. Konto och redemption
   committas atomiskt; ingen role/entry claim skapas. Håll resultatslogik
   utanför route och React.
3. En separat betrodd CLI med privat stdin och en uttryckligt vald ny
   0600-fil för 32-byte-koden/återförsöksunderlaget. Kod får aldrig stå i
   argv/stdout/logg. Okänd commit ska kunna avgöras med exakt retry eller
   betrodd status/revoke; förlorad kod återkallas och ersätts, inte läses
   tillbaka från databasen.
4. `/activate` och en liten POST-route med strikt Origin, `no-store`,
   begränsad kropp och generiskt fel. Svensk, tydlig 390px-vy genererar
   lösenord med Web Crypto, kräver synlig spara-/kopiera-bekräftelse före
   POST och ger enkel väg till befintlig login. Varken kod eller lösenord
   läggs i URL, Web Storage eller analytics. Visa tydligt att förlorat
   lösenord ännu kräver kontakt med betrodd operatör.
5. Dokumentera privat överlämning, spärr, omutfärdande och incidentstopp.
   Behåll äldre CLI-provisionering, befintlig login, A2-grant och B1-claim
   oförändrade.

## Minsta verifiering

- Riktat kontraktstest för kanonisk kod, normaliserat namn, kroppsstorlek
  och neutrala svar.
- Ett isolerat PostgreSQL-integrationsprov med syntetiska konton: issue →
  activation → befintlig login; exakt retry; okänd/utgången/spärrad/förbrukad
  kod; befintligt loginName; samtidiga inlösare; ingen event-/entry-grant;
  spärr efter för många försök. TEST_DATABASE_URL måste vara en uttryckligen
  isolerad testdatabas, aldrig demo eller riktig tävling.
- Ett browserflöde med syntetisk inbjudan på 390 px och desktop: lösenordet
  måste sparas före aktivering, neutral felväg och lyckad vanlig login.
  Inga riktiga koder/personer eller mejlutskick. Kör berörd lint,
  typecheck, riktade tester och bygg; inte full workspace-svit för detta snitt.
- Redovisa exakta kommandon, exitkoder, återstående antaganden och vad som
  faktiskt är browser-/PostgreSQL-verifierat respektive inte fältverifierat.

## Ingår inte

Publik självregistrering, verifierad e-post/SMS, lösenordsåterställning,
automatisk ADMIN/OWNER-grant, anmälningskoppling, Eventoridentitet,
vårdnadshavarbevis, ny mobilappsession, GPS-synk eller fysisk tävlingspilot.
Efter detta kan A3b välja en ägarstyrd eventinbjudan och A3c recovery som
egna små uppgifter; TASK159 markeras inte som hela A3.

## Genomförd kontroll 2026-09-23

Migration 0082, riktade kontrakt/applicationfunktioner, betrodd CLI,
`/api/account/activation`, `/activate` och
[driftanvisningen](docs/account-invitation-operations.md) finns. Isolerad
PostgreSQL17-integration passerade 3/3 syntetiska scenarier. Webbens
kontrakts-/route-/komponentprov, browserintercept på 390/1280 px och ett
riktigt HTTP/PostgreSQL-browserfall (390 px aktivering följd av befintlig
login) passerade. CLI utfärdade till ny 0600-fil och exakt retry gav samma
inbjudnings-ID. Berörd lint, typecheck och build passerade via lokala
binärer. Ingen fysisk mobil, produktions-TLS, riktig mottagare,
mejlleverans eller kontorecovery har provats. A3 som helhet är öppen.
