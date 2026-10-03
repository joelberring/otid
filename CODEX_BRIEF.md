# CODEX-BRIEF: O-Tid

## 1. Uppdrag

Bygg ett mycket enkelt, robust och funktionellt internetbaserat tidtagnings- och tävlingssystem för orientering.

Systemet ska minska behovet av vanliga tävlingsdatorer. Arrangörer ska kunna genomföra en träning, klubbtävling eller normal individuell tävling med en internetserver, mobiltelefoner, Androidplattor och vid behov vanliga datorer. SPORTident-utrustning ska anslutas **direkt till systemets egna klienter**, utan att MeOS, SI-Droid, SPORTident Center eller andra program måste ligga emellan.

Samma plattform ska ge arrangörer, avläsningspersonal, startpersonal, speaker, ledare, tävlande och publik varsin enkel vy. En kommande huvudmodul ska erbjuda fri spårvisning och spåranalys med egna kartor, banor och GPS-rutter – ungefär samma problemområde som Livelox, men självständigt utvecklad, utan beroende av Livelox data, API, gränssnitt eller varumärke.

Arbetsnamn: **O-Tid**.

## 2. Produktlöfte

En liten klubbtävling ska i normalfallet kunna genomföras så här:

1. Arrangören skapar tävlingen eller hämtar den från Eventor.
2. Banor importeras som IOF XML 3.0.
3. En Androidplatta ansluts direkt till en SPORTident BSM7/BSM8/miniReader via USB.
4. Tävlingspaketet laddas ner till plattan.
5. Brickor läses av även om internet försvinner.
6. Deltagaren får omedelbart besked om resultat och sträcktider.
7. När internet finns synkroniseras rådata, resultat, speakerinformation och publikresultat.
8. Efter kartsläpp kan deltagarna ladda upp eller spela in GPS-spår och jämföra flera rutter utan individuell betalvägg.

För större tävlingar ska samma kärna kunna skalas upp med flera avläsningsenheter, start- och målenheter, radiokontroller, speakerstationer och många publikklienter.

## 3. Icke förhandlingsbara principer

### 3.1 Servern äger tävlingen, men stationen får aldrig stanna på grund av internet

Servern är den gemensamma sanningskällan för tävling, deltagare, banor, resultat och publicering. Varje operativ station har samtidigt en lokal, beständig kopia av det material den behöver och en lokal kö för ännu inte kvitterade händelser.

En komplett brickavläsning ska kunna:

- tas emot,
- sparas,
- tolkas,
- kontrolleras mot bana,
- presenteras för operatören,
- och senare synkroniseras,

utan internetanslutning.

### 3.2 Rådata får aldrig förstöras

Systemet skiljer alltid på:

1. rå mottagen hårdvarudata,
2. normaliserade stämplingar,
3. beräknat resultat,
4. manuella beslut.

Råa bytes och mottagningsmetadata är oföränderliga. Resultat får räknas om, men den ursprungliga avläsningen får inte skrivas över.

### 3.3 All mottagning ska vara idempotent

Samma avläsning eller GPS-batch ska kunna skickas många gånger utan att skapa dubletter. Varje station använder stabilt `device_id`, lokalt sekvensnummer och innehållshash. Servern kvitterar först när data är permanent lagrad.

### 3.4 Resultatlogik är en ren, versionsstyrd domänfunktion

Resultat får inte räknas i Reactkomponenter, API-routes eller SQL-frågor. Samma resultatmotor ska kunna köras lokalt i stationsklienten och centralt på servern.

Serverns beräkning är auktoritativ. Varje resultat sparar vilken version av resultatmotorn, tävlingssnapshoten och banversionen som användes.

### 3.5 Kartor och GPS-spår är förstaklassdata från början

Spåranalys byggs i en senare version, men databasen får inte utformas så att karta, bana, koordinater eller GPS-rutter måste klistras på i efterhand.

Kontroller, banor och kartor ska därför versionshanteras och kunna bära:

- WGS84-koordinater,
- koordinater i angivet EPSG-system,
- koppling till kartversion,
- publiceringstid,
- och relation till klass, bana och resultat.

### 3.6 Enkelhet före generell plattform

Bygg först för svensk fot- och nattorientering med SPORTident och Eventor. Gör tydliga adaptergränser, men bygg inte ett generellt system för alla sporter.

### 3.7 Ingen osynlig automation

Operatören ska alltid kunna se:

- om hårdvaran är ansluten,
- om internet fungerar,
- hur många poster som väntar lokalt,
- vilken tävlingsversion stationen har,
- vad servern har kvitterat,
- och varför ett resultat ändrades.

### 3.8 Självständig implementation

Livelox API får inte användas för att bygga spårmodulen. Kartor och rutter ska komma från arrangören och användarna själva.

MeOS och andra system används som:

- funktionsreferens,
- arbetsflödesreferens,
- interoperabilitetspartner,
- och testfacit för egna testtävlingar.

Kopiera inte deras UI, kodstruktur, källkod eller varumärkesuttryck.

## 4. Avgränsning

### 4.1 Första produktionsdugliga versionen, V1

V1 ska hantera:

- individuell orientering,
- träning och klubbtävling,
- vanliga klasser och öppna klasser,
- Eventorimport,
- IOF XML 3.0 för anmälningar, banor, startlistor och resultat,
- direktanmälan,
- brickkoppling och hyrbrickor på grundnivå,
- starttid, startstämpling, målstämpling och full brickavläsning,
- direkt SPORTident-anslutning,
- kontroll av bana,
- status OK, felstämplad, ej start, ej fullföljt, diskvalificerad, utom tävlan och utan tidtagning,
- sträcktider,
- skogskontroll,
- live- och slutresultat,
- speakerläge,
- PM och dokument,
- kartsläpp,
- export och komplett tävlingsarkiv,
- drift med flera stationer,
- lokal funktion vid nätbortfall.

### 4.2 Nästa huvudversion, V2

V2 ska lägga till den egna spårmodulen:

- georefererade kartor,
- banöverlägg,
- GPX-, FIT- och TCX-import,
- inspelning från mobil,
- koppling mellan deltagare, resultat och rutt,
- visning av en eller flera rutter,
- uppspelning i faktisk tid och masstart,
- kontroll-för-kontroll-visning,
- sträckjämförelse,
- distans, tid och tempo per sträcka,
- manuell och automatisk tidslinjering,
- privata ledarspår för ungdomsträning,
- efterföljande publicering av spår enligt tydliga åtkomstregler.

V2 ska kunna erbjuda fler-ruttjämförelse utan individuell premiumspärr.

### 4.3 Senare versioner

Senare kan systemet hantera:

- stafett och individuella stafettformer,
- patrull,
- poängorientering och rogaining,
- slingor och fjärilar,
- flerdagarstävling och jaktstart,
- kval/final,
- bokningsbara starttider,
- avancerad seedning och startlottning,
- SRR-radiokontroller och direkt radioingest,
- Bluetoothskrivare,
- automatisk synkronisering från klockleverantörer,
- avancerad duell- och vägvalsanalys,
- ekonomimodul.

### 4.4 Inte i V1

Bygg inte följande i första versionen:

- full fakturering,
- egen betalplattform,
- avancerad listdesigner,
- godtyckligt skriptspråk för resultatregler,
- full OCAD-editor,
- direkt programmering av alla kontrollenheter,
- stöd för alla tänkbara tävlingsformer,
- beroende av en särskild molnleverantör,
- mikrotjänster eller Kubernetes.

## 5. Användarlägen

Samma webbsystem används för alla webblägen. Behörighet och vy avgörs av roll och enhet.

### 5.1 Systemadministratör

- hantera klubbar och tjänstens övergripande inställningar,
- övervaka drift och säkerhetskopior,
- hantera integrationer och API-nycklar,
- läsa tekniska loggar utan att exponera mer persondata än nödvändigt.

### 5.2 Klubbadministratör

- skapa och arkivera tävlingar,
- utse tävlingsadministratörer,
- hantera klubbens kartor och integrationsinställningar,
- sätta lagringstider och standardregler.

### 5.3 Tävlingsadministratör

- skapa tävling manuellt eller från Eventor,
- importera banor och deltagare,
- hantera klasser, banor, starttider och brickor,
- publicera PM, startlistor, resultat och kartor,
- granska avvikelser och manuella beslut,
- exportera hela tävlingen.

### 5.4 Direktanmälan

- söka person och klubb,
- läsa bricka för identifiering,
- skapa efteranmälan,
- välja klass,
- tilldela eller byta bricka,
- registrera betalstatus utan att V1 behöver sköta betaltransaktionen.

### 5.5 Avläsning

Vyn ska vara extremt enkel:

- stor indikator för station,
- stor indikator för internet och synkroniseringskö,
- senast avlästa deltagare,
- stort resultatbesked,
- saknade eller extra kontroller,
- batterivarning för SIAC när data finns,
- knapp för att hantera okänd bricka,
- möjlighet att läsa om brickan,
- låst operatörsläge så att fel funktion inte väljs av misstag.

### 5.6 Start och mål

- visa vilka som ska starta,
- hantera sen eller ändrad start,
- ta emot start-, check- och målstämplingar,
- visa avvikelser,
- fungera med tydlig stationsbehörighet.

### 5.7 Speaker

- klassvis ställning,
- senaste händelser,
- radiopasseringar,
- målgångar,
- tidsdifferenser,
- bevakade löpare,
- saknade förväntade passeringar,
- anteckningar som bara speaker ser,
- storbildsläge.

### 5.8 Publik och tävlande

Ingen installation och inget konto ska krävas för offentlig information:

- PM,
- anmälningslista,
- startlista,
- live- och slutresultat,
- sträcktider,
- sökning,
- favoriter lokalt i webbläsaren,
- kartor efter kartsläpp,
- spår och analys i V2.

### 5.9 Ledare

- skapa privat träningsgrupp,
- ge deltagare QR-kod eller kort anslutningskod,
- se aktuell eller senast känd position,
- se ålder på position, noggrannhet och batteri,
- få tydlig markering när kontakt saknas,
- avsluta och radera spår enligt lagringsregel.

## 6. Övergripande arkitektur

Systemet byggs som en **modulär monolit med separata klientskal**, inte som mikrotjänster.

```text
                           ┌─────────────────────────────┐
 Eventor ─────────────────▶│ Integrationsmodul           │
 IOF XML ─────────────────▶│ import, export, synkstatus  │
                           └──────────────┬──────────────┘
                                          │
 ┌────────────────────────────────────────▼─────────────────────────┐
 │                         O-Tid server                              │
 │                                                                  │
 │  API och autentisering                                           │
 │  Tävlingsdomän och resultatmotor                                 │
 │  Realtime/SSE                                                    │
 │  PostgreSQL + PostGIS                                            │
 │  Privat S3-kompatibel objektlagring                              │
 │  Bakgrundsjobb för kartor, filer och rutter                      │
 └──────────┬──────────────────┬──────────────────┬─────────────────┘
            │                  │                  │
      Arrangörswebb       Speaker/publik     Spår- och ledarvy
            │
            │ HTTPS-synk med kvittens
            ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │ Android stationsapp / desktop station client                    │
 │                                                                  │
 │ Transport: Android USB Host | Web Serial | TCP | simulator      │
 │ SPORTident-protokoll                                             │
 │ Lokal SQLite/IndexedDB                                           │
 │ Lokal resultatmotor                                              │
 │ Beständig utgående kö                                            │
 └──────────┬───────────────────────────────────────────────────────┘
            │ rå seriell kommunikation
            ▼
        BSM7 / BSM8 / miniReader / senare SRR
```

### 6.1 Processer i första driftversionen

Håll antalet driftkomponenter lågt:

1. `web`: Next.js-baserad webb och HTTP-API, körd som vanlig Node-container.
2. `worker`: separat process ur samma kodbas för tunga eller asynkrona jobb.
3. `postgres`: PostgreSQL med PostGIS.
4. `object-storage`: S3-kompatibel lagring, MinIO lokalt.
5. `reverse-proxy`: TLS och enkel trafikstyrning i produktion.

Ingen Redis krävs från början. Jobbkö och händelseutskick ska i första hand använda PostgreSQL.

## 7. Rekommenderad teknik

### 7.1 Monorepo

- TypeScript i strikt läge.
- pnpm workspaces.
- Turborepo eller enkel pnpm-workspace; välj det enklaste som ger reproducerbara kommandon.
- Docker Compose för lokal utveckling.
- OpenAPI för externt API.

### 7.2 Webb och server

- Next.js som containeriserad Node-applikation, inte beroende av serverlessfunktioner.
- React för användargränssnitt.
- PostgreSQL + PostGIS.
- Drizzle eller annat SQL-nära, migrationsstyrt databaslager med god PostGIS-kontroll.
- Zod eller motsvarande schemas som delas mellan server och klient.
- Server-Sent Events för resultat-, speaker- och ledaruppdateringar.
- Vanliga idempotenta HTTP-batcher för uppströmsdata.
- Privat S3-kompatibel objektlagring.
- MapLibre GL JS för kartvisning.
- GDAL i workercontainern för georeferering, reprojektion och tilegenerering när spårmodulen byggs.

### 7.3 Stationsklient

- Gemensam webb-UI där det är möjligt.
- Capacitor för Androidpaketering.
- En liten, egen Kotlinmodul för Android USB Host och seriell I/O.
- En etablerad USB-seriebibliotekskomponent får användas som transportlager efter licensgranskning, men SPORTident-protokollet ska ligga i projektets egna testbara paket.
- Web Serial som sekundärt desktopalternativ i Chrome/Edge.
- Ingen förväntan om direkt SI-avläsning på iPhone/iPad.
- SQLite i Androidappen.
- IndexedDB bakom samma persistensgränssnitt för webbstationer.

### 7.4 Tester

- Vitest för domän- och protokolltester.
- Playwright för användarflöden.
- Testcontainers eller Dockerbaserad PostgreSQL i integrationstester.
- Golden fixtures för IOF XML och SPORTident-ramar.
- Egenskriven byte-chunk-fuzzer för den seriella parsern.
- Lasttest för ingest, SSE och publikresultat.

## 8. Föreslagen repositorystruktur

```text
/apps
  /web
    Next.js: arrangör, publik, speaker och API
  /station
    Capacitor-app och stations-UI
  /worker
    jobb för import, export, kartor och GPS-rutter

/packages
  /domain
    rena domänobjekt och resultatmotor
  /sportident-protocol
    frame parser, CRC, kommandon och kortavkodning
  /device-transport
    abstraktioner för USB, Web Serial, TCP och simulator
  /station-sync
    lokal kö, idempotens, kvittens och konfliktregler
  /iof-xml
    IOF XML 3.0 import, export och validering
  /eventor
    Eventor-klient och mappning till intern modell
  /maps
    koordinatsystem, georeferering och kartmetadata
  /routes
    GPX/FIT/TCX, linjering och analys
  /contracts
    API-schemas och delade typer
  /ui
    gemensamma komponenter

/docs
  /adr
  /research
  architecture.md
  domain-rules.md
  sportident.md
  offline-sync.md
  map-and-route-model.md
  security-privacy.md
  operations.md
  acceptance-tests.md

/fixtures
  /iof
  /sportident
  /gpx
```

Beroenderiktning:

```text
UI och adapters
      ↓
applikationstjänster
      ↓
domänpaket
```

`packages/domain` får inte importera Next.js, databasbibliotek, React, filsystem eller nätverkskod.

## 9. Domänmodell

Använd UUID eller UUIDv7 som interna identiteter. Externa id:n lagras separat och får aldrig vara primärnyckel.

### 9.1 Organisation och behörighet

- `organisation`
- `user`
- `membership`
- `role_assignment`
- `device`
- `device_pairing`
- `audit_event`

Roller ska kunna avgränsas till organisation, tävling och funktion.

### 9.2 Tävling

- `event`
- `race`
- `event_version`
- `event_setting`
- `publication_rule`
- `document`
- `external_reference`

Ett Eventorevenemang kan ha flera lopp eller etapper. Den interna modellen ska därför skilja på `event` och `race` från början.

### 9.3 Deltagare

- `person`
- `organisation`
- `entry`
- `entry_revision`
- `start`
- `card_assignment`
- `rental_card`
- `payment_state`
- `external_identity`

En tävlingsanmälan är inte samma sak som en person. En person kan ha flera lopp och olika brickor.

### 9.4 Klass och bana

- `class`
- `course`
- `course_version`
- `control`
- `course_control`
- `class_course_assignment`
- `forking_group` senare

Banan är versionsstyrd. En ändring efter att avläsningar kommit in får inte skriva om historiken.

Varje kontroll kan ha:

- kod,
- ordningsoberoende intern identitet,
- WGS84-koordinat,
- koordinat i kartans CRS,
- typ: start, kontroll, mål, varvning, obligatorisk passage,
- giltighetsintervall och version.

### 9.5 Hårdvarudata

- `device_session`
- `raw_device_message`
- `card_readout`
- `card_readout_revision`
- `punch`
- `online_punch`
- `station_health`

`raw_device_message` ska innehålla:

- enhets-id,
- lokalt sekvensnummer,
- mottagningstid enligt stationen,
- serverns mottagningstid,
- rå payload,
- payloadhash,
- transporttyp,
- parserstatus,
- eventuellt fel.

### 9.6 Resultat

- `result_revision`
- `split_time`
- `manual_decision`
- `result_publication`
- `result_engine_version`

Ett resultat ska kunna förklaras. API:t ska kunna svara med exempelvis:

```json
{
  "status": "MP",
  "reason": "MISSING_CONTROL",
  "missingControls": [74],
  "extraPunches": [91],
  "courseVersionId": "...",
  "engineVersion": "1.3.0",
  "manualDecision": null
}
```

### 9.7 Kartor och spår

Skapa tabellerna tidigt även om funktionerna aktiveras i V2:

- `map`
- `map_version`
- `map_georeference`
- `map_tie_point`
- `map_asset`
- `course_print`
- `route`
- `route_point`
- `route_assignment`
- `route_alignment`
- `route_control_passage`
- `route_leg_metric`
- `tracking_session`
- `tracking_visibility`

## 10. Direkt SPORTident-stöd

Detta är ett eget subsystem och ska inte byggas som några ad hoc-anrop i stationsvyn.

### 10.1 Stödmål

Första hårdvarumålet:

- BSM8-USB eller miniReader.
- Utökad SPORTident-protokollkommunikation.
- SI-Card 8, 9, 10, 11 och SIAC.
- Därefter SI-Card 5 och 6 med särskild tidslogik.
- Windows/macOS via Web Serial som utvecklings- och reservväg.
- Android via USB OTG som huvudsaklig datorfri väg.

Bekräfta faktiskt tillgänglig hårdvara innan testmatrisen låses.

### 10.2 Transportlager

Definiera:

```ts
export interface ByteTransport {
  readonly kind: "android-usb" | "web-serial" | "tcp" | "replay";
  open(): Promise<void>;
  close(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onBytes(handler: (chunk: Uint8Array) => void): Unsubscribe;
  onState(handler: (state: TransportState) => void): Unsubscribe;
}
```

Transportlagret vet ingenting om brickor, kontroller eller resultat.

Implementationer:

- `AndroidUsbTransport`
- `WebSerialTransport`
- `TcpTransport`
- `ReplayTransport`

### 10.3 Protokollager

Protokollpaketet ska vara ren TypeScript och hantera:

- ramgränser,
- STX/ETX,
- ACK/NAK,
- DLE/escaping där det används,
- längdfält,
- CRC,
- timeout,
- återförsök,
- station probe,
- stationsinformation,
- autoserieläge,
- kortinsättning och borttagning,
- blockläsning,
- avkodning av korttyper,
- SIAC-batterispänning när tillgänglig,
- rå loggning utan personnamn.

Parsern ska tåla att en ram kommer:

- byte för byte,
- i flera godtyckliga chunkar,
- tillsammans med början av nästa ram,
- med brus före STX,
- med trasig CRC,
- dubblerad,
- eller avbruten.

### 10.4 Tillståndsmaskin

Använd en explicit tillståndsmaskin:

```text
DISCONNECTED
  → OPENING
  → PROBING
  → READY
  → CARD_DETECTED
  → READING
  → CARD_COMPLETE
  → ACKNOWLEDGED
  → READY
```

Fel ska leda till ett dokumenterat återhämtningsläge, inte till en låst spinner.

### 10.5 Oberoende testbarhet

Innan UI byggs ska protokollpaketet kunna köras från ett CLI:

```bash
pnpm si:capture
pnpm si:probe
pnpm si:replay fixtures/sportident/session-001.bin
pnpm si:decode fixtures/sportident/card10-001.bin
```

Varje rå session sparas både binärt och med tidsstämplade chunkgränser. Personuppgifter ska anonymiseras innan fixture läggs i Git.

### 10.6 Licensregel

MeOS-källan är AGPL-licensierad. Tills projektets licensbeslut uttryckligen säger något annat gäller:

- kopiera inte kod,
- porta inte funktioner rad för rad,
- översätt inte C++ till TypeScript/Kotlin,
- kopiera inte klass- eller filstruktur,
- dokumentera externa referenser i `docs/research`,
- implementera mot en egen, skriven protokollspecifikation och egna hårdvarucaptures.

Om projektet senare väljer AGPL och vill återanvända kod ska detta behandlas som ett separat beslut med attribution och full licensgenomgång.

### 10.7 Funktioner som inte krävs direkt

V1 behöver inte programmera kontrollstationer. Följande kan vänta:

- ställa kontrollkod,
- klocksynk av alla skogsenheter,
- firmwarehantering,
- full Config+-ersättning,
- LTE-modemkonfiguration.

## 11. Stationsapp och offline-synk

### 11.1 Tävlingspaket

Stationen hämtar ett signerat och versionsmärkt paket:

- tävlings-id och lopp,
- nolltid och tidszon,
- deltagare,
- klasser,
- brickkopplingar,
- starttider,
- banversioner,
- kontrollordning,
- resultatregler,
- stationens tillåtna funktion,
- serverns publika verifieringsnyckel.

### 11.2 Lokal lagring

Följande sparas lokalt före annan behandling:

- råa bytes,
- parserutfall,
- normaliserad bricka,
- lokal resultatbedömning,
- utgående synkpost.

En post får inte tas bort bara för att den har skickats. Den markeras kvitterad och behålls åtminstone tills tävlingen är stängd och arkiverad.

### 11.3 Synkprotokoll

Exempel:

```http
POST /api/v1/events/{eventId}/device-batches
Idempotency-Key: {deviceId}:{firstSequence}:{lastSequence}
```

Batchen innehåller:

- `deviceId`
- `sessionId`
- `packageVersion`
- `firstSequence`
- `lastSequence`
- händelser med egen hash.

Svaret innehåller:

- högsta sammanhängande kvitterade sekvens,
- eventuella enskilda avvisningar,
- aktuell tävlingsversion,
- om ett nytt paket måste hämtas,
- serverberäknat resultat.

### 11.4 Konflikter

Om tävlingsdata ändrats efter att stationen blev offline:

- rådata accepteras alltid om den är giltig,
- servern beräknar med aktuell och vid behov historisk snapshot,
- operatören varnas om lokal och central bedömning skiljer sig,
- servern skriver aldrig tyst över en manuell åtgärd,
- konflikten blir en granskningspost.

### 11.5 Operatörsstatus

Visa alltid:

```text
SPORTident: ansluten
Tävlingspaket: version 42
Internet: frånkopplat sedan 14:31
Avlästa brickor: 238
Kvitterade av servern: 217
Väntar lokalt: 21
Senaste lokala säkerhetskontroll: OK
```

## 12. Resultatmotor

### 12.1 Grundfunktion

```ts
evaluateCardReadout(
  readout: NormalizedCardReadout,
  snapshot: RaceSnapshot,
  options: EvaluationOptions
): EvaluationResult
```

Funktionen får inte utföra I/O eller läsa globalt tillstånd.

### 12.2 Regler i V1

- hitta deltagare via aktiv brickkoppling,
- stöd för okänd bricka,
- fast starttid eller startstämpling enligt klassregel,
- målstämpling,
- kontrollföljd,
- extra stämplingar,
- upprepade kontrollkoder,
- saknad kontroll,
- ändrad eller neutraliserad kontroll,
- bana med första kontroll som start eller sista som mål senare,
- utom tävlan,
- utan tidtagning,
- manuellt godkännande/diskvalifikation,
- dygnsgräns,
- 12-timmarsambiguitet för äldre brickor.

### 12.3 Revisionsprincip

Varje omräkning skapar en ny `result_revision`. Tidigare revisioner ligger kvar.

Orsaker kan vara:

- ny brickavläsning,
- ändrad brickkoppling,
- ändrad klass,
- ändrad starttid,
- ny banversion,
- neutraliserad kontroll,
- manuell jury- eller arrangörsåtgärd,
- ny motorversion.

### 12.4 Förklarbarhet

Resultatmotorn ska returnera maskinläsbara orsaker och en svensk operatörstext. Översättning ska ske utanför domänlogiken genom stabila felkoder.

## 13. MeOS som funktionsreferens

MeOS ska inte kopieras i sin helhet. Använd det för att undvika att missa etablerade tävlingsbehov.

### 13.1 Prioritet P0 – behövs för en trovärdig V1

- tävling med eller utan förberedelse,
- deltagare, klasser och banor,
- fri text/import och Eventor/IOF,
- direktanmälan,
- brickkoppling,
- automatisk SI-detektering,
- brickavläsning,
- sträcktider,
- skogskontroll,
- startlista och enkel lottning,
- speakerhändelser,
- live- och slutresultat,
- säkerhetskopiering,
- flera samtidiga operatörer,
- export till Eventor/IOF XML.

### 13.2 Prioritet P1 – efter stabil individuell tävling

- bokad eller fri start,
- start/check/mål som onlinehändelser,
- hyrbrickerapport,
- betalstatus och Swishreferens,
- flera etapper,
- preliminärt resultat vid målstämpling,
- egna listfilter,
- radio- och mellantider,
- avancerad speakerbevakning.

### 13.3 Prioritet P2 – avancerade format

- stafett,
- patrull,
- rogaining,
- slingor/fjäril,
- kval/final,
- jaktstart,
- klasspecifika resultatmoduler,
- avancerad ekonomi,
- egen listdesigner.

### 13.4 Funktionsmatris

Skapa `docs/meos-feature-matrix.md` med kolumnerna:

```text
Funktion | Användarbehov | MeOS-beteende | O-Tid-beslut | Fas | Testfall
```

Kod ska inte påbörjas för en P2-funktion bara för att den finns i MeOS.

## 14. Eventor och öppna format

### 14.1 Intern modell först

Eventorobjekt får aldrig läcka igenom hela systemet. All extern data mappas till interna objekt med:

- källsystem,
- externt id,
- hämtningstid,
- extern version eller hash,
- mappningsstatus,
- importvarning.

Lokala ändringar ska ha tydliga regler för vad en ny synk får och inte får skriva över.

### 14.2 Eventorfunktioner

Bygg adapter för:

- tävling och lopp,
- klasser,
- anmälningar,
- bricknummer,
- klubbar,
- startlista,
- resultat och sträcktider,
- uppladdning av start- och resultatlista där API och behörighet medger det.

Använd Testeventor för integrationstester.

### 14.3 IOF XML 3.0

Stöd minst:

- `EntryList`
- `CourseData`
- `StartList`
- `ResultList`

Validera mot officiellt schema. Spara originalfil, importresultat och varningsrapport. En trasig import ska vara atomär: antingen genomförs den helt eller lämnar den befintliga tävlingen oförändrad.

### 14.4 Persondata

Begär bara de Eventoruppgifter som behövs för tävlingen. Kontaktuppgifter ska inte importeras som standard.

Extern API-nyckel lagras krypterad på servern och får aldrig skickas till webbläsaren eller stationsappen.

## 15. Spårmodul V2 – självständig och förberedd från början

### 15.1 Produktmål

Spåranalysen ska vara så enkel och billig att nästan alla faktiskt använder den.

Kärnfunktionerna ska vara tillgängliga utan individuell premiumbetalning:

- se flera rutter samtidigt,
- spela upp,
- jämföra sträcka för sträcka,
- se splittider, distans och tempo,
- dela direktlänk.

Eventuella framtida intäkter bör i första hand komma från drift/klubbabonnemang, inte från att låsa grundläggande analys för enskilda löpare.

### 15.2 Oberoende från Livelox

- använd inte Livelox API för kartor eller rutter,
- skrapa inte data,
- kopiera inte deras UI,
- använd inte deras namn i produkten,
- bygg egna import- och publiceringsflöden,
- tillåt frivillig export/länkning till andra tjänster senare men gör inte kärnan beroende av dem.

### 15.3 Kartflöde

V2 börjar med robusta, öppna exportformat:

- GeoTIFF,
- TIFF/PNG/JPEG med world file,
- georefererad PDF där det går att tolka,
- manuellt georefererad rasterbild,
- IOF XML 3.0 för kontroller och banor,
- SVG/PDF som valfritt exakt banpåtryck.

Direkt OCAD-/OMAP-import är en senare adapter.

Varje kartversion lagrar:

- originalfil,
- checksumma,
- CRS/EPSG,
- georeferering,
- bounding polygon,
- upplösning,
- tileversion,
- rättighetsuppgift,
- publiceringsregel,
- vilka klasser som använder kartan.

### 15.4 Georeferering

Stöd tre nivåer:

1. Läs georeferering ur fil.
2. Koppla kartpunkter till kända koordinater med minst tre tie points och affin transformation.
3. Enkel tvåpunktsmetod för skala/rotation/translation när det är tillräckligt.

Visa residualfel. Arrangören ska kunna förhandsgranska kontroller mot kartan innan publicering.

### 15.5 Ruttimport

Första formaten:

- GPX,
- FIT,
- TCX.

Spara:

- originalfil,
- parser och parserversion,
- råa punkter,
- tid, lat/lon, höjd och eventuell noggrannhet,
- bearbetad linje,
- koppling till person, tävling, klass och resultat,
- synlighet,
- linjeringsparametrar.

### 15.6 Ruttkoppling

Automatisk kandidatmatchning ska använda:

- användaridentitet,
- tävlingens tid,
- ruttens geografiska överlapp,
- starttid/resultat,
- klass och bana.

Automatisk matchning måste kunna rättas manuellt.

### 15.7 Tidslinjering

Bygg i steg:

**V2.0**
- använd filens tidsstämplar,
- manuell offset och beskärning,
- linjera start och mål mot officiellt resultat.

**V2.1**
- hitta närmaste GPS-punkt till start, kontroller och mål,
- använd SI-sträcktider som ankare,
- föreslå offset och kontrollpassager,
- visa osäkerhet.

**V2.2**
- robust linjering per sträcka,
- hantera varierande klockfördröjning,
- upptäck dålig GPS och felaktig georeferering,
- aldrig förvränga originalrutten utan att behålla ursprungsdata.

### 15.8 Viewer

Minsta fria viewer:

- val av deltagare,
- en eller flera rutter,
- deltagarfärger,
- start/paus,
- hastighet,
- tidslinje,
- faktisk starttid,
- simulerad masstart,
- följ vald deltagare eller alla,
- rotera/zooma karta,
- kontroll-för-kontroll,
- tabell med tid, distans och tempo,
- delbar URL som bär vyinställningar men inte hemliga tokens.

Senare:

- duell,
- tid före/efter längs sträckan,
- vägvalskluster,
- bomtidsmodell,
- automatisk kommentering,
- export av analys.

### 15.9 Kartsläpp och åtkomst

Kartor, course prints och tiles ska ligga privat. Kontroll görs vid varje hämtning eller via kortlivad signerad URL.

Regler per tävling eller klass:

- manuell publicering,
- efter sista start,
- efter angiven tid,
- efter stängd klass,
- endast inloggade deltagare,
- lösenord,
- aldrig offentlig.

Att gissa en filadress får inte kringgå regeln.

### 15.10 Ungdomsspårning

Liveposition är en separat säkerhets- och ledarfunktion:

- privat som standard,
- endast utsedda ledare,
- tydligt ändamål,
- kort lagringstid,
- automatisk radering,
- ålder på senaste position visas alltid,
- ingen falsk framställning som garanterad räddningstjänst,
- historiska offlinepunkter visas inte som live,
- samma spår kan efter träningen frivilligt kopplas till analysmodulen.

Uppströmsdata kan skickas som idempotenta HTTP-batcher var femte till femtonde sekund. SSE används för ledarvyn.

## 16. Realtime och publikbelastning

SSE-kanaler:

- tävlingssammanfattning,
- klassresultat,
- speakerhändelser,
- stationsstatus för arrangör,
- ledarpositioner med särskild behörighet.

Varje händelse får monotont `event_sequence`. Klienten skickar `Last-Event-ID` vid återanslutning. Om historiken inte längre finns hämtar klienten en ny snapshot.

Publikvyer ska cacheas. Personliga eller hemliga uppgifter får aldrig ingå i offentlig cache.

## 17. Säkerhet och integritet

### 17.1 Grundregler

- EU/EES-drift som standard.
- TLS överallt.
- API-nycklar och tokens lagras krypterat.
- Minsta behörighet.
- Tävlingens operativa roller är tidsbegränsade.
- Full auditlogg för deltagar-, resultat-, kart- och behörighetsändringar.
- Inga kontaktuppgifter i publika resultat.
- Kartor och GPS-spår behandlas som skyddade resurser även när slutmålet är publicering.
- Rate limiting på publik API och filuppladdning.
- Filtyp verifieras utifrån innehåll, inte bara filändelse.
- Antivirus/skanning för uppladdade dokument där praktiskt möjligt.
- Objektlagring får inte vara publik bucket.

### 17.2 Enhetsparning

Stationsenhet paras med en kort engångskod eller QR-kod. Enheten får:

- egen identitet,
- avgränsad tävlingsbehörighet,
- tillåten funktion,
- roterbart token,
- möjlighet att spärras utan att stänga tävlingen.

### 17.3 Lagring

Definiera separata regler för:

- tävlingsresultat,
- rå SPORTident-data,
- auditlogg,
- uppladdade dokument,
- kartor,
- vanliga GPS-rutter,
- ungdomars livepositioner.

## 18. Drift och återställning

### 18.1 Säkerhetskopiering

- automatiska Postgresbackuper,
- point-in-time recovery i produktion,
- objektversionering,
- daglig verifiering att backup kan läsas,
- komplett händelseexport per tävling.

### 18.2 Tävlingsarkiv

En tävling ska kunna exporteras till ett versionsmärkt arkiv:

```text
manifest.json
event.json
entries.iof.xml
courses.iof.xml
starts.iof.xml
results.iof.xml
raw-readouts/
documents/
maps/
routes/
audit.ndjson
checksums.sha256
```

Återställning till en ny, tom server ska ingå i acceptanstesterna.

### 18.3 Observability

- strukturerade loggar,
- correlation-id,
- stationens senaste kontakt,
- kölängder,
- importfel,
- SSE-klienter,
- databas- och lagringshälsa,
- larm på ökande avvisade hårdvaruramar,
- inga råa personuppgifter i generell applikationslogg.

## 19. Prestanda- och robusthetsmål

Första dimensionerande mål:

- 3 000 deltagare i ett lopp.
- 10 samtidiga avläsningsstationer.
- 20 inkommande stämplings-/avläsningshändelser per sekund i topp.
- 1 000 samtidiga publikklienter.
- lokalt resultat inom 300 ms efter komplett avkodad bricka,
- serverkvittens normalt inom 2 sekunder vid fungerande nät,
- publikuppdatering normalt inom 3 sekunder,
- ingen dataförlust när appen tvångsstängs efter lokal lagring,
- återstart av server utan att stationerna behöver stoppas.

Detta är mål för design och tester, inte skäl att införa förtida distribuerad komplexitet.

## 20. Kritiska acceptanstester

### 20.1 SPORTident och station

1. En ram delas vid varje tänkbar bytegräns och avkodas ändå korrekt.
2. Trasig CRC avvisas och rådata bevaras.
3. Dubblerad ram ger inte dubbelt resultat.
4. Brickan tas bort mitt i läsning; klienten återgår till redo utan omstart.
5. USB-kabeln lossnar och återansluts.
6. Appen dödas efter lokal lagring men före serverkvittens.
7. Samma bricka läses på två stationer.
8. Okänd bricka kopplas till efteranmälan efter avläsning.
9. SIAC-batteridata saknas utan att läsningen misslyckas.
10. Äldre 12-timmarsdata passerar midnatt och normaliseras deterministiskt.

### 20.2 Resultat

11. Saknad kontroll ger MP.
12. Extra kontroll påverkar inte korrekt ordning.
13. Upprepad kontrollkod hanteras korrekt.
14. Deltagaren byter klass efter avläsning och resultat revideras.
15. Kontroll neutraliseras och alla berörda resultat räknas om spårbart.
16. Manuell diskvalifikation kan återtas utan att historik försvinner.
17. Ny motorversion ändrar inte gamla resultat utan explicit omräkningsjobb.

### 20.3 Synk

18. Samma batch skickas hundra gånger och lagras en gång.
19. Stationen är offline i två timmar.
20. Tävlingspaketet ändras under offlineperioden.
21. Servern återstartas medan flera stationer skickar.
22. Delvis batchfel kvitteras tydligt utan att godkända poster tappas.

### 20.4 Kartor och spår

23. Hemlig karta kan inte nås via känd eller gissad tile-URL.
24. Publiceringstid gör kartan åtkomlig utan ny uppladdning.
25. Tre kontrollpunkter ger verifierad affin transformation inom angiven tolerans.
26. GPX-rutt kan förskjutas i tid utan att originaldata ändras.
27. Flera rutter spelas upp med masstart.
28. Fördröjd livebatch märks som historisk.
29. Raderad ungdomsspårning är inte åtkomlig via cache eller signerad gammal URL.

### 20.5 Import och återställning

30. Ogiltig IOF XML lämnar befintlig tävling oförändrad.
31. Import kan köras igen utan onödiga dubletter.
32. Komplett tävlingsarkiv kan återställas på ny server.
33. Kontrollerade checksummor upptäcker ändrade arkivfiler.

## 21. Utvecklingsordning

### Etapp A – vertikal tävlingskärna

- repository och CI,
- intern domänmodell,
- manuell tävling,
- IOF CourseData och EntryList,
- simulerad brickavläsning,
- resultatmotor,
- arrangörs- och publiksida,
- idempotent ingest,
- revisionshistorik.

### Etapp B – direkt SPORTident-spike

- byte transportabstraktion,
- serial capture CLI,
- station probe,
- frame parser och CRC,
- en verklig korttyp,
- Android USB proof of concept,
- hårdvarufixtures,
- dokumenterad testmatris.

Spiken ska sluta i ett tydligt go/no-go-beslut och en lista över kvarvarande korttyper. Den får inte samtidigt försöka bygga hela tävlings-UI:t.

### Etapp C – offline stationsapp

- Androidpaketering,
- SQLite,
- signerat tävlingspaket,
- lokal resultatmotor,
- beständig kö,
- kvittens och konflikter,
- operatörsstatus.

### Etapp D – full individuell V1

- Eventor,
- direktanmälan,
- startlottning,
- skogskontroll,
- speaker,
- kartsläpp,
- export/arkiv,
- drift- och återställningstest.

### Etapp E – spårgrund V2

- kartversioner,
- georeferering,
- GPX/FIT/TCX,
- route assignment,
- enkel viewer,
- fler-ruttuppspelning,
- sträckvy,
- ledarspårning.

### Etapp F – avancerade former

Först när individuell tävling och spårgrund är stabila.

## 22. Codex-arbetssätt

### 22.1 Dokument före bred kodning

Codex ska först skapa och hålla aktuella:

- `docs/architecture.md`
- `docs/domain-rules.md`
- `docs/offline-sync.md`
- `docs/sportident.md`
- `docs/map-and-route-model.md`
- `docs/acceptance-tests.md`
- `docs/status.md`
- ADR-filer för större beslut.

### 22.2 Små vertikala steg

Varje uppgift ska:

1. beskriva en användbar vertikal funktion,
2. ange vilka filer som får ändras,
3. lägga till tester,
4. köra typkontroll, lint och relevanta tester,
5. redovisa migrationer och risker,
6. inte påbörja orelaterade moduler.

### 22.3 Agentfördelning

Praktisk fördelning i Codex:

- **Terra:** arkitektur, domänmodell, uppgiftsnedbrytning och slutgranskning.
- **Luna:** formulär, vyer, fixtures, dokumentation och raka tester.
- **Sol:** SPORTident-protokoll, offline-synk, georeferering, svåra databas- och konkurrensproblem.

Låt inte två parallella agenter ändra samma databasschema eller resultatmotor utan en gemensam, redan mergad ADR.

### 22.4 Definition of done

En funktion är inte klar förrän:

- användarflödet fungerar,
- fel- och offlineläge är beskrivet,
- automatiska tester finns,
- loggning och audit är rimlig,
- tillgänglighet på mobil är kontrollerad,
- dokumentationen är uppdaterad,
- inga tests eller typkontroller är röda,
- Codex redovisar vad som inte kunde verifieras på riktig hårdvara.

## 23. Första målbilden

Det första verkliga fälttestet ska vara en liten Centrum OK-träning eller klubbtävling:

- 30–100 deltagare,
- en eller två banor,
- en Androidplatta,
- en BSM8/miniReader,
- en separat mobil som reserv,
- internet som avsiktligt stängs av under delar av testet,
- parallell MeOS-körning endast som kontrollfacit,
- jämförelse av samtliga råavläsningar och resultat efteråt.

Systemet ska inte användas som enda officiella tidtagning på en större tävling innan detta test upprepats med flera korttyper, nätbortfall och återställning.

## 24. Produktprioritering från användaren, 2026-09-08

Tävlingssystemet ska minst motsvara MeOS orienteringsfunktioner. Detta är ett
utökat produktmål, inte ett påstående om uppnådd paritet eller tillstånd att
kopiera AGPL-kod. Kartlägg funktionerna mot självständiga användarflöden och
verifierbar acceptans; okända eller saknade funktioner ska framgå. Senare
funktioner byggs som egna snitt, aldrig som en dold utvidgning av TASK001.

Prioritera användbara tävlingsflöden framför ytterligare perifer test- och
driftinfrastruktur. Testa i proportion till ändringens risk: fokuserade
regressionsprov under arbetet, bred verifiering vid en samlad leverans eller
ändringar över flera lager. Rådata, idempotens, offlinekö och behörighetsgränser
får inte försvagas för att minska testmängden.

Gränssnittet ska vara tydligt och informationstätt utan onödig vertikal scroll.
På dator: kompakta tabeller, sammanfattningar och arbetsområden med relevanta
åtgärder nära innehållet. På mobil: bibehåll läsbarhet och stora tryckytor;
försök inte få plats genom mikroskopisk text. Kritiska varningar och osäker
offlineinformation ska förbli synliga. Första prioritet är en mer sammanhållen
tävlingsöversikt utifrån befintliga funktioner, inte fler tekniska prov.
