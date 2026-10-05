# Status

Kort logg. Högst tio rader per steg. Nyaste överst. Historik före omstarten
finns i `docs/archive/status-2026-10-03.md`.

## Aktuellt steg

Steg 18 – Funktionärer och städning av gamla behörigheter (ADR-0172). Steg 7 (hårdvara) väntar på att ägaren har stationen till hands.

## Logg

### 2026-10-05 – Steg 17: konton och superadmin (steg 17 klart)
- Konto med e-post (normaliserad, unik oavsett versaler) i stället för inloggningsnamn; medadministratör läggs till med e-post. Öppen registrering
  spärras per IP och timme (`OTID_REGISTRATION_LIMIT_PER_HOUR`, förval 10) utöver inloggningsspärren. Demo: `demo@o-tid.local`.
- Glömt lösenord: engångslänk via SMTP (nodemailer, `OTID_SMTP_URL`/`OTID_MAIL_FROM`), hash i databasen, en timme, en gång, alla sessioner spärras,
  samma svar oavsett adress. Utan SMTP: "kontakta den som driver O-Tid" och superadmin skapar länken. Kodflödet i fil, inbjudningar och deras CLI borta.
- Superadmin sätts bara med `pnpm account:superadmin grant <e-post>` (driften: `node superadmin.mjs` i webbens avbildning). `/superadmin`: sök konton och
  tävlingar, dölj/visa, ta bort tävling (skriv namnet), spärra/släpp, ta bort konto (skriv adressen), återställningslänk; allt loggas i append-only
  `superadmin_action`. Kontrollen i `requireSuperadmin`; publika sidor och API:er visar inte dolda tävlingar (`isRacePubliclyVisible`).
- Ägaren tar bort sin tävling (Inställningar); Mitt konto (`/konto`): namn, lösenord, ta bort konto – tävlingar man äger (alltid ensam ägare) listas och
  tas bort samtidigt. Borttagningen följer databasens nycklar (`purge.ts`). `/integritet` med `OTID_CONTACT_EMAIL`. Migration 0099.
- Verifierat: lint, typecheck, test, test:integration (77 filer, nya `adr-0172-accounts`, `adr-0172-delete-race`), build, e2e varje spec för sig grön (nytt
  `konton` mot falsk SMTP). Hela sviten i en process: utvecklingsservern dödas av minnestaket (OOM, ~5 GB) efter fyra flöden. Skärmbilder granskade.

### 2026-10-05 – Steg 16: sträcktidsanalys och vägval (steg 16 klart)
- Publik `/results/{id}/splits?class=…` (länk från resultatlistornas klassrubrik, "Med sträcktider" och sidhuvudet): löpare × sträckor med
  sträcktid och placering, förlust mot bästa, totaltid med placering; bästa sträcka fetstil + ★; sortering per sträcka; vyn "Tidsförlust" med idealtid.
- Domänen `split-table.ts`: sträcka bara mellan två kända tider (missad kontroll/stämpling före start ger "–", även i steg 13-listan), sträckidentitet
  från–till, gafflat per variant, felstämplade under utan placering. Stafett: inte stödd (besked på sidan); rogaining: ingen länk.
- Vägval: Resultat → Karta och vägval (admin): kartbild, georeferens med tre punkter (klick + koordinat), GPX per löpare med "täcker x av y sträckor".
  `/results/{id}/routes` visar sträckans del av rutten på kartan (SVG, zoom/dra) med andras vägval att jämföra; aldrig före start/efter mål.
- ADR-0171, migration 0098: `race_map` och `participant_route` i PostgreSQL (bytea). Borttaget: 17 kart-/rutt-/geometritabeller, MinIO-adaptrarna
  för karta/rutt, deltagarlänkar för uppladdning, gamla kart-/ruttsidor och API:er, `route-metadata`, privata rutter i "Mina resultat".
- Verifierat: lint, typecheck, test, test:integration (78 filer, nytt `adr-0171-map-routes`; ett tidsfel efter omstart av maskinen gick igenom vid
  omkörning), build, e2e (nytt `strackanalys` grönt ensamt; hela sviten 13 flöden gröna, fyra efter omförsök av last). Skärmbilder 1280/390 granskade.
- Idéer nedan: tidsförskjutning GPS–station, KMZ/världsfil för georeferens, kontrollernas lägen från banfilen, stafettanalys.

### 2026-10-05 – Steg 15: rogaining (steg 15 klart)
- Migration 0097: `class.rogaining_time_limit_seconds`/`_penalty_points_per_minute` (rogainingklass), `control.points` (NULL = förval) och journalen
  `rogaining_change_request`. Underlagshashen tar med tidsgräns, straff och poäng (v3) bara för rogainingklasser; övriga hashar oförändrade.
- Domän `rogaining.ts` (via `evaluateCardReadout`, så även offlinepaket, omräkning och rättad tid): banversionen är kontrollmängden, förval = kodens
  tiotal (31 → 3, 102 → 10), en gång per kontroll, straff per påbörjad minut, summa ≥ 0; rangordning på summa, sedan tid, delad plats vid lika.
- Kontroller & poäng: tidsgräns och straff per klass och poäng per kontroll i raderna; sparas direkt när ingen summa/status ändras, annars besked
  och omräkning med nya revisioner. "Förbered bana och klass" har tidsgräns (60) och straff (1) i rogainingtävlingar.
- Avläsningen visar summa stort, kontrollpoäng − straff, tid mot gränsen, "För sen" med symbol och de räknade kontrollerna; övningsstationen har "för sen".
- Listor: kolumner Poäng/Straff/Summa/Tid, "med sträcktider" visar räknade kontroller, CSV och IOF XML (`<Score type="Score">`, `Penalty`, placering utan TimeBehind).
- Verifierat: lint, typecheck, test, test:integration (84 filer, nytt `adr-0170-rogaining`), build, e2e (nytt `rogaining`; i hela sviten gav lasten
  tidsfel i listor/gafflingar/admin-access, som går igenom var för sig med omförsök). Skärmbilder 1280/390 granskade.

### 2026-10-05 – Steg 14: Eventor och banfiler, med uppdateringar (steg 14 klart)
- Inställningar → Eventor (Tävling, gafflade banor, Stafett): klubbens API-nyckel sparas krypterad per tävling (AES-256-GCM, `OTID_EVENTOR_MASTER_KEY`
  i miljön; utan den startar appen och visar "inte påslaget"), visas som "Nyckel sparad", testas, byts eller tas bort. Tävlingen väljs ur klubbens lista eller med nummer.
- "Hämta/Uppdatera från Eventor" och Banor → "Läs in (ny) banfil" sparar källan som ögonblicksbild (migration 0096) och visar nya, ändrade, strukna och
  "lös själv"; rader kan bockas ur och beskedet följer urvalet. Klassbyte, ny bana och ny banversion räknas om som Redigera bana (besked, bekräftelse, ny revision).
- Matchning på Eventors id, annars namn+klubb+klass mot deltagare från fil ("matchad på namn"); direktanmälda rörs aldrig. Struken utan resultat blir ej start;
  avläst/med resultat blir konflikt. Ny bricka efter avläsning behåller resultatet. Stafettlag med sträcklöpare (vakant sträcka fylls i senare).
- Eventor-klasser utan banfil står på banan "Bana saknas" tills banfilen läses in. Adaptern `packages/eventor` omskriven (tolerant men härdad läsning, client).
- Borttaget: CLI-anslutning och grants (`scripts/eventor-*.ts`, fyra `package.json`-skript), tabellerna `eventor_*`, gamla kontrakt och tester.
- Verifierat: lint, typecheck, test, test:integration (83 filer, nytt `adr-0170-eventor-sync`), build, e2e (9 flöden, nytt `eventor` mot falsk Eventor; i hela sviten
  gav maskinens last tidsfel i listor/stafett/gafflingar, som går igenom var för sig utan omförsök). Skärmbilder granskade.
- Återstår: prov mot riktiga Eventor med klubbens nyckel (svarsformatet är byggt efter dokumentationen, fixtures är konstruerade).

### 2026-10-05 – Steg 13: start- och resultatlistor (steg 13 klart)
- Ett listmönster (`components/lists/`, modeller i `lib/lists/`, sträckplaceringar i domänens `split-table.ts`) i Start, Resultat och de publika sidorna:
  fast verktygsrad med vy, sök, klass, "Skriv ut" (egen A4-layout med tävling, lista och utskriftstid) och "Exportera" (IOF XML, CSV med BOM och semikolon).
- Start: per klass (bana, startsätt, vakanser, fri start/masstart, stafettlag), per starttid (minut för minut per startfålla, vakanser, "Nu"), per klubb.
  Publiceringen läses in av sig själv: läget i en mening och "Publicera startlistan". Lottningen överst som förut.
- Resultat: per klass, med sträcktider (per variant, bästa sträcka), per klubb; stafett som lag med sträcklöpare och sträckresultat. Efterarbete under listorna.
- Startfålla, startsätt, vakanser och bana i deltagarlistan och publiceringen; IOF StartList med TeamStart; publik IOF-resultatlista utan externa id:n.
- Borttaget: gamla publika resultat-, stafett- och startlistkomponenter, följ/favorit och ruttval i listan, adminens startunderlag och exportpanel.
- Stämpling före start eller efter mål: kontrollen räknas som stämplad men får ingen sträcktid ("–", IOF SplitTime utan Time), statusen följer vanliga regler
  och deltagarkortet visar en notis. En ogiltig rad visas utan sträcktider i stället för att fälla hela den publika listan.
- Verifierat: lint, typecheck, test, test:integration, build, e2e (8 flöden, nytt `listor`). Skärmbilder 1280/390 och utskrifts-PDF granskade.

### 2026-10-04 – Steg 12: tävlingstyp, nytt utseende och egen speakersida (steg 12 klart)
- Tävlingstyp (migration 0095) väljs i "Skapa tävling" och under nya Inställningar (namn, datum, typ, funktionärer, import). `lib/race-sections.ts`
  avgör delar och funktioner: Träning (Banor & klasser, Deltagare, Avläsning, Resultat; alltid fri start), Liten tävling, Tävling (lottning, import,
  speaker, fastställande), gafflade banor (varianter utfällda), Stafett (Klasser & sträckor, Lag), Rogaining (Kontroller & poäng med notis).
- Skal: fast toppbalk (tävling, typ, avlästa/kvar i skogen, Öppna avläsningen/speaker) och sidopanel ritad som en bana med status per del; mobil: remsa överst.
- Formspråk: tokens + Barlow/Barlow Semi Condensed (självhostat, även i avläsningens offlineskal via esbuild och manifest, `font-src 'self'`),
  komponenter i `components/ui/`, platta avsnitt och täta tabeller. Färg bara för status, åtgärd och vald del. Avläsningen är bara ljus.
- Speakern är egen sida `/admin/{id}/speaker` (senast i mål med placering, ledare per klass, kvar i skogen, stafett per sträcka); panelen i arbetsytan borta.
- Nya klasser får fri start; lottningen sätter minutstart. Parkerat bort ur arbetsytan: ruttlänkar, betalstatus (kort, lista, route) och
  kontokoppling (komponent, adminroutes); applikationskoden finns kvar. Löptider och sträcktider visas som m:ss/h:mm:ss utan millisekunder.
- Verifierat: lint, typecheck, test, test:integration (83 filer), build, e2e (7 flöden, nytt `tavlingstyper`). Skärmbilder 1280/390 granskade i två omgångar.

### 2026-10-04 – Steg 11: stafett (steg 11 klart)
- Migration 0094: `relay_leg` (sträcka, startsätt MASS_START/CHANGEOVER/RESTART, tid, valfri variant), `team` (nummer, namn, klubb),
  `entry.team_id`/`relay_leg` och journalen `relay_request`. Varje sträcklöpare är en vanlig deltagare: bricka, avläsning, revisioner och underlag fungerar som förut.
- Domän `relay.ts`: sträckans start (växling = föregående sträckas mål; omstart när laget inte växlat före tiden), lagresultat (godkänt först när alla
  sträckor är godkända; lagets tid = summan av sträcktiderna), placering med delade platser, sträckresultat per sträcka och varianter roterade över lagen.
- Sträckans start sparas som fast starttid och ingår därmed i underlaget. Ny måltid (avläsning, okänd bricka, måltidsrättning) eller nya tider räknar
  om senare sträckor i samma transaktion. En sträcka som läses före föregående sträcka får "ingen starttid" tills föregående läses av.
- Arbetsytan: "Ny stafettklass" (Klasser), lagvy med lagkort och "Byt löpare på sträcka N" (Anmälda), masstart/omstart (Start), "Lag ute" (Avläsning).
  Avläsningen visar lag och sträcka, växling eller lagets tid; övningsstationen lägger sträckorna efter varandra. Publikt: lagresultat med sträckor och
  sträckresultat, startlistan per lag. IOF: ResultList med TeamResult/TeamMemberResult, `TeamCourseAssignment` ger varianter per sträcka.
- Verifierat: lint, typecheck, test, test:integration (82 filer, nytt `adr-0169-relay`), build, e2e (6 flöden, nytt `stafett`).

### 2026-10-04 – Steg 10: gafflingar i individuella klasser (steg 10 klart)
- Migration 0093: `course_variant` + `course_variant_control` (oföränderliga, per banversion), `entry.course_variant_code` och journalen
  `course_variant_assignment_request`. Underlagshashen tar med variant och varianternas kontroller (v2) bara för gafflade banor; övriga oförändrade.
- Domän `course-variants.ts`: bedömning mot löparens variant (utan giltig variant: den variant stämplingarna passar bäst), gafflingskontroll
  (samma sträckor i alla varianter), jämn fördelning med frö, minst använd variant. Slumpen med frö ligger i `seeded-random.ts`.
- IOF: `Course` med samma `CourseFamily` blir en bana med varianter ("Lång-AC" → AC), `ClassCourseAssignment` via familj eller namn,
  `PersonCourseAssignment` (EntryId, annars namn + klass) ger löparens variant. Fixtures `*-forked.xml` (fjärilar, fyra varianter).
- Varianter ges av lottningen, "Fördela gafflingar" (avlästa får sin stämplade variant), efteranmälan (minst använd) och direktanmälan vid
  avläsning (stämplad variant). Redigera bana gäller en variant åt gången; deltagarkortet byter variant med besked när resultatet ändras.
- Variant visas i Banor (utfällbar lista, varning), Klasser, deltagarkort, lottning, startlistor, avläsningens besked, publika resultat,
  IOF-export och fastställande. Övningsstationen stämplar löparens variant.
- Verifierat: lint, typecheck, test, test:integration (81 filer, nytt `adr-0169-forking`), build, e2e (5 flöden, nytt `gafflingar`).

### 2026-10-04 – Steg 9: lottning på riktigt (steg 9 klart)
- Start: tabell med Startsätt (Fri start / Lottad minutstart / Masstart), intervall, vakanser (st eller %) och "Lotta" per klass;
  första start som klockslag och klubbseparering. "Visa lottning" visar startlistan som den blir (tider, "Vakant", startfållor).
- Domän `start-draw.ts`: blandning med frö, klubbseparering, jämnt spridda vakanser, startfållor (samma första kontroll startar aldrig
  samma minut; masstart först, största klassen först, första lediga minut) och placering av efteranmälda. Jaktstart flyttad till "Efter målet".
- Migration 0092: `start_draw_request/class/slot` (fröet sparas, visas aldrig), `class.start_draw_id`. Gamla enklasslottningen,
  slotplanen och tilldelningsjournalerna är borttagna. Ersätts tider med resultat räknas avlästa löpare om i samma transaktion.
- Efteranmälan i lottad klass: appen ger första lediga vakanta tid efter nu, annars första fria minut efter klassens sista start i fållan.
- Verifierat: lint, typecheck, test, test:integration (80 filer, nytt `adr-0169-draw`), build, e2e (4 flöden, nytt `lottning`).

### 2026-10-04 – Steg 8.5–8.6: checklista, kontrollvy och vanligt språk (steg 8 klart)
- Checklistan Banor → Klasser → Anmälda → Start → Avläsning → Resultat ersätter arbetslägen och undermenyer. Varje steg har status
  i ord och symbol (`lib/admin-checklist.ts`). Översikten och förberedelseguiden är borttagna.
- Avläsning = tävlingsdagens kontrollvy: "Öppna avläsningen", kvar i skogen (lista), okända brickor (kopplas direkt i vyn),
  felstämplade med "Öppna" till deltagarkortet och senaste avläsningar. Läses in när arbetsytan öppnas.
- Inga id, hashar, versioner, slumpfrö eller UTC-offset i vyerna: tider som klockslag, starttider och lottningens första start
  skrivs som klockslag (`parseRaceClock`). Nytt enhetstest granskar arbetsytans textfiler.
- Omförsök i `operations.ts` (`fetchWithRetry`, även rättningarna); "svaret saknas" → "Kunde inte nå servern. Försök igen."
  Namn, bricka, betalning, bana+klass, ny klass, maxantal och publicering sparas direkt; klassbyte, starttid, lottning kvar med bekräftelse.
- Verifierat: lint, typecheck, test, test:integration (83 filer), build, e2e (3 flöden via checklistan och kontrollvyn).

### 2026-10-04 – Steg 8.3–8.4: klasser som tabell och deltagarkort
- Klasser som tabell (klass, bana, startsätt, anmälda, avlästa/resultat, status) med namn, bana och startsätt i raden. Byte av bana
  eller startsätt ger besked i klartext och räknas om i samma transaktion (`editClassAsAdministrator`, migration 0091); bara namn sparas direkt.
- Deltagarkort: klick var som helst i raden. Namn/klubb, klass, bricka, starttid (klockslag), resultat i ord, sträcktider och kort historik.
  "Ändra status" ersätter åtta knappar: ett val, en mening om följden, en bekräftelse. Träningskvällens godkännande: två steg i stället för fem.
- Disk/godkännande m.fl. på ett omräknat resultat räknas som aktuellt (`isEffectiveResultCurrent`), inte längre "äldre underlag".
- Borttaget ur gränssnitt och routes: klassnamn, startregel, klassöversikten, uppföljning av starttider/klassomräkning i Klasser, åtta beslutsformulär.
- Verifierat: lint, typecheck, test, test:integration (83 filer, nytt `adr-0169-class-edit`), build, e2e (3 flöden; `redigera-bana` byter även klassens bana och använder kortet).

### 2026-10-04 – Steg 8.2: Redigera bana
- Banor visas som tabell (bana, kontroller, klasser, anmälda, avlästa) med "Redigera" i raden. "Visa vad som händer" prövar
  varje avläsning mot nya kontrollföljden med resultatmotorn och ger beskedet i klartext; bekräftelse krävs bara när någon byter status.
- Sparande i en transaktion: ny banversion, alla klasser på banan flyttas, tävlingsversionen +1 och avlästa löpare räknas om
  (ny revision, historik kvar). Ej start och manuellt rättad tid räknas inte om; disk/godkännande m.fl. gäller som förut.
- Migration 0090 (`course_edit_request`, idempotent journal). Gamla verktygen för omlänkning, banrättning efter resultat,
  resultatpåverkan och neutralisering är borttagna ur gränssnitt och routes; applikationsfunktionerna finns kvar.
- Verifierat: lint, typecheck, test, test:integration (82 filer, nytt `adr-0169-course-edit`), build, e2e (3 flöden, nytt `redigera-bana`).
- Återstår: en disk eller ett godkännande på ett omräknat resultat visas fortfarande som "äldre underlag" (beslutsrevisionen bär gamla underlaget).

### 2026-10-03 – Steg 8.1: resultat är aktuella per löpare
- Migration 0089: `result_revision.basis_hash`, sätts av databasen vid insert (klass, startsätt, banversion med
  kontroller, strukna kontroller, fast starttid). Äldre revisioner utan hash jämförs som tidigare.
- Alla ställen som avgjorde "äldre underlag" via tävlingsversionen använder nu `isResultCurrent`. Godkännande av en
  felstämplad löpare kräver inte längre omräkning efter en direktanmälan (träningskvällstestet har en omräkning mindre).
- Verifierat: lint, typecheck, test, test:integration (81 filer, nytt `adr-0169-result-basis`), build, e2e.

### 2026-10-03 – Förberedelse för steg 7
- Avläsningssidan loggar all stationstrafik i minnet. "Ladda ner rålogg" ger trafiken och loppets råramar som JSON
  (inga namn). Täcks av enhetstest och träningskvällstestet.

### 2026-10-03 – Steg 2 klart
- `race-administrator-workspace.tsx` 4 301 → 189 rader: session, laddning och navigering. Områdena (förberedelse,
  deltagare, resultatbeslut, tävlingsdag, efter tävlingen) ligger i `components/race-administrator/` (22 filer, största 543).
- En gemensam anrops-/operationshjälp (`operations.ts`); de fem likadana resultatbesluten laddas med samma funktion.
- `race-administrator-route-handlers.ts` 1 382 → 84 rader (dispatcher) + fyra gruppfiler; testerna delade likadant.
- Borttaget: inloggning med åtkomstkod via `POST /session` (ger nu 405) och 1 200 rader oanvänd CSS.
- Ingen fil i `apps/web/src` över 800 rader (största: `globals.css` 629). Markup, etiketter och roller oförändrade.
- Verifierat: lint, typecheck, test, build, e2e (utvecklingsläge och driftbygge bakom HTTPS).

### 2026-10-03 – Steg 6 klart
- `Dockerfile` (Next standalone + paketerad migrering som körs före start), `docker-compose.prod.yml` med PostgreSQL,
  webb, Caddy (automatisk HTTPS) och backup (`pg_dump` vid start och varje natt, 14 dagars rotation). `docs/drift.md`.
- Verifierat lokalt utan Docker (registren nås inte här): produktionsbygget bakom Caddy med HTTPS – båda webbläsarflödena
  gröna, även offline-avläsningen. Backup, rotation och `pg_restore` provade; samma antal rader efter återställning.
- Verifierat i CI-jobbet `production`: `docker compose up --build`, webbläsartesterna mot https://localhost och att en
  backupfil skapas. CI är grönt för första gången: avbildningen `postgis/postgis:17-3.6` fanns inte (nu 17-3.5).
- Rättat: IOF-exporten avvisade svar som Caddy komprimerat (ETag/content-length). Innehållshashen kontrolleras fortfarande.

### 2026-10-03 – Steg 5 klart
- `tests/e2e/traningskvall.spec.ts`: 10 löpare genom hela kedjan – två banor/klasser (fri start är standard), åtta
  förhandsanmälda, avläsning med övningsstationen (delvis offline, omladdning offline), två okända brickor
  direktanmäls, kvar i skogen = 2, felstämplad räknas om och godkänns manuellt, publikt resultat, IOF XML-export.
- "Kvar i skogen" visas som eget tal i Under tävlingen (anmälda som varken lästs av eller är ej startande).
- `pnpm demo` ersätter `demo:provision`, `demo:access:copy`, `db:seed` och utvecklingsinloggningen för demotävlingar.
- `simulatedRun`/`readSimulatedCard` i `packages/sportident` används av övningsstationen, demon och tester.
- Övningsstationens okända bricka springer vald deltagares bana. `readout.spec.ts` ingår nu i träningskvällstestet.
- Verifierat: lint, typecheck, test, test:integration (80 filer), build, e2e (2 flöden).

### 2026-10-03 – Steg 4 klart
- `/admin/<lopp>/readout` leder till appskalet `/readout/` (esbuild + service worker, `build:shells`). Det startar utan nät.
- Web Serial (38 400, sedan 4 800 baud) eller övningsstation (`FakeSiStation` genom samma protokollkod). Stort besked med
  symbol och text, sträcktider, statusrad (station, internet, kö, underlagsversion). Serverns bedömning gäller och avvikelser visas.
- Kö i IndexedDB per lopp med stabilt enhets-/sessions-id och löpnummer. Raderas aldrig; status ändras bara vid kvittens.
  Utgången adminsession förnyas via kontot. Nya routes `readout-package` och `readouts` på adminsessionen.
- Kontrakt: transport `sportident` med råramar (hex). Mål får saknas (migration 0088); bedöms som felstämplad.
- Den gamla simulatorsidan är borttagen. Stationsappens bearer-ingest finns kvar (parkerad).
- Verifierat: lint, typecheck, test, test:integration (81 filer), build, e2e (`readout.spec.ts`: offline-avläsning → omladdning
  offline → synk → publikt resultat → okänd bricka direktanmäls i Hantera). Hårdvara: fortfarande `untested`.

### 2026-10-03 – Steg 1 klart
- Självregistrering på `/organizer`. Kontoinloggningen gäller i 30 dagar (migration 0087).
- `/manage` öppnas med kontot, utan behörighetskod. En kontoinloggad admin (MANAGE_RACE) får alla funktioner i tävlingen.
- IOF-importen använder adminsessionen. Eventor-importen är borttagen från sidan (parkerad).
- Borttaget: 27 dubblettsidor, ~75 API-routes, 33 behörighetsskript, kontoinbjudningskoder, CREATE_EVENT-sidorna,
  skrivstoppet (`ops/systemd`, `proxy.ts`) och 154 gamla webbläsartestfiler (38 konfigurationer, mest röda vid baslinjen).
- Nytt: en Playwright-konfiguration, `tests/e2e/admin-access.spec.ts` (konto → tävling → bana/klass/deltagare →
  medadmin → publik/401), integrationstestet `adr-0168-two-levels` och routetester för registrering. CI kör e2e igen.
- **Avvikelse från planen:** tabeller och applikationskod för de gamla rollerna ligger kvar men nås inte från webben.
  Stationsparning/-credentials, start-/målpersonalens koder och claim-koder finns kvar (parkerade, steg 4 tar stationen).
  Publik speakervy är inte gjord. Demo (`demo:provision`) fungerar inte längre och ersätts i steg 5.

### 2026-10-03 – Steg 3 klart (gjort före steg 1–2, oberoende av dem)
- Nytt paket `packages/sportident`: ramtolkning med CRC, tillståndsmaskin för avläsningsstation,
  avkodning av SI5/6/8/9/10/11/SIAC/pCard, tidstolkning med tidszon samt `FakeSiStation`.
- 55 tester: alla chunkgränser, fel CRC/ETX, trunkering, dubbletter, alla bricktyper, uttagen bricka,
  tidsgräns, station utan handskakning, fel inställd station, AM/PM, midnatt, vintertid.
- CRC verifierad mot publicerade ramar. Minneslayouterna är jämförda mot en oberoende öppen avkodare
  (bara som referens, inte kopierad): allt stämmer utom SI6-kontrollkoder >255, där referensen har fel.
- Hårdvara: alla rader `untested` i `docs/sportident.md` tills steg 7.

### 2026-10-03 – Steg 0 klart
- Git och GitHub (`joelberring/otid`). TASK-filer, gamla status- och plandokument är flyttade till `docs/archive/`.
- **Fel i migreringarna:** drizzles migrator kör allt i en transaktion, och PostgreSQL vägrar då använda nya
  enum-värden. `pnpm db:migrate` kraschade på ny databas och vid uppgradering över flera migrationer.
  `@o-tid/database` har nu en egen `migrate` som committar enum-värden först och sedan kör en transaktion per fil.
- Borttaget (parkerat enligt ADR-0168, testerna krävde macOS): backup/replikering och PM-skannerns Docker-isolering.
- Röda tester som var föråldrade är rättade: formatversioner 10/12/14 → 15, motorversion 0.1.1, ett tidsberoende
  test (TASK160), ett för strikt namnkrav på testdatabas (TASK153), kortbyte med extra fält (TASK030), TASK300/301.
- Gröna: lint, typecheck, `pnpm test`, `pnpm test:integration` (ett test om begränsade roller hoppas över tills steg 1), `pnpm build`.
- **Webbläsartester:** `pnpm test:e2e` går inte att köra som helhet. Det finns 38 separata Playwright-konfigurationer
  och flera specar kräver egna databaser och miljövariabler. Adminflödets svit: 22 av de första 24 testerna föll
  (tidsgränser). Ersatt i steg 1.
- CI kör nu lint, typecheck, test, integration och build. Android-jobbet är borttaget (parkerat).

### 2026-10-03 – Omstart
Granskning visade 301 uppgifter på fem veckor men ingen riktig brickavläsning,
en Android-app som aldrig byggts och för mycket behörighetsmaskineri.
Ägaren beslutade om ny plan (`PLAN.md`) och ADR-0168: ett mål (körbar
klubbträning), avläsning i webbläsaren via Web Serial, eget SPORTident-protokoll
nu, två behörighetsnivåer (admin och alla andra) och parkering av GPS,
deltagarkonton med mera. `AGENTS.md` har bantats från 210 KB. Den gamla finns i
`docs/archive/AGENTS-2026-10-03.md`.

Kvarstår för ägaren: begära *PC Programmer's Guide* från SPORTident
(support@sportident.com), välja server för drift (steg 6), skaffa station och
brickor till steg 7.

## Idéer (inte i planen än)

- Vägval: justera tidsförskjutning mellan GPS-klocka och stationer per rutt; georeferens från KMZ eller världsfil (OCAD) i stället för tre punkter;
  kontrollernas lägen från banfilens koordinater; sträcktidsanalys för stafett (per sträcka); uppladdning av flera GPX-filer matchade på namn.

- Stafett: bana per sträcka finns bara via en gafflad bana (variant per sträcka). Det fastställda resultatets IOF-export skriver inte lag än. Kvar i skogen räknar även sträcklöpare som inte startat.

- Gafflingar: en klass som byter till en gafflad bana (Redigera klass) får inga varianter automatiskt; "Fördela gafflingar" gör det. IOF StartList/ResultList-export skriver inte variantens namn.
- Klassbyte till en lottad klass ger inte automatiskt en vakant tid; arrangören anger tid som förut.
- Fastställande jämför beslutsrevisionens bana med klassens: en disk som ligger kvar efter banändring kan ge "fel bana" där. Pröva i steg 8.5/8.6.
- …
