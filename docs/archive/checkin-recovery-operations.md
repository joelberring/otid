# Privat återhämtning av avprickningskö

## Implementationsläge

TASK 006W / ADR-0055. Mobilens manifestexport och betrodd serverutfärdning/
spärrning samt HTTP-leverans och mobilens återhämtningsformulär finns.
Browser/HTTP/PG-prov med syntetiska data verifierar spärrad originalbehörighet,
tappat svar, offline-omladdning, låsning och samma-operation-retry.
Fysiskt fältstöd är fortfarande inte verifierat; explicit konfliktgranskning
är nästa del av TASK 006W.

## Före utfärdning

Ansvarig arrangör verifierar mobilens ursprung och varför återhämtning behövs.
Exportera privat återhämtningsunderlag från den upplåsta originalkön. Behåll
originalkön och lösenfrasen; manifestet innehåller bara ID/sekvens/hash och
kan inte återställa själva markeringarna på en annan mobil.

Ursprunglig arbetscredential måste redan vara utgången eller spärrad. Kommandot
förlänger, flyttar eller spärrar den inte automatiskt. Vid misstänkt missbruk
krävs ett separat arrangörsbeslut; manifestet är inte själv ett behörighetsbevis.
Använd endast den avsedda serverns DATABASE_URL och en migrerad databas.

## Utfärda en gång till privat fil

Kör från projektroten i betrodd servermiljö. Exemplet är en mall, inte en
uppmaning att köra mot en riktig tävling. Välj giltig UTC-tid högst en timme
framåt, en ny privat utfil och en saklig orsak utan onödiga personuppgifter.

```bash
umask 077
node --import tsx scripts/checkin-recovery.ts issue --operator-label '<operatör>' --reason '<orsak>' --expires-at '<YYYY-MM-DDTHH:mm:ss.sssZ>' < /private/path/manifest.json > /private/path/new-recovery-grant.json
```

Manifest och bearer-token får inte ligga i kommandoargument, URL, browsercache,
delad terminalhistorik eller logg. CLI kräver omdirigerad stdin och stdout vid
utfärdning. Utfilen innehåller grantId, token, manifestHash och expiresAt.
Förmedla token privat till rätt operatör för den upplåsta originalkön.
Servern lagrar endast hash av hemligheten, aldrig token. Ett grant ger inte
vanlig session, rosterläsning, nya markeringar eller rätt att ändra originalen.

Utfärdning är ett nytt explicit beslut, inte automatiskt samma grant vid ett
nytt kommando. Vid förlorad utdata ska man granska serverjournalen, spärra ett
identifierat oanvänt grant vid behov och fatta ett nytt beslut. Gissa inte att
ett felmeddelande bevisar att transaktionen aldrig committade. Feltexten är
avsiktligt generell för att inte skriva ut privata SQL- eller inputvärden.

## Spärra separat grant

```bash
node --import tsx scripts/checkin-recovery.ts revoke --grant-id '<uuid>' --operator-label '<operatör>' --reason '<orsak>'
```

Samma grant/operatör/orsak kan återförsökas utan nya journalposter. Ändrad orsak
eller operatör vid upprepning avvisas; en gammal revocation skrivs inte om.
Spärrning och framtida leverans serialiseras på grantets databasrad.

## Leveransgräns

Serverns POST `/api/admin/races/<raceId>/checkin-recovery/sync` tar exakt samma
frysta operation/hash som vanlig synk, med token i `Authorization: Bearer …`
och rätt `Origin`. Cookies ger ingen recovery-auktoritet. JSON begränsas till
4 KiB och alla svar är privata/no-store. Token verifieras före body och igen
under grantlås; ändrad eller olistad operation avvisas. STORED/CONFLICT är en
mottagen konflikt, inte en genomförd markering. Ett lyckat POST är aldrig i sig
tillstånd att radera enda lokala kopian; vanlig kvittensvalidering och durabel
lokal commit krävs. Mobilkopplingen använder samma kvittensgrind som vanlig synk.

## På originalmobilen

Lås upp den bevarade listan. Under avprickningslistan finns formuläret
"Återför bevarad kö med arrangörens hjälp". Klistra in tillfällig behörighet,
bekräfta att original och konflikter ska bevaras och skicka uttryckligen.
Tokenfältet töms direkt. Token används bara under detta försök, inte i
automatisk synk, browserlagring eller cache. Låsning avbryter pågående försök.

Kvittenser sparas durabelt en i taget innan nästa post skickas. Vid tappat
svar, låsning eller nätfel kan samma behörighet återanvändas medan den är giltig;
redan kvitterade poster dubbleras inte. En utgången/spärrad recovery-behörighet
behöver ett nytt administrativt beslut. Inget intent ombaseras automatiskt.
Efter lyckad återföring är gamla rosterunderlaget fortfarande gammalt och
gamla arbetscredentialen fortfarande ogiltig. Recovery får inte hämta ny
roster eller göra listan redo för fortsatt arbete. Konflikter kvarstår för
arrangörens granskning och syns som mottagna, inte genomförda markeringar.

Inga tabeller ska raderas vid rollback. Stäng av återhämtningsvägen och bevara
grant, items, leveranser, spärrningar och originalkön. Se migrations-README.
