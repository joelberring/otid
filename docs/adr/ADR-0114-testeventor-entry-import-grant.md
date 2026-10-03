# ADR-0114: Testeventoranmälningar kräver race-bunden importgrant och explicit klassmappning

- Status: Accepterad för TASK098
- Datum: 2026-09-19

## Kontext

O-Tid kan redan skapa ett internt event/lopp från en krypterad Testeventor-
anslutning (ADR-0046), men det loppet saknar deltagarlista. En arrangör behöver
kunna hämta anmälningar utan att skriva in samma namn, klubb och klass igen.

En vanlig race-administratör får dock inte få en Eventor-nyckel eller fria
möjligheter att använda en anslutning som ägs av någon annan. En
`CREATE_EVENT`-credential för anslutningsägaren och en race-bunden
`IMPORT_IOF`-credential för tävlingsadministratören är medvetet olika
behörigheter. Eventors EntryList innehåller klassidentitet, men inte O-Tids
bana-/klasskoppling; att matcha klasser på namn skulle vara osäkert.

Eventors officiella API-dokumentation listar separata läsmetoder för
`eventclasses` och `entries`; det officiella schemat visar att Entry kan bära
team eller flera EntryClass. TASK098 använder endast en liten, individuellt
validerad delmängd. Källorna är dokumenterade i researchnoteringen och används
som interopreferens, inte som kod- eller domänmodellkälla.

## Beslut

### Åtkomst

En anslutningsägare utfärdar en append-only, återkallelig
`EventorRaceImportGrant` till exakt en befintlig race-bunden `IMPORT_IOF`
credential och exakt en befintlig `eventor_import_request`. Den senare är den
redan kontrollerade provenansen för både aktiv Testeventoranslutning och det
interna loppet; granten bär alltså inte fria Eventor-/race-ID:n som servern
måste lita på. Granten skapas/spärras betrott via separat CLI; browsern ser
bara grantens icke-hemliga etikett och identitet.

Vid preview och commit autentiseras alltid den race-bundna
`IMPORT_IOF`-sessionen. Servern låser och kontrollerar granten, dess
anslutning, anslutningsägarens tidigare Eventor-provenans och återkallelser
innan nyckeln öppnas. Nyckeln lämnar aldrig serverprocessen och visas aldrig i
HTTP-svar, URL, logg eller audit-payload. En spärrad grant eller anslutning
avvisar även en retry som ännu inte har ett sparat commitresultat.

Skrivvägens låsordning är grant → connection/provenans → race/importjournal.
Grantens spärr använder samma första lås. En redan committad, identisk receipt
kan läsas efter en senare spärr; en retry utan tidigare receipt måste däremot
omvalidera grant och anslutning och avvisas om någon av dem är spärrad.

### Individuell, explicit mappning

TASK098 läser enbart Testeventors `EventClassList` och `EntryList` för ett
redan länkat individuellt lopp. Adaptern accepterar högst 500 klasser och
10 000 entries, strikt UTF-8/XML, inga namespaces/entiteter, en personentry
med exakt en `EntryId` och exakt en `EventClassId`. Team, flera klasser per
entry, borttagna klasser, saknat namn eller klubbtext som inte kan valideras
avvisas. Bricknummer, starttid, avgift, personnummer, kontaktuppgifter och
annan personmetadata importeras inte.

Preview visar källklass och antal berörda entries. Operatören mappar varje
förekommande källklass explicit till en redan befintlig intern Class i samma
lopp. Varje intern Class får användas högst en gång. Namn, kortnamn och extern
klassidentitet används enbart för visning, aldrig som automatisk mappning.
TASK098 skapar inga klasser, banor, versioner, starter eller starttider.

### Commit, historik och konflikt

Commit binder grant, race, båda källdokumentens SHA-256, explicit klassmappning
och actor till ett request-id. Servern läser om källorna före commit och
avvisar ändrad hash. Den skapar endast nya `Entry` med
`external_source = 'eventor'` och Eventors `EntryId` som opak extern identitet.
Den får aldrig uppdatera eller radera en befintlig entry:

- exakt samma externa entry och samma importerbara värden är oförändrad,
- avvikande namn, klubb eller klass är konflikt, även efter lokal rättning,
- en saknad gammal extern entry tas aldrig bort och blir inte DNS,
- kort, starttid, resultatrevision, manuellt beslut, publicering och
  finalisering skrivs aldrig av importen.

Detta gör första importen atomisk och retrybar utan att lova en bred Eventor-
synk. En immutable journal och auditpost bevarar källhashar, mappning,
räkneutfall och receipt. Race-snapshotet ökar exakt en gång endast när minst en
ny entry skapas. Exakt retry returnerar samma receipt utan nätläsning.

## Konsekvenser

- En behörig tävlingsadministratör kan säkert importera en granskad
  deltagarlista till förberedda klasser.
- Klassen måste ha förberetts separat, normalt genom CourseData/manuell
  banadministration. Detta är avsiktligt: Eventoranmälan är inte banläggning.
- Senare Eventorändringar, avanmälningar, brickor, starttider, automatisk
  klassmappning och produktions-Eventor är separata snitt.
- Ingen Eventorskrivning, GPS, karta/rutt, stafett eller SPORTident-USB ändras.

## Migration och återställning

Migrationen är additiv: grant, grant-revocation och requestjournal med
främmande nycklar till befintlig `eventor_import_request`, connection via dess
provenans, race-bunden `IMPORT_IOF`-credential och dess capabilitiescope. En
sammanhållen foreign key binder grants race till importprovenansens race.
`entry.external_source` är befintlig text och kräver ingen enum-migration.
Ingen historisk Entry eller resultatpost skrivs om.

Vid incident stängs routen och grant/anslutning spärras. Journal, audit och
redan importerade entries behålls; återställning sker genom verifierad backup
eller senare additiv korrigering, aldrig genom radering av importhistorik.

## Avvisade alternativ

- Dela eller skriva Eventor-nyckeln i browsern: bryter hemlighetsgränsen.
- Låta varje race-admin använda godtycklig connection: läcker anslutningsägarens
  rättighet.
- Mappa klasser på namn: tvetydigt och känsligt för lokala namnändringar.
- Uppdatera/radera entries direkt från Eventor: skulle kunna skriva över lokala
  tävlingsbeslut eller fabricera DNS.
- Importera hela Eventor-schemat eller använda kod från annat tidtagningssystem:
  större än snittet och oförenligt med licensgränsen.
