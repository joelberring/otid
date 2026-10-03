# TASK182: tydlig arbetsordning i tävlingsadministrationen

Status: implementerad och riktat syntetiskt verifierad 2026-09-23. Fristående UI-snitt i den befintliga
individuella `/manage`-arbetsytan. Grund: användarens prov av demon och
[MeOS-handbokens arbetsflöden](docs/research/meos-guide-workflow-2026-09-23.md).
Ingen ny teknik, tävlingsform, behörighet eller resultatregel beslutas här;
ingen ADR behövs för enbart denna presentation.

## Användarutfall

När en administratör öppnar ett lopp ser hen omedelbart läget och en sökbar,
informationstät deltagarlista med vald deltagares sammanfattning. Övriga
befintliga arbetsmoment nås via fyra tydliga lägen: **Deltagare**, **Före
tävlingen**, **Under tävlingen** och **Efter tävlingen**. Det ska gå att förstå
vilka moment som hör till förberedelse, pågående lopp respektive resultat utan
att rulla genom hela verktygskatalogen.

## Avgränsning

- Gruppera befintliga kontroller i samma komponent; behåll laddat underlag,
  vald deltagare, formulärdata och session när läge växlas. Låt status,
  underlagstid/version och aktiva varningar vara synliga oavsett läge.
- Låt en pågående granskning, oklar commit eller retry stanna synlig och
  förhindra lägesbyte som annars skulle dölja den. Ingen mutation får
  annulleras eller återförsökas bara för att läget byts.
- Visa kontokoppling/engångskod som en frivillig sekundär deltagaruppgift med
  kort förklaring: den kopplar ett konto till exakt anmälan för personligt
  resultat och behövs inte för att administrera loppet eller se publika resultat.
- Behåll utskrift av skogs-/hyrbrickerapport och den befintliga mobilväxlingen
  mellan lista och deltagararbete. Dolda lägen får inte fortsätta automatisk
  skogsrefresh eller ta fokus vid intern navigering.
- Svensk text i befintligt i18n, synliga fokus-/aktivmarkeringar och minst
  44 px tryckytor. Inga nya API-anrop, tabeller, roller eller paket.

## Minsta acceptans

En syntetisk befintlig `MANAGE_RACE`-session öppnar deltagarläget som standard.
På desktop syns status, sökning och flera deltagarrader utan att hela sidan
scrollas; på padda/bredare vy syns lista och detalj sida vid sida. Vid 390 px
fungerar läge och befintlig list-/detaljväxling utan sidscroll. Samma
information behöver inte ha samma layout eller samtidiga synlighet på mobil
som på större skärmar. Byt Före → Under → Efter → Deltagare och kontrollera att vald
deltagare och sökfilter finns kvar. Prova en pågående granskning/retry och
visa att den inte kan döljas. Utskrift och publik läsning påverkas inte.
Riktad webblint, typecheck, ett litet UI-/browserprov och webbuild räcker;
ingen full regressionssvit för ett rent presentationssnitt.

## Ingår inte

Stafett, gaffling, nya tävlingsklasser, ny tabellredigering, ändrade
behörigheter eller kontoinförande, riktiga SI-enheter, produktionsdrift och
generell MeOS-paritet. Dessa är separata mål och får inte låtsas levererade.

## Utfall 2026-09-23

Fyra arbetslägen är införda i samma komponent. Status och underlagsversion
ligger kvar ovanför lägena; list-/detaljval, sökning och formulär hålls monterade
vid byte. Startlistepublicering/lottning ligger i Före, skogs-/avvikelsearbete i
Under och resultaträttningar/slutresultat/export i Efter. Kontokoppling ligger
efter deltagarens resultatsammanfattning som en förklarad frivillig detalj.
En granskning eller oklar commit låser lägesbytet; skogsuppdatering pausas när
Under inte visas. Fristående korrigeringspaneler med egen intern granskning
lämnas tills vidare synliga utanför lägena för att inte dölja ett pågående
beslut. Detta är fortfarande inte full MeOS-funktionalitet eller fältacceptans.

Riktad web-TypeScript, ändrade webbfiler i ESLint, E2E-TypeScript och E2E-
ESLint: exit 0. Syntetiskt Playwrightprov på 390, 900 och 1280 px:
**1/1 passerat, exit 0**; det täcker fyra lägen, kvarvarande sök/markering,
review-lås, sida-vid-sida-layout på padda och frånvaro av horisontell scroll.
Checkin-appskal: exit 0, tre hashbundna assets.
Next produktionsbuild: exit 0 med en icke-fungerande byggtids-DATABASE_URL,
utan anslutning till databas. Ett första buildförsök utan DATABASE_URL gav
exit 1 vid konfigurering av en API-route; den riktiga byggkontrollen använder
byggplaceholder enligt `src/lib/db.ts`. Ingen fysisk mobil, publik regressions-
eller full administrationssvit kördes.
