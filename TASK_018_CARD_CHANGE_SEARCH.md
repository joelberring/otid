# TASK018 – Hitta rätt deltagare vid brickbyte

Status: implementerad; verifieringsresultat i docs/status.md.
Web-only ovanpå befintligt brickbytesflöde.

Sök deltagare på namn, klass eller aktuell bricka i befintligt behörigt
underlag; DTO innehåller inte klubb, så ingen ny klubbdata/API tillförs.
NFC/skiftlägesokänslig delsträng, oförändrad serverordning, synligt träffantal
och Rensa sökning. Valalternativ visar namn/klass/aktuell bricka eller tydlig
saknad/flertydig bricka. Ingen deltagare väljs automatiskt.

Ändrad sökning rensar deltagarval/nytt bricknummer före granskning; detta
förklaras i UI. Sökning och rensning blockeras under busy och fryst attempt.
En granskad/okänd begäran behåller exakt entry-id, versionsvillkor, request-id
och innehåll. Sökning får aldrig omskapa bytesintent eller kringgå bekräftelse.
Söktext rensas vid authfel/loginfel/logout. Ett okänt bytesförsök bevaras enligt
befintlig återförsökspolicy; denna uppgift ändrar inte dess privata journal/UI.

Scope: entry-card-admin, svensk text, scoped CSS, liten presentationshjälpare
och fokuserade tester. Ingen API/schema/behörighetsmodell, resultatlogik eller
ny dependency. Ingen ADR behövs för den rena väljaren. Ingen verklig bricka,
tävling, Eventor eller hårdvara används.

Acceptans: namn/klass/aktuellbrickasökning, nollträff, clear, explicit val,
oförändrat granskat intent vid okänt svar, låst sökning fram till beslut,
byteidentisk retry, och sökrensning vid authfel. Proportionerligt: rena
filtertester, två browserfall med syntetiska API-svar, lint/typecheck/build.
Browserprovet bevisar klientens requestdisciplin, inte ny PG-transaktions-
eller fysisk hårdvaruacceptans.
