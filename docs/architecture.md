# Arkitektur för O-Tid

## Status och omfattning

Detta dokument beskriver den arkitektur som gäller från TASK 001. Systemet är en
modulär monolit med separata körbara skal. TASK 001 omfattar endast individuell
tävling, IOF-import, simulerad avläsning, resultat och offentlig visning.

## Körbara delar

- `apps/web`: Next.js som vanlig Node-process. Innehåller arrangörs- och
  publikgränssnitt samt HTTP-API.
- `apps/worker`: placeholder som kör ur samma kodbas och delar databaslager. Inga
  bakgrundsjobb behövs i TASK 001.
- `apps/station`: minimalt Capacitor-skal för Androidstationen. Dess native
  `:otid-usb-serial`-modul transporterar endast råbytes och importeras inte av
  webb-, domän- eller databaslagret.
- PostgreSQL med PostGIS: auktoritativ lagring.
- Privat MinIO: objektlagring. I TASK 001 lagras IOF-originalet i PostgreSQL för
  att importen ska kunna vara atomär; MinIO finns i driftmiljön men används inte
  ännu.

## Paket och beroenderiktning

```text
apps/web, apps/worker
        |       |
        v       v
 packages/application ----> packages/database
        |                         |
        v                         v
 packages/domain          packages/contracts
        ^
        |
 packages/iof-xml
```

- `packages/domain` är ren strikt TypeScript utan I/O eller ramverksberoenden.
- `packages/contracts` äger validerade HTTP-kontrakt.
- `packages/iof-xml` tolkar extern IOF XML till interna importförslag. Paketet
  skriver aldrig till databas.
- `packages/database` äger Drizzle-schema, migrationer och PostgreSQL-adapter.
- `packages/application` orkestrerar transaktioner, import, ingest, audit och
  omräkning. Resultatregler delegeras alltid till `packages/domain`.

Inga importer får peka från domänpaketet mot de övriga lagren.

## Flöden i TASK 001

### Import

1. HTTP-lagret validerar filtyp och grundkontrakt.
2. IOF-adaptern tolkar hela dokumentet till ett internt förslag.
3. Applikationstjänsten öppnar en PostgreSQL-transaktion.
4. Originalfil, importrapport och mappade objekt sparas tillsammans.
5. Vid validerings- eller databasfel rullas hela transaktionen tillbaka.

Återimport identifieras med SHA-256 inom lopp och importtyp. Samma fil ger samma
importpost och inga nya domänobjekt.

### Simulerad avläsning

1. Simulatorn skapar ett lokalt beständigt `deviceId`, ett ökande sekvensnummer
   och en rå JSON-payload.
2. Simulatorn anropar samma HTTP-ingest som framtida stationsklienter.
3. Servern verifierar batchens hash och behandlar varje händelse i en transaktion.
4. `raw_device_message` infogas först, följt av normaliserad avläsning och
   resultatrevision.
5. Konflikt på `(device_id, local_sequence)` med samma hash kvitteras som redan
   lagrad. Annan hash avvisas.

Resultatutvärdering håller ett delat radlås på loppet medan dess sammanhängande
snapshot läses. Revisioner för samma deltagare serialiseras med deltagarradens
radlås. Import och klassändring tar lopplåset exklusivt före deltagarlås, så
samtliga flöden följer `race -> entry -> revision` och undviker korsande
låsordning. Se ADR-0010.

### Resultat och publik

Resultatmotorn tar en normaliserad avläsning och en explicit `RaceSnapshot`.
Applikationstjänsten sparar utfallet append-only. Publikfrågan väljer senaste
publicerade revision per deltagare. TASK001 använder dokumenterad polling var
femte sekund. TASK129 tillför en separat, hållbar och race-scopad SSE-wake-up
för den befintliga publika snapshoten; den är inte en andra resultatläsning
och polling är fortsatt reserv. Se ADR-0004 och ADR-0135.

## Säkerhets- och integritetsgränser

- Publikvyn kräver inget konto men läser bara publicerade resultatfält.
- Arrangörs-API saknar full autentisering i TASK 001 och får därför inte exponeras
  som produktionstjänst.
- MinIO-buckets skapas privata. Åtkomstnycklar finns endast i miljövariabler.
- Råmeddelanden uppdateras eller raderas inte via applikations-API.

## Drift och fel

Docker Compose beskriver TASK 001:s lokala datatjänster PostGIS och privat MinIO.
Webb och worker körs lokalt via pnpm tills deras containerbilder behandlas i ett
eget driftvertikalt snitt. Databasmigrationer körs explicit före start. Ett
ingest-svar är en kvittens endast för rader som redan är committade. Om servern
är otillgänglig behåller simulatorn sin payload lokalt så att samma sekvens kan
skickas igen.

Se ADR-0001, ADR-0002, ADR-0003, ADR-0004 och ADR-0005.

## TASK 002A: transport och capture

Det första SPORTident-steget lägger till en strikt rådatakedja utan parser:

```text
WebSerial/Android-kontrakt ─┐
NodeSerial-adapter ─────────┼─> ByteTransport ─> capture/WAL ─> ReplayTransport
                            └─> inga protokoll- eller domänobjekt
```

Det återanvändbara transportpaketet importerar inte native Node-moduler.
Desktop-CLI och native serieportsberoende ligger i ett separat appskal. Capture
är privat och checksummekontrollerat. Se ADR-0006.

## TASK 002B: Androids råtransport

Androidkedjan följer samma transportgräns utan protokolltolkning:

```text
apps/station TypeScript
        |
        v
Capacitor wire-plugin
        |
        v
RawUsbController -> Mik3yUsbSerialBackend -> Android USB host
        |
        v
globala, ordnade raw-byte/state-events -> AndroidUsbTransport
```

Capacitor-pluginen mappar endast validerad JSON. Controllern äger en aktiv
anslutning, FIFO-writes, explicit timeout, generation, cleanup och en begränsad
eventkö. Endast `Mik3yUsbSerialBackend` känner till
`usb-serial-for-android`. Reader och writer kör utanför UI-tråden och råbytes
kopieras vid varje ägargräns. Inga enhetsserienummer, råbytes eller
exceptiondetaljer loggas.

Androidprojektet är en separat buildgräns med Gradle dependency locks och
strict checksum verification. JVM-test, Android lint och APK-assemble bevisar
nativekodens kontrakt och byggbarhet, inte fysisk USB eller SPORTident-stöd. Se
ADR-0008 och ADR-0009.

## TASK 004: multi-station-ingest

Device-batch-API:t använder ett delat, runtimevaliderat kontrakt för både server
och simulator. Varje kvittens binder status till device, lokal sekvens och
innehållshash samt anger serverns aktuella paketversion. Gammal eller oväntat ny
paketversion stoppar inte rådatamottagning; svaret skiljer `stale`, `current` och
`ahead`, medan serverresultatet alltid märks med den snapshotversion som faktiskt
användes.

Flera ingests kan läsa samma race-snapshot parallellt. Endast revisioner för
samma deltagare serialiseras. En `stored`/`duplicate`-kvittens lämnas efter
commit; okänd commitstatus vid systemfel förvandlas inte till ett falskt
per-event-avslag. Snittet kräver ingen migration och bygger ännu inte den lokala
SQLite-/IndexedDB-kön. Se ADR-0010.

## TASK 005A: signerat paket och beständig stationskärna

Serverns paketbyggare tar samma delade lopplås som resultatberäkningen, läser en
sammanhängande `RaceSnapshot`, sorterar samlingar deterministiskt och signerar
canonical UTF-8-JSON med en miljöinläst RSA-nyckel. Det privata HTTP-skalet är
avstängt utan både signing key och stationstoken och sätter `no-store`; detta är
en bootstrapgräns, inte den slutliga enhetsparningen.

```text
PostgreSQL snapshot --RS256--> privat package route
                                      |
                              betrodd SPKI separat
                                      v
Capacitor TS --------> OtidStationStore --------> app-privat SQLite
                           |                          |-- package history
                           | verifierar signatur      |-- active package
                           | före lagring             |-- device identity
                           `--------------------------|-- append-only outbox
```

Native lagring ligger i `:otid-station-store`, helt separat från
`:otid-usb-serial`. Paketinstallation, sekvensallokering + enqueue och
kvittensapplicering är atomiska SQLite-transaktioner. Gamla paket, kvitterade
händelser och avvisningar behålls. Databasen använder foreign keys, WAL och
`synchronous=FULL` och undantas från Android backup/device transfer. Se ADR-0011.

## TASK 005B: lokal resultatmotor och operativ station

Stationens browserbundle importerar den rena motorn direkt från
`packages/domain`; den importerar aldrig serverns `packages/application`.
Aktivt pakets verifierade payload läses tillbaka genom native lagret och
runtimevalideras innan dess `RaceSnapshot` används.

```text
SQLite active payload --hashkontroll--> station runtime
                                           |
simulatornormaliserad readout --------------+--> packages/domain
                                                      |
                                           EvaluationResult
                                                      |
                                      append-only local_evaluation
                                                      |
                                             operatörsbesked/status
```

Outboxposten committas före evaluering så att ett motorfel aldrig kan förlora
den normaliserade händelsen. Exakt motorversionsmatchning krävs för lokalt
besked. Utfallet är informativt och versionsmärkt; serverns append-only-
resultatrevision är fortsatt auktoritativ. En minimal `esbuild`-bundle gör
Capacitors statiska `www` körbart utan nytt UI-ramverk. Se ADR-0012.

## TASK 005C: beständig stationssynk

Varje accepterat serverevent får nu också ett append-only `device_ingest_outcome`
i samma PostgreSQL-transaktion. Det bevarar den första centrala bedömningen för
retry även när ingen `ResultRevision` skapas, exempelvis för `UNKNOWN_CARD`.
Bedömningen binds till en canonical `evaluationHash` över hela domänutfallet.

```text
SQLite pending --Capacitor native HTTP--> device-batch API
      |                                      |
      |                              raw + readout + outcome
      |                                      |
      `-- receipt + ack observation <--------'
                    |
          local evaluation + central hash
                    |
        härledd versionsmedveten UI-jämförelse
```

Stationen skickar ett event per request, validerar en exakt svarsbijection och
committar receipt, observation och outboxövergång atomiskt. Endast explicita
eventkvittensposter påverkar kön. SQLite-observationer och serverutfall är
append-only; jämförelsestatus härleds och lagras inte. Se ADR-0013.

## TASK 005D: device-bunden stationsautentisering

Servern skiljer nu den stationsrapporterade identiteten från en intern
`station_device` och en append-only credentialhistorik. Varje credential är
bunden till exakt lopp, device och funktionen `READOUT`; revocation är en egen
append-only rad. Ingestens befintliga idempotensnyckel ändras inte.

```text
betrodd CLI --> station_device + credential hash + audit
                       |
Android Keystore --> native authenticated request
                       |
               server-only auth/authz
                       |
                 device-batch ingest
```

Routebarriären verifierar credentialen före bodyparsning och mutation. Samma
modell skyddar privat stationspaketdownload. Servern lagrar aldrig plaintext och
Android lämnar inte ut installerad token via plugin-API. Den krypterade filen är
separat från SQLite v3 och ligger i `noBackupFilesDir`. Se ADR-0014.

## TASK 005E: kortlivad engångsparning

Ett append-only `station_pairing_grant` utfärdas av en betrodd CLI för exakt
lopp och `READOUT`. Grantets bearer-secret lagras endast hashad, gäller högst
15 minuter och kan spärras innan inlösen. PostgreSQL-baserade attempt- och
redemptionrader ger rate limit, engångsbarriär och audit över flera webbprocesser.

```text
betrodd CLI --> kortlivat pairing grant
                         |
Android Keystore --> krypterat pending attempt före HTTP
                         | device + attempt + credential hash
                         v
                  pairing redemption
                         |
               credential-id + metadata
                         v
             native credentialinstallation
```

Credential-secret genereras av Android och skickas aldrig till servern;
servern lagrar endast dess SHA-256-hash. Exakt samma pendingattempt kan därför
retryas efter tappat svar och få samma metadata utan ny credential eller
återläsbar serversecret. Pendinghemligheter ersätts först efter lyckad
installation av en icke-hemlig completed-markör.
SQLite, outbox, resultatmotor och ingest-idempotens ändras inte. Se ADR-0015.

## TASK 005F: autentiserad pairingadministration

En CLI-provisionerad accesscredential är bunden till exakt race och capabilityn
`PAIR_STATION`. Den skapar en kort serverlagrad session med HttpOnly-cookie och
sessionbunden CSRF-cookie. Session, accesscredential och deras revocations är
append-only; varje mutation kontrollerar race/capability igen under sessionslås.

```text
betrodd CLI --> racebunden accesscredential (hash only)
                         |
                    kort session
                         | Origin + CSRF + race/capability
Web Crypto --> grant-id + secret-hash --> admin issue
     |                                      |
     `--> one-shot pairingtoken       metadata + actor audit
```

Webbläsaren äger pairingsecretens enda plaintext och servern bestämmer
`READOUT`, tio minuters granttid och credentialexpiry. Samma grant-id, hash,
actor och race är idempotent; en annan kontext ger konflikt. Privata list- och
revokeroutes exponerar endast metadata. Denna gräns skyddar pairingadmin, inte
de äldre öppna TASK 001-adminfunktionerna. Se ADR-0016.

## TASK 005G: capability-separerad IOF-importadministration

TASK 005F:s hash-only credential- och sessionsmekanism blir ett delat, smalt
raceadministrativt säkerhetssubstrat med två separata capabilities. De fysiska
`pairing_admin_*`-tabellnamnen behålls för migrationssäkerhet, men tokenprefix,
cookies och race-scopade sessionsroutes skiljer `PAIR_STATION` från
`IMPORT_IOF`. Det är inte en generell användar- eller rollmodell.

```text
IMPORT_IOF credential --> race-scopad session --> auth före body
                                                   |
                                   begränsad application/xml + request-UUID
                                                   |
                                     IOF-parse utanför databaslås
                                                   |
                         session -> credential -> race -> domänmutation
                                                   |
                         import_file + import_request + actor-audit atomärt
```

Importbody är exakt 1–5 000 000 faktiska bytes och strikt UTF-8. Servern
beräknar SHA-256 själv. DTD, DOCTYPE och ENTITY avvisas före parsning och
entitybehandling är avstängd. Ett append-only `iof_import_request` binder ett
canonical request-UUID till actorcredential, race, serverhash, importfil och
ursprungligt utfall. Exakt retry ger samma metadata; ändrad kontext ger konflikt
och samma innehåll under nytt request-id ger en duplicate-rad utan ny
domänmutation eller mutationsaudit.

Första authkontrollen sker före en bodybyte läses. Efter parsning kontrolleras
samma session och credential igen under radlås innan race låses exklusivt.
Endast den första lagringen appenderar en actor-bunden auditpost. Den separata
importsidan håller credential, fil, hash och request-id endast i minnet och
återanvänder exakt request-id endast efter ett uttryckligt retrybeslut.

Snittet skyddar endast IOF CourseData-/EntryList-import. Tävlingsskapande,
klassändring, omräkning, read-only admin och övriga utvecklingsytor får inte
beskrivas som produktionsautentiserade. Se ADR-0017.

## TASK 005H: capability-separerad klassadministration

Samma racebundna hash-only säkerhetssubstrat får en tredje, smal capability:
`CHANGE_ENTRY_CLASS`. Den använder eget credentialprefix, egna cookies och en
egen race-scopad sessionyta. Klassadminsidans serverrenderade shell innehåller
inga deltagaruppgifter; ett separat privat GET-anrop lämnar först efter auth det
minimala klassunderlaget med aktuell entry-version.

```text
CHANGE_ENTRY_CLASS credential --> kort separat session --> privat klassunderlag
                                                            |
React-minne: request-id + expected entry-version -----------+
                                                            |
                         auth före begränsad strikt JSON-body
                                                            |
 session -> credential -> race -> request advisory -> entry
                                                            |
       entry + snapshot + requestjournal + actor-audit atomärt
```

`expectedEntryVersion` skyddar operatörens observerade avsikt mot stale
overwrite. Ett append-only `entry_class_change_request` skyddar retry efter
okänd commit. Exakt retry läses före aktuell entrystate och kan därför återge
det ursprungliga utfallet även efter senare klassändringar. No-op och stale
requests avvisas utan versionschurn.

Klassändringen följer fortsatt `race -> entry -> revision`-låsriktningen men
skapar ingen resultatrevision. Explicit omräkning, tävlingsskapande, simulator
och generell read-only-admin är fortsatt separata utvecklingsytor och får inte
presenteras som skyddade av klasscapabilityn. Se ADR-0018.

## TASK 005I: capability-separerad explicit resultatomräkning

Säkerhetssubstratet får capabilityn `RECALCULATE_RESULT` med eget prefix,
cookies och race-scopad session. En privat kandidatyta lämnar efter auth endast
den metadata som krävs för att frysa operatörens observerade beräkningsgrund.

```text
RECALCULATE_RESULT credential --> kort separat session --> privat kandidat-DTO
                                                               |
entry/class/snapshot/assignment/readout/revision/engine intent --+
                                                               |
                         auth före begränsad strikt JSON-body
                                                               |
 session -> credential -> race SHARE -> request advisory -> entry UPDATE
                                                               |
       immutable ResultRevision + requestjournal + actor-audit atomärt
```

Ingest och omräkning delar `race SHARE -> entry UPDATE`, vilket ger obrutna
revisionsnummer. Import och klassändring tar `race UPDATE`; omräkning ser därför
en hel snapshot före eller efter mutationen. Exact replay läses före aktuell
entry-/resultatstatus och återger den ursprungliga revisionen utan ny write.

Den nya ytan använder revisionsorsaken `EXPLICIT_RECALCULATION`. Resultatmotorn,
klass, entry-/snapshotversion, assignment, rawdata och card readout ändras inte.
Tävlingsskapande, simulator och generell read-only-admin är fortsatt separata
utvecklingsytor. Se ADR-0019.

TASK091:s klassbundna gruppkommando får inte bestå av N anrop till
denna route. Det använder samma semantik men låser en explicit, hashad
klassmanifestgrund i en all-or-nothing-transaction: race `SHARE`, därefter
valda Entries i canonical UUID-ordning. En immutable gruppheader med items
ger exakt retry medan varje skapad ResultRevision behåller egen Entry-grund.
En ändrad eller stale itemgrund avvisar hela committen före write. Se ADR-0109.

## TASK 005J: capability-separerad PII-fri tävlingsöversikt

Säkerhetssubstratet får den separata read-only-capabilityn
`VIEW_RACE_OVERVIEW`. Den generella adminsidan serverrenderar endast ett privat
shell och hämtar efter login en strikt SQL-projicerad översikt utan individ-,
brick-, raw-, evaluation- eller importinnehåll.

```text
VIEW_RACE_OVERVIEW credential --> kort separat session
                                      |
                       session SHARE -> credential SHARE
                                      |
                              race SHARE
                                      |
              struktur + count/max, aldrig individrader
                                      |
                      strikt privat overview-DTO
```

Logout och credentialrevocation tar UPDATE-lås i samma ordning. Därmed finns
ingen auth→dataläsningslucka: revoke som vinner lämnar ingen data, medan en
redan låst auktoriserad läsning får slutföras. GET gör inga writes.

Den publika resultatsidan använder en separat minimal `publicRaceSummary` och
överläser inte längre den privata adminprojektionen. Simulatorn tas bort från
overviewytan eftersom station/ingest är en annan trust domain. Övriga
admincapabilities, tävlingsskapande och generell arrangörsidentitet är fortsatt
separata. Se ADR-0020.

TASK089 lägger en racebunden `publicResultId` på den redan publika
resultatraden. Den oinloggade detaljsidan tar både lopp och opaque identitet,
återanvänder exakt den validerade publika raden och returnerar 404 utan data för
okänd/felscopad/opublicerad rad. Den ersätter varken Entry-id, importidentitet
eller behörighet och ger inte åtkomst till rådata. Se ADR-0108.

TASK152:s personliga ingång ligger **ovanpå** denna publika resultatkälla, inte
i en ny resultatmotor. `user_account` autentiserar kontot; en separat
engångskodsjournal binder därefter kontot till exakt race-/entry-id efter
operatörsattesterad privat överlämning. Endast kodhash lagras. Issue, redeem
och revoke serialiserar på samma entry-rad och bevarar immutable historik.
Kontobunden läsning resolverar aktiva kopplingar server-side och väljer enbart
V7-rader från den befintliga validerade offentliga resultatprojektionen.
Opublicerat resultat ger vänteläge, inte privat resultatutdrag. Denna länk
ger ingen GPS-, rutt-, karta- eller adminrätt. Se ADR-0146;
kontoinbjudan/återställning ligger i separata A3-snitt (TASK159–161), som
ännu inte har verklig kodöverlämnings- eller fältacceptans.

TASK153 lägger en separat kontobunden följjournal bredvid TASK152:s
ägarkoppling. Endast ett just nu publicerat `raceId` + `publicResultId` kan
nyföljas. Account-session och CSRF skyddar mutation; kontoradlås ordnar
samtidiga följ/avfölj-kommandon, och senaste immutable journalhändelsen anger
aktivt val. Den privata läsaren resolverar åter varje valt par genom aktuell
offentlig V7-projektion; när raden försvinner finns ingen gammal resultat-DTO
kvar i svaret. Public endpoint, resultatrevision, B1-claim och anonym lokal
favoritlista ändras inte. Se ADR-0147 och TASK153.

## TASK 005K: separat icke-racebundet bootstrapflöde

Tävlingsskapande sker innan ett race-id finns och kan därför inte använda de
racebundna `pairing_admin_*`-credentials utan att deras domängräns försvagas.
TASK 005K inför ett separat append-only säkerhetssubstrat vars enda capability
är global `CREATE_EVENT`. Det ger ingen rätt till befintliga event eller race
och är inte en generell arrangörsroll.

`POST /api/events` blir den enda skyddade create-mutationsvägen. En transaktion
låser event-creation-session och credential, serialiserar ett canonical
request-id och skapar event, första individuella lopp, requestjournal och
racebunden auditpost atomiskt. Journalen binder aktör, hela normaliserade
intentet och interna IDs; exakt replay returnerar samma svar medan ändrad aktör
eller intent ger konflikt.

Det separata `/admin/events/new`-shellet håller credential och okänd commit i
React-minne. Publika `/` listar fortsatt endast publik rubrikmetadata och sätter
inga admincookies. Se ADR-0021.

## TASK 005L: fail-closed lokal utvecklingssimulator

Webbsimulatorn förblir en adapter ovanpå samma autentiserade, idempotenta
device-batch-ingest som stationen, men dess browsersida är inte en
produktionsfunktion. Serverkomponenten tillämpar därför en ren server-only-
policy före routeparametrar, racevalidering och PostgreSQL.

```text
development + explicit loopback-development mode
  + canonical HTTP-loopback-origin
  + matchande enkel requestauthority
                    |
              simulatorpage
                    |
        minimal snapshot_version-fråga
                    |
       befintlig credentialskyddad ingest

alla andra kombinationer --> generisk 404 --> ingen DB, ingen hydrering
```

Produktion och test är ovillkorligt avstängda. Den lokala devservern binds till
`127.0.0.1`; Host-/forwardedkontroll är endast försvar på djupet och ersätter
inte denna driftregel. `allowedDevOrigins` betraktas inte som åtkomstkontroll.

Grinden ändrar inte stationscredential, station-package, device-batch,
simulatorpayloadens nuvarande transportfält, rawdata, resultatrevision eller
offlinekö. En framtida fjärrsimulator kräver separat capability-, audit- och
ADR-beslut. Se ADR-0022.

## TASK 005M: begränsad device-batch-ingress

Device-batch-routen behåller samma application-usecase men får en explicit
webbadaptergräns före JSON- och schemavalidering:

```text
Bearer -> race/READOUT-scope -> 4 MiB faktisk stream
                                  | exact application/json
                                  | fatal UTF-8
                                  | strict batch/event/payload/punch
                                  v
                       device + idempotency key
                                  |
                       befintlig idempotent ingest
```

401 och cross-race/scope-403 sker utan body-pull. Deklarerad storlek är endast
en tidig kontroll; faktisk stream räknas alltid och cancelas vid overflow.
Serverkuvertet är 4 MiB för att rymma det delade 100×256-kontraktet, medan
Androids avsiktliga single-event-policy förblir 512 KiB.

Body-/schemafel är detaljfria och skapar inga raw-, readout-, outcome- eller
revisionsrader. `stored`/`duplicate`, kvittens och transaktionsgräns är
oförändrade. Reverse-proxy-buffering och rate-limit ligger utanför
applikationsgränsen. Se ADR-0023.

## TASK 005N: capability-separerad avläsnings- och resultathistorik

Den privata individhistoriken får den separata read-only-capabilityn
`VIEW_READOUT_RESULT_HISTORY`. Den PII-fria overviewytan och
omräkningscapabilityn breddas inte.

```text
VIEW_READOUT_RESULT_HISTORY credential --> separat kort session
                                                |
                           session SHARE -> credential SHARE
                                                |
                                           race SHARE
                                                |
                   bounded readout-feed -- valt readout-id
                                                |
                      normalized readout + fryst revisionsvattenmärke
                                                |
                         bounded immutable revisionshistorik
```

Varje GET kör read-only repeatable read och väljer endast explicit tillåtna
kolumner. Keysetcursor används för feeden; detaljcursorn fryser högsta
revisionsnummer så senare append inte förändrar pågående historiepaginering.
Okänd bricka får tom historik och äldre data utan bevarat ingestutfall får null,
aldrig fabricerad bedömning.

Raw-, device-, hash-, import-, externa id-, auth- och auditfält ingår inte.
Browsern får bara statiskt shell före login och lagrar inte credential/DTO i URL
eller Web Storage. GET gör inga writes och påverkar inte ingest, snapshot,
resultatmotor eller publikresultat. Se ADR-0024.

## TASK 006A: atomär IOF StartList-import

Den befintliga `IMPORT_IOF`-kedjan utökas vid samma adaptergräns:

```text
IOF 3.0 StartList bytes -> strikt single-race/individual-parser
                                  |
                         EntryId + Class.Id
                                  |
 session SHARE -> credential SHARE -> race UPDATE -> full DB-validering
                                  |
               class FIXED + entry fixed_start_time/version
                                  |
                    race snapshot + 1 vid faktisk delta
```

Namn används inte för matchning. Varje refererad klass måste ha full coverage,
och team/multi-race avvisas. Alla DB-referenser valideras innan första
domänwrite, så okänd/duplicerad entry, klasskonflikt eller ogiltig tid lämnar
loppet oförändrat.

`IMPORT_IOF` skapar aldrig resultatrevisioner. Tidigare revisioner behåller sitt
historiska snapshot; rapporten markerar entries som kan behöva en separat,
explicit `RECALCULATE_RESULT`. `CourseData` och `EntryList` får inte senare
radera startregel eller starttid eftersom de filtyperna inte bär dessa fakta.
Se ADR-0025.

## TASK 006B: capability-separerad IOF ResultList-export

Den privata exporten får en egen read-only-capability och en ren IOF-adapter:

```text
EXPORT_IOF_RESULT_LIST credential -> separat kort session
                                           |
                  session SHARE -> credential SHARE -> race SHARE
                                           |
                   repeatable-read senaste published per entry
                                           |
            revisionens class/course/evaluation + aktuell displaydata
                                           |
                   deterministisk IOF 3.0 ResultList Snapshot
```

Projektionen använder revisionens historiska klass och bana, aldrig entryts
aktuella klasskoppling. Äldre snapshotrevisioner inkluderas men räknas för en
operatörsvarning; endast en explicit omräkning får ersätta dem med en ny
revision. En nyare opublicerad revision får inte skymma senaste publicerade.

Serializeraren är I/O-fri, avvisar motsägande data och skriver endast det
dokumenterade individuella single-race-subsetet. Den fabricerar inte DNS/DNF,
placering eller interna externa identiteter. GET är privat, bounded och helt
skrivfri. Se ADR-0026.

## TASK 006C: en domänranking för publikresultat och IOF-export

Ranking läggs inte i SQL, React eller XML-adaptern. Den rena domänfunktionen tar
en redan vald historisk klassmängd och returnerar competition ranking samt tid
efter ledaren:

```text
latest published revision per entry
              |
 revisionens historiska class/course/status/time
              |
       packages/domain class ranking
              |
       +------+------------------+
       |                         |
strikt publik DTO       IOF ResultList-projektion
utan interna id:n       TimeBehind -> Position -> Status
```

Endast OK rankas. Exakt lika heltalsmillisekunder delar placering och
`timeBehindMs` räknas mot snabbaste OK i samma historiska klass. MP visas utan
ranking. Om klassens rankbara resultat använder flera banversioner utelämnas
ranking för hela klassen; adaptrarna får varken jämföra banorna eller skapa
dolda grupper.

Publikresultat får ett runtimevaliderat versionerat kontrakt i stället för att
returnera databasrader och full evaluation. Exportens capability, transaktion,
låsordning och skrivfrihet ändras inte. Ingen migration krävs. Se ADR-0027.

## TASK 006D: immutable klass- och loppsfinalisering

Finalisering är ett separat append-only verksamhetsbeslut ovanpå
resultatrevisionerna. Den befintliga liveexporten ändrar inte betydelse:

```text
FINALIZE_RESULTS credential -> separat kort write-session
                                    |
       session UPDATE -> credential UPDATE -> race UPDATE -> request lock
                                    |
                full current class basis + domain ranking
                                    |
          CLASS frozen projection + canonical content hash
                                    |
      every non-empty current class has matching latest finalization
                                    |
        RACE frozen projection + exact IOF Complete XML + SHA-256

EXPORT_IOF_RESULT_LIST session -> live Snapshot OR exact stored Complete bytes
```

Klassfinalisering kräver att varje aktuell entry har en högsta publicerad,
strikt giltig `OK`/`MP`-revision för exakt aktuell race-snapshot, klass och bana.
Nyare opublicerad revision, saknad eller stale revision, mixed course och
korrupt historik blockerar. Loppsfinalisering räknar om varje klassgrund under
exklusivt lopplås, kräver hashmatchning mot senaste klassfinalisering och
avvisar olösta okända avläsningar. Ingen frånvarostatus fabriceras.

En enda `result_finalization`-tabell bär `CLASS | RACE`, scope-lokal revision,
request/actor, source hash och en strikt hashbunden JSON-projektion. Race-raden
kopierar klassunderlagen och lagrar dessutom exakt XML-text. Därmed kan varken
senare child-insert, displaydata, course controls eller serializerarkod ändra
ett historiskt `Complete`.

IOF-adaptern accepterar explicit `Snapshot | Complete`, men `Complete` kräver
ett internt runtimevaliderat finaliseringsbevis. Den räknar aldrig täckning.
Finaliseringscapabilityn får inte exportera generellt och exportcapabilityn får
inte finalisera. Stationens paket-, ingest- och offlinegränser påverkas inte.
Se ADR-0028.

## TASK 006E: explicit individuellt ej-startbeslut

Ej start blir en separat manuell källtyp ovanpå den befintliga append-only-
resultathistoriken. Kortmotorn och stationens lokala kontrakt producerar fortsatt
endast kortbaserade bedömningar:

```text
DECIDE_DID_NOT_START credential -> separat kort write-session
                                      |
          fryst entry/class/course/snapshot + tomt revisionshuvud
                                      |
      did_not_start_decision ---------+----> result_revision DNS
             immutable                         readout_id = null
                                      |
                            actor/request audit
                                      |
                  publik + Snapshot + finalisering
```

`result_revision` får exakt en källreferens: befintliga orsaker kräver en riktig
`card_readout`, medan `MANUAL_DID_NOT_START` kräver en immutable
`did_not_start_decision`. Banversionen förblir obligatorisk provenans. SQL och
adaptrar läser en strikt lagrad `ResultOutcome`-union; stationens
`EvaluationResult` breddas inte.

Första policyn gäller endast en aktuell entry utan tidigare resultatrevision.
Den skapar ingen rawdata och härleder aldrig från frånvaro. En senare riktig
ingest appendar nästa revision. DNS är orankad, blir IOF `DidNotStart` med
status-only och får täcka en entry i en ny finalisering, men löser aldrig en
olöst okänd bricka. Stationens paket-, SQLite-, outbox- och kvittensgränser
påverkas inte. Se ADR-0029.

## TASK 006F: append-only återtagande av manuellt ej-startbeslut

Ett felaktigt manuellt DNS rättas med ett separat immutable livscykelbeslut,
inte genom att skriva om eller avpublicera den historiska resultatrevisionen:

```text
WITHDRAW_DID_NOT_START credential -> separat kort write-session
                                          |
      session UPDATE -> credential UPDATE -> race SHARE -> request lock
                                          |
                         entry UPDATE + exakt DNS-resultathuvud
                                          |
             did_not_start_withdrawal + actor/request audit
                                          |
            gemensam aktiv-resultat-overlay: NO_ACTIVE_RESULT
                         /              |              \
                    publik          Snapshot       finalisering
                   utelämna         utelämna          blockera
```

Återtagandet targetar exakt TASK 006E:s decision och skapade DNS-revision och
får endast committa medan den revisionen är entryns absoluta resultathuvud. Det
skapar ingen ny resultatrevision, status, rawpost, readout eller snapshotversion
och muterar aldrig originalets `published`-flagga. En senare riktig ingest
appendar nästa normala revision och blir då aktiv.

Levande projektioner väljer alltid sitt befintliga huvud först och applicerar
sedan den rena domänens withdrawal-overlay. De får aldrig anti-joina före
latest-urval och därmed återuppliva en äldre revision. Publikresultat och
Snapshot utelämnar ett återtaget DNS; aktuell finalisering blockerar med
`WITHDRAWN_DID_NOT_START`, medan äldre fryst Complete-XML förblir byte-exakt.
IOF-adaptern och stationens kontrakt får ingen ny status. Se ADR-0030.

## TASK 006G: manuell diskvalifikation och exakt restaurering

DSQ blir en separat manuell resultatkälla ovanpå den append-only tekniska
resultathistoriken. Den får inte tyst försvinna när senare offlineingest eller
omräkning appenderar underliggande revisioner:

```text
DISQUALIFY_RESULT credential -> exakt aktuellt publicerat OK/MP-head
                                      |
                    result_disqualification_decision
                                      |
                        result_revision DSQ (immutable)
                                      |
                   aktiv decision-overlay över senare ingest
                                      |
WITHDRAW_DISQUALIFICATION credential -> exakt senaste underliggande OK/MP
                                      |
                  immutable withdrawal + restoration revision
                                      |
                         normalt latest-head igen
```

Den rena domänen konstruerar DSQ genom att kopiera källresultatets entry,
historiska klass/bana, tider, kontrollutfall och splits och ändra endast
status/reason. Kortmotorn och stationens kontrakt breddas inte. Resultatrevision
för DSQ har null direkt readout och pekar på ett immutable decision vars exakta
targetrevision bär den fysiska grunden.

En central application-resolver väljer den frysta DSQ-revisionen så länge
beslutet saknar withdrawal, även om en senare teknisk revision har högre
nummer. Withdrawal binder ett observerat absolut huvud och en exakt senaste
giltig underliggande `OK`/`MP`-revision och appenderar en ny publicerad revision
som kopierar detta utfall. Den väljer aldrig en äldre revision genom generell
fallback.

Publik, Snapshot och nya Complete-dokument behandlar DSQ som orankad och mappar
den till IOF `Disqualified`; källans tider/splits får bevaras men Position och
TimeBehind förbjuds. Finaliseringsbasis omfattar både effektiv DSQ och absolut
underliggande head. Nya frysta projektioner använder format 2 medan historiskt
format 1 förblir läsbart och tidigare XML-bytes aldrig ändras. Se ADR-0031.

## TASK 006H: manuellt godkännande och exakt restaurering

Ett tidskomplett tekniskt MP kan manuellt valideras utan att kortmotorn,
rawdata eller kontrollfakta skrivs om:

```text
APPROVE_RESULT credential -> exakt aktuellt publicerat tidskomplett MP-head
                                      |
                         result_approval_decision
                                      |
                   result_revision OK/MANUAL_APPROVAL
                                      |
                  aktiv decision-overlay över senare ingest
                                      |
WITHDRAW_RESULT_APPROVAL credential -> exakt senaste tekniska OK/MP-källa
                                      |
                  immutable withdrawal + restoration revision
                                      |
                         normalt latest-head igen
```

Den rena domänen accepterar endast `MISSING_CONTROL` eller `WRONG_ORDER` med
giltig start, mål och totaltid. Den kopierar entry, historisk klass/bana,
elapsed, missing/extra-controls och splits exakt och ändrar endast
status/reason till `OK/MANUAL_APPROVAL`. Tidslösa MP-former kräver en framtida
separat manuell tidsfunktion och avvisas här.

En central resolver håller approval aktivt över senare tekniska revisioner så
att offlineingest aldrig tyst skriver över åtgärden. Withdrawal binder
observerat absolut huvud och exakt senaste giltiga tekniska `OK`/`MP`, och
appenderar en revision som canonicalt kopierar källutfallet. Aktiv approval och
aktiv DSQ får inte samexistera.

Approval rankas som OK med källans tid. Publik, historik och finalisering får
format 3. IOF mappar till `OK`; ett icke-serialiserat runtimevaliderat
`manualApprovalProof` krävs när en manuellt godkänd projektion saknar split för
en förväntad kontroll. Då skrivs `SplitTime status="Missing"` utan fabricerad
tid. Historiska format och frysta XML-bytes ändras inte. Se ADR-0032.

## TASK 006I: explicit DNF som permanent manuell overlay

DNF är ett separat manuellt status-only-resultat. Det härleds aldrig från
frånvaro, en saknad avläsning eller kortmotorns `MP`:

```text
DECIDE_DID_NOT_FINISH credential -> exakt aktuellt publicerat tekniskt OK/MP
                                      |
                         did_not_finish_decision
                                      |
                result_revision DNF/DID_NOT_FINISH
                                      |
              permanent aktiv overlay över senare ingest
```

Det manuella beslutet är verksamhetsfaktumet; targeten är immutable
granskningsprovenans. DNF-resultatet bär endast entry-, historisk klass- och
banidentitet och saknar start, mål, elapsed, kontroller och splits. Därmed
kopieras varken targetens eventuella tekniska finish eller fabricerade tider.
Kortmotor, station och ingestkontrakt ändras inte.

En gemensam entry-låst application-grind gör aktiva DNS-, DSQ-, approval- och
DNF-tillstånd ömsesidigt uteslutande och failar stängt på korrupt/dubbelaktiv
provenans. Samma grind används av alla manuella writers och den centrala
resultathuvudresolven. Den rättar samtidigt den tidigare asymmetrin mellan
approval- och DSQ-writers.

Senare offlineingest får appendera rawdata, readout och teknisk revision, men
den effektiva projektionen förblir den frysta DNF-revisionen. TASK 006I har
inget withdrawal; rättning kräver ett senare explicit append-only-snitt.

DNF är orankad. Publik, historik och finalisering får format 4. IOF mappar till
`DidNotFinish` med endast `Status`; inga tider, rankingfält, splits eller
interna beslut serialiseras. Finaliseringsbasis fryser decision, target,
effektiv DNF och absolut underliggande head så att senare teknik kräver ny
finalisering utan att historiska bytes ändras. Se ADR-0033.

## TASK 006J: append-only DNF-återtagande med exakt restaurering

Ett felaktigt DNF avslutas med en separat immutable livscykeljournal och en ny
resultatrevision, aldrig genom update/delete eller historisk fallback:

```text
WITHDRAW_DID_NOT_FINISH credential -> exakt aktiv decision + DNF-revision
                                      |
                     fryst absolut head + exakt teknisk OK/MP-källa
                                      |
                         did_not_finish_withdrawal
                                      |
         result_revision MANUAL_DID_NOT_FINISH_WITHDRAWAL (OK/MP)
                                      |
                         normalt latest-head igen
```

Utan senare teknik är det absoluta huvudet DNF-revisionen och
restaureringskällan det ursprungliga tekniska targetet. Om senare ingest eller
omräkning finns måste absolut huvud självt vara den direkta, publicerade och
strikta tekniska `OK|MP`-källan. Servern söker aldrig bakåt och väljer aldrig om
källan efter att intentet frysts.

Restaureringsrevisionens outcome är canonicalt exakt lika med källans. Den har
null direkt readout och explicit withdrawalprovenans; decision, DNF-revision,
källrevisioner, rawdata och snapshot förblir immutable. Därefter väljer
ordinarie latest-head restorationen eller en senare teknisk revision.

Den centrala entry-låsta resolvern validerar samtliga historiska DNF-kedjor och
tillåter högst en aktiv. Migration 0019 ersätter därför 0018:s uttryckligen
tillfälliga livstidsunika entry-index med en icke-unik uppslagsindex. Ett nytt
DNF kräver ändå en senare ny direkt teknisk revision; restorationen är inte ett
tillåtet target.

Publikresultat stannar på format 4 och IOF får ingen ny status eller intern
provenans. Historik och nya finaliseringar använder format 5 för den fulla
withdrawal-/restaureringskedjan, medan äldre format och tidigare fryst
Complete-XML/hash förblir oförändrade. Se ADR-0034.

## TASK 006K: explicit utom tävlan som permanent manuell overlay

OOC är en separat manuell resultatkälla ovanpå den append-only tekniska
resultathistoriken. Beslutet bevarar observerade tävlingsfakta men deltar
aldrig i ranking:

```text
DECIDE_OUT_OF_COMPETITION credential -> exakt aktuellt publicerat tekniskt OK/MP
                                      |
                         not_competing_decision
                                      |
              result_revision OOC/OUT_OF_COMPETITION
                                      |
              permanent aktiv overlay över senare ingest
```

Den rena domänen deep-kopierar targetens entry, historiska klass/bana,
eventuella tider, missing/extra controls och splits och ändrar endast
status/reason. Kortmotor, station och ingestkontrakt breddas inte. Target måste
vara absolut latest, publicerad, direkt readoutbaserad, strikt teknisk
`OK|MP` och exakt aktuell; manuella/restaurerade eller äldre huvuden avvisas.

Den gemensamma entry-låsta manualgrinden gör aktiva DNS-, DSQ-, approval-,
DNF- och OOC-tillstånd ömsesidigt uteslutande. Senare offlineingest får
appendera rådata, readout och teknisk revision men den effektiva projektionen
förblir den frysta OOC-revisionen. TASK 006K har inget withdrawal.

OOC är orankad och påverkar inte OK-ranking eller mixed-course-kontroll.
Publikresultat får format 5. IOF mappar till `NotCompeting`, bevarar tillåtna
tider/splits och förbjuder Position/TimeBehind. Historik och finalisering får
format 6 och fryser decision, target, effektiv OOC och absolut tekniskt huvud;
äldre format och Complete-bytes ändras aldrig. Se ADR-0035.

## TASK 006L: append-only OOC-återtagande med exakt restaurering

Ett felaktigt OOC avslutas med en separat immutable livscykeljournal och en ny
resultatrevision, aldrig genom update/delete, avpublicering eller historisk
fallback:

```text
WITHDRAW_OUT_OF_COMPETITION credential -> exakt aktiv decision + OOC-revision
                                      |
                     fryst absolut head + exakt teknisk OK/MP-källa
                                      |
                         not_competing_withdrawal
                                      |
       result_revision MANUAL_OUT_OF_COMPETITION_WITHDRAWAL (OK/MP)
                                      |
                         normalt latest-head igen
```

Utan senare teknik är absolut huvud OOC-revisionen och källa originaltargeten.
Finns senare teknik måste det absoluta huvudet självt vara den direkta,
publicerade, strikta och exakt aktuella tekniska `OK|MP`-källan. Servern söker
aldrig bakåt och väljer aldrig om källa efter att intentet frysts.

Restaureringsrevisionens outcome är canonicalt exakt lika med källans,
inklusive eventuella tider, kontrollutfall och splits. Den har null direkt
readout och explicit withdrawalprovenans; decision, OOC-revision, tekniska
källor, rawdata och snapshot förblir immutable. Därefter väljer ordinarie
latest-head restorationen eller en senare revision.

Den centrala entry-låsta resolvern validerar samtliga historiska OOC-kedjor och
tillåter högst en aktiv. Migration 0021 ersätter 0020:s uttryckligen
tillfälliga livstidsunika entry-index med ett icke-unikt uppslagsindex. Ett
nytt OOC kräver ändå en senare ny direkt teknisk revision; restorationen är
inte ett tillåtet target.

Publikresultat stannar på format 5 och IOF får ingen ny status eller intern
provenans. Historik och nya finaliseringar använder format 7 för den fulla
withdrawal-/restaureringskedjan, medan äldre format och tidigare fryst
`NotCompeting`-XML/hash förblir oförändrade. Se ADR-0036.

## TASK 006M: utan tidtagning som permanent status-only-overlay

Utan tidtagning är ett separat manuellt verksamhetsbeslut ovanpå ett exakt
validerat tekniskt genomförande:

```text
DECIDE_WITHOUT_TIMING credential -> exakt aktuellt tekniskt OK/COMPLETE
                                      |
                       without_timing_decision
                                      |
               result_revision NT/WITHOUT_TIMING
                                      |
              permanent aktiv overlay över senare ingest
                                      |
                   publik status-only / IOF blockerad
```

Den rena domänen accepterar endast en publicerad, direkt readoutbaserad och
absolut aktuell teknisk `OK/COMPLETE`-revision. NT-outcome kopierar bara entry,
historisk klass och banversion; tider, kontroller och splits stannar i det
immutable targetet. MP, manuellt godkänt OK, restoration och opublicerade,
stale eller korrupta källor avvisas.

Den gemensamma entry-låsta manualgrinden gör DNS, DSQ, approval, DNF, OOC och
NT ömsesidigt uteslutande. Senare offlineingest får appendera rådata, readout
och teknik, men den effektiva projektionen förblir den frysta NT-revisionen.
TASK 006M har inget withdrawal.

NT är orankad och påverkar inte OK-ranking eller mixed-course-kontroll.
Publikresultat får format 6 och historik format 8. IOF 3.0 saknar en
sanningsenlig NT-status: `OK` skulle dölja icke-rankad semantik och utelämna
kända splits, medan `NotCompeting` redan betyder OOC. Snapshot och ny
finalisering failar därför stängt på aktiv NT; adaptern breddas inte och äldre
Complete-bytes/hash ändras aldrig. Se ADR-0037.

## TASK 006N: append-only NT-återtagande med exakt restaurering

Ett felaktigt NT avslutas med en separat immutable livscykeljournal och en ny
resultatrevision, aldrig genom update/delete, avpublicering eller historisk
fallback:

```text
WITHDRAW_WITHOUT_TIMING credential -> exakt aktiv decision + NT-revision
                                      |
                     fryst absolut head + exakt teknisk OK/MP-källa
                                      |
                       without_timing_withdrawal
                                      |
          result_revision MANUAL_WITHOUT_TIMING_WITHDRAWAL (OK/MP)
                                      |
                         normalt latest-head igen
```

Utan senare teknik är absolut huvud NT-revisionen och källa originaltargetens
direkta tekniska `OK/COMPLETE`. Finns senare teknik måste absolut huvud självt
vara den publicerade, direkta, strikta och exakt aktuella tekniska `OK|MP`-
källan. Servern söker aldrig bakåt och väljer aldrig om källa efter att intentet
frysts.

Restaureringsrevisionens outcome är canonicalt exakt lika med källans,
inklusive tider, kontrollutfall och splits. Den har null direkt readout och
explicit withdrawalprovenans; decision, NT-revision, tekniska källor, rawdata
och snapshot förblir immutable. Därefter väljer ordinarie latest-head
restorationen eller en senare revision.

Den centrala entry-låsta resolvern validerar samtliga historiska NT-kedjor och
tillåter högst en aktiv. Migration 0023 ersätter 0022:s uttryckligen
tillfälliga livstidsunika entry-index med ett icke-unikt uppslagsindex. Ett
nytt NT kräver ändå en senare ny direkt teknisk `OK/COMPLETE`; restorationen
är inte ett tillåtet target.

Publikresultat stannar på format 6. Aktiv NT blockerar fortsatt IOF och ny
finalisering, medan en återtagen kedja använder vanlig `OK`/`MissingPunch` utan
intern provenans. Historikformat 9 och finaliseringsformat 8 fryser den fulla
withdrawal-/restaureringskedjan; äldre format och tidigare Complete-XML/hash
förblir oförändrade. Se ADR-0038.

## TASK 006O: individuell fast starttid

`CHANGE_ENTRY_START_TIME` återanvänder raceadministrationens credential- och
sessionsgräns med separata cookies. Privat läsning låser session och credential
delat före racesnapshot. Skrivning låser session → credential → race UPDATE →
request → entry och committar starttid, entry-/snapshotversion, immutable
`entry_start_time_change_request` och audit atomärt. Endast FIXED-klasser får
ändras; hela observerade grundtillståndet måste matcha.

Den separata sidan visar före bekräftelsen att sparandet inte räknar om något.
Efter sparandet länkas befintlig `RECALCULATE_RESULT`-vy. Motorn och
revisionsformatet återanvänds, utan kombinerad capability eller ny status.
Se ADR-0039 och migration 0024.

## TASK 006P: individuellt brickbyte

`CHANGE_ENTRY_CARD` använder samma säkerhets- och transaktionsmönster som
starttidsändring. Race UPDATE serialiserar brickbyte mot import, ingest och
omräkning. Den gamla assignmenten avaktiveras, den nya skapas eller en tidigare
egen återaktiveras. Identiteten är immutable; en separat journal fryser varje
byte, request och versionsgrund. `RECALCULATE_RESULT` förblir ett separat val.

EntryList kan skapa första kopplingen men får inte ändra en befintlig aktiv
bricka, återaktivera gammal eller flytta ägare. Konflikt rullar tillbaka hela
importen. Race+bricknummer-unikheten behålls. Ingen ny stationsmodell, motor,
resultatrevisionstyp eller dependency införs. Se ADR-0040 och migration 0025.

## TASK 006Q: direktanmälan till befintlig klass

`REGISTER_ENTRY` återanvänder samma racebundna säkerhet med egna cookies.
Förberedelseläsningen lämnar endast klass/bana/startregel och snapshot.
Skrivningen låser session → credential → race UPDATE → request advisory och
skapar entry/version 1, valfri assignment, snapshot +1, immutable requestjournal
och audit atomärt. Klassgrund och historiskt brickägande omvalideras under låset.

Vyn `/admin/<raceId>/registration` fryser ett granskat intent före sista
bekräftelsen. Okänt commitsvar tillåter endast explicit same-id-retry; sidan är
inte en offlinekö. Ingen resultatrevision skapas. Befintlig ingest och separat
omräkning återanvänds. Se ADR-0041 och migration 0026.

## TASK 006R: privat operativ startlista

`VIEW_START_LIST` är separat read-only-capability på befintligt säkerhetssubstrat.
Läsaren låser session → credential → race SHARE och projicerar endast aktuella
klasser, deltagarnamn, klubb, planerad tid och aktiv bricka. Hårda totalgränser
avvisar overflow i stället för att lämna en ofullständig lista. Läsning skapar
ingen audit, journal eller domänmutation; credentialadministration har sin
befintliga säkerhetsaudit. Migration 0027 lägger bara till capability/gräns.

Sidan `/admin/<raceId>/start-list` är ett privat shell före login. Klassfilter
arbetar i minnet över ett sammanhängande snapshot. Datum, tid, offset och
millisekunder formateras i eventets tidszon. Denna presentationsordning är
inte resultatranking eller bevis för faktisk start. Se ADR-0042.

## TASK 006S: explicit publicerad startlista

`PUBLISH_START_LIST` använder egna racebundna credentials/cookies och befintlig
Origin/CSRF-kontroll. Privat granskning bygger ett begränsat, strikt validerat
underlag. Publicering binder snapshotversion, innehållshash och beslutsrevision
under session → credential → race UPDATE → request advisory. Migration 0028
lägger till immutable beslut/journal; beslut och actor-audit är atomära.

`/admin/<raceId>/start-list-publication` visar exakt publicerbara uppgifter före
bekräftelse. `/starts/<raceId>` och publik GET läser endast senaste frysta
PUBLISH. WITHDRAW ger 404 utan deltagardata; äldre journaler exponeras inte.
Ogiltigt nytt underlag blockerar publicering men aldrig withdrawal/replay.
Ingen resultatlogik, extern adapter eller stationsmutation tillkommer. ADR-0043.

## TASK 006T: fryst IOF StartList-export

Migration 0029 lägger till nullable iof_start_list_xml på immutable publicering.
Vid nytt PUBLISH serialiserar IOF-adaptern samma race-låsta deltagare med
strukturerade namn. Hashformat 2 binder webb- och IOF-projektion före beslutet.
Legacyrader lämnas oförändrade; ingen gissad uppdelning av displayName.

`/api/races/<raceId>/start-list/iof` läser endast senaste beslutets XML och
lämnar attachment/no-store utan cookies. Före/efter publicering/withdrawal
gäller samma offentliga åtkomst som listan; legacy utan XML ger 409. Publik
JSON anger iofExportAvailable; webben visar nedladdning eller förklaring.
Samma framtida serializerändring kan aldrig ändra redan lagrade bytes. ADR-0044.

## TASK 006U: klasslottning

ADR-0045 placerar versionerad, seedad startplanering i ren domain. Funktionen
tar en unik uppsättning entry-id:n och numeriska tidparametrar; den läser ingen
klocka/slumpkälla och muterar inte sitt underlag. Contracts definierar strikt
klassval, preview, parametrar, underlagshash, skrivintent och kvittens. Dessa
delar används av serverpreview och atomärt klassbeslut. Separat capability
DRAW_CLASS_START_TIMES och migration 0030 skyddar immutable header/items.
Race och vald roster låses, sourcehash/versionsgrund kontrolleras och endast
ändrade entries uppdateras. En snapshotökning och audit committar med beslutet.
Items skrivs i batcher om högst 1 000 för PostgreSQL:s parametergräns.

Privat `/admin/<raceId>/class-start-draw` använder GET för klassval, skrivfri
POST-preview och separat POST-commit med fryst request-id. Egna cookies,
Origin/CSRF och 4 KiB-gräns gäller. Nätfel bevarar okänt intent i minnet;
hela HTTP-svaret omfattas av 15 sekunders timeout. Gamla resultat och
publicerade startlistor/XML ändras inte. Se ADR-0045.

## TASK108: skrivskyddad rapport över lottade fasta starttider

Den befintliga `MANAGE_RACE`-sessionen kan läsa
`/api/admin/races/<raceId>/administrator/fixed-start-slot-plans`. Application
tar ett repeatable-read-snapshot, låser race för läsning och jämför aktuella
FIXED-entries mot den senaste immutable `class_start_draw_request/items` per
klass. Bara en komplett sekventiell journal och en entydig aktuell tid per
slot ger `AVAILABLE`; saknad journal eller avvikande/dubbel manuell tid ger en
explicit `UNAVAILABLE`-orsak. `PUNCH`-klasser läses inte som slots.

Responsen är privat, strikt validerad och innehåller klassens faktiska
deltagarantal/tak separat från planerade tider. Den kompakt paginerade
administratörsvyn använder en kroppslös `GET` med `no-store`; den kan inte
tilldela, reservera, flytta eller ändra något. Ingen migration, ny capability
eller ADR krävs eftersom denna väg inte skapar ett domänbeslut.

## TASK109: bevisat lottad startslot vid klassbyte

`GET /api/admin/races/<raceId>/administrator/entries/<entryId>/transfer-start-slot-candidates/<classId>`
är en privat, `no-store` kandidatgräns för en befintlig deltagare och en
annan FIXED-klass. Den återanvänder `MANAGE_RACE`, men läcker inga draw- eller
lagringsuppgifter publikt. Svaret bär draw-id/source-hash och endast framtida,
vakanta tider när den aktuella rostern fortfarande kan bevisas mot drawen.

Den befintliga PATCH-transfern får ett separat slotbevis. Application tar det
befintliga race-/entrylåset, kontrollerar aktuell kapacitet och plan igen, och
skriver transferrequest samt `entry_start_slot_assignment` i samma
transaktion. Migration0066 är additiv och gör journalen immutable. En retry
läser assignment-journalen och återger exakt samma proof; den härleder aldrig
beviset ur entryns nuvarande tid. Manuella tider fortsätter på sin äldre väg.

## TASK110: bevisat lottad startslot vid direktanmälan

Direktanmälningssidan med `REGISTER_ENTRY` och den gemensamma
`MANAGE_RACE`-vyn använder varsin privat, `no-store` kandidat-GET för en
`FIXED`-klass. Båda skriver därefter samma strikta registreringskontrakt med
valfritt draw-bevis. Application återanvänder den verifierade slotplanen men
accepterar som senare rostergrund endast ursprungliga draw-items eller de två
separata immutable slotjournalerna.

`entry_registration_start_slot_assignment` i migration0067 är avsiktligt
skild från transferjournalen och refererar exakt en
`entry_registration_request`. Entry, valfri brickkoppling, registrationrequest
och slotjournal committar i en transaktion. Kvittensen/retry läser journalen;
manuell fast tid blir inte en lottad slot. Ingen publik route, reservation,
resultatändring eller ny capability tillkommer.

## TASK 006V: Testeventorgräns under implementation

Ersatt av ADR-0170 beslut 4 (PLAN.md steg 14): kopplingen sköts per tävling i
Inställningar; CLI-anslutningen, grants och tabellerna nedan togs bort i migration 0096.

ADR-0046 avgränsar import till ett uttryckligt valt externt event/lopp som
skapar nya interna UUID-objekt. Adapter och serverorkestrering hålls utanför
domain. Befintligt CREATE_EVENT-substrat används med en privat anslutning
bunden till just skapandecredentialen; inga befintliga race-rättigheter utökas.

Application-lagrets AES-256-GCM-envelope binder ciphertext till miljö,
anslutning, ägare, format och masterkey-id. Migration 0031 lägger till immutable
anslutning, separat spärr och importjournal/provenans. Preview och commit
hämtar via packages/eventor utanför DB-lås, validerar en strikt whitelist och
kontrollerar auth igen. Commit binder SHA-256 över hela XML-källan och explicit
lopp/tidszon; event/race/journal/audit skrivs atomärt. Unik miljö+externt event-id
och advisory lock hindrar dubbelimport mellan anslutningar. Exakt retry
behöver varken nät eller masterkey, men kräver fortsatt giltig behörighet.

Privat /admin/events/eventor återanvänder CREATE_EVENT-sessionen och har eget
minnesburet intent. /api/admin/eventor-import erbjuder GET av minimal connection-
metadata och POST-commit; /preview erbjuder POST-granskning. Origin/CSRF,
4 KiB JSON, no-store och detaljfria fel gäller. Webbläsaren har ingen API-nyckel.
Tester täcker syntetisk upstream och riktig PostgreSQL; autentiserat liveprov
och en full extern HTTP-driftskedja är ännu inte verifierade.

ADR-0116:s senare två slutna profiler gäller också för racebunden
anmälansimport enligt ADR-0114. Den privata, aggregerade preview-responsen
är formatversion 2 och bär enbart `environment` från den återauktoriserade
lagrade anslutningen; UI visar den som text före manuell klassmappning.
Preview-begäran och idempotent commit förblir version 1 och tar varken
profil, origin eller API-nyckel från browsern. Se TASK246.

## TASK 006W: avprickningsregel, ännu utan skrivflöde

ADR-0048 placerar den rena versionsstyrda avprickningsregeln i domain.
Den är separat från resultatmotorn och planerar bara ett operativt besked
för race/entry. Databasservice, skrivcapability, browserflöde och eventuell
beständig mobilkö är ännu inte implementerade. VIEW_START_LIST är fortsatt
read-only; inget UI har fått dold skrivrätt genom den nya domänexporten.

ADR-0049 ersätter därefter det tidigare antagandet om ingen DNS-följd:
användaren kräver offline på mobilen, spårbart DNS för explicit ej start,
rättning vid mål och privata kvar-i-skogen-listor. Den rena forest-watch-
projektionen klassificerar tillhandahållna fakta men läser ingen databas och
styrker inte själv återkomst eller full roster. Appskal/IndexedDB, serverjournal,
ny DNS-källa och målpersonalens UI återstår; inget färdigt offlineflöde påstås.

ADR-0050 konkretiserar nu identitet och mottagningsjournal. Migration 0032
lägger till immutable start_checkin_device, start_checkin_operation och
start_checkin_revision med race-/credentialbindning, unik request/sekvens och
deferred reciprocal operation↔revision-FK. Befintlig manual-DNS-provenans,
rawdata och resultatrevisioner ändras inte. PostgreSQL-triggers skyddar bara
immutabilitet, inte verksamhetsregler. Inga write-routes aktiveras av detta.

Contracts skiljer durabel mottagning från APPLIED/UNCHANGED/CONFLICT och fryser
beroendet mellan flera lokala operationer för samma entry. Application måste
fortfarande validera/hashkontrollera, auktorisera och atomärt skapa alla
DNS-/audit-/operativa effekter före kvittens. Tabellen ensam är inte en
färdig applikationstjänst eller beständig mobilkö.

START_CHECKIN och FINISH_FOREST_WATCH är nu inlagda i det befintliga
raceadministrativa säkerhetssubstratet, med separata prefix, tidsgränser och
credentialaudit. registerStartCheckinDeviceAsAdmin autentiserar före body,
kontrollerar auth igen under transaktionslås och sparar enhetsidentitet +
actor-audit atomärt. Exakt registreringsretry fungerar från en ny session med
samma credential. Ingen webbrutt, cookieyta, markering eller DNS-effekt
aktiveras av enhetsregistreringen. Se ADR-0050.

ADR-0051/migration 0033 tillägger START_CHECKIN_DID_NOT_START med separat
immutable decision/withdrawal och nullable källreferens på result_revision.
Reciproka constraints binder exakt operativ revision och skapat resultat;
klass och entry är racebundna. Äldre manuellt DNS och övriga källformer
behåller sina krav. Application-valideringen kontrollerar operation/hash,
kvittens, enhet/aktör, status-only DNS och den exakta korrigeringskedjan.

Central resultatresolver och manual-writer-grind använder nu validerad
avprickningsprovenans. Publik/Snapshot följer den aktiva källan; återtaget
DNS-huvud ger inget aktivt resultat och senare teknik kan bli nytt huvud.
Privat readout-historik format 10 behåller den separata DNS-källan och dess
exakta återtagande, men inte actor/device/hash/receipt. Äldre kontraktsformat
och fryst XML ändras inte. Nya klass-/loppsfinaliseringar använder format 9
med validerad aktiv avpricknings-DNS och fryst operations-/revisionsprovenans.
Återtaget DNS blockerar ny finalisering, medan gamla Complete-bytes behålls.
syncStartCheckinAsAdmin tillämpar nu den rena domänplanen under auth-,
race-, request-, device- och entrylås. Operation/kvittens, operativ revision,
DNS/withdrawal och audit committar tillsammans. Sekvensluckor och fel identitet
ger ingen durabel kvittens; stale verksamhetsgrund ger journalförd konflikt.
Skyddade HTTP-routes binder start-/målcapability statiskt och använder separata
sessionscookies, Origin/CSRF och validerade privata no-store-svar enligt ADR-0052.
Målpersonalens privata läs-/utskriftsvy finns nu på /admin/<raceId>/forest-watch.
Den presenterar bara validerad serverklassificering och gör inga resultatbeslut.
Offlineklient och operativ skriv-/rättningsvy är ännu inte aktiverade.

ADR-0052 lägger till listStartCheckinRosterAsAdmin för START_CHECKIN och
FINISH_FOREST_WATCH. Den läser hela rostern, validerad operativ journal och
centralt resultatstate i repeatable read och klassificerar skogsstatus via
domain. Enhetsmetadata anger endast senaste durabla mottagning, aldrig
tom offlinekö eller säker nätkontakt. Explicit knowledge=LAST_SYNCED_ONLY
följer varje svar. Konfliktrapporter kvarstår synligt tills separat uttrycklig
avskrivning finns; normal avprickning kvitterar dem inte tyst.

ADR-0053 konkretiserar browserpersistens inom apps/web: Web Crypto-krypterad
IndexedDB med separata metadata-, roster-, operations- och kvittensstores.
Strict-transaktion och versions-CAS binder operation/sekvens samt mottagen
kvittens/pekare atomärt. Lokal lösenfras ersätter aldrig serverbehörighet.
Enstegstransport binder capability/race och väntar på lokal receiptcommit;
ingen radering eller ombasering sker vid nät-, auth- eller CAS-fel.
Detta är lagrings-/transportsubstrat, ännu inte mobilens offline-appskal/UI.

ADR-0054 tillägger persondatafritt React-appskal /checkin/index.html som byggs
med workspace-esbuild före web dev/build och serveras av samma Next.js.
Service worker har scope /checkin/ och SHA-256-verifierad exakt allowlist av
egna HTML/JS/CSS. Ingen Next/RSC/API/roster cacheas. Explicit förberedelse
använder separata skyddade login/device/roster-anrop och krypterad IDB;
lokal upplåsning fungerar utan nät och låsning/pagehide döljer persondata.
Skriv-/rättningsknappar och integrerad synk från vyn återstår.

Avprickningsvyn kopplar nu explicit skrivläge till befintlig IDB-writer och
enstegstransport. Gemensam checkinLocalView visar endast operativa lokala
intents och deras kvittenser, aldrig DNS/resultat/skogsklassificering.
Startrollens tre knappar och målrollens sammanhållna rättningsformulär är
separata. Synk verifierar samma registrering/actor före sekventiella retries.
Privat startlista och översikt länkar till appskalet med race-id i fragment,
inte query/cache. Inga nya serverbehörigheter följer av länken.
## TASK 006W: begränsad köåterhämtning, första byggstenen

ADR-0055 beslutar om en separat kortlivad behörighet för ett exakt fryst
intervall av ursprungliga köoperationer, inte en överlåtelse av device/actor.
Kontraktets privata manifest och mobilens read-only-export finns nu.
Additiv migration 0034 innehåller immutable grant, manifestitems, revocation
och delivery. Canonical manifest lagras som text så att de hashbundna byten
bevaras. Delivery har separata sammansatta främmande nycklar mot både exakt
grantitem och originaloperationens scope/sekvens/hash.

Betrodd serverutfärdning/spärrning finns nu med oförändrad permanent actorbindning.
Utfärdaren låser credential → race → device, kontrollerar inaktiv original-
credential och exakt överlapp/sekvensgrund och skriver grant/items/audit atomärt.
Spärrning låser grant och skapar immutable revocation/audit med same-intent-retry.
Endast hash av den separata 32-byte-hemligheten lagras. Privata in-/utdata och
serverdrift beskrivs i checkin-recovery-operations.md.
Recovery-synktjänst och separat bearer/same-origin-HTTP-route finns nu.
Ordinarie auth och recovery använder samma interna transaktionsskrivare och
domänregler. Recovery lägger till exact-manifest-grind, grant SHARE-lås samt
atomisk delivery/audit; den gamla credentialen blir inte giltig igen.
Browserns explicita tokenflöde är nu kopplat, med samma receipt-/CAS-grind som
vanlig synk och credentials:omit. Det hämtar inte ny roster eller registrerar
ny enhet. Token stannar i försökets minne, fältet töms vid submit/låsning och
recovery används aldrig av automatisk synk. Browser/HTTP/PG har verifierats med
syntetisk kö, tappat svar, spärrad originalcredential och låsning mitt i svaret.
## TASK 006W: konfliktgranskning under implementation

ADR-0056 separerar immutable granskningsbeslut från ursprunglig operation och
från målkorrektion/resultatbeslut. Ren planStartCheckinConflictReview återanvänder
forest-watch-regeln: stale grund/set och aktuella motsägelser avvisas, medan
startad utan återkomst och omarkerad fortfarande kräver uppföljning. Detta är
domänsubstrat utan I/O. Strikta source/candidate/request/response-kontrakt och
additiv migration 0035 finns nu. Immutable header binder granskningsaktör och
canonical intent; items har exakt scope/hash/effect-FK till original-CONFLICT
och global unikhet per originalrequest. Auktoriserad application-läsning och
beslut finns nu med FINISH-session/CSRF, exakt sourceHash och entrylås. Den
privata auditposten fryser även hela källobjektet. Rosterprojektionen validerar
journalens canonical intent och exakta medlemskap innan en historisk rapport
tas bort ur olösta konflikter. Inga start-/resultatrevisioner ändras.
HTTP-routes och gransknings-UI är nu implementerade och verifierade enligt
docs/task-006w-acceptance.md. Mobilen begär explicit reviewDetails=1 och
bevarar granskad historik i krypterad roster utan att ändra originalkvittensen.

## TASK 007: betrodd isolerad demoprovisionering

ADR-0057 kräver ren explicit targetpolicy före anslutning och faktiskt
databasnamn/tomma applikationstabeller under stabila exklusiva tabellås före
write. Application återanvänder IOF-import och credentialutfärdning under en
överordnad transaktion med savepoints; inga privata demovägar exponeras i HTTP.
Fyra racebundna roller skapas för en timme: de tre minst-behöriga operativa
rollerna samt befintlig `MANAGE_RACE` för den gemensamma adminvyn enligt
ADR-0102. Den hemlighetsfria sammanfattningen returneras först efter commit och
innehåller även scopebunden `/manage`-länk. En betrodd privat outputcallback körs före commit
så skrivfel rullar tillbaka DB, men ett senare commitfel kan fortfarande vara
osäkert mellan fil och databas. Detta är inte en distribuerad atomisk commit.
Application, målpolicy och privat filadapter/CLI är verifierade. Output kräver
ny exklusiv 0600-fil i ägd privat katalog utanför repository; inode, ägare och
rättigheter kontrolleras före engångsskrivning och fsync. Strikta kontrakt
skiljer privat installation från hemlighetsfri scopebunden länksammanfattning.
Genomgående browserprov med CLI-provisionerade roller har passerat TASK007 och
TASK078: demoegna EntryList-/StartList-fixtures ger blandad `PUNCH`/`FIXED`,
gemensam admin provar ett kapacitetskontrollerat klass-/starttidsbyte och
återställer underlaget före avläsning och publikresultat.
Simulatorns READOUT-behörighet utfärdas separat för dess visade device-id genom
befintlig station-CLI; arrangörsrollerna breddas inte. Testservern isoleras till
egen loopbackport/byggkatalog. Offline-shellmatch ignorerar endast URL-fragment,
inte origin/path/query, och lagrar fortfarande bara tre fasta publika resurser.

## TASK 008: privat speakerunderlag

ADR-0058 beslutar en separat VIEW_SPEAKER_BOARD på befintligt racebundet
säkerhetssubstrat. Vyn väljer senaste publicerade huvud per entry, sorterar
på serverregistreringstid och begränsar till 25 före central resultatresolution.
Aktiva manuella beslut får inte döljas av ny teknisk avläsning. NO_ACTIVE_RESULT
är en separat presentationsgren, inte fallback till äldre DNS. Strikt kontrakt
finns. Additiv capabilitymigration 0036 och auktoriserad läsare är nu
implementerade. Betrodd separat speaker-CLI finns med privat stdout och
statisk capability. Separata speaker-board och speaker-board-session-routes
finns med egna host-only cookies, strict DTO/scope, private no-store och
begränsad streamed request-body. Första mobilvyn och ett genomgående browserprov
finns. Klientens 15s timeout omfattar även JSON-läsning; polling är femsekunders,
bara synlig/sessionbunden och utan beständig lokal data. Kontrollerad expiry,
emulerad visibility med faktisk request-abort och syntetiska pagehide/pageshow
är browserprovade. ADR-0060 bevarar no-store: verklig standalone/HTTPS-navigation
visar ny serverauth när Chromium avstår från cache. Äkta bfcache är fortfarande
overifierad kompatibilitetsgren, inte ett krav att privata svar cachelagras.

Det avgränsade mjukvarusnittet är slutverifierat enligt
task-008-acceptance.md. Riktig PostgreSQL verifierar även 1 000/1 001 giltiga
beslut genom befintliga livscykeltjänster samt importändrade namn/klubb och
historisk resultatklass. Detta är inte fullständigt speakerläge eller V1-drift.

Läsaren ska begränsa beslutshistorik före befintlig central resolver och hålla
normala repeatable-read-radlås. Den skapar inga verksamhets- eller auditrader.
raceSnapshotVersion är konfigurationskontext, inte resultatets freshness-token.
Inga råa korttider kringgår effektivt NT; topplistan får ingen egen ranking.

ADR-0164 avgränsar en fristående, manuellt hämtad publik klassledarbild i
administratörens inbäddade speakerflik. Den bygger på publicResults-format
7:s hela historiska klasskohort, inte på de 25 privata feedraderna. Svaren
kopplas inte via namn eller slot och har skilda lästider. Ingen extra
automatisk fullresultatspollning, ny privat rättighet eller ändring av den
separata speakervyn ingår.

## ADR-0059: korrigerad authgräns för protected reads

En separat credentialbunden MVCC-guard ändras atomärt av både credential- och
sessionsspärrens INSERT-trigger. Credential/session och spärrjournaler förblir
immutable. Protected-read-helpern håller session → credential → guard SHARE
inne i ett auth-savepoint före privata projektioner. En guard ändrad sedan RR-
snapshot ger 40001, rollback av auth-savepoint och unauthorized; inget retry
sker mot det gamla snapshotet. Lyckade lås behålls till yttre commit.
Detta korrigerar det bevisat felaktiga låsantagandet ovan/ADR-0020/0058 utan att
sänka snapshotkonsistensen eller ge GET skrivrätt. Se migration 0037 och dess
obligatoriska driftstopp. Legacy-läsare med endast auth-preflight omfattas inte.

## TASK 009: privat klasslista inom authtransaktionen

listEntryClassesAsAdmin använder nu protected-read som första steg i samma
transaktion som race SHARE och listprojektionen. Befintlig READ COMMITTED,
CHANGE_ENTRY_CLASS, strikt DTO och deterministisk ordning behålls. En redan
auktoriserad läsning håller authlåsen tills listan är färdig; en spärr som
vinner authgrinden ger ingen lista. Detta är tillämpning av ADR-0059, ingen
ny arkitektur eller migration. Klassbytesmutationen, resultat och offlineköer
ändras inte. Övriga preflight-läsare omfattas inte automatiskt av förbättringen.

## TASK 010: isolerad manuell utvecklingsdemo

O_TID_LOCAL_DEMO=1 väljer en fast .next-local-demo i utvecklingsläge, skild
från vanlig .next och browserprovens .next-demo-test. Samtidiga demoflaggor
avvisas. Produktionskonfiguration och standalone är oförändrade. Detta är
ADR-0057:s lokala demoisolering, inte ett nytt driftsläge eller behörighets-
undantag. Ny databas, aktuell migration och privata tidsbegränsade credentials
krävs fortfarande. Den aktuella manuella demon beskrivs i local-demo-20260907.md.

## TASK 011: privat omräkningslista inom authtransaktionen

listResultRecalculationCandidatesAsAdmin använder protected-read som första
steg i samma READ COMMITTED-transaktion som race SHARE och kandidatprojektion.
ADR-0059:s authlås hålls tills läsningen committar. RECALCULATE_RESULT,
readiness, sortering, senaste readout/revision och strikt DTO är oförändrade.
Ingen mutation, råhistorik eller offlinekö påverkas. Detta stänger en bevisad
spärrlucka, men gör inte andra preflight-läsare automatiskt spärrsäkra.

## TASK 012: privat parkopplingslista inom authtransaktionen

listPairingGrantsAsAdmin använder ADR-0059:s protected-read först, sedan
granturval och samtliga metadatauppslag i samma READ COMMITTED-transaktion.
Authlåsen hålls till commit även när metadatajoinen väntar. PAIR_STATION,
1000-gräns, sortering och statusprioritet behålls. Ingen ny race/grant-låsning,
schemaändring eller ändring av utfärdning/inlösen/spärrning ingår.

## TASK 013: beslutad PM-dokumentgräns, ännu inte aktiverad

ADR-0061 beslutar privat versionsbunden MinIO-lagring, PostgreSQL-reservation/
scanjobb, verktygsisolering och explicit publiceringsjournal för ett aktuellt
PM-PDF per race. Init/publish/withdraw har nu strikta requestkontrakt utan
klientstyrd lagring eller scanstatus. Kontrakt är inte PDF-validering eller
publiceringsbevis. Verklig scanner/worker, limiter, HTTP och UI återstår;
inga PM-routes eller någon utfärdning av PM-behörigheter är aktiva ännu.
Resultat, racesnapshot och stationspaket påverkas inte. TASK013:s fulla
vertikala acceptans krävs före aktivering.

TASK013:s Node-only packages/infrastructure har nu en MinIO 8.0.7-adapter
med trusted config, privat bucket-/versioneringskontroll, exakt versionsmanifest,
SHA/längdvaliderad readback och avbrytbar operationsegna HTTP-transporter.
Den anropas ännu inte av web/application/worker. Protokollprov är inte verklig
MinIO- eller PDF-validering; se docs/research/pm-storage-sdk.md.

Efterföljande status: verklig MinIO-versionering/anonymt avslag/processomstart
har verifierats separat. Migration0038 inför nu immutable reservationer,
debiterade försök och manifest samt ett korsrefererat durabelt scanjobb.
Raceunika slotar och reservationsunika försöksnummer upprätthåller kvotgränser
utan en separat härledd räknare. Manifestet binder exakt försök/race/SHA/längd
via FK; jobbgeneration läses som bigint för att inte avrundas i TypeScript.
MANAGE_PM_DOCUMENT finns i databasens scope/livstidsmodell men kan ännu inte
utfärdas genom application/CLI/HTTP. Inget jobb innebär godkänd fil: immutable
scanrapporter, worker-CAS, verklig scanner, limiter, application och UI återstår.

PM:s application-policy kan nu utfärda/inlogga MANAGE_PM_DOCUMENT med eget
credentialprefix, högst 8 h credential och 1 h session; ingen CLI/HTTP-cookieväg
är exponerad. reservePmDocumentAsAdmin gör auth först i RC-transaktionen,
sedan race-/requestlås och exact-retry före kvot. Reservation och audit är
atomiska. allocatePmUploadAttemptAsAdmin är en serverintern debitering av ett
nytt försök per anrop, inte ett idempotent publikt upload-endpoint. Den gör
inga nätanrop och returnerar befintligt manifest utan ny debitering.
Transport/final manifestcommit, scanner och publicering är fortfarande öppna.

transferPmDocumentAsAdmin kopplar nu debiteringen till en serverintern port
för riktig MinIO-PUT/readback. Body läses först efter auth/debitering, till
fast begränsad buffer, med total deadline och SHA/längdkontroll. Ingen DB-
transaktion hålls över body/PUT. Ny aktuell klocka/auth/race-lås krävs före
atomisk manifest/job/audit-commit. Samtidig förlorare får samma valda kvittens,
med privat orphan bevarad. Lagringskvittensen saknar scan-/publiceringsstatus.
Porten och adaptern delar strikt manifestkontrakt i contracts; application
importerar inte infrastructure. Den riktiga adapterkopplingen har ett separat
MinIO/PostgreSQL-prov. HTTP-reader/limiter, scan/worker och publikvy är inte aktiva.

TASK013:s serverinterna claim/release finns nu i application. Migration0039
journalför varje allokerad femminuterslease i immutable pm_scan_attempt.
SKIP LOCKED håller samtidiga workers isär; generation är exakt bigint och
ökar även efter återlämning. En leasekrasch bevarar attempt och jobb tills
expiry, utan att skapa godkänd rapport. Release kontrollerar current
owner/generation/state och DB-expiry i UPDATE RETURNING efter radlås.
Ingen nät-/scanner-I/O görs i dessa transaktioner. Detta är ännu inte
rapportcommit: immutable scanrapport och samma atomiska fencinggrind måste
kopplas in innan worker eller publicering kan aktiveras. Se ADR-0061.

Migration0040 och recordPmScanReport lagrar nu en immutable rapport per
upload/generation med composite FK till attempt/owner. Strikt serverintern
evidens binder exakt manifest, verktyg/runobservationer, signaturproveniens
och tidsintervall; application klassificerar PASSED/REJECTED/FAILED.
Saknade motorobservationer är null. Inga loggar eller filbytes lagras där.
Native-profilen ger alltid publishable=false, också när syntetiska eller
verkliga native-observationer klassificeras PASSED. DB-constraint hindrar true.

Exakt retry jämför worker, canonical innehåll och SHA före expiry och returnerar
samma historiska rapport. Ändrat innehåll ger konflikt. Ny rapport och FINISHED
committas tillsammans; sista SQL-grinden kräver både aktuell jobblease och
immutable attemptdeadline samt matchande owner/generation. Missad grind
rollbackar rapporten. FINISHED är inte publiceringsstatus. Scannerparser,
kontrollerad adapterkomposition, godkänd isolerad produktionsprofil och
publiceringsvägar saknas fortfarande; ingen runtime aktiveras här.

Infrastructure har nu rena outputparsers för de pinnade motorerna och
sigtool-verifieringen. De kräver hela känt format, rätt temporär målfil och
begränsade processmetadata. Fel/timeout/signal/avklippning får ingen clean-
summary. Nativeproben använder samma parsers mot faktisk verktygskörning
och en egen skrivskyddad, hashkontrollerad signaturkopia. Parserresultaten
innehåller inga råa loggar eller paths. Detta är adaptergränsens observations-
tolkning, ännu inte full scanner-/MinIO-/rapportkomposition eller godkänd
produktionsisolering. Se ADR-0061 och pm-native-scanner-probe-research.

En serverintern runPmScanIteration kopplar nu claim → exakt versionsläsning
→ skanning → immutable rapport. Claimat manifest hålls separat från porternas
muterbara kopior, lästa bytes ägs och hash/längd verifieras före skanning.
240 s monoton portdeadline och abort på varje utgång hindrar sena svar;
lagringsadaptern vidarebefordrar abort till HTTP. DB-commit behåller sin egen
fencinggrind. Ingen DB-transaktion hålls under verktygs- eller lagrings-I/O.

createNativePmScannerProbe är en explicit lokal kompatibilitetsadapter, inte
produktionsworker. Den använder pinnade motorer och egna privata signatur-/PDF-
kopior, inväntar processavslut före begränsad cleanup och rapporterar cleanupfel.
Den får inte användas i NODE_ENV=production. Verkligt MinIO/PG/nativeprov finns;
PASSED är fortsatt publishable=false. Isolerad produktionsprofil, publicerings-
UI/HTTP och samlad restoreacceptans återstår enligt ADR-0061/TASK013.

ADR-0062 konkretiserar den framtida Linux-isoleringsgränsen: en kortlivad
container per scanattempt inom samma worker, dedikerad rootless-runtime,
verifierade cgroup v2-gränser och ingen PG-/MinIO-/daemonåtkomst i skannern.
buildPmDockerCreatePlan genererar nu en fast, hashbunden startkonfiguration
med exakt image-ID, två read-only staging-mounts och begränsad scratchyta.
Funktionen gör ingen I/O och ger inget proof. Realpaths, image-/runtimeinspect,
faktisk gränsverkan och crash/watchdog-livscykel måste verifieras före start.
Ingen ny executionProfile eller publiceringsrätt har införts; den aktuella
Mac-miljön saknar Linux-container-runtime. Se ADR/research för återstående prov.

checkPmDockerPrestartConfiguration kontrollerar nu tillförd image-/container-
inspect mot startplanen före eventuell exekvering. Kritiska nästlade objekt
är slutna; identitet, miljö, båda mountrepresentationerna, resurser och aldrig
startat tillstånd måste stämma. MaskedPaths/ReadonlyPaths binds till separat
betrodda releasehashar. Startplanen anger även runc, init=false och SIGTERM/5s.
Resultatet är endast metadataöverensstämmelse, aldrig scanproof. Insamling från
verklig daemon, releasepins, realpathkontroller och faktisk Linuxacceptans
återstår. Ingen I/O, ny executionProfile eller publiceringsrätt tillkommer.

inspectPmDockerPrestartConfiguration kopplar metadatafunktionen till två
begränsade GET-anrop via explicit privat Unix-socket. Ingen CLI, TCP, ambient
Dockerkonfiguration eller skrivoperation erbjuds. Adaptergränsen validerar och
äger input före await, kontrollerar sockettyp/ägare/privat kanonisk förälder,
begränsar headers/bytes/tid och stänger anslutningen vid fel/abort. Endast den
validerade metadatafunktionens resultat lämnar adaptern, aldrig råa daemon-
svar. Detta är en transport, inte starttillstånd eller releaseverifiering.
Se ADR-0062 för exakta gränser och kvarstående faktisk Linuxacceptans.

En separat Lima/VZ-testvärd har nu skapats, startats och stoppats för faktisk
Linuxgrundkontroll. Den ligger helt i privat temporärkatalog, utan hostmounts
eller containerd. Docker är ännu inte installerat. Detta är testinfrastruktur,
inte ändrat produktionsval eller godkänd isoleringsprofil. Reproducerbar
åtkomst, resursgränser och exakta bevis finns i docs/pm-linux-test-host.md.

Testvärden har därefter fått versionslåst rootless Docker29.8.0 och verifierad
user-systemd/cgroup2-metadata, utan att ändra AppArmorrestriktioner eller
aktivera rootful daemon. Den är stoppad med underlaget bevarat. Verkliga
container-/leaf-cgroup-/skannerprov återstår; inget produktionsproof tillkom.

## TASK106: separat privat kartasset och explicit kartsläpp

ADR-0120 beslutar en separat kartassetgräns, inte en utvidgning av
ADR-0061:s PM-PDF-flöde. En första kartasset är en race-scopad PNG/JPEG med
egen immutable reservation, överföringsförsök, versionsmanifest och
append-only release-/withdrawaljournal. Objektlagret förblir privat och
servern läser alltid manifestets exakta version; inga publika bucket-URL:er,
object keys eller "latest"-läsningar finns.

`MANAGE_RACE` i den befintliga racebundna administratörssessionen auktoriserar
upload, granskning, release och withdrawal. Den publika resultatsidan får bara
en liten indikator/länk när den aktuella releasen kan valideras; resultatdomän,
ranking och stationpaket ändras inte. Servern kontrollerar releasen före och
efter varje bytesläsning, så en ny hämtning efter withdrawal avvisas. PNG/JPEG
är medvetet enda första format: `.omap`, PDF, SVG, georeferering, tiles,
banpåtryck, GPS och rutter kräver egna framtida vertikala steg. TASK106 är
dokumenterad och har en strikt contractsgräns för reservation, lagringskvittens,
release/withdraw och publik metadata. Additiv migration0065 ger separata
immutable reservationer/försök/manifest/publiceringsjournal, och en privat
versionsadapter för PNG/JPEG håller PM-gränsen orörd. Application använder
race-lås och actor-/intent-bundet retry för reservation, manifestcommit,
release och withdrawal; första release jämför revision 0. Webben har privata
`OTID_MAP_STORE_*`-konfigurationer, MANAGE_RACE-skyddade reservation-/upload-/
release-/withdraw-rutter och en separat kartsläppssida som återanvänder samma
administratörssession. Publika resultatsidor länkar bara vid aktiv release;
Node-routen läser den exakta privata objektversionen och returnerar `no-store`
och `nosniff` utan lagringsidentifierare. Den publika visaren begränsas till
zoom/pan och skapar ingen geodata eller ruttfunktion.

TASK244 kompletterar endast den redan beslutade privata granskningen:
en `MANAGE_RACE`-skyddad serverläsning av en lagrad kandidats exakta
PNG/JPEG-version. Samma race-scope och immutable reservation/manifest
krävs; sessionen kontrolleras åter efter objektläsningen. Denna väg
skiljs från den publika release-gatade kartvägen och exponerar inga
lagringsidentifierare. Browsern laddar först efter explicit val;
publiceringsjournal och kartdomän ändras inte. Se
[TASK244](../TASK_244_PRIVATE_MAP_CANDIDATE_PREVIEW.md) och ADR-0120.

## TASK107: verifierad onlinekedja från station till publik resultatvy

ADR-0004:s femsekunderspolling är oförändrad. Ett separat browserfall öppnar
den publika 390 px-resultatsidan före resultat, skickar sedan en syntetisk
stationsreadout via den riktiga, idempotenta device-batch-routen och ser den
publicerade resultatrevisionen på den redan öppna sidan vid nästa poll. Ett
avlyssnat efterföljande pollfel behåller den senaste validerade raden och
visar textlig varning. Det bevisar den befintliga server-/station-/publik-
sammanfogningen utan att införa SSE, ändra resultatområde eller påstå fysisk
SPORTident/USB- eller produktionsdriftacceptans.

## TASK026: deltagarens namn och klubb

ADR-0067:s separata CHANGE_ENTRY_IDENTITY använder befintlig raceauth och
race UPDATE-lås. Application ändrar endast tre entryfält, entryversion och
snapshot; immutable journal och actor-audit sparas i samma transaktion.
Migration0041 binder journalens entry/klass/credential till samma race.
EntryList-import kontrollerar journalförd rättning innan upsert och avvisar
avvikande text atomärt. Befintliga resultat-/paket-/exportgränser bevaras.
Serverns lista, mutation och versionssidande historiktjänst finns. Skyddade
HTTP-routes med egna cookies och8KiB-bodygräns är införda. Kompakt UI med
explicit val/granskning/retry/historik och separat betrodd credential-CLI finns.
Browser→HTTP→PG-kedjan är verifierad med syntetiska data; se TASK026/status.

## TASK028: begränsad kandidatsökning vid direktanmälan

ADR-0068 utökar uttryckligen ADR-0041:s klassbegränsade REGISTER_ENTRY-läsning
med ett separat skyddat POST för namn-/brickkandidater. Befintlig klasslista
och registreringens skrivkontrakt förblir oförändrade. Application ansvarar
för race/snapshot, historiskt brickägarskap och begränsad projektion; webben
visar rådgivande träffar utan automatisk sammanslagning. Kontrakt och ren
matchningsfunktion finns; HTTP/PG/UI är ännu inte inkopplade eller verifierade.

## TASK029: gemensam tävlingsadministratör

ADR-0069 ersätter separat funktionsinloggning som slutlig administratörsdesign.
En explicit MANAGE_RACE-credential använder befintligt hashbaserat sessionslager.
Första serverintegration tillåter översikt, startlista och klassbyte med samma
session; principal/audit behåller den verkliga administratören. Login/logout
är exakt rollbundna och begränsade credentials uppgraderas inte. Migration0042
är additiv. Gemensamma webbroutes/inloggning och deltagar-/klassarbetsvy finns
nu under /admin/[raceId]/manage, verifierade genom browser/HTTP/PostgreSQL.
Atomiskt klass-/starttidsbyte finns nu via transfer-candidates/transfer och
egen immutable journal0043. FIXED kräver granskad tid, PUNCH sparar null.
Den race-låsta transfer-candidates-läsningen bär klassens aktuella bannamn och
banversionsnummer från samma redan kontrollerade Class → CourseVersion →
Course-koppling. Klassvyn behöver därmed inte kartgeometrins separat
begränsade kontrollföljdsprojektion för att visa klassens bana; ändringsvägar
och banversionernas historik påverkas inte.
ADR-0070/migration0044 inför nullable deltagartak med separat capacityVersion
och immutable ändringsjournal. Samma administratörssession sätter taket.
Transfer, direktanmälan, äldre klassbytesvägar och EntryList-import följer
samma gräns under racelås. Import kontrollerar hela slutläget före commit.
Gamla klassbytes-v1-kontrakt bevaras; även deras writes kontrollerar taket.

## TASK030: brickbyte i samma arbetsvy

ADR-0071 ansluter CHANGE_ENTRY_CARD uttryckligen till MANAGE_RACE. Befintlig
mutation/journal återanvänds med verklig auditaktör. Gemensamt deltagarunderlag
innehåller aktiva brickkopplingar i samma repeatable-read som klass/start;
flertydig aktiv koppling markeras och får inte godtyckligt väljas. Dedikerad
admin-PATCH använder samma cookiegräns och full kvittensbindning. Ingen
migration eller ny session behövs. Webben äger ett gemensamt väntande intent
för klassbyte, deltagartak eller brickbyte; ingen parallell mutationskö.

## TASK031: individuell starttid och kompakt åtgärdsväljare

ADR-0072 ansluter CHANGE_ENTRY_START_TIME till samma administratörsroll och
återanvänder befintlig journal/tjänst utan migration. SQL-precisionskontroll
före Date-konverterad jämförelse skyddar listning, aktuell tid och båda
journaltider; inget lagrat mikrosekundvärde får tyst kvitteras avrundat.
Gemensam workspace visar en åtgärd i taget (klass/brick/starttid) med samma
deltagarval, session och pendingintent. Endast FIXED har tidsrättningsformulär.

## TASK032: explicit omräkning i samma administratörsvy

ADR-0073 ansluter RECALCULATE_RESULT med verklig adminaudit. Befintlig
resultattjänst/journal och publiceringssemantik återanvänds utan migration.
Separat kandidat-GET fångar readout/revision som kan ändras utan ny snapshot;
webben binder kandidaten till aktuellt roster innan granskning. Fjärde
åtgärden delar session/pending men startar aldrig omräkning automatiskt.
Ny teknisk publicerad revision är inte ett återtagande av manuella beslut.

## TASK033: gällande resultat vid en deltagare

ADR-0074 inför exakt MANAGE_RACE-skyddad enskild-entry-läsning under RR/race
SHARE. Senaste publicerade revision går genom befintlig central resolver och
strikt provenancevalidering; inga egna overlayregler finns i webben. Svaret
skiljer ingen publicering från återtaget/aktivt resultat och anger historisk
resultatklass/snapshot separat från aktuell entry. GoverningDecision visar
högst ett styrande beslut, inte en historiklista. UI binder scope/version och
hämtar inom befintlig operation; ingen ny mutation, migration eller polling.

## TASK034: namn och klubb med samma administratör

ADR-0075 ansluter CHANGE_ENTRY_IDENTITY till MANAGE_RACE och återanvänder
befintlig rättningstjänst. Migration0045 utökar journalens capability-check;
den sammansatta actor/race/capability-FK:n behålls. Journal/audit använder
verklig aktör. Separat identity-candidates GET lämnar strukturerade namn;
webben matchar snapshot/entry/klass/version mot roster och delar befintligt
pendingintent. Identity-PATCH har TASK026:s8KiB-gräns och full kvittensbindning.
Ingen namnuppdelning, global personfusion eller automatisk resultatändring.

## TASK035: direktanmälan med samma administratör

ADR-0076 ansluter REGISTER_ENTRY med verklig adminaudit. Befintlig tjänst,
immutable journal och race-låst platskontroll återanvänds utan migration.
POST registration ligger inom samma admincookiegräns med4KiB och full
kvittensbindning. Ny deltagare öppnar registreringsläge utan vald entry;
samma roster ger klass/bana/startregel/platsläge. Efter kvittens väljs skapad
entry för fortsatt rättning. Ingen automatisk dubblettfusion eller resultatstatus.

## TASK036: rådgivande dubblettsökning

ADR-0077 kopplar ADR-0068:s rena matchning till skyddad RR-läsning med CSRF,
race SHARE och exakt snapshot. Alla entries/klassrelationer kontrolleras före
max20-träffprojektion; även inaktivt brickägarskap ingår. Gemensam admin-POST
skriver inget. Registreringsgranskning visar kandidatval, namncheckbox och
brickspärr, medan redan skickat intent retryas utan ny sökning. Den separata
begränsade TASK028-operatörsvyn aktiveras inte automatiskt.

## TASK039: journalförda deltagarändringar

ADR-0078 samlar sex befintliga enskilda deltagarjournaler i en skyddad
applicationläsning med MANAGE_RACE, RR/race SHARE och versionsbaserad sidgräns.
Webb lagrar bara aktuell sida i minnet och visar frysta före-/eftervärden.
Klassnamn slås upp i dagens register och märks som sådana. Detta är inte
fullständig resultat-/import-/lottnings-/avprickningshistorik. Inga journaler
eller behörighetstilldelningar ändras; läsvägen kräver ingen ny funktionslogin.

## TASK040: DNS och rättning med gemensam administratör

ADR-0079 ansluter befintliga manuella DNS-/withdrawal-tjänster till MANAGE_RACE
genom två uttryckliga policyåtgärder. Verklig adminaudit bevaras, inte en
maskerad funktionsaktör. Befintlig domänpolicy, lås, historik och central
effektiv resultatprojektion återanvänds; ingen ny databasmodell eller status.
Gemensam webbarbetsvy erbjuder både beslut och återtagande med samma session.

## TASK041: DNF och rättning med gemensam administratör

ADR-0080 ansluter befintliga DNF-/withdrawal-tjänster till samma MANAGE_RACE-
session. Policyn omfattar nu12 integrerade åtgärder; äldre begränsade roller
behålls. Sann adminaudit och befintlig lås-/resultatmodell återanvänds.
Återtagande fryser exakt teknisk källa och appendar restaureringsrevision;
senare avläsning upphäver inte DNF automatiskt. Kvittens binder revision och
återställd status/reason. Inga nya domängränser, statusar eller migrationer.

## TASK042: diskvalificering i gemensam administration

ADR-0081 ansluter befintliga DSQ-/withdrawal-tjänster till MANAGE_RACE, nu14
integrerade åtgärder. Samma adminsession används för kandidatunderlag,
granskning, beslut och rättning. Sann adminaudit och gamla begränsade roller
bevaras. Aktiv DSQ över senare teknik och exakt restaureringsrevision följer
ADR-0031; routes/UI innehåller ingen egen resultatmotor eller fallbackpolicy.

## TASK044: manuellt godkännande i gemensam administration

ADR-0082 ansluter APPROVE_RESULT och WITHDRAW_RESULT_APPROVAL, nu16 integrerade
åtgärder under MANAGE_RACE. Befintlig tidskomplett MP-policy och teknisk
restaurering enligt ADR-0032 återanvänds med sann adminaudit. UI visar status,
orsak och placeringspåverkan direkt, med tekniska detaljer utfällbara. Inga
nya resultatregler, schemaändringar eller alternativa resultathuvuden införs.

## TASK104: rättning av observerad PUNCH-start

ADR-0118 inför en enda `MANAGE_RACE`-skyddad append-only skrivväg för en
dokumenterat felaktig observerad start i en PUNCH-klass. Application lagser
och låser race/entry, kontrollerar exakt teknisk källa/readout/start och
skapar immutable journal, revision och audit i samma transaktion. Domänlagret
räknar om start-, löp- och splittider; route och React visar endast kandidat,
granskning och samma retry-intent. Råmeddelanden, CardReadout, snapshots,
stationpaket och gamla revisioner ändras inte. Publikresultat, speaker och
IOF får endast läsa den centralt proveniensvaliderade revisionen.

## TASK105: återtagande av observerad PUNCH-starträttning

TASK105 är en separat append-only väg, inte en generell resultateditor. Den
får endast återställa TASK104:s omedelbara direkta tekniska källa när den
korrigerade revisionen ännu är absolut huvud. Den immutable journalen, den
nya revisionen och audit skrivs atomiskt under race-/entrylås. Alla läsare
validerar hela trestegskedjan innan publicering, IOF-export, speaker eller
historik kan använda resultatet.

## TASK134: läsande källpreflight för operativ backup

ADR-0115:s skrivstoppade backupgräns delas här i ett säkert läsande steg före
varje dump- eller restorewriter. Application hämtar faktisk Drizzle-migration
och den stabilt sorterade PM-referensuppsättningen i en enda `REPEATABLE READ,
READ ONLY`-snapshot. En injicerad infrastruktursport verifierar sedan varje
referens med den redan befintliga PM-läsaren: samma `storeId`, nyckel,
`versionId`, hash och längd måste vara läsbar. Först därefter byggs det redan
stricta canonicala backupmanifestet från operatörens explicita
skrivstoppbekräftelse och ett deklarerat dumpunderlag. Kontraktlagret äger
normaliseringen så application och infrastructure kan använda samma ordning;
infrastructure-adaptern kan endast kalla den befintliga versionsbundna
PM-läsaren.

Vägen skriver inte till PostgreSQL eller objektlagring, kör inte `pg_dump`,
läser inte dumpbytes och skapar ingen MinIO-regel/resync. Det är alltså ett
källbevis, inte en backup eller restore. Den kommande skrivande kedjan behöver
fortfarande ett separat ADR för TASK133:s testade resync som driftmekanism,
konsistenspunkten, målmiljö, behörigheter och rollback.

## TASK099: skrivstoppad operativ backup och restore efter ADR-0140

ADR-0140 gör TASK133:s enbart syntetiskt bevisade MinIO-resync till en smal
framtida backupmekanism, inte en löpande replika. När alla O-Tid-writers är
stoppade skapar den privata driftskedjan först en PostgreSQL/PostGIS-dump och
använder TASK134:s läsande källpreflight för migration, PM-referenser och
exakta objektbytes. Därefter får den skapa en `existing-objects`-
replikeringsregel till en ny tom privat, versionerad MinIO-målmiljö och begära
explicit resync. Den vanliga PM-läsaren måste läsa varje manifestreferens från
målet med källans oförändrade version-ID, hash och längd innan en hemlighetsfri
backupkvittens kan utfärdas.

Regeln tas bort eller stängs av innan writers kan återupptas. Återställning
använder den redan verifierade målmiljön och importerar dumpen endast till en
ny tom PostGIS-databas; den återanvänder TASK099:s skrivskyddade
historikverifierare och får inte skapa resultat, journaler eller ändrade
PM-referenser. Källbucket får inte ha någon annan replikationsregel och privat
operation-state, med läge 0600 men utan credentials, gör avbruten cleanup
återupptagbar innan writers öppnas igen. Source-/targetcredentials, endpointar
och target-ARN stannar i privat driftkonfiguration. `packages/application` har en ren, injicerad
ordningsmotor som kräver dump → source-preflight → tomt mål → replikering →
varje målläsning → regelrensning innan den återger ett hemlighetsfritt kvitto.
Den öppnar ingen process, databas eller objektanslutning. Private
infrastructure-/CLI-adaptrar och en isolerad fullkedjekörning saknas därför
fortfarande; detta är inte ett produktionspåstående.

TASK139 lägger innan sådana adaptrar ett strict, hemlighetsfritt
operation-state-kontrakt i den rena kedjan. `DUMP_PENDING` sparas före dumpen
med null-hash eftersom manifestet ännu inte finns. Efter källpreflight måste
`TARGET_PREPARATION_PENDING`, `REPLICATION_MAY_EXIST`, `CLEANUP_REQUIRED` och
slutligen `CLEANUP_VERIFIED` bära samma canonicala manifesthash och sorterade
unika `storeId`:n. Varje state-portfel är fail-closed; efter en möjlig regel
försöker kedjan fortfarande cleanup men lämnar ingen kvittens. Detta är en
ordningsport, inte den ADR-0140-krävda privata 0600-filadaptern.

TASK140 tillför den privata fileadaptern till denna port: en enda recorder
reserverar en ny `<backup-id>.json` i en explicit 0700-katalog utanför
repositoryt, uppdaterar bara direkta faser genom synkad atomär 0600-ersättning
och lämnar `CLEANUP_VERIFIED` läsbar som privat historik. Läsaren avvisar
symlänk, fel UID/mode, hardlink, överstor/korrupt JSON och fel backup-id utan
att läcka sökväg eller innehåll. Ingen driftkedja har ännu kopplat in adaptern
eller ett MinIO-kommando; TASK137 är fortsatt grinden för den delen.

TASK141 provar denna portgräns med ett sammansatt, syntetiskt
application/infrastructure-flöde: den rena capture-orkestreringen anropar
filrecorderns state-port och den slutliga lästa statefilen binds till samma
kvittenshash och logiska store-id:n. Det är ett test av kontraktskomposition,
inte en drift-CLI eller en verklig backup: dump, databas, MinIO, `mc`,
credentials och privat source-/targetkonfiguration är fortsatt frånkopplade.

TASK166 binder TASK148:s uppmätta, redan tillhandahållna dumpbevis till
TASK147:s läsande restoreordning. Application jämför identitet, SHA-256 och
längd med manifestet före varje PM- och databasläsning. Porten öppnar ingen
fil och kan inte bevisa att en måldatabas faktiskt återställdes från just
dessa bytes; körbar dump/restore och isolerad fullkedjeacceptans återstår.

TASK169 har därefter kört en riktig syntetisk `pg_dump -Fc`/`pg_restore`
till ett nytt tomt PostgreSQL/PostGIS-mål. TASK137:s pinnade MinIO-resync
och regelrensning har också passerat. TASK170 binder dessa till ett enda
syntetiskt kompositbevis: den historiska PM-version som källans manifest
anger läses via den vanliga PM-läsaren från det nya MinIO-målet före den
återställda databasens läsande historikbevis. TASK170 är fortfarande ett
testägt förlopp: ingen sammansatt betrodd backupåtgärd, faktisk
operatörspaus, återstartbar drift-CLI eller internet-/fältacceptans har
levererats.

TASK171 levererar första konkreta skrivporten för ADR-0140:s framtida
`createPostgresDump`: ett uttryckligt valt PostgreSQL-underlag skrivs som
custom-formatdump till en ny privat 0600-fil via absolut `pg_dump`-binär,
och samma färdiga fil mäts för captureordningen. Ett opt-in-prov återställde
just den filen i TASK170:s syntetiska kompositkedja. Porten väljer aldrig
databas eller backupmål implicit och utfärdar inte ett backupkvitto.
Källpreflight, objektmål/resync, operativ statekoppling och återhämtning
kopplas in i senare D1b.4-snitt. Detta ändrar inte domän- eller resultatregler.

TASK172 återanvänder den redan beslutade `TARGET_PREPARATION_PENDING` som
stopp efter lyckad källpreflight: fasen betyder att målet ännu **inte** har
preparerats. Application validerar run-intent före I/O, låter TASK140:s
privata statefil nå `DUMP_PENDING` före TASK171:s dump och binder därefter
TASK134:s läsande migrations-/PM-bevis till samma dump och backup-id.
Source-only-resultatet är ett källbevis, inte en backupkvittens. Den
befintliga fulla captureordningen fortsätter först efter denna gräns. En
syntetisk opt-in-komposition med verklig PostgreSQL och pinnad lokal MinIO
provar källan och fortsatt restore, men väljer inte operativt mål,
skrivstoppsmekanism, recovery-CLI eller fältdrift.

TASK173 levererar nästa läsande målsteg i samma ADR-0140-kedja. En privat
operatörsattestation binder ett uttryckligen separat, nyskapat mål-id till
backup-id; eftersom SDK-listning inte kan bevisa serverns ålder är detta
fortfarande ett externt antagande tills en betrodd provisioner finns.
Infrastructure ska före regelstart jämföra TASK172:s källbevis och den
faktiskt lästa `TARGET_PREPARATION_PENDING`-filen med privat
`storeId`→bucketkonfiguration. En enda explicit målendpoint måste då ha
exakt de förväntade versionerade bucketsen, utan aktuella eller historiska
objekt/delete markers, multipart uploads, policy eller replikeringsregel.
Alla kontroller är läsande och fail-closed; beviset är inte en backupkvittens.
En ny pinnad MinIO-loopbackinstans passerade det syntetiska opt-in-provet före
regelstart, men provisionerings- och exklusivitetsintyget är ännu inte en
återstartsbar operativ konfiguration.

TASK174:s första del skapar en **separat** privat återstartsbindning, skild
från den hemlighetsfria operation-state-filen. Den lagrar backup-id,
manifesthash, target-id, canonical endpoint, sorterad store-/bucketmappning,
credentialreferens utan hemlighet och identiteten hos ett ägarägt 0700-
dataområde under en kontrollerad privat katalog. Filen publiceras atomärt
write-once som 0600 och läses om med fail-closed kontroller av fil,
dataområde och bindning. Bindningsporten ensam skapar inte MinIO eller
bevisar ny/exklusiv instans. En separat betrodd, hashpinnad lokal
darwin-arm64-loopback-provisionerare reserverar nu backup-id exklusivt,
skapar nytt privat dataområde och separat credentialfil, skriver bindningen
före MinIO-start och kör TASK173 mot exakt återläst mål. Barnets utdata
kasseras i detta lokala prov, så inga credentials kan hamna i dess logg.
Kontrollerad
omstart av samma dataområde är syntetiskt verifierad; upptagen endpoint,
osäker credentialfil och objektförorening avvisas. Ett explicit source-only-
läge i TASK170:s opt-in-härva binder nu verklig TASK172-källinsamling och
privat state till denna provisionerare och TASK173:s läsande målbevis för
exakt samma backup-id/hash/store-id, utan någon replikeringsregel.
TASK174 har därefter lokalt provat abrupt krasch kring reservation/bindning
mot pinnad MinIO. Ett source-only-omprov stannade dock säkert efter
startmarkören utan fastställd orsak; målstart är inte driftaccepterad.
Detta är ännu inte driftsatt backup: produktions-TLS/isolation,
regel/resync/cleanup i en betrodd åtgärd och restore-CLI saknas.

TASK175 avgränsar nästa privata objektsteg till **en** PM-store från samma
TASK172-källbevis och ett exakt återläst TASK174/TASK173-mål. Infrastructure
äger den pinnade `mc`-processen och privata credentials, medan application
behåller ordningen för `REPLICATION_MAY_EXIST` före regelstart,
`CLEANUP_REQUIRED` och `CLEANUP_VERIFIED`. Regeln får ett deterministiskt
backupbundet ID. Befintliga eller okända källregler avvisas; endast egen regel
får rensas. Den pinnade servern avvisar `remove --id` när regeln är den sista;
ADR-0140 tillåter därför `remove --all --force` endast efter färsk kontroll
av exakt den ensamma ägda regeln, följt av en ny nollregelläsning. Konkurrerande
konfigurationsskrivare måste vara uteslutna före produktionsbruk. `resync`
startar kopiering men målbevis kommer bara från vanliga PM-läsarens exakta
manifestversioner med hash/längd. Vid tappat kommandosvar eller fel efter
regelstart försöks riktad cleanup, och en avbruten process kräver betrodd
återstart från privat state/bindning innan writers kan öppnas. Snittet
utfärdar ingen backupkvittens, gör ingen restore och använder inga verkliga
tävlings-/produktionscredentials. Se [TASK175](../TASK_175_PRIVATE_ONE_STORE_REPLICATION.md)
och ADR-0140; inget nytt teknik- eller domänbeslut fattas här.

TASK176 komponerar de befintliga portarna utan ny domänmodell: TASK172:s
faktiska syntetiska PostgreSQL-dump och enda DB-refererade PM-version går
genom TASK174:s återlästa målbindning och TASK175:s en-store-resync/cleanup.
Den andra historiska versionen av samma objekt är inte ett krav i det
DB-bundna beviset och inte en fabricerad extra `pm_object_manifest`-rad.
Mål-DB hålls tom och
orörd; ingen backupkvittens, restore eller writer-release skapas. Se
[TASK176](../TASK_176_SOURCE_REPLICATION_COMPOSITION.md) och ADR-0140.
MinIO-målets HTTP-livstecken är inte ensam S3-beredskap: en bounded,
autentiserad läsning måste lyckas före bucket-skrivning. Misslyckad
målpreparering lämnar reservation/startmarkör och får inte repareras genom
återanvändning av samma backup-id.

TASK177 löser fasägarskapet före kvittens: application skriver bara
`DUMP_PENDING` och `TARGET_PREPARATION_PENDING`; TASK175-porten skriver
`REPLICATION_MAY_EXIST`, `CLEANUP_REQUIRED` och `CLEANUP_VERIFIED` samt
rensar den enda egna regeln. En separat slutkontroll läser varaktigt state,
regelstatus, exakt mål-PM och dump innan application får lämna ut enbart
backup-id, manifesthash och objektantal. Det fulla manifestet förblir
privat. Se ADR-0159 och [TASK177](../TASK_177_MANAGED_BACKUP_RECEIPT_GATE.md).

TASK178 återanvänder i ett isolerat syntetiskt opt-in-prov **samma**
TASK177-kvitterade manifest, privata dump och bundna MinIO-mål medan
captureprocessen lever. `pg_restore` skriver bara till en ny tom PostgreSQL17-
databas. Den befintliga läsande restoreverifieraren kräver exakt historisk
PM-version, DB-referens och tävlingshistorik; inga version-ID:n översätts.
TASK179 lägger därefter till ADR-0159:s privata write-once-completionfil.
En **separat process** återöppnar den med uttryckliga privata kataloger,
kontrollerar åter dump/state/målbindning och läser samma historiska PM-version
från det färdiga pinnade målet före restore till ny tom DB. Det är syntetiskt
verifierat, inte en körbar produktionsbackup. Tekniskt skrivstopp och exklusivt
ägande av källans replikeringsregler är fortfarande egna grindar.

ADR-0160 väljer för TASK180 ett synligt, installationstäckande process-/
ingress-stopp som ska dränera webb, framtida worker och betrodda CLI innan
backupgrund läses. Nuvarande Compose startar bara datatjänster; ingen konkret
supervisor som kan hindra alla writers från återstart finns ännu i projektet.
`writeStopConfirmed` förblir därför ett operatörsintygande, inte ett tekniskt
stoppbevis. ADR-0160 väljer en dedikerad Linux/systemd-installation som första
målprofil; den är ännu inte implementerad eller provad på Linux. En faktisk
controller, täckningsmatris och syntetiskt samtidighetsprov krävs innan
TASK180 eller D1b.4 kan markeras verifierad. Se
[TASK180](../TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md) och
[ADR-0160](adr/ADR-0160-technical-writer-stop-process-boundary.md).
En 2026-09-27-källgranskning fann en särskild grind **före** controllern:
Nexts pinnade standalone-server väntar på öppna HTTP-svar vid SIGTERM,
men det är inte verifierat att arbete efter ett klientavbrott och ett
objektsteg mellan två DB-transaktioner dräneras. Endast proxyinsläpp eller
tom cgroup är inte tillräckligt. Se
[dräneringsgranskningen](research/next-standalone-writer-drain.md).

## TASK135: avkortad bana som separat kortklass

ADR-0139 håller avkortning utanför TASK084:s vanliga banrättning och utanför
en ny per-entry-variantmotor. En `MANAGE_RACE`-skyddad, hashbunden operation
skapar i stället en ny lokal Course/version/Class med en strikt kortare prefix-
kontrollföljd och flyttar uttryckligt valda Entries atomiskt från en källklass.
Klassens startregel och Entryns aktiva bricka/fasta starttid behålls. En aktuell
direkt teknisk `MP` kan omvärderas från samma råa readout och bli en ny
append-only revision; ingen `OK`, overlay, rawdata eller äldre revision skrivs
om.

Kortklassen är en verklig separat klass. Befintlig ranking, stationpaket,
publik lista, IOF och finalisering fortsätter därmed att använda historisk
klass-/banidentitet och jämför aldrig lång/kort bana mot varandra. Startlistan
förblir fryst tills den explicit publiceras på nytt. Ingen Eventor-identitet,
GPS, karta/rutt eller ny fysisk avläsning tillkommer.

## TASK142: privat betalstatus utan betalplattform

ADR-0141 gör betalstatus till en snäv intern administrativ uppgift på `entry`,
inte en ny del av tävlings- eller resultatmodellen. `UNMARKED` är det enda
säkra defaultläget; `UNPAID`, `PAID` och `WAIVED` är manuella markeringar och
aldrig kvitto, fordran eller transaktion. `MANAGE_RACE` med CSRF låser race och
entry, binder `entryVersion`, klass och en separat `paymentStatusVersion` till
requestet och committar aktuell status, immutable journal och audit i samma
transaktion. Exakt samma request återger sin kvittens; ändrat intent, aktör
eller stale underlag avvisas.

Den separata versionen höjer avsiktligt varken `entry.version` eller
`race.snapshotVersion`: startlistor, resultat, IOF-export, stationpaket,
finalisering och publikprojektion behöver inte omvärderas för en privat
administrativ markering. Däremot hindrar en senare klass-, namn-, start- eller
brickändring den gamla betalstatusavsikten genom dess bundna entryversion.
Statusen läses och ändras bara i den autentiserade tävlingsadministrationen;
den ingår inte i publik- eller deltagarvyer, Eventor, IOF, speaker,
offlineavprickning eller generell deltagarhistorik. Belopp, valuta,
Swish-/OCR-referens, faktura, återbetalning och betalprovider kräver ett eget
senare ADR.

## TASK143: återanvändning av återlämnad hyrbricka

ADR-0142 gör en fysisk hyrbricka återanvändbar inom ett lopp utan att göra
brickhistorik till en skrivbar ägarpost. En explicit `MANAGE_RACE`-operation
binder en aktiv, hyrd och återlämnad källassignment till en annan Entry utan
aktiv bricka. Under samma race-lås gör den källan inaktiv, skapar en ny
assignment för målet med samma nummer och `rentalReturned=false`, höjer båda
entryversionerna och loppets snapshot samt appenderar immutable journal/audit.

Databasen bevarar varje assignmentidentitet och tillåter i stället högst en
**aktiv** `(race, card number)`-rad. Direktanmälan och vanligt brickbyte får
inte använda den utvidgade historiken för att överta en annan deltagares
tidigare nummer. Resultat, rawdata, export/finalisering och den gamla
returjournalen ändras aldrig; nästa signerade stationspaket får den nya aktiva
kopplingen först genom den vanliga snapshotuppdateringen. Ingen global
brickpool, betalning eller fysisk hårdvara införs.

## TASK144: privat historik projicerar återanvändning utan ny skrivmodell

TASK144 läser enbart ADR-0142:s immutable reuse-journal genom den existerande
`MANAGE_RACE`-skyddade deltagarhistorieprojektionen. Varje journalrad
projiceras separat för käll- och måldeltagaren med den sparade riktningen,
bricknumret, tiden och entry-/snapshotversionerna. Varken journalens interna
identifierare, actorcredential eller den andra deltagarens identitet är en del
av kontraktet. Ingen ny route, tabell, capability eller generisk
historieinfrastruktur införs.

## TASK159–160: kontoaktivering och ägarstyrd kontoinbjudan

ADR-0152/TASK159 införde en betrodd server-CLI som skapar en kortlivad
engångsinbjudan till ett ännu obefintligt normaliserat konto. PostgreSQL
bevarar immutable issue/redemption/revocation, endast kodhash och en
per-loginName reservationsrad. `/activate` skapar konto och första
`scrypt`-verifierare atomiskt utan event-, race- eller entrybehörighet.

ADR-0153/TASK160 utökar endast **utfärdaren**: aktuell event-OWNER kan i
kontoskyddad `/organizer`-yta utfärda och spärra en eventbunden
kontoinbjudan. En immutable journal binder A3a:s invitation-id till exakt
event och actor; klienten skapar engångskoden med Web Crypto och skickar
endast hash. Kontoaktivering behåller A3a:s rättighetslösa transaktion.
Först ett separat, explicit A2-ADMIN-beslut för det aktiverade kontot ger
access till eventet. Varken eventbindning, namnmatchning eller inlöst kod
är en grant. Skrivordningen är kontosession → event/aktiv OWNER →
loginName-reservation → issue/revocationjournal och audit; aktivering
behöver aldrig eventlås. Station/offline, resultatrevisioner och publikvy
förblir utanför denna identitetsgräns.

## TASK161: betrodd återställning av befintligt konto

ADR-0154 skiljer en **befintlig** kontoåterställning från A3a/A3b:s
nykontoinbjudan. En betrodd serveroperatör intygar identitet utanför
systemet och utfärdar en 24-timmars engångskod bunden till exakt konto-ID,
loginName och aktuell verifierarversion. Endast hash och immutable issue-/
revokejournal sparas; privat CLI-artefakt skrivs före issue-transaktionen.
Mottagaren skapar nästa permanenta hemlighet på sin egen enhet och löser in
online utan tidigare session. Samma transaktion appenderar ny `scrypt-v1`-
verifierare och immutable redemptionjournal; ingen session skapas automatiskt.

Gammal konto- och race-delegerad session faller på befintlig versionskontroll
efter commit. Kontoraden och authvakt är låsgräns för inlösen/rotation;
en separat per-login gissningsspärr hanterar även okända namn. Eventgrant,
anmälningskoppling, följval, rutt och resultat ligger utanför denna skrivning
och omprövas först av sina ordinarie kontroller vid ny login. Ingen event-
OWNER får global reset-rätt av sin A3b-inbjudningsrätt. Se TASK161.

## TASK162: relativ uppspelning av egen privat rutt

ADR-0155 använder C2b:s redan kontobundna och historiskt exakta
GPX-/kart-/banprojektion. Samma serverläsare härleder relativa tidsvärden
från den ordnade GPX-punktserien endast när `deriveRouteMetadata` intygar
komplett monoton tid. Det privata överläggets formatversion 2 innehåller
pixelpunkter och en diskriminerad playback-serie eller `UNAVAILABLE`;
WGS84, objektadress och intern proveniens förblir på servern. Befintlig
ren pixelinterpolering får återanvändas i klienten, men segmentbrott är
luckor och kontrollringar är historisk banlayout, inte GPS-bevis för stämpel.
Ingen migration, ny läsrätt, ruttpublicering eller tidsmotor införs.

## TASK163: resultatsträckor är en separat privat läsprojektion

ADR-0156 låter den redan ägarkontrollerade overlay-läsningen bära en liten
`resultSplits`-projektion från det aktuella effektiva publicerade
resultathuvudet för exakt samma entry och historiska bana. Resultathuvudets
strikt validerade tider är en annan beviskedja än GPX-punkterna och deras
relativa uppspelning. Kontraktets formatversion 3 exponerar revision och
kontroll-/sträcktider eller `UNAVAILABLE`, aldrig intern identitet eller
geografisk koordinat. Ingen ny writer, migration, cache eller behörighet
införs; äldre klientformat avvisas neutralt.

## TASK164: egen GPX-klockjustering är tillfälligt visningstillstånd

ADR-0157 lägger endast en aktuell, strikt validerad resultatstart i samma
ägarkontrollerade privata overlay som redan bär pixelrutt, GPX-tid och
publicerade resultatsträckor. Resultatstarten kommer från effektiv
publicerad revision för exakt anmälan/bana; formatversion 4 avvisar äldre
klientform. En ren klientfunktion räknar var resultatstarten ligger i den
oförändrade relativa GPX-tidsserien efter deltagarens tillfälliga signerade
klockjustering. Ingen punkt, split, revision, server- eller offlinekö
skrivs; utanför tidsserien finns ingen hoppunkt.

## TASK165: en resultattid kan visas på privat GPX-tidslinje

ADR-0158 återanvänder TASK164:s kontoskyddade overlay utan ny API-form
eller serverläsare. Endast samma effektiva resultatrevisions start och
ackumulerade kontrolltid får kombineras med användarens tillfälliga
GPX-klockjustering. Klientens rena beräkning kan söka en enda tidpunkt i
den befintliga uppspelningen, men varken banans kontrollposition eller
GPS-punkternas närhet får användas som passagebevis. En segmentlucka
interpoleras inte. Val, offset och markörläge stannar i sidans minne;
ingen migration, writer, ny behörighet eller publiceringsväg tillkommer.

## TASK185: förberedelser, deltagardetalj och administratörsspeaker

ADR-0161 utökar ADR-0074:s privata effektiva resultat med valfria
kontrolluppgifter från exakt effektiv revision och historisk banversion.
Application mappar lagrade splits på kontrollkod och fysisk förekomst;
UI formatterar bara. Ingen resultatutvärdering flyttas till webben.
En separat namngiven MANAGE_RACE-läsare återanvänder speakerprojektionen;
den fristående speakerns VIEW_SPEAKER_BOARD-gräns är oförändrad.

Före har Upplägg/Banor/Klasser/Deltagare/Lottning/Startlista/Funktionärer.
Under har Läget/Alla deltagare/Speaker/Tid- och kontrollrättning. Samma
monterade deltagararbetsyta används i alla lägen; pågående beslut behåller
sin granskning/retry. Speaker och läsande banöversikt monteras endast när
de visas. Inga nya writers, migreringar eller paket tillkommer.

## TASK211: långlivad publik SSE vid styrt skrivstopp

ADR-0160:s fail-closed markör för HTTP-insläpp gäller också en redan öppen
publik resultatström: den kontrolleras före strömstart, efter asynkrona steg,
vid notifiering och på heartbeat och stänger då strömmen med lokal
subscriber-/timercleanup. Den omanagerade utvecklingsprofilen fortsätter som
tidigare. Detta är livscykelhygien för ett läsande HTTP-svar; den globala
LISTEN-klienten och alla accepterade skrivande anrops DB-/objektsteg måste
fortfarande dräneras och verifieras separat enligt TASK180.
