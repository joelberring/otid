# O-Tid – plan till första riktiga användning

Beslutad 2026-10-03 av ägaren (Joel). Detta är den **enda backloggen**. Codex
arbetar steg för steg uppifrån och ned. Nya idéer skrivs under "Idéer" i
`STATUS.md` – de blir inte nya uppgifter förrän ägaren flyttar in dem här.

Bakgrund och beslut: [ADR-0168](docs/adr/ADR-0168-omstart-mot-klubbtraning.md) och
[ADR-0169](docs/adr/ADR-0169-enkel-yta-gafflingar-stafett.md) (steg 8–11).

## Målet

> **En klubb kan köra en träningskväll med O-Tid.**
>
> Arrangören skapar tävlingen på webben, lägger in banor och klasser (manuellt
> eller via IOF XML), löparna anmäls i förväg eller direkt vid avläsningen.
> I mål läses brickorna av med en SPORTident-station kopplad till en dator
> eller Androidplatta i Chrome. Löparen får sitt resultat direkt. Avläsningen
> fungerar även när nätet försvinner och synkar när det kommer tillbaka.
> Alla kan följa resultat och sträcktider på mobilen utan att logga in.
> Arrangören ser vilka som är kvar i skogen och kan rätta fel.

Det som **inte** behövs för målet är parkerat (se ADR-0168): GPS/rutter/kartor,
deltagarkonton, Android-stationsappen, betalstatus, backup-replikering m.m.

## Definition av klart för ett steg

Ett steg är klart när dess acceptanspunkter är gröna **och**
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` går igenom, samt
berörda Playwright-flöden. Då: bocka av rutan, skriv högst tio rader i
`STATUS.md`, committa, och **gå direkt vidare till nästa steg**. Stanna bara
vid steg 7 (kräver ägaren) eller om något verkligen blockerar.

Hårdvara saknas just nu. Det får aldrig stoppa steg 0–6: använd syntetiska
frames, replay och den falska serieporten. Markera hårdvarustöd som `untested`.

---

## [x] Steg 0 – Städa och få en grön baslinje

1. `git init` och första commit **innan något annat ändras**, med meddelandet
   `Läge före omstart 2026-10-03`. Kontrollera att `.gitignore` utesluter
   `node_modules`, `.pnpm-store`, `.next*`, `dist`, `test-results`, `.env*`
   (utom `.env.example`) och `*.tsbuildinfo`.
2. Flytta historiken ur vägen (med `git mv`):
   - alla `TASK_*.md` → `docs/archive/tasks/`
   - `docs/status.md` → `docs/archive/status-2026-10-03.md`
   - `docs/product-goal-roadmap-2026-09-23.md`,
     `docs/project-review-and-plan-2026-09-19.md`,
     `docs/ui-workspace-design-2026-09-24.md`, `docs/meos-feature-matrix.md`,
     `docs/local-demo-*.md`, `docs/task-*-acceptance.md`, `RESEARCH_NOTES.md`
     → `docs/archive/`
   - Rätta eller ta bort länkar som pekar på flyttade filer, där det behövs
     för att lint/tester ska gå.
3. Lägg en rad överst i `docs/adr/ADR-0007*`: "Ersatt av ADR-0168 (2026-10-03)."
4. TASK301 (byta namn på manuell klass) var halvfärdigt vid omstarten.
   Gör klart det om det bara saknas lite, annars ta bort det som påbörjats.
5. Starta lokal databas (`docker compose up -d postgres`), kör
   `pnpm install`, `pnpm db:migrate` och sedan lint/typecheck/test/build.
   Laga det som är rött. Skriv i `STATUS.md` vad som var rött och vad du gjorde.
6. Godkänn Android SDK-licenserna om de skulle behövas för bygget
   (`sdkmanager --licenses`) – ägaren har godkänt dem. Android-apparna är
   annars parkerade och ska inte blockera bygget; ta bort dem ur
   workspace-bygget om de gör det.

**Acceptans:** git-repo med två commits (före/efter städning), grön baslinje
eller en kort lista i `STATUS.md` över exakt vilka tester som fortfarande är röda och varför.

## [x] Steg 1 – Två behörighetsnivåer: admin och alla andra

Se ADR-0168 beslut 4.

1. **Konton:** vem som helst kan registrera konto (e-post + lösenord, ingen
   e-postverifiering). Inloggning ger en httpOnly-sessionscookie
   (SameSite=Lax, 30 dagars livslängd). Lösenordsåterställning görs tills
   vidare med ett CLI-kommando – det finns redan.
2. **Admin för en tävling** = kontot har `OWNER` eller `ADMIN` på eventet
   (finns redan, ADR-0144/0145). Ägaren lägger till admin med e-postadress.
   **En** serverfunktion, t.ex. `requireRaceAdmin(raceId)`, skyddar *alla*
   skrivande och privata admin-routes. Den ger full rätt till allt i
   tävlingen: förberedelse, avläsning, start/mål, rättningar, export.
3. **Alla andra** – deltagare och publik – kan utan inloggning läsa allt som är
   publicerat: startlista, resultat, sträcktider, deltagardetalj och
   speakervyn.
4. **Ta bort** allt annat: de racebundna funktionscredentials (DID_NOT_START,
   RESULT_APPROVAL, … och deras `*:access:issue/revoke`-skript i
   `package.json` och `scripts/`), `CREATE_EVENT`-credential, separat
   `MANAGE_RACE`-inloggning, stationsparning och stationscredentials,
   speakercredential, checkin-recoverytoken, skrivstopp/"writer admission",
   claim-koder. Ta bort de fristående adminsidor som bara fanns för att
   ha en egen inloggning – funktionen ska finnas i `/admin/[raceId]/manage`.
   Ta bort tabeller som blir oanvända via en ny migration (det finns ingen
   produktionsdata, se ADR-0168).
5. Ta bort per-åtgärds-requestjournaler där de bara fanns för behörighetens
   skull. Behåll resultatrevisioner, rådata och en enkel auditlogg
   (vem, vad, när).

**Acceptans:** ett Playwright-flöde: registrera konto → skapa tävling →
lägg till bana, klass och deltagare → bjud in konto B som admin → B kan
ändra → utloggad besökare ser publikt resultat men får 401/omdirigering
på admin-API. `grep -r "access:issue" package.json scripts` ger inga träffar.
README beskriver inloggningen på fem rader.

## [x] Steg 2 – Dela upp adminarbetsytan

`apps/web/src/components/race-administrator-workspace.tsx` (4 300 rader,
179 `useState`) delas upp i en komponent per flik/område (t.ex. Förberedelse,
Deltagare, Tävlingsdag, Resultat, Inställningar). Gemensam hjälpfunktion för
API-anrop och felhantering i stället för kopierade varianter. Ta bort död kod
och CSS för sidor som försvann i steg 1. Ingen ny funktionalitet.

**Acceptans:** ingen fil i `apps/web/src` över ~800 rader (utom genererad
text/i18n); befintligt adminflöde i Playwright passerar; lint/typecheck/build gröna.

## [x] Steg 3 – SPORTident-protokollet

Nytt paket `packages/sportident` (ren TypeScript, ingen I/O) ovanpå befintliga
`packages/device-transport`. Se ADR-0168 beslut 3 för källor och licensregel.

1. Framing för SPORTidents utökade protokoll: STX/ETX, längd, kommando, CRC,
   godtyckliga chunkgränser, dubletter, trunkering, felaktig CRC.
2. Kommandon som behövs för avläsning från BSM7/BSM8/SI-USB-läsare
   i avläsningsläge: identifiera station, hantera "bricka insatt/borttagen",
   begära brickans block.
3. Avkodning till `NormalizedCardReadout` för SI-Card 5, 6, 8, 9, 10, 11 och
   SIAC: bricknummer, start, mål, check/clear, stämplingar (kod + tid).
4. Tidstolkning: brickorna lagrar 12-timmarstid. Välj den tolkning som ligger
   närmast före avläsningstidpunkten på tävlingsdagen; dokumentera regeln och
   testa passage över 12:00 och midnatt.
5. Råa bytes sparas alltid tillsammans med avläsningen (befintlig regel).

**Acceptans:** enhetstester per bricktyp och för alla felfall ovan, med
testvektorer byggda från dokumentationen. `docs/sportident.md` skrivs om
(högst en sida) med stödmatris – alla rader `untested` tills steg 7.

## [x] Steg 4 – Avläsning i webbläsaren, även offline

Ny sida `/admin/[raceId]/readout` (kräver admininloggning).

1. Knappen "Anslut station" använder Web Serial (`navigator.serial`) via
   befintliga `WebSerialTransport`. Fungerar i Chrome/Edge på dator och
   Chrome 148+ på Android. Visa begripligt fel i webbläsare utan Web Serial.
2. Avläsning → rådata sparas lokalt → avkodning (steg 3) → bedömning lokalt med
   `packages/domain` mot en lokalt sparad tävlingssnapshot → stort besked
   (OK / Felstämplad / Okänd bricka, med text och symbol, inte bara färg)
   + sträcktider.
3. Lokal kö i IndexedDB som synkar till den befintliga idempotenta
   ingest-routen (stabilt enhets-id per webbläsare + löpnummer). Servern är
   auktoritativ; skiljer sig serverns bedömning visas det.
4. Statusrad som alltid syns: station ansluten, internet, köns längd,
   snapshotversion.
5. Offline: sidan och snapshoten fungerar efter omladdning utan nät
   (service worker + IndexedDB). Återanvänd det som finns i `checkin`-koden
   och `apps/station/src` (station-sync, local-evaluation) i stället för att
   skriva nytt.
6. Okänd bricka: välj deltagare eller direktanmäl på plats (namn, klass,
   bricka) – samma avläsning kopplas, ingen ny läsning behövs.
7. Utvecklingsläge "falsk station" som spelar upp syntetiska frames genom
   *samma* parser. Den ersätter den gamla simulatorsidan.

**Acceptans:** Playwright med falsk station: läs bricka med nätet avslaget
(`context.setOffline(true)`) → resultat visas → ladda om sidan offline →
fortfarande fungerande → slå på nätet → kön töms → resultatet syns på den
publika resultatsidan. Okänd bricka → direktanmälan → resultat.

## [x] Steg 5 – Hela träningskvällen hänger ihop

1. Snabbstart för träning: skapa tävling → skapa banor genom att skriva
   kontrollkoder → klasser kopplade till banor → fri start (startstämpling)
   som standard. IOF XML-import ska fortsatt fungera som alternativ.
2. Kvar i skogen = anmälda/startade minus avlästa, i adminvyn.
3. Publik resultatsida uppdateras automatiskt (finns – kontrollera att den
   fungerar med avläsningar från steg 4).
4. Export av resultat som IOF XML (finns – kontrollera).
5. `pnpm demo` skapar en färdig träningstävling i en lokal databas så att
   ägaren kan prova allt på fem minuter. Ersätter den gamla demoprovisioneringen.

**Acceptans:** **ett** Playwright-test "träningskväll" med 10 syntetiska
löpare genom hela kedjan: skapa → banor/klasser → förhandsanmälan +
direktanmälan → avläsning (falsk station, en del offline) → kvar i skogen →
en rättning (t.ex. felstämplad → godkänd) → publikt resultat → IOF-export.

## [x] Steg 6 – Gå att köra på internet

1. `Dockerfile` för webben (Next standalone) och `docker-compose.prod.yml` med
   PostgreSQL, webb och Caddy (automatisk HTTPS).
2. Nattlig backup: `pg_dump` till fil med 14 dagars rotation + kort
   återställningsinstruktion som har provats lokalt en gång.
3. `docs/drift.md` (högst en sida): så här startar man på en vanlig VPS.
   MinIO tas bara med om någon kvarvarande funktion i målet kräver den.

**Acceptans:** `docker compose -f docker-compose.prod.yml up` fungerar lokalt
och hela "träningskväll"-testet kan köras mot den. Val av värd görs av ägaren.

## [ ] Steg 7 – Riktig hårdvara och pilot (ägaren + Codex)

1. Ägaren kopplar in station och brickor, öppnar avläsningssidan med
   "spara rålogg" påslagen och läser varje bricktyp han har.
2. Codex rättar avvikelser utifrån råloggen och lägger loggarna som testfixtures.
3. Stödmatrisen uppdateras till `field-verified` för provade kombinationer.
4. En riktig träning med 20–50 löpare, gärna med MeOS parallellt som facit.

## [x] Steg 8 – Enkel arbetsyta för det som finns

Se ADR-0169 beslut 1 och 4.

1. [x] **Resultat är aktuella per löpare.** Underlagshash per resultatrevision.
   "Äldre underlag" bara när löparens egen klass, bana, strukna kontroller,
   startsätt eller starttid ändrats (brickan ingår inte: löparen sprang med den
   bricka som lästes av). En direktanmälan gör inga andra resultat inaktuella.
   Automatisk omräkning efter sådana ändringar görs i punkt 2.
2. [x] **Redigera bana:** ett ställe för att ändra kontrollföljd, stryka en
   kontroll och flytta valda löpare till kortare bana, även när resultat finns.
   Före sparande: besked i klartext ("12 har läst ut; 2 blir godkända, 10
   påverkas inte"). Versioner och omräkning sköts av appen: berörda resultat
   räknas om automatiskt i samma transaktion (ny revision, historik kvar).
3. [x] **Banor och klasser som tabeller** med redigering i raden: bana (kontroller,
   klasser, löpare) och klass (bana, startsätt, anmälda, status).
4. [x] **Deltagarkort:** bricka, klass, starttid, resultat med sträcktider och
   historik. Resultatbesluten (ej start, brutit, disk, utom tävlan, utan
   tidtagning, godkänn) som en meny "Ändra status".
5. [x] **Checklista** som navigation (Banor → Klasser → Anmälda → Start →
   Avläsning → Resultat) med status per steg, och **tävlingsdagens kontrollvy**
   (kvar i skogen, okända brickor, felstämplade, senaste avläsningar).
6. [x] **Språk och flöde:** inga id, hashar, versionsnummer, slumpfrö eller
   UTC-offset i vyerna. Spara direkt när inget resultat ändras. Automatiska
   omförsök i stället för "svaret saknas"-texter.

**Acceptans:** träningskvällstestet går igenom med färre steg (ingen manuell
omräkning före godkännande). Nytt Playwright-flöde: bana ändras efter att
löpare läst ut → besked → resultaten räknas om → publikt resultat stämmer.
Ingen vy visar uuid, hash eller "tävlingsversion".

## [x] Steg 9 – Lottning på riktigt

1. Startsätt per klass: fri start, lottad minutstart, masstart. (Jaktstart flyttad till "Efter målet".)
2. Lotta flera klasser på en gång: första start som klockslag, intervall i
   minuter, startfållor/startled så att klasser med samma första kontroll inte
   startar samma minut, klubbseparering, vakanser.
3. Efteranmälda placeras på vakanta tider. Förhandsvisning ser ut som startlistan.

**Acceptans:** domäntester för lottningsreglerna (klubbseparering,
vakanser, startfållor, deterministiskt med frö). Playwright: lotta tre klasser
→ startlista publiceras → efteranmäld får vakant tid.

## [ ] Steg 10 – Gafflingar i individuella klasser

Se ADR-0169 beslut 2.

1. Banvarianter i modellen och resultatmotorn; variant per deltagare.
2. IOF XML CourseData med varianter och CourseAssignment importeras
   (fixtures från OCAD/Purple Pen). Varianter lottas annars jämnt i klassen.
3. Avläsning, startlista och resultat visar variant. Kontroll som varnar om
   varianterna inte täcker samma sträckor.

**Acceptans:** domäntester för bedömning per variant; integrationstest för
import; Playwright: gafflad klass läses av med rätt variant.

## [ ] Steg 11 – Stafett

Se ADR-0169 beslut 3.

1. Stafettklass med sträckor och startsätt per sträcka; lag med sträcklöpare,
   bricka och variant (gafflingar från steg 10).
2. Avläsning per sträcka; lagresultat, växlingstider och omstart i domänen.
3. Lagvy: anmäl lag, byt sträcklöpare, lag ute per sträcka. Publik
   resultatlista per sträcka och lag. IOF XML-export för stafett.

**Acceptans:** domäntester för lagresultat (felstämplad sträcka, omstart);
Playwright: klubbstafett med 6 lag × 3 sträckor, en sträcka byts, avläsning,
publikt lagresultat.

---

## Efter målet (inte nu)

Ordningen bestäms av ägaren efter piloten. Kandidater: Eventor-import i
produktion, minutstart med lottning för klubbtävling, startpersonalens
offlineapp, speaker-utökningar, GPS/rutter (V2 i CODEX_BRIEF).

- Jaktstart (flyttad från steg 9): kräver resultat från flera etapper (etapptävling), som modellen inte har ännu.
