# TASK252: visa verifierade anmälningsluckor i loppets tidszon

Status: klart 2026-09-27.

## Användarutfall

På den separata direktanmälan ska en ledig lottad starttid visas i samma
lokala datum, klockslag och offset som tävlingens startlista. Operatören
ska kunna granska även en manuellt angiven fast tid i loppets zon utan att
den exakta tid som skickas eller journalförs ändras. Fri start berörs inte.

## Arkitektur före implementation

ADR-0165 utvidgar endast två privata läsrespons med validerad tidszon från
eventet, läst i samma transaktion som låst lopp. ADR-0063 styr visning och
fryst granskning; ADR-0122 styr verifierad slot, vakans och kanonisk
UTC-request. Ingen migration, ny status, teknik, behörighet eller domänregel.

## Riktad acceptans

- Klasslista och startslotkandidater har obligatorisk giltig tidszon;
  ogiltig/saknad zon avvisas av klient och serverkontrakt.
- Fristående och gemensam adminväg accepterar inte en slotkandidat vars zon
  eller scope skiljer sig från det egna aktuella underlaget. Ett sent svar
  efter klassbyte får inte synas.
- Slotens synliga etikett och granskning använder eventzonen; värde,
  begäran, proof och samma-id-retry är fortfarande exakt UTC-instant.
- Mobil och desktop är läsbara utan ny stor ruta eller sidspill. Otillgänglig
  verifiering är textmärkt; manuellt undantag är fortsatt explicit.
- Riktade kontraktsprov, berörd lint/typecheck/build och ett syntetiskt
  browserfall; ingen bred testsvit eller verklig tävlingsdatabas.

## Ingår inte

Ingen slotreservation, lottning, starttidsrättning, Eventor, resultat,
stafett, GPS, USB eller fysisk fältacceptans.

## Utfall och verifiering

Båda privata registreringsläsningarna lämnar nu en validerad tidszon från
eventet inom sin låsta lästransaktion. Den separata och gemensamma
administratörsvyn avvisar slotunderlag med annan zon. Den separata vyn
avvisar även fel lopp, klass, snapshot och banversion samt ignorerar ett
försenat svar efter klassbyte. Lottad tid och fryst granskning visas i
loppets zon med numerisk offset; optionens värde, skrivbegäran, slotbevis
och samma-id-retry är fortsatt samma kanoniska UTC-instant. Om slotunderlag
inte kan verifieras visas en textmärkt varning vid valet. Den vanliga
checkboxen använder neutral grafitgrå markering i stället för blå.

`CI=true pnpm --filter @o-tid/contracts exec vitest run
test/entry-registration-admin.test.ts`: **4/4**, exit 0. Contracts lint,
typecheck och build: **exit 0**. Application lint, typecheck och build:
**exit 0**. Web lint, typecheck och build: **exit 0**. E2E-TypeScript och
ESLint: **exit 0**. Syntetiskt Next/Chromiumprov `--grep TASK252`:
**3/3**, exit 0 vid 390 och 1366 px samt ett felzons-/sent-svar-fall;
bilder granskades. Första
browserstarten nekades av sandlådans loopbackport (`EPERM`); samma
isolerade prov passerade efter tillåten loopbackkörning. Ett nytt
regressionsfall gav först timeout när dess syntetiska fixture släppte
klasslistan före inloggning; fixturen rättades och 3/3 passerade.
Inget
PostgreSQL-test kördes eftersom en uttryckligen isolerad
`TEST_DATABASE_URL` inte fanns tillgänglig.

Kvarvarande antaganden: `events.time_zone` är fortsatt korrekt för
loppet, och den redan beprövade låsningen/kapacitetskontrollen fungerar
med verklig PostgreSQL och samtidiga anmälningar. Ingen fysisk touch,
verklig credential eller hårdvara har prövats i detta snitt.
