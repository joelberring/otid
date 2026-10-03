# TASK038: Målklassens tilldelade starttider vid klassbyte

Status: klar för detta avgränsade webbsnitt, 2026-09-12.

Administratören ser målklassens tilldelade fasta starttider i det befintliga
klassbytesformuläret, med samma session och redan inlästa transferunderlag.
Det hjälper val av minutstart utan att införa startlottning, reservation,
ny behörighet eller en ny spärr. Fri start visar ingen minutstartstabell.

En ren webbprojektion väljer målklassens entries, sorterar fasta tider efter
verkligt tidsögonblick (inte offsetsträngen) och därefter stabilt entry-ID.
Antal utan fast tid redovisas separat; inget tomt underlag får beskrivas som
bevis på ledig startlucka. Matchning mot inmatad tid jämför tidsögonblick och
visar en rådgivande varning, aldrig ny blockerande validering. Startintervall,
gemensam bana/startgrupp och externa startlistor ingår inte i denna jämförelse.

Kompakt utfällbar lista med högst20 deltagare per sida, namn och tid i
tävlingens tidszon. Visat totalantal och sidnavigation gör hela underlaget
tillgängligt utan10 000 DOM-rader. Byte av målklass börjar på första sidan.
Tabell och varning är senaste inlästa underlag, inte livebevakning eller
reservation. Granskat/sänt klassbytesintent och befintlig retry ändras inte.

Berör apps/web: liten ren projektionsfunktion med tester, befintlig workspace,
CSS/svenska texter och genomgående browserprov. Inga databas-/API-/domän- eller
licensändringar, inga dependencies. Befintlig ADR-0069/0070 gäller; ingen ny
ADR behövs för en rådgivande projektion av befintligt underlag.

Acceptans: endast vald FIXED-klass, korrekt kronologi över olika offset och
datum, null-tider räknas, alla deltagare nås via sidor, lika tidsögonblick ger
synlig men ej blockerande varning. Mobil/dator fungerar; PUNCH döljer tabellen.
Riktad helpertest, browserkedja, lint/typecheck/build. Syntetiska data, ingen
riktig tävling eller hårdvara. Ingen full svit för en ren webbprojektion.

Verifierat: web lint/typecheck/build och browser-TS/lint exit0. Helper och
befintlig tidsformatterare:5 godkända. Genomgående browserkedja:3 godkända
24,0s; efter tabellhöjdsjustering riktat TASK038:1 godkänt7,3s. Prov med22
tider, en nulltid och annan klass visar sidbyte/reset, korrekt datum/zon,
ingen extra request och faktiskt sparat klassbyte trots rådgivande tidsmatch.
Utfällda mobil-/datorskärmbilder granskade; tabellen har begränsad höjd och
sidknappar utanför rullområdet. Ingen horisontell overflow.

Antaganden: befintligt validerat roster är senaste inlästa kunskap; ingen
startlucka reserveras och klass-/banöverskridande intervall utvärderas inte.
Fysisk mobil, stor tävling och produktion ej verifierade. Inget nytt separat
offline-/hårdvaru-/fullworkspaceprov; befintliga serverregler ändras inte.
