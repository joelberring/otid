# ADR-0049: Offlineavprickning, härledd ej start och skogskontroll

- Status: Accepterad verksamhets- och domängräns; integration återstår
- Datum: 2026-09-05
- Ersätter ADR-0048:s förbud mot resultatföljd av explicit ej-startmarkering.
  Dess rena avprickningsregel och versionsskydd behålls.

## Bekräftat användarbehov

Startpersonal ska kunna pricka av med mobil utan internet, behålla uppgifterna
lokalt och synka senare. Uttryckligt ej start ska därefter bli ej start i
systemet och kunna rättas vid mål. Målpersonal ska få kvar-i-skogen-listor.
Detta är ett fullständigt krav, inte valfri senare offlinefunktion.

## Beslut

### Ingen utebliven checkbox blir ett frånvarobeslut

UNMARKED är okänd startstatus och ger aldrig DNS. Endast uttryckligt
REPORTED_NOT_STARTED får ge ett spårbart DNS-resultat vid serverns synccommit.
Markeringen är mänsklig uppgift, inte maskinavläsning. Dess källtyp måste
kunna skiljas från den befintliga separata manuella DNS-administrationen.
Klicktid får inte bli officiell starttid i vare sig FIXED eller PUNCH.

### Offline betyder hållbart sparat, inte enbart browsercache

Cache/service worker används för ett separat persondatafritt offline-appskal.
Privat hämtad roster och markeringskö ska ligga i transaktionsstyrd IndexedDB
med begärd strict durability. UI kvitterar lokalt först på transaction complete.
Persistens ska kontrolleras före bruk; avslag/kvotfel får inte ge "sparat".
Begär persistent storage och visa dess faktiska utfall. Ingen garanti mot
användarens radering av webbläsardata eller förlust av mobilen får utlovas.

Varje operation fryser lokalt device-id, sekvens, request-id, race/entry,
förväntad revision, innehållshash och uppgiven observationstid före sändning.
Servermottagningstid lagras separat. Retry använder exakt samma operation.
En konflikt är inte en kvittens på genomförd ändring och får inte tyst
ersättas med nytt intent eller last-write-wins.

Kön behålls vid nätfel, utgången session och omladdning. Ny inloggning får
inte radera den enda kopian. Cache får inte innehålla API-svar, credentials,
kartor eller privata Next/RSC-responser. Privat lokal roster kräver ett
uttryckligt val att förbereda mobilen, information om enhetslås och en separat
säker rensning efter synk; osynkade markeringar får inte raderas av logout.
Exakt behörighets-/återinloggningsprotokoll fastläggs före dess implementation.

### Atomisk servereffekt och rättning vid mål

En ny separat racebunden startbehörighet ger inte generell resultaträtt.
Under race→entry-lås committas operation, avprickningsrevision, eventuell
DNS-effekt, källbindning och audit atomärt. Kvittensen binder operation/hash
och båda effekterna. Existing READOUT och VIEW_START_LIST breddas inte tyst.

Sen negativ offlinemarkering får aldrig lägga ett aktivt DNS ovanpå verklig
avläsning/resultathistorik. Motsägelsen måste visas och bevaras i journalen.
Om DNS kom först får en verklig mål-/kortavläsning skapa nästa tekniska
revision. Målpersonal ska dessutom kunna rätta ett felaktigt rapportbesked
eller registrera återkomst även när avläsning saknas, med egen behörighet och
append-only-historik. Återkomst innebär inte automatiskt OK eller måltid.

Befintligt did_not_start_decision kräver manual källa/revision 1 och får
inte försvagas eller missbrukas. Ny källprovenans och dess återtagande kräver
additiv migration och restore-not. Ny startmarkering efter återtaget
avpricknings-DNS får inte råka återuppliva en äldre DNS-revision.

### Privat kvar-i-skogen-lista

Alla aktuella deltagare ska klassificeras, inte bara de som kryssats i:

- STARTED_NO_RETURN: rapporterad start, ingen styrkt registrerad återkomst.
- UNCONFIRMED: start okänd; måste synas separat och får inte tyst avskrivas.
- NOT_STARTED: uttryckligt aktuellt ej-startbesked utan motsägande start/retur.
- RETURNED: registrerad återkomst; betyder inte godkänt tävlingsresultat.
- CONFLICT: motstridiga uppgifter; ska ligga i en tydlig granskningsgrupp.

Domänregeln klassificerar validerade, racebundna fakta. Applikationen måste
styrka återkomst med kopplad mål-/avläsningskälla eller manuellt återkomstbeslut;
frånvaro av resultat, DNS, DNF, DSQ eller ett namn räcker inte som bevis.
En okänd bricka får inte avskriva en namngiven deltagare.

Målpersonal behöver klassfilter och utskrivbar lista med namn, klubb, klass,
relevant startuppgift, källa/osäkerhet, genereringstid och senaste kända
startenhetssynk. En server kan inte veta om en offlineenhet fått nya osynkade
markeringar; dess uppgifter ska visas som senast kända, aldrig "alla synkade"
utan bevis. En gammal utskrift är en daterad ögonblicksbild. Listan är privat
och ett beslutsunderlag, inte en garanti att ingen finns kvar i skogen.

## Acceptans och leveransgräns

Slutacceptans kräver browseroffline + omladdning, nätåterkomst/tappat svar,
flera mobiler, PostgreSQL-atomicitet, DNS→rättning i båda ankomstordningar,
auth, privat skogskontroll/utskrift och synlig osäkerhet. Inga sådana flöden
är klara bara för att rena regler passerar unit tests.

Ingen automatisk SPORTident-starttransport, GPS, stafett, kartvisning eller
USB tillkommer. Teknikvalet förblir Next/TypeScript/PostgreSQL med browserns
egna IndexedDB/service worker; ingen ny extern dependency beslutas.
