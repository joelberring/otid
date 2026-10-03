# TASK037: Kompakt mobil administration

Status: klar för detta avgränsade presentationssnitt, 2026-09-12.

Mobilbredd upp till720px visar deltagarlista eller arbetsformulär, inte båda
staplade. Desktop behåller två kolumner. Valt deltagande/Ny deltagare öppnar
arbetsvyn. Synliga knappar Deltagarlista/Arbetsvy växlar presentation, aldrig
session, utkast eller serverdata. Fokus flyttas till synlig panel vid explicit
mobilnavigering utan animation. Sökvillkor och utkast bevaras vid rent vybyte.

Under pågående operation eller fryst gransknings-/retryintent spärras rent
vybyte; granskning och okänd commit får inte döljas. Deltagargränsernas panel
ligger utanför växlingen så dess pending aldrig göms. Logout/status är alltid
utanför och synliga. Reauth av okänt intent återgår till arbetsvy, inte lista.

Berör endast web workspace/CSS/svenska texter och befintlig browserkedja.
Ingen arkitektur-, domän-, API-, lagrings- eller licensändring; ingen ny ADR
behövs för denna presentationsändring. Ingen ny dependency.

Acceptans: desktop båda paneler; mobil en synlig panel, valt deltagande och
ny anmälan öppnar arbete, tillbaka behåller sökning/utkast, pendingretry går
inte att gömma, logout rensar. Befintliga genomgående sparflöden passerar.
Kontrollera fokus och ingen horisontell overflow i browser. Riktad lint,
typecheck/test/build, inga nya PG-regler eller hårdvaruprov.

Verifierat: web lint/typecheck/build och browser-TS/lint exit0. Befintliga två
genomgående browserfall (1366/390px), riktig HTTP/isolerad PostgreSQL, passerar
23,1s. Mobil visar en panel; fokus, bevarad sökning/starttidsutkast och inga
API-anrop vid ren växling kontrolleras. Okänt sparutfall spärrar listväxling;
klassbyte, övriga sparflöden och logout passerar. Skärmbilder granskade utan
horisontell overflow. Reauth med pending är kodgranskat men inget nytt separat
browserfall. Fysisk mobil/tangentbord, stor tävling och produktion ej provade.
Full workspace-/hårdvarusvit kördes inte för denna webbpresentation.
