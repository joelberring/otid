# Domänregler i TASK 001

## Modellgränser

- `Event` är arrangemanget; `Race` är ett individuellt lopp inom arrangemanget.
- `Class` hör till ett lopp och pekar på en bestämd `CourseVersion`.
- `Course` är den stabila identiteten. `CourseVersion` är append-only och äger en
  ordnad följd `CourseControl` som pekar på `Control`.
- `Entry` är deltagandet i ett lopp, inte personen som generell identitet.
- `CardAssignment` kopplar ett bricknummer till en `Entry` för loppet.
- `NormalizedCardReadout` är en tolkad representation av oföränderlig rådata.
- `EvaluationResult` är ett rent kortberäkningsutfall. `DidNotStartResult` och
  `DidNotFinishResult` är separata manuella utfall; `ResultOutcome` är unionen
  som får lagras i en resultatrevision.
- `ResultRevision` är en append-only lagrad bedömning med orsak och versionsdata.

Alla interna identiteter är UUID. Externa identiteter lagras med källsystem och
får inte användas som primärnyckel.

## Resultatutvärdering

`evaluateCardReadout(readout, snapshot)` gör ingen I/O och läser inget globalt
tillstånd. Motorn kräver endast `EvaluationReadout`-fälten bricknummer, valfri
startstämpling, valfri målstämpling och stämplingar. Serverns
`NormalizedCardReadout` utökar denna input med identitet och auditmetadata.
För TASK 001 gäller:

1. Aktiv brickkoppling saknas: `UNKNOWN_CARD`; inget tävlingsresultat skapas.
   TASK085 får därefter endast genom en explicit, racebunden och idempotent
   `MANAGE_RACE`-resolution koppla exakt den lagrade `readoutId`:n till en
   befintlig eller ny Entry. Råmeddelande, normaliserad avläsning och första
   ingestutfall ändras aldrig; resolutionen append:ar i stället en egen
   `UNKNOWN_READOUT_RESOLUTION`-revision och journal/audit.
2. Starttid väljs från startstämpling när klassregeln är `PUNCH`, annars från
   deltagarens fasta starttid.
3. Målstämpling krävs för en sluttid. Saknad start eller mål ger `MP` med stabil
   förklaringskod.
4. Kontroller matchas som en ordnad delsekvens. Extra stämplingar ignoreras för
   godkännandet men redovisas.
5. Saknad obligatorisk kontroll ger `MP/MISSING_CONTROL`.
6. En obligatorisk kontroll som endast förekommer efter en senare obligatorisk
   kontroll ger `MP/WRONG_ORDER`.
7. Om banan kräver samma kod flera gånger måste lika många förekomster matchas i
   rätt ordning. Övriga förekomster redovisas som extra.
8. Ett godkänt resultat får status `OK`; löptid och sträcktider räknas i hela
   millisekunder från vald start till kontroller och mål.

Motorn returnerar stabila koder. Svenska texter hör till UI/översättningslagret.
TASK 005B kör samma export lokalt i stationen. Den lokala bedömningen är
preliminär, versionsmärkt och append-only lagrad; den skapar ingen
`ResultRevision` och ändrar inte serverns auktoritativa bedömning.
TASK 005C hashar den fulla bedömningen canonicalt för transportjämförelse och
sparar den första serverbedömningen som append-only ingestutfall. Detta är ett
retry-/auditobjekt, inte en ny resultatrevision eller en alternativ resultatkälla.
TASK 005D inför `StationDevice`, `StationCredential` och
`StationCredentialRevocation` som säkerhets-/adapterobjekt. De hör inte till
resultatmotorn och påverkar inte `EvaluationResult`, resultatrevisioner eller
råmeddelandets idempotens. Credentialscope avgör endast om en request får nå
ingestgränsen.
TASK 005E inför `StationPairingGrant`, `StationPairingAttempt` och
`StationPairingRedemption` som append-only säkerhetsobjekt. De provisionerar en
credential men är inte tävlings-, resultat- eller rådatadomän. Ett grant får
exakt en redemption; retry identifieras av samma attempt/device/hash och skapar
aldrig en ny credentialgeneration.
TASK 005F inför racebunden `PairingOperatorAccessCredential` och
`PairingOperatorSession` som adapter-/säkerhetsobjekt med endast capabilityn
`PAIR_STATION`. De är inte deltagaridentitet, generell arrangörsroll eller del av
resultatdomänen. En sessionsaktör får endast skapa, lista och spärra pairinggrant
för credentialens exakta race. Grantets issuer och auditaktör är append-only;
inga token-, secret- eller hashvärden är domändata.
TASK 005G generaliserar endast säkerhetssubstratet till den separata capabilityn
`IMPORT_IOF`. En sådan accesscredential får importera CourseData eller EntryList
för exakt sitt race men får inte administrera pairing. `IofImportRequest` är ett
append-only retry-/auditobjekt som binder request-id, actor, race, serverhash,
importfil och ursprungligt utfall. Det är inte en tävlingsrevision, deltagar-
identitet eller alternativ importkälla. Endast en ny innehållslagring ändrar
domänobjekt, snapshot och mutationsaudit; content-duplicate och exact replay gör
inte det.
TASK 005H lägger till den separata capabilityn `CHANGE_ENTRY_CLASS`.
`EntryClassChangeRequest` är ett append-only säkerhets-/retryobjekt som binder
en intern requestidentitet till actor, race, entry, förväntad version och
ursprungligt klassändringsutfall. Det är inte en deltagaridentitet eller
resultatrevision. Endast en verklig klassändring ökar entry- och snapshotversion
och skapar actor-audit; stale, no-op och exact replay gör inte det.
TASK 005I lägger till `RECALCULATE_RESULT` för en separat operatörsinitierad
resultatmutation. `ResultRecalculationRequest` binder actor och fryst
entry-/klass-/snapshot-/assignment-/readout-/revision-/motorgrund till exakt en
ny immutable `ResultRevision`. Den är ett retry-/auditobjekt, inte ett alternativt
resultat. Exact replay skapar ingen ny revision; en medveten ny request efter
refresh gör det även om evaluation blir identisk.
TASK091 utökar inte detta till en automatisk omräkning: dess separata,
klassbundna gruppkommando binder i stället en explicit sorterad mängd Entries
och ett canonical manifest. Alla valda Entries måste matcha samma granskade
grund under race-/entrylås, annars appenderas ingen revision. Gruppheader och
items är immutable retry-/auditobjekt; varje lyckat item skapar fortfarande sin
egen `EXPLICIT_RECALCULATION`. Aktiva manuella beslut, rådata och äldre
revisioner ändras inte. Se ADR-0109.
TASK 005J lägger till `VIEW_RACE_OVERVIEW` som ett read-only säkerhetsprivilegium
vid adaptergränsen. Det är varken en domänroll, deltagaridentitet eller
resultatrevision och får inte ändra race, snapshot, entry, assignment, readout,
resultat eller import. Översikten visar endast race-/eventstruktur, aggregerade
antal och aktivitetstider; individ- och rådata hör inte till kontraktet.
TASK 005N lägger till `VIEW_READOUT_RESULT_HISTORY` som ett separat read-only
säkerhetsprivilegium vid adaptergränsen. Det får läsa en explicit race-scopad
projektion av normaliserade readouts och immutable resultatrevisioner, men är
inte en domänroll och får inte mutera något. Aktuellt entrynamn är operativ
identifiering och inte ett historiskt namnsnapshot. En okänd bricka har ingen
resultatrevision; saknat äldre ingestutfall får aldrig ersättas med fabricerad
status.
TASK 006B lägger till `EXPORT_IOF_RESULT_LIST` som ett separat read-only
adapterprivilegium. Det väljer senaste publicerade revision per entry och
bevarar revisionens historiska klass-, course-, status- och tidsgrund. Aktuellt
namn/organisation är uttryckligen visningsdata. Exporten får inte mutera eller
auto-omräkna resultat, exponera interna UUID:n som IOF-identiteter, fabricera
frånvarostatus eller lägga rankinglogik i XML-adaptern.
TASK 006C inför en ren härledd klassranking, inte en ny resultatrevision.
Endast `OK` med icke-negativ säker heltalsmillisekund rankas. Position är ett
plus antalet strikt snabbare, så lika tider delar competition position och
time-behind räknas mot snabbaste OK. `MP` får ingen ranking. Gruppering använder
revisionens historiska klass. Om rankbara resultat i gruppen bär flera
course-versioner utelämnas ranking för hela klassen eftersom jämförbarhet inte
är bevisad. SQL, React och IOF-adaptern får inte återskapa regeln.

## Revisionsregler

- En ny avläsning skapar en ny revision när brickan är känd.
- Klassändring skapar auditpost men ändrar inte tidigare revision.
- Explicit omräkning skapar en ny revision mot aktuell klass och banversion.
- Nya capabilityskyddade explicita omräkningar märks
  `EXPLICIT_RECALCULATION`; historiska `CLASS_CHANGE_RECALCULATION` skrivs inte
  om.
- `StartList` ändrar startkonfiguration men skapar ingen resultatrevision.
  Berörda tidigare resultat behåller sitt snapshot och räknas endast om genom
  ett separat explicit `RECALCULATE_RESULT`-intent.
- Revisionen lagrar motorversion, snapshotversion, course-version och orsak.
- Publikering markeras per revision; äldre revisioner behålls.
- IOF ResultList-export väljer högsta publicerade revision per entry. En nyare
  opublicerad revision skymmer den inte, och äldre snapshotversion redovisas men
  tas inte bort utan ett nytt explicit publicerings-/omräkningsbeslut.
- Position och tid efter lagras inte i revisionen. De härleds över hela senaste
  publicerade historiska klassmängden genom domänrankingen; samma revision kan
  därför få en annan härledd position när en annan publicerad revision tillkommer.
- Samtidig ingest och explicit omräkning serialiserar nästa revisionsnummer per
  deltagare. `max(revision) + 1` får endast läsas medan deltagarraden är låst.
- Resultatutvärdering sker mot en sammanhängande, versionsmärkt snapshot; import
  och klassändring kan inte mutera loppets snapshot mitt under beräkningen.

## TASK094: återtagande av observerad måltidsrättning

En `MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL` är aldrig en deletion eller en
ny omräkning. Den får bara följa den omedelbara kedjan teknisk `OK`/`MP`-källa
→ `MANUAL_FINISH_TIME_CORRECTION` → återtagande, när rättningen fortfarande är
det absoluta resultathuvudet och inga manuella overlays eller ändrade
entry-/klass-/ban-/snapshotgrunder finns. Återtagandet kopierar exakt den
journalbundna tekniska källans `ResultOutcome`, status, reason, banversion och
snapshot till en ny publicerad revision. Rådata, CardReadout, källan,
rättningen och äldre fryst export ändras aldrig.

Det egna immutable withdrawal-objektet binder actor, request-id, alla
versionslås, correction-id, teknisk källa, rättat huvud och skapad
restaureringsrevision. Samma request återspelas endast med samma actor och
canonical intent; varje motsägelse avvisas fail-closed. Läsprojektioner kräver
hela kedjans proveniens innan den återställda revisionen visas. Se ADR-0112.

## Publik resultatidentitet

TASK089:s `Entry.publicResultId` är en slumpmässig, racebunden och stabil
visningsidentitet för en offentlig resultatlänk. Den är varken Entryns interna
UUID, extern importidentitet, brickidentitet eller behörighetstoken och skapar
ingen resultatrevision. Den består över namn-/klubbrättning och senare
publicerade revisioner, men används aldrig i importer, stationer eller IOF.

Den publika detaljprojektionen återanvänder exakt den senaste validerade
publicerade resultatraden för den angivna race-scopen. Okänd identitet, fel
race eller en Entry utan publicerat resultat ger ingen rad. Interna Entry-,
revision-, course-, card-, readout-, raw-, audit- och evaluationfält får aldrig
ingå i lista, länk eller detaljsvar. Se ADR-0108.

TASK152:s kontokoppling pekar på exakt `Entry` i ett lopp, inte en generell
personidentitet. Den uppstår bara genom en utfärdad engångskod som löses in
under ett aktivt konto; publikt resultat-id, namn, klubb och bricka får inte
användas som ägarbevis. Ett konto får flera uttryckliga Entry-kopplingar,
men en Entry högst en aktiv kontokoppling åt gången. Spärr följs av ny
verifiering och ny journal, aldrig tyst överföring. Namn-/klassrättning och
resultatrevision på samma Entry ändrar inte kopplingen. Kopplingen ger bara
indexering av redan publicerade resultatfält, inte nya privata rättigheter
eller resultatregler. Se ADR-0146.

TASK153:s följning är i stället en kontopreferens för ett tidigare offentligt
`raceId` + `publicResultId`. Den bevisar inte att kontot äger anmälan och ger
ingen behörighet till privat data. Ett nytt mål får bara följas när exakt
resultatrad just nu är offentlig. En aktiv följning överlever ändrade
resultatrevisioner men får vid avpublicering bara ge ett neutralt otillgängligt
tillstånd, inga cachade namn/tider/sträckor. Utloggade favoriter förblir lokala
och importeras inte automatiskt till konto. Se ADR-0147.

## IOF-importens startregel

IOF 3.0 `EntryList` innehåller anmälan men inte starttid, och `CourseData`
innehåller klass–ban-koppling men ingen startregel. Nya importerade
klass–ban-kopplingar börjar därför som `PUNCH`. Fasta starttider får inte
härledas ur dessa två filtyper.

TASK 006A låter en strikt individuell IOF 3.0 `StartList` sätta en refererad
klass till `FIXED` och varje fullständigt täckt entrys `fixedStartTime` via
`EntryId`. Starttid kräver explicit UTC-offset. Namn får aldrig användas som
identitet, `StartList` får inte byta klass och en senare `CourseData` eller
`EntryList` får inte radera den importerade startregeln/starttiden.

## Immutabilitet

Applikationslagret erbjuder inga update/delete-operationer för råmeddelanden,
course-versioner eller resultatrevisioner. Databasen kompletterar detta med
triggers som avvisar update och delete för dessa tabeller.
TASK 005G lägger samma databasbarriär på `import_file` och
`iof_import_request`. Importoriginalet, dess content hash, ursprungliga rapport
och requestens actor-/utfallsbindning får inte skrivas över eller raderas.
TASK 005H lägger motsvarande barriär på `entry_class_change_request`.
Requestens actor-, klass- och versionsbindning är historiskt bevis och får inte
uppdateras eller raderas.
TASK 005I lägger barriären på `result_recalculation_request`. Den skapade
`result_revision` var redan immutable; requestens actor-/intent-/revisionsbindning
får inte heller uppdateras eller raderas.

TASK 005N ändrar ingen immutabilitetsregel. `result_revision` förblir den enda
auktoritativa append-only historiken och samtliga revisionsorsaker, publicerade
såväl som opublicerade, ingår i arrangörsprojektionen. Normaliserad readout läses
som skapad fakta; råmeddelandets befintliga databasbarriär och resultatrevisionens
barriär kvarstår.

TASK 005K lägger till `CREATE_EVENT` som ett separat icke-racebundet
bootstrapprivilegium eftersom inget race existerar före mutationen. Det får
endast skapa ett event och exakt ett första individuellt lopp atomiskt. Det ger
ingen rätt till befintliga event/race och är inte en användar-, organisations-
eller rollmodell. Samma request-id, aktör och hela normaliserade intent ska ge
samma interna IDs; ändrad aktör eller intent med samma request-id är konflikt.
Olika request-id:n får representera två avsiktliga, identiskt namngivna event.

Requestjournalen, de globala credential-/sessionraderna och deras revocations
är append-only. Den lyckade create-mutationen får dessutom exakt en vanlig
racebunden auditpost sedan loppets interna id har skapats.

## Individuell resultatfinalisering

`published` är endast synlighet och är aldrig en slutgiltighetsflagga. TASK
006D inför i stället två explicita append-only beslut:

- en klassfinalisering fryser exakt alla aktuella entries i en icke-tom klass,
- en loppsfinalisering fryser exakt en aktuell klassfinalisering för varje
  icke-tom aktuell klass och är enda grunden för IOF `Complete`.

För varje entry måste den centralt resolverade effektiva revisionen vara
publicerad, strikt giltig och skapad för exakt aktuell race-snapshot, klass och
bana. Stödda former är tekniskt `OK|MP`, explicit DNS, aktiv DSQ, aktiv
approval och från TASK 006I aktiv DNF, samtliga med respektive full immutable
provenans. En nyare opublicerad revision, korrupt/dubbelaktiv manualkedja,
saknad revision, stale snapshot, historisk klass-/bankonflikt och blandade
banversioner blockerar. Tomt lopp och olösta `UNKNOWN_CARD`-avläsningar kan
inte finaliseras. Finaliseringsbasis fryser dessutom absolut underliggande
fysiskt huvud så att senare ingest kräver ny finalisering utan att historiska
Complete-bytes ändras. O-Tid fabricerar aldrig en status ur frånvaro. Se
ADR-0028, ADR-0031, ADR-0032 och ADR-0033.

Finalisering skapar ingen resultatrevision och muterar aldrig evaluation,
ranking, `published`, entry, klass, bana, snapshot eller rådata. Den frysta
projektionen innehåller både källspår och all exportdata. Senare rättning skapar
en ny klass- och loppsfinaliseringsrevision; äldre beslut och exakta XML-bytes
förblir oförändrade. Se ADR-0028.

## Explicit ej-startbeslut

TASK 006E inför exakt den manuella statusen `DNS` med orsaken
`DID_NOT_START`. `evaluateCardReadout` producerar den aldrig. En ren
domänkonstruktor kräver entry, aktuell historisk klass och banversion och ger
inga tider, kontroller eller splits. DNS är `NOT_RANKABLE_STATUS` och påverkar
inte OK-ranking eller mixed-course-bedömning.

`DidNotStartDecision` är ett manuellt verksamhetsbeslut och samtidigt den
append-only requestjournal som bevisar aktör och fryst intent. Exakt aktuell
entryversion, klass, banversion, race-snapshot, tomt revisionshuvud och
beslutspolicyversion krävs. Resultatrevisionen får null readout och en unik
immutable beslutsreferens. Senare riktig ingest får skapa nästa revision.

`DECIDE_DID_NOT_START` är ett separat adapterprivilegium. Beslut, DNS-revision
och audit committar atomiskt. Exakt retry returnerar samma historiska objekt;
ändrad aktör, target eller intent är konflikt. Se ADR-0029.

## Återtagande av explicit ej-startbeslut

TASK 006F inför `DidNotStartWithdrawal` som en immutable revision av det
manuella beslutets livscykel, inte som ett tävlingsutfall. `ResultOutcome`,
`RevisionCause` och kortmotorns `EvaluationResult` breddas inte. Ursprunglig
decision och DNS-resultatrevision behålls oförändrade och fortsatt publicerade
som historiskt bevis.

Endast en strikt giltig manuell DNS-revision som fortfarande är entryns
absoluta resultathuvud får återtas. Den rena domänregeln resolverar det redan
valda huvudet tillsammans med en exakt withdrawal till `ACTIVE_RESULT` eller
`NO_ACTIVE_RESULT`. Ingen levande projektion får välja en äldre revision som
fallback. En senare riktig `CARD_READOUT`-revision blir däremot ett nytt aktivt
huvud på vanligt sätt.

`WITHDRAW_DID_NOT_START` är ett separat minsta-privilegium. Intentet binder
aktuell entryversion, klass, bana och race-snapshot samt exakt decision och
targetrevision. Exact replay bevaras även efter senare ingest; ändrad aktör,
target eller intent är konflikt. Withdrawal skapar audit men ingen
resultatrevision eller snapshotändring. Se ADR-0030.

## Manuell diskvalifikation och återtagande

TASK 006G inför `DSQ / MANUAL_DISQUALIFICATION` endast i lagrade
`ResultOutcome`. `EvaluationResult` och stationens lokala/centrala
kortbedömning fortsätter uttryckligen att avvisa DSQ.

`createDisqualifiedResult` tar ett strikt lagrat, readoutbaserat `OK`- eller
`MP`-utfall och kopierar entry, historisk klass, banversion, tider,
missing/extra controls och splits exakt. Endast status/reason ändras. DSQ är
`NOT_RANKABLE_STATUS`; gemensam statusordning är `OK`, `MP`, `DSQ`, `DNS` och
endast `OK` påverkar ranking eller mixed-course-kontroll.

`ResultDisqualificationDecision` binder en actor till en exakt aktuell
targetrevision och skapad DSQ-revision. Ett beslut utan withdrawal förblir
aktivt även om senare tekniska revisioner appenderas. Den rena livscykelregeln
väljer därför beslutets DSQ som effektivt tävlingsutfall ovanpå läsarens normala
underliggande huvud. SQL, React och adaptrar får inte återskapa regeln.

`ResultDisqualificationWithdrawal` binder aktivt beslut, DSQ-revision,
observerat absolut huvud och en exakt senaste giltig underliggande `OK`/`MP`-
källa. Det appenderar en `MANUAL_DISQUALIFICATION_WITHDRAWAL`-revision vars
`ResultOutcome` är exakt källans. Därmed har rättningen en egen revision och
ingen äldre revision behöver återupplivas genom fallback.

Senare ingest får alltid bevara rawdata, readout och teknisk resultatrevision.
Den upphäver aldrig automatiskt DSQ. Ett nytt DSQ får endast skapas när ingen
annan DSQ är aktiv och target åter är exakt aktuellt. Se ADR-0031.

## Manuellt godkännande och återtagande

TASK 006H inför `OK / MANUAL_APPROVAL` endast i lagrade `ResultOutcome`.
Kortmotorn och stationens `EvaluationResult` producerar eller accepterar aldrig
den manuella orsaken.

`createManuallyApprovedResult` får bara ta ett exakt tekniskt
`MP/MISSING_CONTROL` eller `MP/WRONG_ORDER` med giltig start, mål och elapsed.
Den deep-kopierar identitet, historisk klass/bana, tider, missing/extra controls
och splits och ändrar endast status/reason. Saknade punches eller splittider
bevaras som förklaringsfakta och fabriceras aldrig.

Ett immutable approval-beslut förblir aktivt tills withdrawal, även om senare
tekniska revisioner appenderas. Den gemensamma resultathuvudresolven väljer den
frysta approval-revisionen som effektivt resultat. Ett aktivt DSQ och ett
aktivt approval får inte samexistera för samma entry.

Withdrawal binder aktiv decision, approval-revision, observerat absolut huvud
och exakt senaste giltiga underliggande tekniska `OK`/`MP`. Det appenderar en
`MANUAL_RESULT_APPROVAL_WITHDRAWAL`-revision som exakt kopierar källans
`ResultOutcome`. Servern väljer aldrig annan källa efter att intentet frysts.

Approval är rankbart som OK med sin exakta elapsed time. Position och tid efter
härleds, lagras inte i revisionen. IOF-exporten använder status `OK`, men
intern reason, decision och approval-proof serialiseras inte. Se ADR-0032.

## Explicit ej fullföljt

TASK 006I inför `DNF / DID_NOT_FINISH` endast i lagrade `ResultOutcome`.
Kortmotorn och stationens `EvaluationResult` producerar eller accepterar aldrig
DNF. En ren konstruktor tar en strikt teknisk `OK|MP` endast som
granskningskälla och skapar ett status-only outcome med exakt entry-, klass- och
banidentitet. Start, mål, elapsed, controls och splits saknas alltid.

`DidNotFinishDecision` binder actor och fryst intent till entryns absoluta
senaste, publicerade, tekniska och exakt aktuella targetrevision samt skapad
DNF-revision. Beslutet är permanent aktivt i detta snitt och den centrala
resolven väljer dess DNF även över senare tekniska revisioner. Rawdata och
teknisk historik bevaras.

En gemensam entry-låst grind kräver att högst ett av DNS, DSQ, approval och DNF
är aktivt. Korrupt eller dubbelaktiv provenans ger konflikt, aldrig
prioritering eller fallback. DNF är `NOT_RANKABLE_STATUS`; ordningen är `OK`,
`MP`, `DSQ`, `DNF`, `DNS` och endast OK påverkar ranking.

IOF-export mappar DNF till `DidNotFinish` med endast obligatorisk status. Nya
publik-, historik- och finaliseringsprojektioner använder format 4; äldre format
och redan frysta XML-bytes ändras inte. Se ADR-0033.

## Återtagande av explicit ej fullföljt

TASK 006J inför `DidNotFinishWithdrawal` som en immutable revision av DNF-
beslutets livscykel. Den muterar aldrig decision, DNF-revision, tekniskt target,
rawdata, readout eller publiceringsflagga. Withdrawal appenderar i stället en
publicerad `MANUAL_DID_NOT_FINISH_WITHDRAWAL`-revision vars `ResultOutcome` är
canonicalt exakt lika med en strikt teknisk `OK|MP`-källa.

Utan senare teknik restaureras decisionens ursprungliga target. Finns senare
revisioner måste det observerade absoluta huvudet självt vara den direkta,
publicerade tekniska källan. Ett manuellt, opublicerat, korrupt eller äldre
alternativ ger konflikt; regeln gör aldrig historisk fallback och väljer aldrig
om källan vid commit.

Den rena DNF-resolvern kräver full reciprocal
decision↔DNF↔withdrawal↔restoration-provenans. Utan withdrawal är DNF fortsatt
aktivt. Med withdrawal måste normalt valt huvud vara restorationen eller en
senare revision. Alla historiska DNF-kedjor valideras och högst en får vara
aktiv; endast den räknas i den gemensamma manuella mutexen.

Ett nytt DNF efter withdrawal kräver en ny direkt teknisk `OK|MP`-revision.
Restaureringsrevisionen kan inte targetas. Statusunion, statusordning och
rankingregler ändras inte: restaurerat OK rankas på nytt och restaurerat MP är
orankat. IOF använder vanliga `OK`/`MissingPunch`-regler och serialiserar ingen
withdrawalprovenans. Se ADR-0034.

## Explicit utom tävlan

TASK 006K inför `OOC / OUT_OF_COMPETITION` endast i lagrade `ResultOutcome`.
Kortmotorn och stationens `EvaluationResult` producerar eller accepterar aldrig
OOC. En ren konstruktor tar ett strikt direkt tekniskt `OK|MP` och deep-
kopierar identitet, historisk klass/bana, eventuella tider, missing/extra
controls och splits. Endast status/reason ändras; ingen fakta räknas om eller
fabriceras.

`NotCompetingDecision` binder actor och fryst intent till entryns absoluta
senaste, publicerade, direkt readoutbaserade och exakt aktuella tekniska
targetrevision samt skapad OOC-revision. Beslutet är permanent aktivt i detta
snitt och den centrala resolven väljer OOC även över senare tekniska
revisioner. Rawdata och teknisk historik bevaras.

Den gemensamma entry-låsta grinden kräver att högst ett av DNS, DSQ, approval,
DNF och OOC är aktivt. Korrupt eller dubbelaktiv provenans ger konflikt, aldrig
prioritering eller fallback. OOC är `NOT_RANKABLE_STATUS`; ordningen är `OK`,
`MP`, `DSQ`, `DNF`, `OOC`, `DNS` och endast OK påverkar ranking.

IOF-export mappar OOC till `NotCompeting`, bevarar endast targetens exakta
tillåtna tider/splits och serialiserar ingen intern reason/provenans.
Position/TimeBehind och approval-proof är förbjudna. Nya publikprojektioner
använder format 5 och historik/finalisering format 6; äldre format och frysta
XML-bytes ändras inte. Se ADR-0035.

## Återtagande av explicit utom tävlan

TASK 006L inför `NotCompetingWithdrawal` som en immutable revision av OOC-
beslutets livscykel. Den muterar aldrig decision, OOC-revision, tekniskt target,
rawdata, readout eller publiceringsflagga. Withdrawal appenderar i stället en
publicerad `MANUAL_OUT_OF_COMPETITION_WITHDRAWAL`-revision vars `ResultOutcome`
är canonicalt exakt lika med en strikt direkt teknisk `OK|MP`-källa.

Utan senare teknik restaureras decisionens ursprungliga target. Finns senare
revisioner måste det observerade absoluta huvudet självt vara den direkta,
publicerade och exakt aktuella tekniska källan. Ett manuellt, restaurerat,
opublicerat, korrupt eller äldre alternativ ger konflikt; regeln gör aldrig
historisk fallback och väljer aldrig om källan vid commit.

Den rena OOC-resolvern kräver full reciprocal
decision↔OOC↔withdrawal↔restoration-provenans. Utan withdrawal är OOC fortsatt
aktivt över senare teknik. Med withdrawal måste normalt valt huvud vara
restorationen eller en senare revision. Alla historiska OOC-kedjor valideras
och högst en får vara aktiv; endast den räknas i den gemensamma manuella
mutexen.

Ett nytt OOC efter withdrawal kräver en ny direkt teknisk `OK|MP`-revision.
Restaureringsrevisionen kan inte targetas. Statusunion och statusordning ändras
inte. Restaurerat OK rankas på nytt och restaurerat MP är orankat. IOF använder
vanliga `OK`/`MissingPunch`-regler och serialiserar ingen withdrawalprovenans.
Se ADR-0036.

## Explicit utan tidtagning

TASK 006M inför `NT / WITHOUT_TIMING` endast i lagrade `ResultOutcome`.
Kortmotorn och stationens `EvaluationResult` producerar eller accepterar aldrig
NT. En ren konstruktor tar endast ett strikt direkt tekniskt `OK/COMPLETE` som
granskningskälla och skapar ett status-only outcome med exakt entry-, klass-
och banidentitet. Start, mål, elapsed, controls och splits saknas alltid.

`WithoutTimingDecision` binder actor och fryst intent till entryns absoluta
senaste, publicerade, direkta och exakt aktuella tekniska targetrevision samt
skapad NT-revision. MP, manuellt eller restaurerat OK, opublicerad/stale target
och `UNKNOWN_CARD` avvisas. Beslutet är permanent aktivt i detta snitt och den
centrala resolvern väljer NT även över senare tekniska revisioner.

Den gemensamma entry-låsta grinden kräver att högst ett av DNS, DSQ, approval,
DNF, OOC och NT är aktivt. Korrupt eller dubbelaktiv provenans ger konflikt,
aldrig prioritering eller fallback. NT är `NOT_RANKABLE_STATUS`; ordningen är
`OK`, `MP`, `DSQ`, `DNF`, `OOC`, `NT`, `DNS`, och endast OK påverkar ranking
eller mixed-course-bedömning.

Publik format 6 och historik format 8 visar NT utan tid, ranking, controls,
splits eller interna id:n. IOF Snapshot och ny finalisering avvisar aktiv NT,
eftersom IOF 3.0 saknar en beslutad sanningsenlig mappning. Se ADR-0037.

## Återtagande av explicit utan tidtagning

TASK 006N inför `WithoutTimingWithdrawal` som en immutable revision av NT-
beslutets livscykel. Den muterar aldrig decision, NT-revision, target, rawdata,
readout eller publiceringsflagga. Withdrawal appenderar i stället en publicerad
`MANUAL_WITHOUT_TIMING_WITHDRAWAL`-revision vars `ResultOutcome` är canonicalt
exakt lika med en strikt direkt teknisk `OK|MP`-källa.

Utan senare teknik restaureras decisionens ursprungliga tekniska
`OK/COMPLETE`-target. Finns senare revisioner måste det observerade absoluta
huvudet självt vara den direkta, publicerade och exakt aktuella tekniska
`OK|MP`-källan. Ett manuellt, restaurerat, opublicerat, korrupt eller äldre
alternativ ger konflikt; regeln gör aldrig historisk fallback och väljer aldrig
om källan vid commit.

Den rena NT-resolvern kräver full reciprocal
decision↔NT↔withdrawal↔restoration-provenans. Utan withdrawal är NT fortsatt
aktivt över senare teknik. Med withdrawal måste normalt valt huvud vara
restorationen eller en senare revision. Alla historiska NT-kedjor valideras och
högst en får vara aktiv; endast den räknas i den gemensamma manuella mutexen.

Ett nytt NT efter withdrawal kräver en senare ny direkt teknisk
`OK/COMPLETE`-revision. Restaureringsrevisionen kan inte targetas. Statusunion
och statusordning ändras inte. Restaurerat OK rankas på nytt och restaurerat MP
är orankat. Aktiv NT blockerar fortsatt IOF, men efter withdrawal använder IOF
vanliga `OK`/`MissingPunch`-regler utan intern provenans. Se ADR-0038.

## Individuell fast starttid

TASK 006O ändrar endast `Entry.fixedStartTime` i en FIXED-klass. Datum,
sekunder och explicit UTC-offset krävs; tiden normaliseras till UTC med högst
millisekundprecision. Saknad tid får sättas men inte raderas. Verklig ändring
ökar entry-/snapshotversion ett steg; stale, no-op och replay ökar ingenting.
Requestjournalen binder aktör, entry, klass, tidigare tid och versionsgrund.

Sparandet ändrar ingen råavläsning, resultatrevision eller manuell åtgärd.
Befintligt resultat används tills separat explicit omräkning eller ny ingest
appenderar en teknisk revision. Aktiva manuella beslut fortsätter gälla.
Snapshotändringen gör gammal finaliseringsgrund stale, men frysta historiska
Complete-bytes förblir oförändrade. Se ADR-0039.

## Individuellt brickbyte

TASK 006P fryser card_assignment-identiteten: id, race, entry, bricknummer och
createdAt får inte ändras eller raderas. Endast aktivflaggan växlar genom
versionsbundet byte. Historisk koppling till annan entry i samma lopp blockerar
återanvändning; egen tidigare bricka får återaktiveras. Flera aktiva kopplingar
är en konflikt, inte skäl att välja en godtycklig.

Brickbyte ökar entry-/snapshotversion men skriver inte raw/readout eller gamla
resultat. Explicit omräkning använder senaste avläsning för den nya aktiva
brickan och kan därmed hantera tidigare okänd avläsning. Saknad avläsning ger
NO_READOUT utan fallback. Aktiva manuella beslut består. EntryList får endast
skapa en första koppling eller bekräfta samma enda aktiva bricka; annat värde
avvisar hela filen. Se ADR-0040.

## Direktanmälan

TASK 006Q skapar en individuell entry i en befintlig klass. Namn är uppgifter,
inte identitet; interna UUID skapas och ingen extern IOF-identitet gissas.
FIXED kräver explicit starttid, PUNCH kräver null. Valfri bricka får inte ha
någon historisk ägare i samma lopp. Registrering skapar ingen resultatstatus.

En immutable requestjournal fryser normaliserat intent och skapade IDs.
Samma actor/request/intent återger ursprungskvittensen även efter ändringar.
Olika avsiktliga requests med samma namn är separata personer. Operatören får
inte återimportera en direktanmäld person som en ny extern identitet utan en
framtida explicit identitetskoppling. Se ADR-0041.

## Operativ startlista

TASK 006R är en härledd privat läsprojektion, inte en ny start-/resultatkälla.
FIXED visar befintlig fast tid eller explicit saknad tid. PUNCH visar
startstämplingsregel och ingen historisk fast tid. Ingen entry märks som
startad, ej start eller i skogen på basis av denna lista. Saknad aktiv bricka
och flera aktiva brickor är separata varningar; ingen koppling väljs godtyckligt.
Snapshot, entry, resultatrevisioner och alla manuella beslut är oförändrade.
Se ADR-0042.

## Publicerad startlista

TASK 006S fryser event/lopp/datum/tidszon och klassvis namn, klubb och planerad
start. Inga bricknummer eller interna person-/klass-id:n ingår offentligt.
PUNCH har null planerad tid. Listan bevisar varken faktisk start, DNS eller
officiellt resultat. Minst en deltagare krävs för publicering.

Aktuella ändringar påverkar aldrig en publicerad kopia. Ny publicering och
avpublicering är explicita revisionsbundna beslut. Samma actor/request/intent
återger ursprungligt beslut även efter withdrawal; ändrad kontext konflikterar.
Historik är immutable och separat från resultat-/starttidskällan. ADR-0043.

## Export av publicerad startlista

TASK 006T mappar endast explicit publicerade namn, klass, klubb och planerad
tid. Person/Name skrivs med verkligt Family/Given; displayName delas aldrig.
Varje person har Start även om tiden saknas. PUNCH saknar alltid StartTime.
Inga start-/resultatstatusar, brickor, IDs, banor eller raceNumber fabriceras.
Detta är ett individuellt lopp, inte en extern identitets- eller etappimport.
Webbnamn och strukturerat namn ingår båda i den versionsmärkta publiceringshashen.
Äldre publiceringar kräver nytt beslut för export; resultat påverkas inte.
Se ADR-0044 och docs/research/iof-data-standard-3.md.

## Enkel klasslottning – TASK 006U

`planClassStartDraw` version xorshift32-fisher-yates-v1 ger samma permutation
för samma icke-noll uint32-seed och entryuppsättning, oavsett inputordning.
Första startinstantens millisekunder bevaras, följande slots ökar med hela
intervallsekunder. Dubbla/ogiltiga IDs, tom eller för stor roster, ogiltig
seed/intervall och tider utanför år 0001–9999 avvisas utan partiell plan.
Detta är endast planering: service måste bevisa rätt klass/race, versioner och
hela roster samt journalföra beslutet. Ingen plan ändrar resultat eller
publicerade listor. Servern kontrollerar rosterhash/klass/snapshot under lås
och journalför alla medlemmar, även oförändrade. Endast ändrade entryversioner
ökar; oförändrad entry på maximal version får finnas kvar. Se ADR-0045.

## Verifierbar rapport över fasta startluckor – TASK108

En ledig startlucka är inte samma sak som kvarvarande klasskapacitet. TASK108
läser därför endast den senaste immutabla lottningsjournalen för en aktuell
`FIXED`-klass. En journaliserad tid är upptagen bara när exakt en aktuell
deltagare fortfarande har just den fasta tiden; en saknad deltagare gör den
tidigare lottade tiden vakant. Aktuella deltagare utan fast tid redovisas
separat. Om klassen saknar journal, eller om en aktuell tid är manuell,
dubbel eller har fel precision, finns ingen beräkningsbar plan och inga luckor
visas. `PUNCH`/fri start genererar aldrig en startlucka. Rapporten är
skrivskyddad och ändrar inte entry, resultat, kapacitet eller journal.

## Tilldelning av en verifierad lottad starttid – TASK109

Ett befintligt klassbyte kan göra ett separat, uttryckligt slotanspråk i en
`FIXED`-klass. Anspråket innehåller exakt immutable draw-id, source-hash och
tid från serverns privata kandidatlista; det är aldrig en klienttolkad ledig
tid. Under race-/entrylåset måste drawen ännu vara senast, hela aktuella
roster kunna mappas entydigt till samma draw (ursprungligt item eller äldre
TASK109-assignment), tiden vara framtida och vakant och deltagartaket ha plats.

Transfern och `entry_start_slot_assignment` committar atomiskt. Journalen är
immutable och behövs för att en retry kan återge samma bevis även efter senare
ändringar. Historiska/manuella dubbletter får finnas; de gör bara den nya
slotvägen otillgänglig. En normal manuell starttid behåller sin äldre,
separata klassbytesväg och får aldrig framställas som lottad. PUNCH,
direktanmälan och publicering/omräkning ingår inte. Se ADR-0121.

## Direktanmälan till verifierad lottad starttid – TASK110

En ny entry kan på direktanmälningsvägen välja en framtida slot ur samma
verifierbara `FIXED`-draw som TASK109. Klienten skickar aldrig bara en tid:
requesten bär draw-id, source-hash, exakt tid och observerad
kapacitetsversion. Under race-låset måste servern fortfarande bevisa senaste
draw, komplett/entydig roster (ursprungliga draw-items, TASK109- eller
TASK110-assignment), kapacitet och faktisk vakans. `PUNCH`, passerad eller
påhittad tid avvisas för slotvägen.

`entry_registration_start_slot_assignment` är en egen immutable one-to-one
journal med registreringsrequesten. Samma retry återger det sparade beviset;
den läser inte senare ändrad entrydata. Den tidigare manuella FIXED-anmälan
finns kvar som ett operativt undantag och saknar alltid slotbevis. Detta är
inte en reserveringskö eller generell startbokning. Se ADR-0122.

## Eventorgräns – TASK 006V under implementation

EventId och EventRaceId är skilda externa opaka textidentiteter, aldrig interna
primärnycklar. Ett event med flera lopp kräver uttryckligt loppval. Tidszon
väljs av operatören; Eventors Date/Clock anger inte en styrkt tidszon eller
en deltagares starttid. Import av rubrikmetadata får inte skapa resultat,
klassregler eller deltagare. Importtjänsten sparar eventets StartDate som
startsOn och det uttryckligt valda loppets RaceDate som raceDate, även om
datumen skiljer sig. Originalets Clock skapar ingen starttid. Befintligt
importerat event kan inte kompletteras med en annan etapp inom detta snitt.
Journalen behåller originalmetadata och extern provenans. Se ADR-0046.

## Manuell startavprickning – TASK 006W under implementation

`planStartCheckin` planerar en explicit versionsbunden ändring för exakt
race/entry mellan UNMARKED, STARTED och REPORTED_NOT_STARTED. Dessa är
operativa rapporter, inte resultatstatusar. Tom ruta är inte DNS. Rättning
till UNMARKED efter en markering behöver en ny revision. Stale intent och
fel scope avvisas, även när önskat värde redan råkar vara aktuellt.

Regeln läser ingen tid och påverkar inte FIXED/PUNCH, officiell starttid,
resultatmotor, skogskontroll eller rådata. Den skapar endast ett förslag;
auktoriserad atomisk journal, retry och eventuell offlinekö återstår.
Se ADR-0048. Detta är ännu inte ett körbart avprickningsflöde.

ADR-0049 tillägger efter användarbeslut att explicit ej-startmarkering ska
kunna ge en separat spårbar DNS-effekt vid servercommit och rättas vid mål.
Den rena rapporten förblir skild från lagrat resultat. UNMARKED ger aldrig DNS.
Sen negativ rapport får inte skriva över ett verkligt readoutresultat.

`buildForestWatchList` klassificerar varje tillhandahållen racebunden entry
som STARTED_NO_RETURN, UNCONFIRMED, NOT_STARTED, RETURNED eller CONFLICT.
Okänd start och konflikter kräver uppföljning; motsägande retur/DNS döljs inte.
Funktionen bevisar inte rostercoverage eller återkomstkällan; applikationen
måste göra det. Resultatstatus ensam får inte användas som återkomstbevis.

ADR-0051 lägger till revisionsorsaken START_CHECKIN_DID_NOT_START, inte en
ny resultatstatus. Dess DNS/DID_NOT_START bär bara entry/klass/bana och är
skild från befintlig manuell DNS-källa. Källvalidering finns i application;
den bevisar historisk operation, kvittens och bindningar, inte frånvaro av
senare återkomst eller aktuell roster. Aktuell skrivgrind och withdrawal-
overlay återstår att koppla in. Kortmotorn producerar fortsatt aldrig DNS.
## TASK 006W: explicit konfliktgranskning

ADR-0056:s KEEP_CURRENT_STATE är endast granskning av ett exakt set rapporter.
Det ändrar inte start, återkomst, DNS, rådata eller resultat. Granskning kan inte
dölja aktuella motsägelser mellan DNS/start/återkomst. Startad utan återkomst och
omarkerad behöver fortfarande uppföljning efter granskning. Ny senare konflikt
omfattas inte av historiska granskningsbeslut. Ren planering finns; journal och
auktoriserad granskningsväg är under implementation.

## TASK026: namn-/klubbrättning är inte byte av deltagaridentitet

För-/efternamn och nullable klubbtext får rättas enligt ADR-0067. Interna och
externa identiteter, klass, brickägarskap, starttid och resultat är orörda.
Namn är aldrig matchningsnyckel; klubbändring gäller endast en entry. Nya
klubbnamn är högst200 tecken enligt stationspaketets befintliga gräns.
No-op, stale underlag och versionsoverflow skriver inget. Manuell rättning
skyddar hela fältgruppen mot senare avvikande EntryList-import. Resultat och
publicerade dokument uppdateras aldrig automatiskt av rättningen.

## TASK029: deltagartak är inte startluckor

En klass har ingen gräns (null) eller ett administrerat tak0–10000 enligt
ADR-0070. Alla registrerade deltagare räknas, även ej startande. Noll stänger
en tom klass. Taket får inte sättas under aktuellt antal. Ingen startlucka,
åldersregel eller behörighet till tävlingsklass härleds från antalet/klassnamnet.
Klass och tillhörande fast starttid ändras tillsammans; PUNCH tar bort fast
tid och FIXED kräver explicit tid. Resultathistoriken ändras inte automatiskt.

## TASK081: manuell bana och klass

En manuell bana och dess första klass skapas som en enda racebunden mutation
enligt ADR-0103. `CourseVersion` 1 och dess ordnade `CourseControl` är
append-only. Samma kontrollkod får förekomma flera gånger och varje förekomst
behåller sin sekvens; varken UI, service eller databas får deduplicera eller
sortera följden.

Manuella `Course` och `Class` har null extern identitet. IOF-import får därför
inte matcha dem via namn eller skriva över dem. Startupplägget väljs uttryckligt
som PUNCH eller FIXED; en FIXED-klass skapar inga deltagare eller starttider.
Exakt retry binds till request-id, aktör, race och hela normaliserade intentet.
En ny lyckad skapning höjer loppets snapshot exakt ett steg men skapar inga
resultatrevisioner och ändrar inga befintliga entries eller klasskopplingar.

## TASK082: ny banversion är inte en resultaträttning

ADR-0104 tillåter att en manuell Class länkas från sin nuvarande manuella
CourseVersion till en ny append-only version av samma Course. Alla äldre
CourseVersion/CourseControl förblir immutable. Entries fortsätter peka på samma
Class och deras version, starttid och brickkoppling ändras inte.

En enda `result_revision` för en entry i klassen blockerar omlänkningen, oavsett
status eller publicering. En ny banversion får alltså aldrig tyst ge ett äldre
resultat ny bansemantik. Automatisk omräkning eller publicering hör inte till
TASK082 och kräver ett senare uttryckligt beslut. IOF-identifierade Course/Class
får inte muteras av den manuella writern.

## TASK084: resultatbärande manuell banomlänkning bevarar historik

ADR-0106 tillåter en ny, append-only CourseVersion för exakt en redan länkad
manuell Class även när klassen har resultatrevisioner. Commit kräver ett eget
canonical kandidatunderlag: race-snapshot, aktuell klass-/banversion,
UUID-sorterade entryversioner, senaste revisionshuvuden, historiskt
revisionsantal och aktiva manuella beslutshuvuden binds i `basisHash`. Både
hash och snapshot valideras om under race-lås före skrivning.

Writern får endast skapa nästa CourseVersion med ordnad kontrollföljd, flytta
klassens aktuella banversionskoppling, öka snapshot och append:a sin egen
immutable journal/audit. Den får inte ändra eller skapa resultatrevision,
manuellt beslut, publicering, finalisering, IOF-export, rådata eller
stationdata. Äldre revisioner fortsätter peka på sin ursprungliga CourseVersion.
En senare individuell omräkning är ett separat, explicit `RECALCULATE_RESULT`-
kommando; ingen grupp- eller automatisk omräkning följer av banändringen.

## TASK135: avkortning är en separat kortklass

En avkortning efter resultat är aldrig en ändrad kontrollföljd på källklassen
och aldrig en dold individuell banvariant. ADR-0139 skapar i stället en ny
racebunden lokal Course, immutable CourseVersion 1 och Class med ett strikt
kortare prefix av en aktuell källklass bana. Källklass, källbana, deras
externa identiteter och alla äldre resultat förblir immutable.

En explicit vald Entry flyttas till kortklassen under race-/entrylås och
behåller aktiv brickkoppling samt eventuell fast starttid. Därmed bär varje
ny teknisk utvärdering den nya historiska `classId`/`courseVersionId` som
redan är rankingens, stationpaketets och IOF-projektionens gräns. Lång och
kort bana rankas aldrig tillsammans. En aktuell `CARD_READOUT`-orsakad `MP` får bara
utvärderas på nytt från exakt samma bevarade CardReadout och kan aldrig få
fabricerade stämplingar eller tider. `OK`, manuella overlays och stale eller
okända källor är inte giltiga i första snittet.

En sådan omvärdering får orsaken `SHORTENED_COURSE_CLASS_TRANSFER`, är
publicerad i samma atomiska commit och är giltig bara med sitt reciproka
journalbevis. En resultatlös flytt är inte DNS/DNF och gör en ny Complete-
finalisering otillgänglig tills ett sant resultat eller ett separat manuellt
beslut finns. I en `FIXED`-klass följer bara en redan giltig fast starttid med;
i `PUNCH` är fast starttid alltid null.

Header, items, aktör, request-id, canonical basis-hash, källversioner,
skapade objekt och eventuella resultatrevisioner är append-only. Exakt retry
återger samma kvittens; ändrad actor, source, prefix, entrygrund eller
parallell ny resultathändelse avvisas utan delwrite. Äldre slutresultat är
frysta. En ny officiell lista kan bara skapas genom den vanliga explicit
racefinaliseringen efter beslutet.

## TASK104: observerad PUNCH-start är inte fast start eller avprickning

En `MANUAL_PUNCH_START_TIME_CORRECTION` får bara utgå från en direkt teknisk,
publicerad `OK`/`MP` med läst start och mål i en PUNCH-klass. Ny start skiljer
sig från den lästa starten, ligger strikt före mål och aldrig efter en bevarad
matchad kontroll. Status, reason, mål, kontroller och avvikelser bevaras;
enbart start, löptid samt splittider härleds om. Källrevision, råavläsning och
tidigare resultat blir immutable historik. `FIXED`, DNS/avprickning och en
aktiv manuell resultatoverlay är inte giltiga källor.

## TASK105: återtagande återställer, men räknar inte om

Ett återtagande av PUNCH-starträttning är tillåtet endast för aktuell,
omedelbar TASK104-kedja. Det återanvänder exakt den lagrade tekniska
evaluationen, inklusive start, löptid, splitter, status och reason. Rådata,
läst start, korrigerad revision och tidigare historik förblir oförändrade.
Senare resultat, overlay, annan klass-/ban-/snapshotgrund eller motsägande
proveniens är konflikt utan skrivning.

## TASK143: återanvändning skapar en ny brickkoppling

En aktiv `CardAssignment` som är både `isRental` och `rentalReturned` får
endast återanvändas genom den explicita, racebundna ADR-0142-operationen. Den
väljer en annan Entry utan aktiv koppling och binder källans och målets
entry-/klass-/assignmentidentiteter, båda entryversioner och race-snapshot.
Källans assignment blir inaktiv men dess identitet och hyr-/returfakta förblir
immutable; målet får en ny assignment med samma nummer, `isRental=true` och
`rentalReturned=false`.

Högst en aktiv `(race, cardNumber)` får finnas. Flera inaktiva historiska
kopplingar är tillåtna endast som bevarad historik. Vanligt brickbyte och
direktanmälan får därför inte tolka en historisk annan Entry som ledigt nummer.
Ingen återanvändning ändrar RawDeviceMessage, CardReadout, ResultRevision,
tidigare hyr-/returjournal eller fryst export; omräkning är alltid separat.

## TASK144: historien hämtar riktning från reuse-journalen

Den privata deltagarhistoriken får projicera en TASK143-journalrad för både
källan och målet. Källans rad betyder att dess aktiva återlämnade hyrbricka
blev inaktiv; målets att en ny aktiv hyrbricka tilldelades och inte är
återlämnad. Båda använder journalens sparade version, snapshot, card number
och tid. En senare brickändring får aldrig ändra textens grund eller skapa en
ytterligare historisk reuse-rad.

## ADR-0172: konto, återställning och borttagning

Kontots normaliserade e-postadress är en inloggning, inte bevis på deltagare,
klubbmedlemskap eller behörighet i ett event. En återställningslänk byter bara
lösenordet (ny verifierarversion, alla sessioner spärras); den rör inga grants,
resultat eller rådata. Att ta bort en tävling eller ett konto är den enda väg
där annars oföränderliga rader (rådata, journaler, revisioner) tas bort, och den
tar då bort allt som hör till tävlingen. Superadmins åtgärder loggas och
loggen överlever borttagningen.

## TASK162: GPX-tid är inte kontrollpassage

En komplett monoton GPX-tidsserie får ge relativ tid per punkt för den
redan behörigt lästa privata rutten. Saknas en enda faktisk tidpunkt eller
går källordningen bakåt är hela uppspelningen `UNAVAILABLE`; ingen lucka
fylls i. En markör vid en historisk kontrollposition är inte en
SPORTident-stämpling och får inte skapa split, resultatstatus eller
placering. Privat tidsuppspelning ändrar inte samtycke eller publicering.

## TASK163: publicerad resultatsplit är inte GPX-passagetid

Endast den effektiva publicerade `OK`-revisionens redan validerade
sträcktider får visas vid den privata rutten, och bara för samma exakta
anmälan och banversion. En äldre revision, MP:s partiella stämplingar,
saknad totaltid eller saknade splits ger `UNAVAILABLE`, inte uppskattade
värden. Den aktuella publicerade revisionen kan fortfarande vara
preliminär. Ingen resultatrevision eller GPS-punkt ändras av läsningen;
kontrollkod och förekomst används som etiketter, inte som GPS-matchning.

## TASK164: resultatstart och GPX-klocka är skilda bevis

Endast den strikt lästa aktiva publicerade `OK`- eller tekniska `MP`-
revisionen med en faktiskt validerad starttid får ge `resultStart`.
`INVALID_TIME_ORDER`, saknad start, status-only och DSQ/OOC ger
`UNAVAILABLE`. För fast start är tiden resultatets tilldelade start; för
PUNCH bygger den på den giltiga stämplingen eller en explicit rättning.
Manuell GPX-klockjustering ändrar enbart var uppspelningsmarkören kan visas
i browsern, aldrig officiell start, split, resultatstatus eller rå GPX.
En markör vid start/kontroll är inte ett passagebevis.

## TASK165: kontrollens resultattid är inte GPS-kontrollpassage

Endast en aktuell publicerad `OK`-revisions redan validerade
ackumulerade kontrolltid får användas med starttid från **samma** revision.
Kontrollkod plus förekomst identifierar vald resultatrad, inte en
GPS-punkt. En manuell klockförskjutning får placera denna tid på den
oförändrade privata GPX-tidslinjen men skapar ingen stämpling,
kontrollpassage, split, rättning eller ny resultatrevision. Tid utanför
serien och position i segmentlucka redovisas utan påhittad punkt.

## TASK185: administratörens kontrolltabell är ingen ny beräkning

Kontrollordning och förekomst gäller resultatets historiska bana, inte
deltagarens eventuellt nybytta klassbana. Lagrat sträck-/ackumulerat värde
visas bara på motsvarande kontrollkod och fysisk förekomst. Neutraliserad
förekomst behåller sitt nummer och visas utan mellantid; senare förekomster
numreras inte om. Null betyder inte automatiskt felstämpling. DNS/DNF/NT
har inga tekniska kontrolluppgifter i denna projektion. Speakers urval av
senaste publicerade uppdateringar är varken placering eller målgångsordning.
