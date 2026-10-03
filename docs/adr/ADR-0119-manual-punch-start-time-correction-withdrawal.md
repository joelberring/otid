# ADR-0119: återtagande av manuell PUNCH-starttidsrättning

- Status: Implementerad
- Datum: 2026-09-20

## Kontext

TASK104 kan skapa en spårbar, append-only rättning av en felaktigt observerad
startstämpling i en PUNCH-klass. Operatören kan dock själv ange fel starttid.
Att radera eller ändra TASK104-journalen eller dess skapade resultatrevision
skulle förstöra beslutad historik. En generell resultateditor eller gemensamt
återtaganderamverk skulle bredda resultatmodellen utan att behövas här.

## Beslut

TASK105 inför ett enda `MANAGE_RACE`-skyddat append-only återtagande av en
**aktuell** `MANUAL_PUNCH_START_TIME_CORRECTION`. Återtagandet är bara möjligt
när den rättade revisionen är entryns absoluta senaste huvud, den är enda
revisionssteget efter den exakta direkta tekniska TASK104-källan och det
bevarade `CardReadout.startPunchedAt` fortfarande matchar källans start.
Aktiv DNS/DNF/DSQ/godkännande/OOC/NT-overlay, senare teknisk revision, ny
rättning, ändrad entry-/klass-/bangrund, annan snapshot eller saknad/
motsägande proveniens avvisar hela operationen utan write.

Återtagandet skapar en immutable journalrad och en ny
`MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL`-revision. Den nya revisionen
återställer exakt `evaluation`, status, reason, kursversion och snapshot från
den TASK104-lagrade direkta tekniska källrevisionen. Den räknar inte om, väljer
inte en annan äldre revision och ändrar inte brickavläsning. Råmeddelanden,
CardReadout, TASK104-journalen, rättningsrevisionen, den tekniska källan,
race-snapshoten, stationspaket och tidigare frysta Complete-XML förblir
oförändrade.

Requesten binder entryversion, klass, kursversion, snapshot, TASK104-journal,
teknisk källrevision, rättad revisionshuvud och absolut aktuellt huvud.
Idempotensnyckeln är
`manual-punch-start-time-correction-withdrawal:<request-id>`. Samma aktör och
exakt normaliserat intent återger samma kvittens; annan aktör eller ändrat
intent konflikterar. En separat withdrawal-journal har ömsesidiga FK- och
unikhetsbarriärer mot skapad restoration revision och den ursprungliga
TASK104-journalen.

## Projektion och drift

Den delade resultatstate-loadern och strict stored-revision-valideraren
validerar journalen, den rättade revisionen, den tekniska originalkällan,
lästa starten och den återställda revisionen tillsammans. Saknat bevis avvisar
projektionen fail-closed. Publikresultat, ranking, speaker, admin, Snapshot
IOF och framtida finalisering läser sedan den nya validerade revisionen utan
ny IOF-status. Privat historik visar kedjan teknisk källa → start-rättning →
återtagande.

Den svenska `/manage`-ytan använder GET-kandidat och POST-commit i två steg.
Den visar teknisk start, felaktigt korrigerad start och exakt återställd start.
Efter osäkert svar återförsöks samma request; ingen offlinekö, lokal
resultathistorik eller capability införs.

## Konsekvenser

Återtagandet kan bara rätta ett omedelbart och fortfarande aktuellt misstag.
Det är medvetet striktare än en fri resultateditor. Återtagande av DNS, DNF,
DSQ, godkännande, OOC eller NT följer redan egna livscykler och ändras inte.
Bulkändring, ändrad fast start, mål-/spliträttning, GPS, karta/rutt, stafett och
USB ligger utanför.
