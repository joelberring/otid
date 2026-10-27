# O-Tid – plan till första riktiga användning

Beslutad 2026-10-03 av ägaren (Joel). Detta är den **enda backloggen**. Codex
arbetar steg för steg uppifrån och ned. Nya idéer skrivs under "Idéer" i
`STATUS.md` – de blir inte nya uppgifter förrän ägaren flyttar in dem här.

Bakgrund och beslut: [ADR-0168](docs/adr/ADR-0168-omstart-mot-klubbtraning.md) och
[ADR-0169](docs/adr/ADR-0169-enkel-yta-gafflingar-stafett.md) (steg 8–11) och
[ADR-0170](docs/adr/ADR-0170-tavlingstyper-utseende-eventor-rogaining.md) (steg 12–15).

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

Det som **inte** behövs för målet är parkerat (se ADR-0168): GPS-följning,
deltagarkonton, Android-stationsappen, betalstatus, backup-replikering m.m. Kartor och rutter för
vägval i sträcktidsanalysen lyftes ur parkeringen i steg 16 (ADR-0171).

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

## [x] Steg 10 – Gafflingar i individuella klasser

Se ADR-0169 beslut 2.

1. Banvarianter i modellen och resultatmotorn; variant per deltagare.
2. IOF XML CourseData med varianter och CourseAssignment importeras
   (fixtures från OCAD/Purple Pen). Varianter lottas annars jämnt i klassen.
3. Avläsning, startlista och resultat visar variant. Kontroll som varnar om
   varianterna inte täcker samma sträckor.

**Acceptans:** domäntester för bedömning per variant; integrationstest för
import; Playwright: gafflad klass läses av med rätt variant.

## [x] Steg 11 – Stafett

Se ADR-0169 beslut 3.

1. Stafettklass med sträckor och startsätt per sträcka; lag med sträcklöpare,
   bricka och variant (gafflingar från steg 10).
2. Avläsning per sträcka; lagresultat, växlingstider och omstart i domänen.
3. Lagvy: anmäl lag, byt sträcklöpare, lag ute per sträcka. Publik
   resultatlista per sträcka och lag. IOF XML-export för stafett.

**Acceptans:** domäntester för lagresultat (felstämplad sträcka, omstart);
Playwright: klubbstafett med 6 lag × 3 sträckor, en sträcka byts, avläsning,
publikt lagresultat.

## [x] Steg 12 – Tävlingstyp, nytt utseende och egen speakersida

Se ADR-0170 beslut 1–2.

1. **Tävlingstyp** väljs när tävlingen skapas (Träning, Liten tävling,
   Tävling, Tävling med gafflade banor, Stafett, Rogaining) och kan ändras
   under Inställningar. Typen styr vilka delar som syns och förvalen.
2. **Skal och navigering:** sidopanel som alltid syns (mobil: remsa överst),
   ritad som en bana med tävlingens delar som kontroller och status per del;
   fast toppbalk med tävlingen och läget. Inga delar som typen inte behöver.
3. **Formspråk:** återhållsamt (gråskala, färg bara för status, åtgärd och
   markerat val) och typsnitt enligt ADR-0170, gemensamma komponenter
   (knappar, fält, tabeller, verktygsrad, besked, tomma lägen) i en liten
   komponentmapp; alla adminvyer, avläsningssidan och de publika sidorna
   använder dem. Tätare tabeller, tydligare hierarki.
4. **Speaker** som egen sida som uppdateras av sig själv: senast i mål,
   ledare per klass, kvar i skogen per klass, stafett per sträcka.

**Acceptans:** Playwright: skapa en tävling av varje typ och kontrollera att
rätt delar syns; navigeringen syns efter att man rullat. Skärmbilder 1280 och
390 px av varje huvudvy granskade. Befintliga flöden gröna.

## [x] Steg 13 – Start- och resultatlistor

Se ADR-0170 beslut 3.

1. Start: startlista per klass, per starttid (för startfunktionärer, minut för
   minut och per startfålla) och per klubb.
2. Resultat: per klass, med sträcktider, per klubb; publicera, fastställ.
3. Verktygsrad med vy, sök/filter, utskrift (egen utskriftslayout) och export
   (IOF XML och CSV) på samma ställe i båda.

**Acceptans:** Playwright: varje vy visas, utskriftsläget ger en ren sida,
export laddas ner. Skärmbilder granskade.

## [x] Steg 14 – Eventor och banfiler, med uppdateringar

Se ADR-0170 beslut 4.

1. Koppla tävlingen till Eventor (klubbens API-nyckel, krypterad) och välj
   tävling i Eventor; hämta klasser och anmälningar med bricka.
2. Läs in banfil (IOF XML) med banor, varianter och klasskopplingar.
3. Båda kan läsas in igen: skillnader visas (nya, ändrade, strukna) och
   godkänns; resultatpåverkan går genom besked och omräkning.

**Acceptans:** integrationstester mot inspelade Eventor-svar; Playwright:
första import, ändrad anmälan och struken löpare vid omläsning, ändrad bana i
ny banfil.

## [x] Steg 15 – Rogaining

Se ADR-0170 beslut 5.

1. Klasstyp rogaining: tidsgräns, poäng per kontroll (förval efter
   kontrollkodens tiotal, kan ändras), straff per påbörjad minut.
2. Bedömning i domänen; avläsningen visar poäng, straff och summa.
3. Resultatlista sorterad på poäng och tid; IOF-export med poäng.

**Acceptans:** domäntester (dubbelstämpling räknas en gång, straff, lika
poäng); Playwright: rogaining-tävling, två löpare, en för sen, rätt ordning.

## [x] Steg 16 – Sträcktidsanalys och vägval (görs sist)

Ägarens önskemål 2026-10-05: en separat lista i stil med WinSplits som man kan
trycka på och komma vidare till vägval på kartan när sådana finns.

1. Publik sträcktidsanalys per klass: sträcktider och placering per sträcka,
   bästa sträcka markerad, tidsförlust mot bästa, sortering per sträcka.
2. Från en sträcka eller löpare: länk till vägval på kartan när karta och
   rutter finns (bygger på den parkerade kart- och ruttkoden, som lyfts ur
   parkeringen i det här steget).
3. Resultatlistorna i steg 13 länkar hit men visar inte själva vägvalen.

**Acceptans:** Playwright: öppna sträcktidsanalysen från resultatlistan, sortera
på en sträcka, öppna vägval för en löpare med uppladdad rutt.

Se ADR-0171 (karta och rutter i PostgreSQL, bara admin laddar upp, den gamla kartkoden borttagen).

## [x] Steg 17 – Konton och superadmin

Se ADR-0172 beslut 1–2.

1. Inloggning och registrering med e-post. Öppen registrering med spärr mot
   upprepade försök.
2. Glömt lösenord via e-post när SMTP är inställt; annars återställningslänk
   från superadmin. Det gamla kodflödet i fil tas bort.
3. Superadmin (sätts med kommando på servern): lista konton och tävlingar,
   dölja/ta bort tävling, spärra/ta bort konto, skapa återställningslänk.
   Åtgärderna loggas.
4. Ägaren kan ta bort sin tävling; användaren kan ta bort sitt konto. Kort text
   om vilka personuppgifter som sparas.

**Acceptans:** integrationstester för registrering, återställning, spärr och
borttagning; Playwright: registrera med e-post, glömt lösenord (med fångad
e-post i test), superadmin tar bort en skräptävling och spärrar kontot.

## [x] Steg 18 – Funktionärer och städning av gamla behörigheter

Se ADR-0172 beslut 3.

1. Rollen Funktionär på tävlingen, kopplad via e-post under Inställningar.
2. Funktionären når avläsning, direktanmälan av okänd bricka, kvar i skogen,
   start och speaker, men inget annat. Samma kontroll på servern överallt.
3. Ta bort funktionärskoder, stationsparning och stationscredentials, separata
   inloggningar för kvar i skogen och incheckning, gamla `api/events`-flödet med
   credential, `/me` och deltagarkoderna.

**Acceptans:** integrationstester för vad Funktionär får och inte får;
Playwright: admin lägger till funktionär, funktionären läser av och ser kvar i
skogen men når inte banor eller resultatändring; två enheter på samma konto.

## [x] Steg 19 – Publik startsida och tävlingssida

Se ADR-0172 beslut 4.

1. Tävlingen är dold tills den publiceras; steget syns i checklistan.
2. Startsidan: Pågår nu, Kommande, Senaste och sök. Inga adminlänkar för besökare.
3. Publik tävlingssida med kort adress och utskrivbar QR-kod: startlista,
   resultat, sträcktidsanalys.

**Acceptans:** Playwright: opublicerad tävling syns inte för besökare;
publicerad syns under rätt rubrik; QR-sidan skrivs ut rent; 390 px.

## [x] Steg 20 – Radiokontroller via ROC

Se ADR-0172 beslut 5.

1. Koppla tävlingen till ROC eller OResults (enhetens id) och välj
   radiokontroller.
2. Servern hämtar stämplingar med `lastId`, sparar dem oföränderligt och
   idempotent, och visar fel och senaste hämtning i klartext.
3. Mellantider live i resultatlistan och sträcktidsanalysen; speakern visar
   "passerat radiokontroll" och ledare vid radiokontrollen.

**Acceptans:** adaptertester mot inspelade ROC-svar (dubbletter, okända
brickor, trasiga rader); integrationstest för hämtning med `lastId`;
Playwright mot falsk ROC: radiostämpling syns som mellantid och hos speakern
innan löparen läst av.

## [x] Steg 21 – Kopiera tävling och kvitto vid avläsning

1. "Ny tävling som …": kopierar banor, klasser, inställningar och funktionärer
   men inga deltagare eller resultat. Gör återkommande träningar snabba.
2. Efter avläsning: sträcktidskvitto att skriva ut (smal layout för
   kvittoskrivare) och QR-kod till löparens resultat.

**Acceptans:** Playwright: kopiera förra veckans träning och läs av en löpare
i kopian; kvittot visar sträcktider och skrivs ut rent.

---

## [x] Steg 22 – Rätta buggarna från granskningen 2026-10-18

Granskningen (ägaren 2026-10-18) hittade fel som ska bort före hårdvarutestet.

1. Resultatmotorn: matcha banan mot stämplingarna som ordnad delföljd, så att
   extra- och dubbelstämplingar (även vid kontroller som återkommer i
   fjärilsslingor) ger godkänd, inte "fel ordning". Höj motorversionen.
2. Tid: stationens klocka som referens vid tidsupplösning (GET_TIME), större
   tolerans och varning vid klockskillnad i stället för tyst förskjutning.
3. Övningsstationen simulerar relativt löparens starttid, så att en riktig
   avläsning på en kommande tävling blir godkänd; bricka som sitter i före
   handskakningen läses; avsluta pågående falsk bricka vid ny insättning.
4. Dubbla klass- och bannamn avvisas. "Kvar i skogen" räknar inte anmälda
   före tävlingsdagen. "Ej start" visas inte som målgång hos speakern.
   "Karta och rutter kunde inte hämtas" på Resultat-steget. IOF-import
   validerar bricknummer.

**Acceptans:** domäntester för fallen ovan; Playwright: övningsstation på
kommande tävling ger godkänd; dubbelt klassnamn ger fel.

## [x] Steg 23 – Storstädning av koden

Se ADR-0173.

1. Ta bort död kod: `packages/infrastructure`, PM-kedjan, moduler och kontrakt
   som inget anropar, cookie-filer per funktion, `apps/participant`,
   `apps/worker`, Android-transporten, oanvända tabeller, döda i18n-nycklar,
   gamla importsidan `/imports`.
2. Ett statusflöde: `setEntryStatus` som lägger till en resultatrevision
   ersätter de tolv besluts- och återtagandetjänsterna med tabeller, kontrakt
   och rutter. Återta = ny revision. Historik = revisionerna.
3. Ta bort tävlingsversionsgrinden (`expectedSnapshotVersion`) ur
   adminåtgärder; underlagshash per löpare gäller (ADR-0169).
4. En sessionsnivå: kontosession + rollkontroll per tävling. `pairing_admin_*`
   och delegationer bort. Ingen "Öppna med mitt konto".
5. En `appendResultRevision` och en `evaluateAndStore` som alla skrivställen
   använder. En säkerhetspolicy. Ett suffix (`AsAdmin`).
6. Slå ihop migrationerna till en baslinje. Dela `task-001.test.ts` efter
   beteende och ta bort tester för borttagen kod. Uppdatera referensdokumenten
   eller arkivera dem.

**Acceptans:** alla flöden i Playwright passerar oförändrade; `pnpm test`,
`test:integration` och `build` gröna; radantal och tabellantal i `STATUS.md`.

## [x] Steg 24 – Enklare arbetsyta

1. Primära knappar i tomlägen ("Ny bana", "Ny klass", "Ny deltagare");
   banfil och hopfällda formulär sekundära.
2. Ny deltagare i ett steg; starttid frivillig när klassen lottas.
3. Ett ordval för startsätt överallt. Sidopanel och rubriker säger samma sak.
   Publicera på ett ställe. Start i ordningen lottning → lista → publicera.
4. Ingen låsning av hela arbetsytan vid sparning. Direkt in i arbetsytan
   efter "Skapa tävling".
5. Svenska fältfel i stället för webbläsarens. Jargongen bort (lista i
   granskningen). Filterraden på Anmälda minskad.

**Acceptans:** Playwright: tre deltagare på under tio klick; skärmbilder
granskade på 1280 och 390 px.

## [x] Steg 25 – Saknade tävlingsfunktioner

1. Startstämpling som reserv vid lottad start, med varning vid sen start.
2. Direktanmälan av okänd bricka på avläsningssidan, även offline.
3. Maxtid per klass (OverTime) och "markera alla kvar som ej start".
4. Banlängd och stigning lagras; IOF-resultat med person-/klubb-id, bricka
   och bana. Livelistan märkt preliminär. Disk med orsak. Hyrbricksvarning
   vid avläsning.

**Acceptans:** domän- och integrationstester per punkt; Playwright för 1–2.

## [x] Steg 26 – Avancerad lottning

Ägarens önskemål 2026-10-19. Enkla läget i Lottning blir kvar som i dag; resten
ligger under knappen "Avancerat".

1. Lotta alla klasser eller bara de ikryssade. Redan lottade klasser rörs inte;
   nya tider läggs bland de befintliga utan krock (efteranmälda klasser kan
   lottas senare).
2. Gemensamma kontroller i början: välj hur många av banans första kontroller
   (1–3) som avgör startgrupp. Samma startgrupp startar aldrig samma minut.
3. Max antal startande per minut, totalt och per startfålla. Varning om det
   inte går inom startfönstret.
4. Senare start per klass: eget första klockslag eller förskjutning från
   tävlingens första start (t.ex. för speakerns bevakning). Startordning
   mellan klasser kan styras.
5. Seedning: seedade löpare (manuellt eller från ranking i importerad fil)
   lottas sist i klassen eller med jämna mellanrum; övriga lottas fritt före.
6. Förhandsvisningen visar regelbrott och var de nya tiderna hamnar innan
   något sparas.

**Acceptans:** domäntester per regel (krock i startgrupp, tak per minut,
senare klass, seedning, delvis lottning bevarar befintliga tider);
Playwright: lotta en klass, efteranmäl en klass och lotta bara den, en klass
med senare start och seedad löpare sist.

## [x] Steg 27 – Rättelser efter första piloten (2026-10-19)

Ägaren provade riktig station (BSM, SI9) och riktiga Eventor ikväll.

1. Deltagarkortet och avläsningen visar alla brickans stämplingar, även från
   annan dag eller annan bana, med förklaring ("från ons 14 okt", "ingen
   startstämpling").
2. "Ny klass" listar alla banor, även de som saknar klass.
3. "Ta bort deltagare" utan avläsning; "Stryk" (dold i listor, historik kvar)
   med avläsning. "Ta bort bana" och "Ta bort klass" när inget hänger på dem
   (klass utan anmälda; bana utan klass); annars ett besked om vad som måste
   flyttas först.
4. Mina tävlingar: idag och kommande först (närmast först), sedan gångna.
5. Fastställande blir en knapp "Resultaten är klara" (fryser listan, märker
   "Officiella resultat", ger IOF-fil för Eventor, kan ångras); klassvis
   fastställande under Avancerat; dold för träning och liten tävling.
6. "Exportera tävlingen" till en fil med allt (banor, klasser, anmälda,
   starttider, råa avläsningar, resultat, historik).
7. Småsaker: varning vid gamla Eventor-variabelnamn i `.env`; "inga
   tävlingar" i stället för "Eventor svarar inte"; jargong ("publicerat
   resultat") bort; drivrutin för Mac i instruktionen för stationen; radiohämtningen
   väntar längre vid databasfel.

**Acceptans:** Playwright för 1–5; integrationstest för export.

## [x] Steg 28 – Vanlig PostgreSQL i stället för PostGIS

PostGIS-tillägget skapas i baslinjen men används inte längre (kartor och rutter
ligger som bytea, ADR-0171). Byt till den officiella `postgres:17`-bilden i
`docker-compose.yml`, `docker-compose.prod.yml` och CI, ta bort
`CREATE EXTENSION postgis` och `platform: linux/amd64`. Då fungerar O-Tid på
ARM (Apple-datorer utan Rosetta, Oracle Cloud gratis, Hetzner CAX) och drar
mindre minne.

**Acceptans:** alla tester och CI-jobbet `production` gröna med `postgres:17`;
`docs/drift.md` nämner billiga och gratis serveralternativ.

## [x] Steg 29 – Löpardatabas från Eventor

1. Hämta klubbens (och vid behov hela landets) löpare med bricka och Sveriges
   klubbar från Eventor (`/api/export/cachedcompetitors`, `/api/organisations`,
   IOF 3.0 CompetitorList); uppdateras med en knapp; ligger med i
   avläsningspaketet för offline.
2. Okänd bricka: namn och klubb fylls i ur databasen. Namnfält föreslår löpare,
   klubbfält föreslår klubbar (med Eventor-id), i avläsningen och i "Ny
   deltagare".
3. Personuppgifter: bara admin och funktionärer, aldrig publikt; kan raderas;
   står i integritetstexten.
4. Okänd bricka: stämplingarna jämförs mot alla banor (samma bästa-passning som
   gafflingar); klassen vars bana passar förväljs ("Passar H21 (Lång), alla
   kontroller"). Anmälda i de klasserna utan bricka eller utan avläsning
   föreslås överst ("Koppla brickan till Anna Ek?"). Arrangören väljer alltid
   själv; fungerar offline.

**Acceptans:** adaptertester mot inspelad struktur; Playwright: okänd bricka
fylls i från databasen offline.

## [x] Steg 30 – Live för publiken

Ägarens önskemål 2026-10-19: följa tävlingen i mobilen utan inloggning.

1. "Live" på den publika tävlingssidan: senast i mål (namn, klass, tid,
   placering), ledare per klass med markering vid ny ledare, radiopassager när
   radiokontroller används. Uppdateras av sig själv (samma ström som
   resultatlistan).
2. Följ löpare eller klubb: stjärnmärkta hamnar överst; valet sparas bara i
   mobilen, inget konto.
3. Inga bricknummer eller interna uppgifter; fungerar på 390 px.

**Acceptans:** Playwright: avläsning syns i Live inom några sekunder hos en
anonym besökare; följd klubb hamnar överst efter omladdning.

## [x] Steg 31 – Tävlingsdagens nödlägen

Ägarens önskemål 2026-10-20 inför natt-KM: justera och stänga av kontroller för alla eller för en deltagare och
godkänna löpare ändå. Allt med förhandsvisning, ångra och auditpost; råa avläsningar ändras aldrig.

Del A – kontroller och tider för hela tävlingen (Avläsning → Rättningar för hela tävlingen):

- [x] A1. Justera tid för en station (start, mål eller kontrollkod, ± min och s, orsak), före bedömningen; "Ta bort"
  räknar om tillbaka; deltagarkortet visar att tiden är justerad.
- [x] A2. Kontroll ur funktion för hela tävlingen (alla banor, även gafflade); ersätter strykningen per klass.
- [x] A3. Flytta starttider för en klass (Start → Startlistan → Flytta starttider).
- [x] A4. Bortse från gamla stämplingar på oröjd bricka (> 12 h före avläsningen eller > 10 min före clear/check).
- [x] A5. Räkna om hela tävlingen (Resultat → Efterarbete).

Del B – enskilda löpare, brickor och avläsningens robusthet:

- [x] B1. "Ange tid manuellt" i deltagarkortet: måltid, starttid eller löptid, status (Godkänd/Felstämplad) och orsak,
  med avläsning (saknad målstämpling, mål före start, start saknas, fel klocka) och utan (tappad eller trasig bricka).
  Markeras "Manuell tid"; "Ta bort manuell tid" ger bedömningen från avläsningen. Brutit även utan avläsning.
- [x] B2. Manuella beslut (även rättad mål- och starttid) ligger kvar över ny avläsning av samma bricka och omräkning.
- [x] B3. "Godkänn saknade kontroller" (kryssrutor och orsak); "Godkänn manuellt" kräver orsak och visas bara när tiden finns.
- [x] B4. Samma bricka hos två löpare: en avläsning av ett nytt lopp med en bricka vars deltagare redan har resultat
  skriver inte över det utan blir okänd ("redan avläst för X – lånad bricka?") i kontrollvyn och på avläsningssidan, med
  koppla/direktanmäl/"Det är samma löpare – använd den nya avläsningen". Kopplingen flyttar brickan; omräkning utgår
  från deltagarens egen avläsning.
- [x] B5. Robusthet: "Räkna om från avläsningen" även utan resultat; bricktid som inte går att tolka prövas med datorns
  klocka och försvinner aldrig (listas tills den tagits bort); en avläsning som ger serverfel hålls åt sidan och resten av
  kön skickas ("Försök igen"); Övningsstation varnar på tävlingsdagen.

## [x] Steg 32 – Avläsning på läsplatta (Android)

- [x] CP210x-drivrutin över WebUSB och "Anslut via USB (läsplatta)" på avläsningssidan. Provas på riktig platta.

## [x] Steg 33 – Tävlingsinfo och bricka i startlistan

Ägarens önskemål 2026-10-20: bricknummer i startlistan även för de som inte är inloggade, kort info om tävlingen och när
första start är (infopunkt, inte tävlingsklocka), synligt för alla.

- [x] Inställningar: "Visa bricknummer i den publika startlistan" (på som standard), "Kort info om tävlingen" och "Första start".
- [x] Publicerad startlista med kolumnen Bricka när inställningen är på; avstängd döljer den direkt. Inga brickor i Live, resultat eller speaker.
- [x] Infon överst på tävlingssidan och i arbetsytans Start-steg.
- [x] "Uppdatera startlistan löpande" (Start → Publicera startlistan, av som standard): ändringar syns publikt utan ny publicering.

## [x] Steg 34 – SIAC från station som skickar alla åtta block

- [x] Blocken placeras efter blocknumret; "alla block" läses till block 7; ofullständig bild vägras. Rättat efter natt-KM 2026-10-20.

## [x] Steg 35 – Fler statusval, avläsaren ansluter själv och ljud

Ägarens önskemål efter en skarp klubbtävling 2026-10-20: fler val än brutit och ej start (några sprang utan tid eller
bricka, disk ska finnas), avläsaren ska komma ihåg stationen när man byter sida, och ett kort glatt ljud vid godkänt och
ett kort moll-ljud vid fel.

- [x] Statusval: Ej start, Brutit, Diskvalificera (valfri orsak), Utom tävlan och Deltog utan tid överallt där brutit
  finns, med och utan avläsning; "Öppna" i kontrollvyns Kvar i skogen. Deltog utan tid visas sist i klassen och
  exporteras som IOF NotCompeting utan tid; ett beslut räknas som i mål i kvar i skogen.
- [x] Avläsaren ansluter själv till en redan godkänd station (WebUSB och Web Serial) när sidan öppnas och när
  stationen sätts i; "Sluta ansluta automatiskt"; länkarna öppnas i en ny flik.
- [x] Ljud vid avläsning (dur vid godkänt, moll vid fel), på som standard och sparat per webbläsare.

## [x] Steg 36 – Läs om avläsningar från rådata

Efter natt-KM 2026-10-20 (steg 34): avläsningar som sparats med fel stämplingar ska kunna rättas från de sparade råramarna.

- [x] Avläsning → "Läs om avläsningar från rådata" (admin): förhandsvisning av avläsningar som blir annorlunda (bricka, deltagare, före → efter)
  och de som inte går att läsa om; "Spara och räkna om" för valda. Ny avläsning och revision (READOUT_REREAD), originalet ändras aldrig.
- [x] Manuella beslut ligger kvar och visas i förhandsbeskedet; deltagarkortet erbjuder "Läs om" när avläsningen blir annorlunda.
- [x] Brådskande: nio till tolv råramar tas emot; lokalt avvisade avläsningar (LOCAL_INVALID) prövas igen och skickas.

## [x] Steg 37 – Om O-Tid, kontakt och hjälp

Ägarens önskemål 2026-10-21: en adress för frågor (otid@berring.se), info om programmet i öppet och inloggat läge (hur det är
gjort, tekniska funktioner, öppet att använda i beta) och en hjälpknapp i programmet där man kan läsa och söka hur funktionerna fungerar.

- [x] Publik sida "Om O-Tid" (`/om`): vad O-Tid är, beta och gratis, hur det är gjort, tekniska funktioner, kontakt och "skapa konto".
- [x] Diskret sidfot "O-Tid · beta · Frågor: otid@berring.se · Om O-Tid" på publika sidor och i arbetsytan, dold vid utskrift;
  adressen på ett ställe (`apps/web/src/lib/contact.ts`, även förval för `OTID_CONTACT_EMAIL`).
- [x] "Hjälp" i arbetsytans toppbalk, på Mina tävlingar och på avläsningssidan: panel med stegets artiklar först, lokal sökning
  (versaler och å/ä/ö spelar ingen roll), Esc stänger. Artiklarna i `i18n/help-sv.ts`; ett test slår upp varje citerad knapp i UI-texterna.

## [x] Steg 38 – Avsluta tävlingen: avgjorda resultat, bekräfta felstämplad, sträcktider vid brutit

Ägarens rapport efter en skarp tävling: "Resultaten är klara" stoppades med "H12: Minst ett resultat eller en bana kan inte
kontrolleras" fast alla hade resultat, tre bekräftade felstämplingar låg kvar som varningar, och brutit tömde mellantiderna.

- [x] Varje avgjort resultat kan fastställas: avläsning, omläsning, manuell tid, rättad tid och godkända kontroller samt MP,
  DNF, DSQ, DNS, utom tävlan, deltog utan tid och maxtid. Bara oklart stoppar (inaktuellt underlag, okända brickor, kvar i
  skogen); beskedet säger vem det gäller och vad man gör, med "Öppna" till deltagarkortet.
- [x] "Bekräfta felstämplad" (valfri orsak) i deltagarkortet, ångras med "Ta bort bekräftelsen". Bekräftade räknas inte
  som att titta på; obekräftade stoppar inte "Resultaten är klara" utan visas som information.
- [x] Brutit, disk, utom tävlan och deltog utan tid med avläsning behåller sträcktiderna fram till sista stämplade kontrollen
  (resultatlista, sträcktidsanalys, deltagarkort, publikt och IOF), utan tid och placering.

## [x] Steg 39 – Lokalt stoppade avläsningar avkodas på nytt

- [x] Avläsningar som stoppades i webbläsaren för att de avkodats fel avkodas från råramarna när sidan laddas och skickas.

## [x] Steg 40 – Fest-läge med bardisk

Ägarens önskemål 2026-10-24 (Centrum OK:s 20-årsfest): gästerna betalar drinkar med sina SI-brickor utan radio, två
avläsningsstationer och en Android-platta.

- [x] Tävlingstypen Fest: varor som kontrollenheter (kod, namn, pris), festens start, köpen räknade ur brickornas stämplingar
  (dubbelstämpling inom 5 s ett köp), in- och utcheckning (startenhet, målenhet eller bardisken), ångra med orsak, CSV-export.
- [x] Bardisken i ett fönster i automatiskt läge med lokal kö, namnruta vid okänd bricka och personalens lägen.
- [x] Publik fest-sida med statistik, namn bara via JavaScript och skydd mot indexering; utseende och logga per fest.

## [x] Steg 41 – Självregistrering på tävlingsdagen

Ägarens önskemål 2026-10-24: "Kan man göra så att alla kan registrera ny deltagare i ej inloggat läge (men bara under
tävlingsdagen). Genom att skriva in pinn-nummer och koppla namn?" och "välja smeknamn som står i resultatlistan, typ Oskar K
men att fullt namn spara för fakturering".

- [x] "Tillåt självregistrering på tävlingsdagen" (av som standard, auditpost): i fest-arbetsytan och under Inställningar (inte stafett).
- [x] "Registrera din pinne" på `/fest/{kod}` och `/t/{kod}` utan inloggning, bara när valet är på, tävlingen är publicerad och det är
  tävlingsdagen i tävlingens tidszon (fest: till kl 06 dagen efter); servern kontrollerar samma sak.
- [x] Upptagen bricka avvisas; fest: gästen namnges (bardisken känner igen brickan), andra typer: ny deltagare i vald klass, okänd
  avläsning bedöms. Spärr per IP (hashad) och tävling, fälla mot robotar, normaliserade namn, "Självregistrerad" i listorna.
- [x] Fest: visningsnamn (smeknamn, förval "Oskar K") är det enda som visas publikt och i kiosken; fullt namn i arbetsytan och CSV.

## [x] Steg 42 – Fest: Eventor-nyckel och kvällens sträcktider

Ägarens önskemål 2026-10-24: "sträcktiderna ska visa deltagarnas köp och typ av köp under kvällen. med smeknamnen".

- [x] Fest-typen kan spara Eventor-nyckeln och hämta löpardatabasen.
- [x] "Kvällens sträcktider" på den publika fest-sidan: en rad per gäst med köp, in, varje köp med vara och sträcktid, mål och
  totalt; bara visningsnamnet, "Gäst N" när namn inte visas; aldrig bricka, fullt namn eller belopp.
- [x] Raden under rubriken: "Registrera din pinne" utfällbar, länk till sträcktiderna och hur man betalar.
- [x] QR-skylt `/fest/{kod}/qr` (A4) i festens utseende, nåbar från arbetsytan, samma skydd som fest-sidan.

## [x] Steg 44 – Rättelser efter genomlysningen: stopp och fest

Genomlysningen 2026-10-25 (motor, drift, säkerhet) efter två tävlingar och en klubbfest.

- [x] Speakern svarar även när en struken löpare har resultat bland de senaste (strukna filtreras före urvalet).
- [x] Migratorn bokför per migration (tagg, för äldre rader `when` eller hash): varje journalrad som saknas körs, i journalordning,
  även med lägre `when`. Journalen har unika taggar och `when`, och `idx` 0..n.
- [x] Manuella beslut (manuell och rättad tid, godkänd, godkända kontroller, bekräftad felstämpling, brutit, disk, utom tävlan, utan
  tid) följer med när resultatet räknas om efter banredigering, flyttad starttid eller ny lottning; förhandsvisningen av banändringen
  säger hur många som berörs.
- [x] Övningsstationens avläsningar märks (`card_readout.simulated`, migration 0019) och räknas inte som festens köp; bardisken
  varnar.
- [x] Personalens lägen gäller en utläsning; "Ta bort incheckning" och "Ta bort utcheckning" per gäst (även via start och mål);
  samma målstämpling checkar inte ut igen.
- [x] Dubbelstämpling jämförs med senast räknade köpet.
- [x] En festpinne som redan har köp namnges i bardisken, inte via det publika formuläret.
- [x] Namnrutan stänger efter 20 s när andra utläsningar väntar.

## [x] Steg 45 – Rättelser efter genomlysningen: avläsning, regler och drift

Genomlysningen 2026-10-25 (motor, avläsning och drift). Ägarens beslut: stämpling efter mål eller före start har ingen betydelse.

- [x] Avläsningskön: 400, 404 och 409 håller bara den avläsningen åt sidan ("N avläsningar kunde inte skickas", "Försök igen"); 429 väntar.
- [x] Avläsningar vars tider inte gick att tolka skickas till servern (råmeddelande `sportident-uninterpreted`, ingen avläsning),
  "Ladda ner listan" på avläsningssidan, Avläsning → "Otolkade avläsningar" läser om med datorns klocka eller angiven tid.
- [x] Stationens klocka mer än 6 h fel: datorns klocka gäller (clockSource device) med tydligt besked.
- [x] Rättad starttid och manuell tid utgår från tiderna efter tidsjusteringen.
- [x] Omräkning tar aldrig någon annans avläsning (bara egen, eller brickans senaste som ingen annan har); annars NO_READOUT.
- [x] Beslut som döljer en senare avläsning: varning med "Ta bort beslutet" i deltagarkortet, i kopplingskvittot och
  "Beslut att se över" under Resultat → Efterarbete.
- [x] Tidsjustering för "Alla enheter (start, mål och kontroller)" (migration 0020).
- [x] Backup varje timme kl. 08–23, 48 timdumpar och dagsbackup, "dump nu", scp, återställning, misslyckad migrering, swap, loggstorlek.
- [x] Disk och utom tävlan ovanpå manuell tid, utom tävlan på rogaining; index på card_readout(race_id, read_at).
- [x] Motor 0.6.0: stämplingar mellan start och mål väljs vid lika matchning (oröjd bricka); varning när ett godkänt saknar sträcktider.

## [x] Steg 46 – Rättelser efter genomlysningen: säkerhet och integritet

Genomlysningen 2026-10-25 (säkerhet #1, #3–#10).

- [x] Säkerhetshuvuden: nosniff, Referrer-Policy och X-Frame-Options DENY på alla svar; strikt CSP med nonce
  (`script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`) på Next-sidorna;
  avläsningen och bardisken får Web Serial och WebUSB på rätt adress. Playwright kontrollerar de riktiga svarshuvudena.
- [x] Fest: "Visa namn på den publika sidan" av för nya fester; formuläret och fest-sidan säger när köpen visas med visningsnamnet.
- [x] /integritet och /om stämmer med appen: fest, självregistrering och IP-hash, bricknummer i startlistan, live och
  sträcktider, fest-sidan stängd för sökmotorer, lagringstider och radering.
- [x] Självregistrerade märks "självreg." i den publika startlistan; 100 per tävling och dygn; "Stryk alla självregistrerade
  som inte läst ut" med förhandsvisning under Anmälda.
- [x] Spärrarnas nycklar är HMAC med serverns hemlighet (`OTID_THROTTLE_SECRET`, reserv `DATABASE_URL`) och gamla rader
  rensas; inloggningen spärras också per IP (30 fel på 15 minuter), och spärrarna är tidsbegränsade.
- [x] Bardiskens namn och klubb normaliseras; hjälpen säger att funktionären ser fullt namn och kan ladda ner CSV.

## [x] Steg 47 – Stafett: bana per sträcka, ändra klass och lag, rättvis gaffling, omstart, synlighet

ADR-0174 beslut 1–5. Migration 0021.

- [x] Bana per sträcka (bedömning, omräkning, avläsning, startlista, resultat, IOF-export och -import med `AllowedOnLeg`,
  `TeamCourseAssignment` mot sträckans bana, banredigering).
- [x] Ändra stafettklass (namn, sträckor sist, startsätt, tider, bana och variant per sträcka) med besked och omräkning;
  lag: ändra, ta bort, stryk, hela laget ej start; byt variant per sträcka.
- [x] Omstart: flyttad tid, flera omstarter, flygande omstart (ledarens växling + gräns), placering efter SOFT TR 5.8.2
  (alternativ: efter tid), funktionärsvy per omstart.
- [x] Rättvis gaffling (utjämnad eller fulgaffling), kontroll per lag.
- [x] Variant och omstart i resultatlistan, lagkortet och speakern; radio, Live och vägval för sträcklöpare. 30 sträckor.

## [x] Steg 48 – Stafett: flera löpare per sträcka och teamsprint

ADR-0174 beslut 6–8. Migration 0022.

- [x] Parallella sträckor: 2–4 löpare per sträcka, växlar när första eller sista är i mål, godkänt när alla eller minst
  en är godkända; IOF EntryList `TeamEntryPerson` med `Leg` och `LegOrder`, `LegOrder` i resultatlistan.
- [x] Teamsprint: växlingskontroll, brickan delas per sträcka, felstämplad del, tydligt besked vid saknad växling; mallen
  "Teamsprint (2 löpare × 4 sträckor)".
- [x] Lagformuläret och lagkortet visar flera löpare och teamsprintens sträckor; resultatlistan löparna i ordning och vem
  som växlade. Klassynken upprepas tills starterna är stabila.
- [ ] Eventors lagformat (`TeamSequence`); längd per variant (steg 49).
## [x] Steg 49 – Gafflingar: se, bygga och redigera visuellt

ADR-0175. Gafflingsstruktur (enkel gaffling, fjäril, i följd) med varianter i OCAD/Purple Pen-stil, härledning ur banfilens
varianter och rättvisekontroll per gafflingssätt (Utjämnad/Fulgaffling). Bilden i banlistan, redigering i bilden (även ny
gafflad bana), "Visa gafflingar" i resultatlistan och på deltagarsidan, sträcktidsanalys per sträcka, kontrollernas lägen
ur IOF XML, längd per variant och banan på vägvalskartan.

## [x] Steg 51 – Lasttest: hur stor tävling klarar en liten server

`docs/lasttest.md`, skript i `scripts/lasttest/` (`pnpm lasttest:seed`, `pnpm lasttest:load`). Produktionsbygget och
PostgreSQL 17 med 2 kärnor och 4 GB (CX23): 3 000 löpare/40 klasser (gafflade, lottade), stafett 300 × 3 och 300 × 25,
målrusning från tre avläsningsdatorer (toppar 3/s), 100–500 besökare med resultatströmmen, speakern och funktionärsåtgärder.
Före: 100 besökare mättade servern. Rättat: de publika listorna räknas en gång per tävlingsversion (gzip, ETag), stora
listor skickas inte med sidan, resultatströmmen samlar och sprider väckningarna, stafettsynk per lag, starttidsflytt per
klass, omförsök vid läskonflikter och två webbinstanser i drift. Efter: 3 000 löpare och 300 besökare med p95 under 1 s
för publiken och uppdatering inom 5 s; serverns kvitto p95 1,3–1,7 s; 25-manna klarar ungefär en utläsning per sekund.
## [x] Steg 50 – Teamsprint: utläsning efter varje sträcka

ADR-0174 beslut 9. Migration 0024.

- [x] Förval "Utläsning efter varje sträcka" (som MeOS): utläsningen går till löparens första sträcka utan resultat och
  bedöms mot stämplingarna efter föregående utläsnings mål; ingen växlingskontroll behövs. Mallen ger förvalet.
- [x] Dubblett är omläsning; tidigare måltid eller alla sträckor utlästa ger besked och en okänd utläsning.
- [x] Glömd utläsning: delas vid växlingskontrollen om den finns, annars efter banorna med beskedet "Utläsning efter
  sträcka X saknas – läs ut efter varje sträcka"; ingen felstämpling av den.
- [x] "Utläsning efter sista sträckan (växlingskontroll)" finns kvar som val per klass.
- [x] Beskedet säger vilken sträcka utläsningen gällde; lagkortet visar varje sträckas utläsning.
- [x] Teamsprint vid okända utläsningar och omläsning från rådata; löpare, växlingskontroll och utläsningssätt kan ändras
  när lag finns.

## [x] Steg 52 – Kontrollkartan och banhemlighet

ADR-0176. Migration 0026.

- [x] Banhemlighet: publikt ingen gafflingsbild, ingen bana med kontrollägen på vägvalskartan och inga kontrollägen i
  API:erna förrän ingen deltagare är kvar, resultaten är fastställda eller arrangören valt "Visa banorna publikt nu"
  (auditpost, går att ångra). Arbetsytan visar läget under Publicera. Arrangören och funktionärerna ser allt.
- [x] Kontrollkartan i arbetsytan (Banor → Kontrollkarta, egen dialog): kontroller, start och mål i rätt läge och skala med
  skalstock, georefererad kartbild under; kartlägen (MapPosition, mm, med kartans skala) när lägena saknas.
- [x] Växla bana och variant; vald bana med linjer och nummer, övriga nedtonade; gafflingsbilden för en gafflad bana.
- [x] Belastning per kontroll (banor, varianter, planerade löpare, stämplingar) med färg, storlek och tabell; kontroll ur
  funktion markerad.
- [x] Deltagarkortet "Visa på kartan": stämplade, saknade ("Kontroll 35 saknas, mellan 34 och 36") och fel ordning;
  stafettsträckan och teamsprintlöparens alla sträckor.
- [x] Publikt på deltagarsidan bakom "Visa på kartan" när banorna är publika; bara löparens bana, ingen belastning.
- [x] Utan koordinater: gafflingsbilden, kontrollerna i ordning och tabellen, inget fel.

## [x] Steg 53 – Snabbare utläsning av nyare brickor

Ägaren: "Det tar ganska lång tid att läsa in nyare pinnar jämfört med äldre." Underlag (MeOS, sportident.js, sireader) i
`docs/research/sportident-protocol-source-gate.md`, beskrivning och siffror i `docs/sportident.md`.

- [x] SI10/SI11: block 0, sedan bara stämplingsblocken 4, 5 … (32 per block). SIAC: block 0, 1 och stämplingsblocken.
  SI6: block 0, sedan 6/7 efter antal. SI5 och SI8/SI9/pCard som förut. 20 stämplingar: 2 svar (SIAC 3) i stället för 5/8.
- [x] Reserv: NAK, fel block, tidsgräns, fel bricka i block 0 eller block som inte går ihop med block 0 ger "alla block" för
  samma bricka direkt, med post i felsökningsloggen. Bricka uttagen mitt i: misslyckad avläsning som förut.
- [x] Inställning "Snabb utläsning av SI10/11/SIAC" (på som förval) under felsökningsloggen på avläsningssidan.
- [x] Felsökningsloggen: stationens inställningar (blockinställning `0x33`), utläsningssätt, antal svar och ms per bricka.
- [x] Tester: plan för 0–128+ stämplingar, reservvägen, bit för bit samma block och bild som "alla block", natt-KM:s SIAC.
- [ ] Ägaren provar SIAC, SI10, SI8 och SI5 på riktig station (steg 7).

## [x] Steg 54 – Tävlingen först: avläsning och arbetsyta före publiken

ADR-0177, `docs/lasttest.md`, `docs/drift.md`. Ingen ny migration. Ingen uppskalning (CX23 kvar).

- [x] Två slags instanser: `web` (arbetsytan, avläsningen, funktionärerna, inloggningen, admin-API:t) och `web-public` +
  `web-public2` (publika sidor och API:er, Live, resultatströmmen). Caddy delar per sökväg; inloggade går alltid till
  `web`. En instans klarar ändå allt (`OTID_INSTANCE_ROLE` saknas, lokalt och med `pnpm dev`).
- [x] `cpu_shares` (1024 databasen och `web`, 256 per publik instans) och minnestak per tjänst som ryms i 4 GB.
- [x] Separata pooler: tävlingens utan tidsgränser, publikens med `statement_timeout` 5 s, `lock_timeout` 2 s och
  `idle_in_transaction_session_timeout` 10 s; publiken kan inte ta tävlingens anslutningar.
- [x] Lastavlastning: senast färdiga listan längre vid tryck, glesare uppdatering och väckning, tak för strömmar, kö och
  sist 503 med Retry-After; sidorna försöker igen tyst.
- [x] Avläsningen läser bara löparens eller lagets del; stafettklasser utan flygande omstart låses per lag.
- [x] Lasttest före/efter: 1 000 besökare och målrusning gav kvitto p95 6,8 → 0,68 s och arbetsytan p95 4,0 → 0,69 s;
  25-manna 300 lag kvitto p50 26,6 → 2,0 s (p95 91 → 11 s).
- [x] "Hur stora tävlingar klarar O-Tid?" på `/om` med de uppmätta siffrorna.
## [x] Steg 55 – Bana utan klass

Ägaren: "varför måste man välja klass när man skapar banor?"

- [x] "Ny bana": klassnamnet är valfritt ("Klassnamn (valfritt)"). Utan klassnamn sparas bara banan med kontrollföljden
  ("Spara bana", "Banan är sparad."); med klassnamn som förut ("Spara bana och klass"). Startsätt och rogainingens
  tidsgräns och straff visas bara när ett klassnamn finns. Journal (`class_id` NULL, migration 0027), auditpost för banan,
  idempotens och dubblettnamn som förut.
- [x] Fälten på samma rad börjar på samma höjd, även med ett fel under ett av dem (även "Ny klass").
- [x] Banan utan klass syns i Banor, kan ändras och gafflas, väljas under Klasser ("Ny klass", nu även en gafflad bana),
  som sträckans bana i stafett och i kontrollkartan.
## [x] Steg 56 – Stafettformuläret: fel vid fälten och mallar

ADR-0174 beslut 10. Ingen migration.

- [x] Fel vid fälten i "Ny stafettklass", "Ändra stafettklass" och "Nytt lag" (klassnamn, bana, masstart- och omstartstid,
  minuter för flygande omstart, växlingskontroll, lagnamn, löparnas namn och brickor), sammanfattade överst, fokus på det första.
- [x] Bana per sträcka ("Bana sträcka N", krävs) och snabbvalet "Samma bana på alla sträckor"; klassens bana är sträcka 1:s.
- [x] Mallar som en rad med val: vanlig stafett, teamsprint, ungdomsstafett och linjestafett, med besked och markering.
- [x] "Fler inställningar": lag i omstart (vid omstart), gaffling (vid gafflad bana), teamsprint och växlingskontroll.
- [x] Tider som 18:30, 18.30 och 1830. Playwright `stafett-steg56.spec.ts`.

## [x] Steg 58 – Tävlingar över midnatt

ADR-0178.

- [x] Tävlingsdygnet till kl 12 dagen efter: stämplingar efter 00:00 hör till tävlingen; "annan dag" bara utanför det.
- [x] Klockslag efter midnatt (omstarter, starter, sista start, rättad tid) blir natten efter när de ligger nära
  masstarten eller första start.
- [x] Radiokontrollerna fortsätter efter midnatt; övningsstationen flyttar inte "nu" ett dygn bakåt.
- [x] Avläsningsskalet räknar avläsningen i kön innan beskedet visas.
- [x] Övningsbrickan dras ur efter stationens senaste svar, så att en hackande webbläsare inte ger "lästes inte färdigt".
- [x] E2E-testerna oberoende av klockslaget (tävlingsdagen är startens datum, kvitto per avläsning); domän- och
  integrationstest över midnatt (individuell klass, stafett med omstart 00:30); listor och stafett-steg47 körda med
  simulerad klocka (21:59, 23:30, 00:10, 13:00, TZ=UTC).
- [ ] Orsaken till felen i CI är inte bevisad (gick inte att få fram lokalt); live, radio, sträckanalys, tävlingsdag-
  rättningar och tävlingsfunktioner flyttar fortfarande tävlingen till en annan tidszon nära midnatt.

## [x] Steg 57 – Placering vid avläsningen

ADR-0177 beslut 10. Ingen migration. Ägaren: "det borde stå placering av de som är i mål här och hur långt man är efter".

- [x] Godkänd löpare: "2:a av 12 i mål · +2:14 efter Ada Ek" / "Leder · 1:05 före tvåan" i avläsningsrutan, märkt
  preliminärt; lika tid ger delad placering, en gafflad klass rankas ihop, rogaining på poäng. Ej godkända: ingen placering.
- [x] Från serverns kvitto, ur den cachade listan för tävlingsversionen med de nyare avläsningarna inlagda (ingen ny
  uträkning per avläsning). Lasttestet: kvitto p95 0,51 → 0,59 s under målrusning med 1 000 besökare, 150 av 150 med placering.
- [x] Utan nät: "Placering visas när nätet är tillbaka"; placeringen kommer när kön har skickats. Aldrig en gammal siffra.
- [x] Stafett: lagets placering efter sträckan och sträcktiden mot bästa på sträckan; flera löpare per sträcka och teamsprint
  enligt ADR-0174.
- [x] Papperskvittot (80/58 mm) har samma rad ("Preliminärt: …"); utan placering hänvisar det till resultatlistan.
  Automatisk utskrift väntar högst 2 s på placeringen när nätet finns.
- [x] Tester: domän `readout-placement`, webb `placement-text`, `readout-placement`, cachens `latest`, integration
  `steg-57-placering` (placering, lika tid, felstämplad, stafett), Playwright `placering.spec.ts` (övningsstation, utan nät,
  papperskvitto).

## Efter målet (inte nu)

Ordningen bestäms av ägaren efter piloten. Kandidater: inloggning med Google
eller Eventor, självanmälan till träningar, resultat tillbaka till Eventor,
flerdagarstävlingar, deltagarkonton med egna resultat, avgifter och betalning,
engelska, GPS-följning (V2 i CODEX_BRIEF).

- Jaktstart (flyttad från steg 9): kräver resultat från flera etapper (etapptävling), som modellen inte har ännu.
