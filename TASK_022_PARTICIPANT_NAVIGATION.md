# TASK022 – deltagargenvägar från gemensam lista

Före implementation: ADR-0064 bevarar PII-fri översikt och separata behörigheter.
Återanvänd startlistans sökbara namn/klubb/brick-/klassunderlag, med kompakt
Rätta-meny per rad. Brickbyte för alla, fast starttid endast FIXED. Översiktens
befintliga länk får tydlig deltagar-/startlistetext, ingen extra API-läsning.

Berört paket: web. Engångshint endast i minnet; explicit val i målflödet efter
dess egen auth/listvalidering. Inga writes förrän befintlig granskning bekräftas.
Tester: race-/mål-/UUID-avvisning och engångskonsumtion, browserkedja med
separat auth, ingen PII/entry-id i URL, FIXED/PUNCH-gräns, lint/typecheck/build.
Inga server-/domän-/lagringsändringar eller extern kod.

Status: implementerat. Webblint/typecheck/build exit 0; 15 riktade Vitest-prov
och 4 browserprov passerade (11.2 s). Separat browser-tsc/ESLint exit 0.
Första browserkörningen hade fel förväntad inloggningstext i testet (4 fel),
rättad till befintlig svensk text; ingen auth- eller produktionsrelaxering.

Verifierat: båda målflödena i 1366/390 px, egen login före namn/val,
ingen automatisk selection eller PATCH, stale-lista utan genvägar, PUNCH utan
starttidsgenväg, ingen hint i URL och hård omladdning tappar hinten.
Mobilbild granskad. Full integration/hårdvara/produktion ej omkörd: inga
serverändringar. Same-tab/mjuk navigering krävs; fysisk mobil och mycket
stora listor återstår. Ingen privat tävling eller Eventor berörd.
