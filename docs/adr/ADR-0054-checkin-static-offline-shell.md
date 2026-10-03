# ADR-0054: Persondatafritt statiskt appskal för start-/målmobil

- Status: Accepterad, TASK 006W under implementation
- Datum: 2026-09-05
- Kompletterar ADR-0053. Befintliga React/TypeScript, Next.js-server och
  esbuild återanvänds; inga nya dependencies eller domängränser.

## Beslut före implementation

Avprickningsmobilen får ett separat statiskt React-appskal under /checkin/.
Next.js fortsätter servera filer och alla befintliga skyddade HTTP-anrop.
Appskalet har ingen serverrenderad persondata, RSC eller Server Actions.
Denna avgränsning gör en exakt cacheallowlist möjlig utan att cacha privata
Next-routes eller hela Next-runtime. Ingen ny fristående server införs.

En liten byggfunktion återanvänder workspace-stationens redan låsta esbuild
0.25.12. Beroendet är endast byggverktyg, aldrig stationens affärskod. Funktionens
genererade public/checkin innehåller hashbenämnda JS/CSS, index.html och sw.js.
Genererade filer ignoreras i Git och skapas före web dev/build. Befintlig
deployment måste distribuera public som för övriga Next-statiska resurser.
Ingen privat runtime-data får nå byggfunktionen; inga miljöhemligheter inlinas.

## Cache- och uppdateringsgrind

Service worker har enbart scope /checkin/. Install laddar en fast lista från
byggmanifestet: exakt index.html och hashbenämnda JS/CSS. Svar måste vara
same-origin, 200, utan redirect och ha rätt MIME-typ. SHA-256 kontrolleras
mot byggmanifestet innan något skrivs. Inga godtyckliga URL:er eller cache-
meddelanden accepteras. API, query-varianter, RSC, cookies/credentials, kartor
och roster finns aldrig i allowlist. Persondata finns endast i ADR-0053:s IDB.

Cache används bara för exakt allowlistade GET-URL:er; övriga requests lämnas
helt åt nätet. Aktivering väntar normalt på att äldre öppna flikar stängs;
ingen skipWaiting som byter kod mitt i operativt arbete. Första aktivering
får claim:a appskalets flikar. Gamla cacheversioner raderas inte automatiskt
i första implementationen; de innehåller endast publikt byggmaterial, och
en senare uttrycklig retention kan införas utan att röra IDB. Installerad
shellversion och faktisk komplett cache kontrolleras via MessageChannel innan
UI får visa offline redo. Enbart navigator.onLine eller registreringens
existens är inte sådant bevis.

## UI och återhämtning

Förberedelse ska vara explicit, online och behörighetsbunden: enhetsnamn,
registrering, full roster, lokal separat lösenfras, lagringssamtycke och
faktiskt persist-utfall. Ett misslyckat förberedelsesteg får inte skapa en
falskt redo-indikator. Efter reload visas en låst vy utan namn; lokal upplåsning
kräver passfras och kan fungera offline. Lokal upplåsning är inte onlineauth.
Startpersonal måste uttryckligen aktivera skrivläge. UI skiljer tre start-
markeringar och pending, serverlagrad effekt respektive konflikt utan bara färg.
Målregel/DNS/skogsklassificering stannar i befintlig domän/applikation.

Operativt skrivläge startar alltid avstängt efter upplåsning och slås på
uttryckligen. Klienten visar serverns roster och lokala intents som olika
kunskapskällor: pending är inte servergenomförd, konflikt är inte applicerad.
Startrollen kan välja Omarkerad, Startat eller Uppgiven ej start; fri start
får ingen officiell tid av klicket. Målrollen skickar ett explicit sammanhållet
FINISH_CORRECTION-intent med startmarkering och manuell återkomstflagga.
Inga historiska konflikter avskrivs av dessa knappar.

Varje markering inväntar IDB-commit och återläsning; UI uppdaterar inte
markeringen optimistiskt. Lokalt CAS-fel ger omläsning och avstängt skrivläge,
inte tyst retry med ny grund. Synk använder befintlig enstegstransport sekventiellt
och stoppar vid nät/auth/transport/lagringsfel. Ny session måste registrera
samma device/label med exakt samma actor innan kön skickas; annan aktör får
inte överta den. UI kan begära nytt roster efter synk men ändrar aldrig frysta
intents. Nätåterkomst får synka endast medan listan är upplåst och operatören
uttryckligen aktiverat automatisk synk; manuell synk är alltid möjlig med giltig
serverbehörighet. Låsning avbryter pågående nätarbete och döljer dess sena svar.

## Verifiering och begränsningar

Browserprov ska ladda verkligt byggt shell, aktivera worker, gå offline och
reload:a. Cacheinspektion måste visa endast allowlistade publika filer; ett
API-försök eller query får aldrig utöka cachen. Versions-/integritetsfel ska
blockera redo. Koppling av förberedelse/IDB/knappar/HTTP måste dessutom provas
som helt användarflöde; ett isolerat shellprov räcker inte för TASK 006W.
Fysisk iOS/Android, browserlagring under tryck och driftuppgradering återstår
som fält-/produktionsantaganden.

Faktaunderlag: docs/research/browser-checkin-storage.md samt projektets
bundlade Next.js 16.3.3-guider public-folder och progressive-web-apps.
