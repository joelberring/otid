# ADR-0111: explicit korrigering av observerad måltid

- Status: Accepterad och implementerad i TASK093
- Datum: 2026-09-19

## Kontext

TASK031 kan rätta en deltagares fasta planerade starttid före loppet. TASK091
kan skapa nya tekniska revisioner från redan bevarad avläsning. Ingen av dem
hanterar ett felaktigt men faktiskt observerat målslag, exempelvis efter ett
fel på en målstations klocka. Att mutera `CardReadout`, råbytes, punch eller
äldre `ResultRevision` skulle förstöra den observerade historiken. En generell
manuell resultateditor eller godtycklig tidsinmatning skulle samtidigt blanda
flera tävlingsregler och göra export/finalisering omöjlig att granska.

## Beslut

TASK093 får införa ett enda `MANAGE_RACE`-skyddat, append-only beslut för exakt
en Entry: korrigera **måltiden** på dess aktuella, publicerade, direkta
tekniska `OK` eller `MP` med komplett start, mål och löptid. Den tekniska
källrevisionen måste vara entryns absoluta huvud och sakna aktivt manuellt
DNS/DNF/DSQ/approval/OOC/NT-beslut. Saknad start eller mål, omvänd tid,
manuell status, okänd källa eller ett nytt revisionhuvud avvisas; uppgiften
skapar aldrig ett saknat målslag.

Operatören anger en explicit offsetbunden UTC-tid med högst millisekund-
precision. Den nya måltiden måste ligga strikt efter bevarad start och på eller
efter den senaste bevarade matched split. Rättningen skapar en ny immutable
`ResultRevision` med orsaken `MANUAL_FINISH_TIME_CORRECTION`, samma entry,
klass, bana, start, status/reason, saknade/extra kontroller och splits som
källan, men med härledd `finishTime` och `elapsedMs`. En separat immutable
beslutsrad binder källa, gammal och korrigerad måltid, aktör, request-id och
skapad revision. Den nya revisionen bär beslutets id som provenans.

Råmeddelande, CardReadout, stämplingar, Entry, klass, bana, snapshot,
stationspaket och äldre revisioner ändras aldrig. Snapshotversionen ökar inte:
detta är en explicit resultatmutation. Senare ingest kan fortsatt skapa en ny
teknisk revision men får inte skriva om beslutet. Automatisk omräkning,
bulkändring, ändrad starttid, split-/kontrollrättning, fri reason och skapande
av saknad målpassage ligger utanför uppgiften.

## Samtidighet, idempotens och projektioner

Preview och commit låser exakt `raceId`, `entryId`, aktuell entryversion,
snapshotversion, historisk klass/bana, källrevision/id/revision, `readoutId`,
källans måltid och canonical basis-hash. Commit följer befintliga
resultatmutations ordning: session/credential, race-läsning, request-advisory-
lås, entrylås, exact replay, grundkontroll, beslut och revision atomiskt.
Idempotensnyckeln är `manual-finish-time-correction:<request-id>`; exakt samma
aktör och normaliserade intent återger samma kvittens, medan annan tid, källa
eller aktör konflikterar utan delwrite.

Den strikta stored-result-revision-valideringen måste verifiera den nya orsaken
mot dess beslut: endast måltid/löptid får skilja från den frysta källan och
tidsinvarianterna måste hålla. Publikranking och Snapshot-/IOF-export använder
den nya validerade revisionen utan ny IOF-status. Äldre frysta Complete-XML är
byte-identisk; en ny slutlig finalisering kräver den nya revisionen och fryser
den enligt ADR-0028. Resultat med neutraliserad kontroll fortsätter följa
ADR-0110:s fail-closed-finaliseringsregel.

## Operativ yta och återställning

Den gemensamma svenska `/manage`-vyn visar funktionen endast för en laddad,
giltig kandidat: gammal start/mål/löptid, senaste split, ny måltid och den
beräknade nya löptiden. Operatören granskar och bekräftar i två steg; efter ett
osäkert svar får exakt samma request återförsökas. Ingen klientkö, lokal
resultatcache eller ny capability införs.

Vid incident stängs routen. Journal, gamla revisioner och korrigerad revision
bevaras; återtagande, om det behövs, blir ett eget senare ADR-beslut.

## Konsekvenser

Detta ger ett praktiskt sätt att rätta ett dokumenterat målfel utan att låtsas
att rå SPORTident-data ändrats. Det är medvetet inte stöd för generella
manuella tider eller flera samtidiga rättningar.
