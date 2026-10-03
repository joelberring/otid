# TASK 006O – individuell fast starttid

Status: Implementerad och verifierad 2026-09-04. Se exakta resultat i docs/status.md.

## Vertikalt flöde

Arrangören väljer en deltagare i en FIXED-klass, anger en starttid med
UTC-offset, bekräftar och sparar versionsbundet. Svar och UI visar att
befintliga resultat kräver separat explicit omräkning. Befintlig omräkningsvy
används för det andra steget och appenderar en ny resultatrevision.

ADR-0039 beslutas före produktkod. Befintliga teknikval och domängränser
behålls. Berörda paket är contracts, database, application och web samt CLI.
Resultatmotorn, IOF-adaptern och stationsprotokollet återanvänds oförändrade.

## Acceptans

1. Separat capability, origin/session/CSRF och 4 KiB strikt JSON skyddar skrivning;
   privat bounded lista visar minimal deltagar-, klass-, versions- och tidsdata.
2. Endast FIXED, explicit offset, giltigt datum och ändrat värde accepteras.
   Entry, klass, snapshot och gammal tid måste matcha. Ingen write vid konflikt.
3. En ändring ger entryversion +1, snapshot +1, en journal och en audit.
   Samma request återges exakt; ändrat intent/actor konflikterar. Journalen är
   immutable och två samtidiga försök mot samma version ger en vinnare.
4. Befintligt resultat och raw/readout bevaras. Operatörens separata omräkning
   använder den nya starttiden och appenderar en revision för vald entry.
5. Nytt signerat paket bär ny tid/version; gamla paket/kvittenshistorik bevaras.
   Gammal köad ingest kan synkas och markeras stale enligt befintligt kontrakt.
6. Äldre Complete-XML/hash förblir oförändrade och ny finalisering kräver
   aktuell grund. Aktiv manuell overlay upphävs inte av starttidsändringen.
7. Svenskt UI med bekräftelse, tydliga fel, minst 52 px touchmål och endast
   explicit same-id-retry efter okänt svar. Credential/intent lagras inte lokalt.

## Verifiering

Fokuserade kontraktstest, PostgreSQLtest av hela ändra→omräkna-flödet,
idempotens/stale och ett webbläsartest. Lint, typecheck, test och build körs
en gång i slutet; oförändrade Android-/hårdvarusviter upprepas inte.

## Användning

Kör `pnpm db:migrate` före driftsättning. Utfärda separat racebehörighet med
`pnpm entry:start-time:access:issue --race-id <uuid> --label <text> --expires-at <ISO>`
(högst åtta timmar). Öppna `/admin/<raceId>/start-times` från tävlingsöversikten.
Spara och följ länken till omräkning när ett befintligt resultat ska uppdateras;
omräkningsvyn kräver den befintliga separata omräkningsbehörigheten.
Spärra starttidscredential med
`pnpm entry:start-time:access:revoke --credential-id <uuid>`.

## Kvarvarande antaganden

Arrangören anger korrekt datum och UTC-offset. Vyn är onlinebaserad, inte en
beständig offlineeditor; efter omladdning läses aktuell serverstate. En ändring
av racesnapshot gör även andra äldre resultat stale inför ny finalisering,
enligt befintlig policy. Fysisk station, regn/handskar, produktionsproxy och
backuprestore är inte verifierade i detta snitt.

Nästa minsta föreslagna uppgift: ett explicit, versionsbundet brickbyte för en
befintlig deltagare, utan efteranmälan eller automatisk omräkning. Det kräver
ett separat ADR-beslut om historiska kopplingar och redan köade avläsningar.
