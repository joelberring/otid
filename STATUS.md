# Status

Kort logg. Högst tio rader per steg. Nyaste överst. Historik före omstarten
finns i `docs/archive/status-2026-10-03.md`.

## Aktuellt steg

Steg 7 – Riktig hårdvara och pilot (ägaren). Alla andra steg i `PLAN.md` är klara.
Riktiga tjänster: Eventor (klubbens nyckel, tävlingslistan, klubben och klubbens löpare via `cachedcompetitors`, strukturen) provad mot riktiga Eventor 2026-10-19; hela landets `cachedcompetitors` och `/api/organisations` måste provas av ägaren; ROC:s sökväg för stämplingar (bara provad mot falsk ROC) och e-post via SMTP är inte provade.

## Logg

### 2026-10-26 – Steg 50: teamsprint med utläsning efter varje sträcka (agent A)
- Förval som MeOS (`class.relay_readout_mode`, migration 0024): utläsningen går till löparens första sträcka utan resultat och bedöms mot stämplingarna efter förra utläsningens mål; ingen växlingskontroll behövs. Steg 48:s sätt är ett val.
- Dubblett = omläsning; tidigare måltid eller alla sträckor utlästa blir okänd utläsning med besked. Glömd utläsning: växlingskontrollen om den finns, annars banorna i tur och ordning och "Utläsning efter sträcka X saknas".
- En sträcka som saknar start (föregående saknar växling) räknas som ute, inte felstämplad. Delningen räknas ur sträckornas resultatrevisioner.
- Avläsningens besked "Lag 12 Ek – sträcka 3 (Ada Ek, andra sträckan)"; lagkortet visar varje sträckas utläsning; övningsstationen har en bricka per sträcka.
- Rättat: teamsprint vid okända utläsningar (journalens brickkoppling hör till brickan) och omläsning; löpare, växlingskontroll och utläsningssätt kan ändras när lag finns.
- Tester: domän `team-sprint-steg50`, integration `adr-0174-teamsprint-utlasning`, Playwright `stafett-steg50`; `stafett-steg48` provar valet efter sista sträckan.

### 2026-10-26 – Steg 48: flera löpare per sträcka och teamsprint (agent A)
- Parallella sträckor (migration 0022: `relay_leg.runners`, växlings- och godkännanderegel, `entry.relay_leg_order`): FIRST/LAST, ALL/ANY.
- Teamsprint: växlingskontroll per klass, brickan på löparens första sträcka (`entry.relay_card_entry_id`), avläsningen delas i resultatmotorn; saknad växling ger besked.
- Lagformulär, lagkort, resultatlista ("växlade"), avläsningsskalet (alla sträckor på brickan), mallen Teamsprint.
- IOF EntryList TeamEntry (Leg, LegOrder) importeras; LegOrder i resultatlistan; startlistan tar flera löpare per sträcka.
- Rättat: klassynken upprepas tills starterna är stabila (avläsning i omvänd ordning, teamsprintens sista sträcka); stafettens skrivningar får 64 KiB (25 sträckor gick inte att spara med 4 KiB).
- Tester: domän `relay-steg48`, integration `adr-0174-flera-lopare`, Playwright `stafett-steg48`.
- Kvar: Eventors `TeamSequence`; teamsprintdelar i okänd-bricka-lösningen och omläsning; ändra löpare/växlingskontroll bara innan lag finns.

### 2026-10-25 – Steg 47: stafett på riktigt (agent A)
- Bana per sträcka (`relay_leg.course_version_id`, migration 0021, underlagshash per sträcka), AllowedOnLeg i IOF, banan per sträcka i startlista/export.
- Ändra stafettklass med besked och omräkning; ändra/ta bort/stryk lag, hela laget ej start, byt variant per sträcka.
- Omstart: flyttad tid räknas om, flygande omstart (ledarens växling + gräns), klassynk under lås per klass, SOFT TR 5.8.2 som förval.
- Rättvis gaffling (utjämnad/fulgaffling) med kontroll per lag i lagvyn; funktionärsvy för omstarter; radio, Live, speaker och vägval för sträcklöpare; 30 sträckor.
- Tester: domän `relay-steg47`, integration `adr-0174-stafett` (25 × 300: avläsning 0,35 s, publik lista 0,25 s), Playwright `stafett-steg47`.
- Kvar: längd per variant (kräver steg 49:s variantlängd). Två Playwright-test behöver sex timmar av dygnet: tävlingen läggs i New York-tid när det inte ryms i Stockholm.
### 2026-10-25 – Steg 49: gafflingar som struktur och bild (ADR-0175)
- Domän `course-forking.ts`: enkel gaffling och fjäril (Purple Pen fork/loop) i följd, varianter med OCAD/Purple Pen-koder, härledning ur banfilens varianter, graf, rättvisa per gafflingssätt (Utjämnad/Fulgaffling, stoppar aldrig), längd ur lägen; `buildLegSplitTable` (sträcktider per kontrollpar).
- Migration 0023: `course_version.forking`, `course.forking_mode`, start/mål-lägen, `course_variant.length_meters`, `control.latitude/longitude`. Redigera bana tar en struktur: löparna behåller kontrollföljden under ny kod, försvunna får ny variant genom fördelningen; omräkning i samma transaktion.
- Banor: bilden (SVG) med anmälda/avlästa per gren, Gafflingssätt, längd och skillnad per variant, "Gaffla banan", "Redigera gafflingar" (klick på kontroll/sträcka i bilden, fält per alternativ, varianterna direkt), "Gör om till struktur".
- Publikt: "Visa gafflingar" i resultatlistan och på deltagarsidan; sträcktidsanalysen per sträcka (förval) eller per variant; banan på vägvalskartan.
- Tester: domän `course-forking`, `split-table`; iof-xml `parser`; webb `forking-diagram`; integration `steg-49-gafflingsstruktur`, `adr-0171-map-routes`; Playwright `gafflingsbild` (ny), `gafflingar`, `stafett`, `listor`, `strackanalys`.
- Kvar: gaffling inuti fjäril går inte att bygga; banan ritas inte på en egen karta i arbetsytan.

### 2026-10-25 – Steg 44: rättelser efter genomlysningen (stopp och fest)
- Speakern: strukna löpare filtreras i urvalet av de 25 senaste (gav 500). Migratorn bokför per tagg (ny kolumn `tag`; äldre rader matchas på `when` eller hash och får taggen), kör varje saknad migration i journalordning oavsett `when`; journalens `idx` är nu 0..n (0014–0018 numrerades om).
- Manuella beslut följer med vid omräkning (banredigering, starttid, lottning): beslutet tas bort och läggs på nytt ovanpå den nya tekniska revisionen (`carryManualDecisions`), med samma innehåll (manuell tid: måltiden står kvar, starten följer den kända starten). Godkännande som inte behövs längre tas bara bort. "N löpare har manuella beslut" i banändringens besked. Placeringar och "Resultaten är klara" fungerar efter banredigering (motor #2 och #8).
- Fest: `card_readout.simulated` (0019, ifylld ur råmeddelandet); övningsstationens köp räknas inte i summeringen, CSV eller fest-sidan, bardisken varnar. "Ta bort incheckning/utcheckning" (admin, `party_presence_void`, auditpost); samma målstämpling checkar inte ut igen. Personalens läge gäller en utläsning. Dubbelstämpling mot senast räknade köpet (0/4/8/12 s → 2 köp). Självregistrering på en pinne med köp avvisas ("gå till bardisken"). Namnrutan 20 s med kö.
- Tester: domän `decision-carry`, `party`; webb `party`; integration `steg-44-migrator`, `speaker-board`, `adr-0169-course-edit`, `administrator-start-time`, `entry-changes`, `steg-40-fest`, `steg-41-sjalvregistrering`; `migration-journal`. Verifierat: lint, typecheck, test, test:integration (340, med `--testTimeout=60000`), build, Playwright `fest`, `sjalvregistrering`, `redigera-bana`, `manuellt`, `lottning`, `avslut`.
- Beslut utan avläsning (manuell tid för tappad bricka, brutit, disk) läggs på nytt när de bygger på ett äldre underlag; i en klass med lottad start följer den manuella tidens start den nya starttiden.
- Risk: "Ta bort in-/utcheckning" är bara för admin (som ångra köp). `notRecalculatedCount` blir alltid 0 och kan tas bort ur kontrakten. Integrationstester med 5 s-gräns faller under last (tre agenter samtidigt).

### 2026-10-25 – Steg 45: rättelser efter genomlysningen (avläsning, regler, drift)
- Avläsningskön: 400/404/409 skickas om en och en och hålls åt sidan ("Försök igen"), 429 väntar; resten av kön går. Stationsklocka > 6 h fel: datorns klocka (clockSource device) och besked.
- Otolkade avläsningar (SiTimeError): råramarna skickas till `uninterpreted-readouts` (råmeddelande, parser_status uninterpreted), "Ladda ner listan"; Avläsning → "Otolkade avläsningar" läser om med datorns klocka eller angiven tid (ny avläsning, okänd bricka under Okända brickor).
- Regler: rättad starttid/manuell tid efter tidsjustering (`preparedReadoutTimes`); omräkning tar aldrig en avläsning som någon annans resultat bygger på (NO_READOUT); "Beslut att se över" (deltagarkort, kopplingskvitto, Efterarbete) när ett beslut döljer en senare avläsning; station ALL = alla enheter; disk/utom tävlan ovanpå manuell tid; utom tävlan på rogaining.
- Migration 0020 (station ALL, index card_readout(race_id, read_at)). Drift: backup varje timme 08–23 (48 + dagsbackup, atomärt), `sh /backup.sh dump`, scp, återställning, misslyckad migrering, build före up -d, swap, loggstorlek.
- Tester: webb `readout`, `clock`, `failed-readouts`, `decision-review`; domän `station-corrections`, `decision-review`, `manual-decision`, `rogaining`; integration `steg-45-rattelser`, `steg-31-lanad-bricka`, `entry-status-times`.
- Motor 0.6.0: vid lika många matchade kontroller väljs stämplingar mellan start och mål (oröjd bricka); "Godkänd, men inga sträcktider" i avläsningens besked.
- Kvar: otolkade avläsningar stoppar inte "Resultaten är klara"; varningen för godkänt utan sträcktider finns bara på avläsningssidan.

### 2026-10-25 – Steg 46: rättelser efter genomlysningen, säkerhet och integritet
- Huvuden: nosniff, Referrer-Policy och X-Frame-Options DENY på alla svar (`next.config.ts`); strikt CSP med nonce på Next-sidorna (`src/proxy.ts`, `lib/content-security-policy.ts`, rotlayouten renderar vid förfrågan); avläsningen/bardisken får serial/usb på `/admin/{id}/readout` och `/readout/`. Inga sidor bäddas in, så inga undantag. Playwright `sakerhetshuvuden` läser de riktiga huvudena.
- Fest: "Visa namn på den publika sidan" av för nya fester (`partyShowsPublicNames`); formuläret och fest-sidan säger "Dina köp visas med ditt visningsnamn på den här sidan." när namnen visas.
- /integritet och /om: fest, självregistrering och IP-hash, bricknummer i startlistan, live och sträcktider, noindex, lagring och radering.
- Tävling: självregistrerade märks "självreg." i den publika startlistan (enklast och syns direkt; att vänta på bekräftelse kräver ett nytt flöde), 100 per tävling och dygn, "Stryk alla självregistrerade som inte läst ut" under Anmälda (förhandsvisning, auditpost per deltagare, idempotent).
- Spärrar: HMAC med `OTID_THROTTLE_SECRET` (reserv `DATABASE_URL`, inget behöver läggas till i drift), rader äldre än två dygn rensas vid skrivning; inloggningen spärras också per IP (30 fel/15 min). Spärren per e-post var redan tidsbegränsad (15 min).
- Bardiskens namn och klubb normaliseras; hjälpen och Personer med behörighet säger att funktionären ser fullt namn och kan ladda ner CSV.
- Tester: domän `party-public-names`, integration `steg-46-sakerhet` (+ `steg-41` med namn på), Playwright `sakerhetshuvuden`, `sjalvregistrering-tavling`, `fest`, `sjalvregistrering`.

### 2026-10-24 – Steg 42: fest – Eventor-nyckel, kvällens sträcktider och QR-skylt
- Fest-typen visar Eventor-nyckeln och löpardatabasen under Inställningar (utan tävlingsval och import).
- "Kvällens sträcktider" (`#stracktider`) på `/fest/{kod}`: en rad per gäst med köp (flest först, vid lika tidigaste första köpet), In, varje köp ("21:14 Margarita" med färgprick per grupp/vara), Mål och "+18:30" sedan förra händelsen; Totalt = antal köp och tid från incheckning (eller första köpet) till utcheckning (eller senaste köpet). Bara köp som räknas (`partyLedger`: start, dubbelstämpling, ångrade bort). Rullar i sidled med namnet fast; var 10:e sekund.
- Namn bara visningsnamnet via JavaScript; namn av ger "Gäst N" (numrerade efter när gästen först syntes). Kontraktet `splits` är strikt (bara `guestNumber`, valfritt `name`, tider, varunamn, grupp); `superRefine` avvisar namn när namnvisning är av.
- Raden under rubriken: "Registrera din pinne" utfällbar (knapp med aria-expanded, stängd, bara när självregistreringen är öppen), länk "Kvällens sträcktider" och tre rader om hur man betalar (i18n).
- QR-skylt `/fest/{kod}/qr` (A4 stående, @page, 100 %): rubrik och logga i festens utseende, QR till `/fest/{kod}`, adressen och hur man betalar, inga namn; samma grind, X-Robots-Tag och robots-meta. "Skriv ut QR-skylt" i fest-arbetsytan.
- Tester: domän `party` (sträcktider, sortering, Gäst N), webb `party-splits`, integration `steg-40-fest` (steg 42, båda namnlägena utan bricka/fullt namn/belopp), Playwright `fest` och `sjalvregistrering`. Verifierat: lint, typecheck, test, test:integration (330), build. Skärmbilder granskade på 390 och 1280 px.
- Risk: "Summan dras från ditt klubbkonto" är ett antagande i texten (`party-public-sv.ts`); ändra om betalningen sker på annat sätt. Ett köp efter utcheckningen står före Mål-kolumnen.

### 2026-10-24 – Steg 41: självregistrering på tävlingsdagen
- "Tillåt självregistrering på tävlingsdagen" (`race.self_registration`, migration 0018, av som standard): sparas via Inställningarnas anrop med auditpost; i fest-arbetsytan och under Inställningar (inte stafett).
- "Registrera din pinne" på `/fest/{kod}` och `/t/{kod}` utan inloggning (`/api/public/races/{id}/self-registration`, publika grinden + tjänstens egen kontroll: på, publicerad, tävlingsdagen i tävlingens tidszon; en fest även natten efter till kl 06). Exakt Origin, 4 KiB-body, spärr 20 per 10 min per IP (hashad) och 300 per dygn per tävling, dolt fält som fälla, normaliserade namn (60/80 tecken), auditpost med källa PUBLIC_SELF_REGISTRATION utan IP.
- Upptagen bricka (aktiv koppling eller festgäst med namn) avvisas, inget skrivs över. Fest: gästen namnges (även en okänd avläsning), bardisken känner igen brickan vid nästa hämtning (5 s). Andra typer: ny deltagare i vald klass med brickan; en okänd avläsning bedöms direkt (UNKNOWN_READOUT_RESOLUTION).
- "Självregistrerad" i deltagarlistan och gästlistan; festen har "Koppla bort pinnen" (admin, auditpost). Deltagare ändras och stryks som vanligt.
- Fest: visningsnamn (smeknamn, högst 40 tecken, förval förnamn + efternamnets första bokstav) i formuläret, bardiskens namnruta och arbetsytan; den publika sidan, det publika API:et och kiosken visar bara visningsnamnet. Arbetsytan och CSV har fullt namn och visningsnamn i egna kolumner.
- Tester: domän `party` (visningsnamn), integration `steg-41-sjalvregistrering` (6), `steg-40-fest` (visningsnamn publikt), Playwright `sjalvregistrering`. Verifierat: lint, typecheck, test, test:integration, build, Playwright `sjalvregistrering`, `fest`, `publikt`. Skärmbilder granskade på 390 och 1280 px.
- Utseendet "Centrum OK 20 år" (förinställningens röda som huvudfärg, `partyLook`): rubriker och stora siffror i Poppins Bold (`@fontsource/poppins` 5.2.7, SIL OFL, självhostad, bara 700 latin/latin-ext), centrumröd #AE1917 i rubrikband och kortens rubrikrader, grönt #62C83A bara i staplar och dekor, mörkgrön #2E7D18 för grön text, #F2F2F2 med vita kort, röd topplist på kioskens bekräftelse. Kontrast mätt (vit på rött 7,1:1, rött på vitt 7,1:1, mörkgrönt 5,2:1/4,6:1). Andra fester och tävlingssidor oförändrade. Playwright `fest` kontrollerar Poppins.
- Risk: spärren per IP slår till om många gäster delar lokalens wifi (20 per 10 min). Löpardatabasens förslag i bardiskens namnruta visar fortfarande fulla namn när man söker.

### 2026-10-24 – Steg 40: fest-läge med bardisk (Centrum OK 20 år)
- Tävlingstypen "Fest" (PARTY, migration 0016): delarna Fest, Publicera och Inställningar. Varor = kontrollenheter med kod, namn och pris (öre, prishistorik så att gamla köp behåller priset). Köpen räknas fram ur avläsningarnas stämplingar (`domain/party.ts`): varukod efter festens start, samma stämpling som läses ut igen ger ett köp, samma kod igen är ett nytt köp men inom "Dubbelstämpling inom (sekunder)" (förval 5) ett. Startstämpling checkar in, målstämpling checkar ut; bardiskens in-/utcheckning är egna rader (idempotenta på enhet + löpnummer). Ångra köp är en ny rad med orsak och auditpost. Gäst = egen tabell bricka → namn per fest (ingen entry: festen har inga klasser eller banor och ingen bedömning).
- Bardisken = avläsningssidan för en fest (samma station, Web Serial/WebUSB, automatisk anslutning, ljud, avläsningskö): ett fönster i automatiskt läge (första utläsningen "Välkommen", sedan nya köp och kvällens summa, "Inga nya köp" med neutral ton, mål = "Utcheckad"). Okänd bricka: namnruta med förslag ur löpardatabasen och kvällens gäster; exakt brickträff sparas direkt ("Inte du? Ändra"). In-/utcheckning och namn köas i IndexedDB (`otid-party`). "Personal" (bekräftelse, 30 s) har Checka in, Köp/verifiera och Checka ut, stationsknappar och länkar. Hela skärmen.
- Arbetsytan: start, dubbelstämpling, namn publikt, utseende (förinställning Centrum OK 20 år, logga PNG/JPEG ≤ 1 MB), varor, köp med summa per person, in-/utcheckade, varning för nästan full SI5/SI8/SI9, ångra (admin), CSV (UTF-8 med BOM, semikolon). Funktionären köper, sätter namn och checkar ut men ändrar inte varor och ångrar inte.
- Publik sida `/fest/{kod}` (från `/t/{kod}`): siffror, vad som säljer bäst, köp per kvart, senaste köpen, rolig statistik; namn bara via JavaScript, belopp och bricka aldrig. X-Robots-Tag (next.config), robots-meta och robots.txt bara för `/fest/` och `/api/public/parties/`.
- Förinställningen "Centrum OK 20 år" (rubrik Jubileumsbaren, röd/grön, prislistan 31–38 läggs till efter bekräftelse om koden saknas), grupp per vara (migration 0017, "Drinkar totalt") och "Skyltar till enheterna" (etiketter 45 × 30/60 × 35/90 × 45 mm, A4, 100 % skala).
- Tester: domän `party` (14), webb `party` och `help-sv`, integration `steg-40-fest` (5), Playwright `fest`. Verifierat: lint, typecheck, test, test:integration (323), build, Playwright `fest`, `traningskvall`, `tavlingstyper`, `avlasaren`, `hjalp`. Skärmbilder granskade på 390 och 1280 px.
- Risk: provat bara med övningsstationen, inte med riktig station och SIAC på plattan. Gamla stämplingar på oröjda brickor kan fylla SI5/SI8 (30) – ha en töm-enhet vid ingången.

### 2026-10-21 – Steg 38: avsluta tävlingen
- Rotorsak H12: fastställandet frös bara beslut i en fast lista; manuell tid, godkända kontroller och rättad tid (revision utan avläsning) föll igenom till "kan inte kontrolleras" (`INVALID_RESULT_REVISION`). Med omläsning (steg 36) ligger ett sådant beslut kvar ovanpå. Nu fryses alla beslut (`frozenManualDecisionCauseSchema`).
- Hinder per löpare: "Resultaten är klara" listar vem (t.ex. "H21: Dan Borta har inget resultat …") med "Öppna" till deltagarkortet.
- "Bekräfta felstämplad" (valfri orsak) och "Ta bort bekräftelsen": beslut som revision (MANUAL_MISPUNCH_CONFIRMATION, migration 0015) med auditpost, ligger kvar över ny avläsning och omräkning. Bekräftade (och manuell tid som felstämplad) räknas inte som att titta på; obekräftade stoppar inte, "N felstämplade är inte bekräftade" visas som information.
- Brutit, disk, utom tävlan och deltog utan tid behåller avläsningens start och sträcktider fram till sista stämplade kontrollen (utan mål räknas de om ur avläsningen), utan tid och placering: publikt, sträcktidsanalys, deltagarkort och IOF (DidNotFinish/NotCompeting med SplitTime).
- Tester: domän `manual-decision`, kontrakt, `iof-xml`, integration `steg-38-avslut` (H12, hinder, bekräftelse, sträcktider, hel klubbtävling med IOF mot XSD via xmllint när IOF_XSD är satt), Playwright `avslut`. Verifierat: lint, typecheck, test, test:integration, build, Playwright `avslut`, `listor`, `statusval`, `manuellt`, `omlasning`.
- Risk: 0015 har `when` 1798819200000; steg 37:s 0013 måste få högre `when` om den slås ihop efter att 0015 körts (se steg 36).

### 2026-10-21 – Steg 37: Om O-Tid, kontakt och hjälp
- `/om` (utan inloggning): vad O-Tid är, beta och gratis, hur det är gjort (Joel Berring med AI-stöd, Next.js/TypeScript, PostgreSQL, egen server), elva tekniska funktioner kontrollerade mot koden (bricktyperna med förbehåll: inte alla provade i skarpt läge), kontakt och skapa konto.
- Sidfoten "O-Tid · beta · Frågor: otid@berring.se · Om O-Tid · Personuppgifter" på publika sidor (layouten) och längst ned i arbetsytan (länkar i ny flik), dold vid utskrift; avläsningssidan har ingen. Adressen bara i `lib/contact.ts`; `OTID_CONTACT_EMAIL` har den som förval (/integritet visar alltid en adress).
- "Hjälp" i arbetsytans toppbalk (även på 390 px), på Mina tävlingar och på avläsningssidan: modal `<dialog>` vid högra kanten med sökfält, stegets artiklar först, sedan resten; Esc (även med text i fältet) och Stäng stänger, fokus tillbaka till knappen. 15 artiklar i `i18n/help-sv.ts` med vyer.
- Tester: `help-sv` (varje citerad knapp/väg finns som UI-text, 3–8 meningar, varje vy har artiklar), `help-search` (å/ä/ö, versaler, alla ord, vyn först), Playwright `hjalp`. Verifierat: lint, typecheck, test, build, Playwright `hjalp`, `arbetsyta`, `publikt`, `avlasaren`, `traningskvall`, `funktionarer`. Skärmbilder granskade på 390 och 1280 px.
- Risk: hjälptexterna måste hållas i takt med UI; testet fångar ändrade knappnamn men inte ändrat beteende.

### 2026-10-21 – Steg 39: lokalt stoppade avläsningar avkodas på nytt
- Natt-KM: SIAC-avläsningarna med skräpstämplingar (kod 0 ur block 1) stoppades i webbläsaren (LOCAL_INVALID) och kom aldrig till servern, så "Läs om från rådata" hade inget att läsa om. `requeueLocallyInvalid` avkodar nu sådana avläsningar på nytt från råramarna (`decodeRecordedFrames`, samma tidsreferens som vid avläsningen och tävlingens tidszon) och lägger dem i kön med samma löpnummer. Går ramarna inte ihop ligger avläsningen kvar; inga stämplingar hittas på.
- Tester: `readout/requeue` (3, med kvällens riktiga block, bricknumret utbytt). Verifierat: lint, typecheck, webbtester.

### 2026-10-20 – Steg 36: läs om avläsningar från rådata
- Avläsning → "Läs om avläsningar från rådata" (bara admin): varje deltagares avläsning (den resultatet bygger på) avkodas på nytt från originalets råramar (`sportident` `decodeRecordedFrames`) med stationens klocka/offset ur nyttolasten och tävlingens tidszon. Övningsstationen och simulatorn läses inte om; ej start hoppas över. Listan visar bara ändrade (bricka, deltagare, stämplingar/status/tid före → efter) och "går inte att läsa om" (fel CRC, saknade block); "Spara och räkna om" för valda, konflikt om något ändrats.
- Lagring: nytt råmeddelande (`transport` `sportident-reread`, enheten = originalets råmeddelande, nyttolasten pekar på originalet och avläsningen den ersätter), ny `card_readout` (lästid + 1 ms så att den blir brickans senaste) och revision med orsaken READOUT_REREAD (migration 0014) för samma deltagare (`evaluateReadoutForEntry`); auditpost per omläsning. Original och råmeddelanden ändras aldrig.
- Manuella beslut ligger kvar ovanpå och visas i förhandsbeskedet med hur de tas bort. Deltagarkortet: "Avläsningen kan läsas om från rådata" + "Läs om".
- Tester: `sportident` `recorded` (5), integration `steg-36-omlasning` (natt-KM 14 stämplingar, OK 53:23; rätt avläst och övning listas inte; trasiga ramar; manuellt beslut; behörighet; idempotens), Playwright `omlasning`.
- Risk: migratorn hoppar över en migration med lägre `when` än den senast körda; slås steg 35:s 0013 ihop efter att 0014 körts måste 0013 få ett högre `when` (testdatabaserna här saknade 0009 av just det skälet och skapades om).

### 2026-10-20 – Steg 36 (brådskande): nio ramar från station som skickar alla åtta block
- Efter steg 34 gav en BSM8 som skickar alla åtta block detektering + 8 block = 9 råramar, men avläsningens schema tillät högst 8: avläsningen markerades "rejected" (`LOCAL_INVALID`) i webbläsaren och skickades aldrig. Schemat tillåter nu 12 (detektering, åtta block, uttagsram, marginal); samma schema används vid mottagningen.
- Avläsningssidan prövar vid laddning om lokalt avvisade avläsningar mot det nuvarande schemat; giltiga läggs tillbaka i kön som väntande med samma löpnummer (servern har aldrig sett det) och skickas som vanligt.
- Tester: `readout/requeue` (omprövning, samma löpnummer, skickas), integration `steg-36-nio-ramar` (9 och 12 ramar tas emot oförändrade, 13 avvisas).

### 2026-10-20 – Steg 35 (del 3, steg 35 klart): ljud vid avläsning
- Avläsningssidan: tre korta toner i C-dur uppåt (0,3 s) vid Godkänd och tre i a-moll nedåt vid felstämplat, maxtid, okänd bricka och fel i avläsningen (Web Audio, OscillatorNode, ingen ljudfil). Ett ljud per besked; övningsstationen låter också.
- AudioContext skapas/återupptas vid första klicket (anslutknapparna eller var som helst på sidan); efter en automatisk anslutning utan klick visas "Ljudet hörs när du har klickat någonstans på sidan."
- Kryssrutan "Ljud vid avläsning" (på som standard, sparas i localStorage med try/catch).
- Tester: `sound` (dur/moll, längd, val, lagring), Playwright `avlasaren` (tonerna fångas vid övningsstationens avläsningar, avslaget ljud ger inga toner, valet står kvar efter omladdning). Verifierat för hela steget: lint, typecheck, test, test:integration, build, Playwright `statusval`, `avlasaren`, `traningskvall`, `manuellt`, `listor`, `live`, `lanad-bricka`, `lopardatabas`. Ljudet på riktig läsplatta provas av ägaren.

### 2026-10-20 – Steg 35 (del 2): avläsaren ansluter själv
- Avläsningssidan sparar en lyckad anslutning (Web Serial eller WebUSB, tillverkare/produkt/serienummer, localStorage) och ansluter själv när sidan öppnas (när tävlingsdatan är inläst) och vid `connect` (stationen sätts i), till en redan godkänd enhet (`getPorts`/`getDevices`, CP210x). Flera godkända: den senast använda, annars får funktionären välja. "Ansluter automatiskt till stationen …" och "Sluta ansluta automatiskt"; manuell frånkoppling pausar till nästa gång sidan öppnas. Befintliga `connectPort`/`BAUD_RATES` återanvänds.
- Tips om en egen flik; länkarna Hantera tävling och Resultat öppnas i en ny flik.
- Tester: `station-memory` (val av enhet, lagring, blockerad lagring), Playwright `avlasaren` (tomma listor, utan Web Serial/WebUSB). Måste provas av ägaren med riktig station på dator och läsplatta.

### 2026-10-20 – Steg 35 (del 1): fler statusval
- Deltagarkortets "Ändra status" (det enda stället där en löpares status sätts; kontrollvyn, deltagarlistan och kvar i skogen öppnar kortet, avläsningssidan och starten sätter ingen status utom ej start) har nu Ej start, Brutit, Diskvalificera, Utom tävlan och Deltog utan tid även utan avläsning. "Öppna" i kontrollvyns Kvar i skogen.
- Domänen: disk och utom tävlan utan avläsning ger ett utfall utan tid; "Deltog utan tid" (NT, tidigare "utan tidtagning") går med och utan avläsning och har aldrig tid. Ingen migration behövdes (orsakerna och databasens villkor fanns).
- NT visas "Deltog" sist i klassen (efter ej start), exporteras och fastställs som IOF NotCompeting utan tid (Finished betyder "inte kontrollerad"). Ett gällande beslut utan avläsning räknas som i mål i kvar i skogen.
- Tester: domän `manual-decision`, integration `steg-35-fler-status` (+ ändrade `entry-status-overlays`, `entry-status-did-not-start`), Playwright `statusval`. Verifierat: lint, typecheck, test, test:integration, build, Playwright `statusval`, `traningskvall`, `manuellt`, `listor`, `live`.

### 2026-10-20 – Steg 34: SIAC från station som skickar alla åtta block (fel på natt-KM)
- Natt-KM: två SIAC blev felstämplade med "gamla stämplingar" fast brickan var tömd. Råloggen från en av brickorna (avläst i efterhand) visade att BSM8:an skickade block 0–7 för "alla block"; O-Tid tog de fem första som 0, 4, 5, 6, 7 och läste block 1 (brickans inställningar) som stämplingar.
- `sportident`: blocken placeras efter blocknumret i svaret (`cardImageBlocks`), läsningen av "alla block" (SI6, SI10/11/SIAC) slutar vid block 7 eller åtta svar, och tas brickan ur efter stämplingsblocken räcker det som kom. `decodeCard` vägrar en ofullständig bild i stället för att tyst ta färre stämplingar. Falska stationen kan skicka alla åtta block (`eightBlocks`).
- Tester: `siac-eight-blocks` (7, med kvällens riktiga block, bricknumret utbytt), `decode`. Verifierat: lint, typecheck, test, build, Playwright `traningskvall`, `lanad-bricka`.
- Kvällens två avläsningar: läs om brickan (otömd) efter uppdateringen, eller ange tiden manuellt.

### 2026-10-20 – Steg 33 (tillägg): uppdatera startlistan löpande
- Start → Publicera startlistan: "Uppdatera startlistan löpande" (av som standard, migration 0012, sparas via Inställningarnas anrop med auditpost). På: `getPublicStartList` ger samma projektion som en publicering men läst nu (`live: true`, samma strikta kontrakt och grind, bricka bara när den visas, ingen IOF-länk); sidan hämtar om var femte sekund. Statusraden säger "Uppdateras löpande", Publicera/Avpublicera döljs.
- Av igen: besökare ser den senast publicerade listan (ingen ny ögonblicksbild skapas); statusraden visar då "har ändrats sedan dess" och Publicera.
- Typer utan Start-steg (Träning, Rogaining) har ingen publicerad startlista och därmed inget val.
- Tester: integration `steg-33-tavlingsinfo` (ny anmäld syns bara när valet är på), Playwright `tavlingsinfo`.

### 2026-10-20 – Steg 33: tävlingsinfo och bricka i startlistan
- Inställningar → "Information till löparna": "Kort info om tävlingen" (ren text, högst 1000 tecken, radbrytningar behålls), "Första start" (TT:MM, bara information: påverkar inte tävlingsklocka, lottning eller starttider) och "Visa bricknummer i den publika startlistan" (på som standard). Migration 0011 (kolumner på `race`, på även för befintliga tävlingar), auditpost i `RACE_SETTINGS_SAVED_BY_ADMIN`.
- Infon visas överst på tävlingssidan (/t/{kod}) och i arbetsytans Start-steg (Avläsning för typer utan Start), för admin och funktionärer. Tomma fält visas inte.
- Den publicerade startlistan har aktiv bricka i ögonblicksbilden; `getPublicStartList` tar bort den när inställningen är av (gäller direkt, även redan publicerad lista). En ändrad bricka syns efter ny publicering. Live, resultat, speaker och IOF-exporten är oförändrade.
- Tester: kontrakt `start-list-publication`, web `lists`/`public-start-list-route`, integration `steg-33-tavlingsinfo` (+ `steg-28` lägger till kolumnerna för den gamla databasen), Playwright `tavlingsinfo`, `listor` (publika listan visar nu bricka).

### 2026-10-20 – Steg 32: avläsning på läsplatta (Android) via WebUSB
- Chrome på Android ser inte stationens CP210x-chip som serieport ("Inga kompatibla enheter hittades"). `device-transport/src/webusb-cp210x-port.ts`: CP210x över WebUSB med samma styrkommandon som Linux `cp210x.c` (IFC_ENABLE, SET_BAUDRATE, SET_LINE_CTL 8N1, SET_MHS DTR/RTS, PURGE), samma gränssnitt som en Web Serial-port, så att `WebSerialTransport` och avläsningen är oförändrade.
- Avläsningssidan: "Anslut via USB (läsplatta)" på Android (eller utan Web Serial); en annan app som håller stationen ger ett tydligt besked. `usb=(self)` i avläsningens Permissions-Policy.
- Tester: `webusb-cp210x-port` (4). Verifierat: lint, typecheck, test, build, Playwright `traningskvall`. Måste provas av ägaren på riktig platta med riktig station (iPhone/iPad går inte: ingen WebUSB i iOS).

### 2026-10-20 – Steg 31 del A: rättningar för hela tävlingen (del A klar)
- A1: Avläsning → Rättningar för hela tävlingen → "Justera tid för en station" (Start, Mål eller Kontroll med kod, Tidigare/Senare, minuter och sekunder, Varför) → "Visa vad som händer" → "Spara och räkna om". Migration 0009 (`race_station_correction`, bara borttagning får skrivas), domänens `prepareReadoutForEvaluation` är enda stället där justeringen läggs på brickans tider, paketet till avläsningen har justeringarna, underlagshashen tar med aktiva rättningar (oförändrad utan). Manuellt rättad tid räknas inte om (antal i beskedet). "Ta bort" räknar om tillbaka; borttagna står kvar som historik.
- A2: "Kontroll ur funktion" (kod, Varför): koden krävs inte på någon bana, även gafflade; stämplingen ger ingen sträcktid och sträckan räknas från kontrollen före; deltagarkortets sträcktider visar "Ur funktion", IOF-exporten utelämnar kontrollen. Ersätter den gamla strykningen per klass (`class-control-neutralization.ts`, utan gränssnitt): kod, tabell och `result_revision.control_neutralization_id` borttagna i 0009 (underlagshashen oförändrad). Banredigeringen fungerar som förut.
- A3: Start → Startlistan → "Flytta starttider" (Klass, Senare/Tidigare, Minuter, Varför): alla tilldelade tider i en klass med minutstart (även gemensam start; inte stafett) flyttas och de avlästa räknas om; beskedet påminner om att publicera startlistan igen. Ångra = flytta tillbaka. Lottningens vakanta tider (oföränderliga) flyttas inte.
- A4 (motor 0.5.0): oröjd bricka – stämplingar > 12 h före avläsningen och kontrollstämplingar > 10 min före clear/check räknas inte (bara den inledande följden i brickans minne; check efter startstämplingen används inte; start/mål bara 12 h-regeln). `card_readout` får `check_punched_at`/`clear_punched_at` (ifyllda från rådatan). Avläsningens besked och deltagarkortet: "N gamla stämplingar räknades inte (brickan var inte tömd)", även vid godkänt; stämplingslistan märker dem "före check, räknas inte".
- A5: Resultat → Efterarbete → "Räkna om hela tävlingen" → "Visa vad som händer" (antal, statusbyten) → "Spara och räkna om".
- Tester: domän `station-corrections` (11), `evaluate-card-readout`/`course-variants`/`course-edit` (ur funktion), integration `steg-31-tavlingsdag`, `adr-0169-result-basis`, Playwright `tavlingsdag-rattningar`, `redigera-bana`, `traningskvall`.

### 2026-10-20 – Steg 31 B4: samma bricka hos två löpare
- `application/src/card-reuse.ts`: har brickans deltagare redan ett resultat från en annan avläsning av brickan och brickan använts i ett nytt lopp efter den avläsningens mål (start- eller kontrollstämpling senare), sparas ingen revision; avläsningen blir okänd. Exakt dubblett och samma lopp med ändrad tid fungerar som förut.
- Kontrollvyn → Okända brickor: "Brickan har redan lästs ut för X … lånad bricka?"; koppla till annan anmäld eller direktanmäl (brickan flyttas, X:s resultat står kvar) eller välj X ("samma löpare", den nya avläsningen gäller). Avläsningssidan: samma varning (säker vid en tidigare annorlunda avläsning här eller när servern svarat okänd, annars "Servern kontrollerar"), anmälan/koppling med `borrowedCard`, och "Det är samma löpare – använd den nya avläsningen". Utan valet skrivs den förstes resultat aldrig över.
- Omräkning (deltagare, klass, banändring, klassbyte) utgår från deltagarens egen avläsning och bedömer den för just deltagaren (`evaluateReadoutForEntry`), utom när deltagaren fått en annan bricka sedan dess.
- Tester: integration `steg-31-lanad-bricka` (4) och banändring i `adr-0169-course-edit`, avläsning `already-read-out` (2), Playwright `lanad-bricka`.

### 2026-10-20 – Steg 31 B5: avläsningens robusthet
- Avläsningssidan: tid som inte går att placera med stationens klocka prövas med datorns; går det inte heller sparas bricka, tid och råramar i webbläsaren och visas under "Brickor som inte kunde tolkas". En avläsning som ger serverfel (5xx) skickas om en och en och hålls sedan åt sidan ("N avläsningar kunde inte skickas" + "Försök igen") så att resten av kön går fram. Övningsstationen varnar på tävlingsdagen. Deltagarkortet: "Räkna om från avläsningen" även utan resultat.
- Tester: `readout.test` (kön vid serverfel), `participant-status-choices`, Playwright `manuellt` (varningen) och `traningskvall`.

### 2026-10-20 – Steg 31 B: nödlägen för en löpare (B1–B3)
- Domänen (`manual-decision.ts`, ny `manual-time.ts`, `entry-readout.ts`): beslut ligger på varandra som en stapel och följer med över senare avläsningar och omräkningar, även rättad mål- och starttid (förut ersattes de). Nya orsaker `MANUAL_TIME`, `MANUAL_CONTROL_APPROVAL`, deras återtaganden och `MANUAL_RESULT_REMOVED` (manuellt resultat utan avläsning borttaget), migration 0010. Nya beslut bygger på senaste tekniska bedömningen under besluten (inga återvändsgränder efter ett återtagande). Resultatmotorn är oförändrad.
- Deltagarkortet: "Ange tid manuellt" (måltid/starttid/löptid som klockslag, status, orsak, förhandsbesked "Löptid 45:00, godkänd."), "Godkänn saknade kontroller", "Ta bort manuell tid"/"Ta bort godkända kontroller", orsaken visas i kortet, "Manuell tid" i deltagarlistan. Brutit och ej start går utan avläsning; "Godkänn manuellt" kräver orsak.
- Tester: domän `manual-time` (10), integration `steg-31-manuellt` (3) och uppdaterade förväntningar (återvändsgränder borta), Playwright `manuellt`.

### 2026-10-20 – Steg 30: Live för publiken (steg 30 klart)
- `/t/{kod}/live` (länk från tävlingssidan och resultatlistans rubrik), `GET /api/public/races/{id}/live` bakom samma grind (`publicRaceAccess`, opublicerad/dold ger 404). `application/src/public-live.ts`: ren `projectPublicLive` över den publika resultatlistan, radiotiderna och när resultatet kom in (första avläsningen); kontraktet `public-live.ts` är strikt utan bricka, interna id:n, orsaker och strukna.
- Sidan: Senast i mål (namn, klubb, klass, tid, "1:a"; felstämplad som "✗ Felstämplad" utan placering), Ledare per klass med "▲ Ny ledare" i 5 min, radiopassager ("passerade Radio 1 6:12, 2:a"), "Uppdaterad 21:03:12" och lugnt besked utan nät, tomläge "Inga målgångar än – sidan uppdateras av sig själv". Uppdateras med resultatströmmen + hämtning var 5:e s (gemensam `usePublicRaceData`).
- Följ: ☆/★ vid löpare i Live och resultatlistan, klubb i "Per klubb" och "Följ en klubb" i Live; "Följer" överst. Bara `localStorage` (`lib/follow-store.ts`); fungerar inte lagringen gäller valet i minnet och en varning loggas.
- Tester: enhet `public-live-projection` (7), `follow-store` (3), `public-live-view` (3), `public-live` (2), listorna (stjärnor); integration `steg-30-live` (2); Playwright `live` (ny), `publikt` (Live bakom grinden).
- Verifierat: install (frozen), lint, typecheck, test, test:integration (70/290), build, Playwright `live`+`publikt`, `radio`+`traningskvall`, `listor` gröna (`live` föll en gång när radiodelen lästes in på nytt efter ifyllnad; testet fyller nu i tills formuläret håller värdena). Skärmbilder 1280/390 granskade (Följer smalare på bred skärm, klassetiketten i linje med ledaren).

### 2026-10-20 – Steg 29: löpardatabas från Eventor (steg 29 klart)
- Löpardatabas per Eventor-klubb (migration 0008, `runner_database*`), hämtad med tävlingens sparade nyckel (`cachedcompetitors` med klubbens och tillagda klubbars id, eller hela Sverige; `/api/organisations`) och ersatt i en transaktion; Inställningar → Eventor → Löpardatabasen: uppdatera, fler klubbar, "Ta med hela Sverige (stor hämtning)", radera. Bara admin uppdaterar/raderar; admin och funktionär får förslag; inget publikt (`/integritet`, `docs/security-privacy.md`). Dataminimering: födelseår, kön, klubb, bara SI-brickor; auditposten bara antal.
- Adapter: strömmande, härdad läsning element för element (`eventor/src/stream.ts`; gränser 32 MB klubbar, 256 MB hela landet, 5 min), IOF 3.0 CompetitorList och Eventors äldre OrganisationList (typ 1/2/3 = förbund/distrikt/klubb är vår tolkning; alla typer behålls).
- Avläsningspaketet: `runnerLookup` (egna och tillagda klubbars löpare, högst 10 000, egen klubb först, och klubbarna) och `readOutEntryIds`; hela landet söks på servern när nätet finns. Mätt: 10 000 löpare = 1,53 MB JSON; 40 000 löpare hämtas och sparas på 9 s.
- Okänd bricka (även offline): namn och klubb fylls i ur databasen, domänens `rankClassesByCourseFit` (gafflingarnas bästa-passning) förväljer klassen ("Passar H21 (Lång) …"), anmälda utan bricka eller utan avläsning i de klasserna föreslås överst ("Koppla brickan till Anna Ek"); kopplingen köas som direktanmälan (`target: "EXISTING_ENTRY"`, utfall `LINKED`, idempotent). Namnfält föreslår löpare och klubbfält klubbar, även i Ny deltagare; Eventors person- och klubb-id sparas på deltagaren för IOF-exporten. Övningsstationen kan läsa en bricka ur löpardatabasen.
- Tester: adapter `competitors` (10), domän `class-course-fit` (5), avläsning `runner-lookup` (4), integration `steg-29-lopardatabas` (6), route-behörighet, Playwright `lopardatabas`; falska Eventor svarar på de nya adresserna.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (69/288; `steg-28` läser nu migrationerna ur journalen), build, Playwright alla 20 specar gröna i sex grupper (ny `lopardatabas`; `tavlingsfunktioner` förväljer nu klassen); efter omförsök under last: `funktionarer`/`tavlingstyper` (speakern som tidigare), `traningskvall`, `gafflingar`; `radio`+`redigera-bana` omkörda efter att utvecklingsservern dödats (minnesbrist). Skärmbilder 1280/390 granskade (för bred förslagsknapp på 390 px rättad). Måste provas av ägaren mot riktiga Eventor: hela landets `cachedcompetitors` (storlek, tid) och `/api/organisations` (format och `OrganisationTypeId`).

### 2026-10-20 – Steg 28: vanlig PostgreSQL i stället för PostGIS (steg 28 klart)
- `postgres:17` (alla arkitekturer) i stället för `postgis/postgis:17-3.5` + `platform: linux/amd64` i dev-compose, drift-compose (db och backup) och CI. Samma PG 17 och PGDATA `/var/lib/postgresql/data`: befintlig volym används som den är. Efter `git pull`: säkerhetskopia, `docker compose up -d postgres` byter bild, datan finns kvar, `pnpm db:migrate` (README).
- `CREATE EXTENSION postgis` borttagen ur baslinjen (migratorn jämför `created_at`, inte innehåll, så körda databaser påverkas inte). 0007: `DROP EXTENSION IF EXISTS postgis` (utan CASCADE; inget använder PostGIS) och, bara vid glibc-byte (bullseye → trixie), REINDEX av tabellerna + `REFRESH COLLATION VERSION`.
- Provat på en kopia av en databas från main (PostGIS, 6 lopp/21 anmälda, sorteringsversion 2.31) med PostGIS-filerna borttagna från servern som i `postgres:17`: 0007 körs, data identisk (md5), inga varningar. Integration `steg-28-utan-postgis` (ny databas utan tillägg; uppgradering utan förlust).
- Playwright: `radio`, `listor`, `strackanalys`, `tavlingsfunktioner` kör tävlingen i `ongoingRaceTimeZone()` (Stockholm, men New York 23–02 i Stockholm) i stället för att falla efter midnatt; ingen klocka fryses, fungerar mot driften i CI. `docs/drift.md`: serveralternativ (Hetzner CX23/CAX11, Oracle Always Free, e2-micro, Cloudflare Tunnel) och DNS-exempel.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (68/282, utan PostGIS på servern), build, `docker compose config` (dev, prod), Playwright `radio`, `listor`, `strackanalys`, `tavlingsfunktioner` gröna både med tvingad New York-tid och i Stockholm, `traningskvall` grön (`tavlingsfunktioner` fick inget svar från klassändringens rutt vid kall utvecklingsserver: rutten värms nu i förväg, grön kall). Inte provat: riktig Docker-bild och ARM-server (ingen Docker här); CI-jobbet `production` är grinden.

### 2026-10-19 – Steg 27: rättelser efter första piloten (steg 27 klart)
- Brickans stämplingar: domänens `cardPunchList` (ordning, kod, tid, på banan/extra/utanför tävlingsdagen, check/start/mål, "från ons 14 okt", "ingen startstämpling") i deltagarkortet och kompakt i avläsningens besked för felstämplad/okänd bricka; aldrig publikt. "Inte avläst ännu" i stället för "publicerat resultat". "Ny klass" listar alla banor och läser in dem själv.
- Ta bort/stryk (migration 0006 `entry.struck_at`): utan resultatrevision tas deltagaren bort med `purgeRows` (lottad tid blir vakant); med revision stryks den – dold i alla listor, paketet, lottning, speaker, kvar i skogen, IOF och fastställande, bricka släppt, historik kvar. Ta bort klass/bana när inget hänger på dem, annars besked. Eventors "struken" ger fortfarande ej start.
- "Resultaten är klara" (0006 `race.official_result_finalization_id`): en knapp fastställer klasserna och loppet i en transaktion, listorna blir "Officiella resultat", IOF-filen laddas ner, "Gör resultaten preliminära igen" ångrar; klassvis under Avancerat. Rättat: OK med kontroll stämplad före start gick inte att frysa (500), saknat resultat gav också "ogiltigt resultat".
- "Exportera tävlingen" (Inställningar): JSON `otid-race-export` v1 med allt (`docs/export.md`). Mina tävlingar: idag/kommande först, sedan gångna. Varning vid gamla Eventor-namn, "(se drift-instruktionen)", tom tävlingslista i klartext, radiopollern väntar 20/40/60 s vid databasfel, Mac-drivrutin och stödmatris (SI9 `field-verified` för nummer/antal/tider) i `docs/sportident.md` och README.
- Tester: domän `card-punch-list` (5), webb (texter, ordning, Eventor-miljö, pollervänta), integration `steg-27-rattelser` (6; `steg-25-competition` använder nya knappen), Playwright `traningskvall` (stämplingar, ta bort/stryk, klass, bana), `listor` (Resultaten är klara/ångra, publikt Officiella), `kopiera` (Mina tävlingar).
- Verifierat: install (frozen), lint, typecheck, test, test:integration (67/280), build, Playwright alla 19 specar gröna i grupper; `radio`, `listor`, `strackanalys` och `tavlingsfunktioner` föll strax efter midnatt (tider "för 30–45 min sedan" hamnade på gårdagen) och gick igenom efter 01:00 (de två sista efter omförsök), `tavlingstyper` efter omförsök. Skärmbilder 1280/390 granskade; klubbvyns kolumner smalare på 390 px.
- Kvar: import av exportfilen (Idéer); ett lopp i ett arrangemang med flera lopp kan fortfarande inte bli "klart" (`MULTI_RACE_EVENT`); strykning går inte att ångra i ytan.

### 2026-10-19 – Steg 26: avancerad lottning (steg 26 klart)
- Lottning: enkla läget som förut; under "Avancerat" (öppnas själv när något avviker, sparas med lottningen i `race.start_draw_settings`) kryssa i alla/olottade klasser, startgrupp av de första 1–3 kontrollerna, max starter per minut totalt och per startfålla, sista start, startordning (upp/ned) och senare start per klass (klockslag eller minuter efter första start), seedning per löpare och ranking från CSV (bricka, annars namn och klubb).
- Domänen (`start-draw.ts`, `start-draw-order.ts`): befintliga tider rörs inte och nya läggs runt dem; gafflad klass hör till startgruppen om **någon** variant delar början (grupper slås ihop i kedja); fålla = samma första kontroll; vakanser räknas i taket, masstart som en start; senare start placeras först; seedade sist eller jämnt utspridda, bäst sist. Regelbrott blir varningar, aldrig fel.
- Förhandsvisningen: regelbrott med sista start som behövs, klasser som behåller sina tider, "Minut för minut" med nya tider märkta Ny, seedade märkta. Sparandet skriver tider, seedning och inställningar i en transaktion (befintlig väg med omräkning).
- Migration 0005 (`entry.seed_rank`, `race.start_draw_settings`). Lottningens anrop får större body (768 KiB; 4 KiB räckte bara till ~30 klasser).
- Tester: domän `start-draw-advanced` (16), integration `steg-26-lottning` (2), CSV-läsaren (3), kontrakt, Playwright `lottning-avancerad`.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (66/274), build, Playwright alla 19 specar gröna i fem grupper (ny `lottning-avancerad`); efter omförsök under last: `gafflingar`, `funktionarer`, `strackanalys` och `tavlingsfunktioner`. Skärmbilder 1280/390 granskade.
- Kvar: efteranmäld i lottad klass följer fortfarande första kontrollen (inte N kontroller eller taken). IOF-ranking (`Score`) inte gjord, bara CSV.

### 2026-10-19 – Steg 25: saknade tävlingsfunktioner (steg 25 klart)
- Minutstart: lottad tid gäller; startstämpling mer än 60 s (`START_PUNCH_TOLERANCE_MS`) från den ger varning i avläsningen, deltagarkortet och arbetsytans lista ("! Sen start"), aldrig publikt. Utan lottad tid används startstämplingen (notis). Motor 0.4.0.
- Direktanmälan av okänd bricka på avläsningssidan, även utan nät: egen kö i IndexedDB med egen idempotensnyckel (servern: `readout_registration`), beskedet bedöms om lokalt, anmälningar skickas före avläsningarna; servern kopplar okänd avläsning via bricknumret, "Brickan fanns redan anmäld som …" om någon hann före.
- Maxtid per klass (Klasser, kopieras): `OVERTIME/MAX_TIME_EXCEEDED` efter godkända, utan placering, IOF `OverTime`; inte rogaining. "Markera alla kvar i skogen som ej start" i Resultat: förhandsvisning, en bekräftelse, radio/avprickade listas som "Saknas i mål – kontrollera", idempotent.
- Banlängd/stigning från banfil och Banor ("Bana Lång · 4,2 km · 120 m"), kopieras. IOF-listor med Eventor-id för person/klubb, ControlCard (admin), Course och OverTime, validerade mot IOF 3.0 XSD. "Preliminära resultat"/"Officiella resultat (fastställda …)". Disk med valfri orsak (bara arrangören, publikt "Disk."). Hyrbricka: "HYRBRICKA – samla in" och "Lämna tillbaka hyrbrickan" på kvittot.
- Migration 0004 (maxtid, banlängd, Eventor-id, `result_revision.note`, `readout_registration`). Nya tester: domän (start/maxtid/kvar), integration `steg-25-*` (11), avläsningskön (8), Playwright `tavlingsfunktioner`.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (65/272), build, IOF-XML mot XSD, Playwright alla 18 specar gröna i fem grupper (ny `tavlingsfunktioner`; `gafflingar`/`listor` anpassade till Längd-kolumnen och tidig-start-varningen); efter omförsök under last: `funktionarer`, `radio`, `strackanalys`, `tavlingstyper` (speakern som tidigare) och `kopiera`.

### 2026-10-19 – Steg 24: enklare arbetsyta (steg 24 klart)
- Flöde: "Skapa tävling" går direkt till arbetsytan; tomlägen har en primärknapp (Ny bana, Ny deltagare, Lag). Ny deltagare i ett steg med Enter, raden "Anna Ek är anmäld i H21." och fokus tillbaka i Förnamn; minutstart utan tid före lottningen ("Lämna tomt – lottas senare", servern lottar in löparen). Tre deltagare: 13 → 6 klick.
- Låsning: bara en skrivning (`writingRef`) låser, och bara formuläret som sparas; läsningar avbryts av användaren, och läsningar som startar själva väntar på `operation.current`. Sidopanelen är aldrig inaktiv; "Slutför eller avbryt …" visas först vid försök att byta steg.
- Start: 1 Lottning, 2 Startlistan, 3 Publicera startlistan. Publicera bara i checklistan (länk från Inställningar). Avläsning läser in läget själv. "Flytta till kortare bana" och dess rutt/tjänst/kontrakt borttagna (tabellerna står kvar utan skrivare).
- Ord: startsätten bara i `i18n/start-rule-sv.ts`; jargong omskriven (avläsningssidan, import, Eventor, ROC-id, "Tävlingens namn" + "Etapp/lopp (valfritt)", tidszon under "Mer"); språkvakten förbjuder interna ord.
- Fältfel: `noValidate` och svenska fel per fält (`lib/form-validation.ts`, `Field error`), datum som ÅÅÅÅ-MM-DD (`DateInput`). Kompakt mobilhuvud med Meny, kompakta rader, numrerade steg, vanlig lottningstabell.
- Verifierat: install (frozen), lint, typecheck, test, test:integration (63/261), build, Playwright alla 17 specar gröna i fem grupper (ny `arbetsyta`); efter omförsök under last: `lottning`, `traningskvall`, `listor`, `strackanalys` och speakerns "Senast i mål" i `funktionarer`/`tavlingstyper` som tidigare. Fler uppvärmda rutter i e2e.

### 2026-10-19 – Steg 23 (del 2): ett statusflöde, en session, ingen versionsgrind (steg 23 klart)
- Ett skrivställe: `appendResultRevision`/`evaluateAndStore` (`result-revisions.ts`) skriver alla revisioner. Ett statusflöde: `setEntryStatus` (beslutsunion med återta, idempotent på begärans id, `expectedRevision`) + domänens `applyManualDecision` ersätter de tolv besluts-/återtagandetjänsterna; en rutt `…/entries/[entryId]/status` i stället för 24 (migration 0001).
- En session: `requireRaceRole` på kontosessionen; `pairing_admin_*`, delegationer, kakor per tävling och capability-enumen borta, journalerna har `actor_account_id` (0002). "Öppna med mitt konto" borta; avläsningsskalet och demot använder kontosessionen.
- Ingen `expectedSnapshotVersion` i adminåtgärder; `race.snapshot_version` är bara paketversion via `bumpReadoutPackageVersion` (0003). En `security-policy.ts`, ett suffix `AsAdmin` (kontonivån utan suffix: `createOrganizerEvent`, `listMyEvents`; `copyRaceAsAdmin`), UUID i `contracts/src/ids.ts` och SHA-256 i `serialization.ts`.
- TS-rader 108 759 → 81 771 (utan tester 69 497 → 52 932); tabeller 102 → 80; rutter 131 → 103; kontraktsfiler 73 → 59; applikationsfiler 106 → 93. Integration 74/300 → 64/264 (besluts-/sessionstesterna skrivna om mot `setEntryStatus`/`requireRaceRole`).
- Verifierat: install (frozen), lint, typecheck, test, test:integration, build, demo på tom databas (inloggningen öppnar arbetsytan direkt), Playwright alla 16 specar gröna i fem grupper (`funktionarer` efter omförsök, speakerns "Senast i mål" som i del 1; `traningskvall` efter omförsök i gruppen, tidsgräns under last, grönt direkt ensam). Ingen användarsynlig ändring; e2e: bara tävlingssessionssteget och uppvärmning av borttagna rutter.

### 2026-10-18 – Steg 23 (del 1): död kod, baslinjemigration, tester och dokument
- Borttaget: `packages/infrastructure` (MinIO), 16 applikationsmoduler och 14 kontrakt som inget anropade (PM-kedjan, avläsningshistoriken, manuella om-länkningar m.m.), Android-transporten, `apps/participant`, `apps/worker`, `packages/route-xml` (GPX nu i `iof-xml`), 14 cookie-filer, 1 319 av 1 436 nycklar i `i18n/sv.ts`, betalstatus, MinIO i compose och döda miljövariabler.
- TS-rader 123 711 → 108 776 (utan tester 78 340 → 69 497); tabeller 114 → 102; rutter 131 → 131; migrationer 106 (7 790 rader) → 1 baslinje (4 469), pg_dump identisk med gamla kedjan; befintliga databaser skapas om (`docs/drift.md`).
- Kvar med flit: `/imports` (EntryList/StartList-filer, Playwright använder sidan), hyrbricksflödena (knappar i deltagarkortet), enum-värdena för borttagna capabilities (försvinner med `pairing_admin_*` i del 2).
- Tester: `task-001` delad i 14 filer efter beteende, övriga `task-NNN` omdöpta; enhet 230 filer/1 492 → 205/1 269; integration 72/391 → 74/300 (borta = tester av borttagen kod). `docs/architecture.md`/`domain-rules.md` nyskrivna, gamla i `docs/archive/`.
- Verifierat: install (frozen), lint, typecheck, test, test:integration, build, pg_dump baslinje = gamla kedjan; Playwright 15 av 16 specar gröna (eventor, redigera-bana, tavlingstyper, traningskvall efter omförsök), `funktionarer` faller (speaker/kvar i skogen) men faller likadant på orörd HEAD i kväll. Kvar i steg 23: punkt 2–5 (statusflöde, versionsgrind, en session, ett skrivställe).

### 2026-10-18 – Steg 22: buggarna från granskningen (steg 22 klart)
- Resultatmotorn 0.3.0: en aligner (`alignControls`, ordnad delföljd, flest obligatoriska sedan strukna, tidigaste stämpling vid lika) för alla
  vägar, även gaffling och neutralisering. Extra-/dubbelstämplingar och återkommande kontroller (fjäril) ger godkänt; fel ordning = en saknad kontroll
  som finns på annan plats. Motorversionen ingår inte i underlagshashen (databasfunktionen känner inte TS-konstanten, ingen produktionsdata, varje
  revision bär `engine_version`, omräkning finns); gamla resultat flaggas alltså inte. `docs/domain-rules.md` regel 6–7 uppdaterade.
- Tid: handskakningen frågar stationens klocka (`GET_TIME`), offset mot datorn blir referens (datorn som reserv), tolerans 2 h, `SiTimeError` i stället
  för gissad tid, varning i avläsningsvyn vid >5 min skillnad, `clockSource`/`clockOffsetMs` i nyttolasten och på `card_readout` (migration 0104).
- Övningsstationen: tider relativt fast starttid och tävlingsdagen, stationens klocka ställs efter brickan, ny bricka tar ur den gamla först,
  bricka som sitter i före handskakningen läses (sessionen sparar detekteringsramen). Falska stationen svarar på `GET_TIME`.
- Dubbla klass-/bannamn: `duplicate-name` → 409 `DUPLICATE_NAME` med svensk text i alla skrivvägar, unika index (migration 0104), banfilen avvisar
  med namnet. Kvar i skogen räknas från tävlingsdagen (`raceDayStarted`, `raceDate` i skogsrapporten). Speakerns "Senast i mål" bara med målgång.
  IOF EntryList validerar `ControlCard` som Eventor och 422 bär felen. Sessionsfrågorna (organizer, tävling) svarar 200 `authenticated: false`.
- Verifierat: lint, typecheck, test, test:integration (72 filer; `adr-0169-draw` flyttad till 2027 eftersom vakanstiderna måste ligga efter nu,
  `task-001`/`task-008` gick igenom vid omkörning efter tidsgräns under last), build, e2e (se nedan).

### 2026-10-06 – Steg 21: kopiera tävling och kvitto vid avläsning (steg 21 klart)
- "Ny tävling som …": "Kopiera" per lopp i Mina tävlingar (ej funktionär) och under Inställningar. Dialog: namn, loppnamn, datum (samma veckodag
  nästa gång om källan passerat), "Ta med funktionärer och administratörer" (förval på; kopieraren blir ägare, källans ägare blir administratör).
- `copyRaceAsUserAccount` i en transaktion (källan låst): typ, tidszon, kontroller/poäng, banor med alla versioner och varianter, klasser (startsätt,
  maxantal, rogaining), sträckor (starttid samma klockslag nytt datum), karta med georeferens, radiokontroller (avstängda) – nya rader. Inte: deltagare,
  lag, lottning, avläsningar, resultat, rutter, radiostämplingar, Eventor (klassernas Eventor-id tas bort), publicering (ny kort kod). Migration 0103 (journal).
- Avläsningen: "Skriv ut kvitto" efter beskedet, "Skriv ut kvitto automatiskt", QR på skärmen och kvittobredd 80/58 mm per enhet (localStorage).
  Kvittot: tävling, datum, löpare, klass, klubb, bricka, status, tid, sträcktider med mål, rogainingpoäng/straff, QR (`qrcode` i skalet) till löparens resultat
  eller `/t/{kod}`. Paketet bär kort kod och publika resultat-id, så allt fungerar utan nät. Ingen placering: offline känner enheten bara sina egna avläsningar.
- Verifierat: lint, typecheck, test (nya `receipt.test`, `race-copy.test`), test:integration (71 filer, nytt `steg-21-copy-race`), build, e2e alla 16 specar gröna i grupper (nytt `kopiera`;
  funktionarer, admin-access, listor efter omförsök; publikt, radio, redigera-bana var för sig sedan servern dött av minnet). Skärmbilder granskade.

### 2026-10-06 – Steg 20: radiokontroller via ROC/OResults (steg 20 klart)
- Inställningar → Radiokontroller (ej Träning/Rogaining, bara admin): källa ROC/OResults, enhetens id, radiokontroller ur banorna med namn, på/av;
  läget (senaste hämtning, stämplingar, okända brickor, oläsbara rader, fel i klartext) och "Hämta nu". Stafettens sträcklöpare får inga mellantider än.
- `packages/roc`: tolerant läsning (BOM, CRLF, trasiga rader räknas, dubbletter, id som inte ökar, lokal tid → tävlingens tidszon) och tunn klient.
  Migration 0102: `race_radio_link`, `race_radio_control`, `radio_punch` (rå rad, oföränderlig, unik på källa+enhet+id och bricka+kontroll+tid).
- Pollern i webbprocessen (`instrumentation.ts`): var 10:e s på tävlingsdagen, PostgreSQL-lås (en instans), 20/40/60 s efter fel, stämplingar och lastId
  i en transaktion. `OTID_RADIO_POLLER=off` stänger av; `OTID_ROC_BASE_URL` bara för test (falsk ROC på 4331, även i CI:s driftjobb).
- Domänen `radio-controls.ts` (tid och plats vid kontrollen, bricka matchas vid läsning). Resultatlistan och sträcktidsanalysen: "Ute i skogen" och
  "Vid radiokontroll"; speakern: senaste radiostämplingar, ledare vid kontrollen, "på väg in"; tävlingssidan: "Radiokontroller live".
- Verifierat: lint, typecheck, test, test:integration (70 filer, nytt `adr-0172-radio`), build (pollern provad i driftbygget: lås, fel, väntan), e2e alla
  15 specar gröna (nytt `radio`; grupp med publikt dödades av minnestaket och kördes om; funktionarer, lottning, stafett efter omförsök). ROC-adressen ska provas av ägaren.

### 2026-10-06 – Steg 19: publik startsida och tävlingssida (steg 19 klart)
- Migration 0101: `race.published_at` (NULL = inte publicerad) och `race.short_code` (6 tecken utan 0/1/i/l/o, unik, sätts av databasen).
  Synlig = publicerad och inte dold; en grind (`publicRaceAccess` + `lib/public-race-gate.ts`) för alla publika sidor, API:er, resultatströmmen och exporter.
- Arbetsytan: steget Publicera (före Avläsning, status Publicerad/Inte publicerad/Dold) och samma del under Inställningar: publicera/sluta publicera,
  tävlingssidans adress, kopiera länk, "Skriv ut QR-kod". Texten förklarar att startlistan har egen publicering och att resultaten syns vid avläsning.
- Opublicerad: "Tävlingen är inte publicerad" (404, inget namn). Ägare/administratör/funktionär inloggad med kontot ser publika sidor med
  bannern "Förhandsvisning – inte publicerad" (svaren `private, no-store`).
- Startsidan: sök på namn, Pågår nu (dagen i tävlingens tidszon), Kommande, Senaste med "Visa fler", inga adminlänkar. `/t/{kod}`: tävlingssidan
  (startlista, resultat, sträcktider, vägval, senast uppdaterad); `/t/{kod}/qr`: QR-kod (`qrcode`), A4/A5, ren utskrift. Listorna länkar dit.
- Verifierat: lint, typecheck, test (nytt `public-race-gate.test` över alla publika routes), test:integration (nytt `adr-0172-public-race`), build,
  e2e alla 14 specar var för sig gröna (nytt `publikt`; `listor` efter omförsök, avläsningens timing). Utvecklingsservern kräver lokalt `--max-old-space-size=1536`.

### 2026-10-05 – Steg 18: funktionärer och städning av gamla behörigheter (steg 18 klart)
- Rollen Funktionär (migration 0100: `FUNCTIONARY`, delegeringen `RACE_FUNCTIONARY`). Inställningar → "Personer med behörighet": ägare, administratörer och
  funktionärer i en lista; admin lägger till funktionär med e-post till befintligt konto ("Be personen skapa ett konto … först"), ägaren även administratörer.
  Medadministratörer på /organizer är borta (samma lista). Borttagen behörighet gäller direkt även för öppna sessioner; en session per enhet.
- Funktionären: Mina tävlingar "Funktionär", arbetsyta med bara Start (startlistor, utan export) och Avläsning (avläsning, direktanmälan av okänd bricka –
  inte koppling till anmäld –, kvar i skogen med återkomst/startläge, speaker). En tabell i `lib/race-roles.ts` + `requireRaceRole`; tjänsterna och DB kontrollerar igen.
- Borttaget: funktionärskoder, stationsparning/-credentials/-paket/device-batches, `apps/station`, incheckningsappen `/checkin` med egna sessioner och
  återställningskoder, egen inloggning för kvar i skogen, `api/events` (CREATE_EVENT), `/me` med deltagarkoder och följningar; 20 tabeller (migration 0100).
- Verifierat: lint, typecheck, test (nytt `race-roles.test` anropar alla adminroutes som funktionär/admin), test:integration (nytt `adr-0172-functionaries`),
  build, e2e i grupper (nytt `funktionarer`, två enheter på samma konto). Skärmbilder 1280/390 granskade.

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

- Import av "Exportera tävlingen" (`otid-race-export` v1) till en ny tävling; ångra strykning; Eventors "struken" som strykning i stället för ej start.

- Start: incheckningsappen (offline, krypterad lista) togs bort i steg 18 (halvfärdig, nåddes bara via funktionärskoderna). Funktionären sätter startläget
  online under Avläsning → kvar i skogen; avprickning direkt i startlistan (per starttid) och offline vore bättre vid starten.

- Radio: mellantider för stafettens sträcklöpare; speakerns klassfilter även för radioklasser; radiostämpling som starttid vid fri start.

- Vägval: justera tidsförskjutning mellan GPS-klocka och stationer per rutt; georeferens från KMZ eller världsfil (OCAD) i stället för tre punkter;
  kontrollernas lägen från banfilens koordinater; sträcktidsanalys för stafett (per sträcka); uppladdning av flera GPX-filer matchade på namn.

- Stafett: bana per sträcka finns bara via en gafflad bana (variant per sträcka). Det fastställda resultatets IOF-export skriver inte lag än. Kvar i skogen räknar även sträcklöpare som inte startat.

- Gafflingar: en klass som byter till en gafflad bana (Redigera klass) får inga varianter automatiskt; "Fördela gafflingar" gör det. IOF StartList/ResultList-export skriver inte variantens namn.
- Klassbyte till en lottad klass ger inte automatiskt en vakant tid; arrangören anger tid som förut.
- Fastställande jämför beslutsrevisionens bana med klassens: en disk som ligger kvar efter banändring kan ge "fel bana" där. Pröva i steg 8.5/8.6.
- …
