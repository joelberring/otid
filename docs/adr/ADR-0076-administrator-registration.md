# ADR-0076: Direktanmälan med gemensam administratör

- Status: Accepterad
- Datum: 2026-09-12

## Beslut och omfattning

TASK035 ansluter befintlig REGISTER_ENTRY till MANAGE_RACE enligt ADR-0069.
Registreringens tjänst, journal och kontrakt enligt ADR-0041 återanvänds;
verklig administratör får audittypen RACE_ADMIN_ACCESS_CREDENTIAL. Journalen
binder redan actorCredentialId och saknar begränsande capabilitykolumn, så
ingen migration behövs. Begränsad registreringsroll behåller sin exakta rätt.

Gemensamma adminroutes får registration POST. Befintlig transfer-candidates
GET återanvänds som sammanhängande klass-/kapacitetsunderlag; ingen extra
klasslista eller separat läsning behövs för samma administratör.
Samma admincookies, exakt roll-preflight, Origin/CSRF, 4KiB faktisk JSON och
private no-store gäller. Kvittensen binds till request/race/klass, alla nya
personfält, bricka/starttid och snapshot; skapade entry/assignment-ID:n
valideras av befintligt schema. Ingen ny separat registreringsinloggning.

Knappen Ny deltagare i deltagarlistans verktygsrad öppnar Direktanmälan utan
valt befintligt deltagande. Kompakt
formulär har förnamn, efternamn, valfri klubb/bricka och befintlig klass.
Klassunderlaget hämtas ur samma adminrosters race/snapshot/klass/bana/startregel.
Platsläge visas från befintlig roster; det är ingen reservation. Full klass
kan inte granskas. Serverns befintliga canAddClassEntry under race UPDATE är
auktoritativ även när en kapacitetsändring inte ökar snapshot.

FIXED kräver granskat datum/klockslag/offset med befintliga tidsregler; PUNCH
kräver null. Samma gemensamma operation/pendingintent används. Efter tappat
svar skickas exakt samma request. Efter kvittens hämtas roster, ny entry väljs
och befintliga rättningsåtgärder kan användas utan ny inloggning. Namn är
aldrig identitet; ingen automatisk sammanslagning eller fabricerad resultatstatus.

## Bevarade gränser och återgång

Registrering skapar entry version1, valfri assignment, snapshot+1 och atomisk
journal/audit. Historiskt brickägarskap blockerar återanvändning. Gamla rådata,
resultat, installerade paket och frysta exporter ändras inte. Nytt paket får
ny roster. Tidigare okänd avläsning kräver separat explicit omräkning.
Webbintent finns endast i minnet och är ingen offlinekö. Vid återgång stängs
adminvägen/policyåtgärden; historiska registreringar och journaler bevaras.

## Acceptans

Riktad PG-regression: admin och begränsad registrerare, verklig audit, exakt
retry, stale/annanaktör/upptagenbricka/fullklass utan delvisa writes.
Browser med riktig HTTP/PG: samma login, ny deltagare i PUNCH och FIXED,
platskontroll, tappat svar/exakt retry och fortsatt rättning av skapad entry.
Kontrollera desktop/mobil, scopes och full kvittensbindning samt riktad lint,
typecheck, tester och build. Använd endast isolerad syntetisk testdatabas.

TASK028:s separata dubblettsökning är fortsatt ett eget oavslutat snitt, inte
ett påstående om färdig automatisk kontroll. Globala person-/klubbregister,
betalning, Eventorskrivning, bulkregistrering och hårdvara ingår inte.
Ingen ny teknik, domängräns, dependency eller extern licens/kod används.
