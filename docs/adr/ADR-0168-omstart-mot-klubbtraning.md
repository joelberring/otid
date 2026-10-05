# ADR-0168: Omstart mot en körbar klubbträning

Status: accepterad 2026-10-03 av ägaren.
Ersätter: ADR-0007 (SPORTident-protokollgrind). Begränsar eller ersätter
behörighetsbesluten i tidigare ADR:er där de krockar med beslut 4 nedan.

## Bakgrund

Efter fem veckor och 301 uppgifter kunde systemet fortfarande inte läsa en
riktig bricka, Android-stationsappen hade aldrig byggts och inget av
målplanens delmål var avbockat. Orsaker:

- Varje uppgift slutade med "nästa minsta uppgift", och "klart" krävde
  fältprov med hårdvara som agenten inte kan utföra. Målet kunde alltså
  aldrig nås, så arbetet blev oändlig finslipning av administrationsvyer.
- ADR-0007 stoppade protokolltolken redan dag två och hävdes aldrig.
- Varje administrativ åtgärd fick egen behörighet, egen inloggning, eget
  kontrakt, egen journal och eget testupplägg. `AGENTS.md` växte till
  210 KB och `docs/status.md` till 947 KB.

## Beslut

### 1. Ett konkret mål styr allt
Målet är en körbar klubbträning enligt `PLAN.md`. `PLAN.md` är enda
backlogg. Inga TASK-filer skapas längre. Där `CODEX_BRIEF.md` och `PLAN.md`
skiljer sig gäller `PLAN.md` tills målet är nått; briefen är långsiktig vision.

### 2. Avläsning i webbläsaren via Web Serial
Brickavläsning byggs i webbappen med Web Serial: Chrome/Edge på dator och
Chrome 148 eller senare på Android, som har Web Serial för USB- och
Bluetooth-serieenheter. Då behövs ingen separat app för att komma igång.
Offline löses med service worker + IndexedDB.
Capacitor-stationsappen (`apps/station`) och deltagarappen
(`apps/participant`) **parkeras**. Ägaren har godkänt Android SDK-licenserna
om de skulle behövas senare.

### 3. SPORTident-protokollet implementeras nu
Grinden i ADR-0007 hävs. Vi skriver en egen TypeScript-implementation av
utökade protokollet och brickavkodningen. Källor som får användas som
**referens** (läsa och förstå, inte kopiera kod):

- SPORTidents egen dokumentation: https://docs.sportident.com och
  utvecklarsidan https://www.sportident.com/support/developers.html.
  *PC Programmer's Guide* lämnas ut på begäran; ägaren begär den parallellt.
  När den finns stäms implementationen av mot den.
- Öppna beskrivningar och bibliotek, t.ex. Per Magnussons
  "Sportident Primer" (axotron.se) och `sportident-python`/`sireader`.

Licensregeln för MeOS/Oxygen och andra GPL/AGPL-projekt består: ingen kod
kopieras eller översätts rad för rad. Vi skriver egen kod och egna tester.
Hårdvarustöd märks `untested` tills ägaren har provat med riktig station
(PLAN steg 7). Avsaknad av hårdvara blockerar inte implementationen.

### 4. Två behörighetsnivåer
Orienteringstävlingar behöver inte bankliknande säkerhet.

- **Admin:** ett inloggat konto med `OWNER` eller `ADMIN` på eventet. Admin
  kan göra *allt* i det eventets tävlingar, också avläsning och start/mål.
  Konton skapas genom självregistrering (e-post + lösenord). Ägaren lägger
  till admins.
- **Alla andra:** kan utan konto läsa allt som är publicerat: startlistor,
  resultat, sträcktider, deltagardetalj, speakervy.

Kvar av säkerheten: hashade lösenord, httpOnly SameSite=Lax-sessionscookie,
Origin-kontroll på skrivande anrop, HTTPS i drift och en enkel auditlogg.
Borttaget: funktionsvisa credentials och deras CLI-skript, stationsparning
och stationscredentials (avläsning sker i adminsessionen), speakercredential,
checkin-recoverytoken, skrivstoppsmaskineri och claim-koder.

### 5. Parkerat
Ingen ny utveckling förrän ägaren tar in det i `PLAN.md`: GPS, rutter, kartor,
deltagarkonton och följning, betalstatus, PM-PDF, MinIO-replikering och
avancerad backup, Eventor-produktionsprofil, utökade hyrbricksflöden.
Parkerad kod får lämnas orörd. Den får tas bort om den försvårar stegen i
planen eller om dess tester blockerar bygget.
(Eventor lyftes ur parkeringen i ADR-0170, kartor och rutter för vägval i ADR-0171.)

### 6. Databas
Det finns ingen produktionsdata. Fram till första riktiga användning får
migrationer ta bort tabeller och kolumner. Expand/migrate/contract behövs inte.
Efter första riktiga användning gäller försiktiga migrationer igen.

### 7. Drift
Systemet körs på en vanlig server med Docker Compose (PostgreSQL + webb +
Caddy för HTTPS) och nattlig `pg_dump`. Mer avancerad backup kommer senare.

## Konsekvenser

- Mycket kod och många tester försvinner i steg 1. Det är avsiktligt.
- Säkerheten blir lägre än tidigare design. Ägaren accepterar det för
  träning och klubbtävling.
- Risken flyttas till hårdvaruprovet i steg 7. Den hanteras genom att alla
  råbytes sparas och att avvikelser kan rättas i efterhand utifrån loggarna.
