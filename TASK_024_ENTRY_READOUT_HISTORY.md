# TASK024 – deltagargenväg till avläsningshistorik

## Avgränsning före implementation

ADR-0065 beslutar serverfiltrering före pagination, ursprunglig CARD_READOUT-
bindning och separat entry-scopad cursor/response. Befintlig historikcapability
återanvänds. Berör contracts, application och web. Ingen klientfiltrering av
första 50 raceavläsningarna; det skulle inte uppfylla deltagarhistorik.

## Acceptans

- Strikt response: samma race/entry på alla rader, giltig tom deltagarsida.
- PG: deltagare bakom fler än 50 andra readouts; flera egna sidor; initial
  bindning trots brickbyte/senare revision; cursor/race/entry/auth/noll writes.
- Route validerar unika queryfält och befintlig privat auth/no-store.
- Browser: separat login, explicit deltagarval, sida/tomhet/vidaresidning,
  inga identifierare i browseradress eller beständig hint.
- Relevant lint/typecheck/test/build, exakt rapport och kvarvarande antaganden.

## Status

Arkitektur och responsekontrakt införs först. Serverprojektion, route, UI och
PG/browseracceptans återstår; uppgiften får inte kallas färdig före dessa.

Första verifieringen: contracts lint, typecheck och build exit 0; riktat
`vitest run test/entry-readout-history.test.ts` exit 0, 3 tester (390 ms).
Testerna täcker giltig tom sida, race-/entry-/namnmatchning, max 50, dubletter
och förbjudna extrafält. Detta verifierar endast DTO, inte serverfilter eller
historikens fullständighet. Nästa arbete är SQL-projektion/cursor och PG-prov.

Serverprojektion och privat GET-route är nu implementerade. SQL lateral väljer
första CARD_READOUT före entryvillkor/LIMIT, och en separat cursor binder
race/entry med exakt PostgreSQL-mikrosekundprecision. Application/web lint,
typecheck och build passerar. Riktade routeprov: 7 passerade; två nya återkörda
efter typningsrättning. PG: 3 passerade/128 bortvalda i ny otid_024_test (2.48 s).
Verifierar bakom51, egna sidor, cursorscope, mikrosekundseek, auth/tomentry,
brickbyte/senare falsk bindning och oförändrat radantal i fem skrivtabeller.

UI och browseracceptans är nu genomförda. Deltagarlistans genväg kräver egen
historiklogin och explicit Visa deltagarens avläsningar. Scoped cursor/refresh
använder den nya endpointen. Tom sida behåller entrynamn, felaktig scope avvisas,
och authförlust/scopebyte rensar privata sidor/detaljer. Sena svar är generations-
bundna. Ingen klientfiltrering av allmänna listans första 50.

Slutlig webbkontroll: lint/typecheck/build exit 0, 11 riktade tester och 2
browserprov (8.7 s) passerade. Separat browser-tsc/ESLint exit 0. Mobilbild
granskad och onödiga marginaler komprimerade, knapparnas storlek bevarad.
TASK024:s avgränsade funktion är färdig. Produktionsvolymer, queryplan/indexbehov,
fysisk mobil och produktionsdrift är inte verifierade; ingen schemaändring har
gjorts. Gammal allmän discoverycursor är oförändrad och dess Date-precision
behöver separat rättning/gränsfallsprov.
