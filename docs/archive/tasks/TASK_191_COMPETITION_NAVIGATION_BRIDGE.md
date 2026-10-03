# TASK191: tydlig väg mellan tävlingslista och arbetsyta

Status: syntetiskt verifierad 2026-09-25. Detta är UI-planens tredje, avgränsade
navigationssnitt efter TASK183/184 och TASK187–189.

## Användarutfall

Arrangören ser att loppets primära knapp öppnar tävlingens kompakta
administrativa arbetsyta. Inne i arbetsytan finns en omedelbar, liten väg
tillbaka till Mina tävlingar utan ett extra stort kort eller en fast topp.
Den äldre skrivskyddade loppöversikten visar en tydligt märkt väg till samma
arbetsyta, men påstår inte att `VIEW_RACE_OVERVIEW` ger `MANAGE_RACE`.

## Gräns

Endast svensk text, länkar och lokalt avgränsad layout. Befintligt
`/api/organizer/races/[raceId]/enter` skapar fortsatt administratörssession
från Mina tävlingar; en vanlig länk från läsöversikten skapar ingen ny
behörighet och kan kräva separat inloggning i `/manage`. Pågående granskning
eller osäkert sparutfall får inte kringgås av tillbakalänken i arbetsytan.
Ingen API-, databas-, domän-, resultat- eller teknikändring. Ingen ADR behövs.
Ingen ny funktionslista eller ett tredje admin-UI byggs.

## Kontroll

Återanvänd det befintliga syntetiska `/manage`-browserfallet vid 390/900/
1280 px för synlig väg tillbaka, låst navigation under granskning och
sidbredd. Små befintliga komponentkontroller för text/läsöversikt, riktad
lint/typecheck och webbuild. Inga DB-, hårdvaru- eller fulla E2E-sviter.

## Utfall och kvarvarande antaganden

- Mina tävlingars befintliga sessionsskapande knapp heter nu **Öppna
  arbetsytan**. Inne i `/manage` ligger **Mina tävlingar** i tävlingens
  identitetsrad, utan nytt kort eller fast navigationsfält. Länken ersätts av
  synligt, oklickbart läge vid pågående granskning/oklart sparutfall och
  finns även när deltagarunderlaget inte kunde läsas. Den uttryckligt
  avgränsade lokala demon går till den lokala tävlingslistan `/`, eftersom
  den inte förutsätter ett arrangörskonto.
- Den separat behöriga, skrivskyddade loppöversikten erbjuder nu länkar till
  Mina tävlingar och arbetsytan endast efter sin egen autentisering. Texten
  anger att arbetsytan kräver **separat administratörsbehörighet**; själva
  `MANAGE_RACE`-grinden ändrades inte.
- Riktad web- och E2E-TypeScript: **exit 0** vardera. Riktad web- och
  E2E-ESLint: **exit 0** vardera. Två befintliga komponenttestfiler:
  **12/12** tester, **exit 0**. Återanvänt syntetiskt browserfall vid
  390/900/1280 px: **1/1**, **9,9 s** i slutkörningen, **exit 0** (första
  körningen före lokal-demojusteringen: **22,4 s**, **exit 0**). Det kontrollerar att
  tillbakalänken är klickbar i normalt läge, spärras under granskning och
  går till `/organizer` efteråt, med bibehållen sidbredd.
  `CI=true pnpm --filter @o-tid/web build`: **exit 0**, 22/22 statiska sidor.
- Desktop- och mobilskärmbilder från browserfallet inspekterades: ingen extra
  topppanel eller horisontell scroll. I den redan öppna lokala demon syntes
  den avsedda **Tävlingar**-länken till `/` i tävlingens identitetsrad.
  Läsöversiktens autentiserade länkar
  kontrollerades i komponentkällan, inte med en riktig capability-session.

En verklig arrangörssession, separat översiktsbehörighet, faktisk padda/
mobil och användarens förmåga att hitta tillbaka är ännu inte fältprovade.
Ingen riktig tävlingsdata eller befintlig behörighet ändrades.
