# ADR-0112: återtagande av manuell måltidsrättning

- Status: Accepterad och implementerad i TASK094
- Datum: 2026-09-19

## Kontext

TASK093 kan skapa en spårbar, append-only rättning av en felaktigt observerad
måltid. Operatören kan dock själv ha angett fel tid. Att radera eller ändra
TASK093:s journal eller dess skapade resultatrevision skulle förstöra den
beslutade historiken. Att samtidigt införa en generell resultateditor eller ett
gemensamt ramverk för alla manuella beslut skulle bredda resultatmodellen utan
att behövas för denna åtgärd.

## Beslut

TASK094 får införa ett enda `MANAGE_RACE`-skyddat, append-only återtagande av
en **aktuell** `MANUAL_FINISH_TIME_CORRECTION`. Återtagandet är bara möjligt när
den korrigerade revisionen är entryns absoluta senaste huvud och när den är
den enda revisionsstegen efter den exakta direkta tekniska källrevision som
TASK093:s journal binder. Aktivt manuellt DNS/DNF/DSQ/godkännande/OOC/NT,
senare teknisk revision, ny rättning, ändrad entry-/klass-/bangrund eller
saknad/motsägande proveniens avvisar hela operationen utan write.

Återtagandet skapar en ny immutable journalrad och en ny
`MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL`-revision. Den nya revisionen
återställer exakt `evaluation`, status, reason, kursversion och snapshot från
den TASK093-lagrade tekniska källrevisionen; den räknar inte om, ändrar inte
brickavläsning och väljer inte en annan äldre revision. Råmeddelanden,
CardReadout, TASK093-journalen, rättningsrevisionen, den tekniska
källrevisionen, race-snapshoten, stationspaket och tidigare frysta Complete-XML
förblir oförändrade.

Requesten binder entryversion, klass, kursversion, snapshot, TASK093-journal,
teknisk källrevision, korrigerad revisionshuvud och absolut aktuellt huvud.
Idempotensnyckeln är
`manual-finish-time-correction-withdrawal:<request-id>`. Samma aktör och exakt
normaliserat intent återger samma kvittens; annan aktör eller ändrat intent
konflikterar. En separat withdrawal-journal har ömsesidiga FK-/unikhetsbarriärer
mot skapad restoration revision och den ursprungliga TASK093-journalen.

## Projektion och drift

Delade resultatstate-loadern och strict stored-revision-valideraren måste
validera journalen, den korrigerade revisionen, den tekniska originalkällan och
den återställda revisionen tillsammans. Om något bevis saknas avvisas
projektionen fail-closed. Publikresultat, ranking, speaker, admin, Snapshot
IOF och framtida finalisering läser därefter den nya validerade revisionen utan
ny IOF-status. Privat historik visar den korta kedjan: teknisk källa →
måltidsrättning → återtagande.

Den svenska `/manage`-ytan använder GET-kandidat och POST-commit i två steg.
Den visar gammal teknisk måltid, felaktigt korrigerad måltid och exakt
återställd måltid. Efter osäkert svar återförsöks samma request; ingen offlinekö,
lokal resultathistorik eller ny capability införs.

## Konsekvenser

Återtagandet kan bara rätta ett omedelbart och fortfarande aktuellt misstag.
Det är medvetet striktare än en fri resultateditor. Återtagande av DNS, DNF,
DSQ, godkännande, OOC eller NT är redan separata livscykler och ändras inte.
Bulkändring, ändrad starttid, split-/kontrollrättning, GPS, karta/rutt, stafett
och USB ligger utanför.

## Implementationsnotering

TASK094:s kontrakt, additiva migration, låsta transaktionsskrivare, gemensamma
resultatprojektioner, privata historikformat 12 och den kompakta svenska
GET/POST-ytan är implementerade. Riktad PostgreSQL- och 390 px-browseracceptans
bevisar append-only-kedjan, tappat första HTTP-svar och exakt retry.
