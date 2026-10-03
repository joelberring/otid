# TASK263: neutral grundstil och kompakt vy för Utom tävlan

Status: genomförd 2026-09-27.

## Användarutfall

Tävlingspersonalen ska snabbt hitta deltagare vars aktuella tekniska
resultat kan markeras som Utom tävlan, se exakt resultatkälla och förstå
varför andra är blockerade. Desktop visar en tät lista; mobil visar samma
beslutsunderlag i prioriterad ordning utan sidspill. Grå/vit vardagsyta
och få textbundna signalfärger ger lugn men lämnar viktiga avvikelser synliga.

Samma lugna grundstil gäller appens gemensamma ytor: ljust sidhuvud, neutral
primäråtgärd, lågmälda avgränsningar, måttlig textstorlek och mindre kort.
Färg reserveras för semantiska signaler som felstämpling, saknad information
och ledartid i speakerläge. Signalerna måste också ha text/ikon och får inte
förlita sig på färg ensam. Specialvyer med egna neutrala regler behålls.

## Gräns före implementation

ADR-0035:s separata `DECIDE_OUT_OF_COMPETITION`-behörighet, direkta
publicerade OK/MP-target, orankat OOC med bevarad teknisk fakta, fryst
intent, tvåstegsbekräftelse, CSRF och same-id-retry ändras inte. Ingen
automatisk OOC-klassificering införs. Rådata, tekniska revisioner,
stationens offlinekö, resultatmotor och gemensam admin ändras inte.
Ingen dependency, migration, API eller domänregel tillkommer; ny ADR behövs
inte.

## Riktad acceptans

- Låg neutral status för enhetens nätläge, session och antal beslutsbara
  kandidater samt kort behörighets- och konsekvenstext.
- Täta rader med deltagare, klubb, klass, deltagarversion, exakt teknisk
  targetrevision och beslutsstatus/blockeringsskäl. Blockerade rader
  förblir läsbara men deras åtgärd är disabled; text bär betydelsen.
- Fryst bekräftelse visar deltagare, klass, target och snapshot före POST.
  Osäkert skrivutfall och återautentisering hålls isär; endast uttrycklig
  byteidentisk same-id-retry är möjlig.
- Riktat UI-/klientprov, ett syntetiskt browserfall vid 390/1366 px samt
  berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring i OOC-beslutets lagring, återtagande, gemensam
administratörsvy, resultatmotor, offlineavläsning eller fysisk enhet.

## Genomfört och verifierat

Grundytan använder neutral gråvit bakgrund, ljust kompakt sidhuvud,
skiffergrå standardåtgärder, tunnare avgränsningar och mindre skuggfria
paneler. De befintliga röda/gula/gröna semantiska tillstånden är kvar där
de förmedlar fel, varning respektive ledar-/resultatsignal och åtföljs av
text. Utom tävlan visar nät, session och antal beslutsbara i en låg rad,
exakt teknisk revision och svensk orsak i täta rader samt läsbara blockerade
deltagare med avaktiverad åtgärd. Bekräftelse och osäkert skrivutfall visar
fryst person, klass, revision och tävlingsversion; fokus flyttas till
beslutspanelen och endast explicit same-id-retry kan göras.

Riktade UI-/klientprov: **5/5**. Syntetiskt Chromiumprov: **1/1** vid
390/1366 px, inklusive läsbar mobilbekräftelse och byteidentiskt
återförsök. Webblint, web-typecheck, riktad browser-TypeScript/ESLint och
web-build: **exit 0**. Bilderna granskades visuellt. Det äldre
PostgreSQL-beroende `task-001`-provet kördes inte; dess OOC-lokatorer
uppdaterades för den nya texten och det frysta underlagets ordning.

Antagande: appens befintliga semantiska färger för avvikelse och
speakerledare är tillräckligt distinkta mot den neutrala basen; fysisk
mobil, solljus/regn och produktion är inte verifierade här. Ingen verklig
credential, tävlingsdata eller hårdvara användes.
