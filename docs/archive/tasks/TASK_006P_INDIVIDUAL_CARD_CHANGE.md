# TASK 006P – individuellt brickbyte

Status: Genomförd 2026-09-04. ADR-0040 beslutades före implementation.

Arrangören väljer befintlig deltagare, granskar gammal/ny bricka och bekräftar
ett versionsbundet byte. Sparandet räknar inte om tidigare resultat. Ny avläsning
eller separat befintlig omräkning används därefter. Inga nya deltagare skapas.

Berörda delar: contracts, database (migration 0025), application (brickbyte och
EntryList-skydd), web och credential-CLI. Domänmotor och stationsprotokoll
återanvänds oförändrade.

## Acceptans och tillräcklig verifiering

1. Egen race/capability, privata cookies, Origin/CSRF före 4 KiB JSON; minimal
   bounded deltagarlista och synligt konfliktläge vid flera aktiva kopplingar.
2. Fryst entry/klass/snapshot/assignment måste matcha. Byte och återbyte till
   egen bricka fungerar, annans historiska bricka och no-op avvisas.
3. Exakt retry, nyckelkonflikt och två samtidiga writers testas i PostgreSQL.
   Journal/audit och en versionsökning, inga mutationsbara historiska identiteter.
4. Gamla raw/resultat/kvitton bevaras. Nytt signerat paket får rätt koppling;
   sen gammal bricka lagras okänd och ny bricka använder samma ingest/motor.
5. Separat omräkning får använda tidigare okänd avläsning för nya brickan;
   ingen avläsning ger ingen fabricerad revision. Aktiv manualoverlay består.
6. EntryList får inte återställa brickbyte eller flytta ägarskap; konflikt är
   atomär även för namn/klassändring i samma fil. Exakt filretry är fortsatt säker.
7. Svensk mobilvy, minst 52 px kontroller, bekräftelse och explicit same-id-retry.

Några fokuserade kontrakts-/routetester, PostgreSQL-scenarier och ett
Playwrightflöde räcker. Lint, typecheck, test och build redovisas vid slutförande;
oförändrade hårdvarutester upprepas inte.

## Användning och begränsning

Kör `pnpm db:migrate`. Utfärda racebehörighet med
`pnpm entry:card:access:issue --race-id <uuid> --label <text> --expires-at <ISO>`
(högst åtta timmar). Öppna `/admin/<raceId>/cards` från tävlingsöversikten.
Spärra med `pnpm entry:card:access:revoke --credential-id <uuid>`.

Egen gammal bricka kan återaktiveras; annans historiska bricka kan inte
återanvändas inom samma lopp. En ny EntryList med annat bricknummer avvisas
atomärt och måste korrigeras eller föregås av explicit byte. En identisk redan
lagrad fil är fortsatt en skrivfri duplicate. Inga tidigare överskrivna
ägaruppgifter eller korrupta dubbelaktiva kopplingar repareras automatiskt.

Slutkontroller: lint/typecheck/test/build exit 0; 1 037 enhetstester,
125 PostgreSQL-tester och ett riktat Playwrightscenario passerade. Exakta
körningar, första fel och avgränsningar finns i docs/status.md.
