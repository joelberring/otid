# ADR-0172: Konton, superadmin, funktionärer, publik yta och radio via ROC

Status: beslutad 2026-10-05 av ägaren (Joel). Ändrar ADR-0168 beslut 4
(behörighet) och kompletterar ADR-0170.

## Bakgrund

Efter steg 16 finns allt för att genomföra en tävling, men ytan runt omkring är
inte klar för riktig användning: vem som helst kan skapa konto med ett
användarnamn, glömt lösenord kräver ett kommando på servern, ingen kan städa
bort skräp, startsidan visar alla tävlingar med adminlänkar och funktionärer
loggar in med koder som enligt ADR-0168 skulle ha tagits bort. Det finns inga
mellantider från skogen. Klubbar i Sverige får radiostämplingar via ROC.

## Beslut

### 1. Konton
- Alla får skapa konto och tävlingar (öppen registrering), med spärr mot
  upprepade försök.
- Kontot identifieras med e-postadress. Lösenord som i dag (hashat, minst 8 tecken).
- Glömt lösenord: länk via e-post när servern har e-post inställd (SMTP i miljön).
  Utan e-post kan superadmin skapa en återställningslänk. Det gamla
  kommandoradsflödet med koder i fil tas bort.
- Inloggning med Google eller Eventor kan läggas till senare. Inte nu.

### 2. Superadmin
- En systemroll som sätts från servern med ett kommando, aldrig i appen.
- Superadmin ser alla konton och tävlingar och kan dölja eller ta bort en
  tävling, spärra eller ta bort ett konto och skapa en återställningslänk.
  Varje sådan åtgärd loggas med vem, när och varför.
- Ägaren av en tävling kan själv ta bort den. Ett konto kan tas bort av sin
  användare.

### 3. Funktionärer
- Ny roll på tävlingen: **Funktionär**, kopplad till ett vanligt konto via
  e-post. Admin lägger till och tar bort funktionärer under Inställningar.
- Funktionären får: avläsning, direktanmälan av okänd bricka, kvar i skogen,
  startlista och incheckning vid start, speaker. Funktionären får inte ändra
  banor, klasser, anmälda, resultat eller inställningar.
- Flera enheter kan vara inloggade på samma konto samtidigt. Det räcker för
  klubbar som vill köra ett gemensamt funktionärskonto.
- Kontrollen görs i en gemensam serverfunktion bredvid `requireRaceAdmin`.
- Koder, credentials och egna inloggningar för funktionärer, stationer,
  kvar i skogen och incheckning tas bort. Startpersonalens app använder samma
  kontoinloggning.

### 4. Publik yta
- En ny tävling är dold tills admin publicerar den. Checklistan visar steget.
- Startsidan visar publicerade tävlingar under Pågår nu, Kommande och Senaste,
  med sök. Besökare ser inga adminlänkar.
- Varje tävling har en publik tävlingssida med kort adress och QR-kod att
  skriva ut: startlista, resultat, sträcktidsanalys och speaker när den är
  publik.
- Sidan "Mina resultat" (`/me`) tas bort tills deltagarkonton tas upp i planen.

### 5. Radiokontroller via ROC
- Tävlingen kan kopplas till ROC (eller OResults, som har samma protokoll)
  med enhetens id. Servern hämtar nya stämplingar med `lastId` regelbundet
  under tävlingen. Rader: stämplings-id; kontrollkod; bricka; tid.
- Radiostämplingar sparas oföränderligt och idempotent (källa + stämplings-id),
  skilda från avläsningar. De ger mellantider live och underlag för speakern.
  Avläsningen i mål avgör fortfarande resultatet.
- Admin väljer vilka kontroller som är radiokontroller.

## Konsekvenser

- Migrationer: e-post på konto, superadminflagga, spärr/borttagning, rollen
  Funktionär, publicerad tävling, ROC-koppling och radiostämplingar.
- Borttaget: användarnamn som inloggning, återställningskoder i fil,
  funktionärskoder, stationsparning och stationscredentials, separata
  inloggningar för kvar i skogen och incheckning, `/me` och dess API.
- `PLAN.md` får steg 17–21.
