# TASK254: neutral och kompakt separat omräkningsvy

Status: klar 2026-09-27.

## Användarutfall

Den separata omräkningssidan ska låta målpersonalen snabbt hitta rätt
deltagare, se varför en omräkning är möjlig eller blockerad, och skilja
en ny resultatrevision från ett osäkert serversvar. Desktop behöver
informationstäta rader i stället för stora kort; mobil behöver en tydlig
ordning, läsbara metadata och minst 52 px tryckytor utan sidspill.

## Gräns före implementation

CODEX_BRIEF, docs/architecture.md, docs/domain-rules.md och
docs/offline-sync.md behåller ren resultatmotor, separat
`RECALCULATE_RESULT`-behörighet, immutabla revisioner och explicit
same-id-retry vid okänd commit. TASK254 ändrar enbart sidans presentation
och svensk hjälptext. Ingen ny teknik, dependency, migration, API,
domänregel eller resultatutvärdering införs; ingen ADR behövs.

## Riktad acceptans

- Neutral vit/grå vardagskrom. Röd/gul signalfärg får bara komplettera
  text om blockerare, fel eller osäker retry.
- Internet, session och antal redo syns kompakt högt upp. Den separata
  behörigheten och effekten av åtgärden förblir synliga.
- Varje rad behåller namn, klubb, klass, deltagarversion, readiness,
  senaste avläsning, senaste revision och åtgärd. Blockerad åtgärd
  ser avaktiverad ut och är semantiskt disabled.
- Pending intent, request-id och uttrycklig retry/avbrytning är synliga
  även på mobil; ingen automatisk retry eller ändrad skrivbegäran.
- Ett riktat UI-prov och ett syntetiskt browserfall vid 390/1366 px,
  med flera deltagare och blandad beredskap, räcker tillsammans med
  berörd lint/typecheck/build. Ingen verklig databas/credential.

## Ingår inte

Ingen ändring av resultatmotor, brickkoppling, servermutation,
historik, andra adminytor eller fysisk touchacceptans.

## Utfall och verifiering

Sidan har neutral vit/grå krom och täta trekolumnsrader på desktop.
Namn, klubb, klass, deltagarversion, beredskap och befintlig
revisions-/avläsningsinformation är kvar. Blockerade knappar är både
semantiskt avaktiverade och synligt nedtonade. Mobil staplar samma
information utan horisontellt spill och har minst 52 px tryckytor.
När ett skrivsvar är osäkert flyttas fokus och scroll till den
textmärkta gula retry-panelen. Begäran skickas inte automatiskt om;
retry använder samma frysta request-id och kropp. Den separata
omräkningsbehörigheten benämns »omräkningsnyckel« i inloggningen.

- Riktat web-UI-prov: 6/6, exit 0.
- Syntetiskt Chromiumprov: 1/1, exit 0 vid 390/1366 px. Normal- och
  retrybilder granskades; ingen sidscroll i sidled.
- Web lint, typecheck och build: exit 0 var för sig.
- Riktad E2E-TypeScript och ESLint: exit 0 var för sig.

Första browserkörningen stoppades av en för bred testselektor som även
träffade Nexts route-announcer. Selektorn begränsades till retry-panelen
och slutlig omkörning passerade. Det äldre `task-001`-provet har bara fått
sin synliga inloggningstext uppdaterad; det kördes inte utan isolerad
PostgreSQL. Ingen verklig credential, databasmutation, fysisk mobil eller
SPORTident-hårdvara verifierades.
