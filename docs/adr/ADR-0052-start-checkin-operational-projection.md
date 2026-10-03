# ADR-0052: Privat operativt avprickningsunderlag

- Status: Accepterad; TASK 006W under implementation
- Datum: 2026-09-05
- Inga ändrade teknikval eller domängränser.

## Beslut

START_CHECKIN och FINISH_FOREST_WATCH får ett gemensamt racebundet,
versionsmärkt privat läsunderlag. VIEW_START_LIST ger inte denna behörighet.
Underlaget läses i en repeatable-read-transaktion efter sessionskontroll och
race SHARE. Hela aktuella rostern måste täckas; storleksöverskridande ger fel,
inte en till synes fullständig delmängd.

Varje deltagare har entryversion, klass/startregel, namn/klubb, fast starttid
endast för FIXED, entydig aktiv bricka och högsta operativa revision.
Omarkerad revision 0 betyder UNMARKED/false, aldrig ej startande.
Återkomst grundas på explicit manuell retur eller faktisk race/entry-bunden
avläsning via aktuell/historisk permanent brickkoppling eller tekniskt
resultat med readoutreferens. DNS-status från centralt validerat aktuellt
resultathuvud är ett separat faktum, aldrig bevis på återkomst.

buildForestWatchList i domain klassificerar alla entries från dessa fakta.
Bekräftad återkomst kan samexistera med konflikt; en motsägelse får inte
dölja returuppgiften. Avvisade men durabelt mottagna konfliktrapporter hålls
synliga konservativt. En senare vanlig markering får inte tyst radera deras
spår eller automatiskt kvittera dem som granskade. Explicit avskrivning av
konflikter är inte införd av detta läskontrakt; tills sådan finns visas de
som uppföljningsbehov, även efter annan senare ändring.

Enhetslistan visar registrerad enhet, label, funktion och senast durabelt
mottagen sekvens/tid. Tidpunkten är inte ett heartbeat eller bevis på att
mobilens kö är tom. knowledge=LAST_SYNCED_ONLY finns alltid, även vid noll
köade poster enligt senast känd serverdata. generatedAt är lästid, inte
senaste observation från skogen. Båda betydelser ska synas på skärm/utskrift.

Ingen hash, rawpayload, credential, enhetshemlighet eller operationsintent
lämnas ut. Dokumentet aktiverar ingen offentlig sida, GPS eller liveposition.
Klientens privata IndexedDB och säkra lokala upplåsning måste implementeras
separat; denna projektion ensam är inte offlinefunktion eller färdig lista.

## Acceptans

PostgreSQL-prov ska verifiera full roster (FIXED och PUNCH), auth/racescope,
revision 0, start utan retur, explicit DNS, manuellt/tekniskt återkommen och
konflikt. Uppgifterna måste vara read-only och deterministiskt sorterade.
Kontrakttester avvisar dubletter, motstridig nollrevision, falsk följduppgift,
fast tid för fri start, tvetydig bricka och extra privata källfält.

## HTTP-gräns

Varje funktion får separat statisk URL-yta och separat cookiepar:
start-checkin respektive finish-forest-watch. Routefilen väljer capability;
en klientstyrd action, URL-parameter eller cookie från annan funktion får
inte höja behörigheten. Session GET/POST/DELETE, roster GET, devices POST
och sync POST använder befintligt raceadmin-substrat med no-store,
SameSite=Strict, HttpOnly-session och Secure/__Host i HTTPS-produktion.
Utveckling tillåts endast på explicit konfigurerad HTTP-loopback.

Mutationer kräver exakt konfigurerad Origin och CSRF. JSON läses först av
applikationens readBody-callback efter auth och begränsas till 4 KiB enligt
befintligt säkerhetssubstrat. Login har samma storleksgräns. Idempotens ligger
i operationsrequest/device-sekvens och registreringens deviceId; ingen extra
HTTP-header med oberoende idempotensidentitet läggs till.

Durabel effect=CONFLICT returneras som validerad STORED-kvittens med HTTP 200,
inte som förlorad transport. Transport-/identitetskonflikt ger 409 utan kvittens.
Ogiltig body ger 400, auth 401/403, saknat objekt 404, för stort roster 413,
och interna fel ett detaljfritt 500-svar. Alla svar är privata/no-store.
Detta aktiverar skyddade API-anrop, men utgör ännu inte mobilens offlineflöde.

## Målpersonalens läs- och utskriftsvy

Privat /admin/<raceId>/forest-watch visar persondata först efter
FINISH_FOREST_WATCH-auth. Vyn presenterar domänens färdiga forestState och
källfakta; den räknar inte om status eller gör resultatbeslut. Alla fem grupper
visas, även tomma, med klassfilter och tydligt antal visade/hela rostern.
Utskrift använder samma filtrerade underlag, med race-id, snapshotversion,
genereringstid, tidszon, filter, källor och alla enheters senaste mottagning.
Tom uppföljningsgrupp får aldrig beskrivas som att skogen säkert är tom.

Lässteget håller roster endast i minnet och är inte den obligatoriska senare
offlineklienten. Nätfel behåller senaste underlaget med varning; authfel,
utgången session och lokal utloggning döljer det. Utloggning avbryter pågående
läsning så sent svar inte återvisar persondata. Ingen Web Storage eller cache
införs. Requesttimeout omfattar hela svaret. Separat sessionkontroll vid
återgång till flik och periodisk läsning kontrollerar fortsatt behörighet.
Sparad utskrift kan inte återkallas; den märks privat och daterad.

UI-/browserprov ska täcka login, alla fem grupper, klassfilter, utskriftsmedia,
nätfel/gammalt underlag, authfel/logout utan återvisning och mobilbredd.
Detta lässteg ersätter inte offlineavprickning, rättning eller konfliktgranskning.
