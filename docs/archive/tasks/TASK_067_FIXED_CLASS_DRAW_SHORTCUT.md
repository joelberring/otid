# TASK067: genväg från saknade tider till klasslottning

Implementerad och riktat verifierad 2026-09-18 som nästa minsta vertikala
snitt efter TASK066. Ingen produktionsdriftsättning ingår.

## Användarvärde

När en FIXED-klass har deltagare utan starttid ska administratören kunna öppna
den redan befintliga klasslottningen med samma klass förvald. Det minskar
scrollning och dubbelval efter byte från fri start till minutstart.

## Avgränsning

- Genvägen finns i TASK066:s uppföljningspanel och visas bara när tider saknas.
- Den öppnar/fokuserar befintlig lottningspanel och hämtar aktuella lottbara
  klasser genom den befintliga skrivfria adminrouten.
- Samma klass förväljs endast om serverunderlaget fortfarande visar den som
  lottbar och med deltagare; annars visas befintligt fel och inget antas.
- Klicket skapar inte preview, request-id, lottning eller databasändring.
- Första tid, intervall, preview, bekräftelse, exact retry och serverjournal
  förblir exakt det befintliga explicita lottningsflödet.
- Ingen ny route, kontrakt, migration, behörighet eller offlinekö.

## Arkitektur

Ingen ny ADR krävs. ADR-0045 styr fortsatt klasslottningen och ADR-0098 styr
klassregelbytet. TASK067 kopplar endast ihop två befintliga serverbundna
adminytor utan att slå samman besluten.

## Berörda filer

- `apps/web/src/components/class-start-time-follow-up.tsx`
- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/i18n/race-administrator-sv.ts`
- det befintliga riktade TASK065/TASK066-browserfallet

## Acceptans

1. Genvägen visas endast när vald FIXED-klass har minst en saknad tid.
2. Klick gör bara befintlig GET av lottbara klasser, öppnar/fokuserar panelen
   och väljer samma klass; inget POST eller skrivande anrop sker.
3. Serverunderlag där klassen inte längre är lottbar förväljs inte och ger
   befintligt tydligt läsfel.
4. Befintliga lottningens parametrar och tvåstegsbekräftelse är oförändrade.

## Verifiering

Kör web lint/typecheck/build, E2E-ts/lint och endast det namngivna
TASK067-browserfallet. Ingen ny PostgreSQL-integrationsgrupp behövs eftersom
genvägen använder befintliga riktiga HTTP/PG-routes utan ny persistens.

Genomfört: knappen öppnar och fokuserar befintlig lottningspanel, gör en färsk
GET av lottbara klasser och förväljer samma klass först efter validerat svar.
Det riktade browserprovet ser noll POST till preview/lottning före att
administratören gör ett separat uttryckligt val.
