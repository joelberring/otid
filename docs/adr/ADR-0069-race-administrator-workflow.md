# ADR-0069: En inloggning för tävlingsadministratörens arbete

- Status: Accepterad
- Datum: 2026-09-12

## Beslut och relation till tidigare snitt

En uttryckligen utsedd tävlingsadministratör får en gemensam racebunden roll
MANAGE_RACE. Separata funktionsnycklar i ADR-0018 med flera var tidiga
avgränsningar, inte slutlig produktdesign. Detta beslut ersätter kravet på
separat funktionsinloggning för administratören. Begränsade operatörsroller
finns kvar och blir inte administratörer automatiskt.

Befintligt hashbaserat credential-/sessionslager återanvänds. En ny credential
med prefix otid_org_race_admin_v1 är explicit tilldelning till ett lopp;
ingen gammal credential eller tävlingsskaparbehörighet uppgraderas. Första
utfärdning sker genom betrott serverflöde. Detta är inte ännu ett konto-/
medlemsregister för flera tävlingar. Administratörstilldelning via webb byggs
utan att kräva en nyckel per funktion.

Login/logout/revoke gäller den verkliga rollen. Auktorisering får däremot
godkänna roll → uttryckligen integrerad åtgärd. Principal och journal behåller
verkligt credential-id och capability; ingen maskering som begränsad aktör.
RACE_ADMIN_ACCESS_CREDENTIAL är separat sann auditaktör. Exakt retry binds
som tidigare till den ursprungliga aktören, inte vilken administratör som helst.

Första integrerade åtgärder är VIEW_RACE_OVERVIEW, VIEW_START_LIST och
CHANGE_ENTRY_CLASS. En central explicit lista växer när respektive arbetsvy
kopplats till samma session och verifierats. Den är ingen wildcard över alla
framtida capabilities. Målet är vanliga tävlingsadministrativa åtgärder med
samma inloggning, inte permanent funktionsuppdelning. Offlineenheters identitet,
PM-skanning och externa serverhemligheter följer inte automatiskt med rollen.

Credential gäller högst åtta timmar och session högst en timme enligt
befintlig tävlingspolicy. Gemensamma admincookies används av dedikerade routes;
ingen tvetydig fallback mellan äldre funktionscookies. De befintliga
applikationsåtgärderna återanvänds bakom routes. Origin/CSRF, race-scope och
konkurrenskontroller ligger bakom formuläret, inte som extra användarsteg.

## Klassbyte som en arbetsåtgärd

Klassnamn eller ”öppen” får inte användas för att gissa resultat- eller
startregel. Målklassens faktiska startregel styr. FIXED kräver granskad fast
starttid, PUNCH använder startstämpel och sparar null fast starttid i det nya
sammanhängande bytesflödet. Gammal klass/tid sparas i historiken.

Plats betyder först en valfri konfigurerad maxgräns för klassens registrerade
entries. Ingen satt gräns betyder ingen konfigurerad antalsbegränsning, inte
bevis på ledig minutstart. DNS frigör inte automatiskt en registrerad plats.
En antalsgräns får inte förväxlas med startlottning/startluckor. Alla writers
som kan öka klassens antal måste följa samma gräns innan den aktiveras.

Klass och starttid ska ändras atomiskt under race-/entrylås, med granskade
versioner och idempotent journal. Resultatpåverkan ska visas i samma arbetsvy;
en omräkning kan erbjudas som uttrycklig nästa åtgärd med samma inloggning
när den är integrerad. Äldre resultatrevisioner och frysta exporter bevaras.
Fullt klass-/startbyteskontrakt och platsmigration införs innan den delen
aktiveras; befintligt klassbytes-v1 får inte påstå att det redan gör detta.

## Migration, begränsningar och återställning

Första additiva migrationen lägger till roll, auditaktör och livslängdsvillkor.
Det gamla klassbytesjournalets aktörs-FK stödjer rollen utan historikändring.
Nyare identity-/PM-/checkin-journaler har exakta capabilityrelationer: de får
inte aktiveras genom en wildcard eller genom att ta bort relationskontroller.
De integreras uttryckligen med verklig aktör när respektive vy ansluts.

Vid incident stängs nya adminroutes och rollen spärras; befintliga begränsade
roller fortsätter enligt gammal policy. Enumvärden/journaler raderas inte.
Ingen rådata, resultatmotor, teknikval eller licensgräns ändras.

## Kontrakt för atomiskt klass-/startbyte

Ny läsning transfer-candidates innehåller raceDate/timeZone, snapshot,
klasser med courseVersionId/startRule och entries med version/klass/fast tid.
Ny transfer-request fryser expectedEntryVersion, expectedClassId,
expectedSnapshotVersion, expectedFixedStartTime, targetClassId,
expectedTargetCourseVersionId, expectedTargetStartRule och fixedStartTime.
FIXED kräver explicit offsetbunden tid; PUNCH kräver null. Ingen klocktid eller
startlucka gissas från klassnamnet. Samma målklass avvisas; individuell
starttidsrättning utan klassbyte är fortsatt en annan arbetsåtgärd.

Dedikerad MANAGE_RACE-tjänst låser session/credential → race UPDATE → request
advisory → entry UPDATE. Race-/entry-/målklass-/banversion och gammal tid
kontrolleras före write. Entryklass och fast tid uppdateras tillsammans,
entry/snapshot ökar ett och ny immutable entry_transfer_request plus audit
sparas i samma transaktion. Request-id har prefix entry-transfer: och binder
hela normaliserade intentet, aktör, race och entry; exact retry läser originalet
före aktuell snapshotkontroll. Ny separat journal bevarar gamla v1-journaler.
Kvittensen innehåller det sparade requestintentet och versionsutfallet.

UI använder ny endpoint /administrator/entries/{entryId}/transfer och
granskar klass/startregel/tid tillsammans. Gamla begränsade klassbytes-v1 och
dess historik ändras inte i detta steg. Platstak är ännu inte aktiverat; innan
det införs måste även legacy-, import- och direktanmälanswriters följa taket.
Historiska resultat/publiceringar och installerade paket bevaras; nya paket
använder nya uppgifter. Senare import följer befintlig importpolicy, ingen
namnbaserad identitetskoppling eller ny generell importspärr införs här.

Tidskontraktet behåller befintlig millisekundprecision. Äldre lagrad tid med
finare precision avvisas uttryckligen i underlag/mutation; den får inte tyst
avrundas och därmed försvaga jämförelsen med granskad tidigare tid.
