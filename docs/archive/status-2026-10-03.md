# Projektstatus

## 2026-10-03: TASK301 namn rättas på befintlig manuell klass

ADR-0167 är accepterad före implementation: ändra visningsnamn med stabilt
klass-ID/banversion, utan automatisk omräkning eller omskrivna publiceringar.
Två återanvända Sol-agenter arbetar med backend respektive tunt namnformulär
vid vald klassrad. Huvudagenten har lagt route/request-bindning och ett litet
routeprov. Implementation och verifiering pågår; ingen grön leverans hävdas.
Se [TASK301](../TASK_301_MANUAL_CLASS_NAME_CORRECTION.md) och
[ADR-0167](adr/ADR-0167-manual-class-name-correction.md). Importägda klassnamn
behöver en separat uttrycklig omimportpolicy, inte en dold override.

## 2026-10-03: TASK300 ny klass på delad banversion

ADR-0166 är accepterad före kod: en ny manuell klass kopplas till exakt
befintlig banversion i samma lopp, utan kopierade banor/kontroller. Befintligt
TASK081-skapande behålls. TASK300 avgränsar en sammanhängande backend→UI-
leverans med immutable journal, race-/aktörsbunden retry och snapshotkontroll.
Två Sol-agenter har implementerat backend respektive kompakt Före→Klasser-
form; huvudagenten integrerade route, granskade och verifierade. Paketlint/
typecheck/build för contracts/database/application/web slutligen exit0.
Kontrakt2/2, isolerad PostgreSQL2/2 valda, route1/1 och återanvänt syntetiskt
browserfall1/1 på49,8 s. Första applicationlint hade två testtypningsfel;
fyra browserstopp var fixture-/locatorfel, redovisade i uppgiftsloggen.
Mobil390/desktop1280 bilder granskade,44 px kontroller/ingen horisontell
overflow verifierade. Webbuild exit0,22/22 statiska sidor.
Migration0085 provad i ny syntetisk databas, inte applicerad på demotävlingen.
Verklig HTTP→UI→PG-kedja, fysisk mobil, drift/TLS och full restore återstår.
Nästa minsta funktionella snitt: rätta namn på en manuell klass utan byte
av klass-ID eller banversion. Fullt produktmål/MeOS-likvärdighet är inte klart.
Se [ADR-0166](adr/ADR-0166-manual-class-on-existing-course-version.md)
och [TASK300](../TASK_300_MANUAL_CLASS_ON_EXISTING_COURSE.md).

## 2026-10-03: TASK299 funktionärens överlämningsväg

Källgenomgång av Före-kedjan identifierade saknad destinationsväg i
funktionärsåtkomsten. Befintlig åtkomstvy visar nu neutral instruktion och
loppbundna länkar till start-/målapp respektive tävlingsadministration.
Credential följer aldrig med länken; utfärdande/retry/spärrning är oförändrade.
Web/E2E-lint/typecheck och web-build exit0, återanvänt browserfall1/1 på40,6 s.
Faktisk kodöverlämning/offlineförberedelse ingår inte.
[TASK299](../TASK_299_STAFF_WORKFLOW_HANDOFF.md) redovisar även nästa
funktionella lucka: fristående manuell klass på befintlig bana kräver ADR.

## 2026-10-03: TASK298 inloggningen börjar spärrad

Baseline bevisade aktivt credentialfält före hydrering. Initial busy/ref
är nu true, utan ändrad autentisering. Det befintliga browserfallet håller
JavaScript och initial sessionsläsning med explicita gates: slutligen1/1
på15,9 s, exit0. Web/E2E-lint/typecheck och web-build exit0.
[TASK298](../TASK_298_INITIAL_ADMIN_SESSION_READINESS.md) skiljer det
bevisade glappet från TASK297:s ännu oförklarade första timeout.
Ingen riktig credential/databas/TLS eller fysisk mobilacceptans ingår.

## 2026-10-03: TASK297 deltagarstatus före banans kontrollföljd

INFO visar uppgifter → gällande resultat → tilldelad bana → historiska
sträcktider. Mobilfakta/bana är plana sektioner;44 px åtgärder är bevarade.
Web/E2E-lint/typecheck och web-build exit0, återanvänt browserfall slutligen
1/1 på11,9 s. Första körningen stannade vid inloggning efter45 s; orsaken
är inte bevisad och ingen autentiseringsfix påstås.
[TASK297](../TASK_297_PARTICIPANT_RESULT_PRIORITY.md) redovisar kontroller
och kvarstående osäkerhet. Ingen API-/domän-/databasändring; fältbruk återstår.

## 2026-10-02: TASK296 klassantal öppnar hela klassens deltagarlista

Neutral antalåtgärd öppnar exakt klassfilter, rensar gammal sökning/
specialfilter och personval samt fokuserar listan. Kapacitetsgräns förblir
separat text;44 px mål bevarar kompakt desktoprad. Web/E2E-lint/typecheck
och web-build exit0, återanvänt browserfall1/1 på18,0 s.
Användarens Codex-referens är förtydligad i produktplanen: neutrala ytor
och små textstödda statussignaler. Inga nya API-/domänregler eller databasändringar.
Antaganden och avgränsning finns i
[TASK296](../TASK_296_CLASS_PARTICIPANT_LIST_NAVIGATION.md);
fysisk mobil/fältbruk återstår.

## 2026-10-02: TASK295 välj klassinställningar direkt från klassnamn

Neutral klassnamnsåtgärd markerar exakt rad och förifyller befintliga
kapacitets-/startklassväljare. DIRECT-val ger ingen falsk bankontext;
markeringen rensas vid annat manuellt klassval utan tyst formulärsynk.
Kompakta desktoprader/44 px tryckytor bevaras. Web/E2E-lint/typecheck/build
exit0, återanvänt browserfall slutligen1/1 på15,9 s. Första avbrutna
testnavigeringen (exit130) redovisas i
[TASK295](../TASK_295_DIRECT_CLASS_SETUP_SELECTION.md).
Ingen ny API/domänregel/databas; fysisk mobil/fältbruk återstår.

## 2026-10-02: TASK294 klassens tilldelade bana öppnas direkt

Klassöversiktens neutrala banåtgärd öppnar exakt snapshotbunden banversion.
Saknat mål ger status utan fallback, deltagargenvägens kontroll bevaras.
Desktoprader förblir kompakta med44 px tryckytor. Web/E2E-lint/typecheck/
build exit0, återanvänt browserfall slutligen1/1 på17,0 s, inga skrivningar.
Bildgranskningens cellpadding-rättning redovisas i
[TASK294](../TASK_294_CLASS_ASSIGNED_COURSE_NAVIGATION.md).
Produktplanens UI-del är uppdaterad; fulla användarresor är fortsatt öppna.

## 2026-10-02: TASK293 banans klassnamn öppnar exakt klassupplägg

Neutrala klassknappar öppnar rätt klassrad och förifyller befintliga
kapacitets-/startregelväljare utan skrivning. Saknad-bana-varningen skiljs
från normal navigation. Bred desktop visar bana och klasser på samma rad;
mobilen radbryter, tryckytor minst44 px. Web/E2E-lint/typecheck/build exit0,
återanvänt browserfall slutligen1/1 på16,1 s. Första CSS-höjdfel och
bildgranskningens tätare layout redovisas i
[TASK293](../TASK_293_COURSE_ASSIGNED_CLASS_NAVIGATION.md).
Ingen ny API/domänregel/databas; fysisk mobil/fältbruk återstår.

## 2026-10-02: TASK292 från deltagare till exakt tilldelad bana

En neutral inlineåtgärd öppnar/fokuserar exakt banversion i Före → Banor.
Deltagarval bevaras vid återgång; likalydande banor blandas inte ihop.
Ingen ny API/domänregel. Web/E2E-lint/typecheck och build slutligen exit0;
återanvänt syntetiskt browserfall1/1 på8,1 s, 390/1280 px och noll
oavsiktliga skrivningar. Första typfelet redovisas i
[TASK292](../TASK_292_PARTICIPANT_COURSE_NAVIGATION.md).
Fysisk mobil/fältbruk återstår; ingen riktig tävlingsdata användes.

## 2026-10-02: TASK291 tilldelad/historisk bana med riktig databas

Ett befintligt desktopklassbytesfall återanvändes med två banversioner.
Tilldelning före första resultat och efter klassbyte skiljs från oförändrad
historisk resultatbana. Riktad E2E-lint/typecheck exit0, browser slutligen
1/1 på49,7 s. Första testnavigeringsfelet redovisas i
[TASK291](../TASK_291_ASSIGNED_COURSE_DB_ACCEPTANCE.md).
Ny syntetisk PostgreSQL17.11/PostGIS3.6.4 bevarad, egen process stoppad.
Ingen produktkod/demo ändrad; fysisk mobil och fältbruk återstår.

## 2026-10-02: TASK290 tilldelad bana i deltagarens INFO

Deltagarens läsläge visar nu nuvarande klasstilldelade bana/version och
kontrollföljd även före första resultatet, skilt från historisk resultatbana.
Exakt validerat privat banunderlag återanvänds, utan geometridata i UI.
Saknad version/läsfel ger inget gammalt kontrollunderlag; 403 rensar
arbetsytan. Riktad web/E2E-lint/typecheck/build exit0, återanvänt browserfall
slutligen1/1 på8,8 s. Första test-/typfel är redovisade i
[TASK290](../TASK_290_PARTICIPANT_ASSIGNED_COURSE.md). Ingen ny server-/
domänregel; riktig DB och fysisk mobil återstår för denna nya sektion.

## 2026-10-01: TASK289 följ upp saknade minutstartstider från Upplägg

Planera starten visar antal saknade fasta tider i redan lästa FIXED-
klasser och öppnar exakt befintligt deltagarfilter för samtliga berörda.
Fri start/tidsatta deltagare undantas; noll är neutral text, inte ett
klarbesked. Desktopfokus till listpanelen rättades. Riktad web/E2E-
lint/typecheck/build exit 0, komponenttest2/2, återanvänt browserfall
1/1 slutligen13,8 s. Ingen ny API, testsvit, DB eller riktig tävling.
Fysisk mobil och DB-filteracceptans återstår. Se
[TASK289](../TASK_289_PREPARATION_MISSING_START_TIMES.md).

## 2026-10-01: TASK288 handlingsbara förberedelsesteg

Före → Uppläggs sex stegrubriker öppnar nu rätt befintlig arbetsyta,
med neutral textknapp och fokus till vald navigationskontroll. Stegen
ligger före klasstabellen, inte under den. Ingen automatisk ändring,
lottning eller publicering. Ett återanvänt browserfall passerade 1/1
på 16,4 s vid 390/1280 px, inklusive alla sex val och noll skrivningar.
Komponenttest 2/2, webb-/E2E-lint/typecheck och build exit 0. Fysisk
mobil och fulla arbetsflöden är inte bevisade av navigeringen. Se
[TASK288](../TASK_288_ACTIONABLE_PREPARATION_STEPS.md).

## 2026-10-01: TASK287 speakerlänk med verklig detaljladdning

Ett befintligt browserfall passerade via riktig Next-HTTP och ny isolerad
PostgreSQL17.11/PostGIS3.6.4: Speaker öppnade exakt publik deltagare i popup,
20:00 sluttid och kontroll31/10:00; lokal sökterm kvarstod. Okänt publikt
ID gav 404, inte privat fallback. En browserkörning, 1/1 på12,3 s;
riktad E2E-lint/typecheck exit0. Ingen produktkod eller demo ändrades.
Syntetisk DB bevarades och egen PG stoppades. Återkallningsflöde och fysisk
mobil är inte verifierade. Se [TASK287](../TASK_287_SPEAKER_PUBLIC_DETAIL_DB_ACCEPTANCE.md).

## 2026-10-01: TASK286 publik deltagardetalj från speakerledare

Publika klassledarnamn länkar nu till exakt publicResultId i befintlig
deltagardetalj, på dator och mobil. Neutral understrykning, ny flik utan
förhämtning och 44 px mobiltryckyta; privat feed får inga gissade länkar.
Det enda befintliga speakerbrowserfallet passerade 1/1 på 6,2 s.
Webb-/E2E-lint/typecheck och build exit 0. Bilder granskades vid
390/1280 px. Verklig detaljladdning/DB och fysisk mobil återstår;
se [TASK286](../TASK_286_SPEAKER_LEADER_DETAIL_LINK.md).

## 2026-10-01: TASK285 lokal speakerhittare

Speakerns lästa namn/klasser kan filtreras med en kompakt lokal sökrad.
Privata senaste uppdateringar och publika ledare behåller skilda
träffantal, källor, ordning och varningar; ingen extra HTTP-trafik eller
implicit ledarhämtning. TASK284:s enda syntetiska browserfall utökades
och passerade 1/1 vid 390/1280 px, inklusive nollträff/rensning och
sessionsfel. Webb-/E2E-lint/typecheck och build exit 0. Se
[TASK285](../TASK_285_LOCAL_SPEAKER_SEARCH.md) för exakta kontroller och
kvarvarande fysisk-/pollingacceptans.

## 2026-10-01: TASK284 kompakt speaker med skilda källor

Under → Speaker visar publika klassledare och privata senaste
resultatuppdateringar sida vid sida på desktop, med egna lästider,
uppdateringar och källvarningar. Mobilens listor förtätades. MP/DSQ
är fortsatt röda, bevisad publik ledare grön och ”Inget aktivt resultat”
gult. Ingen ranking-, polling-, API- eller behörighetslogik ändrades.
Ett riktat syntetiskt browserfall passerade (1/1, 5,5 s), inklusive
separata 503-fel och rensning efter 403. Riktad ledarprojektion,
webb-/E2E-lint/typecheck och build exit 0. Se
[TASK284](../TASK_284_COMPACT_WORKSPACE_SPEAKER.md) för exakta körningar
och kvarstående fält-/storleksantaganden.

## 2026-10-01: TASK283 liten deltagarkontext vid detaljscroll

Vald deltagares namn och klass följer nu desktopens detaljscroll i en
panelintern neutral rad. På mobil följer samma rad dokumentflödet;
ingen större global toppyta tillkom. Den använder bara befintligt valt
underlag och försvinner vid tomt urval/direktanmälan. Ett återanvänt
syntetiskt browserfall passerade vid 390/1280 px, inklusive byte av
person, scroll och noll oavsiktliga skrivningar. Webblint, typkontroll,
riktad E2E-typkontroll/lint och build exit 0. Se
[TASK283](../TASK_283_SELECTED_PARTICIPANT_CONTEXT.md) för exakt
verifiering och kvarstående fokus-/fältantaganden.

## 2026-10-01: TASK282 deltagarläsläge och klassbyte mot isolerad PostgreSQL

Ett befintligt desktopfall passerade med riktig Next-HTTP och separat
migrerad PostgreSQL 17.11/PostGIS 3.6.4: deltagarval utan automatisk
klasseditor, explicit klassbyte, kapacitet, starttid, exakt retry och
bevarad rå-/resultathistorik. Äldre testnavigering och tvetydiga
selektorer rättades; produktkod ändrades inte. Slutresultat 1/1 på
49,8 s, riktad E2E-typkontroll/lint exit 0. Sex tidigare testkörningar
föll på de dokumenterade gamla UI-förväntningarna. Syntetisk testdatabas
bevarades och temporär PostgreSQL stoppades. Mobil/fältbruk är inte
verifierat. Se [TASK282](../TASK_282_PARTICIPANT_INFO_DB_ACCEPTANCE.md).

## 2026-09-29: TASK281 deltagarinformation före redigering

Vanligt val av deltagare på `/manage` öppnar nu ett läsläge: uppgifter,
gällande resultat och historiska kontroller visas före redigeringsverktyg.
Klassbyte och andra ändringar kräver fortsatt explicit val; direkta
kontextåtgärder och spärrade skrivförsök är oförändrade. Ett riktat
syntetiskt Chromiumfall passerade vid 390/1280 px med felstämpling,
saknad mellantid, explicit klassbytesval och noll oavsiktliga skrivningar.
Webblint, typkontroll, berörd E2E-typkontroll/lint och build passerade.
Se [TASK281](../TASK_281_PARTICIPANT_INFO_FIRST.md) för exakta resultat
och återstående isolerad DB-/fältacceptans.

## 2026-09-29: TASK280 lugnare administrativa ytor

`/organizer` och `/admin/[raceId]/manage` har nu en lättare text- och
knapphierarki på den redan neutrala grafitgrå grunden. Upprepade
loppknappar är ljusa och huvudsektioner platta på desktop. Statussignalernas
röd/gul/grön betydelser och 44 px tryckytor bevarades. Riktad webblint,
typkontroll, build och tre syntetiska browserfall passerade. Ett äldre
brett TASK167-fall stoppas av en sedan tidigare föråldrad förväntan på
mobilknappar; TASK234:s aktuella navigationsfall passerar. Se
[TASK280](../TASK_280_NEUTRAL_ADMIN_VISUAL_REFINEMENT.md) för exakta
resultat och kvarvarande fysisk läsbarhetsacceptans.

## 2026-09-29: TASK279 eventhittare efter ny session mot isolerad PostgreSQL

TASK278:s sökning verifierades genom riktig Next-HTTP och ny migrerad
PostgreSQL 17/PostGIS-databas. OWNER hittade ett senare skapat event via
loppnamn efter ny inloggning och öppnade exakt dess arbetsyta utan extra
API-anrop från filtret. Ett annat konto saknade eventet och nekades
race-enter. Ett enda riktat Chromiumfall passerade; körningsunik
måldatabas togs bort och den egna temporära DB-servern stoppades.
Se [TASK279](../TASK_279_ORGANIZER_FINDER_SESSION_ACCEPTANCE.md) för
exakta resultat och kvarvarande fysisk användaracceptans.

## 2026-09-29: TASK278 hitta tävling eller lopp i Mina tävlingar

Den inloggade arrangörens redan hämtade eventlista kan nu filtreras lokalt
på event- eller loppnamn utan ny API-yta eller rolländring. Ett matchande
event behåller samtliga lopp och ursprungliga åtgärder; rensning och
nollträff har egna läsbara kontroller. Ett riktat syntetiskt browserfall
passerade vid 320/390/1280 px efter bildgranskning och mobilförtätning.
Se [TASK278](../TASK_278_ORGANIZER_EVENT_FINDER.md) för exakt verifiering
och kvarstående verklig auth-/mobilacceptans.

## 2026-09-29: TASK277 verkligt isolerat prov av kontoinbjudan och eventåtkomst

Den sammanhängande OWNER→kontoinbjudan→kontoaktivering→separat ADMIN-grant-
vägen passerade ett enda riktat Chromiumprov mot ny, migrerad PostgreSQL
17.11/PostGIS 3.6.4 med syntetiska konton. En aktiverad mottagare nekades
race-enter före grant; ”Granska eventåtkomst” fyllde och fokuserade utan
POST; först ett separat ägarbeslut gav 201 och aktiv åtkomst. Den unika
underdatabasen togs bort och den tillfälliga databasservern stoppades.
Se [TASK277](../TASK_277_ISOLATED_OWNER_INVITATION_ACCEPTANCE.md) för exakt
testresultat, bevarad syntetisk tempkatalog och återstående fältantaganden.

## 2026-09-29: TASK276 aktiverad inbjudan till separat grantgranskning

En `REDEEMED` kontoinbjudan ger nu eventägaren en läsande väg till det
befintliga ADMIN-formuläret, förifyllt med exakt login och med fokus på
granskning. Klicket skickar ingen POST; en aktiv grant, icke inlöst kod,
behörighetsläsfel eller fryst grantförsök erbjuder inte en ny
tilldelningsväg. Ägaren måste kontrollera mottagaren och välja den
separata grantknappen. API/ADR/behörigheter ändrades inte. Se
[TASK276](../TASK_276_ACTIVATED_INVITATION_GRANT_REVIEW_UI.md) för riktad
verifiering och kvarstående verklig auth-/databas-/fältacceptans.

## 2026-09-29: TASK275 kompakt ägarstyrd kontoinbjudan

Kontoinbjudan på `/organizer` är nu en separat liten underpanel som hämtas
först vid öppning och bevarar kod/försök i sidminnet vid kollaps. Den
bekräftade koden hindrar nytt skapande tills ägaren uttryckligen rensar
den från sidan; texten förklarar att urklippet inte rensas. Okänt issue och
revoke visar fryst mål/request-id före samma-id-retry. Den stora grå
medadministratörsrutan ersattes med en tunn neutral avgränsning. Inga
API-, crypto- eller OWNER/ADMIN-regler ändrades. Se
[TASK275](../TASK_275_COMPACT_ACCOUNT_INVITATION_UI.md) för exakta
syntetiska prov, kvarstående databas-/fältgrindar och nästa lilla steg.

## 2026-09-29: TASK274 kompakt eventbunden medadministration

Ägarens `/organizer`-panel visar nu eventnamn/id, aktiva och återkallade
tilldelningar, inloggningsnamn och historiktider i en tät neutral vy.
Tilldelningens granskning skiljer eventåtkomst från kontoinbjudan, och ett
okänt svar visar fryst åtgärd/mål/request-id innan byteidentisk retry.
Efter första öppning bevarar kollapsat panelinnehåll sidminnets engångskod
utan Web Storage. API, OWNER/ADMIN-gräns och idempotens är oförändrade.
Se [TASK274](../TASK_274_COMPACT_COADMIN_UI.md) för exakta provresultat och
kvarvarande syntetiska begränsningar.

## 2026-09-29: TASK273 kompakt kontobundet tävlingsskapande

`/organizer` visar nu fullständigt fryst request-id/event/lopp/datum/tidszon
vid okänt skapandesvar och avmonterar det gamla formuläret. Bekräftelsen
visar event-/lopp-id, tid och befintlig race-enter-åtgärd; ytterligare
skapande kräver ett explicit val och ett blankt formulär. På mobil finns
en låg rubriklänk till skapandet även när eventlistan är lång. Kvittot
flyttas tillbaka i vyn efter listuppdatering. API, kontoauktorisering och
idempotens är oförändrade. Se [TASK273](../TASK_273_ACCOUNT_EVENT_CREATION_UI.md)
för exakta prov och kvarvarande syntetiska begränsningar.

## 2026-09-29: TASK272 tydlig inloggning och tomt arrangörskonto

`/organizer` visar nu status/fel nära inloggningsfältet och länkar till
befintlig kontoaktivering och återställning. Aktiveringshjälpen skiljer
engångskoden från faktisk eventåtkomst. Tom lista förklarar både nytt
skapande och att en eventägare kan ge medadministratörsåtkomst, med en
direkt länk till befintligt skapandeformulär. Ingen auth-/API-policy eller
skapandelogik ändrades. Se [TASK272](../TASK_272_ORGANIZER_ENTRY_STATES_UI.md)
för exakta prov och kvarvarande syntetiska begränsningar.

## 2026-09-29: TASK271 tät neutral arrangörsöversikt

`/organizer` ger nu listan med egna och delegerade event cirka 70 % av
datorbredden. Eventnamn, faktisk ägar-/medadministratörsroll, datum,
tidszon och antal redan hämtade lopp är samlade; varje lopp har en tät
namn-/datumrad och befintlig öppna-knapp. Mobilen behåller läsordning,
44 px-knappar och skaparformuläret efter listan. Behörighetsgränser och
skapandets idempotenta anrop är oförändrade. Se
[TASK271](../TASK_271_COMPACT_ORGANIZER_EVENTS_UI.md) för exakta kontroller
och antaganden. Browserunderlaget är helt syntetiskt.

## 2026-09-29: TASK270 kompakt neutralt tävlingsskapande

Den skyddade skapandesidan har täta fyra/två/ett-fältlayouter och låg
textstödd statusrad. Okänt commit visar fryst request-id och hela intentet,
inklusive tidszon, före same-id-retry. Lyckat kvitto får fokus; gamla
ifyllda formuläret tas bort så ytterligare tävling blir ett uttryckligt
val. Behörighets-/servergräns enligt ADR-0021 är oförändrad. Se
[TASK270](../TASK_270_COMPACT_EVENT_CREATION_UI.md) för exakta prov och
kvarstående syntetiska begränsningar.

## 2026-09-29: TASK269 kompakt neutral avläsningshistorik

Skyddad läsande historik har fem täta datorfält och en prioriterad mobilvy.
Första bedömning och bevarade revisioner skiljs åt; MP/okänd/saknad info
har tunna textstödda signaler. Vald detalj ger namn, bricka, stämplingar
och revisionskedja utan att historik-/behörighetspolicyn ändras. Se
[TASK269](../TASK_269_COMPACT_READOUT_HISTORY_UI.md) för exakt testutfall och
begränsningar. Browserprovet är syntetiskt; ingen verklig PostgreSQL- eller
fältacceptans har gjorts.

## 2026-09-29: TASK268 kompakt neutral separat startlistepublicering

Aktuell tävlingsversion, senaste publiceringsbeslut och handlingar ligger
nära varandra i en neutral arbetsyta. Den sök-/filterbara förhandslistan
är lokalt rullbar och alla deltagare behålls. Granskning visar fryst
action/revision och PUBLISH:s snapshot/hash; WITHDRAW binds inte till
dagens underlag. Osäkert svar visar samma request-id och explicit retry.
Auth, CSRF, serverfunktioner, XML och delat/publikt UI är oförändrade.
Se [TASK268](../TASK_268_COMPACT_START_LIST_PUBLICATION_UI.md).

Befintliga rutt-/tidsformatprov **4/4**, ett syntetiskt Chromiumprov
**1/1** med 60 deltagare vid 390/1366 px (3,5 s), web lint/typecheck/build
och riktad E2E-TypeScript/ESLint: **exit 0**. Första browserkörningen
gav exit 1 genom felaktig viewportordning i provet; listrutan navigeras
nu in innan lokal scroll och omkörningen passerade. Fyra bilder
granskades. PostgreSQL-beroende TASK006S/T kördes inte; ingen verklig
publicering, credential, fysisk mobil eller XML-/maxlastacceptans ingick.

## 2026-09-29: TASK267 kompakt neutral separat klasslottning

Klassval och tidsparametrar delar desktoprad; mobil behåller ordnad
läsning och 52 px handlingar. Förhandsgranskningen visar frysta parametrar,
versionsgrund och underlagshash, följt av alla deltagare i en tät lokalt
rullbar gamla/nya-tider-lista. Bekräftelse ligger före listan. Bara ett
osäkert skrivutfall får gul textstödd signal, med samma begäran-id och
explicit retry. Algoritm, API/CSRF, timeout och serverpolicy är oförändrade.
Se [TASK267](../TASK_267_COMPACT_CLASS_START_DRAW_UI.md).

Befintliga rutt-/tidsformatprov **5/5**, syntetiskt Chromiumprov **1/1**
med 60 deltagare vid 390/1366 px (7,3 s), web lint/typecheck/build och
riktad E2E-TypeScript/ESLint: **exit 0**. Fyra bilder granskades, och
desktopformen granskades igen efter att två verktygsrader slagits ihop.
Äldre PostgreSQL-beroende TASK006U-browserprov kördes inte. Ingen riktig
databas, credential, fysisk mobil eller maxlastacceptans ingick.

## 2026-09-29: TASK266 kompakt neutral återtagning av Utan tidtagning

Den separata `/admin/[raceId]/without-timing-withdrawals` visar åtta täta
desktopkolumner och ordnade mobilfält för deltagare, klass, versioner,
beslut och exakt OK/MP-restaureringskälla. Återtagen historik är läsbar
men inte valbar. MP markeras med liten röd ”Felstämplad”-text, medan
normalytor förblir neutrala. Fryst bekräftelse och explicit same-id-retry
visar hela underlaget. API, behörighet, CSRF, historik och serverpolicy
är oförändrade. Se
[TASK266](../TASK_266_COMPACT_WITHOUT_TIMING_WITHDRAWAL_UI.md).

UI-/klientprov **5/5**, ett syntetiskt Chromiumprov **1/1** vid 390/1366 px
(6,2 s), web lint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Fyra skärmbilder granskades. Äldre PostgreSQL-beroende
`task-001` kördes inte. Ingen riktig credential, tävlingsdata, fysisk
mobil eller hårdvara ingick; detta är inte server-/fältacceptans.

## 2026-09-29: TASK265 kompakt neutral Utan tidtagning-vy

Den separata `/admin/[raceId]/without-timing` visar enhetens nätläge,
verifierad/obekräftad session och antal beslutsbara kompakt. Sex
desktopkolumner och ordnade mobilfält visar person, klubb, klass,
deltagarversion, exakt OK-källa och svenska beslutsskäl. Blockerade
deltagare är läsbara men inte valbara. Fryst bekräftelse och explicit
same-id-retry visar samma person, klass, revision och tävlingsversion;
NT:s tidslösa, orankade konsekvens och exportspärr förklaras. Engelsk
transportfelstext ersattes med svensk text om obekräftat svar. Behörighet,
servermutation, revisionshistorik och offlineväg ändrades inte. Se
[TASK265](../TASK_265_COMPACT_WITHOUT_TIMING_UI.md).

Riktade UI-/klientprov **5/5**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Fyra skärmbilder granskades; browserprovet kontrollerar även
503-läsfel utan falskt verifierad session. Äldre PostgreSQL-beroende
`task-001` kördes inte. Ingen verklig credential, fysisk mobil eller
hårdvara ingick.

## 2026-09-29: TASK264 kompakt neutral återtagning av Utom tävlan

Den separata `/admin/[raceId]/out-of-competition-withdrawals` visar nät,
session och antal återtagbara beslut kompakt. Täta desktoprader och
ordnade mobilfält visar deltagare, klubb, klass, deltagarversion,
OOC-revision, absolut revisionshuvud, exakt OK/MP-källa och beslutsstatus.
Historiskt återtagna beslut är läsbara men inte valbara. Fryst bekräftelse
och okänd commit visar hela granskningsunderlaget; endast uttrycklig
byteidentisk same-id-retry får sända igen. Orsaker och nyckeltext är på
svenska. Behörighet, servermutation, revisionshistorik och offlineväg
ändrades inte. Se
[TASK264](../TASK_264_COMPACT_OUT_OF_COMPETITION_WITHDRAWAL_UI.md).

Riktade UI-/klientprov **5/5**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Desktop, mobil, bekräftelse och retry granskades som
skärmbilder. Det äldre PostgreSQL-beroende `task-001`-provet kördes inte.
Ingen verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK263 neutral grundstil och kompakt Utom tävlan-vy

Gemensamma sidhuvuden, standardåtgärder, paneler och tabellavgränsningar
har fått en lugn gråvit bas med måttlig textstorlek och mindre ytor.
Semantiska färger för avvikelser och speakerledare behålls tillsammans
med text, inte som enda signal. Den separata
`/admin/[raceId]/out-of-competition` visar nät, session och antal
beslutsbara, täta kandidatfält och svenska blockeringsskäl. Exakt teknisk
OK/MP-revision visas före fryst bekräftelse; okänt skrivutfall kräver
uttryckligt same-id-återförsök. Behörighet, serverbeslut, revisionshistorik
och offlineväg ändrades inte. Se
[TASK263](../TASK_263_COMPACT_OUT_OF_COMPETITION_UI.md).

Riktade UI-/klientprov **5/5**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Desktop, mobil, bekräftelse och retry granskades som
skärmbilder. Äldre PostgreSQL-beroende `task-001` kördes inte. Ingen
verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK262 kompakt neutral återtagning av Ej fullföljt

Den separata `/admin/[raceId]/did-not-finish-withdrawals` visar internet,
session och antal återtagbara beslut kompakt. Täta desktoprader och ordnade
mobilrader visar deltagare, klubb, klass, deltagarversion, DNF-revision,
senaste absoluta revision, exakt OK/MP-källa och beslutsstatus. Historiskt
återtagna beslut är läsbara men inte valbara. Fryst bekräftelse visar både
huvud, källa och tävlingsversion före POST; osäker commit får en separat
uttrycklig same-id-retry. Orsaker och behörighetskodstext visas på svenska.
Behörighet, servermutation, revisionshistorik och stationens offlineväg
ändrades inte. Se [TASK262](../TASK_262_COMPACT_DNF_WITHDRAWAL_UI.md).

Riktade UI-/klientprov **5/5**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normalvy, bekräftelse och retry granskades som skärmbilder.
Det äldre PostgreSQL-beroende `task-001`-provet kördes inte. Ingen verklig
credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK261 kompakt neutral Ej fullföljt-vy

Den separata `/admin/[raceId]/did-not-finish` har en låg statusrad för
internet, session och antal beslutsbara kandidater. Täta desktoprader och
ordnade mobilrader visar deltagare, klubb, klass, deltagarversion,
aktuell teknisk revision och begriplig beslutsstatus. Blockerade kandidater
syns med textskäl och disabled åtgärd. Vid val flyttas fokus till fryst
bekräftelse; vid okänt skrivutfall till en separat uttrycklig same-id-retry.
Nyckel- och resultatorsakstexter är på svenska. DNF-beslutets behörighet,
servermutation, revisionshistorik och stationens offlineväg ändrades inte.
Se [TASK261](../TASK_261_COMPACT_DID_NOT_FINISH_UI.md).

Riktade UI-/klientprov **5/5**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normalvy, bekräftelse och retry granskades som skärmbilder.
Första browserstarten fick `EPERM` på lokal port. Första tillåtna körningen
visade att mobilbekräftelsen låg utanför synfältet; detta rättades och
omkörningen passerade. Det äldre PostgreSQL-beroende `task-001`-provet
kördes inte. Ingen verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK260 kompakt neutral återtagning av resultatgodkännande

Den separata `/admin/[raceId]/approval-withdrawals` visar internet,
session och antal återtagbara beslut i en låg statusrad. Täta desktoprader
visar deltagare, klubb, klass, deltagarversion, godkännanderevision,
absolut revisionshuvud, exakt underliggande OK/MP-källa och beslutsstatus.
Mobilen behåller samma fakta utan sidspill. Redan återtagna beslut är läsbara
men inte valbara. Fryst bekräftelse visar källan och revisionshuvudet före
POST; okänd commit har synlig, uttrycklig same-id-retry. Inloggningstexten
använder »återtagningsnyckel«. Behörighet, servermutation, revisionshistorik
och stationens offlineväg ändrades inte. Se
[TASK260](../TASK_260_COMPACT_APPROVAL_WITHDRAWAL_UI.md).

Riktade UI-/klientprov **6/6**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normalvy, bekräftelse och retry granskades som skärmbilder.
Det äldre PostgreSQL-beroende `task-001`-provet kördes inte. Ingen
verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK259 kompakt neutral resultatgodkännandevy

Den separata `/admin/[raceId]/result-approvals` visar internet, session
och antal beslutsbara kandidater kompakt. Desktop visar deltagare, klubb,
klass, deltagarversion, beslutsskäl och exakt MP-källrevision i täta rader;
mobilen behåller samma fakta utan sidspill. Blockerade rader är läsbara men
inte valbara. Rubriken omfattar både valbara och blockerade resultat.
Permanent behörighet och konsekvens är neutral; gul signalfärg används för
fryst bekräftelse och osäkert skrivutfall. Inloggningen använder
»godkännandenyckel«. `APPROVE_RESULT`-behörighet, tvåstegsbeslut,
idempotent retry, resultatrevisioner och stationens offlineväg ändrades
inte. Se [TASK259](../TASK_259_COMPACT_RESULT_APPROVAL_UI.md).

Riktade UI-/klientprov **5/5**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normalvy, bekräftelse och retry granskades som skärmbilder.
Det äldre PostgreSQL-beroende `task-001`-provet kördes inte. Ingen
verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK258 kompakt neutral återtagning av diskvalifikation

Den separata `/admin/[raceId]/disqualification-withdrawals` har en låg
statusrad för internet, session och antal återtagbara beslut. Desktop
visar täta beslutsrader med deltagare, klubb, klass, deltagarversion,
DSQ-revision, absolut revisionshuvud, exakt OK/MP-restaureringskälla och
beslutsstatus. Mobilen visar samma fakta utan sidspill. Historiskt återtagna
beslut är läsbara men inte valbara. Bekräftelsen binder fortsatt fryst källa
och snapshot; okänd commit har en separat, textmärkt same-id-retry utan
automatisk omsändning. Inloggningstexten använder »återtagningsnyckel«.
Behörighet, servermutation, resultatrevisioner och stationens offlineväg
ändrades inte. Se [TASK258](../TASK_258_COMPACT_DISQUALIFICATION_WITHDRAWAL_UI.md).

Riktade UI-/klientprov **6/6**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normalvy, bekräftelse och retry granskades som skärmbilder.
Första browserstarten nekades lokal port av sandlådan (`EPERM`); isolerad
omkörning passerade. Det äldre PostgreSQL-beroende `task-001`-provet
kördes inte. Ingen verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK257 kompakt neutral diskvalifikationsvy

Den separata `/admin/[raceId]/disqualifications` visar nu internet,
session och antal beslutsbara kandidater i en låg statusrad. Kandidaterna
är täta rader på desktop och ordnade utan sidspill på mobil. Namn,
klubb, klass, deltagarversion, exakt OK/MP-källrevision och
blockeringsskäl är läsbara; otillåtna åtgärder är avaktiverade. Separat
fryst granskning krävs fortfarande före POST. Osäkert skrivutfall får
en textmärkt och synlig same-id-retry utan automatisk omsändning.
Inloggningstexten använder »diskvalifikationsnyckel« i stället för
intern credentialterminologi. Behörighet, servermutation,
revisionshistorik och offlinegräns ändrades inte. Se
[TASK257](../TASK_257_COMPACT_DISQUALIFICATION_UI.md).

Riktade UI-/klientprov **6/6**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normalvy, bekräftelse och retry granskades som skärmbilder.
Det äldre PostgreSQL-beroende `task-001`-browserprovet kördes inte.
Ingen verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK256 kompakt neutral återtagning av Ej start

Den separata `/admin/[raceId]/did-not-start-withdrawals` visar nu
internet, session och antal återtagbara beslut kompakt. Beslutens
historik är en tät desktoplista och en ordnad mobilvy. Redan återtagna
eller senare ersatta beslut syns med skäl men är inte valbara. Ett
återtagande kräver fortsatt separat granskning av deltagare, klass,
DNS-revision och snapshot innan POST; den viktiga konsekvensen att
aktuellt resultat saknas förklaras i text. Osäker commit får en tydligt
separerad same-id-retry. Behörighet, servermutation, revisionshistorik
och offlinegräns ändrades inte. Se [TASK256](../TASK_256_COMPACT_DNS_WITHDRAWAL_UI.md).

Riktade UI-/klientprov **7/7**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Skärmbilder av normal vy, bekräftelse och retry granskades;
efter visuell korrigering kräver provet att bekräftelseknappen syns
utan extra scroll. Ingen PostgreSQL, verklig credential, fysisk mobil
eller hårdvara ingick.

## 2026-09-27: TASK255 kompakt neutral Ej start-vy

Den separata `/admin/[raceId]/did-not-start` visar nu internet, session
och antal beslutsbara deltagare i en låg statusrad. Deltagarlistan är
tät på desktop och ordnad utan sidspill på mobil. Tidigare resultat
och blockerad åtgärd är tydliga i både text och disabled-knapp.
Permanenta knappar och behörighetstext är neutrala; gul accent används
för osäkert skrivutfall och röd för lokal avbrytning. Pågående skrivning
skiljs från okänd commit; efter okänt svar fokuseras explicit same-id-
retry. Behörighet, servermutation, revisionshistorik och offlinegräns
är oförändrade. Se [TASK255](../TASK_255_COMPACT_DNS_UI.md).

Riktade UI-/klientprov **6/6**, syntetiskt Chromiumprov **1/1** vid
390/1366 px, webblint/typecheck/build och riktad E2E-TypeScript/ESLint:
**exit 0**. Normal- och retrybilder granskades. Första browserstarten
nekades loopbackport av sandlådan (`EPERM`); isolerad lokal omkörning
passerade. Inget PostgreSQL-prov, riktig credential, fysisk mobil eller
hårdvara ingick.

## 2026-09-27: TASK254 kompakt neutral resultatomräkning

Den separata `/admin/[raceId]/recalculation` har nu neutral vit/grå
vardagskrom och täta deltagarrader på desktop. Internet, session och
antal redo syns kompakt. Namn, klubb, klass, deltagarversion, avläsning,
senaste revision och blockeringsorsak är kvar. Blockerade åtgärder är
synligt och semantiskt avaktiverade. Mobilen staplar informationen utan
sidspill och behåller 52 px tryckytor. Vid osäkert skrivsvar får den
gula, textmärkta same-id-retry-panelen fokus och blir synlig utan
automatisk omsändning. Ingen resultatutvärdering, servermutation eller
behörighet ändrades. Se [TASK254](../TASK_254_COMPACT_RECALCULATION_UI.md).

Riktat UI-prov **6/6**, syntetiskt Chromiumprov **1/1** vid 390/1366 px,
webblint/typecheck/build och riktad E2E-TypeScript/ESLint: **exit 0**.
Normal- och retrybilder granskades. Första browserkörningen hade en för
bred alert-selektor i testet; rättad omkörning passerade. Det äldre
PostgreSQL-beroende `task-001`-provet kördes inte utan isolerad databas.
Ingen verklig credential, fysisk mobil eller hårdvara ingick.

## 2026-09-27: TASK253 kompakt neutral resultatfinalisering

Den separata `/admin/[raceId]/finalization` visar nu internet, session och
loppsberedskap i en kompakt statusrad före klassunderlaget. Säkerhetsgränsen
är synlig men ingen stor varningsruta. Klasserna är täta rader på desktop;
blockerare, senaste beslut, klassåtgärd och ett tydligt separerat loppbeslut
behålls. På mobil staplas innehållet med 52 px tryckytor. Primärtexten
använder »finaliseringsnyckel« i stället för intern capabilitykod. Röd/gul
signalfärg används bara med text vid blockerare respektive osäkert retry.
Ingen finaliseringsmutation, behörighet eller export ändrades. Se
[TASK253](../TASK_253_COMPACT_FINALIZATION_UI.md).

Riktat UI-prov **5/5**, syntetiskt Chromiumprov **2/2** vid 390/1366 px,
webblint/typecheck/build och riktad E2E-TypeScript/ESLint: **exit 0**.
Bilder med åtta klasser och blockerad klass/lopp granskades; inget sidspill.
Första browserstarten gav `EPERM` i sandlådan, därefter passerade
loopbackkörningen. Det äldre PostgreSQL-beroende `task-001`-provet kunde
inte köras utan isolerad testdatabas; dess rena lint/list-försök stoppades
av saknad TypeScript-projekttillhörighet respektive DB-grind. Ingen verklig
credential, fysisk touch eller servermutation ingick.

## 2026-09-27: TASK252 tävlingszon för verifierade startluckor

Den separata direktanmälan visar nu verifierade lottade tider och fryst
granskning i loppets validerade tidszon med numerisk offset. Båda privata
registreringsläsningarna bär zonen; separat och gemensam adminvy avvisar
slotunderlag med fel zon/scope. Försenat slotunderlag efter klassbyte visas
inte. Skrivbegäran, slotbevis, journal och samma-id-retry behåller UTC.
Formulärets checkbox är neutral grafitgrå; textmärkt gul varning används
bara när slotunderlag inte kan verifieras. Se
[ADR-0165](adr/ADR-0165-registration-start-slot-display-zone.md) och
[TASK252](../TASK_252_REGISTRATION_SLOT_RACE_ZONE.md).

Riktade kontraktsprov: **4/4**, exit 0. Contracts lint/typecheck/build,
application lint/typecheck/build, web lint/typecheck/build och E2E-TypeScript/
ESLint: **exit 0**. Syntetiskt Chromiumprov: **3/3**, exit 0 vid 390/1366
px och felzon/sent svar, med granskade bilder. En första browserstart gav
`EPERM` på loopback i sandlådan; ett nytt regressionsfall fick timeout på
grund av en felaktigt auktoriserad syntetisk klasslista. Testfixturen
rättades och omkörningen passerade. Ingen isolerad `TEST_DATABASE_URL`,
så inget PostgreSQL-prov kördes. Verklig credential, samtidiga anmälningar,
fysisk touch och hårdvara är inte verifierade i detta snitt.

## 2026-09-27: TASK251 lugnare tävlingsarbetsyta

`/admin/[raceId]/manage` har nu neutral vit/grå granskning i stället för
automatisk gul varningsruta och tunna, textmärkta underflikar på desktop.
Vald flik förblir tydlig även under pekarhover. Gult för saknad/osäker
information, rött för fel/kritiska resultat och speakerns diskreta gröna
klassledaraccent finns kvar med text som bärare av betydelsen. Mobilens
tryckytor, publikvyer och stationsflöde ändrades inte. Se
[TASK251](../TASK_251_QUIET_ADMIN_HIERARCHY.md).

Webblint/typecheck/build samt E2E-TypeScript/ESLint gav **exit 0**.
Syntetiskt Chromiumprov **1/1** passerade vid 390/1280 px och bilderna
granskades. Den första starten nekades av sandlådans loopbackport; två
efterföljande körningar fångade vald fliks hoverfärg innan korrigerad omkörning
passerade. Ingen PostgreSQL, riktig credential eller fysisk enhet prövades.

## 2026-09-27: TASK250 neutral separat direktanmälan

`/admin/[raceId]/registration` har nu samma nedtonade, täta språk som
övriga nåbara administrationsvyer. Klassens fri/fasta start förklaras
vid valet; namn, klubb och bricka är kompakta på desktop och tydligt
ordnade på mobil. Granskningen visar fryst namn, klass, klubb, bricka
och eventuell starttid utan underliggande formulärscroll. Osäker retry
är textmärkt gul, faktiska fel textmärkt röda. Registrerings-, auth-,
kapacitets- och slotregler är oförändrade. Se
[TASK250](../TASK_250_NEUTRAL_REGISTRATION_ADMIN.md).

Webblint/typecheck/build och E2E-TypeScript/ESLint gav **exit 0**.
Syntetiskt Chromiumprov **2/2** passerade vid 390/1366 px med
granskade bilder och exakt same-id-retry. Första 0/2 var ett testfel:
slotkontraktet normaliserade `+02:00` till UTC och testet sökte den
ursprungliga strängen. Ingen PostgreSQL, riktig credential eller
fysisk enhet prövades. Lottade tider visas i läsbart UTC-format;
loppets lokala tidszon finns inte i det separata slotkontraktet.

## 2026-09-27: TASK249 neutral separat namn-/klubbrättning

`/admin/[raceId]/entry-identity` följer nu samma nedtonade, täta
administrativa uttryck som brick- och starttidsvyerna. Sökning och
deltagarval delar desktoprad, de tre textfälten och privat historik
är lätta att jämföra och mobilen behåller 52 px kontroller. Osäkert
svar visas en gång i textmärkt gul granskning; verkliga fel och
ofullständig historik får röd textmärkt signal. Befintlig auth,
CAS, journal, retry och publiceringsgräns är oförändrade. Se
[TASK249](../TASK_249_NEUTRAL_ENTRY_IDENTITY.md).

Webblint/typecheck/build och E2E-TypeScript/ESLint gav **exit 0**.
Syntetiskt Chromiumprov **2/2** passerade vid 390/1366 px; normal-
och retrybilder granskades. Första 0/2 berodde på en orealistiskt
fjärran sessionstid i test-fixturen, rättad före omkörningen.
Ingen PostgreSQL, verklig credential eller fysisk enhet prövades.

## 2026-09-27: TASK248 neutral separat brickhantering

`/admin/[raceId]/cards` har nu samma lugna, täta uttryck som övriga
administrativa vyer. Sökning och deltagarval delar desktoprad, liksom
nytt bricknummer och granskning. Mobilen behåller minst 52 px fält och
knappar. Osäker retry och verkliga fel/flera aktiva brickor skiljs med
textstödda gul/röd signaler; permanent regeltext är neutral. Inga
kort-, behörighets- eller resultatregler ändrades. Se
[TASK248](../TASK_248_NEUTRAL_CARD_ADMIN.md).

Webblint/typecheck/build och E2E-TypeScript/ESLint gav **exit 0**.
Syntetiskt Chromiumprov **2/2** passerade vid 390/1366 px, med
granskade skärmbilder. Ingen PostgreSQL, verklig credential eller
fysisk enhet prövades.

## 2026-09-27: TASK247 neutral separat starttidsvy

`/admin/[raceId]/start-times` använder nu samma lugna, täta
administrativa språk som tävlingsarbetsytan. Sökning och deltagarval
står i en rad på desktop; mobilens 44 px-fält och enkolumnsordning
behålls. Granskning/retry, behörighet och tidszonstolkning är
oförändrade. Osäkert svar och faktiskt fel har skilda textstödda
gul/röd signaler; neutral vardagskrom och ljusa sekundärknappar
dominerar normalt. Se [TASK247](../TASK_247_NEUTRAL_START_TIME_ADMIN.md).

Riktad webblint/typecheck/build och E2E-TypeScript/ESLint gav
**exit 0**. Syntetiskt Next-/Chromium-prov **2/2** passerade vid
390/1366 px efter slutlig knappkorrigering. Ingen databas,
verklig credential eller fysisk enhet prövades.

## 2026-09-27: TASK246 neutral import och verifierad Eventorprofil

`/admin/[raceId]/imports` följer nu samma neutrala, täta administrativa
språk som `/manage`: två importkolumner på bred skärm, en kolumn och
minst 44 px tryckmål på mobil. Riktig källa märks först efter en
giltig förhandsvisning med den lagrade `testeventor-se`- eller
`production-se`-profilen. Den privata preview-responsen är v2;
request/commit och behörigheten är oförändrade. Se
[TASK246](../TASK_246_NEUTRAL_IMPORT_PROFILE.md) och ADR-0116.

Kontraktstest **3/3**, webbtest **7/7**, syntetiskt browserprov **2/2**;
berörd lint/typecheck samt kontrakts- och Next-build **exit 0**.
390/1280 px-bilder granskades. Första browserstarten nekades av
sandlådans loopbackport (`EPERM`); tillåten omkörning passerade.
Ingen riktig Eventorläsning, credential, databas eller fysisk enhet
ingick.

## 2026-09-27: TASK245 importingång i tävlingsupplägget

`/manage` → Före tävlingen → Upplägg visar nu en kompakt väg till
befintlig IOF-/Eventorimport för exakt lopp. Raden förklarar separat
`IMPORT_IOF`-behörighet, Eventors importbidrag och manuell
klasskoppling. En låst arbetsyta ger ingen aktiv utgång; inga
behörigheter eller importer ändrades. Se
[TASK245](../TASK_245_PREPARATION_IMPORT_ENTRY.md).

Berörd lint/typecheck, E2E-ESLint/TypeScript och Next-build gav
**exit 0**. UI-prov **2/2**, syntetiskt Next-/Chromium-flöde **1/1**
med klick till importsidan och skärmbilder vid 390/1280 px passerade.
Första UI-provets 0/2 var en saknad React-import i testmiljön, rättad
före den gröna omkörningen. Riktig import/credential/produktionsprofil
prövades inte i TASK245; den då missvisande Testeventor-rubriken
är rättad i TASK246.

## 2026-09-27: TASK244 privat förhandsgranskning av kartkandidat

En tävlingsadministratör kan nu uttryckligen öppna en lagrad PNG/JPEG-
kandidat i den kompakta kartarbetsytan utan att publicera den. Privat
GET är race- och `MANAGE_RACE`-skyddad, läser exakt immutable
objektversion och återkontrollerar åtkomst efter läsningen. Valbyte
rensar bild och publiceringsbekräftelse; bildfel visas med textmärkt
röd signal. Ingen migration eller ny ADR behövdes. Se
[TASK244](../TASK_244_PRIVATE_MAP_CANDIDATE_PREVIEW.md).

Berörd web/application lint och typecheck, E2E-ESLint/TypeScript samt
checkin-/Next-build gav **exit 0**. Riktade Vitest **6/6**, syntetiska
Next-/Chromium-prov **4/4** och TASK244-omkörning **1/1** passerade.
Skärmbilder vid 390/1280 px granskades. DB-integrationen kördes inte
utan isolerad `TEST_DATABASE_URL`; riktig MinIO, tävlingssession och
kartläsbarhet från en verklig karta återstår.

## 2026-09-27: TASK243 neutral separat klassadministration

`/admin/[raceId]/classes` använder nu samma ljusa grafitgrå
normalpalett som huvudytan. Permanent behörighetsinformation är en
kompakt rad; deltagarna visas i täta dividerade rader i stället för
stora kort. Mobilens klassval och åtgärd delar rad med minst 44 px
manöverdon. Osäker commit/retry är fortsatt textmärkt gul; inga
klassbytes-, behörighets- eller resultatregler ändrades. Se
[TASK243](../TASK_243_NEUTRAL_CLASS_ADMIN.md).

Webblint/typecheck, E2E-TypeScript/ESLint och Next-build gav **exit 0**.
Klassadmin-UI-proven passerade **6/6**, syntetiskt Next-/Chromium-prov
**1/1** vid 320/390/1280 px och skärmbilder granskades. En första
browserkörning föll endast på en tvetydig testselektor för `role=alert`;
efter precisering passerade den. Databasbunden klassbytes-E2E kördes
inte utan isolerad PostgreSQL; verklig credential och fysisk touch
återstår.

## 2026-09-27: TASK242 neutral och tät privat kartadministration

`/admin/[raceId]/map` har nu nedtonad sidkrom, kompakt publiceringsläge,
tvåkolumnigt uppladdning/lager på dator och synliga ingångar till
kalibrering och kontrollpositioner. De två avancerade formulären och
historiken öppnas separat i native `details` så kartsläpp inte kräver
scroll förbi tolv kalibreringsfält. Bekräftelser för publicering och
återtagande är oförändrat explicita. Misslyckad läsning utger sig inte
för ett säkert tomläge. Se [TASK242](../TASK_242_COMPACT_PRIVATE_MAP_ADMIN.md).

Webblint/typecheck, riktad E2E-TypeScript/ESLint, checkin-förberedelse
och Next-build gav **exit 0**. Komponentprov **4/4** och tre riktiga
Next-/Chromium-fall med syntetiska svar **3/3** passerade. 390/1280 px
och publicerat mobilläge granskades visuellt. Databasbundna
TASK106/TASK114 kördes inte utan uttryckligen isolerad PostgreSQL;
MinIO, fysisk touch och fältanvändning är inte bevisade av snittet.

## 2026-09-27: TASK241 neutral och zoomningsbar publik tävlingskarta

Den fristående publika kartan har samma lugna täta språk som övriga
resultatsidor: tävlingskontext, karttitel och textmärkta kontroller.
Kartbilden behåller proportioner och kan zoomas 1×–4× i en rullbar yta
med piltangentpanorering, reset, laddnings-/felbesked och print som visar
helkartan. Ingen kartpublicering, lagring eller privatgräns ändrades.
Se [TASK241](../TASK_241_NEUTRAL_PUBLIC_MAP_VIEW.md).

Webblint/typecheck, E2E-TypeScript/ESLint, checkin-förberedelse och
Next-build gav **exit 0**. Komponentprov **3/3**, syntetiskt monterat
browserprov **3/3** och hela publika visuella sviten **12/12** passerade;
320/1280-skärmbilder granskades. Det befintliga databasbundna
TASK106-provet uppdaterades men kördes inte utan isolerad PostgreSQL.
Ingen fysisk touch eller verklig kartprecision verifierades.

## 2026-09-27: TASK240 neutral och zoomningsbar publik ruttjämförelse

Den publika jämförelsen av två eller tre redan släppta rutter har samma
neutrala täta språk som resultat- och deltagarruttvyerna. Stor grön
sidkrom och faktakort ersätts av tunna avdelare; Röd/Blå/Grön förblir
textbundna rutt- och markörsignaler. Hela kart-SVG:n kan zoomas 1×–4×
och panoreras, även med piltangenter; print passar helkartan.
Två-ruttstabellen är läsbar i en lokalt sidledsrullbar yta vid 320 px
med synlig hänvisning. Se [TASK240](../TASK_240_PUBLIC_ROUTE_COMPARISON_VIEW.md).

Riktad webblint/typecheck, browserhärvans TypeScript/ESLint,
checkin-förberedelse och Next-build gav **exit 0**. Relevanta enhetstester
**6/6**, tre monterade syntetiska browserfall **3/3** och hela lilla
visuella sviten **9/9** passerade vid 320/390/1280 px. Ingen riktig
databas, release-/samtyckesgrind, fysisk touch eller kartprecision
verifierades i detta snitt.

## 2026-09-27: TASK239 zoom i publicerad deltagarrutt

Den neutrala publika ruttvyn har nu kompakt textmärkt zoom 1×–4×,
fokuserbar kartvy med native panorering och piltangenter, synlig procent,
återställning och utskriftsanpassning. Befintlig karta, rutt,
kontrollgeometri och GPX-uppspelningsmarkör förblir i samma SVG. Varken
publiceringsgrind, API, domän eller lagring ändrades. Se
[TASK239](../TASK_239_PUBLIC_ROUTE_MAP_ZOOM.md).

Webblint/typecheck, browserhärvans TypeScript/ESLint,
checkin-förberedelse och Next-build gav **exit 0**; komponentprov **2/2**.
Ett syntetiskt browserprov av den faktiskt monterade ruttkomponenten
passerade **3/3** vid 320/390/1280 px, och hela lilla visuella sviten
**6/6**. Inga verkliga tävlingsdata, databasfrågor eller fysisk mobil
provades; native touch och faktisk kartprecision återstår.

## 2026-09-27: TASK238 neutral publik ruttvy

Den publicerade deltagarruttens sida följer nu resultatlistans och
deltagardetaljens lugna normalpalett. Fyra metadatakort och inramad
GPX-uppspelning är täta avdelade fält; varningen att rutten inte är
GPS-verifierad är fortsatt text med smal ambermarkering. Befintliga
dela-/uppspelningskontroller, röd ruttlinje och kontrollgeometri är kvar.
Sidlokala mobilregler gör kontrollkoderna läsbarare när SVG:n skalas ned.
Se [TASK238](../TASK_238_NEUTRAL_PUBLIC_ROUTE_VIEW.md).

Webblint/typecheck, browserprovets TypeScript/ESLint,
checkin-förberedelse och Next-build gav **exit 0**. Kontextkomponentprov
**2/2** och tre syntetiska CSS-browserfall **3/3** passerade vid
320/390/1280 px. Ingen riktig databas, karta, publiceringsgrind eller
fysisk mobil provades; zoom för detaljer på en liten karta tillkom i TASK239.

## 2026-09-27: TASK237 neutral publik deltagardetalj

Resultatlistans neutrala och täta uttryck fortsätter nu in på den enskilda
deltagarens publika resultatsida. Fyra inramade faktakort är en delad
faktaruta/grid, och den villkorliga ruttsammanfattningen är nedtonad utan
att ruttlänk eller delning tas bort. Status, orsak, saknade/extra
kontroller, sträcktider, 5-sekunders uppdatering och SSE är oförändrade.
Utskrift behåller nu även deltagarnamn som tidigare doldes av en för bred
header-selektor. Se [TASK237](../TASK_237_NEUTRAL_PUBLIC_PARTICIPANT_DETAIL.md).

Webblint/typecheck, browserprovets TypeScript/ESLint,
checkin-förberedelse och Next-build gav **exit 0**. Komponentprov
**12/12** och två syntetiska CSS-browserfall **2/2** passerade vid
320/390/1280 px inklusive print. Ingen riktig databas, tävling eller
fysisk mobil testades; browserproven är inte ett hydratiserat Next-flöde.

## 2026-09-27: TASK236 tät och neutral publik resultatlista

Den publika resultatlistan använder nu en sidlokal ljus/grå grund och en
kompaktare text- och avdelarrytm. Desktop-tabellen prioriterar deltagare,
status och tider; på mobil är varje deltagare en avdelad rad i stället för
ett stort kort. Favorit, ruttjämförelse, detaljlänk och sträcktider finns
kvar med minst 44 px interaktiva mobilmål. Faktiska MP/DSQ och OK har
fortsatt text och signalfärg; fokus, ruttdistinktion och print bevaras.
Se [TASK236](../TASK_236_DENSE_NEUTRAL_PUBLIC_RESULTS.md).

Riktad webblint/typecheck, browserprovets TypeScript/ESLint,
checkin-förberedelse och Next-build gav **exit 0**. Komponentprov
**11/11** och syntetiskt CSS-browserprov **1/1** passerade vid
320/390/1280 px inklusive print. Ingen riktig PostgreSQL, tävling eller
fysisk mobil provades. Browserprovet är en CSS-fixture, inte hydratiserad
Next-E2E; se uppgiftens utfall för begränsningen.

## 2026-09-27: TASK234–235 lugnare och lägre operativ UI

Mobilens `/manage` har nu två märkta, kompakta valfält för läge och
underavsnitt i stället för två höga knappgaller. Alla val, sex statusmått,
underlagsversion och tid är kvar; stor skärm behåller flikknapparna.
Banor-innehållet börjar minst 70 px högre vid 390 px. Den äldre privata
översikten och startlistan har en sidlokal grå normalpalett utan ändring av
avvikelse- eller speakerledarsignaler. Se [TASK234](../TASK_234_COMPACT_MOBILE_ADMIN_NAVIGATION.md)
och [TASK235](../TASK_235_NEUTRAL_LEGACY_OPERATIONAL_SURFACES.md).

Riktad webblint/typecheck, E2E-TypeScript/ESLint, checkin-förberedelse och
web-build gav **exit 0**. Syntetisk Playwright: mobiladmin **1/1**, äldre
översikt **2/2**, publik startlista **1/1** och privat startlista med
print-media **2/2**, alla **exit 0**. Skärmbilder vid
390/1366 px granskades. Inga riktiga tävlingsdata, databasskrivningar eller
fysiska enheter användes. Ett första översiktsprov visade en föråldrad
29-länkarsförväntan mot 31 befintliga länkar; testet rättades med explicita
kontroller av de två senare tillagda vägarna och passerar.

### Omprövat UI-beslut

TASK218:s dokumenterade två-radskarta för sju förberedelsevägar står i
konflikt med TASK234:s planerade kompakta mobilväljare. Detta är ett medvetet
nyare UI-beslut, inte en ändring av arkitektur eller domän: enligt
[TASK234](../TASK_234_COMPACT_MOBILE_ADMIN_NAVIGATION.md) prioriteras nu mer
plats för aktivt arbete under 721 px, med alla val, aktuellt läge och tydlig
etikett kvar. Desktop behåller knappnavigeringen. Beslutet dokumenterades
före fortsatt implementation och provades i 320/390 px.

## 2026-09-27: TASK233 lokal ban-/klassökning

`Före tävlingen` → `Banor` filtrerar nu den redan lästa banlistan på
bannamn eller tilldelad klass, utan att gömma den globala varningen om
saknade banversioner. Sökfältet tar plats först vid åtta banor eller
aktiv sökning och visar träffantal/nollträff. Se
[TASK233](../TASK_233_COURSE_FINDER_AT_SCALE.md).

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Riktat syntetiskt Playwright passerade **1/1, exit 0**
vid 390/1280 px; bilder granskades utan sidspill. Ingen verklig
tävling, databasskrivning eller fältacceptans ingick. Race-ID-byte är
kodmässigt hanterat men inte separat browserprovat.

## 2026-09-27: TASK232 kontext och återgång från banvarning

När en funktionär öppnar en klass från banvarningen anger klassvyn nu
varför raden öppnades, som en tidsbunden uppgift om **det då lästa**
banunderlaget. En liten återlänk går till Banor och fokuserar fliken;
nytt deltagarunderlag rensar sammanhanget. Ingen automatisk banändring
görs. Se [TASK232](../TASK_232_COURSE_WARNING_CONTEXT_IN_CLASS.md).

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Ett återanvänt syntetiskt Playwright-fall passerade
**1/1, exit 0** vid 390/1280 px; bilder granskades. Testet såg inga
skrivbegäranden, råa UUID:n eller sidspill. Ingen verklig tävling,
fysisk mobil eller funktionärsacceptans ingick.

## 2026-09-27: TASK231 exakt klass från banvarning

Banvarningens berörda rader kan nu öppna exakt klasspost i `Före` →
`Klasser` med internt ID i klienten. Dubbelnamn skiljs med synligt
klassradsnummer och vald rad markeras/fokuseras på målsidan utan att
starta ändring. Varningen antyder fortfarande inte att banan måste
kopplas om. Se [TASK231](../TASK_231_EXACT_CLASS_FROM_COURSE_WARNING.md).

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Riktat syntetiskt Playwright passerade **1/1, exit 0**
vid 390/1280 px; bilder granskades utan sidspill. Ett första
buildkommando med fel binärsökväg gav **exit 127**; korrekt kommando
passerade. Ingen verklig tävling, databas eller funktionärsacceptans.

## 2026-09-27: TASK230 berörda klasser i banvarningen

Varningen i `Före tävlingen` → `Banor` anger nu vilka klassrader och
tilldelade banversioner som saknas i det **lästa banunderlaget**. En
till tre visas direkt; fler visas som antal med en kompakt expanderbar
lista. Likalydande klassnamn räknas som separata rader, men interna
UUID:n visas inte. Formuleringen påstår inte att banan är raderad eller
att tävlingen är redo. Se
[TASK230](../TASK_230_NAMED_MISSING_COURSE_VERSIONS.md).

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Riktat syntetiskt Playwright passerade **1/1, exit 0**
med en/fyra berörda klasser, komplett matchning och läsfel vid 390/1280
px. Bilderna granskades; inget sidspill. Ingen verklig tävling,
databasskrivning, credential eller fysisk mobil ingick. Dubbla
visningsnamn är ännu inte entydigt åtgärdbara från varningen ensam.

## 2026-09-27: TASK229 kompakt banöversikt med kontroller på begäran

`Före tävlingen` → `Banor` visar nu varje bana som en tunn expanderbar
rad. Namn, banversion, kopplade klasser och kontrollantal syns direkt;
full kontrollföljd visas när en bana öppnas. Saknad tilldelad
banversion varnar före listan med text och smal signalfärg. Tolv banor
med 18 kontroller vardera går nu att skanna utan 216 öppna kontrollrutor.
Se [TASK229](../TASK_229_COMPACT_COURSE_OVERVIEW.md). Endast UI-presentation
ändrades.

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Två riktade syntetiska Playwright-fall passerade
**1/1 vardera, exit 0**: 12 banor/60 klasser/500 deltagare vid 390/1280
px samt befintligt arbetsflöde. Bilder i kompakt och öppet läge
granskades; ingen sidscroll i sidled. Ett första noll-kontroll-fixture
avvisades av kontraktet före testinsamling (**exit 1**); kontraktet
ändrades inte. Ingen verklig tävling, databas, fysisk enhet eller
funktionärsacceptans ingick.

## 2026-09-27: TASK228 åtgärdsstyrd klassbild på förstasidan

Första tävlingsöversiktens klasslista prioriterar nu klasser med saknade
fasta starttider, flest först, med en kort förklaring och kompakt sökning
på klass eller bana. Vid 60 klasser ligger den enda klassen med åtta
saknade tider direkt överst i stället för dold i en intern scroll.
Tävlingens globala nyckeltal och de befintliga klass-/deltagarlänkarna
är oförändrade. Detta är en ren UI-ändring; se
[TASK228](../TASK_228_OVERVIEW_CLASS_ATTENTION.md).

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Ett återanvänt syntetiskt browserfall passerade **1/1,
exit 0** vid 390/1280 px med 60 klasser, 500 deltagare, fungerande
klass-/banfilter, åtgärdslänk, 44 px mobilmål och inget sidspill.
Bilderna granskades. Ingen verklig tävling, credential, databasskrivning,
fysisk mobil eller funktionärsacceptans ingick.

## 2026-09-27: TASK227 klassökning vid stor tävling

`Före tävlingen` → `Klasser` har nu en diskret lokal sökning på klass-
eller banamn, synligt träffantal och 0-träffsläge. Vid 60 klasser och
500 deltagare går det att hitta en klass utan att bläddra i hela tabellen.
Tävlingens sammanfattning förblir global och åtgärden för saknad fast
starttid går fortfarande till rätt deltagarurval. Endast UI-presentation
ändrades; se [TASK227](../TASK_227_CLASS_FINDER_AT_SCALE.md).

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Riktat syntetiskt Playwright passerade **1/1, exit 0**
vid 390/1280 px utan sidspill; bilderna granskades. En första körning
klickade före klientinitiering och tidsbegränsades (**exit 1**), varefter
testet rättades. Ett första buildkommando hade fel binärsökväg (**exit
127**), varefter korrekt kommando passerade. Ingen verklig tävling,
databas, credential, fysisk enhet eller användaracceptans ingick.

## 2026-09-27: TASK226 kompakt omberäkning före fastställande

`Efter tävlingen` följer nu den synliga ordningen omberäkning vid behov
→ fastställande → separat export. Den tidigare stora tomma
omberäkningspanelen längst ned är en tunn expanderbar rad före
fastställandet. Dess klassurval, manifest, granskning, osäkra retry och
autoöppning vid pågående försök är kvar. Datorns granskningsruta för
fastställande fyller inte längre hela bredden. Se
[TASK226](../TASK_226_COMPACT_RECALCULATION_STEP.md). Ingen API-,
domän-, behörighets- eller lagringsändring gjordes.

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-förberedelse
gav **exit 0**. Riktat syntetiskt Playwright passerade **1/1, exit 0**
vid 390/1280 px utan sidspill. En första felaktig grep-selektor gav
`No tests found`, exit 1; efter rättning passerade sista körningen.
Inga verkliga tävlingsdata, omberäkningar eller officiella resultat
ändrades. Fysisk enhet och funktionärsacceptans återstår.

## 2026-09-27: TASK225 fastställande synligt före export

`Efter tävlingen` visar nu `Fastställ resultat` direkt, med befintlig
kandidat, blockerare, granskning och osäkert återförsök. Nedladdning av
Snapshot och historisk Complete ligger separat under `Resultatexport ·
IOF 3.0`. Endast UI-ordning, svensk förklaring och tunn scoped layout
ändrades; API, behörighet, resultatregel och lagring är oförändrade.
Se [TASK225](../TASK_225_AFTER_RESULT_ACTIONS.md).

Webblint/typecheck/build gav **exit 0**, liksom E2E-TypeScript/ESLint.
Ett syntetiskt browserprov passerade **1/1, exit 0** vid 390/1280 px
med synlig primär åtgärd, stängd export, ingen sidscroll och identisk
idempotent begäran vid osäkert återförsök. Ett första direktbuild utan
projektets build-markör gav **exit 1** vid sidinsamling; omkörning med
den befintliga markören gav **exit 0** utan databasanslutning. Ingen
verklig tävling, credential, officiell resultatfil eller fysisk enhet
ingick. Användaracceptans återstår.

## 2026-09-27: TASK224 laddad writerprofil, endast syntetisk preflight

En andra läsande förkontroll jämför nu TASK213:s exakta filprofil med
systemds laddade inventering och valda effektiva egenskaper. Extra
`otid-*`-enheter, alias, drop-ins, transient källa, väntande reload,
felaktig identitet, start, markör eller credentialkälla ger avslag.
Anropen är bara `systemctl show/list-*` via fast minimal miljö; ingen
systemd-mutation eller hemlighetsläsning ingår. Även lyckad kontroll
returnerar `NOT_ACCEPTED`. Se
[TASK224](../TASK_224_LOADED_WRITER_PROFILE_PREFLIGHT.md).

Riktade syntetiska Node-prov för TASK213+224 passerade **10/10, exit 0**.
Riktad ESLint och tre `node --check` gav **exit 0**. Ingen Mac-körning
mot verklig systemd finns; parserns versionskompatibilitet och TASK180:s
Linuxprocess-/credentialgräns, dränering och tekniska skrivstopp förblir
öppna. Ingen databas, objektlagring, tävling eller verklig credential
användes. Detta snitt har ingen separat typecheck eller build.

## 2026-09-27: TASK223 neutral arrangörsstart

`/organizer` använder nu samma avskalade ljus/grå färgskala som
`/manage`: lägre visuell vikt i huvud, typografi, paneler, knappar och
tävlingsrader. Gult osäkert svar, smal grön verklig bekräftelse och
blå fokusmarkering är fortsatt textstödda signaler. Ändringen är
begränsad till arrangörssidans CSS; globala publik-/stationsstilar,
API, tävlingslogik och behörigheter är oförändrade. Se
[TASK223](../TASK_223_NEUTRAL_ORGANIZER_ENTRY.md).

Webblint, typecheck och build gav **exit 0**. E2E-TypeScript/ESLint
gav **exit 0**. Ett databasfritt browserprov med syntetiskt avlyssnade
API-svar passerade **2/2, exit 0** vid 390/1280 px. Inloggad lista,
långt namn, staplad/tvåkolumnslayout, minst 44 px knappar, 48 px
fält, 0 px sidspill, gul osäker 503-begäran och grön bekräftad retry
med samma idempotensnyckel granskades även i bilder. Ingen verklig
credential, databas, servermutation eller fältacceptans ingick.

## 2026-09-27: TASK222 deltagarbyte inom aktuellt urval

Personens arbetsvy har nu en kompakt Föregående/Nästa-rad med position
i aktuellt filtrerat urval. Den behåller sök-/klass-/resultatfilter,
sortering och mobilens arbetsvy, även över tabellens sidgräns. Första/
sista deltagare och vald person utanför filtret kan inte ge ett felaktigt
hopp; pågående granskning låser båda knapparna. Se
[TASK222](../TASK_222_PARTICIPANT_SEQUENCE.md). Ingen API-, domän-,
behörighets- eller lagringsändring.

Riktade slutkontroller: webblint/typecheck/build **exit 0**, E2E-TypeScript/
ESLint **exit 0**, syntetiskt Playwright **2/2, exit 0**. Ett första
browserprov gav 1/2 på en äldre ordningsassertion som korrigerades för
den nya raden. 390/1280 px-bilder granskades; ingen fysisk mobil,
tävlingsdatabas eller fältacceptans ingick.

## 2026-09-27: TASK221 kompakt operativ avvikelseöversikt

`Under tävlingen → Läget` visar nu fyra separata avvikelser från redan
befintliga privata läs-API:er: motstridiga uppgifter, startade utan
registrerad återkomst, okänd startstatus och olösta okända målavläsningar.
Direktknappar öppnar respektive befintlig panel och skogsrapportens
aktuella filter rensas så att den valda gruppen syns. Källornas versioner
och lästid redovisas var för sig. Saknat, misslyckat eller gammalt svar
visas som okänt, inte aktuell nolla; osynkade mobilköer och att noll inte
bevisar tom skog är uttryckliga. Utseendet är neutralt och tätt på 390
och 1280 px. Ingen API-, domän-, behörighets- eller mutationsändring.
Se [TASK221](../TASK_221_RACE_DAY_ATTENTION.md).

Riktade kontroller: webblint/typecheck/build **exit 0**, E2E-TypeScript/
ESLint **exit 0**, återanvänt syntetiskt Playwright **2/2, exit 0** efter
att en första tvetydig locator för skärm/utskriftsrapport korrigerades.
Ingen riktig tävlingsdatabas, station, hårdvara eller fältacceptans ingick.

## 2026-09-27: TASK220 neutral och tät separat speakerarbetsyta

Den separata privata speakervyn har nu samma neutrala sidkrom som `/manage`.
På dator/padda är senaste resultathuvuden jämförbara i sex dividerade
kolumner; mobil visar samma namn/klubb, klass, status, tid, registrering
och revision i kompakta märkta rader. Effektiv MP/DSQ är textstödd röd;
nätbortfall och gammalt underlag visas som skilda gula textsignaler.
Exakt lästid/tidszon, tävlingsversion, 25-radersbegränsning och
vald/effektiv revision finns kvar. Ingen placering eller ledare härleds.
Se [TASK220](../TASK_220_QUIET_SEPARATE_SPEAKER.md). Auth, polling,
cookie, pagehide/bfcache, API och global stil är oförändrade.

Riktade slutkontroller: rapportenhetstest **4/4, exit 0**, webblint
**exit 0**, web-typecheck **exit 0**, web-build **exit 0**,
E2E-TypeScript/ESLint **exit 0**, syntetiskt Playwright **2/2, exit 0**.
En första enhetstestkörning gav 2/4 när äldre tester jämförde exakt HTML
över en ny etikettspan; textinnehållsassertionerna rättades och 4/4
passerade. 390/900/1280 px samt offlinebild granskades. Ingen riktig
databas/tävling/credential, fysisk mobil eller TASK008:s
produktions-/säkerhetsregression kördes.

## 2026-09-27: TASK219 lugnare administrationsytor och signalfärger

`/manage` har platt neutral mobilnavigering med 44 px mål och markerat
valt läge utan separata stora knappkort. Den privata speakerfeeden är en
tät dividerad lista. Rubrik-/måttvikt och rundningar är lätt nedtonade;
klasslänk och startlista har inget dekorativt grönstick. Befintlig röd
MP/DSQ, gul saknad/inaktuell uppgift, grön verklig klassledare och blå
fokusmarkering är intakta och textstödda. Endast den separat publicerade
ledarlistans sluttid får samma gröna signal; den privata feeden får ingen
härledd ledarfärg. [TASK219](../TASK_219_QUIET_ADMIN_SURFACES.md)
är avgränsad till admin-CSS; publika/stationsvyer, data och rättigheter
är oförändrade.

Slutliga riktade kontroller: webblint **exit 0**, web-typecheck **exit 0**,
web-build **exit 0**, browser-TypeScript/ESLint **exit 0**, syntetiskt
Playwright **1/1, exit 0**. Bilder på 390/900/1280 px granskades. Ingen
riktig tävling/databas, fysisk mobil eller användbarhetsmätning provades.

## 2026-09-27: TASK218 sju förberedelsevägar på två mobilrader

Alla sju `Före tävlingen`-delar är fortfarande synliga och ligger 4+3 på
mobil i stället för fyra rader. Kort synligt namn för lottning har kvar
fullt tillgängligt namn; val, låsning och större skärmar behåller sitt
beteende. [TASK218](../TASK_218_MOBILE_PREPARATION_NAVIGATION.md) ändrade
ingen domän, backend, behörighet eller lagring.

Samma slutliga syntetiska browserfall **1/1, exit 0** kontrollerade 390 px,
320 px utan sidspill, minst 44 px, sju vyer och tidigare innehållsstart.
E2E-TypeScript/ESLint samt webblint/typecheck/build gav **exit 0**.
Ingen fysisk mobil eller verklig tävling provades.

## 2026-09-27: TASK217 mobilkrom före arbetsytan

I autentiserat `/manage` på mobil försvinner den dubbla generiska
appheadern/sidrubriken visuellt medan tävlingens egen identitet, länk
till Mina tävlingar, sex statusmått, lästid/version och åtgärder behålls.
Fem huvudlägen upptar två i stället för tre rader; Under-lägets fyra
underflikar har en rad med kort synlig text och fullständigt tillgängligt
namn. Klassledarpanelen kommer före länken till separat speakerinloggning.
Se [TASK217](../TASK_217_MOBILE_ADMIN_FOCUS_CHROME.md). Ingen server-,
behörighets-, resultat- eller databasändring.

Syntetiskt browserfall **1/1, exit 0** kontrollerade mobil 390 px, minst
44 px navigeringsmål, bevarade sex statusmått och y-gränser för Speaker/
klassledare; 900/1280 px-bilder granskades. E2E-TS/ESLint och webblint/
typecheck/build gav **exit 0**. Ingen riktig tävling, fysisk mobil eller
fältanvändning har provats.

## 2026-09-27: TASK216 separat publik klassledarbild i adminspeaker

Administratörens speakerflik kan nu på uttrycklig begäran visa rankade
publika klassledare och deras sluttid före 25-radersfeeden. Delad ledning
visas; MP, annan placering och blandade banversioner får ingen falsk
ledarindikering. Panelen har egen mottagningstid/cachevarning och kopplar
inte publika rader till privata speakerunderlag via namn eller slot. ADR-0164
anger gränsen; ingen ny automatisk fullresultatspollning, serverroute,
behörighet, DB-migration eller resultatregel tillkom. Se [TASK216](../TASK_216_ADMIN_SPEAKER_PUBLIC_CLASS_LEADERS.md).

Riktad webblint/typecheck/build **exit 0**, enhetstest **1/1**, e2e-TS och
ESLint **exit 0**, syntetiskt Playwright **1/1 passerat** på 390/1280 px.
Initial lokal browserstart fick sandbox-`EPERM` (exit 1); godkänd omkörning
och slutkörning passerade. Ingen riktig tävling/DB, fysisk mobil eller
prestandamätning gjordes. Det är en manuell publik ögonblicksbild, inte
liveledare eller radiopassage.

## 2026-09-27: TASK215 neutral administration och signaler

`/manage` har nu ljus neutral bas, grafitgrå vardagsknappar och valda lägen,
tunnare ramar och mindre påträngande speakerpresentation. Mobilens fyra
arbetsvägar är dividerade rader i stället för fyra stora nästlade kort.
Röd text reserveras för explicit MP/DSQ och fel; gul för känd saknad fast
minutstart, ej återlämnad hyrbricka, obetalt eller äldre resultatunderlag.
Alla tillstånd har kvar svensk text; fokus har egen kontrasterande markör.
Inga publika/stationsvyer, API:er, resultatregler eller behörigheter ändrades.
Se [TASK215](../TASK_215_NEUTRAL_ADMIN_VISUAL_LANGUAGE.md).

Slutliga riktade kontroller: webblint **exit 0**, web-typecheck **exit 0**,
web-build **exit 0**, browser-TypeScript och ESLint **exit 0**, syntetiskt
browserfall **1/1 passerat**. Bilder på 390/900/1280 px granskades. Första
browserstarten fick `EPERM` på lokal port (exit 1); beviljad omkörning
passerade. Ingen databas eller verklig tävling användes. Speakerunderlaget
saknar fortfarande ledare, placering och tidsavstånd; ledartider kan inte
färgkodas sanningsenligt ännu. Fysisk användning, textzoom och stora fält
återstår.

## 2026-09-27: TASK214 icke aktiverande writerprofil-installerare

En Linux-/rootbunden installerare är förberedd för exakt de tre granskade
`systemd-v1`-enheterna, med redan stängd markör, privata förprovisionerade
källfiler och strikt validerad icke-hemlig konfiguration som villkor. Den
skriver bara unitfiler; den kör inte `systemctl`, startar inte tjänster och
ger inget tekniskt skrivstopp. Temporära/partiella installationer avvisas
vid omkörning. [TASK214](../TASK_214_NONACTIVATING_WRITER_PROFILE_INSTALL.md)
beskriver Linux-acceptans som återstår.

Slutlig riktad syntetisk kontroll: Node **6/6, exit 0**, ESLint **exit 0**,
båda syntaxkontroller **exit 0**. En mellanliggande kontroll var **4/6** medan
fel för saknade källfiler och borttagen markör ännu inte normaliserades;
slutkörningen är grön. Ingen installerarkörning på värden, inga verkliga
credentials, ingen systemd-/DB-/MinIO-acceptans. Markören kontrolleras mellan
filsteg men låses inte mot extern root-controller; en ändrad markör avbryter
och kräver manuell granskning. Ingen fysisk credentialisolering eller
TASK180-dränering är bevisad.

## 2026-09-27: TASK213 läsande installationspreflight

Den icke aktiverade `systemd-v1`-profilen har nu en Linux-/root-bunden,
helt läsande preflight för exakt webb, migration och fast speaker-spärrning.
Den kräver byte-identiska unitmallar, avvisar extra `otid-`-enheter/drop-ins
och kontrollerar rootägda, oskrivbara katalogkedjor, utpekade startfiler,
markör och privata credentialkällor. Inga credentialvärden läses. Se
[TASK213](../TASK_213_WRITER_PROFILE_PREFLIGHT.md).

Riktade syntetiska Node-prov: **5/5, exit 0** efter skärpning av katalog- och
unitkontrollen. ESLint och syntaxkontroll: **exit 0** vardera. En mellanliggande
testkörning gav 1/5 när den utökade fixturekatalogen ännu saknade markörens
föräldrar; fixturen rättades och slutkörningen är grön. Ingen verklig Linux-
installation, systemd, DB, MinIO eller credential har kontrollerats.
Preflighten installerar ingenting och bevisar inte releaseinnehållets samtliga
filer, exklusiva writers eller TASK180:s stopp/dränering.

## 2026-09-27: TASK212 opt-in-prov för standalone-avslut

Ett test-only Linux-underlag provar den byggda Next 16.3.3-standalone-
serverns riktiga privata ruttuppladdning över två syntetiska DB–S3–DB-flöden.
En HTTPS-gate håller två versionssatta S3-`PUT`; den ena klienten förblir
ansluten och den andra bryter sin TCP-socket före SIGTERM. Ett positivt
utfall kräver två slutliga DB-manifest och punktmängder före processexit.
Gaten använder privat test-CA med aktiv TLS-verifiering och proben kräver
tom lokal isolerad PostgreSQL/PostGIS samt privat lokal MinIO-bucket. Se
[TASK212](../TASK_212_NEXT_STANDALONE_DRAIN_PROBE.md).

Riktad TypeScript och ESLint: **exit 0** vardera. Lokal import-/grindkontroll:
avsiktlig **exit 1, `TASK212_REQUIRES_LINUX`**, innan externa anslutningar.
Det verkliga Linux-/systemd-/MinIO-provet har **inte körts**. Varken
standalone-dränering eller TASK180:s tekniska skrivstopp är därmed visat;
inga produktionswriters, stoppbevis eller backupkvittens ändrades.

## 2026-09-27: TASK211 styrd SSE stängs vid skrivstoppsmarkör

En redan öppen publik resultatström kontrollerar nu samma fail-closed
insläppsgrind som nya HTTP-anrop före första data, efter asynkrona steg,
vid notifiering och på nästa 25-sekunders heartbeat. Vid stängd/osäker
markör avslutas strömmen och dess subscriber/timer; oadministerad lokal
utveckling är oförändrad. Abort under uppstart stänger också strömmen.
Se [TASK211](../TASK_211_MANAGED_SSE_QUIESCENCE.md).

Riktad web-Vitest: **3/3 SSE-tester**; slutlig kombinerad körning med
markörproven **2 filer, 8/8 tester, exit 0**. Web lint, typecheck och
build: var för sig **exit 0**. Detta är en strömlivscykelkontroll utan
PostgreSQL/MinIO/Linux/systemd. Hubben behåller sin LISTEN-DB-session och
det skrivande DB–objekt–DB-anropets SIGTERM-/klientavbrott är fortfarande
obevisat. Ingen controller eller backupkvittens har införts.

## 2026-09-27: TASK210 tät arbetsrad i tävlingsöversikten

Den separata fullbreddsgenvägen till Deltagare är nu en av fyra celler i
översiktens arbetsband. På 1280 px står Före, Deltagare, Under och Efter på
en rad; på 900 px i två rader; på mobil som fyra tydliga kort. Den kortare
underlagsförklaringen behåller begränsningen för stationer/osynkade köer och
ryms i en rad vid 900 px. Klass- och uppföljningstabellerna ligger först.
Den generella O-Tid-headern döljs i den inloggade arbetsytan på dator/padda,
medan tävlingsidentitet, tillbaka-länk och status är kvar; mobilen behåller
headern. Ingen fast/sticky topp, ny funktion, API- eller domänändring. Se
[TASK210](../TASK_210_COMPACT_OVERVIEW_WORKFLOW_ROW.md).

Riktat syntetiskt browserflöde **1/1, exit 0**; skärmbilder 390/900/1280 px
granskade. Web lint, typecheck, build och browser-TS/ESLint: vardera
**exit 0**. Första browserstarten fick `EPERM` på loopback (exit 1);
godkänd omkörning passerade. Verklig operatörsanvändning, större textzoom
och långa tävlingsnamn är fortfarande oprövade. Den gamla lokala servern på
port 3000 svarade inte under denna kontroll; det syntetiska provet kördes på
en separat lokal port.

## 2026-09-27: TASK180:s avslutningsgrind före controller

En läsande Sol-granskning och kontroll av den pinnade Next 16.3.3-koden
ändrade nästa säkra D1b-steg. Proxygrinden stänger nya anrop men räknar inte
färdigt arbete. Standalone-servern försöker vänta ut öppna svar vid SIGTERM,
men klientavbrott under DB–objektlagring–DB är inte visat. Ett omedelbart
`systemctl stop` plus tom processlista skulle därför riskera ett falskt
dräneringspåstående. [ADR-0160](adr/ADR-0160-technical-writer-stop-process-boundary.md),
[TASK180](../TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md) och
[källgranskningen](research/next-standalone-writer-drain.md) kräver nu ett
blockerat syntetiskt Linux-prov av hela anropets avslut innan stoppskript
eller backupbevis införs. Inga filer i driftprofilen ändrades och inga
tester kördes i detta dokumentationssnitt. Lokal värd har ingen
Linux/systemd-installation; den befintliga VMware-VM:n är Windows.


## 2026-09-27: TASK209 kompakt topp i bred administrationsvy

Tävlingsnamn/åtgärder och sex befintliga statusmått delar nu ett toppband
vid 1280 px, så arbetsflikarna och översiktens information börjar högre upp.
Vid 900/390 px behålls läsbar stapling och mobilens tryckytor. Inga uppgifter
döljs. Den äldre MeOS-jämförelsebilden från 25 september avsåg en tidigare
version; flera tabell- och kortförtätningar fanns redan före detta snitt.
Se [TASK209](../TASK_209_COMPACT_DESKTOP_COMMAND_STRIP.md).

Riktat syntetiskt browserfall **1/1, exit 0**, tre bredder och granskade
skärmbilder. Web lint/typecheck/build och browser-TS/ESLint: **exit 0** var
för sig. Första browserstarten fick `EPERM` på loopbackporten (exit 1),
beviljad omkörning passerade. Ingen API-, DB-, domän- eller
behörighetsändring. Långa tävlingsnamn, textzoom och fysisk användbarhet
återstår.

## 2026-09-27: TASK208 operativt resultatlägesfilter

Administratören kan nu filtrera hela den hämtade deltagarlistan på sju
gällande publicerade statusar samt separat på inget aktivt och inget
publicerat resultat. Valet kombineras med sökning, klass och befintliga
filter före ordning/sidindelning; det är ingen ny resultatbedömning.
Klass, resultatläge, ordning och radantal ryms på en rad vid 900/1280 px
och i två par på mobil utan nytt kort eller sidspill. Se
[TASK208](../TASK_208_ROSTER_RESULT_STATE_FILTER.md).

Riktad kontroll: webbenhetstest **6/6**, syntetiskt browserfall **1/1**
vid 390/900/1280 px, web lint/typecheck/build och browser-TS/ESLint,
samtliga **exit 0**. Browserfallet inkluderar 31 deltagare för filtrering
från andra sidan och återgång till vald person. Skärmbilder granskades.
Ingen API-, DB-, domän- eller behörighetsändring. Resultatdata uppdateras
vid befintlig rosterrefresh; TASK207:s DB-prestanda och fysisk användning
återstår.

## 2026-09-27: TASK207 gällande resultat i deltagartabellen

Den privata MANAGE_RACE-tabellen visar nu serverresolverad status och
eventuell löptid intill namn/klubb, klass, bricka och start. Utan publicerat
eller aktivt resultat sägs detta uttryckligen; äldre resultatsnapshot
markeras i samma resultatcell. Kandidatsvarets formatVersion höjdes till 2;
skrivkontrakten är oförändrade. Samma bulkresolver, strikt resultatparser och
repeatable-read används utan nya queries per person, mutation eller
migration. Mobilen har tvåkolumnig rad, dator/padda fem täta kolumner.
Arkitekturbeslutet finns i ADR-0163 och [TASK207](../TASK_207_ROSTER_EFFECTIVE_RESULT.md).

Riktad kontroll: kontrakt **4/4**, webbenhet **5/5**, syntetisk browser
**1/1** vid 390/900/1280 px, samtliga exit 0. Contracts/application/web
lint och typecheck, browser-TS/ESLint samt contracts/application/web build
gav exit 0. Bilder granskades utan horisontellt sidspill. Första browserstart
fick EPERM på sandboxens loopbackport (exit 1); beviljad omkörning passerade.
PostgreSQL-integrationen utökades men kördes inte: ingen isolerad
TEST_DATABASE_URL eller lokal PostGIS finns. Detta är inte en fältacceptans
för verklig tävling eller 10 000 deltagare.

## 2026-09-27: TASK206 startkolumnen leder till befintlig rättning

En saknad fast minutstarttid i administratörens deltagartabell har nu en
egen ”Sätt starttid”-åtgärd för exakt person. Den öppnar befintlig
TIME-granskning utan att skriva; fri start får ingen sådan handling.
Satta tider behåller full datum-/klock-/offsettext och kan flöda tätare i
kolumnen. Syntetiskt browserfall **1/1**, browser-TypeScript/ESLint samt
web lint/typecheck/build gav var för sig **exit 0**. Mobilknappen mättes
till minst 44 px och inget horisontellt sidspill sågs; mobil-/datorbilder
granskades. Ingen PostgreSQL, API-, domän- eller behörighetsändring.
Fysisk användbarhet och serveracceptans från nya ingången återstår. Se
[TASK206](../TASK_206_ROSTER_START_FOLLOWUP.md).

## 2026-09-27: TASK205 tätare deltagarrad

Personnamn ligger kvar i en tydlig valbar rad; klubb och samtliga befintliga
resultat-, hyrbricks- och betalningsetiketter delar nu en radbrytande
metadatarad. Full svensk text och namn+klubb som tillgängligt knappnamn
bevaras; knappens tryckhöjd är inte minskad. Riktat syntetiskt browserfall
**1/1** kontrollerade full text och radhöjd under 78 px vid 900 px och
under 66 px vid 1280 px, samt inget mobilt sidspill. Första utökade provet
visade 80,59 px och exit 1; efter lokal utfyllnadsjustering passerade
omprovet. Browser-TS/ESLint och slutlig web lint/typecheck/build gav var
för sig **exit 0**. Skärmbilder vid 390/900/1280 px granskades. Ingen DB,
API, domänregel eller behörighet ändrades. Långa verkliga uppgifter och
fysisk tillgänglighet återstår. Se
[TASK205](../TASK_205_PARTICIPANT_ROW_DENSITY.md).

## 2026-09-27: TASK204 vald deltagare utanför synlig lista

När ett öppet personkort inte längre motsvarar synlig tabellrad visas en
kompakt rad med namn och orsak: utanför urval eller på annan sida. ”Visa vald”
rensar uttryckligen filtren eller byter sida, men behåller ordning,
sidstorlek, person och arbetskort. Mobilen går till listan och rullar fram
raden. Syntetiskt browserfall **1/1**, browser-TS/ESLint och web
lint/typecheck/build gav slutligen **exit 0**. Första browserstarten nekades
av sandboxens lokala portspärr (exit 1); omkörning med lokal behörighet
passerade. Skärmbilder vid 390/1280 px granskades utan horisontellt spill.
Ingen DB, API, domänregel eller behörighet ändrades. Riktig stor tävling,
textzoom, skärmläsare och fysisk mobil/padda återstår. Se
[TASK204](../TASK_204_PARTICIPANT_SELECTION_CONTEXT.md).

## 2026-09-27: TASK203 valbar ordning i deltagartabellen

Serverns redan stabila efternamn–förnamn–ID-ordning är kvar som standard.
Operatören kan nu välja fast starttidsordning för hela det filtrerade urvalet
före sidindelning; fri start/saknad fast tid ligger sist, lika tider behåller
serverordningen. En kompakt väljare ryms med klass och rader på samma rad i
syntetisk 390/900/1280px-vy. Riktat enhetstest **5/5**, browserfall **1/1**,
browser-TS/ESLint och slutlig web lint/typecheck/build gav **exit 0**.
Första lint/typecheck på nya testassertioner gav exit 1/2; efter rättning
passerade slutkontrollerna. Mobil-/padd-/datorbilder granskades. Ingen DB,
API, domänregel eller publik startlista ändrades. Riktigt stort startfält
och fysisk användbarhet återstår. Se [TASK203](../TASK_203_PARTICIPANT_START_ORDER.md).

## 2026-09-27: TASK202 klasskontext från översikt till åtgärd

Översiktens klassnamn öppnar Före → Klasser med samma klass vald i de
befintliga kontrollerna för deltagargräns och startupplägg; bannamn och
version syns direkt på padda/dator. Klassvyns tillförlitliga varning om
saknad fast tid leder till TASK201:s exakta deltagarurval, medan avvikande
antal fortsatt visas som ”Kontrollera antal” utan åtgärdslänk. Syntetiskt
browserfall **1/1**, browser-TS/ESLint och web lint/typecheck/build gav
slutligen **exit 0**. Första utökade browserprovet föll på ett äldre
antagande om vilken förberedelseflik som återöppnas; testet rättades och
omkörningen passerade. 390-/1280px-bilder granskades. Ingen DB, API,
behörighet eller resultatregel ändrades. Fysisk användbarhet återstår.
Se [TASK202](../TASK_202_CLASS_CONTEXT_HANDOFF.md).

## 2026-09-27: TASK201 saknad minutstart leder till rätt personlista

Ett positivt antal saknade fasta starttider i översiktens klasstabell öppnar
nu deltagarlistan filtrerad till just klassen och de personer som saknar tid.
Aktivt urval syns och kan tas bort. Fri start och nolltal får ingen
åtgärd; aktuellt underlag filtreras om efter uppdatering. Riktat enhetstest
**4/4**, syntetiskt browserfall **1/1**, web lint/typecheck/build och
browser-TS/ESLint gav slutligen **exit 0**. Första browserstarten stoppades
av sandboxens loopback-`EPERM`; första browser-TS/ESLint pekade på ett
icke-existerande konfigurationsfilnamn; båda kontrollerna kördes om med
rätt miljö/namn och passerade. Ingen DB, API, domänregel eller behörighet
ändrades. Fysisk touch/skärmläsare/textzoom återstår. Se
[TASK201](../TASK_201_MISSING_FIXED_START_FOLLOWUP.md).

## 2026-09-27: TASK200 tätare deltagarfilter utan dold semantik

Vid 900 px upptar de tre kombinerbara filtren nu två i stället för tre
rader; vid 1280 px ligger de på en rad. Mobilen behåller fulltext och minst
44 px etiketter. Fullständiga tillgängliga checkboxnamn och antal för
positivt/noll/ännu odefinierat underlag finns kvar. Ett riktat syntetiskt
browserfall **1/1**, browser-TS/ESLint och slutlig web lint/typecheck/build
gav **exit 0**. Skärmbilder vid 390/900 px granskades; ingen databas,
filterlogik eller behörighet ändrades. Första utökade browserkörningen föll
på för tidig 1280px-geometrimätning efter personval, och första web-
typecheck på ett odefinierat antal; båda rättades och slutkontrollerna
passerade. Fysisk touch/skärmläsare och textzoom återstår. Se
[TASK200](../TASK_200_PARTICIPANT_FILTER_DENSITY.md).

## 2026-09-27: TASK199 deltagarverktyg på en rad i 900px-vyn

Växeln heter nu synligt ”Bred tabell”/”Delad vy” och har en förklarande
tillgänglig etikett med samma inledande ord. Deltagarlistans verktygsrad
får tätare mellanrum endast i 721–1199 px; alla handlingar och fortsatt
radbrytning vid trängsel finns kvar. Syntetiskt browserfall **1/1**
verifierade tre knappar på en 900px-rad utan överlapp, växling åt båda håll,
390/1280 px och inget horisontellt sidspill. 900px-bilden granskades.
Web lint/typecheck/build och browser-TS/ESLint gav **exit 0**. Ingen databas,
domänlogik eller behörighet ändrades. Fysisk padda, textzoom och extra
hyrbricksåtgärd är inte visuellt accepterade. Se
[TASK199](../TASK_199_PARTICIPANT_TABLE_TOOLBAR.md).

## 2026-09-27: TASK198 paddans statusrad utan onödig textradbrytning

En 900px-browsermätning visade att sex statusmått redan låg på en rad, medan
versions-/lästidstextens 27rem-gräns gjorde den två rader hög. Texten får nu
full bredd mellan 721 och 1199 px; ingen uppgift kortas eller döljs.
Statusremsan gick från **58,34 px** till **under 50 px** i samma syntetiska
900×800-prov. Browserfall **1/1** samt web lint/typecheck/build och
browser-TS/ESLint gav **exit 0**. 390/1280 px och frånvaro av sidspill
ingick i samma browserfall; 900px-skärmbilden granskades. Ingen databas,
domänlogik eller behörighet ändrades. Längre text/textzoom och fysisk padda
återstår. Se [TASK198](../TASK_198_TABLET_STATUS_DENSITY.md).

## 2026-09-27: TASK197 plattare resultatdetalj i deltagarvyn

Kontroll-/sträcktidssektionen använder nu en tunn avdelare i stället för
kort-i-kort i deltagarens arbetsyta på dator/padda (från 721 px). Mobilens
inramade sektion och alla resultatfakta, varningar och kontrollrader är kvar.
Syntetiskt browserprov vid 390/900/1280 px **1/1**; web lint/typecheck/build
och browser-TS/ESLint gav var för sig **exit 0**. Första browserstarten
blockerades av sandbox-`EPERM` på port 3167, omkörningen på lokal loopback
passerade. Skärmbilderna för dator/mobil granskades. Ingen databas, extern
tävling, resultatregel eller behörighet ändrades. Fysisk padda återstår.
Se [TASK197](../TASK_197_FLAT_PARTICIPANT_RESULT_DETAILS.md).

## 2026-09-27: TASK196 Linuxacceptans förberedd men inte körd

En syntetisk oneshot-fixture och ett tvåfasigt provprotokoll kan senare
kontrollera samma beständiga markör mot verklig systemd-start och Next-HTTP
i en disponibel Linux-VM. De är inte installerade eller aktiverade.
Riktad statisk writerinventering **3/3, exit 0** och ESLint **exit 0**.
Värden är macOS och saknar `systemd-analyze`, Docker och VM-runner; inget
Linux-/HTTP-integrationsbevis, dränering eller backupstopp har uppnåtts.
Se [TASK196](../TASK_196_LINUX_ADMISSION_ACCEPTANCE_FIXTURE.md).

## 2026-09-27: TASK195 webbgrinden använder samma fasta Linux-markör

`systemd-v1`-HTTP-insläpp kräver nu exakt `/var/lib/o-tid/controller/closed`,
Linux och en stabil, verklig root-ägd katalogkedja utan grupp-/världsskrivrätt.
Annan väg eller osäker kontroll stänger. Riktad enhetstest **5/5**,
Mac-HTTP **1/1**, web-/E2E-TypeScript, full web-ESLint, riktad E2E-ESLint
och webbuild gav exit 0. Första TypeScriptförsöket (felaktig testseam-typ,
exit 2) och första browserstarten (sandbox `EPERM`, exit 1) rättades respektive kördes om
med tillåten lokal loopback. Det finns ingen testbakdörr i Next-proxy.
Linux-installationsprov, dränering och tekniskt stoppbevis återstår. Se
[TASK195](../TASK_195_PIN_WRITER_HTTP_MARKER.md).

## 2026-09-27: TASK194 beständig men ännu odränerad writer-stängning

Controllerns första filsteg kan nu på Linux som root skapa exakt den
root-ägda tomma markören utan överskrivning och synka fil/katalog före
kvittens. Riktade syntetiska markör-/start-/inventeringsprov **8/8**,
ESLint och Node-syntax **exit 0**; macOS-produktionsgrind nekade avsett med
exit 1. Ingen unit stoppas, pågående HTTP/MinIO-steg dräneras inte, writer-
sessioner kontrolleras inte och inget tekniskt stoppbevis eller release
utfärdas. Se [TASK194](../TASK_194_DURABLE_WRITER_ADMISSION_CLOSE.md).

## 2026-09-27: TASK193 fast speaker-spärrning i icke aktiverad startprofil

TASK180:s deklarerade CLI-gräns har nu exakt ett fast, idempotent revoke-
exempel. Privat versionssatt begäran levereras som systemd-credential;
kvittens reserveras före DB-open i ny 0600-fil och ingen utdata går till
journalansluten stdout/stderr. `issue` och övriga CLI-writers saknar fortsatt
unit. TypeScript/ESLint/shellsyntax exit 0, riktad Vitest 7/7 och Node
start-/inventeringsprov 5/5. Ingen riktig DB, installerad Linux-unit,
journalinspektion, controller, dränering eller stoppbevis ingår. Se
[TASK193](../TASK_193_FIXED_SPEAKER_REVOKE_START.md).

## 2026-09-25: fullständig klass–ban-läsprojektion

Klassöversiktens bannamn/version kommer nu från den befintliga
racekontrollerade transfer-candidates-läsningen, som redan kopplar klass till
banversion och bana. Det separata geometrianropet är borttaget från Klasser;
kontrollösa och fler än 100 banversioner begränsas inte längre av det
geometrikontraktet. Banflikens kontrollföljd och alla mutationer är orörda.
Kontraktsprov **4/4** och återanvänt syntetiskt browserprov **1/1**;
kontrakt/application/web lint, typecheck och build samt E2E-TS/ESLint
**exit 0**. Lokal demo granskad vid 390/900 px utan sidspill.
PostgreSQL-integrationsfall för kontrollös version 101 är tillagt men **inte
kört**, eftersom `TEST_DATABASE_URL` saknas; faktisk DB-acceptans kvarstår.
Se [UI-beslutet](ui-workspace-design-2026-09-24.md#fullständig-klassban-projektion-2026-09-25).

## 2026-09-25: bana direkt i tät klassöversikt

Före → Klasser visar nu namn/version för exakt matchad banversion bredvid
startregel, tidsberedskap och kapacitet. 1280/900 px behåller fyra kolumner;
390 px lägger banan direkt under klassnamnet utan horisontell sidscroll.
Saknat eller otillgängligt banunderlag märks, ingen bana gissas. Web
lint/typecheck/build och browserprovets TypeScript/ESLint gav **exit 0**;
återanvänt syntetiskt browserprov **1/1**. Inga skrivflöden, rättigheter,
API-kontrakt eller databas ändrades. Banöversiktens befintliga begränsning
(kontrollösa versioner utelämnas, högst 100 banversioner) kvarstår och måste
hanteras innan bred tävlingsacceptans. Se
[UI-beslutet](ui-workspace-design-2026-09-24.md#bana-i-klassraden-2026-09-25).

## 2026-09-25: tätare klassöversikt i Före

Före → Klasser visar nu startregel, anmälda/gräns, text för full eller stängd
klass och beredskap för fasta starttider i en kompakt tabell på dator/padda.
Mobil staplar samma uppgifter per klass utan horisontell sidscroll.
Avvikande deltagarantal markeras som osäkert; befintliga formulär och
skrivflöden är orörda. 390/900/1280 px kontrollerades visuellt. Riktad web
lint, typecheck och build samt browserprovets TypeScript/ESLint gav **exit 0**;
ett återanvänt syntetiskt browserprov passerade **1/1** med saknad tid, fri
start, full/stängd klass och avvikande antal. Ingen API-, domän- eller
dataändring. Stor verklig startlista, långa namn och fysisk padda återstår.
Se [UI-beslutet](ui-workspace-design-2026-09-24.md#klasser-som-förberedelseöversikt-2026-09-25).

## 2026-09-25: tätare banöversikt i Före

Före → Banor visar nu befintligt bannamn/version/klasskoppling och ordnad
kontrollföljd i två spalter när innehållsytan räcker. Vid 1280 px var tre
syntetiska banrader cirka 59 px höga; även 800 px fick två spalter, medan
721/390 px behöll en spalt. Ingen horisontell sidscroll observerades och
upprepad kontrollkod behöll sin separata ordningsplats. Web lint, typecheck
och build samt browserprovets TypeScript/ESLint gav **exit 0**. Det enda
återanvända syntetiska browserprovet passerade **1/1**. Inga API-, domän-
eller dataändringar. Långa verkliga namn, många kontroller och fysisk
padda återstår att granska. Se [UI-beslutet](ui-workspace-design-2026-09-24.md#banöversikt-utan-onödig-fullbreddshöjd-2026-09-25).

## 2026-09-25: deltagarens arbetskort rullar separat på dator/padda

I `/manage` stannar den sökbara deltagarlistan bredvid ett höjdbegränsat,
separat rullbart arbetskort vid minst 721 px bredd. Mobilens separata vy är
oförändrad. 900×800 och 1280×800 kontrollerades visuellt; Page Down rullade
kortet utan att flytta listan. 390 px hade inget horisontellt spill. Befintligt
syntetiskt browserprov med sex deltagare passerade **1/1** efter en liten
anpassning till den nya scrollcontainern. Web lint, typecheck och build samt
browserprovets TypeScript/ESLint gav **exit 0**. Första browserstarten nekades
localhost-port i sandlådan; ett senare prov hittade en gammal testförutsättning
om endast sidscroll och rättades. Ingen API-, domän- eller databasändring;
fysisk padda och stor verklig deltagarlista återstår. Se
[UI-beslutet](ui-workspace-design-2026-09-24.md#deltagararbete-inom-synfältet-2026-09-25).

## 2026-09-25: TASK192 icke aktiverad startprofil för writers

ADR-0160:s första Linux/systemd-startprofil har nu en fail-closed
markörkontroll, credential-launcher och **exempel** för webb och migration.
Inga enheter är installerade eller aktiverade. Betrodda CLI-starter,
credentialägande, controller, dränering av pågående objektsteg, noll
writer-sessioner och riktig Linux-/MinIO-/PostgreSQL-acceptans återstår.
`writeStopConfirmed` påverkas inte. Se [TASK192](../TASK_192_WRITER_START_PROFILE.md).
Riktade Node-prov **3/3** passerade; ESLint, Node-/shellsyntax **exit 0**.
Launchern nekade väntat macOS-start med **exit 78**. Ingen build eller
TypeScript-kontroll berör de fristående exempelfilerna. Ingen Linux-körning.

## 2026-09-25: TASK191 navigation tillbaka till tävlingslistan

Arrangörens öppningsknapp heter nu **Öppna arbetsytan**. `/manage` har en
kompakt länk till Mina tävlingar i identitetsraden; länken är inte klickbar
under olöst granskning/åtgärd. Den separat behöriga skrivskyddade
loppöversikten länkar till arbetsytan med uttryckligt behörighetsförbehåll.
Inga API:er eller rättigheter ändrades. Riktad web-/E2E-lint och TypeScript
**exit 0**; **12/12** komponenttester, återanvänt browserprov **1/1** vid
390/900/1280 px (**9,9 s** i slutkörningen) och Next-build **exit 0**.
Syntetiskt prov,
inte fysisk enhet eller verklig behörighetsresa. Se [TASK191](../TASK_191_COMPETITION_NAVIGATION_BRIDGE.md).

## 2026-09-25: TASK190 första HTTP-grind för framtida tekniskt skrivstopp

`systemd-v1` kan nu neka alla nya Next-HTTP-anrop med en installationsägd
stoppmarkör. Okänd/ofullständig profil och osäker markörkatalog stänger;
omanagerad lokal utveckling är oförändrad. Detta är **bara insläpp**, inte
TASK180:s tekniska skrivstopp: betrodd controller, CLI/worker/migrationer,
pågående objektsteg och Linux-bevis återstår. ADR-0160 kompletterades före kod.
Riktad web-/E2E-TypeScript, separat ESLint och produktionsbuild: **exit 0**;
enhetsprov **4/4**, syntetiskt lokalt HTTP-prov **1/1**, båda **exit 0**.
Första sandbox-HTTP-provet fick port-EPERM och kördes därefter godkänt med
lokal loopbackbehörighet. Se [TASK190](../TASK_190_WRITER_STOP_HTTP_ADMISSION.md).

## 2026-09-25: TASK189 renare hierarki i adminarbetsytan

Vald deltagares fakta är nu integrerade utan en extra nästlad ram på dator/
padda. Mobilkortet är kvar. Före → Upplägg visar klassernas verkliga
start-/kapacitetsdata före sex synliga vägledningssteg; en duplicerad rad med
snabbknappar är borta, men områdesflikarna är kvar. Riktad web-/E2E-lint och
TypeScript **exit 0**, syntetiskt browserfall **1/1, 17,3 s, exit 0** och
Next-build **exit 0**. Inga API-, domän-, behörighets- eller dataändringar.
Fysisk enhet och större verklig tävling återstår. Se [TASK189](../TASK_189_ADMIN_WORKSPACE_VISUAL_HIERARCHY.md).

## 2026-09-25: TASK188 vardagsändring direkt vid deltagaren

Aktivt formulär för namn/klubb, klass, bricka, fast starttid eller betalning
ligger nu direkt efter personfakta och kort gällande resultat i `/manage`.
Kontrolltider, sekundära resultatbeslut/historik och frivillig kontokoppling
finns kvar längre ned. Ingen API-, domän-, behörighets- eller dataändring.
Riktad web-/E2E-lint och TypeScript **exit 0**, befintligt syntetiskt
browserfall **1/1, 18,1 s, exit 0**, Next produktionsbuild **exit 0**.
390/900/1280 px verifierade; fysisk enhet och riktig DB-skrivning ingår inte.
Mellanliggande testfel och kvarvarande antaganden finns i
[TASK188](../TASK_188_PARTICIPANT_EDIT_ORDER.md). Det övergripande
fält-/driftmålet är fortfarande öppet.

## 2026-09-25: TASK187 kompakt tävlingsarbetsyta, TASK183 klar

`/manage` använder nu mer av stor skärm till tävlingsdata: mindre identitet/
status, flikar i stället för stora knappar, kompakta paneler och samlad
sök-/filterrad. Klasslistan kommer före översiktens genvägar. Mobil och
pek-läge behåller 44 px primära mål; station/publik/auth är oförändrade.
Topphöjd i faktisk 1280×800-demo: **312 → 166 px** (avrundat).

Riktad lint/typecheck och slutlig webbuild **exit 0**. Ett återanvänt utökat
browserfall **1/1, 36,0 s, exit 0**: sex personer, minst fem helt synliga
rader + personfakta, synliga varningar, 900/390 px utan sidöverflöde och
44 px mobilnavigation. Inga tävlingsdata ändrades. [TASK187](../TASK_187_COMPACT_COMPETITION_WORKSPACE.md)
redovisar kommandon och två rättade äldre testfixturefel. TASK183:s tidigare
öppna femraderskrav är därmed verifierat. Fysisk mobil/padda återstår.

## 2026-09-24: TASK186 nyckelfri lokal utvecklingsåtkomst

Den uttryckligt valda lokala testtävlingen öppnar nu `/manage` automatiskt.
Efter sessionsutgång räcker omladdning eller **Öppna testtävlingen**.
ADR-0162 skrevs före kod: normal session/CSRF/audit används, enbart development,
loopback och verifierad lokal demodatabas; ingen produktionsauth stängs av.
Riktad lint/typecheck/build **exit 0**, **6/6 tester** och faktisk browserkontroll
av den befintliga syntetiska demon passerade. Bara åtkomsthistorik/sessioner
tillkom, inte tävlingsdata. Kommandon, mellanliggande fel och antaganden finns i
[TASK186](../TASK_186_LOCAL_DEVELOPMENT_ACCESS.md). Nästa minsta UI-snitt är
fortfarande återstående TASK183, tätare deltagartabell på stor skärm.

## 2026-09-24: TASK185 upplägg, operativ personvy och speaker

Före har nu tydliga områden för banor, klasser, deltagare, lottning,
startlista och funktionärer. Under skiljer lägesbild, deltagare, speaker
och rättningsverktyg. Samma sökbara deltagartabell har klassfilter,
25/100/250 rader och bredläge; personfakta kommer före sekundära beslut.
Historiska kontrolltider läses enligt ADR-0161, skriven före kod. Egen
speakerflik använder befintlig adminsession utan att vidga funktionärsroller.

Riktad lint/typecheck och webbuild: **exit 0**. **44 unika kontrakts-/route-/
projektionsprov** passerade (43 + 4 körningar med 3 överlappande kontraktstest).
Ett befintligt utökat browserprov: **1/1, 14,0 s, exit 0**, syntetiskt
390/900/1280 px. Inga riktiga credentials, Eventor-anrop, migrationer eller
DB-writes. Riktig databas-/fältacceptans och full äldre UI-regression återstår.
[TASK185](../TASK_185_SETUP_AND_RACE_DAY_WORKSPACE.md) redovisar kommandon,
mellanliggande testfel och antaganden. Nästa minsta snitt är återstående
[TASK183](../TASK_183_PARTICIPANT_DESKTOP_TABLET_DENSITY.md): mindre
filter-/verktygsyta och minst fem synliga deltagarrader i 1280×800.

## 2026-09-24: TASK184 tävlingsbild och sammanhållen UI-riktning

Officiella guider för MeOS, Ór och RACE RESULT har jämförts som
beteendereferens. [UI-riktningen](ui-workspace-design-2026-09-24.md) skrevs
före kod och anger vad som hör hemma i Översikt, Före, Deltagare, Under och
Efter. Ingen teknik, domängräns eller behörighet ändras.

`/manage` börjar nu med tävlingsbild och klass-/start-/kapacitetsöversikt.
Uppföljning öppnar befintliga deltagarfilter. Tids-/kontrollrättningar ligger
under Under, funktionärsåtkomst under Före och kart-/ruttverktyg under Efter.
Pågående granskning/oklart sparutfall får inte döljas vid lägesbyte.
Mobilen är staplad; breda skärmar visar mer samtidigt.

Web-typecheck, riktad lint, browserprovens TypeScript/lint och produktions-
build: **exit 0**. Utökat befintligt syntetiskt browserprov:
**1/1, 13,7 s, exit 0**, vid 390/900/1280 px. Inga riktiga credentials,
Eventor-anrop eller DB-writes. Full databasregression och fysisk mobil är
inte körda. [TASK184](../TASK_184_COMPETITION_WORKSPACE_OVERVIEW.md) redovisar
kommandon, mellanliggande fel och antaganden. Nästa minsta UX-snitt är
fortfarande [TASK183](../TASK_183_PARTICIPANT_DESKTOP_TABLET_DENSITY.md):
vald deltagares fakta före sekundära åtgärder och tätare deltagaröverblick.

## 2026-09-23: TASK182 MeOS-guide jämförd och adminarbete grupperat

En läsande jämförelse med MeOS 5.0-handbokens ordning finns i
[researchnoteringen](research/meos-guide-workflow-2026-09-23.md). O-Tid hade
många verktyg men en lång och svåröverskådlig `/manage`-sida; den valda
deltagarens kontokod låg före gällande resultat. Ett avgränsat UI-snitt ger
nu Deltagare som startläge samt Före, Under och Efter tävlingen. Befintliga
verktyg har grupperats utan nya API:er, behörigheter, tävlingsformer eller
resultatregler. Statusraden och underlagsversionen är gemensamma; valt objekt,
sökning och formulär monteras inte om vid lägesbyte. Pågående granskning/
oklar commit låser bytet. Kontokoppling är en frivillig detalj efter resultatet.

Riktad web-TypeScript, ändrade webbfiler i ESLint, E2E-TypeScript och E2E-
ESLint: **exit 0**. Isolerat syntetiskt browserprov vid 390, 900 och
1280 px: **1/1, exit 0** med lägesbyten, bevarad sökning/markering, review-lås,
sida-vid-sida-lista/detalj på padda och ingen horisontell scroll.
Checkin-appskal: **exit 0**. Next produktionsbuild:
**exit 0** med icke-fungerande byggplaceholder för `DATABASE_URL`; ett första
försök utan variabeln gav **exit 1** vid konfigurationsläsning. Ingen riktig
databas, Eventor-nyckel eller tävlingsdata användes. Fysisk mobil, full
adminregression och användarprov återstår. Stafett och gaffling är fortfarande
inte stödda. [TASK182](../TASK_182_ADMIN_WORKFLOW_NAVIGATION.md) har detaljerna.
Nästa minsta UX-snitt är [TASK183](../TASK_183_PARTICIPANT_DESKTOP_TABLET_DENSITY.md):
fler redan kända deltagarfakta samtidigt på padda/dator, utan att tränga ihop
mobilvyn.

## 2026-09-23: TASK181 enklare lokal åtkomst till syntetisk demo

Ett macOS-kommando `pnpm demo:access:copy --private-manifest <privat-fil>`
läser det befintliga strikt validerade demomanifestet och kopierar endast
dess ännu giltiga `MANAGE_RACE`-credential till urklipp. Kommandot skriver
inte nyckeln i argv, stdout, stderr eller URL och ändrar varken databasen,
inloggningens kontroll eller manifestet. Det är en utvecklarhjälp, inte en
kort statisk nyckel, produktionsbehörighet eller automatisk inloggning.

Riktad scripts-typecheck och ESLint: exit 0. Manuell körning mot den redan
isolerade syntetiska demofilen: exit 0 och hemlighetsfri bekräftelse för rätt
lopp. Ingen webbläsarinloggning eller annat operativsystem har verifierats i
detta snitt. TASK180:s tekniska Linux/systemd-skrivstopp är fortfarande öppet.

## 2026-09-23: TASK180 beslut om skrivstoppsgräns, tekniskt bevis öppet

En läsande inventering visade att serverns writes inte delar något globalt
lås. HTTP-flöden omfattar bland annat ingest, admin, konto/session och
uppladdning; uppladdningar kan skriva privata objektbytes mellan DB-
transaktioner. Betrodda CLI-kommandon skapar separata DB-pooler, och
`apps/worker` är ännu en placeholder. Compose definierar endast Postgres och
MinIO, inte en supervisor för webb-/CLI-processerna.

[ADR-0160](adr/ADR-0160-technical-writer-stop-process-boundary.md) väljer
därför en synlig installations-/processgräns för TASK180, **inte** ett nytt
race-scope- eller advisory-lås. En konkret driftprofil måste stänga ny
ingress, hindra alla inventerade writers från att starta, dränera pågående
operationer inklusive objektsteg och därefter visa noll writer-DB-sessioner.
Stoppet ska överleva fel/omstart tills explicit release. Lokal stationskö får
fortsätta lagra offline. Ingen sådan controller finns ännu i repositoryt;
TASK180 är **inte** syntetiskt verifierad och D1b.4 är fortsatt öppen.

ADR-0160 väljer nu en **dedikerad Linux/systemd-installation** som första
konkreta målprofil, med separat writer-principal, inventerade enheter och
betrodd controller. Det är ett teknikbeslut före kod, **inte** en fungerande
supervisor. Denna macOS-värd saknar Docker, systemd och VM-runner, så faktisk
process-/omstartsacceptans kan inte göras här. Nästa konkreta arbete är
minsta körbara profil och därefter ett isolerat Linux-samtidighetsprov. Om
verklig writer-admission inte kan bevisas får ingen backupkvittens härledas
ur mänskligt `writeStopConfirmed` eller en ögonblicksbild av
`pg_stat_activity`.

## 2026-09-23: TASK179 beständig syntetisk backupöverlämning mellan processer

ADR-0159 kompletterades före kod med en privat write-once-completionfil:
canonicalt manifest, hemlighetsfri kvittensbindning och hash av det privata
MinIO-målets bindning. Filen publiceras först efter TASK177:s final proof.
En separat restoreprocess återläser filen, `CLEANUP_VERIFIED`, dumpbytes och
målbindning, öppnar samma färdiga pinnade MinIO-mål för läsning och återställer
den uppmätta dumpen till en ny tom PostgreSQL17/PostGIS-databas. Exakt
historisk PM-version och bevarad event-/resultathistorik kontrolleras med den
befintliga läsande verifieraren. Ingen source-URL eller source-credential
behövs i restoreprocessen. Inga produktionsdata användes.

Riktade infrastructure-tester: **2 filer, 6 passerade, 2 opt-in överhoppade,
exit 0**. Infrastructure lint, typecheck och build: **exit 0 vardera**.
Full tvåprocess-opt-in med hashpinnad MinIO/`mc` och två nya isolerade
PostgreSQL17-databaser: **exit 0**. Oberoende radantal i källa och mål:
`1|1|1|1|1` för event, anmälan, PM-manifest, resultatrevision och
finalisering. Ett tidigare försök fångades korrekt men stoppade vid
återöppning av målbindning på grund av en för strikt intern schemaform;
efter rättningen kunde en **ny separat restoreprocess** öppna just dess
bevarade completion-underlag och slutföra restore, innan en helt ny full
opt-in-körning också gav exit 0. Därmed ersätter inte enbart ett grönt
enhetstest återstartsbeviset.

Fem försök gav tio exakt identifierade syntetiska source-/target-databaser.
Efter kontroll av ägare och noll anslutningar togs dessa tio bort med
individuella `DROP DATABASE`; frånvaro verifierades. Testbytes är permanent
borta. Privata MinIO-/felartefakter från misslyckade försök lämnades kvar för
diagnos; den lyckade körningens temporära privata underlag städades. Ingen
verklig tävling, Eventortrafik eller produktionscredential användes.

D1b.4f är syntetiskt verifierad, men D1b.4 är fortfarande öppen: faktiskt
tekniskt skrivstopp, exklusivt produktionsägande av MinIO-regler, betrodd
återstartsbar operatörsåtgärd, fler stores och fältacceptans saknas.
**Nästa minsta D1b-uppgift:** [TASK180](../TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md)
beslutar skrivstoppsgränsen i ny ADR och provar dess stoppa/dränera/explicit
release mot isolerade syntetiska server-writers. ADR-0140:s befintliga
`writeStopConfirmed` är ett operatörsintygande, inte ett tekniskt stopp.

## 2026-09-23: TASK178 kvitterad syntetisk backup återställd med samma PM-version

En separat opt-in-variant återanvänder TASK177:s fulla managed capture och
hemlighetsfria kvittens. Medan dess privata MinIO-mål fortfarande är bundet
återställs **samma** uppmätta `pg_dump -Fc` till en ny tom PostgreSQL17-
databas. Den befintliga läsande `verifyOperationalRestore` kontrollerar
dump, exakt historisk PM-version genom vanlig målläsare och återställd
databashistorik. Samma syntetiska event-/anmälnings-ID och PM-tuple som
källmanifestet krävs; ingen eftermigration, seed eller omskrivning av
version-ID sker. TASK177:s capture-only-läge är oförändrat.

Opt-in **exit 0**. Oberoende radantalskontroll visade i både källa och mål
`1|1|1|1|1` för event, anmälan, PM-manifest, resultatrevision och
finalisering. Riktade restoretester: application **11/11**, infrastructure
**2/2**, båda exit 0. Infrastructure lint/typecheck/build **exit 0** och
runnerns ESLint **exit 0** efter sista kodändringen. De redan befintliga
TASK170-negativfallen för icke-tomt mål, saknad/fel PM-version och ändrat
dumpbevis återanvändes i designen men kördes inte om här. En extra felaktig
TASK170-framgångsrad i TASK178-utskriften rättades efter opt-in; restore-
logiken ändrades inte. Efter kontroll av **0 anslutningar** togs exakt de
två nyss skapade syntetiska databaserna bort och frånvaro bekräftades;
deras bytes kan inte återställas.

D1b.4e har ett syntetiskt helhetsbevis, men D1b.4 är fortfarande inte en
operativ backup-/restoreåtgärd. Faktiskt tekniskt skrivstopp,
produktionsmässigt exklusiva replikeringsregler, återstartbar privat
operatörsåtgärd/kvittens, fler stores och fältacceptans återstår. Ingen
verklig tävling, Eventortrafik eller produktionscredential användes.
Nästa minsta snitt är [TASK179](../TASK_179_DURABLE_BACKUP_RESTORE_HANDOFF.md):
privat beständig completion-överlämning och syntetisk restore från en **ny
process**. ADR-0159 måste kompletteras före dess kod.

## 2026-09-23: TASK177 managed syntetisk backup med slutlig kvittensgrind

ADR-0159 fastställer att application äger `DUMP_PENDING` och
`TARGET_PREPARATION_PENDING`, medan TASK175:s managed port ensam äger
replikerings- och cleanupfaserna. Full `captureOperationalBackup` använder nu
den ordningen, kräver exakt en PM-store före målpreparering och returnerar
enbart backup-id, manifesthash och verifierat PM-antal efter separat
slutbevis. Infrastructure återläser privat `CLEANUP_VERIFIED` och målbindning,
kräver noll källregler, läser varje exakt manifestversion på målet och
mäter den privata dumpens bytes igen. Ett fel ger ingen kvittens.

Riktad application lint/typecheck/build **exit 0**, capturetest **8/8**;
infrastructure lint/typecheck/build **exit 0**, tre berörda testfiler
**9/9**; den körbara sammansättningens typecheck och ESLint **exit 0**.
Opt-in-provet med två nya isolerade PostgreSQL17-databaser och hashpinnad
MinIO/`mc` gav **exit 0** för faktisk syntetisk källdump → privat mål →
resync/cleanup → återläst slutbevis → hemlighetsfri kvittens. Mål-DB hade
fortfarande noll användarrelationer. Efter noll anslutningar togs exakt de
två nyskapade syntetiska databaserna bort och frånvaro verifierades; deras
testbytes är inte återställbara. Inga verkliga tävlingsdata, Eventor-anrop,
produktionscredentials, restore eller writer-release användes.

D1b.4 är fortfarande öppen. Nästa minsta vertikala del är D1b.4e: återställ
den redan kvitterade syntetiska dumpen till en **ny tom** isolerad PostgreSQL-
miljö och verifiera samma historiska PM-referens mot det bundna MinIO-målet.
Det är ännu inte operativ backup: verkligt tekniskt skrivstopp, exklusivt
produktionsägande av replikeringsregler, hållbar kvittens/operatörsflöde,
återstart efter alla fel och fysisk nät-/stationsacceptans återstår.

## 2026-09-23: TASK176 verklig syntetisk källfångst till en-store-cleanup

TASK176 använder nu `captureOperationalBackupSource` med faktisk privat
`pg_dump -Fc`, PostgreSQL17-migration-/PM-preflight och en enda korrekt
DB-refererad PM-version. Samma backup-id/manifesthash går vidare till ett
nytt privat TASK174-mål och TASK175:s enda regel/resync/cleanup-port.
Målbindning och 0600-credentialfil återläses och verifieras före anropet.
Efteråt krävs återläst `CLEANUP_VERIFIED`, oberoende nollregelläsning och
normal PM-målläsning av exakt DB-version. Den andra lagringsversionen på
samma nyckel fabriceras **inte** som en extra `pm_object_manifest`-rad.

Första nya opt-in-försöket gav **exit 1 före replikeringsregel** på målsteget
`BUCKET_CONFIGURATION`; dess käll- och målunderlag återanvändes inte. Kodens
HTTP-livstecken föregick tidigare enstaka S3-skrivningar utan autentiserad
S3-beredskapsgrind. En begränsad, läsande S3-kontroll infördes före första
bucket-skrivning, och felstegen skiljer nu beredskap, bucket-skapande och
versionering utan SDK-meddelande eller hemlighet. Detta är en hypotes om
den intermittenta starten, inte en uppmätt rotorsak eller driftacceptans.

Nytt backup-id, nytt privat MinIO-par och två nya testdatabaser gav
**opt-in exit 0** för hela källfångst→målbindning→replikering→cleanup-kedjan.
Den oberoende kontrollen efteråt visade **0 användarrelationer i mål-DB**;
ingen restore eller backupkvittens skapades. Infrastructure lint **exit 0**,
typecheck **exit 0**, riktade tester **3 filer, 18 passerade och 2 opt-in
överhoppade, exit 0**, build **exit 0**. Det riktiga opt-in-provet kördes
separat från de två överhoppade enhetstestfallen.

En separat PostgreSQL-process kunde inte initieras på värden på grund av
gränsen för delat minne; inga befintliga IPC-resurser ändrades. I stället
skapades fyra unikt namngivna tomma databaser på den lokala PostgreSQL17-
servern för de två försöken. Efter kontroll av ägare och **0 anslutningar**
togs exakt dessa fyra bort och frånvaro bekräftades; deras syntetiska bytes
kan inte återställas. Den tomma privata initdb-katalogen togs bort med
`rmdir`. Körningsunika privata MinIO-artefakter, inklusive felmålet, lämnades
orörda. Ingen riktig tävling, Eventortrafik eller produktionscredential.

D1b.4 är fortfarande öppen. Nästa minsta snitt är att koppla den bevisade
kedjan till application-lagrets fulla capture-ordning och kvittensgrind i
isolering. Faktiskt skrivstopp, exklusivt produktionsägande av källregler,
operatörs-CLI, restore, TLS och fältacceptans återstår.

## 2026-09-23: TASK175 en-store-replikering och kraschcleanup syntetiskt verifierade

En ny infrastructure-port håller ADR-0140:s ordning för **en** manifestbunden
PM-store: privat `REPLICATION_MAY_EXIST` före `mc replicate add`, explicit
resync, normal PM-läsning av varje historiskt `versionId` och cleanup innan
`CLEANUP_VERIFIED`. Den pinnade MinIO-servern avvisade borttagning av sin
sista regel med `--id`. ADR-0140 förtydligades därför **före** ändringen:
`--all --force` får användas endast efter färsk läsning som visar exakt en
egen regel med rätt ID, mål-bucket och `ExistingObjectReplication=Enabled`,
följt av ny läsning med noll regler. Annan regel ger säkert stopp; detta
jämför-och-rensa är inte produktionssäkert utan exklusivt ägande.

Ett nytt opt-in-prov med två hashpinnade lokala MinIO/`mc`-binärer, privat
syntetisk källa och nytt bundet mål gav **exit 0**: två exakta historiska
PM-versioner var läsbara efter cleanup och källan hade noll regler. Ett
separat opt-in-prov gav **exit 0** när en worker `SIGKILL`-stoppades direkt
efter sparad riskmarkör och lyckat regel-`add`: återhämtningen skrev
`CLEANUP_REQUIRED` → `CLEANUP_VERIFIED`, och oberoende läsning visade noll
källregler. I kraschfallet startades ingen resync och inga målversioner
hävdas. Båda proverna använder ett uttryckligen syntetiskt dumpfält, **inte**
verklig TASK172-källfångst eller PostgreSQL.

Efter sista kodändringen: infrastructure lint **exit 0**, typecheck **exit 0**,
build **exit 0**, paketets enhetstester med tillåten lokal loopback/Unix-
socket **20 testfiler, 450 passerade, 2 opt-in hoppades över, exit 0**.
Första enhetssviten i snäv sandlåda gav **exit 1**, 72 fel enbart på
`listen EPERM` för loopback/Unix-socket; samma svit passerade vid omkörning
med den nödvändiga lokala socketbehörigheten. Tidigare misslyckade privata
syntetiska försökskataloger har lämnats orörda som felsökningsunderlag;
ingen verklig tävlingsdata, Eventortrafik eller produktionscredential användes.

D1b.4 är fortfarande öppen: koppla porten till en **faktisk** TASK172-dump/
manifestkedja som nästa minsta snitt. Faktiskt skrivstopp, exklusivt
produktionsägande av källans replikeringsregler, kvittens, restore,
produktions-TLS/credentials och fysisk acceptans återstår. Ett intermittent
lokalt målstartsstopp är ännu inte förklarat.

## 2026-09-23: produktmålplanen förtydligad som sex avprickningsbara delar

`docs/product-goal-roadmap-2026-09-23.md` har nu en kort checklista som binder
samman arrangörssamarbete, individuell tävlingsdrift, öppna resultat,
deltagarkonto/följning, privata spår/GPS och formatbreddning. Varje del kräver
en sammanhängande användarresa och relevant fysisk/fältmässig acceptans innan
den bockas av; syntetiskt verifierade delsnitt redovisas fortsatt separat.
Planen anger första gemensamma mål som en individuell fältpilot, medan
MeOS-likvärdighet och nya tävlingsformer prövas ett konkret flöde/format i
taget. Ingen produktkod, migration, testdatabas eller extern tjänst ändrades
i denna planuppdatering. Inga kodtester kördes.

## 2026-09-23: TASK174 kraschgrind lokalt verifierad, ett intermittent stopp kvar

Privat målbindning v2 och den lokala pinnade MinIO-provisioneraren har nu ett
deterministiskt opt-in-prov där en egen Node-worker `SIGKILL`-avbryts efter
reservation respektive efter synkad bindning men före MinIO-start. Före
bindningen spärras samma backup-id; efter bindningen återstartas exakt bundet
dataområde och credentialfil. Privata synkade `started`/`ready`-markörer
hindrar tyst nyinitiering av ett tidigare redo mål och stänger en partiell
initiering säkert. Riktig lokal hashpinnad MinIO: **4/4 tester, exit 0**.

Efter sista kodändringen: infrastructure lint **exit 0**, typecheck **exit 0**,
riktade standardtester **6 passerade, 2 opt-in hoppade över**, build **exit 0**.
TASK172-source-capture→nytt TASK174-mål→TASK173 i två nya isolerade
PostgreSQL17/MinIO-kedjor gav först ett säkert stopp efter `started`-markören
utan målbevis och sedan en fullständig **exit 0** med nytt backup-id. Den
första orsaken är inte fastställd; lokal starttillförlitlighet är ett öppet
driftantagande, inte en godkänd produktionsgrind. Ingen regel/resync/restore
eller backupkvittens kördes i source-only-proven. Fyra exakt skapade
syntetiska databaser och tolv exakt identifierade privata testkataloger
kontrollerades utan processer/symlänkar, togs bort och bekräftades frånvarande;
de kan inte återställas. Ingen verklig tävling, produktionscredential eller
Eventortrafik användes.

TASK174:s lokala krasch-/reservationssnitt är därmed avprickat med denna
begränsning. Nästa minsta D1b-del är en privat, exakt ägd regel-/resync-/
cleanup-port enligt ADR-0140; full betrodd backup och fältacceptans saknas.

## 2026-09-23: Målplan för sex avprickningsbara produktdelar

Den aktuella [produktmålplanen](product-goal-roadmap-2026-09-23.md) skiljer nu
explicit på individuell pilot, deltagarprodukt och breddning per konkret
tävlingsform. Sex användarresor har egna fältgrindar; enhetsmatrisen skiljer
datorwebb, mobilwebb, Androidstation och Androiddeltagarapp. MeOS-likvärdighet
prövas per arbetsflöde, inte som ett generellt färdigpåstående. Detta är en
planändring, inte ny fältverifiering.

TASK174:s samtidigt redan påbörjade credential-bindningshårdning nådde privat
format v2 med filidentitet/hash och fail-closed avvisning av föräldralös
reservation. Riktade Vitest: 6 passerade; ett lokalt MinIO-opt-in-fall hoppades
över. ESLint, infrastructure typecheck och build: exit 0 enligt det avgränsade
arbetets kontroller. Abrupt krasch och omprov mot riktig pinnad MinIO återstår;
TASK174 är inte färdig och ingen regel/resync/kvittens har tillkommit.

## 2026-09-23: TASK174 privat målbindning och lokal provisionering delvis verifierade

TASK174 har först specificerats inom ADR-0140:s befintliga beslut och
produktmålplanens D1b.4c. En infrastructure-port skriver nu en separat
0600-bindning atomärt/write-once under kontrollerad 0700-katalog utanför
repository och återläser exakt backup-id, manifesthash, target-id,
canonical endpoint, store-/bucketkonfiguration och dataområdets
filidentitet. Den lagrar endast en credentialreferens, inte credentialen.
Återanvänt target-id/dataområde, fil-/katalogbyte och osäkra rättigheter
avvisas. Operation-state, manifest och kvittens ändrades inte.

En separat pinnad lokal loopback-provisionerare läser faktisk privat
operation-state, validerar TASK172:s källbevis före målsidoeffekter,
reserverar backup-id exklusivt, skapar ett eget 0700-dataområde och
separat syntetisk 0600-credentialfil, skriver bindningen före MinIO-start,
skapar/versionerar avsedda buckets och kör TASK173 med **återläst**
bindning. Kontrollerad återstart använder samma område och avvisar
upptagen endpoint, osäker credentialfil och förorenat mål.

Riktade standardprov: **6/6 passerade, ett opt-in-fall hoppades över**.
Opt-in mot riktig hashpinnad lokal MinIO: **3/3**, exit 0. Infrastructure
lint, typecheck och build: **exit 0** var för sig efter sista kodändringen.
`pgrep` fann ingen matchande MinIO-process efter proven. Endast 20 exakt
identifierade privata kataloger med syntetiska testdata/credentials
kontrollerades, togs bort och bekräftades frånvarande; de kan inte
återställas. Ingen PostgreSQL, verklig credential eller tävling användes i
just detta målprov, och ingen Eventortrafik gjordes.

Bindningsporten ensam bevisar fortfarande inte färskhet; den nya lokala
provisioneraren gör det inom sitt isolerade loopback-snitt. Ett separat
source-only-läge i TASK170:s härva körde därefter **verklig TASK172-
source-capture**, privat state och PostgreSQL17-dump mot syntetisk pinnad
MinIO-källa, följt av den enda nyprovisionerade målmiljön och TASK173:
**exit 0**, samma backup-id/hash/store-id/target-id. Det skapade ingen
regel, resync, restore eller kvittens. Det äldre TASK170-kompositprovet
regressionstestades separat efter härvans uppdelning: **exit 0**.
Fyra exakt skapade syntetiska testdatabaser hade noll anslutningar,
togs bort och bekräftades frånvarande. Fem för denna körning skapade
privata MinIO-/mc-kataloger kontrollerades efter processstopp, togs bort
och bekräftades frånvarande; deras data kan inte återställas. Tidigare
separata testkataloger lämnades orörda.

TASK174 är fortsatt öppen eftersom abrupt processkrasch före/efter
bindning inte är provad och macOS-loopback inte ger produktions-TLS/
isolering. Nästa minsta D1b-del är just krasch-/reservationacceptansen
med syntetiska data, utan ny regelstart, resync eller kvittens.

## 2026-09-23: TASK173 privat MinIO-målpreflight syntetiskt verifierad

TASK173 ger infrastructure en read-only, fail-closed målberedskapsport före
ADR-0140:s replikeringsregel. Den binder TASK172:s diskriminerade källbevis,
faktiskt läst privat `TARGET_PREPARATION_PENDING`-state, backup-id/hash,
store-/bucketkonfiguration och ett separat intyg om nytt exklusivt mål.
Porten kräver en enda annan målendpoint med exakt förväntade versionerade
buckets, inga aktuella/historiska objekt eller delete markers, inga
ofullständiga multipart uploads och ingen policy/replikeringsregel. Bara
SDK:ns exakta felkoder för saknad policy/regel räknas som frånvaro.
Utdata är endast `TARGET_READY_EVIDENCE`, inte en backupkvittens. Porten
skriver inte till MinIO.

Riktat infrastructure-stubbprov: 4/4 tester, exit 0. Infrastructure lint,
typecheck och build: exit 0 var för sig. TASK170:s opt-in-runner körde
porten **före** regelstart mot en ny hashpinnad lokal MinIO-målinstans och
fortsatte samma syntetiska PostgreSQL17/PostGIS-/PM-restore: exit 0. Två
exakt skapade syntetiska testdatabaser och tre privata MinIO-/mc-kataloger
kontrollerades utan anslutningar/processer, togs bort och bekräftades
frånvarande. Testdata kan inte återställas. Ingen riktig tävling,
produktionscredential eller Eventortrafik användes.

Målets färskhet/exklusivitet är fortfarande ett operatörsintyg, inte en
återstartsbar provisioneringsgaranti; negative äldre-version/delete-marker-
fall är stubbtäckta men inte fysiskt provade i MinIO. Nästa minsta D1b.4c-
del är privat målprovisionering och 0600-recovery-bindning till backup-id.
Regelstart/resync, cleanup, faktiskt skrivstopp, operativ kvittens och
internet-/fältacceptans återstår. Se TASK173 och målplanen.

## 2026-09-23: TASK172 källsides-capture syntetiskt verifierad

TASK172 kopplar application-ordningen till en verklig privat statefil,
TASK171:s `pg_dump -Fc`, en skrivskyddad PostgreSQL-snapshot och exakt
versionsbunden PM-läsning från pinnad lokal MinIO. Run-intent avvisas före
I/O om skrivstoppsintygandet saknas. `DUMP_PENDING` skrivs före dumpbytes;
`TARGET_PREPARATION_PENDING` med samma manifesthash och store-id:n skrivs
först efter källpreflight. Den fasen betyder att målpreparering väntar,
inte att ett mål skapats. Källbeviset har en egen `SOURCE_CAPTURE_EVIDENCE`-
diskriminant; den fulla capturevägen gör fortfarande slutkvittens först
efter verifierad målcleanup. TASK170:s opt-in-runner använder nu denna
source-only-väg och återställer samma dump och historiska PM-version till
ett nytt tomt syntetiskt PostgreSQL/PostGIS-mål.

Slutkontroller: application capture 8/8 tester, infrastructure state-/
dump-/recorderkomposition 11/11. Lint, typecheck och build för application
och infrastructure gav alla exit 0 efter sista kodändringen. Ett slutligt
opt-in-kompositprov mot ny isolerad PostgreSQL17/MinIO-kedja gav exit 0;
även ett tidigare prov före sista typdiskriminanten gav exit 0. Fyra
exakt skapade syntetiska databaser och sex körningsunika privata MinIO-/mc-
kataloger kontrollerades utan aktiva anslutningar/processer och togs bort.
De syntetiska testdata kan inte återställas. Ingen riktig tävling,
produktionscredential eller Eventor-nyckel användes.

D1b.4 är fortfarande inte en operativ backup: tekniskt skrivlås, garanterad
bindning mellan framtida drift-DB-läsning och dumpanslutning, privat
målpreflight, resync/regler, återstartbar cleanup, restore-CLI och fysisk
internetacceptans återstår. Nästa minsta D1b-del är en privat fail-closed
preflight av en **ny tom versionerad MinIO-målmiljö**, utan replikering eller
kvittens. Se TASK172 och målplanen.

## 2026-09-23: TASK171 privat PostgreSQL-dumpport syntetiskt verifierad

TASK171 ger infrastructure en explicit, enanvändnings `pg_dump -Fc`-port för
ADR-0140:s framtida betrodda backupkedja. Den tar separat anslutning och
absolut verktygsväg, reserverar en ny privat 0600-fil först efter
`DUMP_PENDING`, synkar och mäter samma fil. Fel ger inget godkänt dumpbevis;
ingen implicit `DATABASE_URL`, befintligt backupmål eller credential i argv
används. Den befintliga TASK170-runnern använder nu porten för sin verkliga
syntetiska dump och återställer just den filen med `pg_restore` tillsammans
med exakt historisk PM-version i isolerad MinIO. Den verkliga runnern är
fortfarande testägd, inte ett operativt capture-/restorekommando.

Riktat portprov: **6/6** tester, exit 0. Infrastructure lint, typecheck och
build: exit 0 var för sig. Slutligt opt-in-kompositprov mot nya tomma
PostgreSQL17/PostGIS-källa och -mål: **exit 0**. De två första försöken gav
exit 1 före restore: macOS `/var` var inte en kanonisk privat katalog och
Homebrews `pg_dump --version` hade ett versionssuffix. Testharness respektive
versionsparser rättades; varje nytt försök fick ett nytt tomt databaspar.
Alla sex exakt skapade syntetiska databaser och nio körningsunika privata
MinIO-/mc-kataloger kontrollerades utan aktiva anslutningar/processer och
togs bort. De innehöll bara syntetiska testdata och kan inte återställas.
Ingen riktig tävling, Eventor-nyckel, produktionscredential eller
fältmiljö användes.

D1b.4 är **påbörjad men inte klar**. Nästa minsta del enligt målplanen är
en betrodd källsides-sammansättning av operatörens explicita skrivstopp,
TASK140:s privata state, TASK171:s dump och TASK134:s migrations-/PM-
preflight för samma backup-id, utan MinIO-mål eller kvittens. Därefter
återstår versionerad mål-/regelhantering, återstart/cleanup, restore och
fysisk internet-/fältacceptans.

## 2026-09-23: TASK170 gemensamt syntetiskt PM-/PostgreSQL-bevis

TASK170:s opt-in-runner binder nu käll-DB:ns PM-manifest till den **första
historiska** versionen av ett verkligt MinIO-objekt innan replikeringen
startar. Efter pinnad `existing-objects`-resync, bekräftad regelrensning och
läsning genom vanlig PM-store tas en riktig privat `pg_dump -Fc`. Samma
uppmätta fil återställs med `pg_restore` till ett nytt tomt PostgreSQL17/
PostGIS-mål, utan migration eller seed efteråt. `verifyOperationalRestore`
läser med den riktiga `createOperationalBackupPmVerifier` från MinIO-målet
före läsande databashistorik. Målet bevarade 1 event, 1 anmälan, 1 exakt
PM-referens och 1 finalisering. Ingen ny ADR behövdes; ADR-0140:s
lagrings- och konsistensgräns ändrades inte.

Slutligt opt-in-kompositprov: **exit 0**, en sammansatt syntetisk kedja och
tre förväntade negativa verifieringar inom samma körning: saknad målversion
gav `PM_OBJECT_VERIFICATION_FAILED`, nyare men fel databasversion gav
`PM_REFERENCE_MISMATCH`, och ändrad dumphash gav
`POSTGRES_DUMP_VERIFICATION_FAILED`. Ett separat nytt käll-/målpar med en
markörtavla i målet avvisades före migration/MinIO/restore med avsiktlig
**exit 1**, `TASK170_DATABASE_NOT_EMPTY`; källan förblev tom och målet hade
bara markörtavlan. Efter sista kodändringen gav infrastructure lint,
typecheck och build var för sig exit 0. Ingen bred workspace-testsvit kördes.
Den äldre fristående pinnade MinIO-runnern passerade också efter
fixturutbrytningen (en opt-in-körning, exit 0).

De första två opt-in-försöken avbröts på testfixturens PM-nyckelkoppling
respektive ett extra fält till den strikta dumpmätaren; båda rättades och
nya tomma databaspar användes för varje omkörning. Alla åtta exakt skapade
syntetiska databaser kontrollerades utan anslutningar, togs bort och
bekräftades frånvarande. De nio körningsunika privata MinIO-/mc-katalogerna
kontrollerades utan levande processer och togs bort; de innehöll bara
syntetiska testobjekt/loggar och kan inte återställas. Den privata
binärkatalogen behölls. Även tre körningsunika privata kataloger från den
fristående regressionen togs bort efter kontroll av stoppade processer.
Inga riktiga tävlingar, credentials, Eventoranrop,
GPS-, USB- eller stafettfunktioner användes. Det saknas fortfarande en
betrodd, återstartsbar backupwriter, faktiskt operativt skrivstopp och
internet-/fältacceptans. Se TASK170 och den aktuella målplanens D1b.4–5.

## 2026-09-23: målplanen konkretiserad och TASK137 pinnat delbevis verifierat

`docs/product-goal-roadmap-2026-09-23.md` anger nu D1b som fem separata
stoppunkter: objekthistorik, databashistorik, gemensamt versionsbevis,
körbar betrodd backup/restore och fysisk internet-/återställningsövning.
TASK170 är specificerad som nästa minsta D1b-snitt, inte implementerad.
Detta förtydligar vägen mot en individuell fältpilot utan att kalla ett
syntetiskt delprov för färdig drift.

TASK137:s två-MinIO-runner kördes med exakt SHA-256-matchande, pinnade
MinIO-/`mc`-binärer i nya privata loopbackinstanser. Ett första försök
stoppade säkert före regeländring: den pinnade `mc` returnerade felkod vid
tom regelkonfiguration. Runnerns tomhetskontroll använder nu MinIO-SDK och
godtar enbart exakt `ReplicationConfigurationNotFoundError`; övriga fel
avvisas. Slutkörningen gav **exit 0** för en opt-in-runner: två historiska
syntetiska PM-versioner förblev exakt läsbara efter resync och bekräftad
regelrensning. Infrastructure lint, typecheck och build gav alla exit 0
efter ändringen. Ingen databas, riktig tävling, produktionscredential eller
driftadapter användes i TASK137. TASK169:s separata PostgreSQL-rundtur är
fortsatt ett eget delbevis; sammansättningen i TASK170 återstår. De sex
körningsunika privata MinIO-/mc-katalogerna från det stoppade första försöket
och den gröna körningen kontrollerades och togs bort; de innehöll enbart
syntetiska testobjekt/loggar och kan inte återställas. Den separata privata
binärkatalogen med hashverifierade arkiv behölls för nästa opt-in-prov.

## 2026-09-23: TASK169 faktisk syntetisk PostgreSQL-rundtur

Den befintliga läsande restoreverifieraren har nu provats efter en verklig
`pg_dump -Fc` och `pg_restore` mellan två nya, tomma och separat namngivna
syntetiska PostgreSQL/PostGIS-databaser. Provet kräver opt-in-URL:er med
TASK169-prefix, loopback och en explicit katalog med matchande PostgreSQL-
verktyg; `PATH`-verktygen 16.15 användes inte mot server 17.11. Källans unika
event- och anmälnings-ID fanns i målet efter restore, och läsande verifiering
godkände migrationsidentitet, PostGIS, PM-referens och historikkedja utan
target-migration eller target-seed. Extra målläsning gav 1 event, 1 anmälan,
1 PM-referens och 1 finalisering.

Riktat application-integrationsprov: 1 fil, **3/3 tester**, exit 0. Riktad
ESLint och application-typecheck efter sista teständringen: exit 0 vardera;
application-build: exit 0. Testets privata dumpkatalog togs bort, och de två
exakta syntetiska databaserna togs bort efter kontroll av noll anslutningar.
Ett separat avsiktligt avvisat prov med en markörtavla i ett nytt syntetiskt
mål gav exit 1 med `TASK169_DATABASE_NOT_EMPTY` (1 avvisat, 2 överhoppade);
efteråt fanns bara markörtavlan och inga återställda O-Tid-tabeller i målet.
Även detta exakta syntetiska käll-/målpar togs bort efter kontroll.
Ingen befintlig tävlings-/demodatabas, riktig credential eller Eventor-data
användes. Detta är ett PostgreSQL-delbevis, inte en körbar samordnad
backup/restore: PM-verifierarporten var syntetisk, MinIO-versioner,
produktionscredential, faktiskt skrivstopp och en betrodd CLI återstår.
Se TASK169.

## 2026-09-23: TASK168 återställ filtrerad publik resultatlista

Offentlig resultatvy visar nu ett begripligt tomläge och en knapp som rensar
sökning, klass och favorit-/följningsfilter när publicerade resultat finns men
ett aktivt filter ger noll träffar. En från början tom publicerad lista behåller
sitt separata vänteläge utan återställningsknapp. Ändringen berör endast lokalt
UI-tillstånd och svensk text; sparade favoriter, kontoföljningar, API och
resultatdata ändras inte.

Luna-agentens riktade webbprov: 1 fil, 11/11 tester; web-lint, web-typecheck
och web-build exit 0 efter sista kodändringen. Huvudagenten körde samma
riktade Vitest igen: 1 fil, 11/11, exit 0. Provet täcker filterpredikat och
komponentens återställningskoppling men inte ett faktiskt knapptryck i
browser eller fysisk mobil. Ingen PostgreSQL, Eventorcredential eller riktig
tävling användes. Se TASK168.

## 2026-09-23: TASK167 betalning att kontrollera i privat roster

`/manage` har nu ett kompakt filter och antal för anmälningar med
`UNMARKED` eller `UNPAID` betalstatus. Texten skiljer omarkerad från bevisat
obetald. Urvalet kombineras med befintlig sökning och andra filter; när en
rad väljs öppnas TASK142:s redan befintliga enskilda betalformulär. Avmarkering
återger hela listan, och ett uppdaterat roster utan sådana poster har ett
specifikt tomläge. Ingen ny API-, journal-, domän- eller behörighetsgräns.

Kontroller: webb-lint exit 0, webb-typecheck exit 0, e2e-lint exit 0,
e2e-typecheck exit 0, riktat filterprov 3/3, en riktig Next-browser med
syntetiska API-svar på 390/1280 px 1/1, checkin-shell-bygge exit 0 och
Next-produktionsbygge exit 0. Första browseruppsättningen pekade sin
hälsokontroll på en databaskrävande startsida och avbröts; efter korrigering
nådde provet filtret men hade ett felaktigt knappnamn. Den slutliga
oförändrade produktvägen passerade efter att testselektorn rättats.
Browserprovet bevisar UI men inte serverauktorisering, samtidighetskonflikt
eller fysisk mobil; TASK142:s writer ändrades inte och dess större
PostgreSQL-svit kördes inte om.

## 2026-09-23: TASK166 binder läst dump före restorebevis

ADR-0140:s redan beslutade dumpbevis är nu obligatoriskt i den läsande
restoreorkestreringen. Application jämför uppmätt rå identitet, SHA-256 och
byte-längd mot det stricta manifestet innan en enda PM-version eller
databasrad kontrolleras. Avvikelse, ogiltigt bevis eller läsfel ger samma
hemlighetsfria `POSTGRES_DUMP_VERIFICATION_FAILED`. Befintliga PM- och
databasfel och manifesthashen behålls. TASK148:s verkliga strömmätare
prövades i sammansättning med syntetiska bytes. Ingen dump skapades,
återställdes eller öppnades från fil; ingen credential eller riktig
tävlingdata användes. Detta bevisar inte att måldatabasen återställdes från
just de lästa bytesen.

Riktad application-/infrastructure-lint, typecheck och build: alla exit 0.
Riktade enhets-/sammansättningsprov: 2 filer, 13/13 godkända. Vid första
försöket stoppade ny isolerad `initdb` på macOS delat minne (`Operation not
permitted`, och med upphöjd behörighet `No space left on device` för SysV-shm).
Det anpassade PostgreSQL-integrationsfallet kördes därefter mot en **ny tom
syntetisk testdatabas** i en redan körande lokal PostgreSQL 17.11: 1 fil,
1/1 test, exit 0. Databasen hade noll aktiva anslutningar och togs bort efter
provet; inga befintliga tävlings-/demodatabaser eller delat-minne-segment
ändrades. Detta verifierar inte en verklig dump/restore. Se TASK166.

## 2026-09-23: TASK149 publik ruttdelning syntetiskt verifierad

TASK149:s redan publika deltagarrutt och två-/treruttsjämförelse har nu
exakt delbar URL och svensk, neutral återkoppling. Delningsytan på
deltagarrutten visas bara när den aktuella rutten faktiskt är tillgänglig;
en indragen/404-rutt annonseras inte som delbar. URL-hjälparen avvisar även
backslash-väg som annars kunde byta origin. Ingen servermodell, dataåtkomst
eller ADR ändrades. Isolerad syntetisk PostgreSQL/PostGIS användes i
browserprovet, inte riktig tävling eller Eventorcredential.

Verifiering: webb-lint exit 0, e2e-lint exit 0, webb-typecheck exit 0,
e2e-typecheck exit 0, hjälparprov 3/3, riktat browserprov 3/3,
checkin-shell-bygge exit 0 och Next-produktionsbygge exit 0. Första
browserförsöket fick 1/3 på grund av för bred testselektor; den rättades
och samma tre fall passerade. Ett direkt Next-bygge utan paketets normala
`npm_lifecycle_event=build` stoppade vid förväntad `DATABASE_URL`-grind;
omkörning med rätt byggmarkör passerade. Verklig mobil/Web Share-dialog,
clipboardbehörighet och tävlingsdrift är fortfarande oprövade.

## 2026-09-23: ordningskonflikt inför C1b

Efter TASK165 pekade produktplanens arbetskö på C1b som nästa minsta
Androidsnitt. TASK158 säger däremot uttryckligen att C1a:s nativeverifiering
ska slutföras **före** C1b:s konto- och anmälningsbeslut; samma plan säger
även detta i C1-avsnittet. C1a är ännu inte native- eller fältverifierad.
Ingen C1b-implementation eller nytt authbeslut får därför påbörjas bara
utifrån arbetsköns formulering. Nuvarande kontroll av värden visar ingen
`ANDROID_HOME`, `ANDROID_SDK_ROOT` eller `JAVA_HOME`, ingen standard-Java
via `/usr/libexec/java_home` och ingen SDK i användarens vanliga Android-
katalog eller `/opt/homebrew/share/android-sdk`. Licens har inte godkänts
automatiskt. Fortsatt granskning av C1a:s verifieringsgrind och tillgänglig
verktygskedja görs utan att anta SDK-licensbeslut.

## 2026-09-23: TASK165/C3d vald publicerad kontrolltid i privat GPX

ADR-0158 och TASK165 avgränsades före kod. Den kontoskyddade privata
overlayen behåller formatversion 4 och samma API. När aktuell resultatstart
och publicerade kontrolltider har samma revision kan deltagaren välja en
kontrollkod/förekomst och visa dess **tidpunkt** på den manuellt justerade
GPX-tidslinjen. Kontraktet avvisar revisionsmismatch och dubbla valnycklar.
Hoppet pausar uppspelningen och ändrar bara sidtillstånd; resultatets split,
GPX-punkter, offset och server ändras inte. Utanförliggande tid klampas
inte. I ett GPX-segmentbrott kan tidslinjen sökas men ingen kartmarkör
interpoleras. UI säger uttryckligen att detta inte är en GPS-verifierad
kontrollpassage. Ingen migration, writer, ny behörighet eller publicering.

Riktade enhetsprov med lokalt installerade binärer: **7 filer, 31/31 tester**.
Application mot separat isolerad syntetisk PostgreSQL17: **1/1** med exakt
entry/kurs, aktuell revision, MP/saknad split och återkallad koppling.
Ett 390px-browserprov mot riktig Next/HTTP och egen syntetisk underdatabas:
**1/1** med kontrollval, klockförskjutning, hopp, utanför-läge, saknad
GPX-tid, segmentlucka och utan horisontell scroll. Endast kartbildens
bytes simulerades. Berörd ESLint och TypeScript-kontroll för contracts,
application, web och e2e: exit 0. Contracts-/application-build,
`build:checkin` och Next-produktionsbuild: exit 0. `pnpm`-wrappern
försökte nå registry och gav `ENOTFOUND`; de kommandona räknas inte som
gröna. Ingen bred workspace-svit, riktig tävling, Eventor, fysisk mobil
eller GPS-inspelning användes. Inga browser-/integrationsdatabaser
lämnades kvar. Den egna PostgreSQL-instansen stoppades och dess exakta
syntetiska tempkatalog (78 MB) raderades; den kan inte återställas.

Kvarvarande antaganden: resultattider kan ändras och en öppen vy är en
ögonblicksbild tills den läses om; verkligt klockfel, kartprecision,
objektlagring, GNSS och mobilbeteende är inte fältverifierade. Den då
föreslagna C1b-fortsättningen korrigeras av ordningsgrinden ovan:
TASK158/C1a måste nativeverifieras först. Ingen GPS-inspelning eller synk
läggs till av TASK165.

## 2026-09-23: TASK164/C3c manuell GPX-klockjustering mot resultatstart

ADR-0157 och TASK164 avgränsades före kod. Den kontoskyddade privata
overlayen är nu formatversion 4 och visar en strikt aktuell publicerad
resultatstart för samma anmälan och historiska bana, eller `UNAVAILABLE`.
Endast OK eller teknisk MP med faktiskt giltig start ger tillgänglig tid;
ingen äldre revision används som fallback. Deltagaren kan i den egna vyn
ange en tillfällig klockförskjutning ±86 400 sekunder och hoppa till
resultatstarten när den ligger inom den oförändrade GPX-tidsserien. UI
skiljer GPX-klockan från resultatklockan och kallar inte GPS-positionen
en verifierad start eller kontrollpassage. Ingen writer, migration,
publicering, ny behörighet eller ny resultatregel infördes.

Riktade enhetsprov med installerade lokala binärer: **6 filer, 24/24
tester**. Application mot egen isolerad syntetisk PostgreSQL17: **1/1**
med revisionsväxling, MP/saknad start och revokerad deltagarkoppling.
Riktigt 390px-browserprov mot Next/HTTP och egen syntetisk underdatabas:
**1/1** inklusive manuell offset, hopp, utanför-läge och saknad GPX-tid.
Kartbildens bytes simulerades. Berörd ESLint och TypeScript-kontroll för
contracts, application, web och e2e: exit 0. Contracts- och application-
build, `build:checkin` och Next-produktionsbuild: exit 0. Ett första
Next-buildanrop använde fel binärväg och gav exit 127; korrekt anrop gav
exit 0. `pnpm`-wrappern försökte nätverkshämtning och räknas inte som
grön. Ingen bred workspace-svit, riktig tävling, Eventor, fysisk mobil
eller GPS-inspelning användes. Browser- och integrationsproven lämnade inga
egna testdatabaser kvar. TASK164:s separata PostgreSQL-instans stoppades
och dess exakta syntetiska tempkatalog (78 MB) raderades; den kan inte
återställas. Ingen annan PostgreSQL-instans berördes.

Kvarvarande antaganden: resultatets publicerade start kan ändras och
visas först uppdaterad efter ny läsning av vyn; GPX-/resultatklockornas
verkliga fel, kartprecision, objektlagring och fysisk mobil är inte
fältverifierade. Nästa minsta C3-uppgift är ett eget ADR/TASK för att
välja **en** publicerad kontrolltid och visa motsvarande tidpunkt på
den manuellt justerade privata GPX-tidslinjen, aldrig en påstådd
GPS-kontrollpassage.

## 2026-09-23: TASK163/C3b publicerade sträcktider vid egen privat rutt

ADR-0156 och TASK163 avgränsades före kod. Den kontoskyddade privata
overlayen är nu formatversion 3 och visar i en separat, kompakt lista
resultatets aktuellt publicerade kontrollkod, förekomst, sträcktid,
ackumulerade tid och revision. Samma exakta anmälan och historiska bana
krävs. `OK` med befintliga tider ger `AVAILABLE`; MP/saknad tid ger
`UNAVAILABLE`, utan äldre fallback eller GPS-gissning. UI anger att även
publicerade tider kan vara preliminära och att GPX-markören inte verifierar
kontrollpassage. Inga nya resultatregler, migrationer, skrivvägar,
publiceringsvägar eller behörigheter infördes.

Slutkontroller med installerade lokala binärer: riktade kontrakts-/webbprov
**5 filer, 19/19 tester**; application mot ny isolerad PostgreSQL17 **1/1**
med effektiv revisionsväxling, MP och revokerad deltagarkoppling; riktigt
390px-browserprov med HTTP/syntetisk PostgreSQL **1/1**. Berörd ESLint och
typecheck för contracts, application, web och e2e exit 0. Contracts- och
application-build, `build:checkin` och Next-produktionsbuild exit 0.
Ingen bred workspace-svit, fysisk mobil eller fälttävling kördes. `pnpm`-
wrappern försökte nå registry, så den räknas inte som grön; lokala binärer
gav resultaten ovan. Första `initdb` stoppades i sandbox på delat minne,
andra försöket nådde macOS:s 32-segmentsgräns. Endast det identifierade
oanslutna 56-byte-segmentet från vårt eget misslyckade försök rensades,
varefter den separata syntetiska PostgreSQL-instansen startade. Den andra
redan körande PostgreSQL-instansen berördes inte. TASK163-instansen
stoppades efter proven och dess exakta syntetiska tempkatalog raderades;
den kan inte återställas.

Kvarvarande antaganden: verkliga GPX- och resultatklockor kan skilja sig;
kartprecision, objektlagring, fysisk mobil, internetdrift och GNSS är inte
fältverifierade. Nästa minsta C3-uppgift är ett ADR/TASK för manuell
tidsförskjutning av egen GPX-uppspelning mot ett verifierat startunderlag,
utan att förvanska original eller påstå GPS-kontrollpassager.

## 2026-09-23: TASK162/C3a privat relativ GPX-uppspelning

ADR-0155 och TASK162 avgränsades före kod. Deltagaren kan nu i sin
behörighets- och versionsbundna privata ruttvy spela/pausa, börja om och
välja relativ uppmätt GPX-tid. Overlay-kontraktets formatversion 2 kräver
komplett monoton tidsserie för `AVAILABLE`; annars visas rutten med ett
tydligt besked om att uppspelning saknas. Projektionen skickar endast
pixelpunkter och relativ tid, aldrig råkoordinater. Markören hoppar inte
över segmentbrott. Saknad kartbild stänger uppspelningskontrollerna.

Riktade kontrakts-/webbprov: **4 filer, 16/16 tester**. Application mot ny
isolerad PostgreSQL17: **1/1**. Riktigt 390px-browserprov med HTTP och
syntetisk PostgreSQL: **1/1**, även efter sista kodändringen; inga
browserunderdatabaser lämnades kvar. Den särskilda testinstansen stoppades
och dess syntetiska tempkatalog raderades efter proven; den kan inte
återställas. Berörd ESLint och typecheck för
contracts, application, web och e2e gav exit 0. Contracts/application
TypeScript-build, `build:checkin` och Next-produktionsbuild gav exit 0.
Ett första browserförsök i snäv sandbox gav `EPERM` när `tsx` skulle öppna
en lokal Unix-socket; samma prov i tillåten isolerad loopbackmiljö passerade.
Ingen bred workspace-svit kördes. Inga riktiga tävlingsdata, Eventor-anrop,
kart-/objektlagringsacceptans eller mobil-GPS användes.

C1a/TASK158 är fortsatt kodad men inte native- eller fältverifierad:
hashverifierad temporär JDK21 finns, medan Android SDK36/licensbeslut och
fysisk enhet saknas. Ingen Androidlicens accepterades automatiskt.
Kvarvarande antaganden för C3a är att riktig GPX-källa ger korrekta tider,
egen kartgeoreferens håller i fält och att den valda telefonens webbläsare
fungerar operativt. Nästa minsta oberoende C3-uppgift är en separat, läsande
visning av redan officiellt uppmätta sträcktider bredvid egen rutt, utan
påstående om att GPX-positionen markerar kontrollpassage.

## 2026-09-23: TASK161/A3c betrodd lösenordsåterställning

ADR-0154 och TASK161 avgränsades före kod. En betrodd serveroperatör kan
efter manuell identitetsattest utfärda en 24-timmars engångskod till exakt
befintligt konto-ID + inloggningsnamn via privat 0600-manifest. `retry`,
`status` och spärr finns i samma begränsade CLI. Mottagaren skapar och sparar
ett eget lösenord i svensk `/recover`-vy. Inlösen appenderar en verifierare
och immutable journal i samma transaktion; gamla sessioner blir ogiltiga,
medan eventgrants och anmälningskopplingar består. Event-OWNER/ADMIN får
inte global återställningsrätt och ingen auto-login, e-post/SMS eller
självbetjänt utfärdning har lagts till. Migration0084 är additiv.

Riktade slutprov med installerade lokala binärer: kontrakt/databasschema/
HTTP-route/komponent **14/14 i fyra filer**, application mot ny isolerad
PostgreSQL17 **2/2**, riktigt 390px-browserfall med HTTP och separat
syntetisk PostgreSQL-underdatabas **1/1**. Berörd ESLint och typecheck för
contracts, database, application, web och script passerade; e2e-TS/ESLint
passerade. E2E-ESLint kräver sin separata tsconfig-parser; ett kombinerat
lintanrop gav därför två konfigurationsfel, och de två riktiga separata
lintanropen gav exit 0. Contracts/database/application-build och web `build:checkin` +
Next-produktionsbuild passerade. Ett separat CLI-röktest i samma isolerade
syntetiska DB verifierade `issue`, exakt `retry` till samma recovery-ID,
`status=PENDING`, `revoke=REVOKED` och ny privat fils läge 0600 utan att
skriva koden till terminalen. Direkt `next build` utan `npm_lifecycle_event`
stoppade först på avsiktlig build-time DB-guard; normal build-miljö med
`npm_lifecycle_event=build` passerade. Ett första browserförsök stoppades av
Playwrights ESM-import av migratorn; testharnessen justerades till projektets
befintliga migreringsmönster och slutprovet passerade. `pnpm`-wrappern
försökte nätverksinstallera och stoppades på DNS; dess kommando räknas inte
som grönt. Inga riktiga konton, tävlingar eller Eventor-anrop användes.
Den särskilda PostgreSQL-instansen och den syntetiska privata kodfilen
stoppades/raderades efter proven; de kan inte återställas och behövs inte.

Återstående antaganden/gränser: operatören kan faktiskt verifiera identitet
utanför O-Tid och överlämna koden privat; produktionens TLS, yttre
trafikbegränsning, drift/restore och fysisk mobil är inte prövade. Detta
är syntetisk A3c-verifiering, inte färdig kontoinförande- eller tävlingsprodukt.
Nästa minsta A3-uppgift är ett avgränsat fältprov av **en** privat
kodöverlämning och återställning på fysisk mobil i en särskilt vald
testinstallation, utan verkliga tävlingsdata.

## 2026-09-23: TASK160/A3b ägarstyrd kontoinbjudan

ADR-0153 fastställde före kod att en kontokod **inte** är ett eventgrant.
Aktiv OWNER kan nu i ”Medadministratörer” skapa en 24-timmars engångskod
för ett nytt konto, se begränsad status och spärra en väntande kod. Browsern
skapar koden med Web Crypto och sänder bara SHA-256; servern kan inte visa
klartexten igen. Mottagaren aktiverar oförändrat konto via A3a. Först ett
separat, uttryckligt A2-beslut ger ADMIN. Migration0083 binder issue/spärr
atomiskt och immutable till event och aktör; ingen äldre grant ändras.

Ny isolerad PostgreSQL17/PostGIS migrerades. Fyra riktade testfiler gav
13/13 gröna kontrakts-/schema-/HTTP-/UI-tester, applicationintegration
1/1 och riktigt 390 px HTTP/PostgreSQL-browserflöde 1/1. Berörd lint,
typecheck och contracts/database/application/web-build passerade med lokala
binärer. Första Next-build utan obligatorisk `DATABASE_URL` stoppade som
väntat; omkörning med okontaktbar byggtids-URL passerade. Pnpm-wrappern
försökte nå registry och gav DNS-fel; inget pnpm-påstående räknas grönt.
Browserns första riktiga körning föll på en tvetydig testselektor, som
rättades; slutversionen är grön. Temporär databas/fixture är borttagen.

Återstår: verklig privat kodöverlämning/identitetskontroll, fysisk mobil,
produktions-TLS, kontorecovery (A3c) och fältacceptans. Ingen automatisk
ADMIN- eller anmälningskoppling, e-post, SMS eller självregistrering finns.
A3 är fortsatt öppen; TASK160 är en syntetiskt verifierad delresa.

## 2026-09-23: dokumentkonflikt inför nästa kontosnitt

`TASK_159_TRUSTED_ACCOUNT_ACTIVATION.md` och
`docs/product-goal-roadmap-2026-09-23.md` kallar ägarstyrd inbjudan A3b
och kontorecovery A3c. `docs/adr/ADR-0152-trusted-account-invitation-activation.md`
kallar däremot självtjänståterställning A3b i ett stycke. Detta är en
namngivningskonflikt, inte tillstånd att blanda inbjudan och återställning.
Ingen ny kontobehörighet får implementeras på grundval av den otydligheten.
ADR-0153 ska uttryckligen fastställa snitt, ordning och gräns innan kod.
ADR-0153 är nu accepterad: A3b betyder ägarstyrd kontoinbjudan, A3c
separat recovery. Inbjudan ger inget ADMIN automatiskt; A2:s explicita
OWNER-grant efter kontoaktivering är behörighetsgränsen. TASK160 avgränsar
implementeringen. Den äldre formuleringen i ADR-0152 gäller inte som
arbetsordning för senare snitt.

## 2026-09-23: TASK159/A3a betrodd inbjudan och kontoaktivering

ADR-0152 skrevs före kod. Migration 0082, append-only journaler och
beständig gissningsspärr, betrodd CLI med ny privat 0600-fil och exakt retry,
generisk onlineaktivering på `/api/account/activation` samt svensk
`/activate` finns. Mottagaren skapar sitt eget lösenord; aktivering ger
ingen session, eventgrant eller anmälningskoppling.

Riktat resultat: kontrakt 4/4, databasschema 3/3, application mot ny
isolerad PostgreSQL17 3/3, web-route 3/3, komponent 4/4,
browser med avlyssnat API 2/2 (390/1280 px) och riktigt HTTP/PostgreSQL-
browserflöde 1/1 (390 px aktivering → befintlig login). CLI-utfärdning,
0600-fil och exakt retry provades också mot separat migrerad syntetisk DB.
Berörd lint/typecheck och contracts/database/application/web-build passerade
med lokala binärer. Pnpm-wrappern försökte hämta registry-metadata och gav
`ENOTFOUND`; därför är pnpm-kommandot inte ett grönt verifieringspåstående.
Ingen produktions-TLS, verklig överlämning, fysisk mobil, e-postleverans,
självregistrering, ägarstyrd inbjudan eller recovery har verifierats. A3
som helhet är fortsatt öppen.

## TASK148: läsande PostgreSQL-dumpbevis utan dumpkörning

TASK148 fyller en liten, redan ADR-0140-täckt lucka i den operativa
backupkedjan. Infrastrukturadaptern förbrukar enbart en redan given privat
byte-ström och utfärdar det befintliga strikta dumpbeviset: en opak identitet,
uppmätt SHA-256 och byte-längd. Dess indata är strikt begränsad till identitet,
asynkron byte-ström och eventuellt förväntat bevis; sökväg och extra fält
avvisas. Tomma, felaktiga, ändrade eller avbrutna strömmar ger ett enda
hemlighetsfritt fel utan att exponera byte, källa, sökväg eller felorsak.

Contracts lint/typecheck samt infrastructure lint/typecheck/build passerade.
Det riktade infrastrukturfallet passerade 1 fil/3 tester med enbart
syntetiska minnesströmmar. Ingen fil öppnades, ingen `pg_dump`, databas,
MinIO, manifestskrivning, credential eller drifttrafik användes. Detta är
endast mätning av en redan lämnad ström, inte en fungerande backup eller
restore.

## TASK147: sammanhållen skrivskyddad restoreverifiering

TASK147 genomför ADR-0140:s redan beslutade läsordning utan att göra backup
eller restore körbar. Den nya applicationorkestreringen verifierar först varje
manifestbunden PM-version med exakt store, key, originalversion, hash och
längd genom en injicerad port. Först när samtliga objekt bevisats läser den
befintlig PostgreSQL/PostGIS-verifiering migrationsidentitet, PM-referenser och
minsta tävlingshistorik i en `REPEATABLE READ, READ ONLY`-transaktion.
Felaktigt objekt avvisas före databaskontroll; kvittensen är hemlighetsfri och
innehåller bara manifesthash, objektantal och redan offentlighetsgranskad
databasbevisning.

Application lint/typecheck/build passerade. Rena tester passerade 5/5 och
isolerat PostgreSQL17/PostGIS-prov 1/1 med enbart syntetiskt underlag. Ingen
dump, MinIO, `mc`, credential, objektwrite, restoreprocess, migration eller
produktionstrafik kördes. Detta är inte ett påstående om färdig backup eller
återställning.

## TASK146: publik jämförelse av upp till tre deltagarrutter

ADR-0143 och TASK146 utökar den redan strikta offentliga eftertävlingsvyn
från två till högst tre publicerade GPX-rutter. Två-ruttslänkar fortsätter
att få formatversion 2; ett uttryckligt tredje, unikt resultat ger
formatversion 3. Alla val måste passera samma race-lås, release-, samtyckes-,
historiska karta-/georeferens-, bana- och kontrollgeometrigrind. Saknad,
dubblett eller avvikande tredje rutt ger fortfarande neutralt 404 utan intern
detalj. Resultatlistan kan välja två eller tre rutter. Tre-ruttsvyn har
textliga röd/blå/grön-etiketter, responsiva faktarutor, kompakt splitgrupp per
kontroll och befintlig relativ GPX-uppspelning endast när alla tidsserier är
kompletta och monotona.

Passerade i denna miljö: contracts lint/typecheck och 3/3 kontraktstester,
application lint/typecheck och 1/1 PostgreSQL17/PostGIS-integrationstest,
web lint/typecheck och 14/14 berörda webbtester, E2E TypeScript/ESLint samt
4/4 390 px-browserfall (befintlig två-ruttsväg, TASK145:s 404/503 och
TASK146). Webbygget passerade. Databasen var en ny tom lokal loopbackinstans
med endast syntetiska Ada/Bea/Cy-data och berör inte demon. Ingen migration,
writer, GPS-live, OMAP, tempo-/vägvalsanalys, kartaimport, stafett eller USB
tillkom.

## TASK145: begriplig vägledning för otillgänglig publik ruttjämförelse

TASK145 förbättrar den befintliga tokenfria, publika två-ruttsvyn utan att
ändra dess kontrakt eller releasegrind. Om den avsiktligt fail-closed
serverläsningen svarar 404 ser besökaren nu att de två valda deltagarna saknar
två jämförbara, publicerade rutter på samma historiska karta och bana. Texten
anger aldrig om den dolda orsaken är ett återtaget samtycke, en release, en
hash, en georeferens eller historisk banproveniens. Nätfel, 5xx och skadat
underlag visar i stället fortsatt ett neutralt tillfälligt fel.

Riktat webtypecheck och -lint samt E2E TypeScript/ESLint passerade. Tre 390
px-browserfall passerade mot ny tom migrerad PostgreSQL17/PostGIS på loopback:
den befintliga lyckade två-ruttsjämförelsen plus TASK145:s 404- och 503-fall.
Webbens produktionsbygge passerade; varken datamodell, writer, resultat,
kart-/GPX-data, publika identifierare eller fysik hårdvara ändrades. Ingen
full workspace-svit eller produktions-/mobilacceptans kördes.

## TASK144: återanvändning syns i privat deltagarhistorik

TASK144 projicerar TASK143:s redan immutable reuse-journal till den befintliga
privata `MANAGE_RACE`-historiken, utan ny route, tabell eller skrivväg. Den
tidigare deltagaren ser att en återlämnad hyrbricka gavs vidare; den nya ser
att hyrbrickan tilldelades och ännu inte är återlämnad. Historikraden använder
journalens sparade kortnummer, tid, entryversion och snapshot, inte dagens
brickkoppling. Kontraktet och vyn visar inga UUID:er, actorcredential eller
den andra deltagarens namn.

Passerade i denna miljö: contracts 5/5, TASK143/144:s PostgreSQL-provsfil
3/3 och ett 390 px-browserfall 1/1. Lint, typecheck och build för contracts,
application och web samt E2E-TypeScript/E2E-ESLint passerade. En ny tom
PostgreSQL17/PostGIS-testdatabas migrerades och användes endast med syntetiska
namn; den är borttagen efter körningen. Ingen publik vy, inventering, hårdvara,
Eventor, GPS, karta eller stafett ändrades.

## TASK143: återanvänd återlämnad hyrbricka riktat verifierad

ADR-0142 och TASK143 gör en uttryckligt återlämnad hyrbricka återanvändbar
inom ett lopp utan att gamla deltagar-, brick- eller resultathistorik skrivs
över. En `MANAGE_RACE`-administratör väljer i den privata, kompakta
brickpanelen en annan deltagare utan aktiv bricka, granskar källan/målet och
bekräftar. Skrivaren låser den aktuella grunden, gör endast källassignmenten
inaktiv, skapar en ny aktiv hyrassignment för målet, höjer båda
entryversionerna och race-snapshot exakt ett steg samt sparar immutable
reuse-journal och audit. Direktanmälan och vanligt brickbyte får inte överta
en annan deltagares historiska bricknummer.

Passerade i denna miljö: kontrakt 2/2, PostgreSQL-integration 2/2, berörd
administrativ routesvit 39/39 och ett 390 px-browserfall 1/1. Det senare
verifierade granskning, avbrutet HTTP-svar, exakt samma retry samt bevarad
källhistorik och ny ej återlämnad hyrbricka hos målet. Lint, typecheck och
build för contracts, database, application och web passerade; E2E-TypeScript
och E2E-ESLint passerade också. `pnpm db:migrate` applicerade migration0076
mot en ny tom isolerad PostgreSQL17/PostGIS-databas. Endast syntetiska namn
och lokala loopbacktjänster användes; ingen Eventoranslutning, hårdvara,
betalning, GPS, karta eller stafett ingick.

## TASK142: privat betalstatus riktat verifierad

ADR-0141 och TASK142 avgränsar betalning till en intern administrativ
markering per deltagaranmälan: `UNMARKED`, `UNPAID`, `PAID` eller `WAIVED`.
Migration0075 ger varje entry en separat payment-statusversion samt en
immutable, race-/entry-/klass-/actor-bunden journal. Den nya `MANAGE_RACE`-
skrivaren kräver CSRF och exakt idempotencyintent; den committar status, journal
och audit atomiskt men ändrar avsiktligt inte entryversion, racesnapshot,
startlista, resultat, readout, finalisering eller publik projektion. Den
befintliga administrationsvyn visar markerad status textuellt och använder
samma granska, bekräfta och retry vid osäkert svar som andra skrivflöden.

Passerade i denna miljö: contractsprovet 2/2, databasens migrations-/
schemaprov 3/3, applicationens PostgreSQL-prov 2/2, den riktade administrativa
routesviten 38/38 och ett 390 px-browserfall med granskning, tappat svar och
exakt retry. Berörd lint/typecheck/build för contracts, database, application
och web passerar; webbygget innehåller den privata PATCH-routen.

`pnpm db:migrate` applicerade hela migrationskedjan, inklusive migration0075,
mot en ny tom PostgreSQL17/PostGIS3.6-testdatabas. Browserfallet använde samma
uttryckligen isolerade databas på loopback och en tillfällig Next-server;
samtliga deltagare var syntetiska. Ingen SQLite-ersättning, verklig tävling,
Eventoranslutning eller betaldata användes.

## Senast genomförda driftförberedelse: TASK141 verifierad backup-state-sammansättning

TASK141 bevisar vid application/infrastructure-gränsen att TASK139:s rena
backupordning verkligen kan använda TASK140:s privata 0600-recorder. Ett
enda riktat test går från `DUMP_PENDING` till `CLEANUP_VERIFIED` med exakt
manifesthash och sorterade store-id:n efter preflight. Dump, sourcepreflight,
mål, replikering, objektläsning och regelrensning är fortfarande enbart
minnesdubblar; den enda beständiga delen är en egen kortlivad privat testfil.

Det riktade testet och statefilens säkerhetsprov passerade 2 filer/5 tester.
Ingen drift-CLI, databas, dump, MinIO, `mc`, binär, credential eller
tävlingdata användes. TASK137:s exakta hashpinnade regelrensningsprov är
fortsatt spärren före en verklig MinIO-adapter eller backupkörning.

## Senast genomförda driftförberedelse: TASK140 privat backup-statusfil

TASK140 implementerar ADR-0140:s privata, 0600-synkade operation-statusfil
utan att ansluta en verklig backup. En recorder kräver en befintlig
repositoryextern 0700-katalog, reserverar en ny fil per backup-id och tillåter
endast TASK139:s direkta faser genom atomär ersättning. Läsaren avvisar
symlänk, fel UID/mode, hardlink, korrupt/överstor JSON och fel backup-id med
generiskt fel; slutlig `CLEANUP_VERIFIED` behålls privat.

Infrastructure lint, typecheck och build gav exit 0. Tre riktade testfiler/
10 tester passerade med syntetiska värden och egna kortlivade `/private/tmp`-
kataloger. Ingen drift-CLI använder adaptern ännu och ingen databas, dump,
MinIO, `mc`, credential eller tävlingsdata har använts. TASK137:s pinnade
regelrensningsprov är fortsatt spärren före en MinIO-adapter.

## Senast genomförda driftförberedelse: TASK139 fail-closed backup-status

TASK139 lägger den rena, hemlighetsfria återhämtningsstatus som ADR-0140
kräver runt backupkedjan. Före dumpen måste state-porten kvittera
`DUMP_PENDING`; efter källpreflight binds målpreparering, möjlig replikering
och cleanup till exakt samma canonicala manifesthash och sorterade unika
store-id:n. En möjlig replikering får alltid ett cleanupförsök även om en sen
statusskrivning fallerar, och ingen kvittens utfärdas före bekräftad cleanup.

Contractsprovet passerade 1 fil/5 tester och de tre sammanhängande
applicationproven 3 filer/9 tester. Contracts och application lint,
typecheck och build gav samtliga exit 0. Endast minnesportar användes: ingen
0600-fil, CLI, dump, databaskörning, MinIO-/mc-binär, credential eller
tävlingsdata har använts. TASK137:s verkliga pinnade regelrensningsprov och
den senare privata filadaptern återstår därför före fungerande backup/restore.

## Senast genomförda publika UI-snitt: TASK138 direkt väg mellan startlista och resultat

Den redan publika startlistan och resultatlistan har nu en gemensam,
serverrenderad och svensk navigering för samma lopp. Resultatvyn länkar direkt
till startlistan, och startlistan direkt till resultaten, medan båda behåller
tävlingsöversikten. Detta ändrar inte startlistans publicering, resultatens
live-/slutresultatvägar, API, cookies, cache, databas eller behörighet.

Det nya renderingsprovet och befintliga publikresultatprov passerade 2 filer/
12 tester. Webblint, typecheck och produktionsbuild gav exit 0; Next.js 16.3.3
kompilerade på 4,0 sekunder och TypeScript-steget på 6,6 sekunder. Ingen
databas, extern tjänst, browser eller fysisk mobil användes: ändringen är två
redan existerande interna länkar, inte en ny publik läsväg eller
fältacceptans.

## Pågående driftgrund: TASK137 regelrensning för versionsbevarande MinIO-resync

ADR-0140 dokumenterar nu den enda tillåtna objektvägen för en senare
skrivstoppad backup: tillfällig resync till ny tom privat målmiljö, exakt
versionsläsning och regelrensning före återupptagna writers. En agentgranskning
visade att processavbrott kräver ett separat privat operation-state och att
första snittet inte säkert kan dela buckets med andra replikationsregler.
TASK137 har därför utökat den helt syntetiska pinned-MinIO-runnern med
regelrensning, tom post-listning och ny kontroll av båda historiska versioner.
Infrastructure lint, typecheck och build passerade; den faktiska opt-in-runnen
är inte körd eftersom exakt de tidigare hashpinnade privata binärerna saknas.
Ingen ersättningsbinär, driftmiljö, databas, tävlingsdata eller credential har
använts.

## Senast genomförda lilla UI-förfining: TASK136 desktopbredd i tävlingsadministrationen

TASK136 dokumenterades före implementation och ändrar endast
`/admin/[raceId]/manage`: från 1280 px viewport får just den sidan använda
maximalt 1520 px, medan den gemensamma 1120-pixelsramen fortfarande gäller
övriga administrations- och publika sidor. Mobilens 720-px-arbetsläge och
alla data-/behörighetsgränser är oförändrade. Berörd webblint, typecheck och
produktionsbuild samt E2E TypeScript/ESLint passerade 2026-09-22. Det
befintliga desktop-/390-px-browserfallet passerade därefter 1/1 på 16,5
sekunder mot uttryckligen vald syntetisk, isolerad PostgreSQL17/PostGIS;
ingen okänd, demo- eller privat databas kontaktades.

## Senast genomförda snitt: TASK135 avkortad bana som kortklass

ADR-0139 och TASK135 skrevs före implementation. Den avgränsade
implementeringen har nu kontrakt, additiv migration, immutable journal,
application-writer/resultatläsare och en svensk tvåstegs-adminvy. I stället för att
förkorta en resultatbärande klass eller införa en bred per-entry-variantmotor
ska operatören kunna skapa en ny lokal kortklass med ett strikt kontrollprefix
och atomiskt flytta högst 100 utvalda deltagare. Enbart tekniska `MP` med
bevarad readout får omvärderas och lång/kort rankas som olika klasser. Inga
Eventor-/hårdvaruanrop eller verkliga tävlingsdata har lagts till. Riktad
isolerad PostgreSQL- och browserverifiering passerade 2026-09-22 med enbart
syntetiskt underlag. Resultatläsaren räknar om canonical SHA-256 för hela den
immutabla frysta transfergrunden och avvisar en semantisk ändring bakom ett
tidigare lagrat hashvärde. Kontraktsprov (3/3), provenance-prov (1/1),
PostgreSQL-integration (3/3), webbrutt (37/37) och browserfall (1/1 på 6,1 s)
passerade, liksom berörd lint, typecheck och build. Databasfallet hittade och
rättade en lokal kontroll där tomma namnuppslag behandlades som konflikt;
ingen domän- eller arkitekturregel ändrades. Integrationen bevisar att den
flyttade resultatraden hamnar i kortklassens Snapshot-export och att en
resultatlös flytt spärrar ny Complete-finalisering.

## Senast genomförda snitt: TASK134 läsande källpreflight för operativ backup

TASK134 gör nästa förberedande backupsteg utan att ändra data eller välja en
driftmekanism. En betrodd serverkomponent kräver ett strikt,
hemlighetsfritt intygande om skrivstopp och dumpidentitet innan den läser
PostgreSQL. Den läser migration och alla PM-manifestreferenser i en enda
`REPEATABLE READ, READ ONLY`-snapshot. Varje stabilt sorterad referens går
sedan genom infrastructure-adaptern till den befintliga PM-läsaren och kräver
exakt `versionId`, hash och längd innan ett canonicalt manifest och dess hash
kan lämnas ut. Tom referensuppsättning, fel input och första objektfel
avbryter utan resultat.

Riktade lint/typecheck/build passerade för contracts, application och
infrastructure. Tester passerade 3/3 contracts, 7/7 application och 6/6
infrastructure. Ingen isolerad `TEST_DATABASE_URL` var konfigurerad, så den
valfria PostgreSQL/PostGIS-acceptansen kördes inte och ingen okänd databas
kontaktades. Ingen dump, bucketregel, resync, CLI, restore eller credential
har skapats. ADR-0140 är nu accepterad före nästa skrivande snitt: den väljer
en tidsbegränsad source-to-empty-target MinIO-resync under operatörens
skrivstopp, med exakt PM-läsning och regelrensning före återupptagna writers.
Den första rena application-ordningsmotorn är också implementerad och riktat
verifierad: dump → source-preflight → tomt mål → replikering → alla
målobjekt → regelrensning, med fail-closed på tappat replikationssvar och
städningsfel. Kontrakt 3/3 samt application 7/7 passerade tillsammans med
berörd lint, typecheck och build. Detta är fortfarande varken utförd backup,
CLI, driftsättning eller riktig MinIO-/PostgreSQL-körning.

## Senast genomförda snitt: TASK133 versions-ID-kompatibilitet för MinIO-restore

ADR-0138 avgränsade ett tvåinstansprov mot exakt den MinIO-release som O-Tid
pinnar. Vanlig `putObject`, `mc cp` och `mc mirror` är fortsatt otillåtna för
TASK099 eftersom de inte bevisar de versions-ID som befintliga PM-manifest
använder. Med verifierade pinnade server- och mc-binärer startade runnern två
nya privata loopbackinstanser, skrev två syntetiska historiska PM-versioner,
skapade en `existing-objects`-regel, hämtade target-ARN privat och utförde
aktiv resync. Den vanliga PM-läsaren läste därefter båda källversionerna i
målet med exakt samma `versionId`, hash och längd. Runnern, infrastructure lint
och infrastructure typecheck gav exit 0; hela infrastructure-enhetssviten
passerade 11 filer/412 tester och package build gav exit 0. Den första
sandboxkörningen av enhetssviten stoppades enbart av `EPERM` för befintliga
lokala sockettester; samma helt syntetiska suite passerade i tillåten lokal
miljö.

Det är ett begränsat kompatibilitetsbevis för den exakta kombinationen, inte
en färdig backup/restore eller driftsreplika. Compose, databas, användar- och
tävlingdata samt verkliga credentials ändrades inte. TASK099 behöver fortsatt
ett separat drift-ADR före skrivande backup/restore.

## Senast genomförda snitt: TASK132 relativ tidsuppspelning av publik ruttjämförelse

ADR-0137 gör TASK121:s redan samtyckta, släppta och exakt historiskt
kompatibla två-ruttsvy spelbar med var sin GPX-fils relativa tidsföljd.
Jämförelsens format 2 bär enbart relativ heltalsmillisekund per redan synlig
pixelpunkt. En gemensam lokal spelare visas endast när båda källorna har
komplett monoton GPX-tid och startar dem vid var sin relativa nollpunkt; den
är uttryckligen inte tävlingstid, synkad start eller kontrollpassage. Varje
markör interpolerar endast inom sitt segment, döljs över gap och den kortare
rutten döljs när den andra fortsätter. WGS84, id:n, hash, objektlager,
resultat-/splitdata och ny lagring tillkommer inte.

Riktade kontroller: contracts lint/typecheck exit 0 och 3/3 tester;
application lint/typecheck exit 0 och PostgreSQL 1/1; web lint/typecheck exit
0 och 2 filer/6 tester; E2E TypeScript/ESLint exit 0; Playwright 1/1 på 5,3 s
vid 390 px. Contracts-, application- och webbyggen passerade; Next
kompilerade på 3,7 s och TypeScript på 6,3 s. Browser- och databasfallen
använde enbart isolerat syntetiskt underlag. Fysisk mobil, verklig GPS,
extern proxy, produktionsdrift, tempo-/vägvalsanalys, OMAP och live-GPS är
inte verifierade.



## Senast genomförda snitt: TASK131 relativ tidsuppspelning av publik rutt

ADR-0136 gör den redan samtyckta, släppta och historiskt kompatibla
deltagarrutten spelbar efter tävlingen. Routeformat 2 bär endast en relativ
heltalsmillisekund per redan synlig pixelpunkt när hela GPX-källan är
monoton; WGS84, id:n, hash, objektlager, resultat- och officiella splitdata
tillkommer inte. Webben kan spela, pausa, återställa eller söka lokalt och
interpolerar endast inom samma GPX-segment. Vid segmentgap döljs markören i
stället för att rita en uppfunnen väg. Rutter utan komplett tid visar fortsatt
endast den befintliga tidlösa vyn.

Riktade kontroller: contracts lint/typecheck exit 0 och 3/3 tester;
application lint/typecheck exit 0 och PostgreSQL 1/1; web lint/typecheck exit
0 och 5/5 tester; E2E TypeScript/ESLint exit 0; Playwright 1/1 på 3,6 s vid
390 px. Contracts-, application- och webbyggen passerade; Next kompilerade på
1,305 s och TypeScript på 6,2 s. Browserfallet hade en riktig serverrenderad
syntetisk deltagare samt syntetiska route-/kartsvar. Fysisk mobil, GPS-live,
tempo-/vägvalsanalys, OMAP och produktionstest är inte verifierade.

## Senast genomförda snitt: TASK130 direktuppdaterad publik deltagardetalj

Den redan publika deltagardetaljen återanvänder nu TASK129:s race-scopade,
no-PII SSE-väckning. Varje `refresh` eller `reset` läser bara om den redan
runtimevaliderade detaljresursen för samma race och ogenomskinliga
`publicResultId`; signalen bär aldrig deltagare, resultat, tid eller annan
domändata. Femsekunderspolling finns kvar när EventSource, proxy eller nätet
inte fungerar. Dubbletter och samtidig polling samsas i en enda omläsning,
och EventSource stängs när användaren lämnar detaljsidan.

Riktade kontroller: webbenhet 2 filer/11 tester passerade; web lint och
typecheck exit 0; E2E TypeScript och ESLint exit 0; Playwright 1/1 passerade
på 6,0 s vid 390 px; webproduktionsbygge exit 0 (kompilering 3,8 s,
TypeScript 1 217 ms). Browserprovet använde lokal isolerad
PostgreSQL/PostGIS, syntetisk IOF-import och stationssimulator: samma redan
öppna detalj för Ada blev felstämplad inom fyra sekunder efter en andra
avläsning.
Fysisk mobil, extern HTTPS-proxy, produktionsdrift och lastacceptans är inte
bevisade.

## Senast genomförda snitt: TASK129 direkt publikresultat över nätet

ADR-0135 och TASK129 ersätter nu ADR-0004:s polling som normal uppdateringsväg
för den redan publika resultatlistan. När en redan beräknad och publicerad
resultatrevision committas skapar PostgreSQL en liten hållbar, race-scopad
teknisk markör och väcker alla webbprocesser. Den öppna SSE-kanalen innehåller
bara `{"formatVersion":1}` och ett monotont tekniskt id: aldrig deltagare,
klass, resultat, tider, intern identitet, rådata eller revisionsdata. Klienten
läser alltid om den befintliga validerade publika resultatsnapshoten.

`Last-Event-ID`, bounded replay (1 000 markörer per lopp), reset vid glapp
och per-race commitserialisering gör att omstart, återanslutning och flera
webbprocesser inte gör streamen till en sanningskälla. Femsekunderspolling
finns kvar när EventSource, proxy eller internet sviker. Browserprovet visar
ett riktigt syntetiskt stationsresultat i en redan öppen 390px-resultatvy
inom fyra sekunder, med lokal PostgreSQL och SSE.

Riktade kontroller: contracts/database/application/web lint och typecheck
exit 0; webbenhetstester 3 filer/12 tester passerade; PostgreSQL-integration
1/1 passerade; E2E TypeScript och ESLint exit 0; Playwright 1/1 passerade på
5,1 s. Webproduktionsbygget passerade (kompilering 1,784 s, TypeScript 1,157
s). Isolerad lokal PostgreSQL/PostGIS och syntetisk tävling användes; fysisk
mobil, extern nätmiljö, reverse proxy, TLS och lasttest är inte bevisade.

## Senast genomförda snitt: TASK128 kopierbar publik länk efter loppsfinalisering

Efter en bekräftad RACE-finalisering visar den befintliga privata
finaliseringsvyn nu en tydlig öppna- och kopieraåtgärd för exakt den publika,
frysta slutresultat-URL som ADR-0134 redan beslutat. Länken skapas bara från
det bekräftade svaret, innehåller bara race- och ogenomskinligt
finaliserings-id och CLASS-finaliseringar visar aldrig någon sådan åtgärd.
Kopiering lyckas med tydlig svensk kvittens och misslyckande lämnar det
bekräftade finaliseringssvaret orört med en instruktion att kopiera adressen
manuellt.

Ingen ADR, migration, writer, read-model, API-rutt, publiceringsregel,
export, klasslänk, GPS-, karta-, rutt-, stafett- eller hårdvarufunktion
tillkom. Riktade kontroller: web UI 5/5, E2E-TSC och ESLint exit 0,
Playwright 1/1 vid 390 px samt web lint/typecheck/produktionsbuild exit 0.
Browserprovet använde en riktig Next-vy men helt syntetiska HTTP-svar, utan
databas eller extern tjänst; fysisk mobil och verklig arrangörsfinalisering
är inte provade.

## Senast genomförda snitt: TASK127 offentlig fryst slutresultatvy

ADR-0134 och TASK127 beslutades före produktkod. En publik slutresultatlänk
är nu bunden till ett uttryckligt, immutabelt `RACE`-finaliserings-id och
läser enbart dess runtimevaliderade frysta manifest. API:t skickar endast
eventnamn, klass, namn, organisation, status, tid, placering, tid efter och
fastställandetid; ID:n, provenance, beslut, hash, XML, splits och livejoins
stannar på servern. Länken från live-resultaten visas bara när senaste
finaliseringen har verifierats. Senare rättningar eller visningsändringar
ändrar inte en redan delad slutresultat-URL; en ny officiell vy kräver en ny
explicit finalisering.

Saknat, fel-race, CLASS-scope eller korrupt finaliseringsunderlag stängs med
`not-found`/`conflict`, utan `publicResults`-fallback. Ingen migration,
writer, IOF-nedladdning, rutt/GPS/karta, stafett eller hårdvara tillkom.

Riktade kontroller: contracts 5/5, application/PostgreSQL 2/2 och Playwright
1/1 vid 390 px passerade. E2E-TSC och ESLint gav exit 0. Contracts,
application och web lint/typecheck/build gav exit 0; webbuilden kompilerade
den nya publika API- och sidrutten framgångsrikt. Databasen var isolerad och
syntetisk; fysisk mobil och verklig arrangörsfinalisering har inte provats.

## Senast genomförda snitt: TASK126 kontext i delad deltagarrutt

TASK126 gör en direkt publik ruttlänk begriplig utan att skapa en ny läsväg.
Sidan visar nu endast redan publikt för- och efternamn, klass samt event- och
lopptitel före den befintliga ruttvyn. Ett opublicerat resultat blir fortsatt
Next `notFound`; den befintliga klientgrinden behåller sitt fail-closed-besked
vid saknad eller senare återtagen route-release.

Ingen ADR, migration, writer, API-data, organisationsfält, resultatstatus,
sträcktider, GPS-analys eller OMAP-funktion tillkom. Riktade kontroller:
webbrendering 2/2 på 4 ms samt web typecheck, lint och produktionsbuild med
exit 0. Mobiltext bryts uttryckligen; fysisk mobil och separat browserfall har
inte körts för detta rena kontextsnitt.

## Senast genomförda snitt: TASK125 ruttöversikt vid deltagarresultat

TASK125 gör den befintliga publika deltagarresultatsidan tydligare utan att
skapa en ny ruttväg: när TASK117–120:s redan godkända ruttläsning lyckas visas
ett kompakt svenskt kort med distans, punkter, segment, GPX-tidstatus och länk
till exakt samma rutt. Vid saknad eller återtagen release renderas inget kort;
det finns ingen "senaste"-fallback, egen hämtning eller publiceringslogik i
webben.

Ingen ADR, migration, writer, ny API-data, GPS-analys, tidsuppspelning eller
OMAP-funktion behövdes. Riktade kontroller: webbrendering 2/2 på 25 ms samt
web typecheck, lint och produktionsbuild med exit 0. CSS har en specifik
tvåkolumnslayout vid 390 px; fysisk mobil och komplett end-to-end-sida har
inte körts för detta rena presentationssnitt.

## Senast genomförda snitt: TASK124 officiella sträcktider i ruttjämförelse

ADR-0133 och TASK124 beslutades före produktkod. I en redan fullt godkänd
TASK121-jämförelse kan de två sidorna nu visa kontrollkod, förekomst,
sträcktid och ackumulerad tid från sina egna effektiva `OK`-resultat. Båda
måste ha en komplett och identisk kontroll-/förekomstordning; annars är
sträcktiderna uttryckligen otillgängliga för båda. MP, DNS, DNF, DSQ, OOC,
NT och saknat eller ofullständigt resultatunderlag ger inga nollor,
uppskattningar eller GPS-härledda passagetider.

Kontraktet lämnar inte ut resultatstatus, placering, tid efter, klass,
organisation, starttid, intern identitet, hash eller WGS84. Den täta
390px-tabellen är märkt som resultatets sträcktider, inte GPS-passagetider.
Ingen migration, writer, tidsuppspelning, tempo, analys eller ny GPS-funktion
tillkom.

Riktade kontroller: contracts 3/3, application/PostgreSQL 1/1, e2e-TSC och
ESLint exit 0 samt Playwright TASK124 1/1 på 4,1 s. Contracts, application
och web lint/typecheck/build passerar också med exit 0. Databasen var
isolerad och syntetisk.

## Senast genomförda snitt: TASK123 tät faktaöversikt i ruttjämförelse

TASK123 visar den redan härledda TASK118-metadata som TASK121 redan lämnade
för varje rutt: distans, punkt-/segmentantal och antingen komplett GPX-tid
eller ett tydligt tidslöst besked. Två kompakta färgkopplade faktarader delar
formatering med enkelruttvyn. Ingen ny serverdata, migration, writer,
tidsuppspelning, fart, höjd, passageanalys eller identifierande data tillkom.

Riktade kontroller: web typecheck och e2e-TSC/ESLint exit 0,
webbkomponent 9/9, Playwright TASK123 1/1 på 3,7 s samt web lint/build exit
0. Databasen var isolerad och syntetisk.

## Senast genomförda snitt: TASK122 namn i publik ruttjämförelse

ADR-0132 och TASK122 var beslutade före produktkod. När – och endast när –
hela TASK121-jämförelsen redan är godkänd, innehåller dess två routeobjekt nu
det för- och efternamn som den befintliga publika resultatlistan redan visar
för samma effektiva resultathuvud. Samma id eller saknat underlag ger fortsatt
endast `not-found`, utan ett ensidigt namnläckage.

Den kompakta röda/blå färgförklaringen visar namnen vid 390 px utan ett extra
API-anrop. Kontraktet avvisar organisation, interna id:n, hash, WGS84 och
resultat-/tidsfält. Ingen migration, writer, profil, GPS-live, analys, OMAP
eller fler rutter tillkom.

Riktade kontroller: contracts 3/3, application/PostgreSQL 1/1, e2e-TSC och
ESLint exit 0 samt Playwright TASK122 1/1 på 4,0 s. Contracts, application
och web lint/typecheck/build passerar också med exit 0. Databasen var isolerad
och syntetisk.

## Senast genomförda snitt: TASK121 publik jämförelse av två exakta rutter

ADR-0131 och TASK121 var beslutade före produktkod. Den publika jämförelsen
läser exakt två olika `publicResultId` i en gemensam låst snapshot och
återanvänder TASK120:s fulla grind för båda. Förutom aktiv resultatrevision,
samtycke, route-release, kartrelease, hash, georeferens och komplett
kontrollgeometri måste båda ha samma historiska course-version, map-manifest
och georeferens. Samma id, återtaget underlag eller minsta mismatch blir
`not-found`; ingen aktuell klass, senare karta eller delmängd väljs.

Det publika kontraktet innehåller endast två pixelbanor, härledd metadata och
gemensamma kontrollmarkörer. Resultatlistans väljare ligger enbart i lokalt
component-state och navigerar när två rader är valda. Den svenska SVG-vyn är
testad vid 390 px med röd/blå rutt, markerad kontroll och utan horisontell
scroll eller intern-/WGS84-data. Ingen migration, writer, GPS-live,
tidsuppspelning, passagetider, analys, OMAP eller fler rutter tillkom.

Riktade kontroller: contracts 3/3, webbkomponent 9/9,
application/PostgreSQL 1/1, e2e-TSC och ESLint exit 0 samt Playwright TASK121
1/1 på 5,9 s. Contracts, application och web lint/typecheck/build passerar
också med exit 0. Databasen var isolerad och syntetisk.

## Senast genomförda snitt: TASK120 publik historisk banpåtryck

ADR-0130 och TASK120 var beslutade före produktkod. Den publika deltagarrutten
resolverar nu samma effektiva, publicerade resultathuvud som resultatlistan och
använder dess historiska `courseVersionId`, aldrig deltagarens nuvarande
klasskoppling. En route-release kan bara visa kontrollmarkörer när en komplett
TASK119-geometri matchar exakt samma historiska bana, map-manifest,
georeferens och hash. Minsta mismatch blir `not-found`; det finns ingen
"senaste"-fallback.

Det publika pixelkontraktet tillför endast ordning, kontrollkod och
pixelkoordinater. Den svenska 390px-SVG-vyn visar markörer över den redan
släppta rutten, utan WGS84, interna UUID:n, hash- eller lagringsfält. Ingen
migration, writer, GPS-live, OMAP, ruttjämförelse eller analys tillkom.

Riktade kontroller: kontrakt 2/2, application/PostgreSQL 1/1, e2e-TSC och
ESLint exit 0 samt Playwright TASK120 1/1 på 6,2 s. Contracts, application
och web lint/typecheck/build passerar också med exit 0.

## Senast genomförda snitt: TASK119 privat kontrollgeometri

ADR-0129 och TASK119 beslutades före produktkod. Migration0072 ger en
additiv, immutable geometrijournal med punktposter som binds till exakt
kontrollförekomst, banversion, privat rasterkarta och kalibrering. En skyddad
`MANAGE_RACE`-route och kompakt svensk panel under kartsidan skapar en komplett
atomisk revision med retry, audit och versionskontroll. Ingen position härleds
från GPX eller kontrollkod, och ingen publik route/resultatväg ändras.

Riktade kontroller: kontrakt 1/1, PostgreSQL-integration 1/1, privat
webbkomponent 1/1, berörd lint/typecheck och webbuild exit 0. Den isolerade
testdatabasen stoppades efter körningen. Ingen publik banpåtryck, OMAP,
GPS-live, ruttjämförelse eller analys infördes.

Nästa minsta steg är ett separat ADR för att visa den exakta historiska banan
endast när resultatets banversion, kartrelease, georeferens och geometri
matchar.

ADR-0130 och TASK120 är nu beslutade före produktkod. De låser att en publik
banpåtryck alltid följer resultatets historiska course-version och aldrig
klassens aktuella inställning eller en senare geometri-/kartversion.

## Senast genomförda snitt: TASK118 publik ruttmetadata

ADR-0128 och TASK118 beslutades före produktkod. Den offentliga, redan
samtyckta och släppta deltagarrutten visar nu härledd distans, punkt-/segmentantal
och tydlig GPX-tid när hela källsekvensen har monotona tidsstämplar. Beräkningen
är en ren domänfunktion och summerar aldrig över segmentgränser. Svaret är
fortsatt pixel-only och blir otillgängligt när TASK117-releasen återtas.

Riktade kontroller: domän 3/3, berörd PostgreSQL-integrationssvit 1/1,
TASK118-browserkontroll 1/1 och TASK117-regression 2/2; berörd lint/typecheck
och alla berörda byggen är gröna. Ingen ny lagring,
GPS-live, jämförelse, tempo, höjd, FIT/TCX eller OMAP infördes.

Nästa minsta steg är TASK119:s privata versionsbundna kontrollgeometri. Den
kommer före varje publik banpåtryck och har ett separat ADR.

## Senast genomförda snitt: TASK117 publik deltagarrutt

ADR-0127 och `TASK_117_PUBLIC_PARTICIPANT_ROUTE_RELEASE.md` är beslutade före
produktkod. De låser att en publik rutt kräver både deltagarens aktuella
samtycke och en separat, explicit `MANAGE_RACE`-release av exakt GPX-,
raster- och georeferensversion. Migration0071, pixel-only-kontrakt,
serverresolver, CSRF-skyddad release/withdraw-route och den första publika
deltagarruttvyn är tillagda. Den riktade PostgreSQL-körningen bekräftar att
release utan samtycke avvisas, att exakt retry återger samma release/withdraw,
och att en verkligt ingestad publicerad resultatrad öppnar pixel-only-rutten
efter release men blir `not-found` efter withdraw. Adminstatus är beständig
över sidomladdning; browserfallen bekräftar tillgänglig och stängd 390px-vy.

## Senast genomförda snitt: TASK116 privat deltagarsamtycke för framtida ruttpublicering

`TASK_116_PARTICIPANT_ROUTE_PUBLICATION_CONSENT.md` och ADR-0126 skrevs före
produktkod. En deltagare med en aktiv privat route-upload-session kan nu ge
eller ta tillbaka ett uttryckligt samtycke för en framtida, ännu ej byggd
ruttpublicering. Migration0070 lägger till en additiv immutable journal med
exakt manifestversion, SHA-256, monoton revision och idempotent request-id.
Browsern väljer aldrig entry, manifest eller hash; servern resolverar dem från
den privata sessionens grant. Ingen rutt eller karta publiceras av snittet.

Samtycke är privat som standard. Saknad rutt, utgången session, spärrat grant,
annat intent vid samma request-id eller förändrad route-scope avvisas. Ett nytt
manifest ärver inte en äldre ruttversions beslut, medan både `GRANT` och
`WITHDRAW` bevaras som historia. Den svenska 390px-vyn visar bara aktuell
privat status och har CSRF-skyddade knappar för godkännande eller återtagande.

Riktad verifiering: contracts 1/1, application/PostgreSQL17 1/1,
webbkomponent/HTTP 5/5 och Playwright 3/3 passerar. Berörd database,
contracts-, application- och web-typecheck/lint passerar. Databasen var en
isolerad lokal PostgreSQL17-instans med syntetiskt underlag; browserprovet
använde ingen extern tjänst och bekräftar att ingen publik route-/kartväg
anropas. Publik målgrupp, kartsläppsvillkor, faktisk routevisning, OMAP,
analys, GPS-live, stafett och hårdvara är fortsatt utanför snittet.

## Senast genomförda snitt: TASK115 privat ruttförhandsgranskning

`TASK_115_PRIVATE_ROUTE_PREVIEW.md` och ADR-0125 skrevs före produktkod. En
`MANAGE_RACE`-administratör kan nu under `/admin/<race>/route-preview` välja
en exakt redan lagrad privat GPX-rutt, en exakt privat PNG/JPEG-version och
en exakt tidigare kalibrering. Applikationslagret kontrollerar race-scope,
manifestbindning, source-hash och den sparade affintransformationen igen,
läser immutable ruttpunkter och lämnar endast härledda pixelpunkter till
browsern. Den skyddade bildläsningen använder samma exakta objektversion och
svarar privat utan att lägga någon ny journal eller välja "senaste" objekt.

Saknad/felaktig/utanför-bild eller racefrämmande kombination av rutt, karta och
kalibrering avvisas fail-closed. Vyn är svensk, kompakt vid 390 px och anropar
inga publika rutt- eller kartvägar. Den är en arrangörskontroll, inte en
deltagarvy eller Livelox-koppling: ingen samtyckes- eller publiceringspolicy,
fler-ruttanalys, animering, OMAP, GPS-live, stafett eller hårdvara ingår.

Riktad verifiering: contracts 1/1, application/PostgreSQL17 1/1 och
Playwright TASK115 1/1 vid 390 px passerar. Berörd application/web/contracts
typecheck och lint passerar. Browser- och databaskörning använde endast
syntetiskt underlag i en isolerad lokal PostgreSQL17-instans; ingen
produktionsdatabas eller extern tjänst anropades.

## Senast genomförda snitt: TASK114 privat rastergeoreferens

`TASK_114_PRIVATE_RASTER_GEOREFERENCE.md` och ADR-0124 skrevs före
produktkod. En `MANAGE_RACE`-administratör kan nu spara en privat,
append-only trepunktskalibrering för exakt en tidigare verifierad PNG/JPEG-
manifestversion. Den rena domänfunktionen härleder och validerar en
inverterbar pixel→WGS84-affinitet: bildextent och WGS84-gränser, båda
icke-kollineära trianglarna samt numeriskt residualmått måste stämma. Tre
punkter påstår uttryckligen inte fältverifierad positionsnoggrannhet.

Migration0069 är additiv och har en immutable journal med race-/manifest-
scope, aktör, monoton revision, source-hash, bilddimensioner, tie points och
härledd transform. Exakt retry återger samma journalrad; ändrat intent, stale
revision, främmande manifest eller ogiltig geometri avvisas. Privat GET/POST
kräver samma CSRF-skyddade `MANAGE_RACE`-session som kartadministrationen och
läcker varken objektlageridentitet, rutt eller publik väg. Den kompakta
svenska adminpanelen ligger under befintliga `/admin/<race>/map`; den behöver
manuella pixel- och WGS84-värden och kan inte publicera karta eller GPS.

Riktad verifiering: domain 2/2, contracts 2/2, webkomponent 3/3,
application/PostgreSQL17 1/1 och browser 3/3 på 390 px passerar. Den isolerade
testdatabasen innehöll 70 migrationsrader efter körningen. Domain, contracts,
database, application och web passerar typecheck/lint och build. Browserprovet
använder enbart syntetiskt kartunderlag och bekräftar att kalibreringsvyn inte
anropar en publik API-väg. Ingen OMAP-import/rendering, routeöverläggning,
GPS-live, ruttpublicering eller verklig kartprecision är verifierad.

## Tidigare snitt: TASK111–113 privat GPX-rutt, kvittens och MinIO-acceptans

`TASK_111_PARTICIPANT_GPX_ROUTE_UPLOAD.md`, ADR-0123 och
`docs/research/gpx-1-1-2026-09-20.md` skrevs före produktkod. Snittet bygger
den första privata vägen från deltagarens egen GPX 1.1-track till en
race-/entry-bunden route, via en tidsbegränsad hash-only uppladdningslänk som
administratören utfärdar. Den publika resultatlänken är uttryckligen aldrig
skrivbehörighet.

Originalbytes och ordnade WGS84-punkter ska vara immutable och idempotenta.
GPX-, kart- och PM-adaptrarna förblir separata. En senare kartöverlagring och
publik route-release väntar på georeferering: TASK106:s rasterkarta har ingen
CRS och får inte låtsas att WGS84-punkter redan passar den.

Första kodsteget är `packages/route-xml`: en ren GPX 1.1-parser med faktisk
8 MiB-UTF-8-gräns, DTD/DOCTYPE/ENTITY-spärr, strikt trackstruktur, WGS84- och
RFC3339-validering samt 2 000 segment/100 000 punkter. Riktad lint, typecheck
och test passerar; parserprovet har 1 fil och 7 tester. Den gör ingen I/O och
lagrar inget. `packages/contracts` har därtill strikt grant-/spärr-,
reservations-, kvittens- och internt manifestkontrakt utan bearerhemlighet
eller publika ruttfält; contracts lint/typecheck och 3/3 riktade tester
passerar. Migration0068 har nu separata immutable grant-, spärr-, session-,
reservation-, attempt-, manifest- och point-tabeller. Databas lint/typecheck
och 3/3 riktade schematester passerar. Hela migrationskedjan passerade mot en
isolerad lokal PostgreSQL17/PostGIS-databas; katalogkontroll bekräftade alla
sju tabeller och triggers, och instansen stängdes sedan. En `MANAGE_RACE`-
funktion för faktisk grantutfärdande/-spärr finns nu också: den kräver befintlig
CSRF-skyddad administratörssession, låser race och entry, accepterar bara
hash-only-hemlighet, tillåter högst en aktiv grant, journalför båda besluten och
återger enbart exakt retry. Den tar även emot en korrekt bearer-länk i
applikationslagret, jämför hemligheten timing-säkert med dummyhash vid okänt
grant-id, växlar den till en kort hash-only session och CSRF-token och
omvaliderar expiry/spärr vid varje privat request. Den riktade
PostgreSQL-integrationen passerar 2/2 mot en ny tom isolerad databas. HTTP:s
cookie-/redirectgräns finns nu: en giltig bearer-GET växlar till host-only
session och separat CSRF-cookie, svarar `private, no-store`/`no-referrer` och
omdirigerar till tokenfria `/route-upload` innan sidan eller filanropet syns.
Deltagarservicen kan nu reservera och
ta emot bounded GPX-data med den korta sessionen, köra parser före objektlagring,
skriva exakt manifest och källordnade segment/punkter i immutable journal och
återge exakt kvittens vid retry. Det riktade PostgreSQL-provet använder en
syntetisk lagringsport och passerar 2/2. En separat, serverkonfigurerad
`OTID_ROUTE_STORE_*`-adapter finns nu också: den kräver privat versionsbucket,
HTTPS i produktion eller explicit loopback i utveckling, exakt hash/längd och
read-after-write mot objektversionen. Infrastructure 2/2 och webbens
konfigurationsprov 2/2 passerar. Den privata browserrutan är nu ett litet
svenskt GPX-formulär: den läser enbart CSRF-cookien, hashar filen lokalt,
reserverar och överför med minnesbunden idempotent retry utan browserlagring
eller visning av bearer-/objektidentifierare. Web typecheck/lint och fyra fokuserade
testfiler med sex tester passerar. Den privata `MANAGE_RACE`-sidan
`/admin/<race>/route-upload` kan nu välja deltagare, skapa en 1/7/30-dagars
hash-only-länk i browsern, visa den endast tills kopiering/rensning och
journalföra explicit spärr med retry. Dess privatrutt, klientmaterial och
skalsida utökar den riktade webbsviten till sex testfiler med åtta tester;
den utökade grantslistan är verifierad i samma isolerade PostgreSQL-test 2/2.
Ett 390 px-Playwrightprov passerar nu 2/2 mot riktig lokal Next/browser med
syntetiska API-svar: avbrutet reservationssvar återanvänds med exakt samma
idempotensnyckel och en återöppnad giltig privat länk visar en anonymiserad
lagringskvittens i stället för formuläret. Statusläsningen scope:as av den
autentiserade grant/race/entry-principalen och lämnar inte ut upload-, grant-,
entry- eller objektidentifierare. TASK113:s isolerade, hashpinnade verkliga
MinIO-prov verifierar nu privat GPX-lagring, objektversion, overwrite och
omstart för syntetiska data. Publik ruttvisning,
OMAP-rendering, live-GPS, fler-ruttanalys och Liveloxberoende.

## Slutfört 2026-09-20: TASK110 direktanmälan till verifierad lottad fast starttid

`TASK_110_ASSIGNED_FIXED_START_SLOT_REGISTRATION.md` och ADR-0122 skrevs före
produktkod. En ny deltagare kan nu, med både den begränsade
`REGISTER_ENTRY`-sidan och gemensam `MANAGE_RACE`-vy, välja en specifik
framtida minut ur senaste verifierbara `FIXED`-lottningen. Servern validerar
draw-id/source-hash, snapshot, ban-/startregel, kapacitetsversion, komplett
roster och vakans igen under race-låset. En manuell fast tid finns fortsatt
kvar som ett uttryckligt undantag och blir aldrig lottad i efterhand.

Migration0067 är additiv. Den nya immutable one-to-one-journalen
`entry_registration_start_slot_assignment` sparas atomiskt med entry, eventuell
brickkoppling och `entry_registration_request`; samma retry återger exakt
assignmentbevis även efter senare ändringar. Ingen generell reservation,
PUNCH-slot, om-/återlottning, resultat/publicering, GPS eller stafett ingår.

Riktad verifiering: contracts 3/3, webbrutter 39/39 och isolerad PostgreSQL17
TASK110+TASK109+TASK035 6/6 passerar. Berörd contracts/database/application/web
lint och typecheck samt web production build passerar. Playwright TASK110
passerar 1/1 på 13,9 s i 390 px mot riktig lokal Next/HTTP och isolerad
PostgreSQL: första POST-svaret tappas efter commit och samma idempotensnyckel/
body återförsöks, med exakt en slotjournal. Ingen produktionsdatabas, fysisk
startprocess eller fältmobil är verifierad.

## Slutfört 2026-09-20: TASK109 verifierad lottad fast starttid vid klassbyte

`TASK_109_ASSIGNED_FIXED_START_SLOT_TRANSFER.md` och ADR-0121 skrevs före
produktkod. En `MANAGE_RACE`-administratör kan nu flytta en befintlig deltagare
till en annan `FIXED`-klass och välja en specifik, framtida starttid från
serverns senaste verifierbara lottning. Kandidatgränsen är privat och
`no-store`; den visar ingen slot när aktuell roster innehåller en manuell,
dubbel eller avvikande tid. Kapacitet, aktuell snapshot, draw-id/source-hash,
framtid och faktisk upptagenhet kontrolleras igen under samma befintliga
race-/entrylås som klassbytet.

Migration0066 är additiv. `entry_start_slot_assignment` är en immutable
one-to-one-journal med transfern, drawens identitet/source-hash och exakt tid.
Transfer och journal sparas atomiskt; retry med samma idempotensnyckel återger
samma assignment-id och bevis utan att härleda något ur senare entrydata.
Historiska manuella dubbletter får finnas kvar och den äldre manuella
klassbytesvägen är oförändrad, men den kan aldrig utge sig för att vara ett
lottat slotanspråk. PUNCH, direktanmälan, omräkning, publicering, GPS och
stafett omfattas inte.

Riktad verifiering: contracts 4/4, application/PostgreSQL17 2/2, webbrutt
36/36 samt TypeScript/ESLint för browserprovet är gröna. Playwright TASK109
passerar 1/1 på 12,3 s i 390 px mot riktig lokal Next/HTTP och isolerad
syntetisk PostgreSQL. Berörd lint/typecheck och web production build passerar.
Ingen full workspace-regression, produktionsdatabas, fysisk startprocess,
fältmobil eller faktisk SPORTident-hårdvara har verifierats.

## Slutfört 2026-09-20: TASK108 verifierbar rapport över fasta startluckor

`TASK_108_FIXED_START_SLOT_REPORT.md` gör den första praktiska delen av
vakanser synlig utan att ge systemet en osäker skrivgenväg. En
`MANAGE_RACE`-administratör kan öppna en kompakt privat rapport i befintlig
workspace. Den visar bara tider från senaste immutabla lottning i en aktuell
FIXED-klass: upptagen deltagare, vakant tid samt deltagare utan fast tid.
PUNCH/fri start räknas aldrig som minutluckor och deltagartak visas separat.

Saknad lottningsjournal eller aktuell manuell/dubbel/icke-exakt fast tid ger
en uttrycklig otillgänglig rapport, aldrig en gissad lucka. Vägen är en
strict validerad, snapshot-bunden `GET`; den kan inte ändra starttid, klass,
kapacitet, resultat eller historik. Ingen migration eller ADR behövdes,
eftersom den inte skapar ett nytt domänbeslut.

Riktade contracts-, application-/PostgreSQL-, webbrutt-/komponent- och
browserprov är gröna: 2/2, 1/1, 36/36 respektive 1/1 på 9,6 s i 390 px mot
lokal Next/HTTP och isolerad PostgreSQL17. Berörd lint/typecheck samt web
production build passerar. Rapporten bevisar inte att en ledig slot kan
tilldelas: ett nästa skrivsnitt behöver ADR, atomisk reservation/journal och
en uttalad policy för passerad tid, nya deltagare och kollisioner.

## Slutfört 2026-09-20: TASK107 online station till publik resultatuppdatering

`TASK_107_ONLINE_STATION_TO_PUBLIC_RESULT.md` samlar första genomgående
acceptansbeviset för den redan valda onlinearkitekturen. En publik resultatsida
på 390 px öppnas före resultat, stationssimulatorn skickar sedan en syntetisk
readout till den riktiga idempotenta device-batch-routen med en race-/device-
bunden credential, och den redan öppna publikvyn visar den nya `OK`-raden
genom den befintliga femsekunderspollingen utan omladdning. Ett följande
avlyssnat pollfel lämnar senaste validerade rad kvar och visar den textliga
varningen.

Ingen produktionskod, databas, kontrakt, pollingfrekvens eller ADR ändrades;
snittet visar att befintlig server-/stations-/publikkedja faktiskt hänger ihop.
Riktad TypeScript och ESLint passerar, liksom Playwright 1/1 på 16,2 s mot
riktig Next/HTTP på loopback 3126 och isolerad PostgreSQL17/PostGIS. Simulator
är fortfarande inte fysisk SPORTident/USB, och Android-, internetdrift- och
SSE-acceptans återstår.

## Slutfört 2026-09-20: TASK106 privat kartbild och explicit kartsläpp

`TASK_106_PUBLIC_MAP_RELEASE.md` och ADR-0120 är skrivna före produktkod.
De skiljer medvetet en framtida renderbar PNG/JPEG-kartbild från den befintliga
privata PM-PDF-grunden: PM-prefix, PM-capability och PDF-leverans återanvänds
inte som ett dolt generellt fil-API. Den separata kartassetgränsen blir privat
som standard, race-bunden och explicit återtagbar via befintlig `MANAGE_RACE`.
OMAP är fortsatt privat källformat; GPS, rutter, georeferering, banpåtryck och
Livelox-lik uppspelning ingår inte. Den strikt validerade contractgränsen finns
nu med reservation/lagringskvittens, PNG/JPEG-only, canonical request-id:n och
en publik metadataform utan interna lagringsfält. Migration0065 lägger
additivt till separata immutable reservationer, försök, manifest och
publish/withdraw-journal utan att röra PM; den fulla migreringskedjan körde i
en ny privat PostgreSQL17/PostGIS-databas. En separat privat versionsadapter
för PNG/JPEG finns med syntetiskt protokollprov. Den befintliga `MANAGE_RACE`-
sessionen kan nu öppna en separat, kompakt kartsläppssida, reservera PNG/JPEG,
ladda upp privat, välja lagrad karta, publicera med explicit bekräftelse och
återta med en ny journalrad. Den publika resultatsidan och deltagarsidan länkar
enbart när en aktiv release finns; bildrouten omvaliderar releasen efter exakt
versionsbunden bytesläsning och svarar `no-store`/`nosniff` utan bucket-,
object-, store- eller version-id.

`OTID_MAP_STORE_*` är server-only och fail-closed; lokal Compose-initieringen
slår på MinIO-versionering för den privata bucket som används i utveckling.
Contracts 6/6, database 62/62, infrastructure 3/3, application PG 1/1 och
webbens kartskal 4/4 är gröna; berörd lint/typecheck och web production build
passerar. Ett 390 px-browserprov 2/2 passerar mot riktig Next/HTTP och
isolerad PostgreSQL: publik karta har zoom/pan utan sidscroll och adminskalet
förblir fritt från lagringsidentifierare. Bildsvaret är syntetiskt avlyssnat,
så verklig objektlagring, proxy/cache och fältmobil är fortfarande
overifierade. OMAP, GPS, rutter, georeferering, banpåtryck och Livelox-lik
analys är fortsatt utanför snittet.

## Slutfört 2026-09-20: TASK105 återtagande av PUNCH-starttidsrättning

`TASK_105_MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL.md` och ADR-0119 är
skrivna före produktkod. Snittet är avsiktligt begränsat till att återställa
den exakta direkta tekniska källa som en omedelbar TASK104-rättning byggde på.
Rådata, läst start, rättning, äldre revisioner och fryst Complete-XML skrivs
aldrig om. FIXED-start, avprickning, målrättning, GPS, karta/rutt och stafett
ligger utanför.

Migration0064 är additiv: ny revisionsorsak, nullable proveniensreferens och
immutable withdrawal-journal. Den centrala state-loadern kräver hela kedjan
teknisk avläsning → TASK104-rättning → TASK105-återtagande. Saknas ett led
avvisas projektionen fail-closed. `MANAGE_RACE`-writern använder race-/entrylås
och request-id-bundet återförsök; publikresultat, speaker, IOF och privat
historik ser den återställda tekniska revisionen utan ny resultattolkning.

Riktade kontroller: migration mot ny isolerad PostgreSQL17/PostGIS-databas,
application-integration 2/2, kontrakt 5/5, webbrutt 34/34 och browserprov
1/1 på 11,2 s i 390 px. Browserfallet provar tappat commitsvar och exakt
retry. Ingen riktig USB, fältmobil, fysisk startstation eller
produktionsdatabas är verifierad. Se
`TASK_105_MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL.md`.

## Senast slutfört 2026-09-20: TASK104 korrigering av observerad PUNCH-start

ADR-0118 och `TASK_104_MANUAL_PUNCH_START_TIME_CORRECTION.md` skrevs före
produktkod. En `MANAGE_RACE`-administratör kan nu rätta en dokumenterat
felaktig observerad start bara för ett aktuellt, direkt tekniskt publicerat
`OK`/`MP` i en `PUNCH`-klass med bevarad startstämpling. Rättning appendar en
ny revision, immutable journal och audit; råmeddelande, CardReadout, källa,
snapshot, klass/bana och äldre revisioner muteras inte. Löptid och splits
härleds om från den korrigerade starten; mål, kontroller, status/reason och
avvikelser bevaras.

Migration0063 är additiv och utökar den befintliga provenance-checken för den
nya orsaken. Publica resultat och historik läser den centrala stricta
proveniensvalideringen. `/manage` har ett initialt stängt svenskt tvåstegsflöde
med 390 px-stöd och exakt retry efter tappat svar; ingen ny offlinekö skapas.

Riktade tester är gröna: domän 2/2, kontrakt 3/3, route 33/33, PostgreSQL17/
PostGIS-integration 1/1 och Playwright TASK104 1/1 (5,5 s). Domain/contracts/
database/application/web lint och typecheck samt web production build passerar.
Ingen full regression, riktig SPORTident/startstationsklocka, fältmobil eller
produktionsserver är verifierad. FIXED-start, avprickning, målrättning, GPS,
karta/rutt och stafett omfattas inte.

## Senast slutfört 2026-09-19: TASK081 manuell bana och klass

Etapp B1 har påbörjats och det första avgränsade snittet är slutfört. ADR-0103 och
`TASK_081_MANUAL_COURSE_CLASS_CREATION.md` är skapade före produktkod. De låser
en atomisk, idempotent `MANAGE_RACE`-skrivväg för ny manuell bana, immutable
version 1, ordnad kontrollföljd och en länkad klass med explicit PUNCH/FIXED.
Manuella objekt saknar extern identitet; IOF-importen behåller sin adaptergräns.

GPT-5.6 Terra implementerade databas-, kontrakts-, applikations- och routegränsen.
GPT-5.6 Luna implementerade det kompakta tvåstegsflödet i befintlig `/manage`.
Riktade kontrakts-, route-, PostgreSQL- och browserprov samt berörd
lint/typecheck/build är gröna; exakta resultat finns sist i statusloggen. Ingen
banredigering, karta, GPS, stafett eller SPORTident/USB ingår.

## Senast slutfört 2026-09-19: TASK084 hash-bunden manuell banrättning med resultat

ADR-0106 och `TASK_084_MANUAL_COURSE_RESULT_BEARING_RELINK.md` skrevs före
produktkod. En separat `MANAGE_RACE`-väg kan nu skapa CourseVersion N+1 och
länka om exakt en manuell klass även när den har resultat. Kandidatens canonical
`basisHash` binder race-snapshot, klass/bana, entryversioner, senaste
revisionshuvuden och effektiva manuella beslut till commiten under race-lås.

Skrivvägen lämnar äldre resultatrevisioner, manuella beslut, rådata,
finaliseringar och fryst Complete-XML orörda. Den skapar aldrig en automatisk
eller gruppvis omräkning. Administratören får ett separat, initialt stängt
svenskt granskningsflöde med bekräftelse, exakt retry efter tappat svar och
tydlig vägledning att omräkning sker individuellt senare.

Slutlig riktad verifiering med `CI=true`:

- contracts lint/typecheck: exit 0; TASK084-kontrakt 2/2 tester på 417 ms;
- database lint/typecheck: exit 0;
- application lint/typecheck: exit 0; PostgreSQL-integration 2/2 tester på
  81 ms (hela körningen 803 ms);
- web lint/typecheck: exit 0; route-handler-svit 28/28 tester på 49 ms;
- E2E TypeScript och riktad E2E ESLint: exit 0;
- Playwright TASK084: exit 0, 1/1 test på 3,9 s (hela körningen 8,2 s) mot
  riktig Next/HTTP och isolerad PostgreSQL17/PostGIS på loopback55484;
- web production build: exit 0; Next kompilerade på 4,1 s, TypeScript på 5,8 s,
  7/7 statiska sidor på 60 ms; checkin-skalets hash `9632de07c765`.

Ingen full workspace-, full integrations- eller full browserregression kördes.
De riktade proven täcker hash-/retry-/samtidighetsbarriären,
resultathistorikens immutability, routekontrakt och den kompakta browservägen.
Ingen riktig SPORTident-avläsning, fältmobil, karta, GPS eller stafett har
verifierats.
Den tillfälliga PostgreSQL-instansen stoppades kontrollerat; syntetisk testdata
bevaras under `/private/tmp/otid-task084-pg.Q50oJG`.

## Senast slutfört 2026-09-19: TASK085 atomisk lösning av vald okänd avläsning

ADR-0107 och `TASK_085_ATOMIC_UNKNOWN_READOUT_RESOLUTION.md` skrevs före
produktkod. Snittets implementering binder en specifik lagrad `UNKNOWN_CARD`-avläsning till
antingen befintlig deltagare eller strikt direktregistrering, brickkoppling och
en ny revision i en enda idempotent `MANAGE_RACE`-transaktion. Den får aldrig
skriva om rådata eller det ursprungliga ingestutfallet, och får aldrig välja en
senare avläsning med samma bricknummer i stället för uttryckligt `readoutId`.

Kontrakt, schema/migration0054, application-writer och `/manage`-panelen är
integrerade. Riktade contracts- (2/2), PostgreSQL/PostGIS-integration (2/2)
och route-tester (29/29), berörd lint/typecheck samt webbuild är gröna. Under
browseracceptansen hittades ett kontraktsfel där `entryId` läckte in i den
strikta aktiva brickprojektionen; det är rättat och integrationen är körd igen.
Ett för snävt Playwright-sökuttryck ersattes med semantiska, unika combobox-
namn. TASK085-browserfallet passerade 1/1 på 9,2 s på 390 px mot riktig
Next/HTTP och isolerad PostgreSQL17/PostGIS. Det bevisar exakt readoutval,
granskning, tappat commitsvar, samma idempotensnyckel/body vid retry och ingen
horisontell scroll. Slutlig web lint och build passerade: 1,6 s kompilering,
3,2 s TypeScript och 7/7 statiska sidor på 52 ms.

## Senast slutfört 2026-09-19: TASK086 kompakt publik resultat- och sträckrapport

`TASK_086_PUBLIC_RESULT_SPLIT_REPORT.md` dokumenterar B3 före produktkod.
Det blir en strikt läsande responsiv presentation av redan validerade publika
resultat och sträckor. Ingen ranking, polling, route, kontrakt, databas,
behörighet eller domänregel ändras och ingen ADR krävs. Den minsta acceptansen
är ett tätt desktopläge, ett läsbart 390 px-läge utan sidscroll och korrekta
sträckor/avvikelser utan fabricerade data.

### TASK086 genomfört: kompakt publik resultat- och sträckrapport

Den oinloggade resultatvyn använder samma oförändrade publika kontrakt och
polling som tidigare. Desktop behåller tabellen. Vid högst 640 px omvandlas
varje rad till ett kompakt kort där klass och deltagare står först; status,
placering, tid och eftertid får tydliga etiketter. Sträckor öppnas vid behov
med native `details` och visar kontroll/förekomst, sträcka och ackumulerad tid.
MP-avvikelser blir kvar och DNF/DNS/NT får inga fabricerade tider eller splits.

Riktad verifiering med `CI=true`: komponenttest 6/6 på 6 ms, web lint och
typecheck exit 0, samt web build exit 0 (677 ms kompilering, 3,4 s TypeScript,
7/7 statiska sidor på 52 ms). CSS-provet verifierar det egna 640 px-kortläget
och frånvaron av `.scroll`-beroende. Det finns ingen liten befintlig
browserkedja med syntetiska publika resultat att återanvända; faktisk fysisk
mobil- och skrivarrendering återstår därför som verifieringsantagande.

Nästa minsta B3-snitt är lokal klass- och namnsökning i samma publika resultat-
underlag, utan ny API-filterparameter eller ändrad publik behörighetsgräns.

## Senast slutfört 2026-09-19: TASK087 lokal sökning och klassfilter för publikresultat

`TASK_087_PUBLIC_RESULT_SEARCH.md` avgränsar en ren klientfilterfunktion före
produktkod. Den återanvänder hela den redan publika, validerade listan och
bevarar polling utan någon ny serverparameter, databasfråga eller cachepolicy.
Svensk diakritik, kombinerat namn-/klassurval, filterkorrekt mixed-course-
varning och säker återställning när en klass försvinner är implementerat genom
en liten ren filterfunktion. Söktext och giltigt klassval bevaras mellan
uppdateringar; försvunnet klassval återställs till Alla klasser. Riktad
verifiering med `CI=true`: 2 testfiler/8 tester på 14 ms, web lint/typecheck
exit 0 och web build exit 0 (1,4 s kompilering, 3,4 s TypeScript, 7/7 sidor på
51 ms). Ingen fysisk mobilrendering verifierades.

Nästa minsta B3-snitt är en enkel browserutskriftsanpassning av redan filtrerat
publikt resultatunderlag, utan PDF-generator, skrivarintegration eller ny data.

## Senast slutfört 2026-09-19: TASK088 browserutskrift av filtrerade publikresultat

`TASK_088_PUBLIC_RESULT_PRINT.md` låser detta som ett rent CSS-snitt före kod:
print följer befintligt lokalt urval, återställer tabellform efter mobilkort och
döljer webbkontroller. Ingen PDF, utskriftsknapp, ny data eller skrivarintegration
införs. Riktad verifiering med `CI=true`: 2 testfiler/9 tester på 14 ms, web
lint/typecheck exit 0 och web build exit 0 (564 ms kompilering, 1,0 s
TypeScript, 7/7 sidor på 50 ms). Fysisk skrivare är inte verifierad.

Nästa minsta B3-snitt är en återanvändbar, offentlig deltagarspecifik
resultatgenväg från den filtrerade listan till en kompakt läsvy; ingen ny
inloggning eller privata readouts får bli synliga.

## Senast slutfört 2026-09-19: TASK089 publik deltagarspecifik resultatrapport

ADR-0108 och `TASK_089_PUBLIC_RESULT_DETAIL.md` låser att publik detaljlänk
aldrig bygger på namn eller interna UUID:n. Migration0055 tillför i stället en
additiv, slumpmässig och racebunden `publicResultId` per Entry. Listans format7
och den serverrenderade detaljvägen återanvänder exakt den redan validerade
publika resultatraden; fel race, okänd länk eller Entry utan publicerat resultat
returnerar ingen data.

Den oinloggade sidan länkar från kompakt lista till deltagarrapport med
klass, namn, klubb, status, tid, eftertid, avvikelser och sträckor. Den kan
poll:a samma säkra detaljkontrakt var femte sekund men exponerar aldrig Entry-,
revision-, course-, brick-, readout-, raw-, audit- eller evaluationdata.
Riktade contracts-/schema-/PostgreSQL-prover, 10 webtester, lint/typecheck,
production build samt ett 390 px Playwright-fall mot riktig Next/HTTP och
isolerad PostgreSQL17/PostGIS är gröna. Exakta kommandon och tider finns i
TASK089-dokumentet. Ingen deltagarinloggning, favorit, karta, GPS, ruttanalys,
stafett eller hårdvara ingår.

## Senast slutfört 2026-09-19: TASK090 lokala favoriter i publikresultat

`TASK_090_PUBLIC_RESULT_FAVORITES.md` avgränsar och implementerar favoriter som
en återställbar, racebunden browserpreferens för redan publika länkar. Listan
kan spara/ta bort en deltagare med text och `aria-pressed`, begränsas till egna
favoriter och behåller valet efter omladdning. Lagringen innehåller högst 50
deduplicerade `raceId`/`publicResultId`-par, aldrig namn, klubb, tid, bricka
eller intern identitet; korrupt eller blockerad lagring kan inte dölja resultat.

Riktade rena helper-/komponenttester (12/12), web lint/typecheck/build samt
det återanvända 390 px browserfallet mot riktig Next/HTTP och isolerad
PostgreSQL17/PostGIS är gröna. Inga API-anrop, migrationer, serverwrites,
inloggning, synk, karta, GPS, ruttanalys, stafett eller hårdvara ingår.

## Senast slutfört 2026-09-19: TASK091 atomisk klassbunden explicit omräkning

ADR-0109 och `TASK_091_ATOMIC_CLASS_RESULT_RECALCULATION.md` skrevs före
produktkod. En `MANAGE_RACE`-skyddad, separat GET/POST-väg kan nu granska och
atomiskt räkna om 1–100 uttryckligt valda, tekniskt redo deltagare i exakt en
klass. Klienten skickar aldrig en loop av individuella POST:ar: den fryser i
stället klass, snapshot, motor, canonical manifesthash och UUID-sorterat urval
under en idempotensnyckel.

Commit låser race och valda Entries, läser grunden på nytt och appenderar
antingen exakt en `EXPLICIT_RECALCULATION` per vald Entry tillsammans med
immutable gruppheader/items/audit, eller ingenting. Ny avläsning, revision,
brick-/klass-/snapshotförändring eller annat manifest ger konflikt utan delvis
gruppresultat. Äldre revisioner, rådata, manuella beslut, finaliseringar och
frysta XML-filer ändras inte. Adminytan har en egen svensk, responsiv sektion
med READY-val, granskning och exakt retry efter osäkert nätutfall.

Riktad verifiering med `CI=true`:

- contracts lint/typecheck: exit0; `class-result-recalculation` 2/2;
- database lint/typecheck: exit0; migration0056 applicerad mot isolerad
  PostgreSQL17 på loopback55484;
- application lint/typecheck: exit0; PostgreSQL-integrationsprov 2/2, inklusive
  exakt retry och ny avläsning mellan granskning/commit;
- web lint/typecheck: exit0; klient- och route-svit 32/32;
- E2E TypeScript och ESLint: exit0; Playwright 1/1 på 390 px med riktig
  Next/HTTP och samma isolerade PostgreSQL, inklusive avbrutet första svar och
  samma retry-body/-nyckel;
- web production build: exit0; kompilerade på 4,0 s, TypeScript på 5,7 s,
  7/7 statiska sidor på 51 ms.

Ingen full workspace-, full integrations- eller full browserregression kördes.
Ingen automatiserad klassomräkning, karta, GPS, rutt, stafett eller hårdvara
ingår.

## Nästa pågående snitt: TASK092 klassbunden kontrollneutralisering

ADR-0110 och `TASK_092_CLASS_CONTROL_NEUTRALIZATION.md` är skrivna före kod.
De avgränsar en enda neutraliserad `CourseControl`-förekomst per aktuell klass
och banversion. Beslutet måste vara append-only och öka snapshot, men skapar
ingen revision eller automatisk omräkning. Ingen avkortad bana, tidsrättning,
återtagande eller fler neutraliseringar är påbörjade.

## Senast slutfört 2026-09-19: TASK083 resultatpåverkan utan ban- eller resultatändring

ADR-0105 och `TASK_083_RESULT_BEARING_CLASS_IMPACT.md` skrevs före produktkod.
En MANAGE_RACE-skyddad GET-väg och en separat, initialt stängd `/manage`-panel
visar nu aktuell manuell bana, kontrollföljd, totalsummor och senaste
revisionshuvud per deltagare. Den visar namn, revision, status, publicering och
effektivt manuellt beslut, men aldrig råstämplar eller full evaluation.

Vägen är strikt läsande: den ändrar inte CourseVersion, Class, Entry,
ResultRevision, snapshot, audit eller requestjournal. IOF-objekt och korsande
scope är spärrade. TASK082:s resultatspärr ligger kvar; ingen omräkning,
publicering, finalisering eller IOF-export initieras av TASK083.

Slutlig riktad verifiering med CI=true:

- contracts lint/typecheck: exit0; TASK083-kontrakt 1/1 test på 3 ms;
- application lint/typecheck: exit0; PostgreSQL-integration 2/2 tester på 69 ms;
- web lint/typecheck: exit0; route-handler-svit 27/27 tester på 49 ms;
- E2E TypeScript och riktad E2E ESLint: exit0;
- Playwright TASK083: exit0, 1/1 test på 3,4 s (hela körningen 7,4 s) mot
  riktig Next/HTTP och isolerad PostgreSQL17/PostGIS på loopback55482;
- web production build: exit0; Next kompilerade på 3,7 s, TypeScript på 5,9 s,
  7/7 statiska sidor på 54 ms; checkin-skalets hash 95584b96a111.

Ingen full workspace-, full integrations- eller full browserregression kördes.
Den riktade läsvägen har kontrakts-, transaktions-, route- och browserbevis och
har inte ändrat resultatmotor, rådata eller hårdvarugräns.

## Senast slutfört 2026-09-19: TASK082 ny banversion för resultatfri manuell klass

ADR-0104 och TASK082 skrevs före produktkod. En separat MANAGE_RACE-väg kan nu
skriva en ny immutable CourseVersion för en manuell Course och länka om exakt en
redan länkad manuell Class. Entries behåller class, version, starttid och
brickkoppling. En enda resultatrevision för någon av klassens entries blockerar
hela transaktionen; inga äldre resultat, publiceringar eller finaliseringar
ändras och ingen auto-omräkning skapas.

Den svenska /manage-panelen gör först en skrivfri granskning av bana, version,
kontrollföljd, deltagare och resultat. Resultatunderlag spärrar bekräftelsen.
Utan resultat krävs explicit bekräftelse, och tappat commitsvar återförsöks med
exakt request-id och idempotensnyckel.

Migration0052 lägger till immutable requestjournal och ändrar endast
TASK081-journalens tidigare dynamiska class/version-FK till stabilt class/race-
scope; den ursprungliga CourseVersion har fortsatt egen FK till samma Course.
Det bevarar skapelsejournalens frozen ids när klassen senare pekar på ny version.
Ingen teknik- eller domängräns ändras.

Slutlig riktad verifiering med CI=true:

- contracts lint/typecheck: exit0; TASK082-kontrakt 2/2 tester;
- database lint/typecheck: exit0;
- application lint/typecheck: exit0; PostgreSQL-integration 4/4 tester;
- web lint/typecheck: exit0; route-handler-svit 26/26 tester;
- E2E TypeScript och riktad E2E ESLint: exit0;
- Playwright TASK082: exit0, 1/1 test på 3,7 s mot riktig Next/HTTP och
  isolerad PostgreSQL17/PostGIS på loopback55482;
- web production build: exit0; Next kompilerade på 4,0 s, TypeScript på 5,6 s,
  7/7 statiska sidor på 53 ms; checkin-skalets hash f76866cf9d46.

De två första browserförsöken var röda enbart på för snäva Playwright-lokatorer
i det nya testet; produktkoden var redan committad i den isolerade databasen.
Testet avgränsades till rätt select/textarea/alert och slutkörningen passerade.
Den tillfälliga PostgreSQL-instansen stoppades kontrollerat; syntetisk data
bevaras under /private/tmp/otid-task082-pg.m9w1co.

## Genomfört

TASK 001: första vertikala tävlingskärnan är implementerad 2026-08-30.

- pnpm-workspace med strikt TypeScript, Next.js-webb/API och worker-placeholder,
- PostgreSQL/PostGIS, Drizzle-schema, additiv migration och privat MinIO-Compose,
- ren resultatmotor för TASK 001-reglerna,
- atomär IOF EntryList/CourseData-import med original, rapport och officiellt
  strukturerade TASK 001-fixtures,
- idempotent simulatoringest med råpost, normalisering och resultatrevision,
- lokalt beständig simulatorkö med återställning och omsändning efter omladdning,
- arrangörsflöde, explicit klassomräkning, audit och revisionshistorik,
- offentlig resultatvy med senaste publicerade revision och femsekunders polling,
- reproducerbara fixtures/seeddata, CI, Vitest, PostgreSQL-integration och
  Playwright-flöde.

TASK 002A: ett avgränsat råtransport- och capturefundament är implementerat
2026-08-30.

- gemensamt `ByteTransport`-kontrakt, Web Serial-adapter och JSON-säkert
  Android/Capacitor-kontrakt utan native implementation,
- Node-serieadapter med explicit låst 8N1, `si:ports`, privat `si:capture` och
  verifierad `si:replay`,
- fsyncad auktoritativ WAL, atomisk finalisering, no-overwrite och återställning
  av längsta validerade prefix med byte-exakt och checksummad karantän av skadad suffix,
- strikt capture v1 med fullständiga serieparametrar, riktning, chunkgränser,
  monotona tider och SHA-256,
- uttryckligen syntetisk transportfixture; ingen parser eller kortavkodning.

TASK 002B har påbörjats med den verifierbara TypeScriptgränsen för Android:

- ADR-0008 låser nativegräns och `usb-serial-for-android` 3.11.0 (MIT),
- wire-kontraktet använder klient-ID, explicit portindex, full konfiguration och
  decimalsträngar för native sekvens/tid,
- konkret `AndroidUsbTransport` runtimevaliderar native events, filtrerar stale
  anslutningar, bevarar bytes, serialiserar writes och hanterar detach/fel,
- fake-plugin-tester verifierar gränsen,
- ett separat Capacitor/Android-skal och Kotlinbibliotek implementerar nu
  permission, portöppning, full seriekonfiguration, rå read/write,
  attach/detach/error och deterministisk cleanup,
- controllern är fake-testad utan protokolltolkning; dependency locks, strict
  checksum verification, Android lint samt app-/instrumenteringstest-APK finns,
- fysisk USB och körning av instrumenteringstest på enhet/emulator återstår.

TASK 004: konkurrenssäker multi-station-ingest är implementerad 2026-08-31.

- ADR-0010 låser `race -> entry -> revision` som gemensam PostgreSQL-låsordning,
- samtidiga ingests för samma deltagare allokerar obrutna append-only-revisioner,
- import och klassändring tar exklusivt lopplås medan utvärdering använder
  delat lopplås för en sammanhängande snapshot,
- device-batchsvaret är runtimevaliderat och binder kvittens till device,
  sekvens, hash, raw-id, paketstatus och serverresultat,
- stale och ahead paket accepteras för rådata men signaleras olika,
- simulatorn behåller sin lokala post vid fel device, sekvens, hash eller
  ogiltigt svarsformat,
- varje lokal post fryser queue/device/session-identitet; en kvittens tar bort
  exakt en post och HTTP-fel stoppar sekvensordnad flush,
- osäkra äldre/skadade köformer bevaras lokalt i karantän i stället för att
  skickas under en ny device-identitet,
- ingen databasmigration, SPORTident-kod eller ny resultatregel tillkom.

TASK 005A: signerat tävlingspaket och beständig stationskärna är implementerat
2026-08-31.

- strikt, deterministiskt och RS256-signerat paketkontrakt med separat betrodd
  SPKI-bootstrap,
- sammanhängande PostgreSQL-snapshot under lopplås och privat, `no-store`-märkt
  paketroute som är avstängd utan signing key och stationstoken,
- TypeScriptgräns som endast hämtar via HTTPS eller lokal utvecklingsadress,
  runtimevaliderar kuvertet och delegerar verifiering före lagring till native,
- separat Androidmodul `:otid-station-store` med app-privat SQLite,
- stabilt device-id, atomisk monoton sekvens + enqueue, append-only pakethistorik,
  outbox och kvittensreceipts samt bevarade `ACKNOWLEDGED`/`REJECTED`-poster,
- SQLite foreign keys, WAL och `synchronous=FULL`, med hela stationsdatabasen
  exkluderad från Android backup och device transfer,
- ingen PostgreSQL-migration, SPORTident-parser, lokal resultatutvärdering,
  fysisk USB, stafett eller GPS tillkom.

TASK 005B: lokal resultatmotor och operativ stationsvy är implementerat
2026-08-31.

- stationen läser tillbaka aktivt paket med native SHA-256- och UTF-8-kontroll
  samt TypeScript-runtimevalidering,
- simulatorhändelsen sparas i den crash-säkra outboxen innan den delade rena
  domänmotorn anropas,
- exakt motorversionsmatchning krävs; avvikelse lämnar readout kvar utan ett
  fabricerat lokalt resultat,
- lokal bedömning lagras separat, idempotent och append-only med bindning till
  device, sekvens, paket-, snapshot- och motorversion,
- SQLite schema 2 migrerar additivt från schema 1 utan omskrivning av identitet,
  paket eller köposter,
- ett svenskt touchanpassat UI visar internet, separat serverkontakt,
  uttryckligt simulator-/hårdvaruläge, paketversion och köstatus utan
  färgberoende,
- en reproducerbar, pinnad `esbuild`-bundle kopieras till Android-assets;
  token och betrodd SPKI hålls endast i formulär/minne,
- ingen serveruppladdning, SPORTident-parser, riktig USB, stafett eller GPS
  tillkom.

## Beslut

- Modulär monolit med enkel pnpm-workspace: ADR-0001.
- PostgreSQL/PostGIS och Drizzle med SQL-migrationer: ADR-0002.
- Immutabel rådata och append-only resultat/course-versioner: ADR-0003.
- Polling för offentlig vy i TASK 001: ADR-0004.
- Avgränsad IOF-validering utan olicensierat vendlat XSD: ADR-0005.
- Desktoptransport, privat captureformat och recoverysemantik: ADR-0006.
- SPORTident-protokollspecifik implementation stoppas vid auktoritativ käll- och
  licensgrind: ADR-0007.
- Androids råa USB-seriegräns, dependency pin och toolchaingrind: ADR-0008.
- Reproducerbar Androidverktygskedja och native-modulgräns: ADR-0009.
- Konkurrenssäker resultatrevision och paketmedveten ingestkvittens: ADR-0010.
- Signerade tävlingspaket och Androids beständiga stationslager: ADR-0011.
- Delad lokal resultatmotor, tvåstegslagring och minimal stationsbundle:
  ADR-0012.

## Avgränsning

Tävlingsdelen omfattar endast individuell tävling, IOF EntryList/CourseData,
simulator, ingest, resultatrevision, arrangörsvy och publikvy. Transportdelen
stannar före SPORTident-parser, station probe och kortnormalisering. Stafett,
Eventor, GPS, karttiles och avancerad autentisering är inte implementerade.
Androids råa native-adapter och beständiga stationslager är byggda, men ingen
riktig Android-/SPORTident-enhet har öppnats.

SPORTident-frameparsern är `NO-GO`: den officiella *PC Programmer's Guide* och
kommunikationsbiblioteket är tillgängliga endast på begäran, och publika källor
definierar inte length, CRC, DLE eller ACK/NAK tillräckligt för implementation.
Ingen protokollkod har gissats eller hämtats från AGPL/GPL-källor.

## Dokumentkonflikter

Inga konflikter identifierade mellan AGENTS.md, CODEX_BRIEF.md och TASK 001.

## Verifiering 2026-08-30

- `pnpm lint`: godkänd, 7 workspaceprojekt.
- `pnpm typecheck`: godkänd, 7 workspaceprojekt.
- `pnpm test`: godkänd, 17 enhetstester (6 domän + 7 IOF + 4 webb).
- `pnpm test:integration`: godkänd, 5 PostgreSQL/PostGIS-tester.
- `pnpm test:e2e`: godkänd, 2 Playwright-tester.
- `pnpm build`: godkänd, samtliga paket och Next.js 16.3.3.

## Verifiering efter TASK 002A 2026-08-30

- `CI=true pnpm install --frozen-lockfile`: godkänd, 10 workspaceprojekt.
- `CI=true pnpm lint`: godkänd, 9 av 10 workspaceprojekt med scripts.
- `CI=true pnpm typecheck`: godkänd, 9 av 10 workspaceprojekt med scripts.
- `CI=true pnpm test`: godkänd, 61 enhetstester totalt:
  24 transport, 20 SI-verktyg, 6 domän, 7 IOF och 4 webb.
- `TEST_DATABASE_URL=postgresql://localhost/otid_test CI=true pnpm test:integration`:
  godkänd, 5 PostgreSQL/PostGIS-tester.
- `DATABASE_URL=postgresql://localhost/otid_test TEST_DATABASE_URL=postgresql://localhost/otid_test CI=true pnpm test:e2e`:
  godkänd, 2 Playwright-tester.
- `CI=true pnpm build`: godkänd, samtliga paket och Next.js 16.3.3.
- `CI=true pnpm si:ports`: godkänd, 2 generiska macOS-portar, `opened: false`,
  `probed: false`, `sportidentSupportClaimed: false`.
- `CI=true pnpm si:replay fixtures/sportident/synthetic-transport-session/session.json`:
  godkänd; 5 fångade bytes, 2 RX-events och stabil summary-hash
  `65ee1faa24907204371a2929b41db89e00d108835af5edc855caedc4e61eb3c7`.

## Verifiering efter Android TypeScriptgräns 2026-08-30

- `CI=true pnpm lint`: exit 0; 9 av 10 workspaceprojekt med scripts.
- `CI=true pnpm typecheck`: exit 0; 9 av 10 workspaceprojekt med scripts.
- `CI=true pnpm test`: exit 0; 86 enhetstester totalt:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF och 4 webb.
- `TEST_DATABASE_URL=postgresql://localhost/otid_test CI=true pnpm test:integration`:
  exit 0 efter omkörning utanför sandboxens localhost-spärr; 5/5
  PostgreSQL/PostGIS-tester.
- `DATABASE_URL=postgresql://localhost/otid_test TEST_DATABASE_URL=postgresql://localhost/otid_test CI=true pnpm test:e2e`:
  exit 0; 2/2 Playwright-tester.
- `CI=true pnpm build`: exit 0; samtliga projekt med buildscript, inklusive
  Next.js 16.3.3.
- `CI=true pnpm si:ports`: exit 0 efter omkörning utanför sandboxens tsx
  IPC-spärr; 2 generiska macOS-portar, `opened: false`, `probed: false` och
  `sportidentSupportClaimed: false`.
- `CI=true pnpm si:replay fixtures/sportident/synthetic-transport-session/session.json`:
  exit 0 efter samma tsx-omkörning; oförändrad summary-hash
  `65ee1faa24907204371a2929b41db89e00d108835af5edc855caedc4e61eb3c7`.

## Kända begränsningar och antaganden

- IOF-adaptern validerar XML-syntax, exakt IOF 3.0-namnrymd/version och det
  använda officiella EntryList/CourseData-subsetet. Full XSD-täckning återstår:
  IOF-repositoryt saknar explicit återdistributionslicens för `IOF.xsd`, så
  schemat vendlas inte och full XSD-validering påstås inte.
- Simulatorns `localStorage`-kö är ett demonstrationsskal, inte den framtida
  crash-säkra SQLite-stationen. Reload och nätåterkomst är testade; process- och
  diskhaveri är inte det.
- Ingen riktig SPORTident-hårdvara är testad; alla kombinationer är `untested`.
- TASK 002:s parser, probe och kortavkodning förutsätter officiell
  protokollspecifikation med användbara licensvillkor, oberoende golden vectors
  och faktisk hårdvaruinventering.
- Androidvärden saknar JDK, Gradle, Android SDK, `adb`, emulator och Kotlin
  compiler som systeminstallation. En checksum-verifierad temporär JDK/SDK
  användes för nativebygget. Instrumenteringstestet är kompilerat men inte kört;
  fysisk USB-verifiering återstår och får inte räknas som genomförd.
- Docker/MinIO kunde inte köras i den lokala värdmiljön eftersom Docker saknas;
  PostgreSQL 17 + PostGIS 3.6 verifierades lokalt i stället.
- Arrangörs-API saknar produktionsautentisering och får bara användas lokalt.

## Verifiering efter Android nativegräns 2026-08-30

- `CI=true pnpm install --frozen-lockfile`: exit 0; 11 workspaceprojekt och
  oförändrat pnpm-lock.
- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 87 TypeScript-enhetstester:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF, 4 webb och 1 stationsgräns.
- `TEST_DATABASE_URL=postgresql://localhost:55432/otid_test CI=true pnpm test:integration`:
  exit 0; 5/5 PostgreSQL 17 + PostGIS 3.6-integrationstester.
- `DATABASE_URL=postgresql://localhost:55432/otid_test TEST_DATABASE_URL=postgresql://localhost:55432/otid_test CI=true pnpm test:e2e`:
  exit 0; 2/2 Playwright-tester. Den isolerade testservern stoppades därefter.
- `CI=true pnpm build`: exit 0; samtliga projekt med buildscript, inklusive
  stationens TypeScript och Next.js 16.3.3.
- Nativeverktyg: Temurin 21.0.12+8, Gradle 8.14.3, AGP 8.13.2, Kotlin 2.3.21,
  Android platform 36 revision 2 och build tools 35.0.0.
- `./gradlew --offline :otid-usb-serial:testDebugUnitTest :otid-usb-serial:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`:
  exit 0; 11/11 Kotlin/JVM-tester, lint 0 fel/1 versionsvarning/1 KTX-hint,
  app- och instrumenteringstest-APK byggda med strict dependency verification.
- App-APK SHA-256:
  `6bb32bdce8e6cbcdd284eb279b250a5e514d429b2492f407a87b2721d09c32b6`.
- Instrumenteringstest-APK SHA-256:
  `d58ac1c85052e08218f0ddfe45a16e2a7a452a9579f649f3342c4cb7d2e87d47`.
- `connectedDebugAndroidTest` kördes inte eftersom emulator/fysisk Androidenhet
  saknas. Ingen hårdvarustatus höjdes över `untested`.

## Verifiering efter TASK 004 2026-08-31

- `CI=true pnpm install --frozen-lockfile`: exit 0; samtliga 11 workspaceprojekt
  och 324 paket återanvändes från det låsta beroendeträdet.
- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 98 TypeScript-enhetstester:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF, 8 kontrakt, 7 webb och
  1 stationsgräns.
- `TEST_DATABASE_URL=postgresql://localhost:55432/otid_test CI=true pnpm test:integration`:
  exit 0; 14/14 tester mot PostgreSQL 17 + PostGIS 3.6. Sviten omfattar bland
  annat 2 och 10 samtidiga stationer för samma kort, 100 samtidiga exakta
  återförsök, partiellt avvisad batch och samtidig ingest/klassändring.
- `DATABASE_URL=postgresql://localhost:55432/otid_test TEST_DATABASE_URL=postgresql://localhost:55432/otid_test CI=true pnpm test:e2e`:
  exit 0; 3/3 Playwright-tester, inklusive att ett HTTP 500 stoppar ordnad
  flush och bevarar båda köposterna.
- `CI=true pnpm build`: exit 0; samtliga projekt med buildscript, inklusive
  Next.js 16.3.3.
- `pnpm android:test`: exit 0; Gradle `BUILD SUCCESSFUL`, 26 tasks.
- `pnpm android:lint`: exit 0; Gradle `BUILD SUCCESSFUL`, 74 tasks.
- `pnpm android:assemble`: exit 0; Gradle `BUILD SUCCESSFUL`, 119 tasks.
  Gradles befintliga `flatDir`-varningar för Capacitor kvarstår utan fel.
- Ingen databasmigration krävdes i TASK 004.

## Kvarvarande antaganden efter TASK 004

- Låsordning och idempotens är verifierade upp till 10 samtidiga stationer och
  100 samtidiga återförsök, men är ännu inte lasttestade mot V1-målet
  20 stämplingar per sekund och 1 000 samtidiga klienter.
- Simulatorns kö använder fortfarande `localStorage`. Den nya identitets- och
  kvittenssemantiken förhindrar ordningsfel och tyst borttagning, men lagringen
  är inte en crash-säker ersättning för stationens framtida SQLite-kö.
- Tävlingspaket är ännu inte signerade, enhetsparning saknas och arrangörs-API:t
  saknar produktionsautentisering.
- Inga SPORTident-protokollramar har tolkats och ingen riktig USB- eller
  SPORTident-hårdvara har testats; samtliga kombinationer är fortsatt
  `untested`.

## Verifiering efter TASK 005A 2026-08-31

- `CI=true pnpm install --frozen-lockfile`: slutlig körning exit 0; alla 11
  workspaceprojekt, låsfilen oförändrad och 324/324 paket återanvända. Första
  sandboxkörningen avbröts efter DNS-blockering och kördes om med nätåtkomst.
- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 115 TypeScript-enhetstester:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF, 17 kontrakt, 4 applikation,
  8 webb och 4 station.
- `TEST_DATABASE_URL=postgresql://otid@127.0.0.1:55433/otid_test CI=true pnpm test:integration`:
  slutlig körning exit 0; 16/16 tester mot isolerad PostgreSQL 17 + PostGIS 3.6,
  inklusive deterministiskt signerat paket och samtidig snapshotmutation.
- `DATABASE_URL=postgresql://otid@127.0.0.1:55433/otid_test TEST_DATABASE_URL=postgresql://otid@127.0.0.1:55433/otid_test CI=true pnpm test:e2e`:
  slutlig körning exit 0; 4/4 Playwright-tester, inklusive 401 utan personläcka,
  `no-store` och kryptografisk verifiering av det auktoriserade paketsvaret.
- `CI=true pnpm build`: exit 0; alla projekt med buildscript, inklusive
  stationens TypeScript och Next.js 16.3.3 med den privata paketroute:n.
- `pnpm android:test`: exit 0; Gradle `BUILD SUCCESSFUL`, 42 tasks och 14/14
  Kotlin/JVM-tester (11 USB + 3 stationslager).
- `pnpm android:lint`: exit 0; Gradle `BUILD SUCCESSFUL`, 112 tasks och 0 fel.
  Två dependency-versionvarningar och två KTX-hints kvarstår.
- `pnpm android:assemble`: exit 0; Gradle `BUILD SUCCESSFUL`, 167 tasks. App-,
  app-instrumenterings- och stationslager-instrumenterings-APK byggdes.
- App-APK SHA-256:
  `3fec60a491a7d8de2cbd002b27a692c0c5db3f0cc0c05b4aeb0e4c09bc30c7d2`.
- App-instrumenterings-APK SHA-256:
  `ae08d2d95e59223b321489087ab966b5ddd3e7f4911fcdccc4a5793fc46a8354`.
- Stationslager-instrumenterings-APK SHA-256:
  `783002908f31c7d49fb8d018597a67a0af582ee8dc3ff019a1fa961e04f383bc`.
- `connectedDebugAndroidTest` kunde inte exekveras. En temporär Android 11/API
  30 AOSP ATD-emulator startade QEMU men förblev `offline` i ADB efter upprepade
  cold boots med ren userdata. 11 stationslager- och 2 app-instrumenteringstester
  är därför kompilerade men inte runtime-körda.
- Ingen PostgreSQL-migration krävdes. Den isolerade testservern stoppades efter
  verifieringen.

Under verifieringen korrigerades två testinfrastrukturfel: en integrationstest-
förväntning duplicerade felaktigt `eventName` in i domänens `Race`, och
Playwright genererade först olika RSA-testnycklar i runner och worker. Ingen av
korrigeringarna ändrade produktionskontraktet eller domängränsen.

## Kvarvarande antaganden efter TASK 005A

- Androids SQLite-transaktioner, reopen-beteende, rollback och kvittenslogik är
  täckta av 13 kompilerade instrumenteringstester men ännu inte exekverade på en
  fungerande emulator eller fysisk Androidenhet.
- Stationens paketbootstrap är manuell bearer-token + betrodd SPKI. QR-parning,
  nyckelrotation och produktionsmässig roll-/enhetsautentisering återstår.
- Stationsdatabasen ligger i appens privata sandbox men är inte krypterad i vila.
- Paketet och outboxen finns lokalt, men stationen kör ännu inte resultatmotorn
  offline och har ingen operativ statusvy för internet, paketversion eller kö.
- Ingen verklig process-/strömförlust, två timmars fältdrift, fysisk USB eller
  SPORTident-hårdvara har verifierats; all SPORTidentstatus är fortsatt
  `untested`.

## Verifiering efter TASK 005B 2026-08-31

- `CI=true pnpm install --frozen-lockfile`: exit 0; alla 11 workspaceprojekt
  var redan uppdaterade mot låsfilen.
- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 128 TypeScript-enhetstester:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF, 20 kontrakt, 4 applikation,
  8 webb och 14 station.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test CI=true pnpm test:integration`:
  slutlig körning exit 0; 16/16 tester mot PostgreSQL 17 + PostGIS. En första
  körning använde den tidigare dokumenterade rollen `otid`, som inte fanns i
  den återanvända isolerade klustern; omkörning med klustrets ägarroll passerade
  utan kodändring.
- `DATABASE_URL=postgresql://127.0.0.1:55433/otid_test TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test CI=true pnpm test:e2e`:
  exit 0; 4/4 Playwright-tester.
- `CI=true pnpm build`: exit 0; alla projekt med buildscript, inklusive
  293,7 kB minifierad stationsbundle och Next.js 16.3.3.
- `pnpm android:test`: exit 0; Gradle `BUILD SUCCESSFUL`, 16/16 Kotlin/JVM-
  tester (11 USB + 5 stationslager).
- `pnpm android:lint`: exit 0; Gradle `BUILD SUCCESSFUL`, 0 lintfel; Gradles
  befintliga `flatDir`-/dependency-/KTX-varningar kvarstår.
- `pnpm android:assemble`: exit 0; Gradle `BUILD SUCCESSFUL`, 167 tasks. App-,
  app-instrumenterings- och stationslager-instrumenterings-APK byggdes.
- De 17 stationslager-instrumenteringstesterna och de befintliga 2 app-
  instrumenteringstesterna kompilerar men har inte exekverats på Androidenhet.
- Bundle byggdes två gånger med samma SHA-256 och kopian i Android-assets
  matchar: `5217496a3815e3aebb5873a9ecda46c3988be5c6eb72e29e04f28a701a6452e5`.
- App-APK SHA-256:
  `ef098f88e1f2a70a7bab6d3c1f8278b111d5730739ca1d6f334636c83f32ae5d`.
- App-instrumenterings-APK SHA-256:
  `ae08d2d95e59223b321489087ab966b5ddd3e7f4911fcdccc4a5793fc46a8354`.
- Stationslager-instrumenterings-APK SHA-256:
  `8ec06b796beb26de46646c8a10f40a06c93c8f9851b25242e0e059de9fec2c16`.
- Visuell browserkontroll i 412 × 915 verifierade ingen horisontell overflow,
  enkolumnsstatus och 68 px hög huvudtryckyta. Native status kunde inte köras i
  vanlig browser eftersom Capacitor-pluginen avsiktligt saknar webbimplementation.

## Kvarvarande antaganden efter TASK 005B

- SQLite migration, reopen, korruptionsskydd, transaktionsrollback och
  append-only-triggers täcks av kompilerade instrumenteringstester men är ännu
  inte runtime-verifierade på fungerande emulator eller fysisk Androidenhet.
- Lokal bedömning använder samma rena motor och exakt paketversion, men central
  uppladdning och jämförelse mot serverns auktoritativa resultatrevision ingår
  inte i detta snitt.
- UI-status för internet bygger på Android WebViews nätverksindikator; faktisk
  serverkontakt visas separat och uppdateras endast efter lyckad pakethämtning.
- Bootstrap är fortsatt manuell bearer-token + betrodd SPKI i minnet. QR-
  parning, rotation och produktionsmässig enhetsautentisering återstår.
- Stationsdatabasen är app-privat och backup-exkluderad men inte krypterad i vila.
- Ingen process-/strömavbrottstest, två timmars fältdrift, fysisk USB eller
  SPORTident-hårdvara har körts. All SPORTidentstatus är fortsatt `untested`.

## Genomfört i TASK 005C 2026-08-31

- ADR-0013 accepterar beständiga append-only ingestutfall, native HTTP och
  strukturerade centralobservationer innan implementationen påbörjades.
- PostgreSQL-migration `0001_task_005c_ingest_outcome.sql` lägger additivt till
  `device_ingest_outcome` med immutabilitetstrigger. Varje accepterat event får
  ett utfall i samma transaktion, även `UNKNOWN_CARD`.
- `ServerResultSummary` bär nu `evaluationHash`, SHA-256 över canonical JSON av
  hela runtimevaliderade `EvaluationResult`. Duplicate-retry läser ingestutfall
  först och behåller legacy-fallback till resultatrevision.
- Stationen använder Capacitors redan installerade native HTTP-adapter för både
  paket och synk. Synken är single-flight, skickar ett fryst event/request,
  validerar payload/hash och exakt svarsbijection samt ignorerar
  `highestContiguousSequence` som lokal ackmekanism.
- SQLite schema 3 migrerar sekventiellt 1→2→3 eller 2→3 och lägger till
  normaliserad icke-hemlig bas-URL samt append-only `server_ack_observation`.
  Receipt, ny observation och outboxövergång committas atomiskt. Identisk retry
  är idempotent och ett senare giltigt centralbesked appenderas.
- Stationsvyn visar beständig serverkontakt, serverns paketstatus och separat
  match, avvikelse, versionsskillnad, väntande, saknat central/lokal besked och
  rejection. Serverbedömningen märks alltid auktoritativ; lokal bedömning skrivs
  inte över.

## Verifiering efter TASK 005C 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 141 TypeScript-enhetstester:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF, 21 kontrakt, 5 applikation,
  8 webb och 25 station. Worker och database har inga testfiler och gick grönt
  med `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test CI=true pnpm test:integration`:
  slutlig körning exit 0; 20/20 tester mot isolerad PostgreSQL 17.11 + PostGIS
  3.6.4 från migrerad databas. Känd och okänd bricka återfår samma raw-id,
  fulla bedömning och hash efter tappat första svar; outcome är append-only.
- `DATABASE_URL=postgresql://127.0.0.1:55433/otid_test TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test CI=true pnpm test:e2e`:
  exit 0; 4/4 Playwright-tester. Första sandboxkörningen av integration/E2E
  blockerades av lokal socket/listen-policy (`EPERM`); samma kommandon kördes om
  med godkänd lokal åtkomst och passerade utan kodändring.
- `CI=true pnpm build`: exit 0; alla projekt med buildscript, inklusive 309,3 kB
  minifierad stationsbundle och Next.js 16.3.3.
- `pnpm android:test`: exit 0; Gradle `BUILD SUCCESSFUL`, 42 tasks och 18/18
  Kotlin/JVM-tester (11 USB + 7 stationslager), 0 fel/skippade.
- `pnpm android:lint`: exit 0; Gradle `BUILD SUCCESSFUL`, 112 tasks och 0
  lintfel. Befintliga `flatDir`- och två AndroidX versions-/KTX-hints kvarstår.
- `pnpm android:assemble`: exit 0; Gradle `BUILD SUCCESSFUL`, 167 tasks. App-,
  app-instrumenterings- och stationslager-instrumenterings-APK byggdes.
- De 17 stationslager-instrumenteringstesterna och de befintliga 2 app-
  instrumenteringstesterna kompilerar. Connected runtime kördes inte: ingen
  ADB-enhet fanns och API 30-emulatorn vägrade starta med endast 2,1 GiB ledigt
  diskutrymme. Inga artefakter raderades för att kringgå begränsningen.
- Stationsbundle och Android-assets matchar SHA-256:
  `ae35f9fe993b7445106ca887ea851056cf385783ff83795626136495932773ed`.
- App-APK SHA-256:
  `866b0ae0fb5cb8330249ff2903bd37838f9b69197359d36296e6cc461f516aa9`.
- App-instrumenterings-APK SHA-256:
  `ae08d2d95e59223b321489087ab966b5ddd3e7f4911fcdccc4a5793fc46a8354`.
- Stationslager-instrumenterings-APK SHA-256:
  `0faf1a535fe97075db008f7710edce55ff79aa02e535d62f26bf4fca93412149`.
- Den isolerade PostgreSQL-instansen stoppades efter verifieringen.

## Kvarvarande antaganden efter TASK 005C

- `/api/races/{raceId}/device-batches` saknar fortfarande
  produktionsautentisering och device-binding. Stationssynken skickar därför
  ingen skencredential och TASK 005C är inte färdig enhetsparning.
- Capacitor native HTTP, SQLite v3-migrationerna, rollback, reopen och triggers
  är byggda och deras 17 connected-tester kompilerar, men har inte runtime-körts
  på Android på grund av hostens diskutrymme. WebView-CORS används inte.
- Äldre `UNKNOWN_CARD` från före migration 0001 saknar både ingestutfall och
  resultatrevision; duplicate kan avsiktligt inte fabricera ett serverresultat.
- Positiva serverkvittensposter får enligt wirekontraktet fortfarande sakna det
  valfria `serverResult`; UI visar då uttryckligen att central detalj saknas.
- Ett event per HTTP-request är säkert men inte lasttestat mot V1-målet. Fler-
  event-batchning kräver en separat beständig batchgräns och ingår inte här.
- Paketbootstrap är fortsatt manuell bearer-token + betrodd SPKI i minnet.
  Endast bas-URL sparas. Credentialrotation och produktionsparning återstår.
- Stationsdatabasen är app-privat och backup-exkluderad men inte krypterad i vila.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005D 2026-08-31

- TASK 005D och ADR-0014 dokumenterade device-/race-/funktionsbunden auth,
  credentialrotation, append-only revocation och Android Keystore-gränsen innan
  implementationen påbörjades.
- PostgreSQL-migration `0002_task_005d_station_credentials.sql` lägger additivt
  till intern `station_device`, append-only `station_credential` och
  `station_credential_revocation`. Externt device-id är unikt men inte
  primärnyckel. Credential-, revocation- och auditposter kan inte uppdateras
  eller raderas.
- Credentialformatet är
  `otid_stn_v1.<credential-uuid>.<32-byte-base64url-secret>`. Servern lagrar
  endast SHA-256 över den slumpade secreten, använder 32-byte
  `timingSafeEqual` och dummyhash för okänt credential-id. Audit innehåller
  varken token eller secrethash.
- Betrodda CLI-kommandon utfärdar, roterar och spärrar credentials. Rotation
  skapar högre generation och lämnar äldre credential giltig tills explicit
  spärrning, så ett tappat provisioneringssvar inte låser stationen ute.
- Ingest och stationspaket använder samma server-only authmodell. Auth sker före
  bodyparsning/mutation. Saknad, felaktig, utgången eller spärrad credential ger
  generiskt 401; giltig credential med fel race/device/scope ger generiskt 403.
  Alla privata svar är `no-store` och globala `O_TID_STATION_PACKAGE_TOKEN` har
  tagits bort.
- Webbsimulatorn kräver en riktig utfärdad credential, håller den endast i
  minnet och skickar stabil `Idempotency-Key`. Ingen utvecklingsbypass finns.
- Android lagrar credentialen som AES-256-GCM-kuvert via en icke-exporterbar
  `AndroidKeyStore`-nyckel, AAD-bundet till app-id och beständigt device-id.
  `AtomicFile` i `noBackupFilesDir` används; SQLite ligger kvar på schema 3 och
  plugin-API:t returnerar endast credentialmetadata.
- Native `authorizedStationRequest` tillåter endast scopad GET av
  `station-package` och single-event POST av `device-batches`, konstruerar
  routen själv och injicerar Authorization. Caller kan inte ange headers eller
  läsa token efter installation. HTTPS krävs utom localhost/127.0.0.1.
- Stationsvyn visar saknad, aktiv, utgången eller ogiltig autentisering med text
  och symbol. Auth-, nät- och credentialfel stoppar ordnad flush utan att ändra
  outbox.

## Verifiering efter TASK 005D 2026-08-31

- `CI=true pnpm install --frozen-lockfile`: slutlig körning exit 0; 324/324
  paket återanvändes, 0 laddades ned. Två tidigare yieldade pnpm-processer hann
  samtidigt påbörja `node_modules`-rekonstruktion och DNS-retry; de identifierades
  och stoppades innan den seriella slutverifieringen.
- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 146 TypeScript-enhetstester:
  49 transport, 20 SI-verktyg, 6 domän, 7 IOF, 21 kontrakt, 6 applikation,
  7 webb och 30 station. Worker och database saknar testfiler och gick grönt
  med `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test CI=true pnpm test:integration`:
  exit 0; 23/23 tester mot PostgreSQL 17.11 + PostGIS 3.6.4, inklusive migration
  0002, strikt bearer, expiry, race/device/scope, rotation, idempotent revocation,
  hash-/auditsekretess och immutabilitet.
- `DATABASE_URL=postgresql://127.0.0.1:55433/otid_test TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test CI=true pnpm test:e2e`:
  slutlig körning exit 0; 5/5 Playwright-tester. De verifierar autentiserad
  simulator, beständig offlinekö, ordnat stopp, privat signerad paketdownload
  och 401/403 utan rawmutation eller privat läcka. Första körningen hade tre
  testsetupfel eftersom credential utfärdades före React skapat device-id;
  omkörning efter explicit väntan passerade utan produktionsändring.
- `CI=true pnpm build`: exit 0; alla projekt med buildscript, inklusive 311,4 kB
  minifierad stationsbundle och Next.js 16.3.3. Efter sista gränsharmonisering
  passerade dessutom riktad station lint, typecheck, 30/30 test och build.
- `pnpm android:test`: exit 0; Gradle `BUILD SUCCESSFUL`, 42 tasks och 23/23
  Kotlin/JVM-tester (11 USB + 12 stationslager), 0 fel/skippade.
- `pnpm android:lint`: exit 0; Gradle `BUILD SUCCESSFUL`, 112 tasks och 0
  lintfel. En AndroidX dependency-versionvarning och en KTX-hint kvarstår;
  dependency ändrades inte.
- `pnpm android:assemble`: exit 0; Gradle `BUILD SUCCESSFUL`, 167 tasks. App-,
  app-instrumenterings- och stationslager-instrumenterings-APK byggdes.
- Stationslagrets 26 instrumenteringstester, inklusive 5 nya för riktig
  Keystore/AES-GCM, unik ciphertext/IV, reopen, rotation, AtomicFile-rollback,
  manipulation, borttagen nyckel, native route/header och oförändrad outbox,
  kompilerar. Appens 2 instrumenteringstester kompilerar också. `adb devices -l`
  visade ingen ansluten enhet, så de runtime-kördes inte; den tidigare API 30-
  emulatorn kan inte startas med hostens 2,1 GiB fria utrymme.
- Stationsbundle och Android-assets matchar SHA-256:
  `fae311411326c116f81402bef64a09954d9daf1e9ce17f4bfad1455ab6cb1ce0`.
- App-APK SHA-256:
  `0a538017f96807f64bbe4472cd8e580efa51cc9f1a3d16b3ce621f7d7e94b760`.
- App-instrumenterings-APK SHA-256:
  `ae08d2d95e59223b321489087ab966b5ddd3e7f4911fcdccc4a5793fc46a8354`.
- Stationslager-instrumenterings-APK SHA-256:
  `975f67c0a4ac1780037db892ad1933d845e0f712f93fec2a2d72c0bcb6be5fd4`
  (4 336 384 bytes).
- Den isolerade PostgreSQL 17-instansen på port 55433 stoppades efter
  verifieringen.

## Kvarvarande antaganden efter TASK 005D

- Provisionering är en betrodd direktdatabas-CLI och manuell JSON-installation,
  inte färdig engångs-/QR-parning. Arrangörsinloggning, kortlivat grant,
  rate limiting och recoveryflöde återstår.
- De nya Keystore-, AtomicFile- och native HTTP-testerna är kompilerade men inte
  runtime-körda på emulator eller fysisk Androidenhet. Hårdvarubacking/StrongBox
  krävs inte och har inte verifierats.
- En spärrad servercredential ligger kvar krypterad lokalt. Servern svarar 401,
  pending bevaras och operatören måste installera en ny generation; stationen
  raderar inte credential automatiskt från ett nätbesked.
- Credentialen är krypterad separat, men tävlingspaket, persondata och outbox i
  appens privata, backup-exkluderade SQLite är inte full-disk-krypterade av appen.
- Ett event per HTTP-request och credentialuppslag är inte lasttestat mot V1-
  målen 20 stämplingar/s och 1 000 samtidiga klienter.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005E 2026-08-31

- `TASK_005E_ONE_TIME_STATION_PAIRING.md` och ADR-0015 dokumenterade snittet,
  säkerhetsgränsen och återupptagningsreglerna före bred implementation.
- PostgreSQL-migration `0003_task_005e_station_pairing.sql` lägger additivt till
  append-only pairing grant, revocation, attempt och redemption. Grantet gäller
  högst 15 minuter och servern sparar endast SHA-256 över den slumpade token-
  secreten; native-genererad credential-secret lämnar aldrig stationen i klartext
  utom i det autentiserade redeem-anropet och sparas endast hashad på servern.
- Betrodda CLI-kommandon utfärdar och spärrar grant. Redemption är global och
  autentiseras före bodyparsning, kräver exakt schema och stabil
  `Idempotency-Key`, och skapar högst en credential per grant. Exakt replay är
  read-only och fungerar efter grant-expiry så länge credentialen är giltig.
- Fem felaktiga försök per grant under tio minuter lagras i PostgreSQL under
  grantets radlås. Därefter svarar endpointen generiskt 429 utan fortsatt
  skrivförstärkning; replay av ett redan lyckat exakt försök förblir möjlig.
- Android skapar attempt-id och credential-secret med `SecureRandom`, krypterar
  pendingstate med separat Android Keystore AES-256-GCM/AAD och skriver via
  `AtomicFile` i `noBackupFilesDir` innan nätverk får användas. Installerad
  credential ersätter därefter pendinghemligheterna med en krypterad,
  icke-hemlig completed-markör.
- Native API och stations-UI erbjuder begin, explicit resume, status och
  bekräftad discard. De visar none/pending/completed/invalid med text och symbol,
  tömmer tokenfältet och exponerar aldrig grant, credential-secret eller hash.
  Den tidigare publika manuella credentialinstallationen är borttagen.
- Befintlig signerad paketdownload, autentiserad ingest, SQLite/outbox,
  resultatmotor och idempotensgränser är oförändrade. Ingen arrangörsinloggning,
  QR-rendering/kamera, SPORTidentparser, riktig USB, stafett eller GPS ingår.

## Verifiering efter TASK 005E 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 161/161 TypeScript-tester: 49 transport,
  20 SI-verktyg, 6 domän, 7 IOF, 23 kontrakt, 6 applikation, 14 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test_005e_final CI=true pnpm test:integration`:
  exit 0; 32/32 tester mot en ren, migrerad PostgreSQL 17-databas. Testerna
  omfattar 100 samtidiga redeem-försök, exakt replay, payloadmutation,
  expiry/revocation, rate limit, hash-/auditsekretess och append-only-skydd.
- `DATABASE_URL=postgresql://127.0.0.1:55433/otid_test_005e_final TEST_DATABASE_URL=postgresql://127.0.0.1:55433/otid_test_005e_final CI=true pnpm test:e2e`:
  exit 0; 7/7 Playwright-tester, inklusive pairing till autentiserad
  paketdownload och idempotent ingest samt auth-före-body och felgräns utan
  credential- eller rawmutation.
- `CI=true pnpm build`: exit 0; alla projekt med buildscript, inklusive 318,4 kB
  minifierad stationsbundle och Next.js 16.3.3.
- `pnpm android:test`: exit 0; Gradle `BUILD SUCCESSFUL`, 42 tasks och 27/27
  Kotlin/JVM-tester (11 USB + 16 stationslager), 0 fel/skippade.
- `pnpm android:lint`: exit 0; Gradle `BUILD SUCCESSFUL`, 112 tasks och 0
  lintfel. Befintliga `flatDir`-, AndroidX dependency-version- och KTX-varningar
  kvarstår; inga beroenden ändrades för att tysta dem.
- `pnpm android:assemble`: exit 0; Gradle `BUILD SUCCESSFUL`, 167 tasks. App-,
  app-instrumenterings- och stationslager-instrumenterings-APK byggdes.
- Stationslagrets 30 instrumenteringstester, inklusive 4 nya pairingtester för
  Keystore/AtomicFile, reopen/exakt begin, nätfel/exakt replay, crashgränser och
  discard, kompilerar. Appens 2 instrumenteringstester kompilerar. De
  runtime-kördes inte eftersom ingen ADB-enhet fanns och hosten inte kunde
  starta en emulator.
- Stationsbundle och kopierad Android-asset matchar SHA-256:
  `a5d21d0c98b206c2ce05b9d35d5ea15c247b8c2c087cdc30d0750b230cbcbd9e`.
- App-APK SHA-256:
  `1102558b1268e4f034c8007e3ae0e50d0658fb3a96aaba6d59c1c68f07a49ac3`
  (4 592 363 bytes).
- App-instrumenterings-APK SHA-256:
  `ae08d2d95e59223b321489087ab966b5ddd3e7f4911fcdccc4a5793fc46a8354`.
- Stationslager-instrumenterings-APK SHA-256:
  `ef8f0246ce08c0f2ce189416474ab308f237b55d1c33f524c04e3d68f8a17626`
  (4 409 273 bytes).
- Den isolerade PostgreSQL 17-instansen på port 55433 stoppades kontrollerat
  efter verifieringen.

## Kvarvarande antaganden efter TASK 005E

- Grant utfärdas och spärras av en betrodd lokal CLI med direkt
  databasanslutning. Arrangörsinloggning, behörighetskontroller och administrativt
  UI är ännu inte implementerade.
- Token överförs som text. QR-rendering, kamera och säker fysisk överlämning är
  utanför snittet; HTTPS krävs utom för localhost i utveckling.
- Keystore-, AtomicFile- och native HTTP-instrumenteringstesterna kompilerar men
  är inte runtime-körda på emulator eller fysisk Androidenhet. Hårdvarubackad
  nyckel/StrongBox krävs inte och har inte verifierats.
- Serverns pairingbegränsning är konsekvent i PostgreSQL men inte distribuerat
  lasttestad. Ett event per ingestrequest och credentialuppslag är inte
  lasttestat mot V1-målen 20 stämplingar/s och 1 000 samtidiga klienter.
- Tävlingspaket, persondata och outbox i appens privata, backup-exkluderade
  SQLite är inte full-disk-krypterade av appen.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005F 2026-08-31

- `TASK_005F_AUTHENTICATED_PAIRING_ADMIN.md` och ADR-0016 dokumenterade det
  avgränsade snittet och dess säkerhetsgräns före bred implementation. Tre
  oberoende read-only-auditar bekräftade först att tidigare admin saknade
  identitet/raceaccess, att servergenererad pairingsecret inte var retry-säker
  och att audit saknade aktör.
- Migration `0004_task_005f_pairing_admin.sql` lägger additivt till individuellt
  märkt, racebunden `PAIR_STATION`-accesscredential, kort serverlagrad session
  och append-only revocation för båda. Endast SHA-256 lagras. Accesscredential
  gäller högst 24 timmar, session högst åtta timmar och aldrig förbi credential-
  expiry. Pairinggrant får nullable issuer och audit får nullable actor/request
  så äldre data förblir giltig.
- Betrodd CLI kan utfärda och spärra accesscredential. Login skapar separata
  session- och CSRF-secrets; produktion använder host-only `__Host-`-cookies,
  `Secure`, `SameSite=Strict`, `Path=/` och HttpOnly endast för sessionen.
  Logout och credentialrevocation slår igenom append-only vid varje request.
- Den nya ytan `/admin/{raceId}/pairing` och dess API:er kräver exakt canonical
  Origin, race/capability, session och constant-time CSRF. Osäkra routes läser
  body först efter autentisering under sessionsradlås; JSON är strikt och högst
  4 KiB. Svar och sida är privata/no-store, no-referrer, nosniff och skyddade
  mot inramning. Ingen credentialed cross-origin CORS öppnas.
- Webbläsaren skapar grant-id och 32-byte secret med Web Crypto och skickar
  endast hash. Servern sätter READOUT, tio minuters grant och strikt 8/24/72
  timmars credentialexpiry. Samma actor/race/id/hash är exakt idempotent;
  ändrad hash, actor eller kontext ger konflikt utan ny audit.
- UI:t håller accesscredential och pairingsecret endast i minnet, erbjuder
  explicit retry med samma secret efter okänd commit, visar full token en gång
  och kan därefter endast lista metadata, spärra och ersätta. Status visas med
  text och symbol som ACTIVE/REDEEMED/REVOKED/EXPIRED. Ett inlöst grants spärr
  presenteras uttryckligen som icke-retroaktiv för stationcredentialen.
- Grant- och sessionsmutationer följer sessions→grant-låsning. Revoke före
  redeem blockerar inlösen; redeem före revoke lämnar den redan skapade
  stationcredentialen giltig. Hundra samtidiga issue respektive revoke ger
  exakt en beständig mutation och en actor-bunden auditpost.
- Befintlig 005E-redemption, signerad paketdownload, autentiserad ingest,
  SQLite/outbox, resultatmotor och övriga domängränser är oförändrade. Ingen
  generell arrangörsidentitet, QR/kamera, SPORTidentparser, riktig USB, stafett
  eller GPS ingår.

## Verifiering efter TASK 005F 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 193/193 TypeScript-tester: 49 transport,
  20 SI-verktyg, 6 domän, 7 IOF, 26 kontrakt, 6 applikation, 43 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55434/otid_005f_final CI=true pnpm test:integration`:
  exit 0; 37/37 tester mot en tom från början och migrerad PostgreSQL 17-
  databas. Bevisen omfattar hash-only, expiry/race/CSRF, auth före body,
  append-only, 100 samtidiga issue, 100 samtidiga revoke, actor-idempotens,
  sessionspärr och båda ordningarna mellan revoke och redeem.
- `DATABASE_URL=postgresql://127.0.0.1:55434/otid_005f_final TEST_DATABASE_URL=postgresql://127.0.0.1:55434/otid_005f_final CI=true pnpm test:e2e`:
  exit 0; 9/9 Playwright-tester. De nya flödena verifierar cookies, login/logout,
  Web Crypto-issue, engångsvisning utan URL/Web Storage, metadata/revoke/redeem,
  fungerande stationcredential samt avvisad CSRF, Origin och race utan mutation.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 319,5 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Den dynamiska
  pairing-sidan och samtliga fem nya HTTP-handlers ingår.
- Den byggda standalone-sidan svarade 200 med exakt `Cache-Control: private,
  no-store`, CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` och avstängd
  kamera/geolocation/mikrofon. Nexts utvecklingsserver använder avsiktligt
  `no-cache, must-revalidate`; deklarerad och byggd produktionspolicy är
  `private, no-store`.
- Den isolerade PostgreSQL 17-instansen på port 55434 stoppades kontrollerat
  efter verifieringen.

## Kvarvarande antaganden efter TASK 005F

- Endast pairingadminytan är produktionsautentiserad. Befintlig import,
  klassändring, omräkning och övrig `/admin` är fortsatt utvecklingsyta och får
  inte exponeras som produktionssäker.
- Accesscredential bootstrap sker genom betrodd CLI med direkt
  databasanslutning. Generell arrangörsidentitet, raceägarskap, recovery, OIDC
  och delegerad administration är inte definierade.
- Produktionscookieattributen är route-/enhetstestade och produktionssidans
  headers är körda i standalone, men ett verkligt HTTPS/reverse-proxyflöde med
  canonical `O_TID_PUBLIC_ORIGIN`, proxy-rate-limit och operativ
  credentialöverlämning är inte driftsatt eller penetrationstestat.
- Pairingtoken överförs fortfarande som text. QR-rendering, kamera och annan
  fysisk överlämning är utanför snittet.
- PostgreSQL-låsning och hundra samtidiga anrop är lokalt verifierade men inte
  distribuerat lasttestade mot V1-målen 20 stämplingar/s och 1 000 samtidiga
  klienter.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005G 2026-08-31

- `TASK_005G_AUTHENTICATED_IOF_IMPORT.md` och ADR-0017 låste det avgränsade
  snittet före implementation: capability-separerad, racebunden och actor-
  auditerad IOF CourseData-/EntryList-import. Tre read-only-auditar granskade
  befintlig importatomik, webbsäkerhet och XML-/idempotensrisker först.
- Migration `0005_task_005g_authenticated_iof_import.sql` utökar additivt
  capabilityn med `IMPORT_IOF`, auditaktören med
  `IOF_IMPORT_ACCESS_CREDENTIAL`, lägger 8-timmars databasgräns på
  importcredential, skapar append-only `iof_import_request` med request-UUID som
  primärnyckel och gör både requesten och `import_file` oföränderliga.
- Pairing och import återanvänder samma hash-only credential-/sessionmekanik men
  har separata prefix, browsercookies och race-scopade login/logout-routes.
  Login verifierar race och capability före sessionsinsert; revoke är också
  capability-bundet. Importcredential gäller högst åtta timmar och sessionen
  högst en timme.
- Den tidigare öppna multipart-routen är ersatt, inte kompletterad med en
  parallell bypass. Routen kräver canonical Origin, importsessionscookie,
  race/capability och CSRF före första bodybyte. Den accepterar endast rå
  `application/xml`, 1–5 000 000 faktiska bytes och strikt UTF-8 oberoende av
  `Content-Length`.
- DTD, DOCTYPE och ENTITY avvisas före parserarbete och entitybehandling är
  avstängd. Servern hashar exakt accepterade råbytes, inklusive BOM. Parsning
  sker före mutationstransaktionen; samma session kontrolleras igen under
  session-/credentiallås före exklusivt racelås.
- Request-id binder actor, race, serverhash, importfil och ursprungligt utfall.
  Exakt retry återger samma metadata, ändrad kontext ger konflikt och samma
  innehåll under nytt request-id skapar endast ett duplicate-requestspår. Första
  lagringen committar domänobjekt, importoriginal, request, snapshotökning och
  en sekretessbegränsad actor-audit atomärt.
- Den separata svenska sidan `/admin/{raceId}/imports` håller credential, `File`,
  SHA-256 och request-id endast i React-minne. Den omsänder aldrig automatiskt,
  behåller exakt försök efter okänd commit/401/403 och rensar först efter
  bekräftat utfall eller explicit operatörsval. Pairingytan använder nu också
  race-scopad login utan att befintliga grants eller sessionsrader migreras.
- Endast IOF-importmutationen har blivit produktionsautentiserad. Eventor,
  StartList, ResultList, tävlingsskapande, klassändring, explicit omräkning,
  QR/kamera, SPORTidentparser, riktig USB, stafett och GPS ingår inte.

## Verifiering efter TASK 005G 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 229/229 TypeScript-tester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 30 kontrakt, 6 applikation, 71 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55437/otid_005g_final2 CI=true pnpm test:integration`:
  exit 0; 43/43 tester mot en tom från början och migrerad PostgreSQL 17/PostGIS-
  databas. Bevisen omfattar 100 samtidiga exact retries, contextkonflikter,
  content-duplicate, råbytehash/BOM, atomik, capability/logout/revocation,
  append-only triggers och auditsekretess.
- `DATABASE_URL=postgresql://127.0.0.1:55437/otid_005g_final2 TEST_DATABASE_URL=postgresql://127.0.0.1:55437/otid_005g_final2 CI=true pnpm test:e2e`:
  exit 0; 10/10 Playwrighttester. Importflödet verifierar separata cookies,
  verklig filupload, en servercommit vars svar tappas, bevarat request-id och
  explicit exact retry utan dubbel mutation. Två tidigare omkörningar nådde
  9/10 men föll på tvetydiga Playwright-locatorer i det nya testet; locatorerna
  gjordes entydiga och slutkörningen blev helt grön.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 321,0 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Import-/pairing-
  sessionsroutes och den dynamiska importsidan ingår; den gamla globala
  pairingsessionsrouten finns inte i builden.
- Den byggda standalone-importsidan svarade 200 med exakt `Cache-Control:
  private, no-store`, CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` och avstängd
  kamera/geolocation/mikrofon. Den isolerade PostgreSQL 17-instansen stoppades
  kontrollerat och dess temporära katalog togs bort efter verifieringen.

## Kvarvarande antaganden efter TASK 005G

- Endast pairing- och IOF-importmutationerna är produktionsautentiserade.
  Tävlingsskapande, klassändring, explicit omräkning, simulator och read-only
  `/admin` är fortsatt utvecklingsytor och får inte exponeras som en samlat
  produktionssäker arrangörsportal.
- Bootstrap och revocation av accesscredentials sker genom betrodd CLI med
  direkt databasanslutning. Generell arrangörsidentitet, raceägarskap, recovery,
  OIDC och delegerad administration är inte definierade.
- Canonical HTTPS-origin, reverse-proxy-bodygräns/rate-limit, operativ
  credentialöverlämning, penetrationstest och backup/restore är inte driftsatta.
  Applikationsgränsen buffrar avsiktligt högst fem megabyte efter auth.
- IOF-stödet är fortsatt den dokumenterade CourseData-/EntryList-delmängden utan
  vendlat XSD. Eventor, StartList, ResultList och fler IOF-varianter är inte
  implementerade eller utlovade.
- PostgreSQL-låsning och hundra samtidiga anrop är lokalt verifierade men inte
  distribuerat lasttestade mot V1-målen. Okänd commit är browsertestad lokalt,
  inte genom verklig proxy eller nätverksavbrott i drift.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005H 2026-08-31

- `TASK_005H_AUTHENTICATED_ENTRY_CLASS_CHANGE.md` och ADR-0018 låste det
  avgränsade snittet före implementation. Tre read-only-auditar granskade den
  öppna PATCH-routen, optimistic concurrency, retry, capabilityseparation och
  UI/dataexponering. Arkitektur-, domän-, offline- och acceptansdokument
  uppdaterades innan bred kodändring.
- Migration `0006_task_005h_authenticated_entry_class_change.sql` lägger
  additivt till `CHANGE_ENTRY_CLASS`, auditaktören
  `ENTRY_CLASS_ACCESS_CREDENTIAL`, en capabilityspecifik åttatimmarsgräns och
  append-only `entry_class_change_request`. Tabellen har servergenererat
  internt UUID-PK, separat unikt request-id, actor/race/entry/klassbindning,
  konsekvenschecks och trigger som avvisar update/delete.
- Credential-/sessionssubstratets policy är nu exhaustiv för `PAIR_STATION`,
  `IMPORT_IOF` och `CHANGE_ENTRY_CLASS`. Klasscredential har eget prefix,
  `otid_org_entry_class_v1`, högst åtta timmars livslängd, högst en timmes
  session och egna session-/CSRF-cookies. Betrodd CLI kan utfärda och spärra
  endast denna capability.
- Den tidigare öppna klass-PATCH-routen är ersatt, inte kompletterad med en
  parallell bypass. Origin, klassession, race/capability, CSRF och canonical
  idempotency-key verifieras före första bodybyte. Endast strikt JSON i högst
  4 KiB och strikt UTF-8 accepteras; interna feltexter returneras aldrig.
- `expectedEntryVersion` binder operatörens observerade avsikt. Mutationens
  låsordning är session→credential→race→request-advisory→entry. Exakt retry
  återger ursprungliga metadata utan ny mutation; ändrad requestkontext, stale
  version och no-op ger konflikt utan journal-, audit- eller versionschurn.
- Första giltiga ändring uppdaterar klass och entry-version, ökar snapshot exakt
  ett samt appenderar requestjournal och sekretessbegränsad actor-audit i samma
  transaktion. Klassändringen skapar uttryckligen ingen `ResultRevision` och
  anropar aldrig explicit omräkning.
- Den separata svenska sidan `/admin/{raceId}/classes` serverrenderar endast ett
  privat shell. Ett capabilityskyddat GET-anrop lämnar minimalt deltagarunderlag
  efter auth. Credential och pending request hålls endast i React-minne; okänd
  commit eller authfel kan retryas explicit med samma request-id. Bekräftat
  besked säger att resultatet inte är omräknat.
- Den öppna klasskontrollen togs bort från det generella adminshellet. Befintlig
  explicit omräkning ligger kvar som separat och tydligt märkt öppen
  utvecklingsfunktion; dess route och domänsemantik ändrades inte.
- Eventskapande, simulator, generell read-only-admin, explicit omräkning,
  Eventor, StartList/ResultList, QR/kamera, SPORTidentparser, riktig USB, stafett,
  GPS och automatisk omräkning ingår inte.

## Verifiering efter TASK 005H 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 265/265 TypeScript-tester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 35 kontrakt, 7 applikation, 101 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55438/otid_005h_final CI=true pnpm test:integration`:
  exit 0; 49/49 tester mot en tom från början och fullmigrerad PostgreSQL 17/
  PostGIS-databas. Bevisen omfattar separat capability/prefix/race/livslängd,
  minimalt listunderlag, 100 samtidiga exact retries, requestkontext, stale,
  no-op, cross-race, två skilda requests för samma version, replay efter senare
  ändring, logout/revocation, immutabilitet, auditsekretess och oförändrat antal
  resultatrevisioner.
- `DATABASE_URL=postgresql://127.0.0.1:55438/otid_005h_final TEST_DATABASE_URL=postgresql://127.0.0.1:55438/otid_005h_final CI=true pnpm test:e2e`:
  slutkörning exit 0; 11/11 Playwrighttester. Klassflödet verifierar separat
  cookie/session, skyddat deltagarunderlag, riktig klasscommit vars svar tappas,
  bevarat request-id, explicit exact replay, exakt en journal/audit/snapshot-
  ökning, ingen resultatrevision samt rensade cookies/hemligheter.
- Två tidigare fulla E2E-försök nådde 10/11 men testets första tappat-svar-
  simulering försökte hantera samma Playwright-route två gånger. En fokuserad
  omkörning med browserns fetch-svar tappat efter verklig HTTP-commit blev 1/1,
  varefter hela slutkörningen blev 11/11.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 323,4 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Klassidan,
  sessionroute, privat data-GET och ersatt PATCH-route ingår.
- Den byggda standalone-klassidan svarade 200 med exakt `Cache-Control: private,
  no-store`, CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` och avstängd
  kamera/geolocation/mikrofon. Den isolerade PostgreSQL 17-instansen stoppades
  kontrollerat och dess temporära katalog togs bort.

## Kvarvarande antaganden efter TASK 005H

- Endast pairing-, IOF-import- och klassändringsmutationerna är
  produktionsautentiserade. Tävlingsskapande, explicit omräkning, simulator och
  generell read-only `/admin` är fortsatt utvecklingsytor. Det generella
  adminshellet visar fortfarande deltagardata för dessa utvecklingsfunktioner
  och får inte exponeras som en samlat säker arrangörsportal.
- Accesscredential bootstrap/revocation sker genom betrodd CLI med direkt
  databasanslutning. Generell arrangörsidentitet, raceägarskap, recovery, OIDC
  och delegerad administration är inte definierade.
- Canonical HTTPS-origin, reverse-proxy-rate-limit/bodygräns, operativ säker
  credentialöverlämning, penetrationstest och backup/restore är inte driftsatta.
  Klassrouten har en verifierad applikationsgräns på 4 KiB efter auth.
- En klassändring räknar avsiktligt inte om resultat. En station med ett redan
  installerat paket ser inte ändringen förrän ett nytt signerat paket hämtas och
  installeras.
- PostgreSQL-låsning och hundra samtidiga anrop är lokalt verifierade men inte
  distribuerat lasttestade mot V1-målen. Okänd commit är browsertestad lokalt,
  inte genom verklig proxy eller nätverksavbrott i drift.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005I 2026-08-31

- `TASK_005I_AUTHENTICATED_RESULT_RECALCULATION.md` och ADR-0019 låste det
  avgränsade snittet före implementation. Tre read-only-auditar granskade den
  öppna POST-routen, resultat-/låsgränsen, retrykontraktet och kandidatytans
  dataminimering. Arkitektur-, domän-, offline- och acceptansdokument
  uppdaterades innan bred kodändring.
- Migration `0007_task_005i_authenticated_result_recalculation.sql` lägger
  additivt till capabilityn `RECALCULATE_RESULT`, auditaktören
  `RESULT_RECALCULATION_ACCESS_CREDENTIAL`, revisionsorsaken
  `EXPLICIT_RECALCULATION`, en capabilityspecifik åttatimmarsgräns och den
  append-only requestjournal som binder hela det frysta intentet till exakt en
  immutable resultatrevision.
- Credentialen har eget prefix, `otid_org_result_recalc_v1`, högst åtta timmars
  livslängd, högst en timmes session och helt egna session-/CSRF-cookies.
  Betrodd CLI kan utfärda och spärra endast denna capability.
- Den tidigare öppna omräknings-POST-routen är ersatt utan parallell bypass.
  Origin, session, race/capability, CSRF och canonical idempotency-key verifieras
  före body. Endast strikt JSON i högst 4 KiB och strikt UTF-8 accepteras;
  samma session och credential kontrolleras igen under radlås före commit.
- Det privata kandidat-GET-anropet lämnar namn/organisation, klass,
  entry-/snapshotversion, readiness, assignment-/readout-id och senaste
  revisionsmetadata. Bricknummer, punches, full evaluation, rawdata och
  credentialmetadata lämnas inte.
- Ett omräkningsförsök fryser entry, klass, snapshot, exakt assignment,
  deterministiskt senaste readout, senaste revision och motorversion. Låsordning
  är session→credential→race SHARE→request advisory→entry UPDATE→revision.
  Exakt retry läses före aktuell resultatstatus och returnerar den ursprungliga
  revisionen utan write; ändrad eller stale kontext ger konflikt.
- Första giltiga request skapar atomiskt en publicerad
  `EXPLICIT_RECALCULATION`-revision, requestjournal och
  `RESULT_RECALCULATED_BY_ADMIN`-audit. Entry, klass, snapshot, assignment,
  readout och rådata ändras inte. Den äldre trusted use casen och historiska
  `CLASS_CHANGE_RECALCULATION` är oförändrade.
- Den separata svenska sidan `/admin/{raceId}/recalculation` håller credential
  och pending intent endast i React-minne. Okänd commit och authfel behåller
  exakt försök för explicit retry; definitiva fel rensar det. Den öppna knappen
  togs bort från det generella adminshellet och ersattes med en länk.
- Ingen generell rollmodell, automatisk omräkning, Eventor, StartList/ResultList,
  QR/kamera, SPORTidentparser, riktig USB, stafett eller GPS tillkom.

## Verifiering efter TASK 005I 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 303/303 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 40 kontrakt, 8 applikation, 133 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0007 kördes mot en från början tom PostgreSQL
  17/PostGIS-databas: `pnpm db:migrate` exit 0 och
  `Databasmigrationer klara`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55439/otid_005i_final CI=true pnpm test:integration`:
  exit 0; 60/60 tester. 005I-bevisen omfattar capability/prefix/livslängd,
  dataminimerade kandidater, 100 samtidiga exact retries, alla stale intentfält,
  två request-id, replay efter senare händelser, logout/revocation,
  journal-/revisionsimmutabilitet samt concurrency mot ingest, klass och import.
- `DATABASE_URL=postgresql://127.0.0.1:55439/otid_005i_final TEST_DATABASE_URL=postgresql://127.0.0.1:55439/otid_005i_final CI=true pnpm test:e2e`:
  slutkörning exit 0; 12/12 Playwrighttester. Det nya flödet verifierar separata
  cookies, skyddat kandidatunderlag, en verklig omräkningscommit vars svar
  tappas, samma request-id vid explicit retry, exakt en revision/journal/audit
  och oförändrade entry-, snapshot-, readout- och rawdataantal.
- Den första fulla E2E-körningen nådde 11/12: produktflödet hade committat och
  visade korrekt retryknapp, men det nya testets locator innehöll ett extra ord.
  Endast locatorn rättades; fokustestet blev 1/1 och den fulla slutkörningen
  12/12.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 326,6 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Den skyddade
  sidan, kandidat-/sessionsroutes och den ersatta omräkningsrouten ingår.
- Den byggda standalone-omräkningssidan svarade 200 med exakt `Cache-Control:
  private, no-store`, CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` och avstängd
  kamera/geolocation/mikrofon. Stationsbundle och Android-asset matchar SHA-256
  `c315b374c59b8daa206c493207e83be54493a7b59f793e5e9c768a2b3fae7a01`.

## Kvarvarande antaganden efter TASK 005I

- Endast pairing-, IOF-import-, klassändrings- och explicita
  omräkningsmutationer är produktionsautentiserade. Tävlingsskapande,
  simulatorn och generell read-only `/admin` är utvecklingsytor; det generella
  adminshellet innehåller fortfarande deltagar-/brickdata och är inte en samlat
  produktionssäker arrangörsportal.
- Accesscredential bootstrap/revocation sker med betrodd direktdatabas-CLI.
  Generell arrangörsidentitet, raceägarskap, recovery, OIDC och delegerad
  administration är inte definierade.
- Canonical HTTPS-origin, reverse-proxy-rate-limit/bodygräns, säker operativ
  credentialöverlämning, penetrationstest och backup/restore är inte driftsatta.
- Omräkning kräver exakt en aktiv assignment och deterministiskt senaste
  readout. Tvetydig/saknad assignment eller readout blockeras säkert, men ett
  separat administrativt rättningsflöde för dessa data ingår inte.
- Hundra samtidiga requests och låskonkurrens är lokalt PostgreSQL-verifierade,
  inte distribuerat lasttestade mot V1-målen. Okänd commit är browsertestad
  lokalt, inte genom en verklig produktionsproxy eller ett driftavbrott.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005J 2026-08-31

- `TASK_005J_AUTHENTICATED_RACE_OVERVIEW.md` och ADR-0020 låste det
  avgränsade snittet före implementation. Tre read-only-auditar granskade den
  öppna adminsidan, den breda dataprojektionen, capability-/låsmodellen och
  webbgränsen. Arkitektur-, domän-, offline- och acceptansdokument uppdaterades
  före bred kodändring.
- Migration `0008_task_005j_authenticated_race_overview.sql` lägger additivt
  till `VIEW_RACE_OVERVIEW` och en capabilityspecifik åttatimmarsgräns. Inga
  nya tabeller, audit actors eller dependencies tillkom. Credentialen använder
  prefixet `otid_org_race_overview_v1`, högst en timmes session och helt egna
  session-/CSRF-cookies. Betrodd CLI kan endast utfärda och spärra denna
  capability.
- Den tidigare breda `raceOverview` är borttagen. Den privata usecasen
  autentiserar och låser `session SHARE → credential SHARE → race SHARE` innan
  SQL väljer endast race-/eventstruktur, aggregerade antal och senaste
  aktivitetstider. Namn, organisation, bricknummer, punches, rawdata,
  evaluation, individresultat, importinnehåll/hash och authmetadata läses eller
  returneras inte.
- Logout och credentialrevocation använder UPDATE-lås i samma ordning. Om
  revoke vinner returneras ingen overview; om läsningen vinner får just den
  auktoriserade läsningen slutföras. GET skriver ingen audit, requestjournal
  eller domänrad.
- `/admin/{raceId}` serverrenderar endast ett privat shell med race-id. Efter
  login hålls credential och strikt DTO endast i React-minne. Data hämtas en
  gång och därefter endast vid explicit uppdatering; ingen polling, timer,
  automatisk retry eller Web Storage används. Logoutbegäran rensar DTO direkt
  och ett okänt utfall kan retryas explicit utan falskt bekräftat besked.
- Mutationslänkar visas först efter overview-auth men varje mål kräver fortsatt
  sin egen capability/session. Overview-sessionen kan inte para station,
  importera, ändra klass, räkna om eller ingestera.
- Den publika resultatsidan använder nu den separata minimala
  `publicRaceSummary` och överläser inte privat admin-/rådata för rubriken.
  Simulatorn är flyttad till `/admin/{raceId}/simulator`, hämtar endast
  snapshotversion och är uttryckligen fortsatt en utvecklingsyta utanför
  overview-auth. Dess beständiga utvecklingskö ändras eller rensas inte.
- Ingen generell arrangörsroll/OIDC, Eventor, StartList/ResultList, QR/kamera,
  SPORTidentparser, riktig USB, stafett eller GPS tillkom.

## Verifiering efter TASK 005J 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 329/329 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 44 kontrakt, 10 applikation, 153 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0008 kördes mot en från början tom PostgreSQL
  17/PostGIS-databas: `pnpm db:migrate` exit 0 och
  `Databasmigrationer klara`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55441/otid_005j_final CI=true pnpm test:integration`:
  exit 0; 65/65 tester. 005J-bevisen omfattar strikt PII-fri projektion,
  separat publik sammanfattning, race-/capabilityisolering, 100 samtidiga GET
  utan writes, logout/revocation och serialisering mot klassändring/import.
- `DATABASE_URL=postgresql://127.0.0.1:55441/otid_005j_final TEST_DATABASE_URL=postgresql://127.0.0.1:55441/otid_005j_final CI=true pnpm test:e2e`:
  exit 0; 13/13 Playwrighttester. Det nya flödet verifierar tomt förauth-skal,
  privata säkerhetsheaders, 401 utan canaryläcka, separat cookiepar, PII-fritt
  DTO, ingen URL/Web Storage-lagring, omedelbar minnesrensning vid tappat
  logout-svar och explicit retry. Alla fyra simulatorregressioner körs via den
  separata utvecklingsrouten.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 328,7 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Overview-
  sidan, session-/dataroutes, simulatorrouten och separat publik projektion
  ingår. Stationsbundle och Android-asset matchar SHA-256
  `ca021f31d6db04e38081c86255628956afa184c96166098284343f6757dba97f`.
- Första sandboxade `initdb`, migration och integration kunde inte skapa delat
  minne/IPC eller ansluta loopback och gav exit 1 av operativ policy, inte av
  kodfel. Samma kommandon kördes om med godkänd lokal teståtkomst och gav
  resultaten ovan. Ingen kod ändrades mellan de misslyckade miljöförsöken och
  de gröna omkörningarna.
- Den isolerade PostgreSQL 17-instansen stoppades kontrollerat och hela dess
  explicita temporära katalog `/tmp/otid005j.kJhHuU` togs bort efter test.

## Kvarvarande antaganden efter TASK 005J

- Tävlingsskapande och den separata simulatorrouten är fortsatt öppna
  utvecklingsytor. Pairing, IOF-import, klassändring, explicit omräkning och den
  PII-fria read-only-översikten är capabilityseparerade, men utgör inte en
  samlad arrangörsportal eller generell rollmodell.
- Accesscredential bootstrap/revocation sker med betrodd direktdatabas-CLI.
  Generell arrangörsidentitet, raceägarskap, recovery, OIDC och delegerad
  administration är inte definierade.
- Canonical HTTPS-origin, reverse-proxy-rate-limit/bodygräns, säker operativ
  credentialöverlämning, penetrationstest och backup/restore är inte driftsatta.
- Racekonfigurationen serialiseras med race SHARE-lås. Readout-/resultatantal
  och senaste aktivitet är avsiktligt operativa nulägesaggregat och kan ändras
  genom samtidig ingest; de påstår inte en ny domänsnapshot.
- PostgreSQL-låsning och hundra samtidiga overviewläsningar är lokalt
  verifierade, inte distribuerat lasttestade mot V1-målen. Logoutens okända
  utfall är browsertestat lokalt, inte genom verklig produktionsproxy eller
  nätverksavbrott i drift.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005K 2026-08-31

- `TASK_005K_AUTHENTICATED_EVENT_CREATION.md` och ADR-0021 låste snittet före
  implementation. Tre read-only-auditar granskade den öppna routen,
  racecredentialgränsen, idempotensen och webbflödet. Arkitektur-, domän-,
  offline- och acceptansdokument uppdaterades innan bred kodändring.
- Migration `0009_task_005k_authenticated_event_creation.sql` skapar ett helt
  separat globalt men fast avgränsat `CREATE_EVENT`-substrat: hash-only
  accesscredential, credentialrevocation, entimmes browsersession,
  sessionrevocation och append-only requestjournal. Befintlig race-FK och alla
  `pairing_admin_*`-capabilities är oförändrade.
- Credentialprefixet är `otid_org_event_create_v1`, accesslivslängden högst
  åtta timmar och sessionprefix/cookies är separata. Betrodd CLI kan utfärda
  och spärra denna enda bootstrapbehörighet utan att ge rätt till något race.
- Det strikta v1-intentet binder eventnamn, första loppets namn, racedatum och
  giltig IANA-tidszon till `event-create:<canonical uuid>`. Event- och race-id
  är servergenererade. Exact replay kräver samma actor och alla intentfält och
  återger ursprungliga IDs/tid; ändrad actor eller intent ger 409.
- `createEventAsAdmin` autentiserar före body och igen under låsordningen
  `session UPDATE → credential UPDATE → advisory request-id`. Event, exakt ett
  första individuellt lopp, journal och `EVENT_CREATED_BY_ADMIN`-audit committar
  atomiskt. Credential-, session-, CSRF- och hashhemligheter ingår aldrig i
  journal, audit eller response.
- Befintlig `POST /api/events` är ersatt av den skyddade mutationen utan
  parallell bypass. Origin/session/CSRF och canonical key kontrolleras före en
  streambegränsad body; endast strikt UTF-8 `application/json` på 1–4096 bytes
  accepteras och alla fel är privata, stabila och detaljfria.
- `/admin/events/new` är ett svenskt privat shell med separata cookies och
  text-/symbolbaserad internet-, session- och försöksstatus. Credential,
  normaliserat intent, request-id och svar hålls endast i React-minne. Okänd
  commit kan retryas explicit med exakt samma request; ingen timer, polling,
  automatisk retry eller Web Storage används.
- Publika `/` saknar nu createformulär och admincookies men behåller en neutral
  länk och den befintliga publika rubriklistan. E2E-fixtures använder trusted
  applicationkod direkt i stället för en HTTP-bypass.
- Ingen generell användar-/organisations-/rollmodell, automatisk racecredential,
  Eventor, StartList/ResultList, QR/kamera, SPORTidentparser, riktig USB, stafett
  eller GPS tillkom.

## Verifiering efter TASK 005K 2026-08-31

- `CI=true pnpm lint`: exit 0; 10 av 11 workspaceprojekt med lintscript.
- `CI=true pnpm typecheck`: exit 0; 10 av 11 workspaceprojekt med script.
- `CI=true pnpm test`: exit 0; 370/370 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 48 kontrakt, 13 applikation, 187 webb och
  36 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0009 kördes mot en från början tom PostgreSQL
  17/PostGIS-databas: `pnpm db:migrate` exit 0 och
  `Databasmigrationer klara`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55443/otid_005k_final CI=true pnpm test:integration`:
  exit 0; 72/72 tester. 005K-bevisen omfattar 100 samtidiga exact retries,
  actor-/intentkonflikter, olika explicita request-id:n, originaltid vid replay,
  auth före body, atomisk rollback, logout/revocation, samtidig create/revoke,
  hashsekretess och append-only-barriärer.
- `DATABASE_URL=postgresql://127.0.0.1:55443/otid_005k_final TEST_DATABASE_URL=postgresql://127.0.0.1:55443/otid_005k_final CI=true pnpm test:e2e`:
  exit 0; 14/14 Playwrighttester. Det nya browserfallet verifierar borttagen
  öppen bypass, separata cookies, förlorat svar efter verklig commit, explicit
  replay med identisk body/key, exakt ett event/lopp/journal/audit, ingen
  automatisk racecredential och ingen URL/Web Storage-lagring.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 330,1 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Creation-sidan,
  sessionrouten och den ersatta create-routen ingår. Stationsbundle och
  Android-asset matchar SHA-256
  `777bd28b8ebc0d0b683ec677b7025d2bfe6aa871c9f3de8228834fa96ac1022d`.
- `CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json` och
  `CI=true pnpm exec eslint scripts/event-creation-access.ts`: båda exit 0.
- Första sandboxade PostgreSQL-initieringen gav exit 1 eftersom `shmget` var
  förbjudet. Den första godkända lokala instansen råkade använda PostgreSQL 16
  och migrationsförsöket gav exit 1 eftersom dess PostGIS-controlfil saknades.
  Instansen stoppades; explicit PostgreSQL 17/PostGIS startades och samtliga
  slutgrindar ovan blev gröna utan någon kodändring för dessa miljöfel.

## Kvarvarande antaganden efter TASK 005K

- Ett lyckat create skapar exakt ett event och ett första individuellt lopp med
  `startsOn = raceDate` och `snapshotVersion = 1`. Fler lopp inom samma event
  kräver ett separat framtida vertikalt snitt.
- Ett nytt event blir omedelbart synligt som publik rubrikmetadata på `/`, i
  linje med befintlig publik resultatsida. Draft/publiceringsstatus och ägarskap
  är ännu inte modellerade och får kräva ett separat ADR-beslut.
- `CREATE_EVENT` ger avsiktligt ingen rätt till det skapade loppet. Racebundna
  overview-/mutationscredentials provisioneras separat via betrodd CLI tills en
  generell organisations- och ägarskapsmodell har beslutats.
- Credentialbootstrap/revocation är betrodd direktdatabas-CLI. Recovery, OIDC,
  delegerad administration, säker operativ credentialöverlämning, canonical
  produktionsorigin, reverse-proxy-rate-limit, penetrationstest och
  backup/restore är inte driftsatta.
- Hundra samtidiga retries och låskonkurrens är verifierade lokalt i PostgreSQL,
  inte som distribuerat lasttest mot V1-målen. Okänd commit är browsertestad
  lokalt, inte genom verklig produktionsproxy eller driftavbrott.
- Simulatorn är fortsatt en separat öppen utvecklingsyta. Ingen verklig
  process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005L 2026-08-31

- `TASK_005L_FAIL_CLOSED_LOCAL_SIMULATOR.md` och ADR-0022 låste den nya
  deploymentgränsen före implementation. Tre read-only-auditar granskade
  serverkomponenten, requestauthority, Next-konfiguration, browserkö,
  stationingest, test- och produktionsbuildgräns. Arkitektur-, offline- och
  acceptansdokument uppdaterades innan bred kodändring.
- `/admin/{raceId}/simulator` kör nu en ren server-only-grind före
  routeparametrar, UUID-validering och databas. Endast exakt `development`,
  `O_TID_SIMULATOR_MODE=loopback-development`, canonical HTTP-loopback-origin
  och matchande enkel Host/forwarded-authority tillåts. Alla andra kombinationer
  ger vanlig 404 utan race-/snapshotprojektion eller klienthydrering.
- Ordinarie web-devscript binds till `127.0.0.1`. Detta är den faktiska lokala
  driftgränsen; authorityheaders är uttryckligen endast försvar på djupet och
  påstås inte bevisa klientens källadress. Playwright opt-in:ar explicit.
- Simulatorrouten behåller privata no-store-, frame-, referrer-, MIME- och
  sensorheaders och får `X-Robots-Tag: noindex, nofollow`. Production tillåter
  aldrig simulatorn även om mode och loopback-origin är fientligt felsatta.
- Den minimala tillåtna projektionen är fortsatt endast parametriserad
  `snapshot_version`. Stationcredential, station-package, device-batch,
  idempotens, rawdata, resultatrevision, simulatorpayload och Androidstationens
  SQLite-outbox är oförändrade.
- Simulatorns befintliga `localStorage`-kö, device-id och sekvenser rensas eller
  migreras aldrig av grinden. Avvisad sida hydreras inte och skapar inget nytt
  browserstate.
- En separat typkontrollerad och lintad Playwright-produktionsprobe startar det
  verkliga standalone-bygget med fientligt simulatorläge och avsiktligt
  otillgänglig databas. Två giltigt formaterade race-URL:er måste ge 404 med
  säkerhetsheaders utan simulatorsträngar eller databasanslutningsförsök.
- Ingen migration, capability, session, dependency, domänregel,
  SPORTidentparser, riktig USB, stafett eller GPS tillkom.

## Verifiering efter TASK 005L 2026-08-31

- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript samt
  det separata produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript samt `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 401/401 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 48 kontrakt, 13 applikation, 218 webb och
  36 station. De 31 nya webbtesten täcker policy, authority, no-query och
  driftkonfiguration. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0009 kördes mot en från början tom PostgreSQL
  17.11/PostGIS-databas: `pnpm db:migrate` exit 0 och
  `Databasmigrationer klara`. TASK 005L har avsiktligt ingen ny migration.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55444/otid_005l_final CI=true pnpm test:integration`:
  exit 0; 72/72 PostgreSQL-integrationstester.
- `DATABASE_URL=postgresql://127.0.0.1:55444/otid_005l_final TEST_DATABASE_URL=postgresql://127.0.0.1:55444/otid_005l_final CI=true pnpm test:e2e`:
  exit 0; 14/14 Playwrighttester. Den explicita lokala simulatorn svarade 200
  med utvecklingsvarning och säkerhetsheaders; authoritymismatch gav 404, och
  alla fyra simulator-/kö-/flush-/omräkningsregressioner passerade.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 330,1 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Simulatorrouten
  finns dynamiskt i buildmanifestet men runtimegrinden är bindande.
  Stationsbundle och Android-asset matchar SHA-256
  `777bd28b8ebc0d0b683ec677b7025d2bfe6aa871c9f3de8228834fa96ac1022d`.
- `CI=true pnpm test:production:simulator`: exit 0; 1/1 på det slutliga
  standalone-bygget. Båda produktionsanropen gav verklig 404 med no-store,
  CSP/XFO och noindex utan simulatorinnehåll eller DB-försök.
- De första tre fokuserade pnpmkommandona startade inte eftersom den bundlade
  runtime:n ville göra en interaktiv modules-purge utan TTY; samma kommandon
  med etablerat `CI=true` körde. Första sandboxade initdb gav `shmget ...
  Operation not permitted` och första sandboxade standalone-proben gav
  `listen EPERM`; godkända lokala omkörningar passerade. Ett första web-
  typecheck hittade `exactOptionalPropertyTypes` i den nya miljötypen, och ett
  första probelint hittade konfigurationen utanför TypeScriptprojektet; båda
  felen korrigerades före de helt gröna slutkörningarna.

## Kvarvarande antaganden efter TASK 005L

- Standarddevservern är loopbackbunden, men en operatör kan fortfarande
  åsidosätta kommandot och binda till ett externt interface. Hostheaders kan
  spoofas och är inte ett nätverksbrandväggsbevis; simulatorläge får därför
  aldrig användas bakom LAN-/publik proxy. Detta är lokalt testat, inte
  penetrationstestat i verklig drift.
- Productionproben kör det verkliga standalone-bygget lokalt, inte en deployad
  reverse proxy/containerplattform. Produktionsorigin, proxy-rate-limit,
  backup/restore och operativ miljöpolicy är fortsatt inte driftsatta.
- Simulatorn kräver fortsatt en giltig race-/devicebunden stationcredential för
  mutation. Den syntetiska normaliserade payloaden och `localStorage`-kön är
  utvecklingsverktyg, inte SPORTidentprotokoll eller stationens crash-säkra
  SQLite-lagring.
- Androidstationens nuvarande normaliserade kontrakt använder fortsatt
  `transport: "simulator"`; en framtida verklig protokolladapter får inte
  blandas in i denna säkerhetsgrind.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 005M 2026-08-31

- `TASK_005M_BOUNDED_DEVICE_BATCH_INGRESS.md` och ADR-0023 låste
  transportgränsen före implementation. Tre read-only-auditar granskade route,
  kontrakt, Android-/simulatorklient, stationens kö och testytan. Arkitektur-,
  offline- och acceptansdokument uppdaterades innan kodändringen.
- `POST /api/races/{raceId}/device-batches` autentiserar nu bearer och
  verifierar route-race + `READOUT` före första bodybyte. Body-device binds
  separat efter strikt parsing; fel device, race eller scope når aldrig ingest.
- Webbadaptern kräver exakt `application/json`, canonical deklarerad längd om
  headern finns, fatal UTF-8 och giltig JSON. Den räknar alltid faktiska
  streambytes, tillåter högst 4 194 304 och cancelar vid byte 4 194 305. Tom
  body och faktisk/deklarerad mismatch avvisas.
- `deviceBatchSchema` och `deviceEventSchema` är nu strict liksom redan payload
  och punch. Okända fält strippar därför inte längre tyst. Schema-, UTF-8-,
  JSON-, längd- och idempotensfel är detaljfria privata svar; oväntade auth-,
  ingest- och ackkontraktsfel maskeras som generiskt privat 500.
- Befintlig application-ingest, `stored`/`duplicate`, rawdata,
  readout/outcome/revision och exact idempotency-key är oförändrade. Ett E2E-
  fall bevisar noll sådana rader efter 400/403/413/415 och därefter `stored`
  samt `duplicate` med samma sekvens.
- Stationens produktionskod ändrades inte. Regressionstestet omfattar nu även
  413/415 och bevisar att pending ligger kvar, ordnad flush stannar och
  `applyAcknowledgements` inte anropas. Android behåller single-event och sin
  snävare 512 KiB-gräns.
- Standalone-proben skickar en oavslutad chunked body utan Authorization till
  slutbygget med avsiktligt död databas. Servern svarar 401 med privata headers
  före body completion och utan databasförsök.
- Ingen migration, dependency, ny capability, rate-limit/proxy,
  SPORTidentparser, riktig USB, stafett eller GPS tillkom.

## Verifiering efter TASK 005M 2026-08-31

- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript samt
  det separata produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript samt `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 429/429 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 52 kontrakt, 13 applikation, 240 webb och
  38 station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- Hela oförändrade migrationskedjan 0000–0009, tio migrationer, kördes mot en
  från början tom PostgreSQL 17.11/PostGIS 3.6.4-databas: `pnpm db:migrate`
  exit 0 och `Databasmigrationer klara`. TASK 005M har ingen migration.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55445/otid_005m_final CI=true pnpm test:integration`:
  exit 0; 72/72 PostgreSQL-integrationstester.
- `DATABASE_URL=postgresql://127.0.0.1:55445/otid_005m_final TEST_DATABASE_URL=postgresql://127.0.0.1:55445/otid_005m_final CI=true pnpm test:e2e`:
  exit 0; 14/14 Playwrighttester. Device-batch-fallet verifierar 401/403,
  exakt medietyp, trasig JSON, okänt fält, verkligt 4 MiB-overflow, noll writes
  vid avslag samt efterföljande `stored`/`duplicate` och exakt en raw-,
  readout-, outcome- och revisionsrad.
- `CI=true pnpm build`: exit 0; alla 10 projekt med buildscript, 330,1 kB
  minifierad stationsbundle och optimerad Next.js 16.3.3-build. Den dynamiska
  device-batch-routen ingår. Stationsbundle och Android-asset matchar SHA-256
  `aedfe63a809095231c8c71789a3d4aa06026643b26eb4a00dd2d39740d385257`.
- `CI=true pnpm test:production:simulator`: exit 0; 2/2 mot det slutliga
  standalone-bygget: fail-closed produktionssimulator samt 401 före completion
  av oavslutad chunked device-batch med död databas.
- Den första fokuserade webbkörningen hittade att Vitest behövde en virtuell
  `server-only`-mock; första web-typecheck hittade en ogiltig matcher-generic.
  Båda korrigerades innan de fulla gröna grindarna. Ett första pnpmkommando utan
  `CI=true` avbröts före typecheck på grund av interaktiv modules-purge.
  Första sandboxade PostgreSQL-initieringen gav `shmget ... Operation not
  permitted`; den godkända lokala omkörningen och alla slutgrindar passerade.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat och dess explicita
  engångskatalog `/tmp/otid005m.x9BVMk` (74 MiB) raderades efter verifieringen.

## Kvarvarande antaganden efter TASK 005M

- 4 MiB är ett explicit HTTP-kuvert och rymmer det realistiska 100×256-provet,
  men är inte ett matematiskt maximum för varje Zod-giltig tidssträng eftersom
  ISO-regexen tillåter godtyckligt lång sekundfraktion. Tidsnormalisering och
  faktisk multi-event-klientbatchning är separata framtida beslut.
- En reverse proxy kan buffra innan Next. Samma eller snävare proxygräns,
  requesttimeout, rate-limit, TLS-/originpolicy och distribuerat lasttest är
  inte driftsatta eller verifierade av applikationsgränsen.
- Androids 512 KiB/single-event-policy och webbsimulatorns single-event-flöde
  är regressionstestade syntetiskt. Ingen verklig nätverksproxy, process-/
  strömavbrott, två timmars fältdrift eller fientlig samtidighetslast med många
  giltiga 4 MiB-credentials har provats.
- Ingen fysisk USB, SPORTidentprotokoll, stafett eller GPS har införts eller
  verifierats. All SPORTidentstatus är fortsatt `untested`.

## Genomfört i TASK 005N 2026-08-31

- `TASK_005N_AUTHENTICATED_READOUT_RESULT_HISTORY.md` och ADR-0024 låste
  individ-/historikgränsen före bred implementation. Tre read-only-auditar
  granskade capability, låsordning, datamodell, paginering, privacy, UI och test.
  Arkitektur-, domän-, offline- och acceptansdokument uppdaterades före kod.
- Det befintliga racebundna säkerhetssubstratet har den separata read-only-
  capabilityn `VIEW_READOUT_RESULT_HISTORY`, prefixet
  `otid_org_readout_result_history_v1`, högst åtta timmars access och en timmes
  session. Egna host-only session-/CSRF-cookies, routes och CLI infördes.
- `/admin/{raceId}/history` serverrenderar endast race-id och svenskt privat
  login-shell. Efter login visas högst 50 normaliserade readouts åt gången med
  nuvarande entrynamn när historiskt kopplad, första serverstatus/-orsak och
  explicit keysetpagination. Ingen polling, timer, automatisk retry, URL-
  hemlighet eller Web Storage används.
- Readoutdetail visar normaliserad start, mål och punches samt samtliga
  publicerade och opublicerade resultatrevisioner med kod + svensk text,
  revision, cause, evaluation, missing, extra, splits och motor-/snapshot-/
  courseversion. Deltagarkopplingen härleds från den ursprungliga
  `CARD_READOUT`-revisionen, aldrig dagens brickkoppling.
- Okänd bricka visas med `entry: null`, `UNKNOWN_CARD` och tom historik. Äldre
  readout utan `device_ingest_outcome` får null och ingen fabricerad status.
- Första detaljsidan fryser `upperRevision`; en cursor binder race, readout,
  vattenmärke och nästa revision. Senare append ändrar inte pågående
  historiepaginering, medan en ny request ser den nya revisionen.
- Varje GET autentiserar under samma `REPEATABLE READ`-transaktion och
  låsordningen `session SHARE -> credential SHARE -> race SHARE`. Den gör inga
  writes. PostgreSQL `READ ONLY` används avsiktligt inte eftersom det förbjuder
  de `FOR SHARE`-lås som serialiserar logout/revocation.
- SQL/DTO väljer aldrig raw payload/raw-id, device-/session-/sekvensfält,
  packageversion, content-/evaluationhash, transport/parserstatus,
  organisation, externa id:n, importinnehåll, credentialmetadata,
  authhemligheter eller auditaktör. Fel och svar är privata och detaljfria.
- Migration 0010 lägger additivt till capabilityn, åttatimmarschecken och
  `raw_device_message_race_received_id_idx`. Inga raw-, readout- eller
  resultatrader skrivs om. Journalen innehåller nu alla elva migrationer
  0000–0010.
- TASK 001:s tidigare öppna arrangörskrav för att se avläsningar, resultat med
  förklaringskod och revisionshistorik är därmed implementerat och lokalt
  acceptanstestat utan att bredda den PII-fria overviewytan eller
  omräkningscapabilityn.
- Ingen ny dependency, generell rollmodell, resultatregel, riktig
  SPORTidentparser/USB, Eventor, GPS, kartfunktion eller stafett infördes.

## Verifiering efter TASK 005N 2026-08-31

- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript samt
  det separata produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript samt `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 447/447 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 11 IOF, 57 kontrakt, 15 applikation, 251 webb och 38
  station. Worker och database saknar testfiler och gick grönt med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0010 kördes från noll mot PostgreSQL 17/PostGIS
  3.6.4: `pnpm db:migrate` exit 0 och `Databasmigrationer klara`. Read-only-
  kontrollen bekräftade 11 journalrader, nya enumvärdet och keysetindexet.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55446/otid_005n_fresh CI=true pnpm test:integration`:
  exit 0; 76/76 PostgreSQL-integrationstester. De fyra nya fallen täcker känd/
  okänd readout, alla tre revisionsorsaker, opublicerat, fryst vattenmärke,
  race-/capabilityisolering, 100 samtidiga GET utan writes samt logout/revoke.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55446/otid_005n_fresh TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55446/otid_005n_fresh CI=true pnpm exec playwright test --reporter=list`:
  exit 0; 15/15 Playwrighttester. Det nya fallet verifierar förauth-401/shell,
  separata cookies, normaliserade punches, `OK/COMPLETE`, `UNKNOWN_CARD`, två
  revisionsorsaker, inga browserlagrade secrets/PII och bekräftad logout.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript,
  334,3 kB minifierad stationsbundle och optimerad Next.js 16.3.3-build.
  Historysidan samt session-, list- och detaljroutarna ingår i buildmanifestet.
  Stationsbundle och Android-asset matchar SHA-256
  `99f0502893943e3856bb3443cd445ab952a378aea22f973da9815f89acad6ef9`.
- `CI=true pnpm test:production:simulator`: exit 0; 2/2 på slutbyggets
  fail-closed simulator-/device-batch-prober.
- Första migrationsförsöket använde Homebrews PostgreSQL 16 utan installerad
  PostGIS och avvisades före schema. Instansen ersattes med installerad
  PostgreSQL 17/PostGIS 3.6.4. En saknad migrationjournalpost gjorde därefter
  att 0010 först inte kördes; journalen korrigerades och en helt ny databas
  migrerades från noll före gröna sluttester.
- Första fulla E2E hittade att initial session-401 kunde rensa ett credentialfält
  under inmatning; nästa fokuserade körning hittade en browserinkompatibel
  cookieparser vid logout. Båda korrigerades före 15/15-slutkörningen.
- Den isolerade PostgreSQL-instansen och dess disponibla testdata under
  `/tmp/otid005n.Zskc4D` stoppades och raderades efter slutverifieringen.

## Kvarvarande antaganden efter TASK 005N

- Entrynamnet i historyytan är uttryckligen aktuellt visningsnamn. Modellen
  lagrar inget immutable namn- eller klassnamnssnapshot per revision;
  historiskt auktoritativa fält är interna entry-/class-/course-version-id:n och
  revisionens lagrade evaluation/versioner.
- Readoutfeeden är en levande operativ lista, inte en fryst export. Varje sida
  är koherent och keysetpaginerad, men nya readouts kan tillkomma mellan sidor.
- `device_ingest_outcome` saknas tillåtet för äldre poster. Ett ogiltigt bevarat
  serverutfall failar stängt som internt fel; UI fabricerar ingen ersättningskod.
- `card_readout` saknar en egen databastrigger mot update/delete. Applikationen
  erbjuder ingen sådan mutation och rawmeddelande/resultatrevision har fortsatt
  DB-barriär, men normalized-readout-immutabilitet är inte ett separat
  evidence-grade databasbevis i detta snitt.
- Capabilitycredentialer är en avgränsad operatörsmekanism, inte en färdig
  generell användar-, organisations- eller rollmodell. Produktionens TLS,
  reverse proxy, rate-limit, backup/restore och distribuerade last är inte
  driftsatta eller penetrationstestade.
- Browserflödet är testat mot lokal Next-devserver och produktionsbygget är
  kompilerat; privat historyroute har inte körts genom en verklig deployad
  reverse proxy/cacheplattform.
- Ingen verklig process-/strömavbrottstest, två timmars fältdrift, fysisk USB,
  SPORTidentprotokoll, stafett eller GPS har körts. All SPORTidentstatus är
  fortsatt `untested`.

## Genomfört i TASK 006A 2026-08-31

- `TASK_006A_AUTHENTICATED_IOF_STARTLIST_IMPORT.md` och ADR-0025 låste det
  individuella single-race-subsetet, extern identitet, full klasscoverage,
  tidszon, idempotens, versioner och capabilityseparation före implementation.
- Den befintliga `IMPORT_IOF`-ytan accepterar nu strikt IOF 3.0 `StartList` med
  högst 500 klasser och 10 000 starter. `Class.Id`, `EntryId`, exakt en `Start`,
  explicit UTC-offset och saknad eller `raceNumber=1` krävs. Team, multi-race,
  dubbletter, tomma klasser och okända containerfält avvisas.
- Matchning sker endast mot befintliga racebundna IOF-identiteter. Varje
  refererad klass måste täckas fullständigt och varje entry måste redan höra
  till klassen; all kontroll sker före första domänwrite.
- Refererade klasser blir `FIXED`. Endast faktiskt ändrade starttider ökar
  entryversionen, och loppets snapshot ökar högst en gång per import och endast
  vid faktisk delta. En ny fil med samma normaliserade effekt bevaras som
  immutable provenance utan versionschurn.
- `CourseData` bevarar nu en befintlig startregel och `EntryList` bevarar
  `fixedStartTime`. De två filtyperna får inte radera fakta de själva inte bär.
- StartList-rapport och audit anger importerade och ändrade klasser/entries,
  snapshotdelta och antal tidigare resultat som behöver separat omräkning.
  `IMPORT_IOF` skapar aldrig resultatrevisioner; befintlig
  `RECALCULATE_RESULT` förblir enda capabilityn för den mutationen.
- Importvyn visar på svenska om snapshot ändrades och att inga resultat räknades
  om automatiskt. Samma route, session, host-only cookies, capability och
  minnesbundna exact-retry används fortsatt.
- Migration 0011 lägger endast additivt till `StartList` i `import_kind`.
  Journalen omfattar nu tolv migrationer 0000–0011; ingen befintlig rad,
  capability eller revisionsorsak ändras.
- Nytt signerat stationpaket innehåller `FIXED` och UTC-normaliserade tider.
  Det gamla signerade paketet förblir verifierbart och senare ingest med dess
  version accepteras som `stale` med uppdateringskrav.
- Ingen Eventor-klient, startlottning, `ResultList`, riktig SPORTident/USB,
  stafett, GPS, karta eller ny dependency infördes.

## Verifiering efter TASK 006A 2026-08-31

- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript samt
  produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt samt
  `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 462/462 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 23 IOF, 58 kontrakt, 15 applikation, 253 webb och 38
  station. Worker och database saknar testfiler och passerade med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0011 kördes från noll mot PostgreSQL 17.11/PostGIS
  3.6.4. Skrivskyddad kontroll bekräftade 12 journalrader och enumvärdena
  `CourseData`, `EntryList`, `StartList`.
- `TEST_DATABASE_URL=... CI=true pnpm test:integration`: exit 0; 80/80
  PostgreSQL-integrationstester. De fyra nya fallen verifierar atomiskt avslag,
  exact replay/contentduplicate, identisk normaliserad effekt, versioner,
  immutable raw/readout/revision, senare import, signerat paket och stale-synk.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e --reporter=list`:
  exit 0; 15/15 Playwrighttester. Importflödet laddar CourseData, EntryList och
  StartList genom samma browserroute och verifierar `FIXED`, två UTC-tider,
  svensk omräkningsvarning och noll resultatrevisioner.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript,
  334,6 kB minifierad stationsbundle och optimerad Next.js 16.3.3-build.
  Stationsbundle och Android-asset matchar SHA-256
  `8d5a01c6636a304aa395f1abc8fabad0f24cd23d151794712d2db2ef3ca4b57e`.
- `CI=true pnpm test:production:simulator`: exit 0; 2/2 på det slutliga
  standalone-byggets fail-closed simulator-/device-batch-prober.
- Första sandboxade `initdb` avvisades av operativsystemets shared-memory-
  policy; den godkända isolerade omkörningen passerade. Första fulla lint hittade
  en oanvänd testdestrukturering; den rättades och hela grinden kördes om grönt.
- Den lokala portinventeringen visade endast macOS Bluetooth/debug-portar och
  ingen SPORTident-enhet; inga fysiska bytes eller hardwarestatus fabricerades.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat och dess explicita
  engångskatalog `/private/tmp/otid-task006a-pg.09H9pU` med disponibel testdata
  togs bort efter slutverifieringen.

## Kvarvarande antaganden efter TASK 006A

- IOF-subsetet är verifierat mot den officiella 3.0-strukturen men är inte full
  XSD-validering. IOF-schemat vendlas inte eftersom dess repository saknar ett
  uttryckligt återdistributionsbeslut; fler standardfält kräver egna beslut och
  fixtures.
- Importen kräver full coverage av redan existerande entries i varje refererad
  klass. Vakanta tider, efteranmälningar, partiella startlistor, flera lopp och
  team/stafett ingår inte.
- Starttiden kräver explicit offset och lagras som UTC-instant. Importen binder
  till route-loppet men påtvingar inte att instantens lokala kalenderdatum är
  samma som `raceDate`; sådan policy behöver ett separat domänbeslut.
- `resultsRequiringRecalculation` är en indikator för entries som har minst en
  tidigare revision. Operatören måste fortfarande välja och utföra varje
  omräkning explicit; importen massomräknar aldrig.
- Browser, PostgreSQL och signerade paket är lokalt verifierade. Verklig reverse
  proxy, Eventorinteroperabilitet, backup/restore, fältarbete, process-/strömfel,
  fysisk USB och SPORTidentprotokoll är inte verifierade. All SPORTidentstatus
  är fortsatt `untested`.

## Genomfört i TASK 006B 2026-08-31

- `TASK_006B_AUTHENTICATED_IOF_RESULTLIST_EXPORT.md` och accepterade ADR-0026
  dokumenterades före den breda implementationen. Beslutet avgränsar en
  skrivfri, racebunden IOF XML 3.0 `ResultList status="Snapshot"` och inför
  varken Eventor-uppladdning, slutresultatmarkering eller nya domänstatusar.
- `EXPORT_IOF_RESULT_LIST` är en separat capability med eget
  `otid_org_result_list_export_v1`-credentialprefix, högst åtta timmars access,
  högst en timmes session, egna host-only cookies och CLI för utfärdande och
  spärrning. Migration 0012 är additiv och har rollback-/restore-not.
- Applikationsprojektionen kör `REPEATABLE READ`, autentiserar och låser före
  privat SQL, avvisar event med flera races och materialiserar högst 1 000
  klasser, 10 000 resultat och 256 historiska kontroller per bana. Den väljer
  senaste publicerade revision per entry, även när en nyare opublicerad finns,
  och använder revisionens historiska klass, bana, status, tider och splits.
- Snapshotrevisioner äldre än loppet ingår men räknas som stale; revisioner från
  framtida snapshot eller motsägande evaluation/class/course/control-data
  avvisas. Aktuellt namn och organisation är uttryckligen visningsdata.
- Den rena serializeraren i `packages/iof-xml` mappar `OK`/`MP` till
  `OK`/`MissingPunch`, normaliserar explicita ISO-tider till UTC, skriver exakt
  millisekundupplösning och förväntade splits i historisk banordning. Upprepade
  kontrollkoder matchas per förekomst, saknade splits markeras `Missing` och
  start/mål/extra stämplingar utelämnas.
- XML använder fast elementordning, UTF-8, LF och slutnewline, escaper all text
  och avvisar ogiltiga XML 1.0-kodpunkter. Interna UUID:n, bricknummer, raw,
  readout, audit/auth/importoriginal, opublicerade fakta, GPS och extensions
  exporteras aldrig. IOF-importerade Class.Id/EntryId är de enda externa id:n.
- Webbgränsen `/admin/[raceId]/exports` har eget svenskt login/logout och
  download-route. Svar är privat `no-store`, `nosniff`, attachment med exakt
  längd, SHA-256-metadata/ETag och restriktiva headers. Browsern verifierar
  metadata, längd och SHA-256 före download, använder ingen Web Storage och
  rensar sin tillfälliga object URL.
- Export-GET gör inga writes. PostgreSQLtestet verifierar oförändrade audit-,
  raw-, readout-, ingest outcome-, revision- och importräknare, 100 identiska
  läsningar samt att samtidiga tvåresultatsingest endast syns helt före eller
  helt efter commit.
- Ingen Eventor-klient/API-nyckel, ranking, DNS/DNF/DSQ, arkivlagring, stafett,
  GPS, karta, SPORTident-protokoll eller riktig USB har tillkommit.

## Verifiering efter TASK 006B 2026-08-31

- `CI=true pnpm lint`: slutlig körning exit 0; samtliga 10 workspaceprojekt med
  lintscript samt produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: slutlig körning exit 0; samtliga 10
  workspaceprojekt samt `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 495/495 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 6 domän, 41 IOF, 61 kontrakt, 17 applikation, 263 webb och 38
  station. Worker och database saknar testfiler och passerade med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0012 kördes från en tom databas mot PostgreSQL
  17.11/PostGIS 3.6.4. `pnpm db:migrate` gav exit 0; skrivskyddad kontroll
  bekräftade 13 journalrader och capabilityn `EXPORT_IOF_RESULT_LIST`.
- `TEST_DATABASE_URL=... CI=true pnpm test:integration`: slutlig körning exit 0;
  83/83 PostgreSQL-integrationstester. Tre nya exportfall verifierar historisk
  projektion, stale/opublicerad semantik, 100 deterministiska skrivfria läsningar,
  atomiskt före/efter-läge vid samtidig ingest, capability/race/revocation och
  flerloppsavslag.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e --reporter=list`:
  exit 0; 16/16 Playwrighttester. Det nya fallet verifierar 401 före login,
  tomt servershell, capabilityseparerade cookies, privata downloadheaders,
  längd/SHA-256 och den faktiska nedladdade XML-filen utan interna id:n eller
  bricknummer.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript och
  optimerad Next.js 16.3.3-build passerade. Minifierad stationsbundle är
  343 883 byte (335,8 kB); webbundle och kopierad Android-asset har identisk
  SHA-256 `b856a8a058a03c78f04984927c435973d7c2dc68114927a2077b16c166315f78`.
- `CI=true pnpm test:production:simulator`: slutlig tillåten körning exit 0;
  2/2 standalone-prober passerade. Första sandboxkörningen gav exit 1 genom
  `listen EPERM`; ingen produktionsassertion hann då köras.
- `pnpm android:test`, `pnpm android:lint` och `pnpm android:assemble` kördes
  slutligt med installerad OpenJDK 17.0.20.1 och Android command-line tools men
  gav alla exit 1 före kompilering: Build Tools 35 och Platform 36 saknas därför
  att Android SDK-licensen inte är accepterad. Licensfrågan besvarades `n`; inga
  SDK-paket eller Androidtester fabricerades som godkända.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat och den explicit
  verifierade engångskatalogen `/private/tmp/otid-task006b-pg.qDTD8R` med
  disponibel testdata togs bort efter slutverifieringen.

## Kvarvarande antaganden efter TASK 006B

- Exporten är ett sanningsenligt IOF `Snapshot`, inte `Complete`. O-Tid saknar
  ännu finaliseringsbeslut, DNS/DNF/DSQ och auktoritativ ranking/tie-policy;
  därför utelämnas entries utan publicerad revision, Position och TimeBehind.
- Resultatets beräkningsgrund är historisk, men namn och organisation är aktuell
  visningsdata eftersom resultatrevisionen inte har ett namnsnapshot.
- IOF-subsetet är självständigt verifierat mot den officiella 3.0-strukturen och
  egna fixtures men inte genom full XSD-validering. Schemat vendlas inte eftersom
  dess repository saknar ett uttryckligt återdistributionsbeslut.
- Event med flera races avvisas tills en verklig IOF-raceordinal lagras. Ingen
  `raceNumber=1` eller intern eventidentitet fabriceras.
- SHA-256 verifieras i målwebbläsaren med Web Crypto. Verklig reverse proxy,
  Eventorinteroperabilitet, last, backup/restore och fältbeteende är inte
  verifierade.
- Androidkällan ändrades inte i detta snitt och TypeScript-stationsbygget är
  verifierat, men de separata Gradlegrindarna kan inte godkännas förrän en
  behörig användare accepterar Android SDK-licensen och installerar Build Tools
  35 samt Platform 36.
- Ingen fysisk SPORTident-enhet användes. All riktig SPORTident-/USB-status är
  fortsatt `untested`; endast den befintliga simulatorvägen kördes.

## Genomfört i TASK 006C 2026-08-31

- `TASK_006C_DOMAIN_CLASS_RANKING.md` och accepterade ADR-0027 dokumenterades
  före den breda implementationen. Beslutet låser senaste publicerade
  historiska revision, competition ranking, millisekundties, tid efter,
  MP-exkludering och suppression vid blandade historiska banversioner.
- `packages/domain` äger nu den enda I/O-fria klassrankingen. Den validerar hela
  kandidatgruppen fail closed, ger `1,1,3`/`1,2,2,4`, låter delade vinnare få
  noll tid efter och använder aldrig namn eller intern nyckel för att bryta en
  faktisk tie.
- Den publika applikationsprojektionen väljer senaste `published=true` per
  entry i repeatable read, grupperar efter revisionens historiska klass och
  använder samma domänranking som exporten. Den svarar med ett strikt
  `formatVersion: 1`-kontrakt utan result-, entry-, klass-, banversions- eller
  readout-id och utan full lagrad evaluation.
- Publikvyn visar placering, exakt millisekundtid och tid efter. MP visas utan
  ranking. En klass vars OK-resultat använder flera historiska banversioner
  visar en svensk textvarning och inga rankingfält; betydelsen beror inte på
  färg.
- IOF-serializeraren accepterar bara ett komplett redan härlett
  `timeBehindMs`/`position`-par på OK, avvisar motsägelser och skriver exakt
  `Time`, `TimeBehind`, `Position`, `Status`. Exportapplikationen räknar paret
  med samma domänfunktion och utelämnar det för MP och mixed-course.
- PostgreSQLtestet bevisar två delade vinnare med position ett och noll tid
  efter i både publik DTO och XML. Ett separat fall appendar en andra immutable
  historisk banversion och bevisar synliga OK-resultat men inga rankingfält i
  någon projektion.
- Ingen migration, ny dependency, capability, write-route, resultatrevisions-
  mutation, ny status, Eventor-klient, stafett, GPS, SPORTident-parser eller
  riktig USB infördes.

## Verifiering efter TASK 006C 2026-08-31

- `CI=true pnpm lint`: slutlig körning exit 0; samtliga 10 workspaceprojekt med
  lintscript samt produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: slutlig körning exit 0; samtliga 10
  workspaceprojekt samt `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 522/522 TypeScript-enhetstester: 49 transport,
  20 SI-verktyg, 12 domän, 53 IOF, 68 kontrakt, 17 applikation, 265 webb och 38
  station. Worker och database saknar testfiler och passerade med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0012 kördes från en tom databas mot PostgreSQL
  17.11/PostGIS 3.6.4. Skrivskyddad kontroll bekräftade 13 migrationsrader;
  TASK 006C har ingen migration.
- `TEST_DATABASE_URL=... CI=true pnpm test:integration`: slutlig körning exit 0;
  84/84 PostgreSQL-integrationstester. Det nya mixed-course-fallet och utökade
  concurrencyfallet verifierar samma ranking i publik DTO/XML, strict
  dataminimering, ties, suppression och befintlig skrivfri determinism.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e --reporter=list`:
  slutlig körning exit 0; 16/16 Playwrighttester. Resultatflödet verifierar
  position/tid efter och strikt publikt API; exportflödet verifierar det
  nedladdade XML-parets värde och elementordning.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript och
  optimerad Next.js 16.3.3-build passerade. Minifierad stationsbundle och
  kopierad Android-asset är vardera 346 013 byte med identisk SHA-256
  `a7d089c8199720d61df9b2d9da0914b6c95b62d333f7fa9ecb8784e06d92df9d`.
- `CI=true pnpm test:production:simulator`: exit 0; 2/2 befintliga standalone-
  prober passerade.
- Första integrationskörningen gav 81/84 eftersom PostgreSQL förbjuder
  `SELECT FOR SHARE` i en explicit read-only-transaktion. Den felaktiga flaggan
  togs bort medan repeatable read och skrivfri funktion behölls; full omkörning
  gav 84/84. Första E2E-körningen gav 15/16 eftersom ett gammalt TASK 006B-test
  fortfarande förbjöd de nya rankingelementen; det ersattes med exakta
  värde-/ordningsassertioner och full omkörning gav 16/16.
- `pnpm android:test`, `pnpm android:lint` och `pnpm android:assemble` kördes
  med explicit OpenJDK 17.0.20.1 och befintliga command-line tools men gav alla
  exit 1 före kompilering. Build Tools 35 och Platform 36 är inte installerade
  eftersom Android SDK-licensen inte är accepterad. Ingen licens accepterades
  och inget Androidresultat redovisas som godkänt.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat och den explicit
  verifierade engångskatalogen `/private/tmp/otid-006c-pg17.C7K8X3` med
  disponibel testdata och logg togs bort permanent efter verifieringen.

## Kvarvarande antaganden efter TASK 006C

- Rankingen är ett live `Snapshot`, inte ett finaliserat slutresultat. O-Tid
  saknar fortfarande ett explicit klass-/loppsfinaliseringsbeslut och stöd för
  DNS, DNF, DSQ, utom tävlan och utan tidtagning.
- Fler historiska banversioner under samma klass antas inte vara jämförbara;
  hela klassens OK-ranking undertrycks. Ingen banekvivalens eller dold
  undergruppering fabriceras.
- Resultatets klass, bana, status och tid är historiska, men namn och
  organisation är aktuell visningsdata eftersom revisionen saknar namnsnapshot.
- IOF-subsetet är självständigt verifierat mot den officiella 3.0-strukturen
  och egna fixtures men inte genom full XSD-validering. Multi-race-event
  avvisas fortsatt eftersom en verklig IOF-raceordinal saknas.
- Verklig reverse proxy, Eventorinteroperabilitet, last, backup/restore,
  process-/strömfel och fältbeteende är inte verifierade.
- Androidkällan ändrades inte. Gradlegrindarna förblir blockerade tills en
  behörig användare accepterar Android SDK-licensen och installerar Build Tools
  35 samt Platform 36.
- Ingen fysisk SPORTident-enhet användes. All riktig SPORTident-/USB-status är
  fortsatt `untested`; endast simulatorvägen kördes.

## Tidigare föreslagen minsta uppgift efter TASK 006C

TASK 006D bör avgränsas till explicit individuell klass-/loppsfinalisering med
immutable finaliseringsrevision och sanningsenligt IOF `Complete`-beslut. Den
ska inte samtidigt införa nya resultatstatusar, Eventor-uppladdning, stafett,
GPS eller riktig USB.

## TASK 006D: arkitektur låst före implementation 2026-08-31

- `TASK_006D_INDIVIDUAL_RESULT_FINALIZATION.md` och ADR-0028 låser två explicita
  append-only beslut: klassnapshot följd av loppsfinalisering.
- Endast loppsfinaliseringen får skapa IOF `ResultList status="Complete"`; den
  befintliga exporten förblir live `Snapshot`.
- Complete kräver full aktuell roster-täckning med senaste publicerade
  `OK`/`MP`-revision, exakt aktuell snapshot/klass/bana, jämförbar klassbana och
  inga olösta okända avläsningar. Ingen frånvarostatus fabriceras.
- En gemensam immutable finaliseringstabell ska frysa canonical JSON och, för
  lopp, exakt XML-text/SHA-256. Senare data får endast leda till en ny revision.
- Ny `FINALIZE_RESULTS`-capability separeras från både omräkning och export.
  Stationens offlineväg, paket, ingest, SQLite och kvittenser ändras inte.
- IOF-, domän- och databasgranskningar hittade ingen konflikt med AGENTS,
  CODEX_BRIEF, ADR-0026 eller ADR-0027. Den efterföljande implementationen och
  verifieringen redovisas nedan.

## Genomfört i TASK 006D 2026-08-31

- Arkitektur, domän, offlinegräns, acceptans och IOF-research låstes i
  `TASK_006D_INDIVIDUAL_RESULT_FINALIZATION.md` och ADR-0028 före bred
  implementation. Beslutet inför två append-only steg: komplett icke-tom klass
  och därefter komplett individuellt lopp.
- Migration 0013 lägger additivt till `FINALIZE_RESULTS`, en separat auditaktör
  och `result_finalization` med `CLASS | RACE`, scope-lokal revision, request,
  aktör, snapshot, canonical grundhash och strikt fryst JSON. RACE-raden lagrar
  även exakt IOF XML och SHA-256. Databasen avvisar update/delete och bevisar
  klassens racetillhörighet med komposit foreign key.
- Kandidatprojektionen väljer högsta revisionen över huvud taget per aktuell
  entry. Saknad eller nyare opublicerad revision, stale snapshot, korrupt
  evaluation, klass-/bankonflikt, mixed course och olöst `UNKNOWN_CARD`
  blockerar fail closed. Tomma klasser ignoreras i loppsmanifestet och tomt
  lopp avvisas. Ingen DNS, DNF eller DSQ fabriceras.
- Klassfinaliseringen fryser källrevision, visningsdata, bana, kontrollordning,
  splits och domänranking. Loppsfinaliseringen kräver senaste hashidentiska
  klassfinalisering för varje icke-tom klass, kopierar underlagen och skapar
  enda tillåtna `ResultList status="Complete"`.
- IOF-adaptern har en explicit diskriminerad `Snapshot | Complete`-projektion.
  `Complete` kräver runtimevaliderat bevis med canonical finaliserings-UUID,
  positiv revision och lowercase SHA-256; beviset skrivs aldrig till XML.
  Befintlig liveexport fortsätter alltid vara `Snapshot`.
- `FINALIZE_RESULTS` har eget credentialprefix, högst åtta timmars access,
  högst en timmes session, egna host-only cookies, Origin/CSRF, 4 KiB strikt
  body, idempotency-key och CLI. Exakt retry från samma aktör återger samma rad;
  ändrad aktör eller intent ger konflikt.
- Den svenska privata webbytan visar endast klassnamn, räknare, blockerartext,
  snapshot och revision. Operatören fryser klasser och därefter lopp explicit;
  okänd commit behåller samma request-id i React-minne för manuell retry.
- Exportytan listar racefinaliseringar under den separata
  `EXPORT_IOF_RESULT_LIST`-capabilityn och laddar ned exakt sparade bytes efter
  finaliserings-id. Browsern binder headers/filnamn till manifestet och
  verifierar längd och SHA-256 före nedladdning.
- Senare ingest, namn- eller kontrolldata ändrar aldrig gamla bytes. Ny data gör
  aktuell klassgrund/finalisering inaktuell och kräver nya explicita klass- och
  loppsrevisioner. Finalisering ändrar inte race-snapshot, resultatrevisioner,
  publicering, raw/readout, paket, station eller offlinekö.
- Ingen ny resultatstatus, automatisk publicering/omräkning, Eventor-klient,
  stafett, GPS, karta, SPORTident-parser eller riktig USB infördes.

## Verifiering efter TASK 006D 2026-08-31

- `CI=true pnpm lint`: slutlig körning exit 0; samtliga 10 workspaceprojekt med
  lintscript samt produktionsprobeprojektet passerade.
- `CI=true pnpm typecheck`: slutlig körning exit 0; samtliga 10
  workspaceprojekt samt `tests/production/tsconfig.json` passerade.
- `CI=true pnpm test`: exit 0; 556/556 TypeScript-enhetstester: 49 transport,
  12 domän, 75 kontrakt, 62 IOF, 20 SI-verktyg, 38 station, 19 applikation och
  281 webb. Worker och database saknar testfiler och passerade med
  `--passWithNoTests`.
- Hela migrationskedjan 0000–0013 kördes från en tom databas mot PostgreSQL
  17.11/PostGIS 3.6.4: `pnpm db:migrate` exit 0. Skrivskyddad kontroll
  bekräftade 14 journalrader, exakt ett `FINALIZE_RESULTS`-enumvärde och exakt
  en aktiv `result_finalization_immutable`-trigger.
- `TEST_DATABASE_URL=... CI=true pnpm test:integration`: slutlig körning exit 0;
  87/87 PostgreSQL-integrationstester. Tre TASK 006D-fall verifierar 100
  samtidiga exact retries, obrutna scope-revisioner, ändrat intent/aktör,
  replay efter senare data, blockering, race-/klasscoverage, samtidighet med
  okänd ingest, update/delete-avslag och 100 byteidentiska Complete-läsningar.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e --reporter=list`:
  slutlig körning exit 0; 17/17 Playwrighttester. Det nya flödet verifierar
  tomt före-auth-shell, separata cookies, klass→lopp, live Snapshot, fryst
  Complete, SHA-256, exakt två entries, oförändrade bytes efter displayändring
  och browserdownload utan Web Storage-hemlighet.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript och en
  optimerad Next.js 16.3.3-build passerade. Finaliseringssidan och samtliga fyra
  nya API-routes ingår. Minifierad stationsbundle och kopierad Android-asset är
  vardera 356 674 byte med identisk SHA-256
  `e09556ee3b4cbecbb3f7c807b289f74cc84ced43fbef90a742fe89002ced7ab1`.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  standalone-prober passerade.
- Första fulla E2E-körningen gav 16/17 när disken blev full under Turbopacks
  genererade `.next`-cache. Endast reproducerbar `.next`-cache och tidigare
  `test-results` togs bort. Nästa körning blottlade ett testsynkfel där export-
  credential fylldes före avslutad 401-sessionskontroll; testet väntar nu på
  den observerbara loginstatusen. Slutlig ren omkörning gav 17/17.
- `pnpm android:test`, `pnpm android:lint` och `pnpm android:assemble` kördes med
  befintligt isolerat Android SDK, Build Tools 35, Platform 36 och OpenJDK 17.
  Alla gav exit 1 vid `capacitor-android:compileDebugJavaWithJavac`:
  `invalid source release: 21`. JDK 21 är inte installerad och ingen dependency
  eller verktygskedja ändrades i detta snitt. Första sandboxade `android:test`
  kunde dessutom inte skriva Gradles externa lockfil; godkänd omkörning nådde
  det verkliga JDK-felet ovan.
- Den isolerade PostgreSQL 17-instansen stoppades kontrollerat. Den explicit
  verifierade engångskatalogen `/private/tmp/otid-006d-pg17.ZT5rkT`, inklusive
  de disponibla test- och migrationsdatabaserna, togs därefter bort permanent.

## Kvarvarande antaganden efter TASK 006D

- Ett sanningsenligt Complete kan i detta snitt endast omfatta entries med
  explicit `OK` eller `MP`. En anmäld deltagare som inte startar saknar ännu en
  sann domänstatus och blockerar därför finalisering; O-Tid fabricerar inget.
- `Complete` är ett applikationsbevis enligt IOF-semantiken. XSD:n kan inte
  kontrollera rostercoverage och projektet kör ännu inte hela externa XSD:n i
  test, även om subset, elementordning och fixtures är verifierade mot den
  pinnade officiella 3.0-källan.
- Tomma klasser är avsiktligt utanför manifestet, tomt lopp avvisas och event
  med flera races avvisas tills en sann IOF-raceordinal finns.
- En olöst okänd bricka är en readout med beständigt `UNKNOWN_CARD`-utfall och
  utan resultatrevision. Det finns ännu inget eget operatörsflöde i detta snitt
  för att koppla och avgöra en sådan avläsning i efterhand.
- Äldre finaliseringar är historiskt giltiga och oföränderliga även när senare
  data anländer. Operatören ansvarar för nya klass- och loppsrevisioner när den
  aktuella kandidaten visar inaktualitet.
- Verklig reverse proxy, produktionsbackup/restore, last, längre ström-/process-
  avbrott och fältarbete i regn/skarpt ljus är inte verifierade.
- Androidkällan ändrades inte, men Gradlegrindarna kräver en behörigt installerad
  JDK 21 innan de kan redovisas gröna.
- Ingen fysisk SPORTident-enhet användes. All riktig SPORTident-/USB-status är
  fortsatt `untested`; stationens simulatorväg är den verifierade transporten.

## Föreslagen nästa minsta vertikala uppgift

TASK 006E bör avgränsas till ett explicit individuellt `DidNotStart`-beslut för
en enda aktuell entry, lagrat som en ny immutable resultatrevision med separat
behörighets-, audit- och idempotensgräns. Snittet ska göra en verklig icke-
startare finaliseringsbar utan att samtidigt införa DNF, DSQ, Eventor,
stafett, GPS, SPORTident-parser eller riktig USB.

## TASK 006E: arkitektur låst före implementation 2026-08-31

- `TASK_006E_EXPLICIT_DID_NOT_START.md` och ADR-0029 låser DNS som ett
  uttryckligt manuellt verksamhetsbeslut, aldrig en härledning ur saknad
  avläsning eller revision.
- Kortmotorns `EvaluationResult` och stationens lokala kontrakt breddas inte.
  Lagrade revisioner får en separat strikt `ResultOutcome`-union med
  `DNS / DID_NOT_START`, historisk entry/klass/bana och inga tider/splits.
- Migration 0014 ska lägga additivt till `DECIDE_DID_NOT_START`, separat
  auditaktör/revisionsorsak, immutable beslutsjournal och en explicit
  källconstraint där DNS har null readout och unik beslutsreferens.
- Första policyn tillåter endast en aktuell entry utan tidigare
  resultatrevision. Senare riktig ingest får appenda nästa revision; DNS får
  inte ersätta ett befintligt OK/MP-resultat i detta snitt.
- DNS är orankad, visas som `Ej start`, exporteras som status-only IOF
  `DidNotStart` och får täcka en entry i ny finalisering. Den löser aldrig en
  olöst `UNKNOWN_CARD`-avläsning.
- Ny separat capability, session, Origin/CSRF, idempotens och actor-audit
  införs. Stationens paket, SQLite, outbox, ingestkontrakt och offlineväg
  ändras inte.
- Skrivskyddade Terra-/Luna-granskningar av domän/IOF, databas/säkerhet och
  operatörsflöde hittade ingen konflikt med styrande dokument eller licensregel.

## Genomfört i TASK 006E 2026-08-31

- Domänen har en separat strikt `DidNotStartResult` och
  `did-not-start-v1`; kortmotorn och stationens lokala evaluationkontrakt
  producerar fortsatt aldrig DNS. Klassrankingen placerar endast OK och håller
  DNS orankad efter MP.
- Kontrakten skiljer stationens `EvaluationResult` från lagrad
  `ResultOutcome`. Det privata DNS-flödet binder exakt entryversion, klass,
  banversion, race-snapshot, tomt revisionshuvud och policyversion.
- Migration 0014 lägger additivt till capabilityn `DECIDE_DID_NOT_START`, egen
  auditaktör/revisionsorsak, immutable beslutsjournal, nullable
  `result_revision.readout_id` och deferred beslut↔revision-FK. Den validerade
  källconstrainten kräver DNS + beslut + null readout för manuell provenans och
  förbjuder både DNS-status och DNS-orsak på readoutbaserade revisioner.
- Applikationsmutationen använder separat auth, race- och entrylås,
  request-advisory-lock, strikt exact replay och atomisk beslut/revision/audit.
  Hundra samtidiga retries skapar exakt en write; samtidig ingest ger en hel
  revisionsordning utan overwrite.
- En separat svensk arrangörsyta visar bounded kandidater efter auth, använder
  egna cookies/Origin/CSRF och behåller okänd commit endast i React-minne för
  explicit retry med samma request-id. En kandidat med resultat kan inte
  markeras igen.
- Publikvyn visar `Ej start` utan tid, splits eller placering. Snapshot och
  fryst Complete mappar DNS till status-only IOF `DidNotStart`; proof och
  interna id:n serialiseras inte. OK + explicit DNS kan finaliseras medan
  saknad revision och olöst `UNKNOWN_CARD` fortsatt blockerar.
- Resultathistorik, export och finalisering läser den diskriminerade lagrade
  utgången och validerar källprovenans. Ingestens idempotenshash förblir bunden
  till den oförändrade kortbedömningen.
- Ingen DNF, DSQ, generell resultateditor, automatisk frånvarotolkning,
  Eventor-uppladdning, stafett, GPS, SPORTident-parser eller riktig USB har
  införts.

## Verifiering efter TASK 006E 2026-08-31

- En färsk isolerad PostgreSQL 17.11-databas migrerades 0000–0014 med exit 0.
  PostGIS var 3.6.4, Drizzle-journalen innehöll 15 migrationer, enumen innehöll
  `MANUAL_DID_NOT_START`, den skärpta provenance-constrainten var validerad och
  `did_not_start_decision_immutable` fanns.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript samt
  produktionsprobernas TypeScript passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript samt produktionsprobernas tsconfig passerade.
- `CI=true pnpm test`: exit 0; 86 testfiler och 588 tester passerade:
  domän 14, kontrakt 88, IOF 68, transport 49, SI-verktyg 20, station 38,
  applikation 21 och webb 290. Worker och databas har avsiktligt inga
  enhetstestfiler och avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55436/otid_006e_final CI=true pnpm test:integration`:
  exit 0; 90/90 PostgreSQL/PostGIS-integrationstester passerade. En tidigare
  riktad körning gav 89/90 eftersom det nya testet valde fixturens tomma klass;
  testet väljer nu den icke-tomma klassen och hela sviten är grön.
- Full `pnpm test:e2e --reporter=list` mot den isolerade databasen: exit 0;
  18/18 Playwrighttester passerade. Det nya DNS-flödet provar tomt före-auth-
  shell, egna cookies, tappat svar efter commit, explicit exact retry, exakt en
  beslut/revision/audit, oförändrade raw/readout-räknare och publik `Ej start`.
  De riktade förkörningarna hittade och rättade att kandidatrefresh raderade
  framgångskvittensen samt en felaktig testförväntning på auditens actionnamn;
  slutlig riktad omkörning gav 1/1 och den fulla sviten 18/18.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive minifierad stationsbundle, Capacitor asset-copy och optimerad
  Next.js 16.3.3-build med den nya sidan och tre nya API-routes.
- `CI=true pnpm test:production:simulator --reporter=list`: den första
  sandboxkörningen gav exit 1 eftersom loopback-bindning nekades med `EPERM`.
  Godkänd omkörning utanför nätverkssandboxen gav exit 0 och 2/2
  standalone-prober.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble` kördes men gav vardera exit 1 före Gradle på
  värdens kända miljöbrist: `Unable to locate a Java Runtime`. Assemble hann
  bygga och kopiera webbtillgångarna. Androidkällan ändrades inte och inget
  native-resultat redovisas som godkänt.
- PostgreSQL 17-instansen stoppades kontrollerat. De tre explicit verifierade
  engångskatalogerna `/private/tmp/otid-006e-pg17.I0UK1l` (112 MiB),
  `/private/tmp/otid-006e-pg17.eBJKhU` (46 MiB) och
  `/private/tmp/otid-006e-pg17.tmT2wD` (tom) togs därefter bort permanent.

## Kvarvarande antaganden efter TASK 006E

- Ett ej-startbeslut är ett uttryckligt arrangörsbeslut. Systemet kan inte
  avgöra från tystnad om en deltagare inte startat, är kvar i skogen eller har
  en osynkad avläsning.
- Första policyn tillåter endast en entry utan tidigare resultatrevision. Ett
  felaktigt DNS utan senare avläsning kan ännu inte återtas; historiken får
  aldrig raderas eller skrivas över.
- En senare riktig avläsning appendar en vanlig revision efter DNS och blir
  senaste resultat. Detta är automatiserat mot syntetiska simulatorpayloads,
  inte verifierat med SPORTident-hårdvara.
- DNS bär aktuell banversion som aktualitets- och klassprovenans trots att
  IOF-resultatet är status-only; det påstår inte att deltagaren sprang banan.
- IOF `Complete` är fortsatt ett applikationsbevis för exakt rostercoverage.
  Den pinnade officiella XSD:n kan inte ensam bevisa täckning och vendlas inte.
- Reverse proxy, produktionsbackup/restore, last, längre process-/strömavbrott
  och operativ användning i regn, skarpt ljus och med handskar är inte
  verifierade.
- Värden saknar JDK. Androids oförändrade Gradlegrindar kan inte köras gröna
  förrän projektets pinnade JDK 21 finns tillgänglig.
- Ingen fysisk SPORTident-enhet användes. All riktig SPORTident-/USB-status är
  fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006E

TASK 006F bör avgränsas till ett explicit återtagande av ett felaktigt manuellt
DNS för en entry som fortfarande saknar readout. En ny ADR måste först låsa hur
ett append-only återtagningsbeslut gör den tidigare DNS-revisionen inaktuell
utan radering, hur publik/export/finalisering failar stängt och hur exact retry,
audit och samtidighet bevisas. Snittet ska inte samtidigt införa DNF, DSQ,
generell resultateditor, Eventor, stafett, GPS, SPORTident-parser eller riktig
USB.

## TASK 006F: arkitektur låst före implementation 2026-08-31

- `TASK_006F_EXPLICIT_DID_NOT_START_WITHDRAWAL.md` och ADR-0030 låser ett
  återtagande som separat immutable livscykelbeslut, inte som ny resultatstatus,
  resultatrevision eller mutation av historisk DNS/publicering.
- Första commit kräver att exakt manuell DNS fortfarande är entryns absoluta
  resultathuvud. Intentet binder aktuell entryversion, klass, bana och snapshot;
  exact replay får fortsatt lyckas efter en senare ingest.
- Levande projektioner väljer först sitt normala resultathuvud och applicerar
  därefter en gemensam domänägd overlay. Ett återtaget huvud ger inget aktivt
  resultat och får aldrig falla tillbaka till en äldre revision.
- Publikresultat och Snapshot utelämnar entryn, ny finalisering blockerar med
  `WITHDRAWN_DID_NOT_START` och äldre fryst Complete förblir byte-exakt.
- `WITHDRAW_DID_NOT_START` blir en separat capability med egna cookies,
  sessioner, Origin/CSRF, exact-retry och actor-audit. Stationens kontrakt,
  SQLite, outbox, IOF-statusunion och parser påverkas inte.
- Skrivskyddade Terra-/Luna-granskningar av domän/IOF, databas/säkerhet och
  webb/test hittade ingen konflikt med styrande dokument. En föreslagen
  business-trigger avvisades uttryckligen eftersom resultatlogik inte får ligga
  i databastriggers.

## Genomfört i TASK 006F 2026-08-31

- Domänen har en ren fail-closed resolver för ett redan valt resultathuvud och
  ett exakt DNS-återtagande. Utfallet är `ACTIVE_RESULT` eller
  `NO_ACTIVE_RESULT`; ingen resultatstatus, revisionsorsak eller IOF-typ har
  lagts till.
- Migration 0015 lägger additivt till `WITHDRAW_DID_NOT_START`, separat
  auditaktör, högst åtta timmars credential, deferred reciprocal
  decision↔DNS-revision-parning och en immutable `did_not_start_withdrawal` med
  unika request-, decision- och revisionstarget.
- Mutationen binder current entry/klass/bana/snapshot och exakt historisk
  decision/revision, låser session→credential→race→request→entry och returnerar
  exact replay även efter senare ingest. Ett annat request-id mot samma target
  blir explicit konflikt före unique-constrainten.
- Publikresultat och Snapshot väljer först senaste publicerade huvud och
  applicerar sedan withdrawal-overlayn. Ett återtaget DNS utelämnas och
  `omittedEntryCount` ökar utan fallback. En senare riktig kortrevision blir
  aktiv normalt.
- Finalisering väljer absoluta huvudet och inkluderar withdrawalidentitet i
  basisen. Ny klassfinalisering blockeras med `WITHDRAWN_DID_NOT_START`, äldre
  klassbasis blir inaktuell och tidigare fryst Complete-XML/hash/projektion
  förblir byte-exakta.
- En separat svensk tvåstegsyta har egna host-only cookies, capability,
  Origin/CSRF, 4 KiB bodygräns och minnesburet pending intent. Okänd commit
  auto-retryas aldrig; operatören måste uttryckligen återanvända samma
  request-id.
- Ingen readout, rawpost, resultatrevision, snapshotversion eller historisk
  publiceringsflagga muteras. IOF-adapter, stationsevaluation, SQLite, outbox,
  SPORTidentparser och USB har inte breddats.

## Verifiering efter TASK 006F 2026-08-31

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades 0000–0015
  med exit 0. Drizzlejournalen innehöll 16 migrationer; capabilityen och
  immutable-triggern fanns. De två reciproka käll-FK:erna var deferred och
  initially deferred; withdrawal-target-FK:n var omedelbar.
- En första lokal kontroll använde av misstag Homebrews default-PostgreSQL
  16.15 och gav exit 1 innan några tester, eftersom dess PostGIS-controlfil
  saknades. Den instansen stoppades; samtliga redovisade databasresultat nedan
  kommer från projektets uttryckliga PostgreSQL 17-binärer.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript samt
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript samt produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 94 testfiler och 616 tester passerade: domän 20,
  kontrakt 94, IOF 68, transport 49, databas 1, SI-verktyg 20, station 38,
  applikation 23 och webb 303. Worker har avsiktligt inga testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://127.0.0.1:55438/otid_006f_final CI=true pnpm test:integration`:
  exit 0; 94/94 PostgreSQL/PostGIS-integrationstester passerade. De bevisar
  bland annat 100 exact retries, immutable journal, explicit targetkonflikt,
  ingestserialisering, no-fallback i publik/Snapshot, finaliseringsblockerare
  och byte-stabil historisk Complete.
- Full `CI=true pnpm test:e2e --reporter=list` mot samma isolerade databas:
  exit 0; 19/19 Playwrighttester passerade. Det nya flödet provar tomt
  före-auth-shell, separata cookies, verkligt tvåsteg, tappat svar efter commit,
  explicit exact retry, exakt en withdrawal/audit, oförändrade raw/readout/
  revisionsräknare och att det återtagna DNS försvinner publikt.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationsbundle/Capacitor-copy och optimerad Next.js 16.3.3-build
  med den nya sidan och tre nya API-routes.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  standalone-produktionsprober passerade.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble`: vardera exit 1 före Gradle eftersom värden
  saknar Java-runtime (`Unable to locate a Java Runtime`). Assemble byggde och
  kopierade webbtillgångarna före stoppet. Androidkällan ändrades inte och inget
  native-resultat redovisas som godkänt.
- PostgreSQL 17-instansen stoppades kontrollerat. De explicit skapade
  engångskatalogerna `/private/tmp/otid-006f-pg17.K2BnH1` och
  `/private/tmp/otid-006f-pg17-final.NAePtC` togs därefter bort permanent.

## Kvarvarande antaganden efter TASK 006F

- Återtagandet är ett uttryckligt arrangörsbeslut; systemet avgör inte självt
  att ett historiskt DNS var felaktigt.
- Första policyn kan endast återta TASK 006E:s manuella DNS medan det är
  entryns absoluta resultathuvud. En senare revision gör beslutet
  `SUPERSEDED`; kortbaserade OK/MP och andra manuella statusar kan inte återtas.
- Okända eller osynkade kort kopplas inte genom gissning. Samtidig senare ingest
  är verifierad med syntetiska payloads, inte fysisk SPORTident-hårdvara.
- Aktuella namn och organisationsfält i den privata listan är visningsdata;
  det historiska beslutets identitet, target och Complete-bytes är immutable.
- En äldre Complete-export är avsiktligt åtkomlig som historiskt dokument även
  när aktuell basis senare har ändrats genom withdrawal.
- Reverse proxy, produktionsbackup/restore, last, längre process-/strömavbrott
  samt handsk-, regn- och solljusanvändning är inte verifierade.
- Värden saknar projektets JDK 21, så Androids Gradlegrindar är inte verifierade.
- Ingen fysisk SPORTident-enhet användes; riktig SPORTident-/USB-status är
  fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006F

TASK 006G bör avgränsas till en enda explicit manuell diskvalifikation av ett
exakt aktuellt individuellt resultathuvud och ett append-only återtagande av
just det beslutet. En ny ADR måste först låsa DSQ-provenans, resultatrevision,
ranking/IOF/finalisering, exact retry och hur den befintliga no-fallback-
livscykeln återanvänds utan en generell resultateditor. Snittet ska inte införa
DNF, Eventor, stafett, GPS, SPORTidentparser eller riktig USB.

## TASK 006G – arkitektur låst före implementation 2026-08-31

Det avgränsade nästa snittet är fastlagt i
`TASK_006G_MANUAL_RESULT_DISQUALIFICATION.md` och ADR-0031 innan bred kodändring.
Tre skrivskyddade granskningar täckte domän/IOF, PostgreSQL/samtidighet och
webb/test. Den pinnade officiella IOF 3.0-XSD:n verifierades dessutom direkt vid
commit `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230`.

Beslutet är att ett manuellt DSQ skapar en immutable decision och en publicerad
`DSQ / MANUAL_DISQUALIFICATION`-revision. Ett aktivt beslut fortsätter styra
levande resultat trots senare tekniska revisioner; en offlineingest får alltså
bevaras men upphäver inte DSQ tyst. Återtagandet appenderar både immutable
withdrawal och en ny publicerad revision som exakt återställer operatörens
intentbundna senaste giltiga underliggande `OK`/`MP`-källa.

Två separata capabilities används: `DISQUALIFY_RESULT` och
`WITHDRAW_DISQUALIFICATION`. Ranking, publik, IOF och finalisering breddas med
DSQ, men kortmotorn, stationens evaluation, SQLite, outbox och kvittenser gör
det inte. Nya finaliseringsprojektioner använder format 2; historiskt format 1
och äldre frysta Complete-bytes måste förbli läsbara och oförändrade.

Inga produktionsfiler var ändrade när detta arkitekturbeslut markerades. Nästa
steg är additiv domän-/kontrakts-/databasscaffolding enligt ADR-0031; ingen DNF,
Eventor, stafett, GPS, SPORTidentparser eller riktig USB ingår.

## Genomfört i TASK 006G 2026-09-01

- Domänen kan skapa en lagrad `DSQ / MANUAL_DISQUALIFICATION` från exakt ett
  aktuellt `OK`/`MP`-resultat, hålla beslutet aktivt över senare tekniska
  revisioner och skapa en exakt restaurering från den intentbundna källan.
  Stationens `EvaluationResult` och offlinekö breddades inte.
- Kontrakten använder diskriminerad DSQ-provenans i publikresultat, historik
  och finaliseringsprojektion format 2. Historiskt format 1 förblir läsbart.
  IOF Snapshot och Complete mappar DSQ till `Disqualified`, bevarar källans
  tillåtna tider/splits och utelämnar position och tid efter.
- Migration 0016 lägger additivt till `DISQUALIFY_RESULT` och
  `WITHDRAW_DISQUALIFICATION`, separata actor kinds, immutable decision och
  withdrawal samt de komposit-FK-, unique-, check- och deferred reciprocal-
  constraints som binder exakt revisionskedja. Restore-noten kräver forward
  restore; historiska beslut eller revisioner ska inte destruktivt rullas bort.
- Applikationen har separata kandidat-, mutations- och credentialflöden med
  exact replay, fast låsordning och gemensam effektiv-resultatresolver för
  publik, Snapshot, historik och finalisering. Hundra samtidiga retries skapar
  exakt en decision/withdrawal, en revision och en audit per intent.
- Webbappen har två separata svenska tvåstegsytor med egna capabilities,
  sessions-/CSRF-cookies, Originkontroll, 4 KiB bodygräns, minst 52 px touchmål
  och explicit same-id-retry efter okänd commit. Accesscredential och intent
  skrivs inte till URL eller Web Storage.
- Det nya E2E-fallet upptäckte att publikvyn visade interna DSQ-koder. Vyn
  använder nu externa svenska etiketter för samtliga stödda statusar och
  orsaker; API-kontrakten behåller stabila maskinkoder.
- Rawposter, avläsningar och snapshotversion muteras inte av DSQ eller
  återtagande. Ingen DNF, kontrollneutralisering, generell resultateditor,
  Eventor, stafett, GPS, SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006G 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades 0000–0016
  med exit 0. Drizzlejournalen innehöll 17 migrationer.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 106 testfiler och 680 tester passerade: domän 35,
  kontrakt 110, IOF 70, transport 49, databas 7, SI-verktyg 20, station 38,
  applikation 27 och webb 324. Worker saknar avsiktligt testfiler och avslutade
  med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55447/otid_006g_final2
  CI=true pnpm test:integration`: exit 0; 96/96 PostgreSQL/PostGIS-tester
  passerade. De nya två fallen provar bland annat 100 samtidiga exact retries,
  aktiv DSQ över senare ingest, exakt restaureringskälla, immutable historik,
  IOF Snapshot/Complete och byte-stabil äldre Complete efter återtagande.
- Full `CI=true pnpm test:e2e --reporter=list` mot samma isolerade databas:
  exit 0; 20/20 Playwrighttester passerade. Det nya testet provar privata skal,
  separata cookies/capabilities, verkligt tvåsteg, tappat svar efter båda
  commits, explicit exact replay, audit/revisionskedja, oförändrad raw/readout
  och publik DSQ→återställd OK. En första full körning gav 18/20 därför att två
  äldre testassertions krävde råkoderna `COMPLETE` och `DID_NOT_START` i svensk
  UI; assertions uppdaterades och slutkörningen var helt grön.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationsbundle/Capacitor-copy och optimerad Next.js 16.3.3-build
  med båda nya adminsidorna och deras API-routes.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  standalone-produktionsprober passerade. Första sandboxförsöket gav exit 1
  med `listen EPERM`; samma byggartefakt kördes om med lokal portbehörighet.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble`: vardera exit 1 före Gradle eftersom värden
  saknar Java-runtime (`Unable to locate a Java Runtime`). Assemble byggde och
  kopierade webbtillgångarna före stoppet. Inget native-resultat redovisas som
  godkänt.
- PostgreSQL 17-instansen stoppades kontrollerat. Den explicit skapade
  engångskatalogen `/private/tmp/otid-006h.R1PJ2C` (131 MB) och dess loggar togs
  därefter bort permanent.
- PostgreSQL 17-instansen stoppades kontrollerat. Den explicit skapade
  engångskatalogen `/private/tmp/otid-006g-final2.oZQYWB` (78 MB) togs därefter
  bort permanent.

## Kvarvarande antaganden efter TASK 006G

- Diskvalifikation och återtagande är uttryckliga arrangörsbeslut; systemet
  försöker inte härleda dem från kortdata eller senare avläsningar.
- Första policyn targetar ett exakt aktuellt individuellt `OK`/`MP`. Ett aktivt
  DSQ styr tills explicit återtagande, som endast får kopiera den frysta
  aktuella tekniska källan; ingen fri redigering eller historisk fallback finns.
- En ny finalisering använder format 2 och fryser både effektiv och absolut
  revisionsprovenans. Äldre Complete XML/hash/projektion förblir immutable även
  när levande resultat senare återtas.
- Samtidighet och avbrott är verifierade mot syntetiska simulatorpayloads och
  lokal PostgreSQL, inte med tio fysiska stationer eller SPORTident-hårdvara.
- Reverse proxy, produktionsbackup/PITR, komplett tävlingsarkiv-restore, last,
  längre process-/strömavbrott samt operativ användning i regn, skarpt ljus och
  med handskar är inte verifierade.
- Värden saknar projektets JDK 21; Androids Gradlegrindar är därför fortsatt
  overifierade. Riktig SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006G

TASK 006H bör avgränsas till ett enda explicit manuellt godkännande av ett
exakt aktuellt individuellt `MP`-resultat och ett append-only återtagande av
just godkännandet. En ADR måste först låsa `MANUAL_APPROVAL`-provenans,
ranking/IOF/finalisering, exact retry och restaurering av exakt MP-källa utan en
generell resultateditor. Snittet ska inte samtidigt införa DNF,
kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller riktig
USB.

## TASK 006H – arkitektur låst före implementation 2026-09-01

- `TASK_006H_MANUAL_RESULT_APPROVAL.md` och ADR-0032 låser ett stored-only
  `OK/MANUAL_APPROVAL` från exakt aktuellt, publicerat och tidskomplett
  `MP/MISSING_CONTROL` eller `MP/WRONG_ORDER`. Tidslösa MP-former avvisas; ingen
  tid, punch eller split fabriceras.
- Tre skrivskyddade Terra-/Luna-granskningar täckte domän/IOF,
  PostgreSQL/applikationssamtidighet samt webb/säkerhet/test. En första
  no-overlay-idé avvisades efter kontroll mot CODEX_BRIEF 11.4: senare
  offlineingest får appendera men får inte tyst ersätta en manuell åtgärd.
- Aktiv approval blir därför en central, validerad overlay och får inte
  samexistera med aktiv DSQ. Withdrawal binder observerat absolut huvud och
  exakt senaste giltiga tekniska `OK`/`MP`-källa och appenderar en canonicalt
  identisk restaureringsrevision.
- Publik, historik och finalisering får format 3 medan äldre format förblir
  läsbara. IOF använder status `OK`; saknad split tillåts endast med ett strikt
  runtimevaliderat, icke-serialiserat `manualApprovalProof` och skrivs som
  `SplitTime status="Missing"` utan fabricerad tid.
- `APPROVE_RESULT` och `WITHDRAW_RESULT_APPROVAL` är separata capabilities med
  egna credentials, cookies, CSRF och exact-retry-journaler. Ingen generell
  resultateditor, DNF, kontrollneutralisering, Eventor, stafett, GPS,
  SPORTidentparser eller riktig USB ingår.

Arkitekturdokumenten skapades innan produktionskod för 006H. Genomförande och
verifiering redovisas nedan.

## Genomfört i TASK 006H 2026-09-01

- Domänen har en ren konstruktor för `OK/MANUAL_APPROVAL` som endast accepterar
  tidskomplett tekniskt `MP/MISSING_CONTROL` eller `MP/WRONG_ORDER`, deep-kopierar
  källans tider, kontroller och splits och avvisar alla tidslösa eller korrupta
  former. Stationens evaluation och offlinekontrakt breddades inte.
- Kontrakten har strikt lagrad approval, separata adminflöden samt publik-,
  historik- och finaliseringsformat 3. Historiska format 1 och 2 är fortsatt
  läsbara. Publik format 3 visar svensk manuell provenans, ranking, saknade
  kontroller och sträcktider utan interna beslut-id:n.
- Migration 0017 lägger additivt till `APPROVE_RESULT` och
  `WITHDRAW_RESULT_APPROVAL`, separata actor kinds och revisionsorsaker,
  provenienskolumner samt immutable decision-/withdrawaljournaler med deferred
  komposit-FK, unique- och checkinvarianter. Restore är forward-only enligt
  ADR-0032; historiska rader eller enumvärden ska inte droppas.
- Applikationen har en gemensam fail-closed resolver för aktiv approval och
  dess ömsesidiga uteslutning mot aktiv DSQ. Approval ligger kvar som effektivt
  resultat över senare teknisk ingest; withdrawal binder exakt observerat
  absolut huvud och exakt senaste giltiga tekniska OK/MP-källa och appenderar
  en canonicalt identisk restaureringsrevision.
- Hundra samtidiga exact retries för vardera mutation skapar exakt en decision
  eller withdrawal, en revision och en audit. Rawposter, readouts och
  snapshotversion ändras inte av verksamhetsbesluten.
- IOF Snapshot och Complete mappar approval till `OK`. Saknad kontroll skrivs
  som `SplitTime status="Missing"` utan tid endast när projektionen bär ett
  strikt runtimevaliderat `manualApprovalProof`; proof och intern proveniens
  serialiseras aldrig. Complete kräver fortsatt ett separat finalization proof.
- Webbappen har två separata svenska tvåstegsytor, capabilities, credentials,
  host-only cookies och CSRF-gränser. Origin och högst 4 KiB strikt JSON
  valideras före mutation. Intent stannar i React-minne, okänd commit ger ingen
  automatisk retry och explicit retry återanvänder exakt request-id och body.
- Ett PostgreSQL-test upptäckte att kandidatprojektionen läckte två interna
  namnfält till ett strikt minimalt DTO och därför failade stängt. Projektionen
  formar nu exakt kontraktsfälten; både kandidat- och withdrawal-listan provas
  mot riktig PostgreSQL.
- Ingen DNF, kontrollneutralisering, generell resultateditor, Eventor,
  multi-race, stafett, GPS, SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006H 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades 0000–0017
  med exit 0. Drizzlejournalen innehöll 18 migrationer och båda nya tabellerna.
  Ett första sandboxat migrationsförsök gav exit 1 med `listen EPERM`; samma
  kommando kördes om med lokal IPC-/databasbehörighet och passerade.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade. De två nya credentialskripten
  lintades dessutom explicit med exit 0. E2E-filen ingår inte i ESLints
  TypeScript project service; en separat direktkörning av ESLint på den gav
  därför exit 1 innan lintning, medan Playwright kompilerade och körde filen.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 120 testfiler och 749 tester passerade: domän 48,
  kontrakt 127, IOF 74, transport 49, databas 14, SI-verktyg 20, station 38,
  applikation 34 och webb 345. Worker saknar avsiktligt testfiler och avslutade
  med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55448/otid_006h_work17
  CI=true pnpm test:integration`: exit 0; 98/98 PostgreSQL/PostGIS-tester
  passerade. TASK 006H-fallen täcker 100 samtidiga retries per mutation,
  immutable SQL, aktiv overlay över senare ingest, exakt revision 3-
  restaurering, publik ranking, IOF Snapshot/Complete, historikformat 3 och
  byte-/hashstabil äldre finalisering.
- Full `CI=true pnpm test:e2e --reporter=list` mot samma isolerade databas:
  exit 0; 21/21 Playwrighttester passerade på 49,6 sekunder. Det nya scenariot
  verifierar separata capabilities/cookies, tvåsteg utan write, tappat
  approval-svar utan automatisk retry, explicit exact replay, offentlig svensk
  `MANUAL_APPROVAL` med saknad kontroll och exakt withdrawal till MP.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  produktionsprober passerade.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med båda nya adminsidorna och deras API-routes.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble`: vardera exit 1 före Gradle eftersom värden
  saknar Java-runtime (`Unable to locate a Java Runtime`). Assemble byggde och
  kopierade webbtillgångarna före stoppet. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden efter TASK 006H

- Manuellt godkännande är ett uttryckligt arrangörsbeslut och första policyn
  omfattar endast publicerat, tidskomplett `MP/MISSING_CONTROL` eller
  `MP/WRONG_ORDER`. Ingen tid, punch eller split får skapas eller redigeras.
- Aktiv approval styr tills explicit withdrawal. Sen teknisk ingest bevaras,
  men withdrawal får endast återställa den exact intentbundna senaste
  publicerade tekniska OK/MP-källan; korrupt eller förändrat huvud är konflikt.
- Nya finaliseringar fryser format 3 och komplett approvalprovenans. Äldre
  format 1/2 och redan skapade Complete-bytes/hash antas fortsatt vara
  immutable och är regressionsverifierade lokalt.
- IOF-reglerna är verifierade mot pinnad officiell XSD-semantik och lokala
  strukturella/deterministiska fixtures, inte genom uppladdning till en extern
  Eventor- eller tävlingsinstallation.
- Samtidighet och avbrott är verifierade mot syntetiska payloads och lokal
  PostgreSQL, inte mot tio fysiska stationer eller SPORTident-hårdvara.
- Reverse proxy, produktionsbackup/PITR, komplett tävlingsarkiv-restore, last,
  längre process-/strömavbrott samt operativ användning i regn, skarpt ljus och
  med handskar är inte verifierade.
- Värden saknar projektets JDK 21; Androids Gradlegrindar är därför fortsatt
  overifierade. Riktig SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006H

TASK 006I bör avgränsas till ett explicit individuellt `DNF`-beslut från ett
exakt aktuellt, publicerat och tidsmässigt verifierbart tekniskt resultat. En
ADR måste först låsa när `DNF` är sanningsenligt, dess lagrade reason,
ranking/IOF/finalisering, idempotens och förhållande till aktiva DNS-, DSQ- och
approvalbeslut. Snittet ska inte samtidigt införa återtagande, manuella tider,
kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller riktig
USB.

## Dokumentkonflikt upptäckt före TASK 006I 2026-09-01

- `docs/domain-rules.md` beskrev TASK 006D:s ursprungliga finaliseringsgrind
  som endast `OK | MP | DNS`, medan accepterade ADR-0031 och ADR-0032 samt den
  verifierade implementationen redan låter nya finaliseringar omfatta effektiv
  `DSQ/MANUAL_DISQUALIFICATION` respektive `OK/MANUAL_APPROVAL` med fryst
  provenans. Texten var därför inaktuell, inte en tredje avsedd arkitektur.
- Innan DNF-arkitekturen låses samordnas domänregeln med ADR-0028, ADR-0031 och
  ADR-0032: finalisering bedömer den centralt resolverade effektiva revisionen,
  tillåter endast de uttryckligen stödda och strikt validerade outcomeformerna
  och fryser både effektiv och absolut underliggande revisionsprovenans.
  Historiska format och äldre Complete-bytes ändras inte.

## TASK 006I – arkitektur låst före implementation 2026-09-01

- `TASK_006I_EXPLICIT_DID_NOT_FINISH.md` och ADR-0033 låser ett persisted-only,
  status-only `DNF/DID_NOT_FINISH` mot entryns absoluta aktuella, publicerade
  och tekniska `OK|MP`-revision. Kortmotor, station och ingestkontrakt breddas
  inte; targeten är granskningsprovenans och det explicita beslutet är DNF-
  faktumet.
- Tre skrivskyddade Terra-/Luna-granskningar täckte domän/IOF,
  PostgreSQL/applikationssamtidighet samt webb/säkerhet/test. En ren
  `MISSING_FINISH`-policy avvisades eftersom produktionskontrakt och
  `card_readout` i dag kräver finish och därmed gör den vägen onåbar utan ett
  större ingest-/schemasnitt.
- DNF blir en permanent aktiv overlay i detta snitt. Sen offlineingest får
  appendas men får inte tyst upphäva beslutet. En gemensam entry-låst grind gör
  aktiv DNS, DSQ, approval och DNF ömsesidigt uteslutande och rättar den
  upptäckta asymmetrin mellan befintliga approval-/DSQ-writers.
- Publik, historik och finalisering får format 4; IOF mappar status-only DNF
  till `DidNotFinish` utan tider, ranking, splits eller intern provenans.
  Historiska format och frysta Complete-bytes förblir oförändrade.
- `DECIDE_DID_NOT_FINISH` får egen credential, session, CSRF och exact-retry-
  journal. DNF-withdrawal, manuella tider, kontrollneutralisering, Eventor,
  stafett, GPS, SPORTidentparser och riktig USB ligger utanför snittet.

Arkitekturdokumenten skapades och dokumentkonflikten samordnades före
produktionskod för 006I.

## Genomfört i TASK 006I 2026-09-01

- Domänen har en ren konstruktor för ett strikt lagrat, status-only
  `DNF/DID_NOT_FINISH` från exakt tekniskt `OK|MP`. Den validerar source shape
  men kopierar endast entry-, klass- och banidentitet; start, mål, elapsed,
  kontroller och splits skapas aldrig. Resultatordningen är nu
  `OK`, `MP`, `DSQ`, `DNF`, `DNS`, där fortsatt endast `OK` är rankbart.
- Kontrakten har ett separat DNF-adminflöde och publik-, historik- och
  finaliseringsformat 4. Historiska format 1–3 är fortsatt läsbara. Publik DNF
  visar svensk status och manuell provenance utan tid, placering, tid efter,
  kontroller, splits eller interna beslut-id:n.
- Migration 0018 lägger additivt till `DECIDE_DID_NOT_FINISH`, actor kind
  `DID_NOT_FINISH_ACCESS_CREDENTIAL`, revisionsorsaken
  `MANUAL_DID_NOT_FINISH`, provenienskolumnen och en immutable
  `did_not_finish_decision`-journal med komposit-FK, unique- och
  checkinvarianter. Restore är forward-only enligt ADR-0033; befintliga rader
  och historiska enumvärden skrivs inte om eller tas bort.
- Applikationen kräver entryns absoluta senaste publicerade tekniska
  `OK|MP`-revision, exakt entry-/klass-/bana-/snapshotversion och en separat
  DNF-capability. Exact retry låser request-id och hela intentet. Beslut,
  publicerad DNF-revision och audit appenderas atomiskt medan rawmeddelande,
  readout, tekniska revisioner och snapshotversion förblir oförändrade.
- Den centrala entry-låsta manualgrinden behandlar aktiv DNS, DSQ, approval och
  DNF som ömsesidigt uteslutande. DNF är en permanent overlay i detta snitt:
  senare offlineingest får appendera tekniska revisioner men får inte tyst
  ersätta operatörens beslut. Samma grind rättar den tidigare asymmetrin där
  en senare teknisk revision kunde dölja aktiv approval för DSQ-writern.
- IOF Snapshot och nya Complete-dokument mappar DNF till
  `DidNotFinish` med endast obligatorisk `Status`. Ingen tid, position,
  TimeBehind, SplitTime eller intern provenance serialiseras. Complete kräver
  fortsatt ett separat finalization proof och format 4 fryser DNF-beslut,
  target, effektiv revision och absolut underliggande fysiskt huvud.
- Webbappen har en separat svensk tvåstegsyta, credential, host-only session,
  CSRF och privata headers. Kandidat-API:t är bounded och lämnar inte ut
  bricknummer, punches eller tidsdata. Intent hålls endast i React-minne och
  okänd commit får bara en uttrycklig retry med samma request-id och body.
- Ingen DNF-withdrawal, generell resultateditor, manuell tid, punch- eller
  splitändring, kontrollneutralisering, Eventor, multi-race, stafett, GPS,
  SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006I 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades 0000–0018
  med exit 0. Drizzlejournalen innehöll 19 migrationer och tabellen
  `did_not_finish_decision`. Ett första sandboxat `initdb`-försök stoppades av
  delat-minne-`EPERM`; samma initiering med lokal databasbehörighet passerade.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade. DNF-credentialskriptet lintades
  dessutom explicit med exit 0. E2E-filen ingår inte i ESLints TypeScript
  project service; en separat direktkörning gav därför exit 1 före lintning
  med `was not found by the project service`, medan Playwright kompilerade och
  körde filen.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade. Efter den
  sista PostgreSQL-assertionen passerade applikationens lint och typecheck på
  nytt med exit 0.
- `CI=true pnpm test`: exit 0; 128 testfiler och 817 tester passerade: domän 73,
  kontrakt 142, IOF 83, transport 49, databas 20, SI-verktyg 20, station 38,
  applikation 38 och webb 354. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55449/otid_006i CI=true
  pnpm test:integration`: exit 0; 101/101 PostgreSQL/PostGIS-tester passerade.
  TASK 006I-fallen täcker 100 samtidiga exact retries, immutable `UPDATE` och
  `DELETE`, write-fri stale-konflikt, aktiv overlay över senare ingest,
  manual-mutex, den rättade approval→senare teknik→DSQ-vägen, publik format 4,
  IOF Snapshot/Complete och byte-/hashstabil äldre finalisering.
- Full `CI=true pnpm test:e2e --reporter=list` mot samma isolerade databas:
  exit 0; 22/22 Playwrighttester passerade på 53,9 sekunder. En första
  helkörning gav 21 godkända och en inaktuell assertion som väntade aktuellt
  publikformat 3; den samordnades till ADR-0033:s format 4 före den gröna
  omkörningen. Det nya scenariot verifierar separat DNF-capability,
  tvåstegsbekräftelse utan förtida write, lagrad status-only DNF, återladdad
  aktiv overlay och publik DNF utan tid eller placering.
- `CI=true pnpm test:production:simulator --reporter=list`: den första
  sandboxkörningen gav exit 1 genom `listen EPERM` innan test; samma oförändrade
  körning med lokal loopbackbehörighet gav exit 0 och 2/2 prober passerade.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med DNF-sidan och dess tre API-routes.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble`: vardera exit 1 före Gradle eftersom värden
  saknar Java-runtime (`Unable to locate a Java Runtime`). Assemble byggde och
  kopierade webbtillgångarna före stoppet. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden efter TASK 006I

- DNF är ett uttryckligt arrangörsbeslut, inte en slutsats från saknad
  målstämpling, tystnad eller en viss MP-orsak. Första policyn accepterar exakt
  aktuell publicerad teknisk `OK|MP`; targeten är provenance och operatörens
  beslut är själva DNF-faktumet.
- DNF är permanent aktivt i 006I. Senare teknisk ingest bevaras men ändrar inte
  den levande projektionen. Korrigering kräver ett separat append-only
  withdrawal-snitt; ingen dold edit eller delete antas vara tillåten.
- Nya finaliseringar fryser format 4 och full DNF-provenance. Äldre format 1–3
  och redan skapade Complete-bytes/hash antas fortsatt vara immutable och är
  regressionsverifierade lokalt.
- IOF-reglerna är verifierade mot pinnad officiell XSD-semantik och lokala
  strukturella/deterministiska fixtures, inte genom uppladdning till en extern
  Eventor- eller tävlingsinstallation.
- Samtidighet och avbrott är verifierade mot syntetiska payloads och lokal
  PostgreSQL, inte mot tio fysiska stationer eller SPORTident-hårdvara.
- Reverse proxy, produktionsbackup/PITR, komplett tävlingsarkiv-restore, last,
  längre process-/strömavbrott samt operativ användning i regn, skarpt ljus och
  med handskar är inte verifierade.
- Värden saknar projektets JDK 21; Androids Gradlegrindar är därför fortsatt
  overifierade. Riktig SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006I

TASK 006J bör avgränsas till ett explicit append-only återtagande av ett aktivt
individuellt DNF-beslut. En ADR måste först låsa exact retry, observerat absolut
huvud, återställning av exakt senaste giltiga tekniska källa, förhållandet till
senare ingest samt publik/IOF/historik/finalisering utan generell
resultateditor. Snittet ska inte samtidigt införa nya statusar, manuella tider,
kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller riktig
USB.

## TASK 006J – arkitektur låst före implementation 2026-09-01

- `TASK_006J_EXPLICIT_DID_NOT_FINISH_WITHDRAWAL.md` och ADR-0034 låser ett
  immutable DNF-withdrawal och en publicerad restaureringsrevision som
  canonicalt kopierar exakt intentbunden teknisk `OK|MP`-källa. Ingen decision,
  DNF-revision, rawdata eller teknisk revision muteras.
- Tre skrivskyddade Terra-/Luna-granskningar täckte domän/IOF/projektioner,
  PostgreSQL/applikationssamtidighet och webb/säkerhet/test. Ingen konflikt
  hittades mellan styrdokumenten; ADR-0034 kompletterar ADR-0033:s uttryckliga
  reservering av withdrawal till ett senare snitt.
- Utan senare teknik restaureras originaltarget. Med senare teknik måste det
  absoluta huvudet självt vara den direkta publicerade tekniska källan.
  Opublicerat/manuellt/korrupt huvud, stale intent och historisk fallback
  avvisas utan write.
- Migration 0019 får uttryckligen ta bort 0018:s tillfälliga livstidsunika
  DNF-entry-index och ersätta den med en uppslagsindex. Inga rader skrivs om;
  högst en aktiv DNF-kedja upprätthålls i den centrala entry-låsta resolvern.
  Nytt DNF efter withdrawal kräver en ny direkt teknisk revision.
- Publik förblir format 4 och IOF får ingen ny status. Historik och nya
  finaliseringar använder format 5; äldre format och redan fryst Complete-
  XML/hash förblir oförändrade.
- `WITHDRAW_DID_NOT_FINISH` får egen credential, session, CSRF och exact-retry-
  journal. Bulk/editor, automatisk withdrawal, manuell tid,
  kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser och riktig
  USB ligger utanför snittet.

Arkitekturdokumenten skapades och samordnades före produktionskod för 006J.

## Genomfört i TASK 006J 2026-09-01

- Domänen har en ren, I/O-fri resolver för exakt aktiv
  DNF→withdrawal→restoration-livscykel. Utan senare teknik väljs beslutets
  ursprungliga tekniska target; med senare teknik måste det absoluta huvudet
  självt vara den direkta publicerade tekniska `OK|MP`-källan. Äldre källa,
  återanvänt target, manuellt/opublicerat huvud och all fallback failar stängt.
- Kontrakten har ett separat withdrawal-adminformat samt historik- och
  finaliseringsformat 5 med bakåtkompatibel läsning av format 1–4. Publik
  wireform förblir format 4 och lämnar inte ut intern withdrawalprovenans.
- Migration 0019 lägger additivt till `WITHDRAW_DID_NOT_FINISH`, actor kind,
  revisionsorsak, restaureringsprovenans och en immutable
  `did_not_finish_withdrawal`-journal. Migration 0018:s tillfälliga
  livstidsunika entry-index ersätts av en icke-unik uppslagsindex; befintliga
  beslut och revisioner skrivs inte om.
- Applikationen binder hela intentet till race, entry, klass, bana,
  snapshotversion, decision, DNF-revision, observerat absolut huvud och exakt
  teknisk restaureringskälla. Withdrawal, publicerad restaureringsrevision och
  audit appenderas i samma entry-låsta transaktion. Exact retry returnerar
  samma write även efter senare ingest; ändrad actor eller ett enda intentfält
  blir konflikt.
- Den centrala manuella livscykelgrinden ser endast icke återtaget DNF som
  aktivt, avvisar dubbelaktiv eller korrupt historik och tillåter inte ett nytt
  DNF direkt mot den manuella restaureringsrevisionen. Samtidig ingest,
  finalisering och withdrawal ger en entydig före/efter-ordning under lås.
- Levande publik-, ranking-, historik-, Snapshot- och finaliseringsprojektioner
  använder det exakt restaurerade tekniska utfallet. `OK` rankas åter, `MP`
  förblir orankat och IOF får endast sina befintliga `OK`/`MissingPunch`-
  element. Complete kräver fortfarande explicit proof och äldre fryst XML/hash
  förblir byte-identisk.
- Webbappen har en separat svensk tvåstegsyta, credential, host-only session,
  CSRF, privata headers och bounded kandidatlista. Intent ligger endast i
  React-minne; tappat svar kan bara återförsökas uttryckligen med exakt samma
  request-id och body. Credential-CLI och operativa instruktioner är
  uppdaterade.
- Ingen generell resultateditor, manuell tid, punch-/splitändring,
  kontrollneutralisering, Eventor, multi-race, stafett, GPS,
  SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006J 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades
  0000–0019 med exit 0. Drizzlejournalen innehöll 20 migrationer och alla fem
  avsiktligt uppskjutna komposit-FK:er validerades.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade efter de sista ändringarna.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade efter de sista
  ändringarna.
- `CI=true pnpm test`: exit 0; 135 testfiler och 856 tester passerade: domän
  84, transport 49, IOF 83, kontrakt 150, SI-verktyg 20, station 38, databas
  27, applikation 42 och webb 363. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55461/otid_006j_final
  pnpm test:integration --reporter=verbose`: exit 0; 105/105
  PostgreSQL/PostGIS-tester passerade på 3,48 sekunder. De nya fallen täcker
  100 exact retries, två skilda request-id:n, withdrawal mot samtidig ingest
  och finalisering, immutable journal, corrupt provenance, ranking, publik,
  IOF Snapshot/Complete och äldre finaliseringars byte-/hashstabilitet.
- Full `CI=true pnpm test:e2e --reporter=list` mot samma isolerade databas:
  exit 0; 22/22 Playwrighttester passerade på 54,4 sekunder. DNF-scenariot
  verifierar separat capability, tvåstegsbekräftelse, nekad fel capability,
  tappat svar, explicit exact retry och exakt återställt `MP`. En tidigare
  riktad körning upptäckte en för strikt revisionsföljdsassertion i
  listkontraktet; den rättades till `max(DNF, source) + 1` och både riktad och
  full omkörning passerade.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  produktionsprober passerade på 640 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med den separata withdrawal-sidan och dess tre API-routes.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble`: vardera exit 1 före Gradle eftersom värden
  saknar Java-runtime (`Unable to locate a Java Runtime`). Assemble byggde och
  kopierade webbtillgångarna före stoppet. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden efter TASK 006J

- Withdrawal uttrycker att det manuella DNF-beslutet var fel. Den enda första
  reasonen är `ERRONEOUS_MANUAL_DID_NOT_FINISH`; automatisk återtagning eller
  fri orsaksväljare antas inte vara tillåten.
- Det restaurerade utfallet antas vara exakt källrevisionens publicerade
  tekniska `OK|MP`, utan ny uträkning. Ett nytt DNF efter återtagandet kräver
  en ny direkt teknisk revision och får inte targeta restaureringsrevisionen.
- Nya finaliseringar fryser format 5 och hela withdrawalprovenansen. Äldre
  format 1–4 och redan skapade Complete-bytes/hash antas fortsatt vara
  immutable och är regressionsverifierade lokalt.
- IOF-reglerna är verifierade mot den pinnade officiella XSD-semantiken och
  lokala strukturella/deterministiska fixtures, inte genom uppladdning till en
  extern Eventor- eller tävlingsinstallation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte mot flera fysiska stationer eller
  SPORTident-hårdvara.
- Reverse proxy, produktionsbackup/PITR, komplett tävlingsarkiv-restore, last,
  längre process-/strömavbrott samt operativ användning i regn, skarpt ljus
  och med handskar är inte verifierade.
- Värden saknar projektets JDK 21; Androids Gradlegrindar är därför fortsatt
  overifierade. Riktig SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006J

TASK 006K bör avgränsas till ett explicit individuellt beslut om `utom
tävlan` mot en exakt aktuell, publicerad teknisk `OK|MP`-revision. En ADR måste
först låsa intern status, ranking, sanningsvillkor, IOF-mappning,
finaliseringsprovenans och ömsesidig uteslutning med DNS, DSQ, approval och
DNF. Snittet ska inte samtidigt införa withdrawal, utan tidtagning, manuella
tider, kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller
riktig USB.

## TASK 006K – arkitektur låst före implementation 2026-09-01

- `TASK_006K_EXPLICIT_OUT_OF_COMPETITION.md` och ADR-0035 låser ett
  persisted-only `OOC/OUT_OF_COMPETITION` mot entryns absoluta aktuella,
  publicerade och direkt tekniska `OK|MP`-revision. Kortmotor, station och
  ingestkontrakt breddas inte.
- Tre skrivskyddade Terra-/Luna-granskningar täckte domän/IOF, PostgreSQL/
  applikationssamtidighet samt webb/säkerhet/test. Ingen styrdokumentskonflikt
  hittades. Den pinnade XSD:n verifierades separat: `NotCompeting` betyder
  löpning utanför tävlan.
- OOC deep-kopierar targetens verifierbara tekniska fakta och ändrar endast
  status/reason. Det är alltid orankat, mappar till IOF `NotCompeting` utan
  Position/TimeBehind och förblir aktivt över senare offlineingest.
- Den gemensamma entry-låsta grinden utökas till DNS, DSQ, approval, DNF och
  OOC. Publik får format 5; historik och nya finaliseringar format 6. Äldre
  format och redan fryst Complete-XML/hash förblir oförändrade.
- `DECIDE_OUT_OF_COMPETITION` får egen credential, session, CSRF och exact-
  retry-journal. OOC-withdrawal, utan tidtagning, editor, manuella tider,
  kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser och riktig
  USB ligger utanför snittet.

Arkitekturdokumenten skapades och samordnades före produktionskod för 006K.

## Genomfört i TASK 006K 2026-09-01

- Domänen har en ren konstruktor och resolver för explicit individuellt
  `OOC/OUT_OF_COMPETITION`. Endast entryns absoluta aktuella, publicerade och
  direkta tekniska `OK|MP`-revision kan vara target. Verifierbara tekniska
  fakta deep-kopieras; endast status och reason ändras.
- Kontrakten har separat OOC-adminformat, publik format 5 och historik/
  finalisering format 6 med bakåtkompatibel läsning. Resultatmotorn,
  stationskontraktet och ingestformatet har inte breddats.
- Migration 0020 lägger additivt till capability, actor kind, revisionsorsak,
  unik proveniens och en immutable `not_competing_decision`-journal med
  komposit-FK, checkar och update/delete-skydd.
- Applikationen binder actor/request, race, entry, klass, bana, snapshot och
  exakt tekniskt target i en entry-låst transaktion. Exact retry returnerar
  samma decision och OOC-revision även efter senare ingest; ändrad actor eller
  ett enda intentfält konflikterar utan write.
- Den gemensamma manuella grinden gör DNS, DSQ, approval, DNF och OOC
  ömsesidigt uteslutande och failar stängt vid dubbelaktiv eller korrupt
  proveniens. Senare teknisk ingest bevaras men upphäver inte aktiv OOC.
- Publik, ranking, historik, Snapshot och nya finaliseringar använder den
  effektiva OOC-revisionen. Den är alltid orankad och mappar till IOF
  `NotCompeting` utan Position, TimeBehind eller approval proof; Complete
  kräver fortsatt explicit `finalizationId`, `revision` och `sourceHash`.
- Webbappen har en separat svensk tvåstegsyta med egen
  `DECIDE_OUT_OF_COMPETITION`-credential, host-only session, CSRF, privata
  headers, bounded kandidatlista och explicit same-id-retry efter okänd
  commit. Credential-CLI och operativa instruktioner är uppdaterade.
- Ingen OOC-withdrawal, utan tidtagning, generell resultateditor, manuell tid,
  punch-/splitändring, kontrollneutralisering, Eventor, multi-race, stafett,
  GPS, SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006K 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades
  0000–0020 med exit 0. Drizzlejournalen innehöll 21 migrationer.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade efter de sista ändringarna.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade efter de sista
  ändringarna.
- `CI=true pnpm test`: exit 0; 142 testfiler och 923 tester passerade: domän
  114, transport 49, IOF 90, kontrakt 164, SI-verktyg 20, station 38, databas
  34, applikation 42 och webb 372. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55451/otid_test CI=true
  pnpm --filter @o-tid/application test:integration`: exit 0; 107/107
  PostgreSQL/PostGIS-tester passerade på 3,05 sekunder. Fallen täcker bland
  annat 100 exact retries, skilda request-id:n, samtidig ingest/finalisering,
  immutable journal, gemensam manualgrind, publik/ranking, IOF Snapshot/
  Complete och äldre finaliseringars byte-/hashstabilitet.
- `DATABASE_URL=postgresql://postgres@127.0.0.1:55451/otid_test
  TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55451/otid_test CI=true
  pnpm test:e2e`: exit 0; 23/23 Playwrighttester passerade på 57,2 sekunder.
- `CI=true pnpm test:production:simulator --reporter=list`: första körningen
  i standard-sandboxen gav exit 1 när loopback-bindning nekades med `EPERM`.
  Godkänd omkörning utanför nätverkssandboxen gav exit 0; 2/2 prober
  passerade på 550 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med OOC-sidan och dess API-rutter.
- `CI=true pnpm android:test`: exit 1 före Gradle; `Unable to locate a Java
  Runtime`.
- `CI=true pnpm android:lint`: exit 1 före Gradle; `Unable to locate a Java
  Runtime`.
- `CI=true pnpm android:assemble`: exit 1 före Gradle med samma Javafel efter
  att webbundle och Capacitor-copy lyckats. Inget native-resultat redovisas
  som godkänt.

## Kvarvarande antaganden efter TASK 006K

- OOC är avsiktligt permanent i detta snitt. Ett felbeslut kan inte upphävas
  förrän ett separat append-only-withdrawal har specificerats och accepterats.
- Endast publicerad direkt teknisk `OK|MP` antas vara ett sanningsenligt
  target. Manuell, restaurerad, äldre, opublicerad eller korrupt revision får
  inte användas och ingen historisk fallback görs.
- Nya finaliseringar fryser format 6 och hela OOC-provenansen. Äldre format och
  redan skapade Complete-bytes/hash antas fortsatt immutable och har
  regressionsverifierats lokalt.
- IOF-reglerna är verifierade mot den pinnade officiella XSD-semantiken och
  lokala strukturella/deterministiska fixtures, inte genom uppladdning till en
  extern Eventor- eller tävlingsinstallation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte mot flera fysiska stationer eller
  SPORTident-hårdvara.
- Reverse proxy, produktionsbackup/PITR, komplett tävlingsarkiv-restore, last,
  längre process-/strömavbrott samt operativ användning i regn, skarpt ljus
  och med handskar är inte verifierade.
- Värden saknar projektets JDK 21; Androids Gradlegrindar är därför fortsatt
  overifierade. Riktig SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006K

TASK 006L bör endast införa ett explicit append-only återtagande av ett aktivt
individuellt OOC-beslut. En ADR måste först låsa reason, exakt observerat
huvud, restaurering av rätt teknisk källa, exact retry, samtidighet med ingest
och finalisering samt byte-stabil historik/IOF. Snittet ska inte samtidigt
införa utan tidtagning, generell resultateditor, manuella tider,
kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller riktig
USB.

## TASK 006L – arkitektur låst före implementation 2026-09-01

- `TASK_006L_EXPLICIT_OUT_OF_COMPETITION_WITHDRAWAL.md` och ADR-0036 låser ett
  immutable OOC-withdrawal och en publicerad restaureringsrevision som
  canonicalt kopierar exakt intentbunden direkt teknisk `OK|MP`-källa.
- Utan senare teknik används OOC-beslutets originaltarget. Med senare teknik
  måste det absoluta huvudet självt vara samma publicerade, direkta och exakt
  aktuella tekniska källa. Ingen historisk fallback eller omvald källa tillåts.
- Migration 0021 är additiv, men ersätter 0020:s uttryckligen tillfälliga
  livstidsunika OOC-entry-index med ett icke-unikt uppslagsindex. Inga
  historiska beslut eller revisioner skrivs om.
- Publik förblir format 5 och IOF får ingen ny status. Historik och nya
  finaliseringar använder format 7; äldre format och redan fryst
  `NotCompeting`-XML/hash förblir oförändrade.
- `WITHDRAW_OUT_OF_COMPETITION` får egen credential, session, CSRF och exact-
  retry-journal. Utan tidtagning, generell editor, fri reason, manuella tider,
  kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser och riktig
  USB ligger utanför snittet.
- Tre skrivskyddade Terra-/Luna-granskningar täckte domän/IOF, PostgreSQL/
  applikationssamtidighet samt webb/säkerhet/test. De upptäckte en
  terminologiambiguitet: 006K:s ”direkt readoutbaserad” kan läsas snävare än
  befintlig kod. ADR-0036 löser den uttryckligen som den oförändrade tekniska
  unionen `CARD_READOUT | CLASS_CHANGE_RECALCULATION |
  EXPLICIT_RECALCULATION`, alltid med verklig readout och strikt `OK|MP`.
  Ingen annan styrdokumentskonflikt hittades.

Arkitekturdokumenten skapades och samordnades före produktionskod för 006L.

## Genomfört i TASK 006L 2026-09-01

- Domänen har en ren, I/O-fri resolver för hela OOC→withdrawal→restoration-
  livscykeln. Utan senare teknik används exakt originaltargeten; med senare
  teknik måste det absoluta huvudet självt vara den requestbundna publicerade
  tekniska `OK|MP`-källan. Korrupt reciprocal provenans och all historisk
  fallback failar stängt.
- Kontrakten har separat withdrawal-adminformat 1 samt historik- och
  finaliseringsformat 7 med bakåtkompatibel läsning av äldre format. Publik
  förblir format 5 och IOF får ingen ny status.
- Migration 0021 lägger additivt till capability, actor kind,
  revisionsorsak, unik restaureringsprovenans och en immutable
  `not_competing_withdrawal`-journal. Det uttryckligen tillfälliga unika
  entry-indexet från 0020 ersätts utan att historik skrivs om.
- Applikationen fryser actor/request, race, entry, klass, bana, snapshot,
  decision, target, OOC-revision, observerat absolut huvud och exakt källa.
  Withdrawal, publicerad restaureringsrevision och audit appenderas i samma
  entry-låsta transaktion. Exact retry är stabil även efter senare ingest.
- Den gemensamma manuella grinden räknar endast oåtertagen OOC som aktiv. En
  ny OOC-livscykel kräver en senare ny direkt teknisk revision och kan inte
  targeta restaureringsrevisionen.
- Publik, ranking, Snapshot, historik och nya finaliseringar använder det
  exakt restaurerade utfallet. IOF visar befintlig `OK`/`MissingPunch`, medan
  intern decision-/withdrawalprovenans aldrig serialiseras.
- Webbappen har separat svensk tvåstegsyta, credential, host-only session,
  CSRF, privata headers, 4 KiB-bodygräns, minst 52 px touchmål och explicit
  same-id-retry efter okänd commit. Intentet ligger endast i React-minne.
- Ingen utan-tidtagning-status, editor, manuell tid, kontrollneutralisering,
  Eventor, multi-race, stafett, GPS, SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006L 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades
  0000–0021 med exit 0; kedjan innehåller 22 SQL-migrationer. En separat
  schemafokuserad 0020→0021-uppgradering passerade också.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 148 testfiler och 948 tester passerade: domän
  116, transport 49, IOF 91, kontrakt 169, SI-verktyg 20, station 38, databas
  42, applikation 42 och webb 381. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55437/o_tid_task006l_final
  CI=true pnpm --filter @o-tid/application test:integration`: exit 0; 112/112
  PostgreSQL/PostGIS-tester passerade på 3,93 sekunder. Fallen täcker båda
  källreglerna, stale intent, concurrent exact retries, immutable journal,
  ny OOC efter ny teknik, publik/ranking, IOF och v7-historik/finalisering.
- Full `CI=true pnpm test:e2e`: första körningen gav 23 passerade och ett fel
  i en för snäv svensk textassertion. Efter korrigering gav full omkörning
  exit 0; 24/24 Playwrighttester passerade på cirka en minut.
- `CI=true pnpm test:production:simulator --reporter=list`: första sandboxade
  körningen nådde inte testlogiken (`listen EPERM`); omkörning med lokal
  portbindning gav exit 0 och 2/2 produktionsprober på 554 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med OOC-återtagningssidan och API-rutterna.
- `CI=true pnpm android:test`, `CI=true pnpm android:lint` och
  `CI=true pnpm android:assemble`: vardera exit 1 eftersom värden saknar Java-
  runtime (`Unable to locate a Java Runtime`). Assemble hann bygga och kopiera
  webbtillgångarna före stoppet. Inget native-resultat redovisas som godkänt.

## Kvarvarande antaganden efter TASK 006L

- Enda withdrawal-reason är `ERRONEOUS_MANUAL_OUT_OF_COMPETITION`; automatisk
  återtagning, bulkåtgärd och fri reason antas inte vara tillåtna.
- Direkt teknisk källa är fortsatt befintlig cause-union med verkligt
  readout-id och strikt publicerat `OK|MP`. Restaurering räknar aldrig om eller
  fabricerar tid, punch, kontroll eller split.
- IOF-reglerna är verifierade mot den repo-pinnade officiella XSD-semantiken
  och lokala fixtures, inte mot Eventor eller extern tävlingsinstallation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte mot flera fysiska stationer eller
  SPORTident-hårdvara.
- Reverse proxy, backup/PITR, full arkivrestore, last, längre process- eller
  strömavbrott samt operativ användning i regn, skarpt ljus och med handskar är
  inte verifierade.
- Värden saknar JDK 21. Androids Gradlegrindar förblir overifierade och riktig
  SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006L

TASK 006M bör endast specificera ett explicit individuellt beslut om ”utan
tidtagning” mot ett exakt aktuellt, publicerat tekniskt resultat. En ADR måste
först låsa intern status/reason, ranking, IOF 3.0-sanningsenlig mappning,
provenans, ömsesidig uteslutning och finalisering. Snittet ska inte samtidigt
införa withdrawal, manuella tider, kontrollneutralisering, Eventor, stafett,
GPS, SPORTidentparser eller riktig USB.

## TASK 006M: arkitektur låst före implementation

- `TASK_006M_EXPLICIT_WITHOUT_TIMING.md` och accepterade ADR-0037 låser det
  avgränsade snittet före produktkod.
- O-Tid inför lagrad status/reason `NT/WITHOUT_TIMING` endast ovanpå ett exakt
  absolut aktuellt, publicerat, direkt readoutbaserat tekniskt
  `OK/COMPLETE`. MP, manuellt/restaurerat OK, stale, opublicerad och korrupt
  target avvisas.
- NT-outcome är status-only och bär endast entry-, historisk klass- och
  banidentitet. Tekniska tider, kontroller och splits finns kvar immutable i
  targetet men kopieras, räknas om eller fabriceras aldrig i det effektiva
  resultatet.
- Beslutet är en permanent overlay i detta snitt. Gemensam entry-låst
  manualgrind ska göra DNS, DSQ, approval, DNF, OOC och NT ömsesidigt
  uteslutande medan senare offlineingest fortsatt får appendera rawdata,
  readout och tekniska revisioner.
- NT är orankad; ordningen låses till `OK`, `MP`, `DSQ`, `DNF`, `OOC`, `NT`,
  `DNS`. Publikformat blir 6, lagrat outcomeformat 7 och historikformat 8.
- Den repo-pinnade officiella IOF 3.0-XSD:n saknar en sanningsenlig NT-status.
  `OK` döljer den icke-rankade betydelsen och kräver dokumenterad coverage av
  kända splits; `NotCompeting` betyder OOC. Snapshot och ny finalisering ska
  därför faila stängt på aktiv NT utan utelämning eller fabricerad status.
  `packages/iof-xml` och finaliseringsformat 1–7 breddas inte.
- Migration 0022 ska vara expand-only med separat
  `DECIDE_WITHOUT_TIMING`-capability, actor kind, revisionsorsak,
  decisionjournal, reciprocal deferred FK/unique/check och immutable-trigger.
- Ingen konflikt identifierades mellan AGENTS.md, CODEX_BRIEF.md och befintlig
  arkitektur. Briefens odefinierade IOF-semantik var en öppen fråga och är nu
  uttryckligen avgjord fail-closed i ADR-0037 före implementation.
- Ingen withdrawal, generell editor, manuell tid, kontrollneutralisering,
  Eventor, multi-race, stafett, GPS, SPORTidentparser eller riktig USB ingår.

Arkitekturdokumenten och ADR-0037 skapades och samordnades före produktkod för
006M.

## Genomfört i TASK 006M 2026-09-01

- Domänen har en ren status-only-konstruktor och permanent NT-overlay. Endast
  strikt direkt tekniskt `OK/COMPLETE` accepteras; tid, kontrollfakta och
  splits kopieras aldrig. NT är orankad och har deterministisk ordning mellan
  OOC och DNS.
- Kontrakten har lagrat outcomeformat 7, separat NT-adminformat 1, publikformat
  6 och historikformat 8. Äldre format är fortsatt läsbara med låsta unioner;
  stationens evaluation/ack accepterar inte NT.
- Migration 0022 lägger additivt till separat capability, actor kind,
  revisionsorsak, unik reciprocal proveniens och immutable
  `without_timing_decision`. Inga befintliga rader skrivs om.
- Applikationen fryser actor/request, race, entry, klass, bana, snapshot och
  exact target. Decision, publicerad NT-revision och audit appenderas atomiskt
  under gemensam manualgrind; exact retries återger samma beslut och senare
  teknisk ingest bevaras under den permanenta overlayn.
- Publikformat 6 visar endast ”Utan tidtagning” utan ranking eller tekniska
  fakta. Historikformat 8 visar target→NT→senare teknik. Levande IOF Snapshot
  och ny finalisering avvisar aktiv NT; IOF-adaptern och finaliseringsformat
  1–7 har inte breddats.
- Webbappen har en separat svensk tvåstegsyta, credential, host-only session,
  CSRF, privata headers, 4 KiB-bodygräns, minst 52 px touchmål och explicit
  same-id-retry efter okänd commit. Intentet ligger endast i React-minne.
- Inget withdrawal, ingen generell editor, manuell tid,
  kontrollneutralisering, Eventor, multi-race, stafett, GPS,
  SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006M 2026-09-01

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades
  0000–0022 med exit 0; Drizzlejournalen innehöll 23 migrationer och alla tre
  reciproka 006M-constraints fanns. En separat schemafokuserad 0021→0022-
  uppgradering passerade också med decisiontabell, provenienskolumn och tre
  reciproka constraints.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 157 testfiler och 998 tester passerade: domän
  130, transport 49, IOF 91, kontrakt 184, SI-verktyg 20, station 38, databas
  49, applikation 47 och webb 390. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://joelberring@localhost:55432/otid_006m_full
  CI=true pnpm test:integration`: exit 0; 1 fil och 114/114
  PostgreSQL/PostGIS-tester passerade på 4,20 sekunder. Fallen täcker bland
  annat 100 samtidiga exact retries, status-only-proveniens, immutable journal,
  senare ingest, manualmutex, publik, historik och fail-closed IOF/finalisering.
- Full `CI=true pnpm test:e2e`: första körningen gav 24 passerade och ett fel i
  en kvarvarande aktuell-format-5-assertion från ett äldre snitt. Efter att de
  två sådana assertionerna korrigerats till format 6 gav full omkörning exit 0;
  25/25 Playwrighttester passerade på 1,1 minut. Det nya fokuserade 006M-testet
  passerade separat på 5,9 sekunder.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  produktionsprober passerade på 641 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med NT-sidan och dess API-rutter.
- `CI=true pnpm android:test`: exit 1 före Gradle; `Unable to locate a Java
  Runtime`.
- `CI=true pnpm android:lint`: exit 1 före Gradle med samma Javafel.
- `CI=true pnpm android:assemble`: exit 1 efter lyckad webbundle/Capacitor-copy
  men före Gradle med samma Javafel. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden efter TASK 006M

- NT är avsiktligt permanent i detta snitt. Ett felbeslut kan inte upphävas
  förrän ett separat append-only-withdrawal har specificerats och accepterats.
- Endast absolut senaste, publicerade, direkta tekniska `OK/COMPLETE` med
  verkligt readout-id antas vara ett sanningsenligt target. Manuell,
  restaurerad, äldre, opublicerad eller korrupt revision används aldrig och
  ingen historisk fallback görs.
- IOF-reglerna är verifierade mot den repo-pinnade officiella XSD-semantiken
  och lokala fixtures, inte genom uppladdning till Eventor eller extern
  tävlingsinstallation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte mot flera fysiska stationer eller SPORTident-
  hårdvara.
- Reverse proxy, backup/PITR, full arkivrestore, last, längre process- eller
  strömavbrott samt operativ användning i regn, skarpt ljus och med handskar är
  inte verifierade.
- Värden saknar JDK 21. Androids Gradlegrindar är därför fortsatt overifierade
  och riktig SPORTident-/USB-status är fortsatt `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006M

TASK 006N bör endast införa ett explicit append-only återtagande av ett aktivt
individuellt NT-beslut. En ADR måste först låsa withdrawal-reason, exakt
observerat huvud, restaurering av rätt teknisk källa, exact retry, samtidighet,
publik/historik och fortsatt fail-closed IOF-policy. Snittet ska inte samtidigt
införa generell resultateditor, manuell tid, kontrollneutralisering, Eventor,
stafett, GPS, SPORTidentparser eller riktig USB.

## TASK 006N: arkitektur låst före implementation

- `TASK_006N_EXPLICIT_WITHOUT_TIMING_WITHDRAWAL.md` och accepterade ADR-0038
  låser det avgränsade snittet före produktkod.
- Withdrawal appenderar en immutable journal och en publicerad
  `MANUAL_WITHOUT_TIMING_WITHDRAWAL`-revision med canonicalt exakt outcome från
  en fryst direkt teknisk källa; beslut, NT, rawdata och readout muteras inte.
- Utan senare teknik restaureras originalets `OK/COMPLETE`-target. Finns ett
  senare absolut huvud måste samma rad vara publicerad direkt teknisk `OK|MP`.
  Manuell/restaurerad/opublicerad/stale källa och historisk fallback avvisas.
- Den centrala resolvern ska validera alla historiska NT-kedjor, tillåta högst
  en aktiv och endast räkna oåtertagen NT i DNS/DSQ/approval/DNF/OOC/NT-mutexen.
- Publikformat stannar på 6. Aktiv NT blockerar fortsatt IOF Snapshot och ny
  finalisering; en återtagen kedja använder vanlig `OK`/`MissingPunch`.
  Historikformat blir 9 och finaliseringsformat 8; äldre format och Complete-
  bytes/hash förblir immutable.
- Migration 0023 ska lägga till separat `WITHDRAW_WITHOUT_TIMING`-capability,
  actor kind, revisionsorsak, reciprocal withdrawalprovenans och immutable
  journal samt ersätta 0022:s uttryckligen tillfälliga entryunika index.
- Säkerhetsgränsen får eget tokenprefix, cookies, session, CSRF, strict 4 KiB
  JSON och exact-retry som binder actor och hela intentet.
- Tre skrivskyddade Terra/Luna-audits av domän/IOF, databas/samtidighet och
  webb/säkerhet fann ingen styrdokumentkonflikt. Den öppna policyfrågan om en
  senare teknisk MP är avgjord till att MP får restaureras, eftersom det
  bevarar senaste observerade tekniska sanning utan att bredda NT-targetregeln.
- Ingen generell editor, manuell tid, kontrollneutralisering, aktiv NT-mappning
  till IOF, Eventor, multi-race, stafett, GPS, SPORTidentparser eller riktig USB
  ingår.

Arkitekturdokumenten och ADR-0038 skapades och samordnades före produktkod för
006N.

## Genomfört i TASK 006N 2026-09-01

- Domänen har en ren reciprocal NT-livscykelresolver som validerar alla
  historiska decision-/withdrawalkedjor, tillåter högst en aktiv NT och
  restaurerar exakt en fryst direkt teknisk `OK|MP`-källa utan I/O.
- Kontrakten har separat withdrawal-adminformat 1, lagrat outcomeformat 8,
  historikformat 9 och finaliseringsformat 8. Publikformat 6 och stationens
  evaluation-/ackformat är oförändrade.
- Migration 0023 lägger additivt till separat capability, actor kind,
  revisionsorsak, reciprocal withdrawalprovenans och immutable journal utan
  att historiska rader skrivs om.
- Applikationen fryser actor/request och hela det observerade resultatintentet.
  Withdrawal, publicerad restoration och audit appenderas atomiskt; exact
  retries återger samma write och senare ingest bevaras som nya revisioner.
- Aktiv NT blockerar fortsatt levande IOF och ny finalisering. Efter withdrawal
  ger publik och IOF exakt restaurerat `OK|MP` respektive
  `OK|MissingPunch`; äldre Complete-XML och hash ändras inte.
- Webbappen har en separat svensk tvåstegsyta, credential, host-only session,
  CSRF, privata headers, 4 KiB-bodygräns, minst 52 px touchmål och explicit
  same-id-retry efter okänd commit. Intentet ligger endast i React-minne.
- Ingen generell editor, manuell tid, kontrollneutralisering, aktiv
  NT-mappning till IOF, Eventor, multi-race, stafett, GPS,
  SPORTidentparser eller riktig USB infördes.

## Verifiering efter TASK 006N 2026-09-01

- En färsk isolerad PostgreSQL 17/PostGIS-databas migrerades 0000–0023 med
  exit 0 och `Databasmigrationer klara`. En separat 0022→0023-uppgradering med
  en verklig reciprocal NT-kedja gav exit 0; den historiska raden bevarades,
  withdrawalkolumnen var null och den nya journalen fanns.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 163 testfiler och 1026 tester passerade: domän
  133, transport 49, IOF 91, kontrakt 190, SI-verktyg 20, station 38, databas
  57, applikation 49 och webb 399. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:integration`:
  exit 0; 1 fil och 118/118 PostgreSQL/PostGIS-tester passerade på 4,42
  sekunder.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e`: exit 0;
  26/26 Playwrighttester passerade på 1,1 minut. Det nya fokuserade 006N-testet
  passerade även separat, 1/1 på 8,6 sekunder.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  produktionsprober passerade på 650 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med withdrawal-sidan och dess API-rutter.
- `CI=true pnpm android:test`: exit 1 före Gradle; `Unable to locate a Java
  Runtime`.
- `CI=true pnpm android:lint`: exit 1 före Gradle med samma Javafel.
- `CI=true pnpm android:assemble`: exit 1 efter lyckad webbundle/Capacitor-copy
  men före Gradle med samma Javafel. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden efter TASK 006N

- Ett senare tekniskt huvud får restaureras endast när samma absoluta rad är
  publicerad, direkt readoutbaserad och strikt `OK|MP`. Ingen historisk
  fallback eller omvald källa antas vara sanningsenlig.
- Ett nytt NT efter withdrawal kräver en senare ny direkt teknisk
  `OK/COMPLETE`; en manuell restoration antas aldrig vara ett giltigt target.
- IOF-regeln är verifierad mot repo-pinnad officiell XSD-semantik och lokala
  fixtures, inte genom uppladdning till Eventor eller extern installation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte med flera fysiska stationer eller
  SPORTident-hårdvara.
- Reverse proxy, backup/PITR, full arkivrestore, last, längre process- eller
  strömavbrott samt operativ användning i regn, skarpt ljus och handskar är
  inte fältverifierade.
- Värden saknar JDK 21. Androids Gradlegrindar är därför overifierade och
  riktig SPORTident-/USB-status förblir `untested`.

## Föreslagen nästa minsta vertikala uppgift efter TASK 006N

TASK 006O bör endast införa en explicit, versionsbunden ändring av fast
starttid för en individuell entry och append-only-omräkning av just dess
resultat. En ADR måste först låsa källtid, snapshot-/paketversion, stale-
hantering, resultatrevisionsorsak, idempotens och påverkan på redan
finaliserade resultat. Snittet ska inte samtidigt införa fri resultattid,
kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller riktig
USB.

## Kompatibilitetsrättning efter TASK 006N 2026-09-04

Vid kartläggningen inför TASK 006O hittades en kvarvarande regression:
omräkningslistan och DNS-återtagandelistan läste den äldre uppsättningen
revisionsorsaker. En deltagare vars senaste revision var
`MANUAL_WITHOUT_TIMING_WITHDRAWAL` fick därför hela svaret underkänt av
kontraktsvalideringen. Detta kunde blockera nästa explicita omräkning eller
läsning av ett tidigare DNS-beslut.

- Båda aktuella listkontrakten använder nu befintligt
  `storedResultRevisionCauseV8Schema`. Historiska kontraktsversioner lämnas
  frysta.
- Domänens `RevisionCause` kompletteras med den redan implementerade orsaken
  `MANUAL_OUT_OF_COMPETITION_WITHDRAWAL`.
- Två befintliga kontraktstester utökas med återtaget NT som senaste revision,
  inklusive restaurerat OK och MP i omräkningslistan.
- Ingen ny arkitektur, dependency, databasmutation eller migration införs;
  rättningen följer ADR-0036 och ADR-0038.
- Före rättningen gav de två riktade testfilerna exit 1: 9 passerade och 2
  misslyckades på den saknade revisionsorsaken. Efter rättningen passerar hela
  `CI=true pnpm test` med exit 0, inklusive båda regressionstesterna.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm build`: exit 0, inklusive optimerad Next.js-build.
- PostgreSQL-, E2E-, produktions- och Androidsviterna upprepas inte för denna
  kontrakts-/typändring. Inga nya verifieringsanspråk görs för dessa lager;
  tidigare noterade hårdvaru- och driftbegränsningar kvarstår.

TASK 006O är fortsatt nästa föreslagna snitt och är inte implementerat.

## TASK 006O påbörjad 2026-09-04

ADR-0039 och TASK_006O_INDIVIDUAL_FIXED_START_TIME.md är låsta före produktkod.
Starttid sparas versionsbundet med separat capability och immutable journal.
Omräkning bekräftas därefter i befintlig vy, enligt samma separation som
StartList-importen i ADR-0025. Detta kräver inga nya motor- eller resultatformat.

## TASK 006O genomförd 2026-09-04

- En privat svensk starttidsvy finns i tävlingsöversikten. Den visar endast
  FIXED-deltagare, kräver explicit UTC-offset och bekräftelse, och länkar efter
  sparandet till befintlig separat omräkning. Knapp, input, select och
  omräkningslänk har minst 52 px touchyta.
- Contracts, application, database och web samt credential-CLI är utökade.
  ADR-0039 skrevs före implementation; migration 0024 är additiv och har
  dokumenterad restore-/rollforwardväg. Inga dependencies eller motorregler
  tillkom.
- Starttid, entry-/snapshotversion, immutable requestjournal och actor-audit
  committar atomärt. Stale/no-op/fel klassregel ger ingen write. Samma actor
  och normaliserade intent återger originalsvaret även efter senare ingest;
  ändrat intent/actor konflikterar. Skyddad läsning håller delade authlås.
- Gamla resultat, raw/readout, manuella beslut och Complete-bytes bevaras.
  Separat explicit omräkning appenderar nästa tekniska revision med ny tid.
  Nytt signerat paket innehåller ny tid/version och gammal ingest signalerar
  stale utan rådataförlust.

### Verifiering

- `CI=true pnpm lint`: exit 0, samtliga 10 workspaceprojekt och
  produktionsprober. Webbens lint kördes dessutom efter sista UI-justeringen:
  `CI=true pnpm --filter @o-tid/web lint`, exit 0.
- `CI=true pnpm typecheck`: exit 0, samtliga 10 workspaceprojekt och
  produktionsprober.
- `CI=true pnpm test`: slutlig exit 0, 165 testfiler och 1 032 tester.
  Domän 133, transport 49, IOF 91, kontrakt 193, SI-verktyg 20, station 38,
  databas 57, application 49 och webb 402. Worker har avsiktligt inga tester.
- `CI=true pnpm --filter @o-tid/application test:integration -t 'TASK 006O'`
  med `TEST_DATABASE_URL` till isolerad PostgreSQL 17/PostGIS: exit 0,
  3/3 nya scenarier passerade; 118 orelaterade scenarier filtrerades bort.
  En färsk databas migrerades genom 0000–0024. Ingen SQLite-ersättning.
- `CI=true pnpm test:e2e -g 'TASK 006O'` med `DATABASE_URL` och
  `TEST_DATABASE_URL` till samma isolerade databas: slutlig exit 0, 1/1
  Playwrightscenario på 10,1 sekunder. Verifierar 390 px mobilbredd,
  52 px kontroller, bekräftelse, tappat commitsvar, samma request-id,
  en journalrad, ingen Web Storage och logout. Bekräftelsens skärmbild
  granskades visuellt utan överlapp eller horisontellt överflöde.
- `CI=true pnpm build`: exit 0, samtliga 10 projekt inklusive optimerad
  Next.js-build och stationens webbundle/Capacitor-copy.
  Efter den sista CSS-justeringen kördes även
  `CI=true pnpm --filter @o-tid/web build`: exit 0.
  Testdatabasen hade 25 tillämpade migrationer och PostGIS 3.6.4.
  Den tillfälliga PostgreSQL-servern stoppades efter verifieringen;
  testdata och loggar behölls.
- Första integrationstestförsöket blockerades av sandboxens loopbackpolicy;
  godkänd lokal körning användes därefter. Testutvecklingen hittade ett felaktigt
  kvittensfältnamn i testet, fem befintliga exakta konfigurationssträngtester,
  samt två E2E-antaganden om dev-cacheheader och label-väljare. Dessa rättades;
  slutresultaten ovan är gröna, inga misslyckade körningar räknas som godkända.
- Android, hela övriga integrations-/E2E-sviter och produktionsprobernas
  runtime upprepades inte. Skälet är snittets begränsning till webbaserad
  startadministration; tidigare rapporterade hårdvaru-/JDK-begränsningar kvarstår.

### Kvarvarande antaganden och nästa minsta uppgift

Arrangören anger korrekt datum/offset och väljer separat omräkning när det
behövs. Ett nytt racesnapshot gör även andra äldre resultat stale inför ny
finalisering enligt befintlig policy. Onlineformuläret lagrar pendingintent
endast i minnet; omladdning kräver att aktuella tider läses igen. Lokal
PostgreSQL/syntetiska avläsningar bevisar inte fysisk SPORTident, långvarig
fältdrift, regn/handskar, produktionsproxy eller backuprestore.

Föreslagen TASK 006P: ett explicit, versionsbundet brickbyte för en befintlig
deltagare, utan efteranmälan eller automatisk omräkning. Ett separat ADR måste
först låsa historiska brickkopplingar och redan köade avläsningar. Ingen
Eventor, stafett, GPS, parser eller riktig USB påbörjades i TASK 006O.

## TASK 006P påbörjad 2026-09-04

ADR-0040 låser ett individuellt brickbyte före implementation. Befintlig
race+bricknummer-unikhet och permanent ägarskap bevaras; sen gammal bricka
lagras okänd, aldrig på en annan deltagare. EntryList får inte skriva över
manuellt byte. Omräkning förblir separat. Se TASK_006P_INDIVIDUAL_CARD_CHANGE.md.

## TASK 006P genomförd 2026-09-04

Brickbyte för befintlig deltagare finns via tävlingsöversikten och
`/admin/<raceId>/cards`, med egen `CHANGE_ENTRY_CARD`, credential-CLI, privata
cookies och tvåstegsbekräftelse. Tjänsten återanvänder befintlig säkerhet,
lopplåsning, signerat paket och explicit omräkning utan ny dependency.

Migration 0025 inför immutable journal, capability/actor och skydd mot att
card_assignment-identitet skrivs om eller raderas. Aktivflaggan får ändras och
egen tidigare bricka kan återaktiveras. Annans historiska bricka i samma lopp
avvisas. EntryList får inte flytta ägare eller återställa ett byte; en sådan
fil ger atomär konflikt, medan exakt filretry förblir skrivfri. ADR-0040 och
migrationernas README beskriver policy och återställning.

### Verifiering

- `CI=true pnpm lint`: slutlig exit 0 för workspace och produktionsprober.
- `CI=true pnpm typecheck`: slutlig exit 0 för workspace och produktionsprober.
- `CI=true pnpm test`: exit 0, 167 filer och 1 037 tester. Fördelning: domän
  133, transport 49, IOF 91, kontrakt 195, SI-verktyg 20, station 38, databas
  57, application 49 och webb 405. Worker använder avsiktligt passWithNoTests.
- `CI=true pnpm test:integration` med `TEST_DATABASE_URL` till den isolerade
  PostgreSQL 17/PostGIS-databasen: exit 0, 125/125 tester. Hela sviten kördes
  en gång eftersom EntryList-import ändrats. Migration 0025 tillämpades på den
  befintliga 0024-testdatabasen utan omskrivning av historik.
- `CI=true pnpm test:e2e -g 'TASK 006P'` med `DATABASE_URL` och
  `TEST_DATABASE_URL` till samma testdatabas: exit 0, 1/1 test på 37,6 sekunder.
  Mobilbredd, touchmål, auth, bekräftelse, tappat svar, samma request-id, en
  journal/aktiv bricka, ingen Web Storage och logout är verifierade.
- `CI=true pnpm build`: exit 0 för samtliga 10 projekt, inklusive Next.js-
  produktionsbuild med ny sida/API och stationens oförändrade webbundle.
- Första typkontrollen hittade kvarvarande fältnamn från återanvänd UI-kod
  och ej typavsmalnade kvittensassertioner. Första lint hittade fyra osäkert
  typade matchers i testkod. Dessa rättades; de körningarna räknas inte som
  godkända. PostgreSQL-scenarierna kördes riktat igen efter testtypningsfixen.
- Övriga Playwright-, Android- och produktions-runtime-sviter upprepades inte;
  dessa lager är oförändrade. Ingen verifiering med fysisk SPORTident görs.

### Kvarvarande antaganden

Operatören väljer rätt deltagare/bricka. Återanvändning mellan deltagare inom
samma lopp stöds inte, eftersom gamla offlineposter annars kan få fel ägare.
Legacydata som tidigare skrivits över kan inte rekonstrueras av migrationen;
befintliga dubbelaktiva kopplingar blockeras och kräver separat granskning.
Tidigare resultat och manuella beslut bevaras; byte ersätter inte separat
omräkning. Okända sena avläsningar förblir granskningsfall. Tidigare noterade
begränsningar för fysisk hårdvara, fältdrift, produktionsproxy och backuprestore
kvarstår.

### Kort återstående plan

Nästa minsta delmål är direktanmälan av en deltagare till en befintlig klass,
med valfri ledig bricka och versionsbundet/idempotent sparande. Återanvänd
befintlig importmodell och brickregler; ingen persondatabas, betalning eller
automatisk resultatmutation ingår. Lås ADR, implementera och verifiera detta
sammanhängande flöde innan nästa lucka i CODEX_BRIEF:s V1 tas upp. Slutmålet
är inte färdigt bara för att TASK 006P är klar.

## TASK 006Q genomförd 2026-09-04

ADR-0041 låser direktanmälan till befintlig klass före implementation.
Plan: kontrakt/transaktion och additiv migration → privat registreringsvy →
avläsningsflöde och riktad fel-/retryverifiering → obligatoriska kontroller.
Inga nya personerregister, betalningar eller automatiska resultat införs.

### Genomfört och verifierat under implementationen

Kontrakt, migration 0026, capability, transaktion, credential-CLI och privat
registreringsvy är implementerade. ADR-0041:s gränser gäller: befintlig klass,
valfri historiskt ledig bricka, FIXED-tid och ingen automatisk resultatmutation.

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 169 filer / 1 042 tester: domain 133,
  device-transport 49, IOF 91, contracts 197, si-tools 20, station 38,
  database 57, application 49, web 408. Worker har avsiktligt inga tester.
- `CI=true TEST_DATABASE_URL=<isolerad PostgreSQL> pnpm --filter
  @o-tid/application test:integration -t 'TASK 006Q'`: exit 0, 3 godkända,
  125 övriga filtrerade. PostgreSQL 17/PostGIS; migration 0026 tillämpad på
  befintlig testdatabas utan omskrivning av gamla rader.
- Efter en sista UI-justering (rensa formulär vid logout utan pendingrequest)
  kördes webbens lint och typecheck igen: båda exit 0.
- Riktat nytt routetest: exit 0, 3/3. Kontraktspaketets extra körning med
  `test -- entry-registration-admin.test.ts` körde faktiskt hela paketet:
  exit 0, 30 filer / 197 tester, inte endast den angivna filen.

- `CI=true DATABASE_URL=<isolerad PostgreSQL> TEST_DATABASE_URL=<samma>
  pnpm test:e2e -g 'TASK 006Q'`: exit 0, 1/1 på 9,0 sekunder. Utfört av
  Terra/Medium-underagent med ansvar endast för E2E-filen. Testet verifierar
  auth, mobilens 52 px kontroller, granskning utan write, tappat commitsvar,
  samma-id-retry, en entry/journal/audit, snapshot +1, aktiv assignment,
  inga nya resultatrevisioner, ingen Web Storage och logout. Tidigare
  testkörningar hade för breda textlokatorer; dessa rättades utan UI-ändring.

- `CI=true pnpm build`: exit 0 för samtliga 10 projekt, inklusive Next.js
  med registreringssida, sessions-/klassunderlags-API och POST entries.
- Övriga PostgreSQL-/E2E-, Android- och produktions-runtime-sviter upprepades
  inte; berörda beteenden täcks av riktade tester och oförändrade lager av
  den obligatoriska enhetstestsviten. Fysisk SPORTident har inte verifierats.

### Kvarvarande antaganden

Direktanmälan kräver serverkontakt och rätt operatörsval av namn, klass, tid och
bricka. Ingen automatisk person-/namnmatchning finns. Efter förlorad browsersida
måste aktuell deltagarlista granskas före ny registrering. En direktanmäld
person saknar extern IOF-identitet och får inte återimporteras som en ny extern
entry utan uttrycklig identitetskoppling. Gamla stationspaket måste uppdateras;
gamla lokala observationer och ingestkvittenser ändras inte. Separat omräkning
krävs för tidigare okänd avläsning. Migrationen är verifierad på isolerad
PostgreSQL 17/PostGIS, inte mot produktionsdata eller fysisk hårdvara.

### Kort återstående plan

Nästa minsta vertikala delmål är en privat operativ startlista för ett befintligt
lopp: klassvis deltagarlista med befintlig fast starttid eller tydlig
startstämplingsregel. Det är en read-only-vy för startpersonal, utan lottning,
starttidsändring, nya resultatstatusar eller automatisk frånvarobedömning.
Efter det återstår fortsatt V1-funktioner och verklig stations-/driftverifiering;
projektets slutmål är inte uppfyllt av TASK 006Q.

## TASK 006R genomförd 2026-09-04

ADR-0042 låser en privat read-only-startlista utan faktisk start-/resultatstatus.
Plan: separat capability och bounded läsare → mobilvy med explicit tidszon och
klassfilter → riktade säkerhets-/tids-/browserkontroller → obligatoriska checks.

Startpersonal kan nu läsa `/admin/<raceId>/start-list` med separat
`VIEW_START_LIST`. CLI: `start:list:access:issue` och
`start:list:access:revoke`. Migration 0027 är additiv, utan nya domäntabeller
eller ändrad resultathistorik. Återställningspolicy finns i ADR-0042 och
migrationernas README. Backend implementerades av en avgränsad Terra/Medium-
underagent; huvudagenten gjorde webb, CLI och integrationsverifiering.

### Verifiering

- `CI=true pnpm lint`: slutlig exit 0 för workspace och produktionsprober.
- `CI=true pnpm typecheck`: exit 0 för workspace och produktionsprober.
- `CI=true pnpm test`: slutlig exit 0, 172 filer / 1 047 tester: domain 133,
  device-transport 49, IOF 91, contracts 199, si-tools 20, station 38,
  database 57, application 49 och web 411. Worker har avsiktligt inga tester.
- `CI=true TEST_DATABASE_URL=<isolerad PG17/PostGIS> pnpm --filter
  @o-tid/application test:integration -t 'TASK 006R'`: exit 0, 2 godkända,
  128 övriga tester filtrerade. Migration 0027 applicerad på befintlig
  testdatabas. Sista körningen verifierar även att VIEW_RACE_OVERVIEW inte
  får läsa startlistans personuppgifter.
- `CI=true DATABASE_URL=<samma PG> TEST_DATABASE_URL=<samma PG>
  pnpm test:e2e -g 'TASK 006R'`: slutlig exit 0, 1/1 på 16,8 sekunder.
  Klassfilter, 390 px mobilvy/52 px kontroller, svensk tävlingstid trots
  browserzon America/Los_Angeles, explicit saknad tid, gammal lista vid nätfel,
  återhämtning, logout och spärrad credential utan PII samt inga entries-/
  snapshot-/resultatwrites verifierades. Mobilbilden granskades visuellt.
- `CI=true pnpm build`: exit 0 för alla 10 projekt, inklusive nya privata
  sidor och API i Next.js produktionsbuild.
- Efter sista säkerhetsassertionerna kördes kontrakttestet separat: exit 0,
  2/2, inklusive totalgräns och motsägande DTO. De två ändrade testfilerna
  lintades explicit och contracts/application typkontrollerades igen:
  samtliga exit 0. Sista tilläggen ändrade endast testassertioner.
- Första lint hittade två oanvända destrukturerade variabler; projektionen
  skrevs explicit. Första root-test körde av misstag en integrationsfil:
  den tidigare ociterade exclude-globben shell-expanderade när en andra
  integrationsfil tillkom. Globben är nu citerad och integrationsfiler körs
  utan filparallellism så migration-beforeAll inte konkurrerar på färsk DB.
  Första E2E-lokatorn matchade också Next.js route-announcer; den avgränsades
  till startlistan. Dessa första körningar räknas inte som godkända.
- Övriga PostgreSQL-/E2E-, Android- och produktions-runtime-sviter upprepades
  inte. Ingen fysisk SPORTident eller fältdrift verifieras av detta snitt.

### Kvarvarande antaganden

Listan visar planerad start, aldrig faktiskt startad/ej start/i skogen.
Operatören behöver uppdatera listan när underlaget ändras. Browserlistan är
minnesburen och ersätter inte stationens beständiga offlinepaket. Tävlingszon
måste stödjas av både serverns och browserns Intl; ogiltig zon avvisas utan
att tyst falla tillbaka till lokal tid. Migrationens uppgradering är testad
isolerat, inte mot produktionsdata. Last på maxgränsen och fysisk användning
med handskar/regn kvarstår att verifiera.

### Kort återstående plan

Nästa minsta vertikala delmål är explicit publicering av en startlista för
publik och tävlande. Utgå från samma uppgifter men behåll dem privata tills
ett separat behörigt publiceringsbeslut finns. Ingen startlottning, faktisk
startstatus eller automatisk publicering ingår. Projektets återstående V1-
och stations-/driftkrav är fortsatt inte färdiga.

## TASK 006S klart 2026-09-04: explicit publicerad startlista

ADR-0043 och uppgiftsdokument skrevs före implementation. Migration 0028 ger
separat PUBLISH_START_LIST och immutable beslut/journal med atomär audit.
Privat granskning/bekräftelse fryser minimal personprojektion för publik vy.
Återförsök, konflikter, ny publicering och avpublicering är explicita; det
aktuella underlaget kan vara ogiltigt utan att blockera återtagande.

### Exakta verifieringsresultat

- `CI=true pnpm lint`: exit 0, slutkörning även efter kontrakt/schema/testfixar.
- `CI=true pnpm typecheck`: exit 0, slutkörning efter samma fixar.
- `CI=true pnpm test`: exit 0; 175 filer och 1 053 tester passerade.
  Domain 133, device-transport 49, IOF XML 91, contracts 201, database 57,
  si-tools 20, station 38, application 49 och web 415.
- `CI=true pnpm build`: exit 0; samtliga workspace-builds inklusive Next.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006s_final pnpm --filter @o-tid/application exec vitest run test/integration/task-006s.test.ts`:
  exit 0, 1 fil/2 sammansatta scenarier, sista körning 845 ms. Slutlig 0028
  verifierades först genom full migration på ny tom databas på PostgreSQL 17.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_test TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_test pnpm exec playwright test -g 'TASK 006S'`:
  exit 0, 1/1 på 13,5 s. Mobilskärmbilden inspekterad; läsbar utan overflow.
- Riktade webbrutter: 2 filer/4 tester passerade och ingår också i root test.
- Ett syntaxfel i underagentens kontraktstest rättades före rootkörningarna.
  En extra pg_ctl-start gav exit 1 eftersom den isolerade servern redan körde;
  eskalerad statuskontroll bekräftade befintlig instans. Ingen data raderades.
  Next/Playwright gav endast NO_COLOR/FORCE_COLOR-varningar.

### Kvarvarande antaganden och avgränsningar

Publicering är serverberoende och visar planerad, inte faktisk, start.
Nuvarande skrivvägar måste följa racelåset; direkt SQL-administration är inte
en stödjad samtidig redigeringsväg. Publik polling är inte omedelbar återkallelse:
bakgrundstimers kan fördröjas och sparade kopior kan inte återtas. Privat
beslutshistorik innehåller frysta personuppgifter och behöver produktionspolicy
för behörighet/retention/backup. Ingen lasttest vid maxgränser, produktionsrestore,
fysisk SPORTident eller fältdrift verifierades. Övriga integrations-, E2E-,
Android- och produktionsruntime-sviter kördes inte om eftersom deras kodvägar
inte ändrades. Ingen station, GPS, stafett eller ny hårdvarufunktion påbörjades.

### Nästa minsta vertikala uppgift

Läsbar IOF XML 3.0 StartList-export från en explicit publicerad, fryst startlista.
Avgränsa till befintligt individuellt lopp och verifiera standardmappningen
innan adapterimplementation; ingen lottning eller automatisk publicering.
Projektets fulla V1- och driftmål är fortsatt inte färdigt.

## TASK 006T klart 2026-09-04: fryst IOF StartList-export

Förra goal-turnen var verifierad progress: TASK 006S genomförd och testad.
TASK 006T granskades mot pinnad IOF XSD och ADR-0044 accepterades före
implementation. Migration 0029 fryser XML på nya publiceringsbeslut; ingen
namnheuristik eller efterhandsändring av historik. Publik mobilvy erbjuder
nedladdning, medan legacy utan XML behöver explicit ompublicering (409).
Withdrawal ger 404 utan persondata. Hashformat 2 binder strukturerade namn.

En Terra Medium-underagent gjorde den avgränsade standard-/adapteruppgiften;
huvudagenten integrerade databas, publicering, webb och verifiering. Inga
ytterligare agenter eller dependencies tillkom. Underagentens gröna testresultat
återanvändes; rootkontroller verifierade den färdiga integrationen.

### Exakta resultat

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 177 testfiler / 1 067 tester. Domain 133,
  transport 49, IOF 104, contracts 201, database 57, si-tools 20, station 38,
  application 49 och web 416.
- `CI=true pnpm build`: exit 0, samtliga workspace-builds inklusive Next.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006s_final pnpm --filter @o-tid/application exec vitest run test/integration/task-006s.test.ts`:
  exit 0, 1 fil / 3 scenarier, 1,35 s. Migration 0029 applicerad på isolerad
  PostgreSQL 17/PostGIS; legacy, frozen XML, hash, retry/actor/kollision/withdrawal.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006s_final TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006s_final pnpm exec playwright test -g 'TASK 006T'`:
  exit 0, 1/1 på 16,7 s. Faktisk nedladdad XML-fil kontrollerad; 390 px mobilvy,
  minst 52 px länk, frysta bytes efter namn/tidsändring och withdrawal.
  Skärmbild visuellt inspekterad utan overflow.
- `/usr/bin/xmllint --noout --nonet --schema /private/tmp/otid-006t-iof.xsd -`:
  exit 0 och `- validates` för dels lagrad PUBLISH hämtad direkt från PostgreSQL,
  dels serializerprov med FIXED-tid/millisekunder, FIXED utan tid, PUNCH och
  escapade namn/klubb. Tillfällig XSD hämtad från den dokumenterade pinnade
  commitens raw-URL; inget schema vendlat i repositoryt.
- Ingen check misslyckades. NO_COLOR/FORCE_COLOR-varningar från Playwright/Next.
  Underagentens extra `git diff --check` var ej tillämplig: katalogen saknar Git.

### Kvarstående antaganden

Detta exporterar ett publicerat individuellt lopp, inte en sammanfogad
etapptävling eller externa personidentiteter. Ingen StartList-status eller
faktisk start påstås; tidsimportens striktare ID-krav innebär att fullständig
roundtrip inte påstås. XSD-prov är inte generell stödgaranti för hela standarden.
Äldre publicering behöver nytt uttryckligt beslut. Sparade eller pågående
nedladdningar kan inte återkallas. Samma produktions-, retention-, backup-,
maxlast- och hårdvaruantaganden som TASK 006S kvarstår. Övriga integrations-,
E2E-, Android- och produktionsruntime-sviter upprepades inte för detta snitt.
Ingen resultat-, stations-, GPS-, stafett- eller USB-funktion ändrades.

### Nästa minsta vertikala uppgift

Enkel startlottning för en befintlig individuell FIXED-klass: granska en
reproducerbar ordning och tidsintervall, bekräfta versionsbundet och bevara
historik. Ingen avancerad seedning eller automatisk publicering. Hela V1-/
driftmålet är fortfarande inte färdigt och målet lämnas aktivt.

## TASK 006U påbörjad 2026-09-04

Föregående goal-turn var progress: TASK 006T implementerad och verifierad.
Aktuell arbetsyta bekräftar att enkel startlottning saknas. ADR-0045 beslutad
före implementation: ren seedad domänplan plus separat atomärt klassbeslut,
utan automatisk resultat-/startlistepublicering. Hela vertikala flödet krävs
för completion; en fristående planeringsfunktion räcker inte.

### Delprogress: domänplan och kontrakt

En Terra Medium-underagent implementerade endast ren domänplan och dess tester;
huvudagenten skrev ADR/uppgift, DTO-kontrakt och kontrakttester. Ingen ny dependency
eller produktionswrite infördes. Rootworktree lästes först; ingen senare funktion
valdes bort eller ersattes med denna delimplementation.

- `CI=true pnpm --filter @o-tid/domain lint`: exit 0.
- `CI=true pnpm --filter @o-tid/domain typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/domain test`: exit 0, 10 filer/151 tester.
- `CI=true pnpm --filter @o-tid/contracts lint`: exit 0.
- `CI=true pnpm --filter @o-tid/contracts typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/contracts test`: exit 0, 33 filer/204 tester.

Kvar inom samma TASK 006U: separat capability/CLI och additiv header/items-
migration; serverpreview och atomärt versionsbundet beslut; svensk mobil
granska/bekräfta/retry; PostgreSQL-/E2E-acceptans samt slutliga rootkontroller
lint/typecheck/test/build. Dessa kördes inte i delfasen eftersom deras nya
produktionsvägar ännu inte finns. Ingen uppgift eller helhetsmål markeras klart.
Nästa arbete är transaktion/lagring för samma klasslottning, inte ett nytt snitt.
Vid integration jämkades domänens UUID-validering med kontraktens version/
variantkrav; två regressionstest tillkom och domänchecks kördes därför om.

### TASK 006U klart: fullständigt vertikalt flöde

Efter ovanstående delfas genomfördes backend, migration 0030, separat
DRAW_CLASS_START_TIMES-behörighet/CLI, privata routes och svensk mobil
granska/bekräfta/retry. Föregående goal-turn var progress, inte väntan/blocker.
En Terra Medium-underagent ägde backend; main ägde webb och integration.

Servern låser vald roster och bygger om samma domänplan. Journal/items/audit
och tidsändringar är atomära; högst 1 000 items per insert undviker PostgreSQL:s
parametergräns. Endast ändrade entryversioner ökar. No-op, stale underlag,
fel klass/race/capability och tidsöverskridanden ger inga writes. Maxversion på
en oförändrad entry är tillåten. Publicerad startlista och XML är frysta.

#### Exakta slutresultat

- `CI=true pnpm lint`: exit 0 efter rättning av två oanvända destructuring-
  variabler i backend. Slutkörning omfattar senaste kod och tester.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0; 180 filer/1 092 tester: domain 151,
  device-transport 49, IOF 104, contracts 204, database 57, si-tools 20,
  station 38, application 49, web 420.
- `CI=true pnpm build`: exit 0; samtliga workspace-builds inklusive Next.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006u_final pnpm --filter @o-tid/application exec vitest run test/integration/task-006u.test.ts`:
  exit 0, 1 fil/4 scenarier, sista körning 869 ms. Täcker retry/actor/intent,
  preview, stale/concurrent, nytillkommen entry, PUNCH/overflow, isolering,
  no-op, immutable header/items, maxversion och oförändrad publik webb/XML.
- Slutlig migration verifierades från tom `otid_006u_final` på PostgreSQL 17/
  PostGIS. En tidig lokal testdatabas hade justerats med time_zone under
  backendutvecklingen; därför användes ny tom databas för slutbeviset.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006u_final TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006u_final pnpm exec playwright test -g 'TASK 006U'`:
  exit 0, 1/1 på 6,3 s. Mobil 390 px, gamla/nya tider, preview utan writes,
  förlorat commitsvar/samma-id-retry, korrekt snapshot/entryversion, logout.
  Skärmbilden visuellt kontrollerad; minst 52 px bekräftelseknapp.
- Riktade webbrutter: 1 fil/4 tester exit 0, även inkluderade i root test.
- Första E2E matchade klassselect med fel lokator och timade ut. Andra körningen
  hittade en felaktig Content-Type på tom DELETE vid logout; klienten rättades.
  Dessa körningar räknas inte som godkända. Kvarvarande terminalvarningar var
  NO_COLOR/FORCE_COLOR, inte testfel.

#### Kvarstående antaganden och nästa steg

Enkel pseudoslump är inte kryptografisk/certifierad lottning eller regelverkets
avancerade seedning. Operatören anger rätt datum/offset och granskar planen.
Ingen maxlast, fysisk station, regn/handskar eller produktionsrestore verifierad.
Gamla stationpaket/resultat bevaras av oförändrade befintliga kodvägar; fulla
Android-, produktionsruntime-, övriga integrations- och E2E-sviter upprepades
inte. Testdatabaserna behålls, isolerad PostgreSQL stängs efter verifiering.

Nästa minsta vertikala uppgift är Eventorimport av en tävling till intern
tävling/lopp via Testeventor, med privat servernyckel och explicit adaptergräns.
Ingen deltagarsynk, uppladdning eller automatisk publicering behöver ingå där.
Helhetsmålet är fortfarande aktivt; hela V1/drift är inte klart.

## TASK 006V påbörjad 2026-09-04, delprogress 2026-09-05

Föregående snitt TASK 006U är klart. Nästa avgränsade vertikala flöde är
Testeventorimport till en ny intern tävling och ett uttryckligt valt lopp.
TASK_006V och ADR-0046 skapades före implementation. Officiell API-/schemaaudit
gjordes read-only av Terra Medium; inga autentiserade anrop eller verkliga
nycklar användes. Resultatet finns i docs/research/eventor-api.md. Ingen AGPL-
implementation lästes eller återanvändes.

Schemaaudit bekräftar XML utan targetNamespace, opaka externa text-ID:n,
direkta EventRace-barn och Date/Clock utan dokumenterad tidszon. Adaptern
får inte välja första loppet eller härleda en deltagares start. ADR beskriver
fast Testeventor-origin, separat connection-owner och atomär idempotent import.

Implementerad del: packages/application/src/eventor-secret.ts med kontextbunden
AES-256-GCM-envelope, strikt format/base64url, separat 32-byte masterkey,
slumpnonce och generiska fel. Ciphertext är bunden till ägare/anslutning/
miljö/keyId. Egna temporära bytebuffertar nollställs; JavaScript-strängars
minnesradering kan inte garanteras. Inga nya dependencies, databaswrites,
migrationer eller routes infördes. Arkitektur, domän-/offlinepolicy och nytt
säkerhetsdokument anger uttryckligen vad som fortfarande bara är planerat.

### Exakta kontroller för detta delsteg

- `CI=true pnpm --filter @o-tid/application exec vitest run test/eventor-secret.test.ts`:
  exit 0, 1 fil/33 tester. Första körningen hade 9 fel av 29 eftersom den
  syntetiska nyckeln var 33 i stället för 32 tecken; fixture rättades. Ytterligare
  fyra regressionsfall täcker avslutande radbrytningar i nyckel/metadata.
- `CI=true pnpm --filter @o-tid/application lint`: exit 0.
- `CI=true pnpm --filter @o-tid/application typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/application build`: exit 0.
- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 181 filer/1 125 tester: domain 151,
  device-transport 49, IOF 104, contracts 204, database 57, si-tools 20,
  station 38, application 82, web 420. Workerplaceholder har inga testfiler
  och passerar enligt befintlig passWithNoTests-policy.
- `CI=true pnpm build`: exit 0, alla workspace-builds inklusive Next.
- PostgreSQL-, E2E- och Android-native-sviter kördes inte om: inga nya
  lagrings-, webb- eller nativevägar finns i denna delfas. Live-Testeventor
  kunde inte verifieras utan lokalt konfigurerad användargodkänd testnyckel.

### Kvar inom samma snitt

Eventoradapter/nätgräns, connectionschema och säker CLI, owner-auktorisering,
preview/atomär import med extern-ID-deduplicering, svenska webbflödet samt
PostgreSQL/E2E/liveacceptans återstår. En separat nyckelfunktion uppfyller inte
vertikal acceptance. TASK 006V och helhetsmålet lämnas därför aktiva; detta är
progress, inte completion eller upprepad blocker. Nästa arbete är att koppla
adaptern till samma importflöde, inte att börja en annan funktion.

### TASK 006V: integrerat flöde, liveacceptans kvar (2026-09-05)

Föregående goal-turn var progress. Nu finns hela granska/bekräfta-flödet:
packages/eventor, strikta contracts, migration 0031, krypterad anslutning och
separat spärr, atomär importjournal/provenans/audit, privat CLI samt svensk
/admin/events/eventor. CREATE_EVENT-sessionen återanvänds utan nya race-
rättigheter. Externa APIs får bara GET mot fast Testeventor-origin, no-store,
ApiKey-header, 2 MiB och tio sekunders whole-body-timeout. Noll lopp avvisas
för import; val av första lopp eller tidszon sker aldrig automatiskt.

Main ägde kontrakt, schema/transaction, CLI, webb och integration. En Terra
Medium-underagent ägde endast Eventoradaptern. Konkreta integrationsrisker
(namespace, standardattribut/entiteter, XML-komplexitet, äldre kalenderår,
surrogater, newline och timeout/cancellation) återfördes och regressionstestades.
Inga AGPL-källor, riktiga API-nycklar eller externa writes användes.

#### Slutliga kontroller för implementationen

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 185 filer/1 148 tester: domain 151,
  device-transport 49, eventor 12, IOF 104, contracts 209, database 57,
  si-tools 20, station 38, application 85, web 423. Workerplaceholder
  har fortsatt inga tester enligt befintlig passWithNoTests-policy.
- `CI=true pnpm build`: exit 0, samtliga workspaces och Next.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006v_final pnpm --filter @o-tid/application exec vitest run test/integration/task-006v.test.ts`:
  exit 0, 1 fil/6 scenarier, 455 ms. Hela migrationskedjan verifierades från
  ny tom PostgreSQL 17/PostGIS-databas. Täcker ägarisolering, auth före body,
  preview utan writes, valt andra lopp, exact replay utan nät/masterkey,
  ändrat intent/source, concurrent global duplicate, spärr/expiry under fetch,
  immutable rader samt full rollback vid fel i sista audit-insert.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006v_final TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006v_final pnpm exec playwright test tests/e2e/task-006v.spec.ts`:
  exit 0, 1/1; slutkörning 4,0 s (första godkända 8,4 s). Mobil 390 px,
  ändrat sökunderlag rensar preview, explicit lopp/tidszon, förlorat commitsvar,
  samma request-id och endast en intern import. Tredje upstreamhämtningen
  är commit efter två previews; retry gör ingen fjärde hämtning. Logout och
  tom Web Storage verifierade. Skärmbilden visuellt granskad; knappar minst 52 px.
  Verklig Next-session/list-route, gemensam POST-route-handler och PostgreSQL
  används, men testprocessen dispatchar POST för syntetisk upstreaminjektion.
  Detta påstås inte vara full live-HTTP-verifiering eller ett riktigt API-svar.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.eventor.json`: exit 0.
- `CI=true pnpm exec eslint tests/e2e/task-006v.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.eventor.json"}'`: exit 0.
- `CI=true pnpm exec eslint scripts/eventor-connection.ts`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json`: exit 0.

#### Rättade verifieringsproblem och driftsgräns

Första lintförsöket hade en kommentar för en ESLint-regel som projektet inte
installerar; kommentaren togs bort. Typecheck hittade en saknad fail-closed
retur i route-handlern; den lades till. E2E-filens extra typed-lint behövde en
egen avgränsad tsconfig med workspacevägar och Next-ambienttyper. Försök utan
det underlaget räknas inte som godkända. Slutliga kommandon ovan passerar.

Initial frozen/offline-install av nya workspacet misslyckades på ändrad
lockfile respektive saknade tarballs. Tillåten `CI=true pnpm install
--no-frozen-lockfile` återställde och länkade de låsta beroendena (exit 0).
Inga deklarerade beroendeversioner ändrades; befintlig fast-xml-parser återanvänds.

Rollbacktestets tillfälliga trigger/funktion togs bort i finally; inga
tävlingsjournaler raderades. Testdatabasen behålls, isolerad PostgreSQL är
stoppad efter verifiering. Övriga integrations-/E2E-, Android-native-,
produktionslast- och restore-sviter kördes inte om eftersom detta snitt inte
ändrar station/resultatmotor eller befintliga tävlingsflöden. Root build
genererar som vanligt stationsassets, utan ny hårdvarufunktion.

#### Återstående acceptans och antaganden

Autentiserad läsning och import av en användargodkänd riktig Testeventortävling
återstår. Användaren har tillfrågats om lokal nyckelkonfiguration och test-id;
ingen nyckel söktes i privata filer eller begärdes i chatten. Parsern är ett
avgränsat officiellt subset, inte full XSD-konformans; verkliga svaregenskaper
och masterkeyhantering/rotation/restore i produktion är inte verifierade.
Drift ansvarar för separat masterkey, TLS och privat provisioneringsfil.

TASK 006V markeras inte klar och helhetsmålet förblir aktivt. Nästa minsta
arbete är samma snitts autentiserade Testeventorprov, inte en ny funktion.
Ingen stafett, GPS, Eventor-upload eller USB-utökning har påbörjats här.

### Blockerad fortsättning: liveunderlag saknas

Efter implementationsrapporten och två fortsättningsvändor kvarstår samma
villkor: ingen bekräftad lokal Testeventornyckel eller användargodkänd
testtävling/lopp/tidszon har tillkommit. Föregående vända var ingen progress
och ingen verifierad processväntan. Aktuell uppgiftsfil kräver fortfarande
autentiserat liveprov; syntetiska tester ersätter inte detta krav.

Helhetsmålet markeras därför blockerat, inte klart eller nedskalat. Återuppta
när användaren bekräftar lokal nyckelkonfiguration och anger godkända test-id:n
och tidszon. Inga hemligheter ska skickas i chatten. Inga kodändringar eller
omkörningar av oförändrade tester gjordes i blockergranskningen.

### Nytt användarunderlag: tävling 59081

Användaren har nu identifierat produktionstävlingen Skärgårdshelgen, lång,
59081, och tillhandahållit StartList/ResultList. Det tidigare påståendet att
inget tävlings-id angivits gäller därför inte längre. Detta är dock inte en
bekräftad Testeventoranslutning eller ett Testeventor-loppval.

Lokal skrivfri granskning gav ny konkret evidens: båda filerna validerar mot
den tidigare lokala IOF-XSD-kopian, men befintlig importör avvisar dem.
StartList saknar EntryId för alla 221 personposter och StartTime för 151;
ResultList-import stöds inte. Resultatfilen innehåller 228 poster, inklusive
en Cancelled. Inga tider, identiteter eller råavläsningar fabricerades.

Aggregat, filhashar och exakta kontrollresultat finns i
docs/research/skargardshelgen-59081-file-audit.md. Inga original/personrader
kopierades till repo, ingen nyckel användes och inga externa eller interna
tävlingsdata ändrades. Ingen produktionskod ändrades; lint/build och övriga
oförändrade sviter kördes därför inte om. Detta är progress genom verkligt
filunderlag, inte completion av TASK 006V. Nästa minsta underlag för lokal
importkontroll är EntryList och CourseData för samma tävling.

### Förtydligande för 59081: fria starttider

Användaren bekräftar fria starttider. Filgranskningen har kompletterats:
saknade StartTime är inte i sig ett fel i underlaget. Befintlig motor har
redan PUNCH/FIXED, medan ADR-0025:s StartList-import är avgränsad till fasta
tider. Ingen automatisk övergång till PUNCH eller ersättningstid införs;
klassvis startpolicy och identitetskoppling återstår att verifiera.

Endast forskningsanteckning och status ändrades. Inga paket, beroenden,
API-anrop eller tävlingsdata ändrades och ingen ny ADR behövdes eftersom
inget arkitektur-/domänbeslut ändrats. Kontroll: aktuell starttidsselektion
och parserkrav lästes i källkod. Lint, typecheck, tester och build kördes
inte om för denna dokumentationsändring. Föregående muntliga förtydligande
var inte implementation; denna fortsättning bevarar nu uppgiften i repo.

Uppföljande skrivfri XML-kontroll (två Node-anrop, båda exit 0) visar 12
klasser med tider för alla deltagare, 26 utan tider och inga blandade klasser.
Ingen uttrycklig startmetod finns i Class; StartName skiljer inte metoderna åt.
Aggregaten finns i filgranskningen. Detta ger mer precist underlag, men
ersätter inte klassregler eller saknad anmälningsidentitet. Ingen kod eller
tävlingsdata ändrades; lint/typecheck/test/build kördes inte om.

### Kompletterande filer för 59081: konkret saknad bankoppling

Användaren tillhandahöll CourseData, MeOS-datafil och OMAP. CourseData
validerar mot lokal IOF-XSD (exit 0), men nuvarande parser avvisar 13 saknade
ban-ID:n. Lokal namnkontroll ger 13 gemensamma bannamn och inga dubbla namn;
alla 47 klass-/bankopplingar pekar på en bana. Blå 3,0 med tio deltagare
saknar däremot bankoppling i både CourseData, MeOS och StartList.

Ny evidens och en avgränsad fortsatt banimportplan finns i
docs/research/skargardshelgen-59081-file-audit.md. Detta ersätter det gamla
påståendet att inget banunderlag finns. Namnmatchning är inte godkänd som
stabil identitet och ingen importregel har ändrats. Före kod behövs ADR för
namnrefererade banor och klarläggande av Blå 3,0. MeOS- och kartimport
påbörjades inte. Endast dokumentation ändrades; lint/typecheck/test/build
kördes inte om. Autentiserad Testeventoracceptans är fortsatt overifierad.

Användaren tillåter nu riktiga deltagarnamn i en privat testtävling. En
uppföljande läsning av den senare ResultList ger ny evidens: Blå 3,0 har där
bana Id 14/namn Blå 3,0 och 13 personposter. Frågan gäller därför inte längre
en helt okänd bankoppling utan saknad fullständig CourseData för denna bana.
Ingen kontrollföljd härleddes från resultat, och inga deltagare importerades
eller publicerades. Node-kontrollen gav exit 0; endast dokumentation ändrades.

### Privat testtävling 59081 skapad utan Blå 3,0

Användaren godkände att Blå utelämnas. ADR-0047 skrevs före åtgärden och
avgränsar en lokal härledd testdataset, inte en ny produktionsadapter.
Förhandsstartlistan och CourseData preparerades privat: 211 deltagare,
37 klasser, 13 banor, 209 brickor. Testpolicyn använder 12 FIXED-klasser
med 70 befintliga tider och 25 PUNCH-klasser med 141 deltagare.

Isolerad databas `otid_59081_private` skapades och migrerades. Befintliga
capabilityskyddade tjänster skapade event/lopp och importerade tre dokument;
lagrade namn, klubb, tider, antal och återförsök kontrollerades. Noll resultat,
råavläsningar eller publiceringar skapades. Publika läsprojektioner lämnade
inga deltagare. Servern stoppades efter verifiering, databasen behålls.
Detaljer och privata artefaktvägar finns i filgranskningen.

Den kompletterande Nåttarö-OMAP-filen har endast identifierats och hashats.
Ingen karta eller personlista publicerades. Inga källfiler, teknikval,
domänregler eller produktionspaket ändrades. Autentiserad Testeventoracceptans
och riktig hårdvara är inte verifierade av denna lokala testimport.

Slutkontroller för testkopian:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 185 testfiler och 1 148 tester passerade.
  Worker har inga tester och använder befintlig passWithNoTests.
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationens webassets.
- Privat preparering med befintlig parser + tre xmllint/XSD-kontroller: exit 0.
- Privat autentiserat PostgreSQL-importprov med skapanderetry och tre
  importretry, datajämförelse och publiceringskontroll: exit 0.
- Båda privata scripts: `node --check`, exit 0.

Full integrationssvit, browser-E2E och Android-native-sviter kördes inte om:
inga produktionskällor ändrades och detta prov verifierar en lokal
applikations-/PostgreSQL-kedja, inte ett genomklickat browserflöde. Inledande
sandboxad loopbackanslutning avvisades; godkänd lokal eskalering användes för
databasen. Ingen API-nyckel användes. Testet bevisar inte historisk klassvis
startpolicy, produktion/import av originalsubset eller faktisk hårdvara.

Nästa minsta vertikala uppgift: öppna och verifiera den privata operativa
startlistan för denna testtävling i webben, utan publicering eller kartfunktion.

### Privat webbläsarprov och nytt behov: avprickning

Den verkliga privata testlistan verifierades i Chromium mot lokal Next dev
och PostgreSQL, exit 0. 211 deltagare/37 klasser, 12 FIXED/25 PUNCH,
klassfilter, 390/1280 px utan horisontell overflow, tom Web Storage,
utloggning som rensar listan och oförändrad snapshot verifierades.
Oinloggad privat GET gav 401; publik startlista/XML gav 404 och resultat []:
ingen publicering. Tidsbegränsad VIEW_START_LIST-credential spärrades i finally.
Privat script/aggregatrapport finns i samma arbetskatalog som testimporten.

Första testförsöken föll på testselektorn för klassfiltret, inte på
deltagarantal eller auth. Rollselektor för combobox löste detta; slutkörningen
passerade. Produktionsstart ersattes med ordinarie loopback-dev eftersom
produktion kräver HTTPS; ingen säkerhetspolicy ändrades. Webb- och DB-server
stoppades efter testet. Inga produktionskällor ändrades; föregående gröna
lint/typecheck/unit/build kördes därför inte om.

Användaren efterfrågade under arbetet mobil avprickning av startat/ej start.
TASK_006W_MANUAL_START_CHECKIN.md dokumenterar behovet och acceptans inför ADR,
utan att införa skrivning i read-only VIEW_START_LIST. Frågan om mobilens
egen offlinefunktion kontra frånvaro av automatisk SPORTident-koppling har
ställts. Avprickning är inte implementerad och får inte beskrivas som klar.

### TASK 006W: första gemensamma domänbyggstenen

ADR-0048 dokumenterades före kod. `planStartCheckin` skiljer operativa
UNMARKED/STARTED/REPORTED_NOT_STARTED från resultatstatusar. Den planerar
versionsbunden ändring eller no-op för exakt race/entry och avvisar stale,
fel scope, ogiltigt input och revisionsoverflow. Rättning behöver ny
revision; ingen starttid, DNS eller återkomst härleds. Inget I/O införs.

39 nya tester täcker övergångsmatris, rättning, immutabilitet och felgränser.
`CI=true pnpm --filter @o-tid/domain lint`, `typecheck`, `test`, `build` gav
samtliga exit 0; domain totalt 11 filer/190 tester. Första lint hittade en
unsafe matcher i testhjälparen, som ersattes med typkontrollerad felassertion.
Inga lintundantag eller dependencies tillkom.

Root-, PostgreSQL- och browserkontroller kördes inte om för denna ännu
ointegrerade rena export. Inget schema, endpoint, UI, autentiseringsflöde,
testtävlingsdata eller stationspaket ändrades. Arkitektur/domän/uppgiftsfil
har uppdaterats. TASK 006W är inte klar: auth/journal, DB-samtidighet,
mobilt användarflöde, återkomstprojektion och eventuell offlinepersistens
återstår. Nästa steg är att låsa det efterfrågade offlinekravet och besluta
lagrings-/synkgränsen innan dessa delar implementeras.

### TASK 006W: användaren bekräftar offline, DNS och kvar-i-skogen-listor

Offlinefrågan är besvarad: mobilen ska behålla markeringar och synka senare.
Explicit ej start ska bli rättningsbart DNS; tom ruta är fortfarande okänd.
Målpersonal ska få kvar-i-skogen-listor. ADR-0049 dokumenterades före nästa
kodändring och ersätter ADR-0048:s tidigare förbud mot resultatföljd.
Ingen blockerad offlinefråga kvarstår.

`buildForestWatchList` är tillagd i ren domain med 25 tester för alla
grupper, oklar start, returmotsägelser, determinism och ogiltiga/dubbla
identiteter. Alla supplied entries klassificeras; full roster och återkomst-
bevis är applikationens ansvar. Ingen lista publiceras och inga resultat
ändras av funktionen.

Kontroller: `CI=true pnpm --filter @o-tid/domain lint`, `typecheck`, `test`
och `build` gav exit 0. Totalt 12 filer/215 tester. Initial lint hittade
Array.isArray-narrowing till any; explicit bibehållen elementtyp löste detta
utan regelundantag. Root-/DB-/browserkontroller kördes inte om eftersom
ingen integration eller I/O-kod ändrats i detta steg.

En avgränsad Terra Medium-granskning bekräftade att befintlig DNS-write kräver
manual provenans/revision 1. Offlineavprickning behöver egen källkoppling och
återtagande, inte återanvändning av READOUT eller falskt manual-DNS. Nästa
implementation är det atomiska journal-/DNS-/rättningsflödet med migration
och PostgreSQL-tester, därefter beständig mobilkö och privat målvy/utskrift.
Offline-, automatisk DNS- och kvar-i-skogen-UI är ännu inte levererade.

### TASK 006W: durabel serverjournal och explicit operationsberoende

Förra bekräftelsesvaret var ingen implementation. ADR-0050 dokumenterades
före detta lagringssteg. Migration 0032 och Drizzle-schema inför tre
immutable tabeller för avprickningsenhet, operation och operativ revision.
Device är bunden till race/credential/capability; request och device/sekvens
är unika. Deferred ömsesidiga FK binder APPLIED till exakt skapad revision.
UNCHANGED/CONFLICT kan inte bära en skapad revision. Inget raw- eller
resultatobjekt fabriceras, och manuell DNS:s revision-1-provenans ändras inte.
Nya capabilities är ännu inte integrerade i applikationens sessionspolicy.

Delade strikta kontrakt skiljer durabel mottagning från verksamhetseffekt,
kräver canonical identiteter/UTC/hash och separerar startpersonalens action
från målpersonalens rättning/retur. dependsOnRequestId förhindrar att en senare
köad ändring för samma entry oavsiktligt kan baseras på en annan mobils revision
efter att dess egen föregångare konflikterat. Serverkontrollen av kedjan är
fortfarande kommande implementation, inte något kontrakttestet bevisar.

Exakta kontroller:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm build`: exit 0, inklusive webb och stationens webassets.
- Slutlig `CI=true pnpm test`: exit 0, 188 filer / 1 218 tester. Worker
  använder befintlig passWithNoTests och har inga tester.
- Efter sista kontrakts-/schemajustering: contracts, database och application
  lint/typecheck/build gav exit 0; contracts test gav 35 filer / 215 tester.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_journal_final pnpm --filter @o-tid/application exec vitest run test/integration/task-006w-journal.test.ts`:
  exit 0, 1 fil / 10 tester. Alla migrationer kördes från tom PostgreSQL 17-
  databas. Testerna täcker scope/FK, rollback, unik parallell sekvens,
  immutable update/delete, effektform och separat read-only-behörighet.

En tidigare tom verifieringsdatabas `otid_006w_journal` behålls efter
migrationsutvecklingen; den slutliga migrationen verifierades separat i
`otid_006w_journal_final`, inte genom att radera eller skriva om journaldata.
Den lokala PostgreSQL-servern stoppades efter testerna. Privat tävlingskopias
data, originalfiler, kartor och Eventor är orörda. Kommandologgar finns i
`/private/tmp/otid-006w-checks.hE5HSa`. Git-diff gick inte att läsa eftersom
arbetskatalogen inte är ett git-repository.

En avgränsad Terra Medium-agent implementerade kontrakten; huvudagenten
integrerade lagring och verkliga PostgreSQL-tester. Vid integration upptäcktes
och rättades år-0000-validering och det saknade operationsberoendet. Alla
slutliga kontroller ovan är gröna. Inga dependencies tillkom.

TASK 006W är fortfarande inte klar. Journaltesterna testar inte autentiserad
syncservice eller atomisk DNS/audit-effekt. Full äldre integrationssvit,
browseroffline/E2E, Android-native och hårdvara kördes inte: inga sådana
nya flöden finns ännu att godkänna. Återstående antaganden är lokal
upplåsning/persondataskydd efter omladdning och administrativ köåterhämtning
efter spärrad/utgången credential; ingen fungerande lösning påstås.

Nästa arbetssteg inom samma vertikala uppgift är autentiserad synk med atomisk
ny DNS-provenans/återtagande, beroende- och returkonflikter, följt av beständig
mobilkö och målpersonalens privata utskriftslista. Målet har inte ersatts med
enbart journalsubstratet och inget skriv-API har öppnats för halv DNS-effekt.

### TASK 006W: autentiserad enhetsregistrering och sessionsåteranslutning

Nästa genomförda del är den riktiga applikationstjänsten för förberedelse av
avprickningsmobilen. START_CHECKIN och FINISH_FOREST_WATCH har separata
credentialprefix, högst åtta timmars credential och en timmes session på
befintligt säkerhetssubstrat. Strikta login-/registreringskontrakt tillkom.
ADR-0050 konkretiserades före tjänstekoden; ingen ny migration behövdes.

registerStartCheckinDeviceAsAdmin kontrollerar auth/CSRF före body och igen
under transaktionslås med ny klockavläsning efter body. Race SHARE och
namespacat advisory-lås serialiserar deviceId. Exakt race/actor/capability/
label återger samma metadata, också från en ny session. Ändrat intent eller
annan ägare ger konflikt. Enhetsrad och separat actor-audit committar atomärt;
auditfel lämnar ingen enhet och samma deviceId kan försökas igen.

Verifiering i detta steg:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 189 filer / 1 221 tester.
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationsassets.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_journal_final pnpm --filter @o-tid/application exec vitest run --no-file-parallelism test/integration/task-006w-device.test.ts test/integration/task-006w-journal.test.ts test/integration/task-006r.test.ts`:
  exit 0, 3 filer / 19 tester (7 enhetsregistrering, 10 journal, 2 befintlig
  privat startlista). Båda nya roller, ny session, motstridiga ägare,
  samtidiga retries, scope/CSRF, spärr/expiry under body och rollback provas.

En Terra Medium-agent ägde endast authpolicy/kontrakt och deras tester.
Agentens första pnpm-anrop utan CI avbröts under installationsförsök med
non-TTY/registryfel; direkta lokala eslint/tsc/vitest-kontroller passerade.
Huvudagentens slutliga fyra CI=true-rootkommandon ovan passerade efter
integrationen. Fulla loggar: `/private/tmp/otid-006w-checks.hE5HSa/auth-*.log`.
Testservern stoppades efter PG-provet. Ingen privat testtävling eller extern
Eventor-data ändrades och inga nya dependencies tillkom.

Leveransgräns: registrering är inte avprickningssynk. Den skapar inga
operationer, DNS/resultat, rawdata, rosterändringar eller snapshotökningar.
HTTP/cookies/UI och lokal beständighet är ännu inte kopplade. Full äldre
integrationssvit, browser-E2E/offline och Android/hårdvara kördes inte; den
nya funktionen existerar hittills på applikations-/databasnivå.

Kvarstående antaganden gäller fortfarande lokal upplåsning/persondataskydd
och explicit återhämtning när credentialen själv (inte bara sessionen) gått
ut eller spärrats. Ingen automatisk enhetsöverlåtelse infördes. DNS-källans
nya provenans, återtagande och samtliga resultatläsare måste kopplas ihop före
aktivering av själva avprickningssynken. Därefter återstår offlinekö och den
privata, utskrivbara kvar-i-skogen-listan. TASK 006W är inte färdig och målet
är fortsatt hela det begärda vertikala flödet, inte bara registrering.

### TASK 006W: separat DNS-provenans med migrations- och regressionsprov

ADR-0051 dokumenterades före implementation. Migration 0033 och schema
inför START_CHECKIN_DID_NOT_START, nullable start_checkin_dns_decision_id
och två immutable decision/withdrawal-tabeller. Exakt operativ revision,
race/entry/klass och resultatrevision binds med FK/unikhet; decision↔result
är reciprocal och deferred. Ingen äldre manual-DNS-regel ändras och samtliga
äldre resultatkällor kräver null i det nya fältet. Rollback/restore-not finns
i migration och ADR; ingen backfill eller dataradering har gjorts.

Application-källvalideringen kontrollerar strict operation och kvittens,
canonical SHA-256, device/capability/actor, scope, revisionslänkar,
status-only DNS, tids-/policybindning och exakt senare återtagande. Den
bevisar historisk provenans, inte aktuell frånvaro av återkomst eller hela
beroendekedjans tidigare skrivgrind. Nuvarande strict stored-result-parser
avvisar fortfarande den nya källan utan full läsarintegration. Läsarnas
SQL-projektioner tar in fältet för denna spärr; historik-DTO filtrerar bort
det, så äldre privata/publika kontrakt inte utökas med interna källfält.

Genomförda kontroller:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 190 filer / 1 226 tester (application 90,
  inklusive 5 nya källvalideringstester).
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationens assets.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_final pnpm test:integration`:
  exit 0, hela dåvarande sviten 8 filer / 165 tester. Äldre ingest, manual-
  lifecycle, publik, Snapshot, historik och finalisering passerade.
- Efter sista tillägget av klass/lopp-FK:
  `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm --filter @o-tid/application exec vitest run test/integration/task-006w-dns-source.test.ts`:
  exit 0, 1 fil / 6 tester från tom PostgreSQL 17-databas med alla migrationer.
  Detta är ett separat slutligt migrationsprov, inte 166 omkörda fullsuite-tester.
  Database och application lint/typecheck/build kördes därefter, alla exit 0.

De nya PG-proven täcker komplett reciprocal källa, rollback av orphan/mismatch,
förbud mot äldre/falsk källform, klass i fel lopp, exakt withdrawal och
immutabilitet. Fem rena källtester täcker hash-/receipt-/actor-/role-
motsägelser och missriktad eller icke-korrigerande withdrawal. Initial
typecheck hittade saknat nytt källfält i fyra SQL-projektioner och tre äldre
typade fixtures; dessa uppdaterades innan slutkontrollerna.

En Terra Medium-agent ägde schema/migration; huvudagenten ägde validering,
läsarspärr och tester. Agentens pnpm-försök avbröts före kontroll vid
installations-/non-TTY-fel, men huvudagentens slutliga CI=true-kommandon
ovan gick igenom. Loggar finns i `/private/tmp/otid-006w-checks.hE5HSa/dns-*.log`.
Testservern är stoppad. Testdatabaserna behålls; privata tävlingskopian har
inte migrerats eller ändrats. Ny appdrift kräver ordinarie migration före
resultatläsning. Inga Eventor-anrop, kart-, GPS-, stafett- eller USB-ändringar.

TASK 006W är inte klar: central withdrawal-overlay, manual-writer-grind,
historik/nya finaliseringsformat och synkskrivare måste integreras innan
den nya DNS-källan får skrivas av ett API. DNS→ingest och ingest→sen rapport
är ännu inte verifierade för den nya källans kompletta användarflöde.
Offlinekö, lokal upplåsning/credentialåterhämtning och målpersonalens privata
utskriftslista återstår. Browser-/Android-/hårdvaruprov kördes inte eftersom
inget nytt sådant flöde aktiverats. Nästa steg inom samma uppgift är att
koppla provenanskedjan till den centrala resultatresolven och dess läsare.

### TASK 006W: central DNS-resolver och verifierad publik rättning

Den centrala resultatresolven laddar nu full avpricknings-DNS-kedja och
validerar operation, kvittens, hash, operativ revision, enhet och beslut.
Valt återtaget DNS-huvud ger NO_ACTIVE_RESULT utan historisk fallback.
Manual-writer-grinden känner igen aktiv avpricknings-DNS. Publik- och
Snapshot-läsaren lämnar källbevis till strict-parsern; giltigt bevis för en
annan eller modifierad resultatrad avvisas. ADR-0051 dokumenterar återbruk
av domänens exakta DNS-targetregel utan återbruk av gamla manuella journalen.

Verifierat 2026-09-05:

- `CI=true pnpm --filter @o-tid/application lint`: exit 0.
- `CI=true pnpm --filter @o-tid/application typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/application test`: exit 0, 21 filer / 91 tester.
- `CI=true pnpm --filter @o-tid/application build`: exit 0.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm --filter @o-tid/application test:integration`:
  exit 0, 8 filer / 167 tester. Nytt direkt PostgreSQL-prov täcker aktiv
  DNS, gemensam manual-grind, publikprojektion och exakt återtagande med
  bevarad revision. Testet använder syntetisk journal, inte synkskrivaren.

Första nya PG-testet hade fel API-form i förväntan; det rättades. En ny
unitfixture hade fel TypeScript-form och en äldre query-stub saknade limit;
båda rättades före ovanstående gröna slutkontroller. Den tidigare pågående
typkontrollen hade även upptäckt operationernas requestId/id-skillnad i
loadern; agentens slutliga fil använder explicit nyckelfunktion.

Ingen root-/browser-/Android-/hårdvarusvit kördes i detta steg. Nya DNS-källans
Snapshot-export är kopplad men saknar ännu riktat exportprov; gamla export-
och finaliseringsregressioner passerar. Historik, nya Complete-format,
DNS→riktig ingest och ingest→sen negativ rapport samt atomisk synkskrivare
återstår före aktiverad write-route. Offlinekö, behörighetsåterhämtning och
privat utskrivbar kvar-i-skogen-lista återstår; TASK 006W är inte klar.
Testservern är stoppad och databaser bevarade. Privat tävlingskopia,
Eventor, kartor, GPS, stafett och USB är oförändrade.

### TASK 006W: Snapshot-prov och privat historik format 10

Privat list-/detaljhistorik producerar format 10, med strikt separat
START_CHECKIN_DID_NOT_START-provenans och exakt nullable withdrawal.
Applikationen laddar och validerar hela DNS-kedjan före DTO-projektion;
actor/device/hash/receipt följer inte med. Äldre kontraktsversioner 1–9
behålls. Webbens historik använder hela kontraktsunionen och har svensk
orsakstext samt tydlig markering för återtagen avpricknings-DNS. ADR-0051
utökades före applikationsimplementation; inga teknikval ändrades.

Det riktade PostgreSQL-provet verifierar nu explicit DidNotStart i Snapshot
utan Position eller interna käll-ID:n, uteslutning efter withdrawal,
därefter simulatoringest genom ordinarie ingestDeviceBatch och publicerat
OK revision 2. Historik v10 behåller DNS revision 1 inklusive exakt rättning
och teknisk revision 2. Detta är withdrawn-DNS→simulatoringest; ingen riktig
USB och ännu inte negativ offlinesynk efter återkomst via nya synkskrivaren.

Slutkontroller 2026-09-05:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 190 testfiler / 1 228 tester; worker har
  0 testfiler och explicit passWithNoTests. Contracts 219, application 91,
  web 423 tester. Övriga paket 495 tester.
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationens assets.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm test:integration`:
  exit 0, 8 filer / 167 tester.
- Application lint/typecheck kördes dessutom efter sista justeringen av
  äldre tester; båda exit 0.

Första exportprovet avvisades korrekt eftersom syntetiska banan saknade
kontroller; fixture fick en verklig kontrollrelation och PUNCH-startregel.
Första regressionskörningarna hittade sju PG- och två source-policy-tester
som explicit krävde format 9. Förväntningarna uppdaterades till 10 med
befintliga innehållsassertioner kvar, därefter gick slutkontrollerna igenom.
En Terra Medium-agent ägde contracts och dess tester; huvudagenten ägde
ADR/applikationsprojektion, webbkonsument och integration.

Browser-E2E och native Android-/hårdvaruprov kördes inte: ingen ny mobil
synkväg har aktiverats. Den nya visuella historikmarkeringen är typkontrollerad
och ingår i webbsuitens regression/build, men inte särskilt browserverifierad.
Testservern är stoppad, testdata bevarade och privata tävlingskopian orörd.
Inga Eventor-anrop eller nyckelanvändning. Complete-format, atomisk synkskrivare,
offlinekö/upplåsning och målpersonalens utskrivbara lista återstår; TASK 006W
är inte klar. Nästa implementationssteg är ny fryst Complete-provenans.

### TASK 006W: fryst Complete-provenans format 9

ADR-0051 dokumenterar nu nytt klass-/loppsformat 9 innan implementation.
Contracts behåller format 1–8 och lägger till strikt avpricknings-DNS med
exakta beslut-/operations-/revisionsreferenser och withdrawal:null.
Finaliseringskandidater använder den validerade centrala DNS-källan, binder
den i basis-hash och fryser DNS som DidNotStart. Återtaget DNS utan senare
resultat blockerar ny finalisering; en äldre klassfinalisering behöver vara
aktuell och i format 9 för ny loppsfinalisering. Gamla sparade XML omskrivs
inte och kan fortsatt hämtas genom befintlig exportfunktion.

Riktat PostgreSQL-prov täcker aktiv DNS → klassfinalisering → loppsfinalisering
→ exakt retry → Complete. Efter withdrawal avvisar kandidaten ny finalisering
med WITHDRAWN_DID_NOT_START; tidigare Complete är exakt byte-identisk både
efter rättning och efter senare simulatoringest. Frozen projection innehåller
den nya källtypen, inte fabricerad readout eller gammalt manuellt DNS.

Slutkontroller 2026-09-05:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 190 filer / 1 229 tester (contracts 220,
  application 91, web 423; worker 0 med passWithNoTests).
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationsassets.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm test:integration`:
  exit 0, 8 filer / 167 tester. Efter detta förenklades en ekvivalent
  blocker-assertion för lint; produktionskod och förväntad blocker oförändrade.

Första lint-körningen avvisade en nästlad any-typad Vitest-matcher. Den
ersattes med explicit svarsnarrowing och toContain före gröna rootkontroller.
Äldre regressionsförväntningar för nya finaliseringars format uppdaterades
från 8 till 9; legacy-kontrakt och testfixtures för gamla format behölls.
Terra Medium ägde kontrakt/test; huvudagenten ägde application/ADR/PG-prov.

Testservern är stoppad, databaser bevarade och privata tävlingskopian orörd.
Ingen ny webbrutt, native/hårdvarufunktion eller Eventor-anrop. Inget nytt
browser-E2E eller riktigt USB-prov kördes; nya DNS-operationer skapas ännu
bara som syntetiska PG-fixtures, inte via aktiverad synkskrivare. Atomisk
synkskrivare, sen-negativ-/återkomstgrindar, mobilens offlinekö och den privata
utskrivbara kvar-i-skogen-listan återstår. TASK 006W är inte klar. Nästa steg
inom uppgiften är autentiserad, idempotent avprickningssynk med dessa grindar.

### TASK 006W: autentiserad atomisk synktjänst

syncStartCheckinAsAdmin finns nu i application, utan aktiverad HTTP-route.
Auth/CSRF sker före body och kontrolleras igen under transaktion. Separat
requestlås, permanent enhetsägare, strikt enhetssekvens och entrylås skyddar
retry och samtidighet. Intent/hash och lagrad kvittens valideras; exakt retry
returnerar historisk kvittens före aktuell verksamhetsgrund. Stale paket,
entry/revision och blockerat beroende ger durabel CONFLICT, aldrig implicit
ombasering eller borttagen journal. Lucka/återanvänd identitet ger ingen ack.

Ren planStartCheckinSync beslutar operativ revision, bibehållen/rättad manuell
återkomst och NONE/CREATE/WITHDRAW för DNS. Tom markering ger inte DNS.
Negativ rapport efter avläsning eller startpersonalrapport efter manuell
återkomst blockeras. Annan resultathistorik får inte bli nytt avpricknings-DNS.
Operation, operativ revision, DNS-källa/withdrawal och audit committar atomärt.
Ingen faktisk starttid eller råavläsning fabriceras. ADR-0050 konkretiserades
före implementation. En Terra Medium-agent ägde domain; huvudagenten application
och PostgreSQL-proven.

Slutkontroller 2026-09-05:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 191 filer / 1 260 tester (domain 246,
  inklusive 31 synkplanerarprov; contracts 220, application 91, web 423).
  Worker har 0 tester med explicit passWithNoTests.
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationsassets.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm test:integration`:
  exit 0, 9 filer / 175 tester.

Åtta nya PG-prov täcker samtidiga exact retries, DNS→withdrawal→ny DNS,
oförändrad UNMARKED, stale/dependency/sekvenskonflikter, manuell återkomst,
DNS före/efter simulatoringest, samtidiga mobiler och samtidig ingest,
auditforcerad total rollback med säker retry, ny session och utgången auth
efter body samt fel roll/hash/CSRF utan journal. Testtriggern togs bort i
finally; inga materiella testdata raderades. Testservern är stoppad och
privata tävlingskopian orörd. Inga externa API-anrop eller nyckelanvändning.

Återstående verifiering gäller bland annat hela HTTP-/offlineflödet och
målpersonalens lista, inte bara serviceanrop. Ingen browser-E2E eller riktig
USB/nativeprov kördes eftersom ingen ny sådan yta aktiverats. HTTP/operativt
versionsmärkt läsunderlag, offlinekö/upplåsning/credentialåterhämtning samt
privat utskrivbar kvar-i-skogen-lista återstår. TASK 006W är inte klar.
Nästa steg inom samma uppgift är skyddat operativt läsunderlag och HTTP-synk.

### TASK 006W: privat operativ roster och skogsstatus

ADR-0052 föregick nytt strikt rosterkontrakt och
listStartCheckinRosterAsAdmin. START_CHECKIN/FINISH_FOREST_WATCH får samma
racebundna underlag från en repeatable-read-transaktion. Hela roster krävs;
storleksgränser avvisar i stället för att trunkera. Operativ journal/kvittens
valideras med synkskrivarens gemensamma validator. Aktuell DNS kommer från
centrala resultatresolven, återkomst från manuell uppgift eller faktisk
kopplad avläsning/teknisk resultatkälla. Domain klassificerar skogsstatus.

Svar innehåller entry-/snapshotversion, blandad FIXED/PUNCH-start, tydlig
tvetydig bricka, revision/startstate/retur/DNS/konflikt och needsFollowUp.
Enhetslistan visar senaste durabla sekvens/tid, aldrig påstådd tom offlinekö.
knowledge=LAST_SYNCED_ONLY är obligatoriskt. Konflikter kvarstår konservativt;
normal senare markering är ingen automatisk avskrivning av konfliktjournalen.
Inga credentials/hashar/operationsintents följer roster-DTO:n.

Slutkontroller 2026-09-05:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 192 filer / 1 264 tester (contracts 224,
  domain 246, application 91, web 423; worker 0 med passWithNoTests).
- `CI=true pnpm build`: exit 0, inklusive Next.js och stationsassets.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm test:integration`:
  exit 0, 9 filer / 177 tester.

Nya PG-assertioner täcker hela roster med blandad start, revision 0,
STARTED_NO_RETURN, NOT_STARTED, manuell/teknisk RETURNED, beständig CONFLICT,
senaste durabla enhetsmottagning, båda behörigheterna, fel race/session och
read-only utan nya audit-/journalposter. Terra Medium ägde kontrakt/test;
huvudagenten ADR/application/PG. Kontrollerna gick igenom utan fel i detta steg.

Testservern är stoppad och databaser bevarade. Privat tävlingskopia, Eventor,
nycklar och hårdvara är orörda. Inget nytt browser-/native-E2E eftersom ingen
ny route/vy finns. HTTP och klientens offlinekö/upplåsning samt målpersonalens
privata utskriftsvy återstår. Konfliktavskrivning är ännu inte införd;
listan behåller därför historiska konflikter som uppföljningsbehov.
TASK 006W är inte klar. Nästa steg inom uppgiften är skyddade HTTP-anrop för
start-/målbehörighet, roster, enhetsregistrering och synk.

### TASK 006W: skyddade HTTP-anrop för start och mål

ADR-0052:s HTTP-beslut föregick implementation. Åtta tunna routefiler binder
START_CHECKIN respektive FINISH_FOREST_WATCH statiskt för session
(GET/POST/DELETE), roster (GET), devices (POST) och sync (POST).
Separata cookiepar återanvänder befintligt Origin/CSRF-/4 KiB-substrat.
Alla svar är privata/no-store; validerade success-svar måste matcha route-race
och capability där fältet finns. Interna fel lämnar inga detaljer.
Durabel verksamhetskonflikt är HTTP 200 med STORED-kvittens; transportkonflikt
är 409 utan kvittens. För stort roster avvisas med 413, aldrig delvis lista.

Verifiering 2026-09-05:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 193 filer / 1 275 tester
  (contracts 225, domain 246, application 91, web 433; övriga oförändrade,
  worker 0 med explicit passWithNoTests).
- `CI=true pnpm build`: exit 0; alla åtta nya routes finns i Next.js-bygget.
- Riktat kontraktstest: exit 0, 1 fil / 4 tester. Riktade HTTP-handlertester:
  exit 0, 1 fil / 10 tester efter slutlig scope-kontroll.

Terra Medium implementerade avgränsade handlers/security/cookies/tester;
huvudagenten ADR, kontraktets felkuvert, routekoppling och workspacekontroller.
Tester täcker capabilitycookies, fel race, Origin, CSRF-vidarebefordran,
auth före body, JSON-/storleksfel, outputvalidering och kvittenssemantik.
PostgreSQL-skrivare/schema är oförändrade i detta steg; föregående körnings
9 filer / 177 PG-tester återanvänds, inte presenterade som ny körning.
Ingen browser-E2E eller riktig HTTP→PostgreSQL-kedja kördes i detta steg;
handlerprov använder injicerade tjänster. Mobilens offlineflöde och privat
utskriftsvy är fortfarande inte verifierade eller färdiga.

Antaganden/begränsningar: listan beskriver senast synkad kunskap, inte faktisk
position; historiska konflikter kvarstår tills explicit granskning införts;
lokal upplåsning, credentialåterhämtning och beständig offlinekö återstår.
Ingen Eventor-nyckel, extern API, privat tävlingskopia eller hårdvara berördes.
TASK 006W är inte klar. Nästa minsta steg inom samma uppgift är målpersonalens
privata läs-/utskriftsvy mot detta underlag, med synlig datatid och osäkerhet.

### TASK 006W: målpersonalens privata läs-/utskriftsvy

ADR-0052 kompletterades före implementation. Ny /admin/<raceId>/forest-watch
är ett persondatafritt shell före FINISH_FOREST_WATCH-login. Den presenterar
serverns fem grupper utan egen klassificerings-/resultatlogik, med klassfilter,
visat/hela loppets antal, planerad FIXED eller fri PUNCH, återkomstkälla,
snapshot-/genereringstid/tidszon, race-id och enheters senaste mottagning.
Samma filter och osäkerhet finns på utskriften. Alla grupper visas även tomma;
ingen tom grupp betyder säkert tom skog. Privat navlänk finns i översikten.

HTTP-klienten validerar schema/scope, avvisar redirects och begränsar hela
request+body till 15 sekunder. Avbruten caller före start gör inget nätanrop.
Periodisk/återvändande läsning kontrollerar session; känd expiry döljer data.
Nätfel behåller gammalt underlag med varning, authfel/logout döljer det och
avbryter läsning. Ingen Web Storage, ny beroende eller schemaändring infördes.
Detta är ännu inte startmobilens obligatoriska beständiga offlineklient.

Verifiering 2026-09-05:

- `CI=true pnpm lint`: exit 0; slutlig web-lint efter browserrättningar exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 195 filer / 1 284 tester. Slutlig webomkörning:
  92 filer / 442 tester, exit 0. Worker 0 med explicit passWithNoTests.
- `CI=true pnpm build`: exit 0 efter slutliga browserrättningar,
  inklusive TypeScript och nya forest-watch-routen.
- E2E-specifik tsc och ESLint enligt AGENTS.md: båda exit 0.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm exec playwright test tests/e2e/task-006w-forest-watch.spec.ts`:
  slutligt exit 0, 1/1 browserprov på 8,4 sekunder.

Browserprovet använder riktig HTTP/session/roster och PostgreSQL med fem
syntetiska deltagare och riktiga application-operationer. Det täcker alla
grupper, båda startformer, 390 px utan horisontell overflow, 52 px-knappar,
klassfilter, printmedia 794 px, stale-nätfel, authfel och ett faktiskt fördröjt
rostersvar efter logout som inte återvisar persondata. Privata API-svar är
no-store; inga rosterläsningar skapar operationsjournal. Mobil- och printbilder
i test-results granskades visuellt. Fysisk skrivare/sidbrytning i pappersutskrift
är inte provad. Browserns printmedia är inte ett PDF-/skrivarprov.

Första webtypecheck upptäckte Vitest-3-generics i klienttest; rättat, slutligt
grönt. Tidiga browserprov hittade Next dev:s shell-headeroverride (no-cache
trots konfigurerad no-store), kapplöpning mellan initial auth och lösenordsfält
samt klassfiltrets otydliga tillgängliga namn. Provet kontrollerar nu privat
API-cache separat; fältet väntar på auth och filtret har explicit aria-label.
Inga misslyckade prov räknas som godkända. Produktionsdeployment är inte provad.

PG-testservern är stoppad och syntetiska testdata bevarade. Föregående fulla
PG-svit 177 tester återanvänds för oförändrat application/schema; browserprovet
ovan är ny verifiering. Inga Eventoranrop, nycklar, privata tävlingsdata,
kartor, stafett, GPS eller riktig USB berördes. Ingen ny nativekontroll behövdes.

TASK 006W är inte klar: beständig offlineavprickning med lokal upplåsning och
credentialåterhämtning, målpersonalens rättnings-UI och explicit konfliktgranskning
återstår. Nästa minsta vertikala steg inom uppgiften är att förbereda en
startmobil, spara en avprickning beständigt och synka samma operation efter
omladdning/nätåterkomst. Lagrings-/upplåsningsbeslut ska konkretiseras före I/O-kod.

### TASK 006W: krypterad browserkö och ordnad enstegstransport

ADR-0053 skapades före persistenskod och kompletterades före transporten.
Separat lokal lösenfras härleder icke-exporterbar AES-GCM-nyckel med Web Crypto.
Roster, registrering, operationsintents och kvittenser krypteras; servercredential,
session och CSRF lagras inte. IndexedDB har separata stores, strict durability,
atomisk sekvensallokering och versions-CAS mellan flikar. Kryptering sker utanför
den korta skrivtransaktionen. Endast transaction complete ger lokalt sparbesked.
Låsning, fel lösenfras, manipulerad post, kvittensfel och nätfel raderar inget.
Export av krypterat arkiv finns; import/credentialöverlåtelse finns inte.

Enstegstransport skickar första okvitterade operationens frysta bytes/hash mot
race- och capabilitybunden HTTP-route med aktuell CSRF. Den accepterar endast
HTTP 200 med exakt STORED-kvittens och inväntar lokal receiptcommit. HTTP 409
är transportfel, inte kvittens; STORED/CONFLICT behålls som mottagen men inte
genomförd. Timeout omfattar bodyläsningen. Nätfel, authfel och lokalt CAS-fel
bevarar samma retryintent. Inga resultat-/DNS-regler flyttades till klienten.
START_CHECKIN kan bara köa MARK_START, målrollen bara FINISH_CORRECTION.

Verifiering 2026-09-05, efter slutlig produktionskod:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 197 filer / 1 306 tester; web 94 filer / 464
  tester, inklusive 7 kryptotester och 15 transporttester. Worker har 0 tester
  med explicit passWithNoTests. Tidigare lagringskontroll före transporttillägget
  var 196 filer / 1 291 tester; den ersätts av slutkörningen ovan.
- `CI=true pnpm build`: exit 0, inklusive Next.js 16.3.3 och TypeScript.
- E2E-specifik tsc samt ESLint enligt AGENTS.md: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.vault.config.ts`:
  exit 0, 7/7 browserprov. Riktig Chromium IndexedDB och Web Crypto, separat
  persondatafri loopbacktestserver. Transportsvaret är simulerat, inte HTTP/PG.

Browserproven täcker omladdning/upplåsning, fel lösenfras, byteändring i
krypterad post, två flikars konkurrens, verkligt IDB-transaktionsavbrott utan
sekvenslucka, lock-under-write, exakt/ordnad kvittens, bevarad konflikt,
rollgrind, rosterrefresh utan intentändring och avvisad osäker rensning.
Tappat transportsvar följs av omladdning, byteidentiskt retry och beständigt
sparad kvittens. Persist-funktionens faktiska utfall läses; testet kräver inte
att browsern beviljar persistent storage.

Tidiga prov hittade CommonJS/import.meta-konflikt i testharnessen, lintfel i
prototypreferens/mockargument/bodykonvertering och behov av strikt roll/action
i båda riktningar. Rättat och relevanta kontroller omkörda; inga misslyckade
prov räknas som godkända. Terra Medium gjorde avgränsad kryptomodul och dess
tester; huvudagenten ADR, IDB-adapter, transport, browserprov och integration.

Antaganden/begränsningar: passfras måste bevaras av operatören; förlorad profil,
same-origin-angrepp och glömd passfras skyddas inte av denna implementation.
Prestanda och lagring på riktiga startmobiler är inte fältprovade. Appskal,
uttryckligt lagringssamtycke/riskacceptans i UI, behörighetsåterhämtning och
faktisk offline HTTP/PG-synk återstår. Application/schema är oförändrade;
föregående fulla PG-svit 177 tester återanvänds, inte en ny körning. Ingen
native-/hårdvaruändring, Eventoranrop, produktionsnyckel eller privat tävling
berördes. PG-testservern är fortsatt stoppad.

TASK 006W är inte klar. Nästa minsta steg inom samma uppgift är persondatafritt
offline-appskal med explicit förberedelse, lokal upplåsning och en avprickning
som kan synkas efter omladdning mot de befintliga skyddade HTTP-anropen.

### TASK 006W: byggt offline-appskal, privat förberedelse och lokal upplåsning

ADR-0054 föregick bygg-/cachekopplingen. /checkin/index.html är ett separat
persondatafritt React-appskal, byggt med workspace-stationens redan låsta
esbuild och serverat av samma Next.js. Web dev/build genererar hashbenämnda
JS/CSS, HTML och service worker; inga runtimehemligheter eller persondata
läggs i byggmaterial. Genererade public/checkin ignoreras i Git. Lint omfattar
nu även byggscriptet. Ingen dependency eller server/domängräns ändrades.

Worker har scope /checkin/, exakt allowlist av tre publika byggfiler,
SHA-256-/MIME-/status-/redirectkontroll före cachewrite och läsning, och inga
API-/RSC-/query-/kart-/rostercachevägar. Aktivering använder inte skipWaiting;
gamla öppna klienter byter inte kod mitt i arbetet. Cacheversioner innehåller
bara byggmaterial och rensas ännu inte automatiskt. MessageChannel kontrollerar
hela cachen och laddad JS-version före offline redo. Registrering och status-
väntan är tidsbegränsade. Next skickar strikt CSP, no-referrer och nosniff.

Mobilförberedelse kräver shellkontroll, faktisk persist-kontroll, uttryckligt
samtycke och riskacceptans om persist nekas. Capabilitybunden browserklient
loggar in, registrerar samma in-memory retrydevice, hämtar full roster och
skapar krypterad lokal kopia med återläsning. Lösenord/credential töms ur
fälten och sparas inte. Efter omladdning visas endast opaka lokala vault-id;
namn kommer fram först efter lyckad lokal upplåsning. Lock/pagehide släpper
nyckel och döljer persondata utan att radera IDB. UI-texter är externaliserade.
Skrivknappar och synk från denna vy är uttryckligen ännu inte aktiverade.

Verifiering 2026-09-05:

- `CI=true pnpm lint`: exit 0, inklusive nya byggscriptet. Slutlig riktad
  ESLint efter en testassertions uppdatering: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: slutligt exit 0, 198 filer / 1 310 tester.
  Web 95 filer / 468 tester; worker 0 med explicit passWithNoTests.
- `CI=true pnpm build`: exit 0, inklusive genererat checkin-shell
  2208f5930a98 och Next.js 16.3.3. Inget deploymentprov utfört.
- E2E-specifik tsc och ESLint enligt AGENTS.md: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.checkin-shell.config.ts`:
  exit 0, 3/3 browserprov på 5,9 sekunder. Riktig Next-server, byggt React-
  bundle, service worker, Web Crypto och IndexedDB. HTTP-auth/device/roster
  simuleras med syntetiska data; detta är inte ett PostgreSQL-kedjeprov.

Proven visar offline reload, strikt cacheallowlist även efter misslyckade API-
och queryanrop, avvisat redo vid ändrad cache, samtyckesgrind, lyckad privat
förberedelse, frånvaro av namn efter reload, fel och rätt lokal lösenfras samt
låsning utan köförlust. Cachetexter innehåller inte syntetiskt namn, lösenfras
eller actor-id. 390 px kontrolleras utan overflow; bilderna prepared-mobile.png
och locked-offline.png i test-results granskades visuellt. Inga fysiska mobiler.

Första fulla testkörningen hade 1 fel: äldre simulatorprov krävde exakt tidigare
devscriptsträng. Assertionen uppdaterades till det nya shellförsteget med samma
uttryckliga 127.0.0.1-bindning; hela testsuiten omkördes grönt. Tidiga lintfel
för FormData-strängning rättades med typkontroll, inte avstängda regler.
Terra Medium levererade enbart browserklient + 4 tester och riktad tsc/lint;
huvudagenten gjorde ADR, bygg-/worker-/UI-koppling och browserverifiering.

Antaganden/begränsningar: faktisk HTTP/PG-synk och credentials utgång/spärrning
är inte testade genom denna UI; krypterat arkiv har fortfarande ingen import/
administrativ överlåtelse. Misslyckad förberedelse före IDB kan lämna en oanvänd
serverregistrering utan operationer; den återanvänds vid samma retry i öppna
vyn, aldrig genom tyst övertagande från annan actor. Produktionsdistribution
måste inkludera public/checkin. Lagring under tryck och riktiga iOS-/Android-
enheter återstår. Inga Eventoranrop, privata tävlingsdata, nycklar, GPS, kartor,
stafett eller riktig USB berördes. PG är oförändrad och stoppad; tidigare
177 PG-prov återanvänds för oförändrat application/schema, inte ny körning.

TASK 006W är inte klar. Nästa minsta steg inom samma uppgift är aktiverbart
avprickningsläge i den upplåsta listan, beständig markering och ordnad synk
via befintlig transport efter offlineomladdning, därefter faktisk HTTP/PG-
verifiering. Målpersonalens rättning och explicit konfliktgranskning återstår.

### TASK 006W: operativ offlineavprickning, målrättning och riktig HTTP/PG-kedja

ADR-0054 kompletterades före operativ UI-koppling. Upplåst lista har klassfilter,
FIXED i loppets tidszon och PUNCH som fri start, tre separata startknappar och
målrollens explicita formulär för startmarkering/manuell återkomst. Skrivläge
är avstängt efter reload/upplåsning. Lokal markering uppdateras först efter
IDB-commit och återläsning. Gemensam checkinLocalView används av både writer och
presentation för lokala intents; den räknar aldrig DNS/resultat/skogstillstånd.
Namn, klubb, klass, bricka, planerad start, serverns gamla uppgift, lokal intent,
kö och konflikt visas separat. Historisk konflikt avskrivs inte av en knapp.

Synk kontrollerar aktuell session och exakt återregistrering av samma device/
actor före ordnade POSTs. Varje serverkvittens committar lokalt före nästa
sekvens. Roster uppdateras separat efter dränering; inga intents ombaseras.
CAS-fel ger omläsning och avstängt skrivläge. Lock avbryter nätarbete och
skyddar mot sent UI-svar. Opt-in för online-event finns medan listan är upplåst;
ingen låst bakgrundssynk. Samma arbetscredential kan skapa ny session, men
spärrad/utgången/annan credential får inte tyst överta lokal kö. Privat startlista
och översikt länkar till appskalet med validerat race-id i fragment, utan att
länken ger behörighet eller lägger race-id i cachequery.

Verifiering 2026-09-05:

- `CI=true pnpm lint`: exit 0. Slutlig web-lint efter navkoppling exit 0.
- `CI=true pnpm typecheck`: exit 0; slutligt build inkluderar TypeScript efter
  navkopplingen.
- `CI=true pnpm test`: exit 0, 200 filer / 1 317 tester; web 97 filer / 475
  tester. Worker 0 med explicit passWithNoTests.
- `CI=true pnpm build`: exit 0, inklusive shell 30ff5303d2ad och Next.js 16.3.3.
- Riktade tester av lokal projektion och rosterkontroller: exit 0, 2 filer /
  7 tester. E2E-specifik tsc och ESLint för shell och HTTP/PG-spec: exit 0.
- Vault-browserprov efter delad projektion: exit 0, 7/7 på 2,3 sekunder.
- Shell-browserprov med offlineavprickning och tappat simulerat svar:
  exit 0, 3/3 på 4,3 sekunder. Riktig IDB/worker, simulerad HTTP.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_dns_verified pnpm exec playwright test tests/e2e/task-006w-checkin.spec.ts`:
  slutligt exit 0, 1/1 på 29,0 sekunder, riktig Next HTTP och PostgreSQL.

Det sista provet skapar en isolerad syntetisk tävling med fri-/minutklass och
två separata browserprofiler för start och mål. Det visar att offlineklick
skapar noll serveroperationer, att lokal reload kräver upplåsning och att
skrivläge återställs. Första verkliga sync-POST committar i PG men svaret tappas
medvetet; retry efter reload skickar samma bytes och ger exakt en operation.
Nästa entrys ej-start skapar en separat DNS-decision. Målformuläret rättar den
och skapar withdrawal utan ändrad ursprungsdecision. En redan köad negativ
startuppgift, skickad efter målpersonalens registrerade återkomst, blir konflikt
och lämnar senaste startrevision/återkomst orörd. Ingen extra DNS fabriceras.

Första riktiga browserkörningen nådde timeout på otydligt tillgängligt namn för
Arbetsuppgift-select. Explicit aria-label lades till även klass-/målselect;
omkörningen ovan passerar. En samtidig tidig tsc såg agentens ännu ofärdiga
test-union; slutlig tsc och tester är gröna. Terra Medium levererade avgränsade
rosterkontroller/texter och fyra SSR-prov; huvudagenten gjorde controller,
delad lokal projektion, transportkoppling, browser/PG-prov och integration.
Konfliktvyn vid 390 px granskades visuellt i late-report-conflict.png.

Begränsningar: full credentialåterhämtning/administrativ överlåtelse och explicit
konfliktgranskning saknas fortfarande. Auto-online-kapplöpningar, spärrad auth i
denna UI, fysiska mobiler och produktionsuppgradering är inte fältverifierade.
Tidigare 177 fulla PG-integrationsprov återanvänds för oförändrat application/
schema; HTTP/PG-browserprovet ovan är en ny separat verifiering. Testservern
är åter stoppad och syntetiska data behållna. Ingen privat tävling, Eventor-API,
nyckel, karta, stafett, GPS eller riktig USB berördes.

TASK 006W är inte klar. Nästa minsta steg är säker återhämtning av en bevarad
avprickningskö när arbetsbehörigheten inte längre kan användas, med ADR före
ny auktoriserad skrivväg. Inga frågor behöver användaren besvara i detta steg.

## TASK 006W: återhämtningsmanifest och databasgrund, 2026-09-05

ADR-0055 skrevs före implementation. Ett separat recovery-grant ska endast
omfatta ett exakt fryst intervall av ursprungliga operationer; det förlänger
inte gammal credential och ändrar inte device/actor. Nu finns strikt manifest-
och tokenkontrakt samt privat manifestnedladdning från upplåst mobilkö.
Exporten innehåller endast scope/ID/sekvens/hash, stänger skrivläge och ändrar
varken kö eller krypterat arkiv. Tom eller låst kö avvisas.

Migration 0034 och Drizzle-schema ger immutable grant/items/revocation/delivery,
högst en timmes giltighet och separata composite-FK mot exakt grantitem och
originaloperation. Canonical manifest sparas som text, inte normaliserad JSONB.
Rollback är avstängd återhämtningsväg och bevarad historik, inte tabellradering.
Terra Medium levererade avgränsat kontrakt respektive schemasubstrat; huvudagenten
integrerade mobilens export och verifierade båda FK-grindarna oberoende så att
unikhetsfel inte kan maskera felaktig hashbindning i testet.

Exakta kontroller:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 201 filer / 1 323 tester; worker använder fortsatt
  explicit passWithNoTests.
- `CI=true pnpm build`: exit 0, inklusive offline-appskal och Next.js 16.3.3.
- Slutlig application-lint/typecheck efter det extra FK-provet: båda exit 0.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema pnpm test:integration`:
  exit 0, 10 filer / 181 tester på 11,07 sekunder, riktig PostgreSQL 17 och
  migration 0034. Recovery-schema står för 4 tester.
- Vault-browserprov: exit 0, 8/8 på 3,0 sekunder; riktig IndexedDB/Web Crypto.
- Shell-browserprov: exit 0, 3/3 på 5,0 sekunder, inklusive faktisk privat
  manifestnedladdning och oförändrad pending-kö. HTTP-underlaget är simulerat.
- E2E-specifika typecheck/lint för vault och shell: slutligt exit 0. En första
  shell-lint underkände en onödig typassertion i testet; den togs bort och
  omkörningen passerade. Agents pnpm-wrapper fick tidigare registry/installfel;
  deras lokala tsc/eslint/vitest-kontroller passerade, och rootkommandona ovan
  gick därefter med pnpm.

Återhämtning är ännu inte aktiverad: issuer/revoker, gemensam auktoriserad
transaktionsskrivare, HTTP-route och browserns tokenflöde återstår. Endast
den nya isolerade databasen migrerades; privata tävlingen/nyckeln berördes inte.
Fullt återhämtnings-E2E, explicit konfliktgranskning, auto-online-kapplöpningar,
fysisk mobil och produktionsuppgradering är kvarstående obevisade delar.
Inga nya antaganden om DNS, officiell starttid eller återkomst infördes.
Ingen stafett, GPS, karta, Eventortrafik eller riktig USB påbörjades.

Nästa minsta steg är betrodd utfärdning/spärrning av ett manifestbundet
recovery-grant med PostgreSQL-prov, utan att ännu öppna ny HTTP-skrivväg.
TASK 006W och det aktiva målet är fortsatt pågående; ingen användarfråga behövs.

## TASK 006W: betrodd återhämtningsutfärdare och spärrning, 2026-09-05

Föregående målvarv var konkret framsteg (manifest, schema och verifiering).
Nästa byggsten är nu implementerad enligt ADR-0055 utan ny HTTP-auktoritet:
issueCheckinRecoveryGrant och revokeCheckinRecoveryGrant samt privat server-CLI.
Utfärdning kräver redan utgången/spärrad originalcredential, exakt permanent
device/race/actor/capability, korrekt befintligt överlapp och nästa saknade
serversekvens. Allt manifestinnehåll fryses; läsningar och inserts är begränsade.
Den separata hemligheten lagras endast som SHA-256 och servicebufferten töms.
Grant/items/audit committar tillsammans. Spärrning använder grant UPDATE-lås
och samma-intent-retry; annan operatör/orsak skriver inte om historiken.

CLI tar manifest via storleksbegränsad privat stdin, token via omdirigerad
stdout, inga hemligheter i argument. Feltexten läcker inte input/SQL-värden.
Fyra inläsningsprov inkluderar full 20 000-posters manifest, extra fält,
överstor indata, ogiltig UTF-8 och datum. Driftnoten finns i
docs/checkin-recovery-operations.md. Terra Medium gjorde avgränsad service och
grundprov; huvudagenten gjorde CLI, inputvalidering, riktade negativa tester,
maxstorleksprov, verkligt CLI/PG-prov och integration.

Verifiering:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 202 filer / 1 327 tester; application 22/95.
- `CI=true pnpm build`: exit 0.
- `node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json`: exit 0.
- Slutlig riktad ESLint för CLI och grantproven samt application-tsc efter
  de sista testtilläggen: exit 0.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema pnpm test:integration`:
  exit 0, 12 filer / 189 tester på 11,78 sekunder. Grantservice 7 tester,
  faktisk CLI 1 test, migrationssubstrat 4 tester.

Det verkliga CLI-provet utfärdar med privat pipe, verifierar hash-only lagring,
spärrar två gånger utan dubblering och avvisar ändrad spärrningsavsikt. Maxprovet
skriver exakt 20 000 manifestitems i PostgreSQL utan parametergränsfel. Separata
negativa prov isolerar ändrad hash, giltigt formad sekvenslucka och främmande
request-id och bevisar att inga grant skapas. Browserkoden ändrades inte;
föregående 8 vault- och 3 shellprov återanvänds, inte påstått omkörda här.

Återstående antaganden/bevis: betrodd driftoperatör måste verifiera ursprunget,
förvara privata filer säkert och välja rätt databas. HTTP-leverans, tokenflöde
i mobil, explicit konfliktgranskning och fysiska fältprov saknas fortfarande.
Granten är ännu oanvändbara för synk; originalkön får aldrig tas bort på grund
av utfärdning. Isolerad loopback-PG är kvar för nästa integrationssteg.
Ingen privat tävling, produktionsnyckel, Eventortrafik, GPS, stafett eller riktig
USB berördes. TASK 006W är fortsatt pågående.

Nästa minsta vertikala steg är recovery-leverans genom samma interna
transaktionsskrivare som vanlig avprickningssynk, med giltighets-/spärrgrind,
exakt medlemskap och atomisk delivery/audit. Inga frågor kräver användaren nu.

## TASK 006W: manifestbunden serverleverans, 2026-09-05

Föregående målvarv var framsteg: betrodd utfärdning/spärrning blev implementerad
och verifierad. Recovery-leverans är nu implementerad enligt ADR-0055.
Ordinarie avprickningssynk och recovery använder samma interna transaktions-
skrivare. Ingen resultat-, DNS-, roster-, beroende- eller återkomstregel har
flyttats till route eller duplicerats. Originaloperation och operationsaudit
behåller den gamla aktören. Separat delivery/audit binder återhämtningsgrantet.

Token har canonical base64url-kontroll och timing-safe hashjämförelse.
Autentisering sker före body och igen under grant SHARE-lås. Canonical manifest,
hash, scope och exakt item kontrolleras före gemensamma race/request/device/
entry-lås. Ny operation, eventuell DNS, delivery och audit committar tillsammans.
Exakt retry returnerar originalkvittensen utan ny delivery/audit. En spärrad
ursprungscredential förblir obehörig i vanlig synk.

Separat POST-route använder bearer + strikt same-origin, ingen cookieauktoritet,
JSON max 4 KiB, no-store och generiska fel. Terra Medium gjorde den avgränsade
HTTP-wrappern och 13 routeprov; huvudagenten gjorde gemensam skrivare,
recovery-auktorisering, auditkoppling och riktiga PostgreSQL-prov.

Verifiering:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 203 filer / 1 340 tester; web 98/488.
- `CI=true pnpm build`: exit 0, inklusive nya recovery-routen.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema pnpm test:integration`:
  exit 0, 13 filer / 197 tester på 29,98 sekunder. Recovery-leverans 8 tester.
- Riktade recovery/ordinary-sync PG-prov före utökningen: 16/16, exit 0;
  därefter recovery inklusive låsordningar 8/8, exit 0.
- Agentens 13 routeprov, riktad ESLint och web-tsc: exit 0 via lokala binärer
  efter att pnpm-wrappern försökte göra registry/install och avbröt utan TTY.
  Root-pnpm ovan passerade senare.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema pnpm exec playwright test tests/e2e/task-006w-checkin.spec.ts`:
  exit 0, 1/1 på 14,7 sekunder. Befintlig offlineavprickning, verkligt tappat
  HTTP-svar, retry, DNS-rättning och sen negativ rapport är åter verifierade
  efter delad skrivare. Detta är inte mobilens ännu saknade recovery-UI-prov.

PG-proven verifierar parallella exakta retries, redan committad ordinarie
kvittens, auth före body, felaktiga/canonical-alias-token, rehashad eller olistad
operation, scopefel, spärrning/utgång efter body, sen negativ rapport samt
beroendekonflikt. Två riktiga låsprov bekräftar via pg_stat_activity att leverans
väntar på spärrningslåset respektive att spärrning väntar på redan auktoriserad
leverans. Framtvingat recovery-auditfel rullar tillbaka operation, revision,
DNS och delivery; efter borttagen testtrigger lyckas exakt retry.

Återstår: mobilens explicita tokenflöde med durabel kvittens, fullt recovery-
browser/HTTP/PG-prov, explicit konfliktgranskning, auto-online-kapplöpningar och
fysisk mobil/fältbruk. Målvarvet har inte ändrat privat tävling, Eventor-nyckel,
GPS, stafett, karta eller riktig USB. Loopback-PG är kvar för nästa steg.
Nästa minsta vertikala steg är att koppla upplåst bevarad kö till recovery-routen
med token endast i minnet och samma lokala kvittensgrind. TASK 006W är inte klar.

## TASK 006W: mobilens återhämtningsflöde, 2026-09-05

Föregående varv var framsteg: serverleverans och gemensam domänskrivare blev
verifierade. Mobilens explicita återhämtningsformulär är nu kopplat. Tokenfält
töms vid submit/låsning; token finns endast i försökets minne och skickas i
Authorization med credentials:omit, aldrig cookie, URL, IDB eller cache.
Skrivläge och automatisk synk stängs av. Återhämtningsförsök hämtar inte roster,
registrerar inte enhet och förlänger inte gammal arbetsbehörighet.

Transporten delar fryst requestvalidering, 15-sekunders timeout för hela svaret,
abort, exact-receipt-grind och lokal CAS-commit med vanlig synk. Nästa post
skickas först efter lokalt sparad kvittens. Lock avbryter nätförsök och släpper
nyckel; ett sent svar får inte återöppna listan eller kvittera efter låsning.
Efter upplåsning kan samma giltiga token användas för exakt retry. Delvis
kvitterad eller konfliktfylld kö bevaras, inget intent ombaseras.

Terra Medium gjorde avgränsad delad transport och fyra nya prov (19 totalt);
huvudagenten gjorde controller/formulär, texter och verkligt browser/HTTP/PG-prov.
Visuell kontroll vid 390 px visade att hjälpfunktionerna låg före deltagarna;
de flyttades under avprickningslistan. Slutlayout granskades i
test-results/task-006w-checkin-TASK006W-56266-h-privat-retry-efter-reload/recovery-complete.png.
Detta är en tillfällig testartefakt, inte beständig produktionsexport.

Verifiering:

- `CI=true pnpm lint`: exit 0; slutlig `CI=true pnpm --filter @o-tid/web lint`
  efter layoutändring: exit 0.
- `CI=true pnpm typecheck`: exit 0; slutligt build inkluderar TypeScript även
  efter layoutändringen.
- `CI=true pnpm test`: exit 0, 203 filer / 1 344 tester; web 98/492.
- `CI=true pnpm build`: exit 0, även slutlig omkörning efter layoutändring.
- E2E-specifik tsc/ESLint för tests/e2e/tsconfig.checkin.json: exit 0.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_recovery_schema pnpm exec playwright test tests/e2e/task-006w-checkin.spec.ts`:
  slutligt exit 0, 2/2 på 15,0 sekunder. Tidigare körning innan låsprovet 2/2
  på 16,1 s; med låsprovet före layoutändring 2/2 på 34,1 s.
- Föregående fulla PostgreSQL-svit, 13 filer / 197 tester, återanvänds för
  oförändrad server/databas. Ovanstående browserprov är ny integration genom
  samma riktiga HTTP/PG-väg, inte simulerade serversvar.

Recovery-browserprovet köar två lokala intents offline, laddar om och exporterar
manifest. Originalcredential spärras och vanlig synk nekas utan operationer.
Fel recovery-secret nekas med oförändrad kö. Första riktiga POST committar men
svaret tappas. Efter offline-reload är båda posterna kvar lokalt och tokenfältet
tomt. Nästa exakta retry hålls efter serverns svar; UI låses innan svaret släpps,
listan förblir dold och ingen lokal kvittens tillkommer. Efter upplåsning och
nytt uttryckligt försök skickas exakt samma bytes igen följt av post två.
PG har exakt två operationer/två deliveries/en DNS-decision; lokal kö har noll
pending och är fortsatt krypterat bevarad över lås/upplåsning. Browserns IDB,
Web Storage och appcache inspekteras och innehåller inte plaintext-token,
arbetscredential, lösenfras eller syntetiskt deltagarnamn. Gamla rosterunderlaget
uppdateras inte, vilket UI uttryckligen meddelar.

Kvarstående antaganden/prov: operatören måste skydda mobil/lösenfras/token och
arrangören verifiera rätt kö. Fysisk mobil, lagringsutrymning och produktionens
behörighetsutdelning är inte fältverifierade. Explicit konfliktgranskning och
ytterligare auto-online-kapplöpningar återstår. Ingen privat tävling, Eventor-
nyckel, karta, GPS, stafett eller riktig USB berördes. Isolerad PG behålls.

Nästa minsta vertikala steg är spårbar konfliktgranskning för målpersonal,
med ADR före nytt granskningsbeslut och utan att radera gamla rapporter eller
automatiskt ersätta återkomst. TASK 006W och målet är fortsatt pågående.

## TASK 006W: granskningsbeslut och ren planering, 2026-09-05

Föregående varv var verifierat framsteg (mobilens återhämtning). Nästa lucka
är historiska CONFLICT-rapporter som hittills håller rosterkonflikten öppen
för alltid. ADR-0056 dokumenterades före implementation och beslutar om
explicit online KEEP_CURRENT_STATE för exakt granskat set. Det är separat
från målkorrektion/resultatbeslut och ändrar aldrig originaloperation/kvittens.
FINISH_FOREST_WATCH är den avsedda behörigheten; ingen recovery-utökning.

Ren planStartCheckinConflictReview finns nu och återanvänder forest-watch-
regeln. Den avvisar stale hash/set, dubbletter, osorterade/överstora set och
fel scope. Aktuell motsägelse mellan start/DNS/återkomst får inte döljas av
granskning. STARTED_NO_RETURN och UNCONFIRMED kräver fortsatt uppföljning även
när rapporterna har granskats. Inga fakta eller inputobjekt muteras.
Ingen journal/API/UI-granskning är ännu aktiverad.

Exakta resultat:

- Riktat domänprov: exit 0, 1 fil / 9 tester; domain-tsc och riktad ESLint exit 0.
- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 204 filer / 1 353 tester.
- `CI=true pnpm build`: exit 0.
- Inga databas-/browserprov kördes om för denna ännu okopplade rena planering.
  Senaste faktiska bevis är 197 PG-tester och 2 browser/HTTP/PG-prov från ovan;
  de bevisar inte den kommande granskningsjournalen.

ADR beskriver additiv immutable review-header/items/audit, entrylås och exakt
sourceHash, samt opt-in reviewDetails=1 för rosterkompatibilitet. Dessa delar
återstår tillsammans med målpersonalens granskningsvy och fulla race-/E2E-prov.
Fysiskt fältbruk och reservrutiner är fortsatt antaganden, inte testade garantier.
Privata tävlingen/nyckeln, karta, GPS, stafett och riktig USB är orörda.

Nästa minsta steg är granskningskontrakt och additiv journal med PostgreSQL-
verifiering, därefter auktoriserad tjänst och operativ vy enligt samma ADR.
Målet är aktivt och TASK 006W inte klar; inga användarfrågor blockerar arbetet.

## TASK 006W: granskningskontrakt och immutable journal, 2026-09-05

Föregående varv var framsteg med ADR-0056 och ren planering. Nu finns strikta
source/candidate/request/response-kontrakt, canonical serialisering och fem
kontraktstester. Källobjekt binder aktuell operativ/resultatgrund och exakt
ursprungsoperation/konfliktkvittens; lästid/hash ligger utanför canonical source.
Request kräver sorterade unika 1–1 000 id, KEEP_CURRENT_STATE och orsak.
ADR förtydligar 64 KiB endast för kommande gransknings-POST; vanlig synk/recovery
behåller 4 KiB. Ingen serverroute har ändrats i detta steg.

Migration 0035/Drizzle ger immutable granskningsheader/items. Header binder
FINISH_FOREST_WATCH-aktör i samma race, entry, request, sourceHash, canonical
intent/hash, orsak och tid. Item har egen primary key på originalrequest,
scope-FK till header och exakt scope/hash/effect-FK till CONFLICT-operation.
APPLIED och UNCHANGED kan inte granskas. Originalrapporter/kvittenser förblir
orörda och rollback ska bevara all historik. Ingen auktoriserad granskning är
ännu kopplad till dessa tabeller.

Terra Medium hann skriva delar av schema/journal men stoppades av modellens
kapacitetsgräns. Huvudagenten inspekterade filerna, tog över utan modellbyte,
färdigställde SQL/restore-not och skrev samtliga nya schema-PG-prov. Ny isolerad
databas otid_006w_review_schema skapades; hela migrationskedjan verifierades där.
Inget i privata tävlingen eller tidigare testdatabaser migrerades i detta steg.

Exakta resultat:

- Riktade kontrakt: 1 fil / 5 tester, exit 0; kontrakt-tsc och riktad ESLint exit 0.
- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 205 filer / 1 358 tester.
- `CI=true pnpm build`: exit 0.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema pnpm test:integration`:
  exit 0, 14 filer / 201 tester på 29,82 sekunder; nya granskningsschemat 4 tester.

PG-proven isolerar fel hash, APPLIED/UNCHANGED, fel header-/aktörscope, annan
capability, fel intentform, dublettrequest och redan granskad operation. FK-fel
kontrolleras med exakt constraintnamn så unikhetsfel inte maskerar bristande
scope/hash-skydd. Update/delete av båda journaltyperna avvisas; framtvingat sent
transaktionsfel lämnar ingen halv header. Ursprunglig konflikt och hash bevaras.
Inga browserprov kördes om: dessa kontrakt/tabeller är ännu inte UI-kopplade.

Återstår: auktoriserad underlagsläsning och atomiskt granskningsbeslut, filtrering
av olösta rapporter i roster/skogsvy, opt-in reviewDetails för äldre klienter,
gransknings-UI och race-/browserprov. Fysisk mobil och produktionsrutiner är
fortfarande obevisade antaganden. Ingen privat API-nyckel, Eventortrafik, GPS,
stafett, karta eller riktig USB berördes. Isolerad PG är kvar för nästa steg.

Nästa minsta vertikala steg är målpersonalens autentiserade granskningsunderlag
och beslut med exakt retry och sourceHash-/entrylåsgrind, enligt ADR-0056.
TASK 006W och det aktiva målet är fortsatt pågående.

## TASK 006W: auktoriserad granskningstjänst, 2026-09-05

Föregående varv var framsteg (kontrakt och journal). Nu finns application-
tjänster för målpersonalens privata granskningsunderlag och atomiska beslut.
Den befintliga rosterprojektionen har en gemensam intern läsare; autentisering
ligger fortsatt före läsning och skyddade läsningar använder repeatable read.
Beslut kräver FINISH_FOREST_WATCH och CSRF före body samt återkontroll under
authlås, race SHARE, request-advisory och entry UPDATE. Samma source-objekt
räknas vid preview och sparande. Stale fakta eller rapportset ger konflikt.

Immutable header/items/audit sparas atomiskt, med full privat source i audit
för framtida begriplighet efter namn-/klassändringar. Same-request/intent/actor
returnerar exakt tidigare svar före ny grundkontroll; ändrad orsak/aktör
avvisas. Roster verifierar canonical header/hash och exakt medlemskap mot
original-CONFLICT-operationer innan flaggan för olösta rapporter tas bort.
Den rena forest-watch-regeln behåller aktuella motsägelser och uppföljningsbehov.
Ingen operation, kvittens, startrevision eller resultatrevision ändras.

Exakta resultat:

- `CI=true pnpm lint`: exit 0; slutlig application-lint efter sista tillägg exit 0.
- `CI=true pnpm typecheck`: exit 0; slutlig application-tsc efter sista prov exit 0.
- `CI=true pnpm test`: exit 0, 205 filer / 1 358 tester (inga nya enhetstestfiler).
- `CI=true pnpm build`: exit 0, även slutlig omkörning efter fryst auditunderlag.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema pnpm test:integration`:
  slutligt exit 0, 15 filer / 207 tester på 18,15 sekunder. Granskningstjänsten
  står för 6 tester. Första fulla körningen före sista tilläggen: 206/206.
- Tidig riktad tsc hittade att den interna läsaren typats som Database|Transaction
  trots att resultatprojektionen kräver en transaktion. Signaturen snävades in;
  slutliga kontroller ovan passerar. Tidigt riktat PG-prov: 5/5, senare utökat.

PG-proven visar att granskning av startad utan återkomst tar bort rapportflaggan
men behåller STARTED_NO_RETURN och needsFollowUp. Ny rapport ger ny konflikt;
gammalt exakt retry omfattar inte den nya rapporten. Originaloperationer är
byte-/fältmässigt oförändrade. Läsningstid ändrar inte sourceHash; ändrad
manuell återkomst gör däremot föregående beslut stale. Ny granskning efter
korrektion ger RETURNED. Fel roll/session/CSRF nekas före body. Konkurrerande
beslut ger ett beslut och en konflikt. Ett riktigt entrylåstest kontrollerar
via pg_stat_activity att granskaren väntar på ny rapport och sedan nekar det
gamla underlaget. Auditfel rullar tillbaka header/items och exakt retry fungerar
efter borttagen testtrigger. Auditens frysta source återhashas till requesthash.

Återstår: privata HTTP-routes, målpersonalens granskningsvy, opt-in reviewDetails
för mobilroster och browser/HTTP/PG-prov av hela granskningen. Inga browserprov
kördes om innan gränssnittskopplingen. Fysisk mobil/produktion är fortfarande
obevisade antaganden. Endast isolerad otid_006w_review_schema användes; privat
tävling, Eventor-nyckel, GPS, stafett, karta och riktig USB är orörda.

Nästa minsta vertikala steg är HTTP och målpersonalens explicita granskningsvy,
med synligt underlag/orsak och samma frysta retry utan lokal offlinegranskning.
TASK 006W och målet är fortsatt aktiva; inga användarfrågor blockerar arbetet.

## TASK 006W: privat HTTP och granskningspanel, 2026-09-05

ADR-0056:s granskning kan nu användas i målpersonalens kvar-i-skogen-vy.
Separata GET/POST-routes använder målrollens session och skriv-CSRF, privat
no-store, scope-/kontraktsvalidering samt 64 KiB-gräns för granskningsbeslut.
Application kontrollerar behörighet före body. Routes innehåller ingen
resultatlogik. HTTP-delen levererades av avgränsad Terra Medium-agent;
huvudagenten integrerade klient, svensk panel och browserprov.

Panelen visar aktuellt registrerat start-/återkomst-/DNS-underlag och varje
ogranskad originalrapport med enhet, avsikt, tider och konfliktorsak. Orsak och
explicit bekräftelse krävs. Okänt commitsvar fryser samma request-id/intent för
manuellt retry; ingen offlinekö eller Web Storage tillkommer. Ändrat underlag
kräver ny läsning/granskning. Authfel och föräldervyns utloggning/expiry döljer
panelen; unmount avbryter pågående anrop. Panelen skrivs inte ut. Listans
uppföljningsregler och originaloperationer/kvittensen är oförändrade.

Exakta resultat efter integration:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 207 filer / 1 370 tester.
- `CI=true pnpm build`: exit 0.
- Direkt `vitest run` för ny klient och HTTP-handlers: exit 0, 2 filer / 12 tester.
- Direkt web-tsc och riktad eslint: slutligt exit 0. Första klienttest-lint
  hittade två unsafe-member-access i mockkontroll; typade RequestInit löste dem.
- `node_modules/.bin/tsc --noEmit -p tests/e2e/tsconfig.forest-watch.json`:
  exit 0; eslint av browserprovet med samma projekt: exit 0.
- `CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema node_modules/.bin/playwright test tests/e2e/task-006w-forest-watch.spec.ts`:
  exit 0, 1/1 utökat browserprov på 14,6 sekunder.

Browserprovet använder verklig HTTP/PG: ytterligare rapport gör gammal preview
stale utan granskningsrecord; ny explicit granskning committas, HTTP-svaret
tappas avsiktligt, byteidentiskt retry ger samma enda record. Deltagaren
behåller STARTED_NO_RETURN och originaloperationerna jämförs oförändrade.
Privat utskrift, mobilbredd, filter, offlinevarning och authdöljning passerar
fortsatt. Klienttesterna täcker fel scope/kvittens, preflight, privata generiska
fel, timeout under bodyläsning och avbrutet sent svar. Föregående fulla PG-svit
15 filer / 207 tester återanvänds: ingen application/domän/schema ändrades.
Agentens pnpm-wrapper försökte installera om dependencies och blockerades;
direkta lokala binärer passerade, liksom huvudagentens fulla pnpm-körningar.

Kvarvarande antaganden: fysisk mobil, browserlagrets uthållighet i fält och
produktionsrutiner är inte fältverifierade. Mobilroster saknar ännu opt-in
reviewDetails och lokal visning av granskad historik. Separata auto-online-
kapplöpningsprov och slutlig TASK-acceptanskontroll återstår. Den privata
tävlingen, Eventor-nyckeln, GPS, stafett, kartor och riktig USB är orörda.

Nästa minsta vertikala steg: överför validerade gransknings-id via opt-in roster
till mobilens krypterade underlag, utan att skriva om historiska kvittenser.
TASK 006W och målet är fortsatt aktiva; inga frågor kräver användarens hjälp.

## TASK 006W: granskad historik i mobilroster, 2026-09-05

Föregående varv gav verifierad HTTP/granskningspanel. Detta steg kopplar
ADR-0056:s reviewDetails=1 från mobilklient genom skyddad roster-route till
journalvaliderad application-projektion. Standardroster saknar fortsatt nya
fält. Strikt kontrakt accepterar äldre roster och valfria, sorterade unika
reviewedConflictRequestIds; duplicering mellan entries och fler än 100 000
review-id i hela loppet avvisas. Inga nya tabeller, beroenden eller teknikval.

Krypterad lokal roster bevarar fältet med befintlig IDB-commit/validering.
Mobilvyn skiljer ogranskade konflikter från granskad originalhistorik; gamla
CONFLICT-kvittenser ändras aldrig och återspelas inte som lyckade markeringar.
Pending-intents ombaseras inte. Recovery har fortsatt ingen rosterbehörighet.

Exakta resultat:

- `CI=true pnpm lint`: exit 0, även slutlig omkörning.
- `CI=true pnpm typecheck`: exit 0; slutlig build inkluderar senare kontraktstillägg.
- `CI=true pnpm test`: slutligt exit 0, 207 filer / 1 373 tester.
- `CI=true pnpm build`: exit 0.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema pnpm test:integration`:
  exit 0, 15 filer / 207 tester på 14,16 sekunder. Utökat granskningsprov
  bevisar standardfältets frånvaro, exakt opt-in-set och ny sen konflikt.
- Med både DATABASE_URL och TEST_DATABASE_URL till samma isolerade DB:
  `CI=true node_modules/.bin/playwright test tests/e2e/task-006w-checkin.spec.ts`:
  exit 0, 2/2 på 20,7 sekunder. Målpersonal granskar genom riktig HTTP-panel;
  mobilens gamla underlag visar fortsatt konflikt tills autentiserad synk.
  Därefter överlever granskad status offline reload; originaloperationerna
  jämförs oförändrade. Spärrad credentials recoveryprov passerar fortsatt.
- `CI=true node_modules/.bin/playwright test --config tests/e2e/playwright.checkin-shell.config.ts`:
  exit 0, 3/3 på 6,2 sekunder, inklusive äldre roster utan granskningsfält.
- Direkt tsc för både tsconfig.checkin.json och tsconfig.checkin-shell.json:
  exit 0; eslint av båda ändrade browserfiler med respektive projekt: exit 0.

Kvarvarande antaganden: fysisk mobil/browserlagrets uthållighet och
produktionsrutiner är inte fältverifierade. Syntetisk isolerad PostgreSQL
användes; privat tävling, Eventor-nyckel, GPS, stafett, karta och riktig USB
är orörda. Ingen användarfråga blockerar arbetet.

Nästa minsta vertikala steg är auto-online-synkens lås-/återanslutningsprov,
följt av kontroll mot TASK 006W:s samtliga acceptanspunkter. Målet är aktivt.

## TASK 006W: slutacceptans och säker lokal rensning, 2026-09-05

Föregående varv var verifierat framsteg. Auto-online-provet är nu utökat med
upprepade nät-events, ett verkligt committat men fördröjt HTTP-svar och lokal
låsning. Ett enda försök pågår; sent svar återvisar inte listan eller kvitterar
lokalt. Upplåsning aktiverar inte auto-synk. Manuellt retry är byteidentiskt och
skapar ingen dubblett; en ny sen negativ rapport förblir ogranskad konflikt.

Den avgränsade Terra Medium-auditen och huvudagentens kontroll fann en sista
lucka mot ADR-0049/0053: rensning fanns bara i lagrings-API. Mobilen har nu
separat formulär med uttryckligt samtycke. Version/CAS och durabelt lagrat
underlag nekar pending eller ogranskad konflikt; redan granskad lokal
konflikthistorik kan rensas utan att dess kvittens skrivs om före rensning.
Lokal låsning är fortfarande inte radering. Inga riktiga persondata rensades;
browserproven tog enbart bort sina egna syntetiska vaults. Serverhistoriken
bevaras, lokal radering kan inte ångras och detta visas i UI.

Slutliga exakta resultat:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0, efter produktionsändringarna för rensning.
- `CI=true pnpm test`: exit 0, 207 filer / 1 373 tester.
- `CI=true pnpm build`: exit 0, efter sista produktionsändringarna.
- Direkt tsc för checkin-/vault-browserprojekten samt eslint av de två
  ändrade browserfilerna med respektive projekt: exit 0.
- Med DATABASE_URL och TEST_DATABASE_URL till isolerad
  `otid_006w_review_schema`: `CI=true node_modules/.bin/playwright test tests/e2e/task-006w-checkin.spec.ts`:
  slutligt exit 0, 2/2 på 22,1 sekunder. Auto-online-provet före rensning:
  exit 0, 2/2 på 19,3 sekunder.
- `CI=true node_modules/.bin/playwright test --config tests/e2e/playwright.vault.config.ts`:
  exit 0, 9/9 på 2,8 sekunder. Nytt prov nekar ogranskad konflikt, bevarar
  originalkvittens när roster uppdateras och tillåter därefter explicit rensning.
- Återanvänd relevant senaste evidens för oförändrade delar: full PG-svit
  15 filer / 207 tester, shell 3/3 och forest-watch 1/1, samtliga exit 0.
  Ingen ny Android-/USB-/GPS-verifiering kördes: dessa ligger utanför snittet.

TASK 006W:s åtta acceptanspunkter och kompletterande ADR-krav är nu mappade
mot implementation och körda prov i `docs/task-006w-acceptance.md`. Inga kända
implementationskrav återstår i detta snitt. Det är inte ett påstående om
produktionsdriftsättning, fysisk hårdvara eller att skogen säkert är tom.

Kvarstående antaganden: fysisk mobil i regn/handskar/energisparläge, browserns
lagringsuthållighet, enhets-/passfrasförlust och produktionens drift/restore är
inte fältverifierade. Privat tävling och dess DB/migrationsläge är orörda,
ingen Eventor-nyckel användes och ingen stafett, GPS, kartvisning eller riktig
USB tillkom. Lint/typecheck/test/build-loggar finns under
`/private/tmp/otid-006w-final-*` respektive `otid-006w-cleanup-*`.

Föreslagen enda nästa minsta vertikala uppgift: fältprov med två fysiska
mobiler och syntetisk tävling genom offline–synk–mål–utskrift. Det kräver
användarens medverkan senare och har inte startats inom detta snitt.

## Fortsatt huvudmål: lokal provbar demo, 2026-09-06

Nytt aktivt mål är att fortsätta mot huvudmålet med tidigare agentupplägg,
inte att återöppna TASK 006W. Användaren efterfrågade var programmet kan provas.
En Terra Medium-agent gjorde avgränsad read-only-inventering av V1-gap medan
huvudagenten startade en isolerad demo. Inga extra agenter eller modellbyten.

PostgreSQL-testklustret visade sig redan köra när kontrollen gjordes med korrekt
lokal åtkomst. Ett första pg_ctl-startförsök avvisades på befintligt processlås;
inget lås togs bort och processen startades inte om. pg_ctl status och pg_isready
bekräftade därefter befintlig server. Databasen otid_demo_20260906 verifierades
saknas, skapades separat och migrerades med repositoryts migrator. Befintlig
syntetisk seed kördes: exit 0, snapshot 3. Privat tävlingsdatabas orörd.

Tre 8h-credentials för VIEW_RACE_OVERVIEW/START_CHECKIN/FINISH_FOREST_WATCH
utfärdades bara för demotävlingen. Privat fil har mode 0600 i mktemp-katalog;
inga tokens loggades eller sattes i URL. Devserver startades på 127.0.0.1:3000
med enbart demodatabasen och befintlig loopback-simulatorpolicy. Startsidan
verifierades visa seedtävlingen; simulator och offline-appskal gav HTTP 200.
Simulatorn begärdes öppnad i appen (UI svarade queued). Lokala startinstruktioner
och tydliga begränsningar finns i docs/local-demo-20260906.md.

Detta var provisionering och dokumentation, ingen ändring av produktionskod.
Lint/typecheck/test/build kördes därför inte om; tidigare TASK006W-resultat är
inte nya tester av demon. Tillgänglighetskontrollen påstår inte ett komplett
genomkört tävlingsflöde. Ingen riktig Eventor-nyckel eller hårdvara användes.

Inventeringen bekräftar att huvudmålet inte är klart: direkt SPORTident-
resultatväg är fortsatt spärrad av dokumenterad specifikations-/fixturegrind;
speaker, dokument/kartsläpp och komplett arkiv återstår, liksom fysisk drift.
Nästa minsta mjukvarusteg beskrivs i TASK_007_ISOLATED_DEMO_PROVISIONING.md:
reproducerbar testprovisionering med explicit isoleringsgrind och atomisk,
privat credentialhantering. Säkerhetsbeslut ska ADR-dokumenteras före kod.
Huvudmålet förblir aktivt, inte reducerat till den nu startade demon.

## TASK 007: målgrind och atomisk applikationsprovisionering, 2026-09-06

Föregående varv gav en verkligt tillgänglig isolerad demo. Detta varv skapade
ADR-0057 före kod och fortsatte med återanvändbar provisionering. Terra Medium
ägde enbart ren targetpolicy och dess tester; huvudagenten integrerade strikt
raw-path-kontroll (även tom query/hash och URL-normalisering avvisas), den
atomiska application-tjänsten och PostgreSQL-proven.

Policy kräver exakt explicit demobekräftelse, development/test, loopback och
explicit port samt otid_demo_-namn. Faktiskt current_database jämförs under
transaktion, alla O-Tid-tabeller låses i stabil ordning och måste vara tomma.
Nytt slumpat event/lopp, fasta syntetiska fixtures och tre 1h-roller skapas
atomiskt. Befintlig IOF-import och credentialutfärdning accepterar nu även
överordnad transaktion; deras befintliga writes använder savepoints.
Application returnerar en hemlighetsfri sammanfattning. Privat sink får köras
före commit; ett sinkfel rullar tillbaka hela databasskrivningen. CLI och
säker outputfil är ännu inte implementerade och verktyget är inte färdigt.

Exakta resultat:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 208 filer / 1 375 tester.
- `CI=true pnpm build`: exit 0.
- Direkt application-tsc och riktad eslint: exit 0.
- Riktat `vitest run packages/application/test/integration/task-007-demo.test.ts`
  med isolerad TEST_DATABASE_URL: exit 0, 4/4 på 3,01 sekunder.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema pnpm test:integration`:
  exit 0, 16 filer / 211 tester på 18,55 sekunder. Full körning motiveras av
  de två återanvända transaktionssignaturerna, inklusive befintlig import/auth.

PG-proven skapar egna slumpnamngivna otid_demo_spec_-databaser och städar
bara dessa efter avslut. De tillfälliga syntetiska databaserna togs bort;
innehållet kan återskapas av samma fixtures/tester. Ingen privat eller manuellt
startad demodatabas raderades. Proven visar targetavslag, icke-tomt avslag,
rollback efter sen outputfailure, endast en vinnare vid konkurrens, ingen
hemlighet i summary/audit och tydligt avslag på omkörning. De nya testen
kräver CREATEDB för testrollen; provisioneringsverktyget ska inte göra det.

Arkitekturdokumentets äldre implementationsstatus för 006W-gransknings-UI
uppdaterades till den redan verifierade faktiska statusen; ingen ändrad
arkitektur infördes där. Agentens pnpm-wrapper kunde inte göra sin föreslagna
ominstallation i sandbox; direkta lokala binärer och huvudagentens fulla
pnpm-körningar passerade.

Återstår inom TASK007: exklusiv privat filadapter/CLI, validerad sammanfattning
med länkar och genomgående browserprov med provisionerade roller. Fysisk
SPORTident, mobilfältprov och övriga V1-gap är oförändrade antaganden. Inga
Eventoranrop gjordes. Nästa minsta steg är privat output/CLI enligt ADR-0057.
Huvudmålet är fortsatt aktivt; det är inte klart genom detta delresultat.

## TASK 007: privat filadapter och betrodd CLI, 2026-09-06

Föregående målvarv var verifierat framsteg. Nu finns demo:provision-scriptet,
strikt argumenttolkning och validerade separata kontrakt för privat installation
och offentlig sammanfattning. Exakt tre kortlivade roller, token-id, race-scope
och 1h-livslängd valideras före privat skrivning. Stdout kan inte innehålla
credentials och dess relativa paths måste matcha lopp-id. Databas-URL läses
endast från miljön, med tidigare målgrind före filreservation/DB-mutation.

En avgränsad Terra Medium-agent implementerade endast privat filadapter och
tester. Huvudagenten integrerade CLI/kontrakt, tog bort agentens alltför vida
undantag för /private/tmp som föräldrakatalog och lade till canonical-path-,
filägar-/hardlinkskydd. En privat ägd underkatalog krävs även där. Existerande
mål/symlänkar nekas; ny fil skapas exklusivt med0600, skrivs en gång och
fsyncas med katalogen. Fel behåller filen och ger generiskt meddelande utan
privata värden. Ingen tvålagrings-atomicitet utlovas vid osäkert commitutfall.

Exakta resultat efter integration:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 211 filer / 1 383 tester.
- `CI=true pnpm build`: exit 0.
- `node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json` och riktad eslint
  av scripts/demo-provision.ts: exit 0.
- Riktade unitprov för fil, argument och kontrakt: exit 0, 3 filer / 8 tester.
- Riktig CLI/PG via `vitest run packages/application/test/integration/task-007-demo.test.ts`
  med tidigare isolerade TEST_DATABASE_URL: exit 0, 5/5 på 3,51 sekunder.
  Childprocessen kör det verkliga scriptet; output har mode0600 och giltiga
  rollkontrakt, sammanfattningen är hemlighetsfri och omkörning ger exit1 utan
  överskrivning eller nytt event. Tidigare fyra rollback/konkurrensprov passerar.
- Föregående fulla PG-svit 16 filer / 211 tester återanvänds för oförändrad
  application-/databaslogik. Ny CLI testades separat; detta är inte ett påstående
  om en ny full PG-körning. Agentens direkta tester/tsc/lint passerade; dess
  pnpm-wrapper blockerades av försök till dependency-sync, inga deps ändrades.

Testet skapade och tog bort endast egna slumpnamngivna syntetiska databaser
och privata temporära kataloger. De kan återskapas via testfixtures. Den
manuella demon, privat tävling, Eventor-nyckel och hardware är orörda.
Operatörsinstruktioner finns i docs/demo-provisioning.md och kommando i AGENTS.

Återstår: genomgående browserprov som använder CLI-provisionerade roller för
simulator → publikresultat och offlineavprickning → målvy. Fysisk mobil,
SPORTident-specifikationsgrind och övriga V1-gap kvarstår. Huvudmålet är aktivt;
nästa minsta steg är detta browserprov, inte fler nya produktfunktioner.

## TASK 007: genomgående browseracceptans, 2026-09-06

Föregående varv gav fungerande CLI/privat output. Nu är hela demokedjan provad
med verklig CLI, separat station-CLI, Next HTTP och PostgreSQL. Testservern
använder port3107 och fast .next-demo-test-katalog endast under explicit
development-testflagga; den manuella demon på port3000 behövde inte stoppas.
Generell Playwright-körning undantar detta prov eftersom det kräver ny tom
otid_demo_-databas. Guard/config och kommandon dokumenteras i ADR-0057/AGENTS.

Provet upptäckte två sakfel i test/guiden och ett verkligt produktfel:

- Simulatorn kräver separat READOUT-token för sitt genererade device-id.
  Befintlig betrodd station-CLI används nu i prov/guiden, utan auth-bypass.
- Första körbara testversionen väntade felaktigt på accepted; riktig kvittens
  var stored. Assertionen korrigerades, servern hade lagrat data korrekt.
- Offline reload från /checkin/index.html#lopp-id misslyckades eftersom worker
  jämförde hela URL:en med resurslistan. Endast fragment tas nu bort före
  matchning; origin/path/query förblir exakta. Både hela flödet och riktat
  shellprov verifierar fixen och att privata API/query/okända resurser nekas.

Slutliga exakta resultat:

- `CI=true pnpm lint`: exit 0.
- `CI=true pnpm typecheck`: exit 0.
- `CI=true pnpm test`: exit 0, 211 filer / 1 383 tester.
- `CI=true pnpm build`: exit 0.
- Direkt tsc/eslint för demo- respektive shell-browserprojekt: exit 0.
- `CI=true OTID_DEMO_TEST_CONFIRM=synthetic-empty-database DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_demo_browser_20260906c TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_demo_browser_20260906c pnpm exec playwright test --config tests/e2e/playwright.demo.config.ts`:
  körd via installerad node_modules/.bin/playwright, exit 0, 1/1 på 13,0 sekunder.
- `CI=true O_TID_DEMO_E2E=1 node_modules/.bin/playwright test --config tests/e2e/playwright.checkin-shell.config.ts`:
  exit 0, 3/3 på 4,8 sekunder. Fragmentlänken reloadas offline, samma tre
  cacheposter kvarstår och query/API/okänd fil avvisas även med fragment.
- Tidiga testkontroller: tsc fann fel rawReadouts-symbol och saknad migrator-
  pathalias; de rättades till rawDeviceMessages och explicit test-tsconfig.
  Första Playwright-collection misslyckades på import.meta/CJS-blandning och
  körde inga tester; testets sökvägar följer nu befintlig resolve-konvention.
  Därefter kom de två ovan beskrivna browserfelen före slutligt grönt prov.

Browserprovet verifierar faktisk publik Godkänd-rad för Ada i oinloggad
kontext och offline-markerad Bo som STARTED_NO_RETURN efter synk. Ada ligger
i RETURNED genom verklig syntetisk readout-källa. Privat utskrift har kvar
osäkerhetsvarning. DB innehåller exakt ett event, två entries, en råpost och
en avprickningsoperation. Tidigare riktade CLI/PG 5/5 och fulla PG 16 filer/
211 tester återanvänds för oförändrad serverlogik; inga nya schemaändringar.

Tre separata syntetiska browserdatabaser a/b/c skapades för felsökning och
slutprov; de har avsiktligt inte raderats eller resetats. Endast testets egna
tillfälliga credentialfiler rensades. Privat tävling, Eventor-nyckel och den
manuella demon är orörda. Befintliga appflikar behöver stängas innan en ny
service worker aktiveras; ingen skipWaiting eller köförlust infördes.

TASK007:s sex acceptanspunkter har nu evidens i taskfilen och
docs/demo-provisioning.md. Detta snitt är klart, huvudmålet är det inte.
Fysisk mobil/SPORTident och produktionsdrift är fortsatt ofältverifierade.
Nästa avgränsade förslag granskas read-only av Terra Medium: privat första
speaker-läsvy på befintligt resultatunderlag. Ingen sådan implementation har
påbörjats innan scope, rollgräns och ADR fastlagts.

## TASK 008: speakerbeslut och kontrakt, 2026-09-06

Föregående målturn gav verifierad lokal HTTP 200 och svar på användarens fråga
om testbarhet; ingen produktionsfärdighet påstods. Huvudmålet är fortsatt öppet.
TASK_008_PRIVATE_SPEAKER_BOARD.md och accepterad ADR-0058 finns nu före bred
implementation. En avgränsad Terra Medium-granskning av arkitektur/kontrakt
gjordes utan filändringar eller externa anrop.

Viktig avgränsning från granskningen: senaste tekniska CARD_READOUT är inte
aktuellt tävlingsresultat under aktivt NT/DSQ/DNF/approval/OOC. Vyn ska välja
senaste publicerade huvud per entry och använda befintlig central resolver.
Den får inte återanvända publicResults som hel funktion eftersom den tar bort
NO_ACTIVE_RESULT. Högst 25 entries och totalt 1 000 manuella/checkin-DNS-beslut
före resolver planeras; overflow ger fel, aldrig trunkerad provenans.

packages/contracts har strikt separat speakerlogin och format-1-projektion,
temporära sammanhängande slots, inga privata individ-ID:n/rådata och separat
NO_ACTIVE_RESULT utan resultatfält. NT/DNS/DNF saknar tid. MP:s tid följer
befintlig strikt evaluation-orsak; ingen ny resultatregel beräknas. raceId
behålls för explicit svarsscope och numeriska revisioner skiljer sen teknik
från äldre aktivt manuellt utfall. raceSnapshotVersion är bara kontext och
får inte användas för att hoppa över uppdateringar.

Verifiering i denna del:

- CI=true pnpm lint: först exit 1, ett oanvänt destrukturerat testvärde;
  rättat och omkört till exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 212 filer / 1 388 tester.
- CI=true pnpm build: exit 0.
- Efter skärpt MP-tidsmatris: contracts lint/typecheck/test/build exit 0,
  41 filer / 244 tester, varav speakerkontraktet 5 tester.

Loggar från fullkörningen: /private/tmp/otid-008-contract-{lint-fixed,typecheck,
test,build}.log. PostgreSQL och browser har inte körts om här eftersom inga
server-, DB- eller UI-vägar har ändrats/skapats; kontrakt är inte bevis på ett
färdigt speakerflöde. Capabilitypolicy/migration 0036, auktoriserad läsare,
HTTP, UI och deras integration/browseracceptans återstår inom TASK008.
Inga verkliga credentials, privat tävlingsdatabas, kartor eller Eventor anropades.
Nästa arbetssteg är just denna skyddade serverläsning, inte en ny funktion.

## TASK 008: auktoriserad serverläsning, 2026-09-06

Föregående målturn var konkret framsteg: accepterad ADR, kontrakt och gröna
kontroller. Nu finns listSpeakerBoardAsAdmin med statiskt VIEW_SPEAKER_BOARD,
normal repeatable-read, authlås före race SHARE, separat senaste-publicerade-
huvudfråga före global tidsordning/limit 25, och central resultatresolution.
Beslutshistorikens sex samlingar begränsas före resolver till totalt 1 000.
Entries/effektiva historiska klasser/banversioner valideras mot samma race.
Endast strikt minimerad DTO returneras. Ingen raw-readout-join eller ny
resultatlogik, publicering eller läsaudit införs.

Terra Medium implementerade endast DB-substrat/migration/restore-not. Main
granskade ändringarna och implementerade application-policy/läsare/PG-prov.
Migration 0036 är körd bara mot isolerade syntetiska testdatabaser genom
testsviten. Den privata tävlingen och manuella demon är inte migrerade.
Agentens första pnpm-försök avbröts före tester med
ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY; main verifierade därefter normalt
med CI=true utan dependencyändring.

Exakta resultat:

- CI=true pnpm lint: exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 212 filer / 1 388 tester.
- CI=true pnpm build: exit 0.
- CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema
  pnpm --filter @o-tid/application test:integration: exit 0,
  17 filer / 215 tester på 30,62 sekunder.
- Nya speakerprov: 3/3; tom/OK/minimerad skrivfri läsning, ingestretry,
  fel race/capability, expiry/revoke, accesslivslängd samt DISTINCT-head före
  yttre ordning/limit inklusive nyare opublicerad revision och UUID-ties.

Loggar: /private/tmp/otid-008-server-{lint,typecheck,test,build,integration}.log.
Hela snittet är inte klart. Speaker-specifika manuella overlay/withdrawalprov,
history-cap 1 000/1 001, authkonkurrens och korrupt/dubbelt underlag återstår,
även om tidigare centrala resultattester är gröna. Betrodd CLI, HTTP/sessions-
cookies, UI och browseracceptans är ännu inte implementerade. Nästa steg är
dessa serveracceptansfall innan browserkopplingen; inget nytt funktionsområde.

### Säkerhetsavvikelse funnen efter grön regression – TASK008 pausad före HTTP

Ett nytt deterministiskt PostgreSQL-prov motbevisar antagandet i ADR-0020 och
ADR-0058 att session/credential SHARE i repeatable read alltid ser en spärr
som vinner låset. Credentialrevocation låser credentialen men skriver endast
en separat append-only revocationrad. Läsarens snapshot kan redan vara taget
av sessionfrågan innan läsaren väntar på credentiallåset. När spärren committar
läser väntaren fortfarande sitt gamla snapshot och returnerar ok.

Reproduktion: blockerconnection tar credential FOR UPDATE, speakerläsning
startas, pg_blocking_pids bekräftar faktisk väntan, blocker inserterar
credentialrevocation och committar. Förväntat unauthorized; faktiskt ok.
Detta är inte en timingbaserad gissning och inte ett produktionsangrepp.
Endast syntetiskt tomt testlopp används.

Senaste testresultat ersätter den tidigare gröna bilden: riktat TASK008
PostgreSQL exit 1, 3 passerade / 1 misslyckat (4 totalt), 1,03 s.
Logg /private/tmp/otid-008-revoke-race.log. Det röda regressionstestet behålls
och är inte skip:at. Tidigare fulla 215/215 omfattade inte detta nya fall.
Ingen speakerrutt/UI är exponerad. Huvudmålet är inte blockerat, men bred
speakerimplementation pausas enligt AGENTS tills lås-/snapshotbeslutet
dokumenteras och rättas med tester för både revoke och logout. Befintliga
repeatable-read-konsumenter av samma helper behöver ingå i analysen; detta
får inte döljas genom en lokal specialregel eller påstått grönt testläge.

## ADR-0059: bevisad RR-spärrlucka rättad, 2026-09-06

Föregående målturn var framsteg: ett deterministiskt rött säkerhetsprov, inte
bara statusrapport. Nu finns accepterad ADR-0059, additiv migration 0037 och
gemensam protected-read-rättning. En mutable härledd guard per credential
backfillas/skapas och ökas atomärt av credential- och sessionsspärrtriggers.
Immutable credentials, sessioner, journaler och resultat ändras inte.
Auth kör i eget savepoint med session → credential → guard SHARE; endast
SQLSTATE40001 mappas efter rollback till unauthorized före projektionsläsning.
Andra fel propageras. Ingen extra poolconnection eller gammal-snapshot-retry.

Terra Medium granskade design och kod read-only. Main bekräftade att en guard
räcker när båda spärrtyperna uppdaterar den. Annan sessions logout kan avvisa
en pågående gammal läsning konservativt; färsk request för giltig session
fungerar. Migrationen har explicit underhållsstopp, EXCLUSIVE-tabellås och
5s lock_timeout: writers måste stoppas, ordningsändring ensam räcker inte
för blandade login/logout-lås. Verklig tävling och manuell demo är omigrerade.

Verifiering:

- Ursprungligt röda test oförändrad unauthorized-assertion: passerar.
- Speaker/guard PG: 9 tester omfattar nu credential- och sessionsspärr som
  vinner låset, spärr efter snapshot före guarduppslag, andra sessionens
  logout/färsk retry, läsning som vinner och håller lås efter savepoint,
  komplett guardtäckning, monoton/deleteskyddad guard, immutable credential
  samt saknad guard som avvisar auth och spärrwrite utan persistent radering.
- CI=true pnpm lint, typecheck, test, build: alla exit 0.
  Enhetstester: 213 filer / 1 390 tester; nya 2 authfelklassificeringstester.
- Efter sista två PG-prov: application lint/typecheck exit 0.
- CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema
  pnpm --filter @o-tid/application test:integration: exit 0,
  17 filer / 221 tester på 19,28 sekunder.

Loggar /private/tmp/otid-008-guard-{lint,typecheck,unit,build,integration-final}.log.
Ingen browserkörning: HTTP/UI har inte aktiverats. Det här bevisar den korrigerade
protected-read-gränsen, inte hela speakerläget eller alla äldre adminläsningar.
listEntryClassesAsAdmin och listPairingGrantsAsAdmin använder äldre olåst
auth-preflight och behöver separat konvertering före generell produktions-
beredskap. Speaker-specifika manualresultat/withdrawals/historikgräns och
korrupt provenans samt CLI/HTTP/UI/browser är fortsatt nästa arbete.

Slutlig migrationsfil med EXCLUSIVE/lock_timeout har dessutom körts genom
TASK007:s egna nya isolerade testdatabaser: targeted task-007-demo.test.ts
exit 0, 5/5 på 3,25 sekunder. Logg
/private/tmp/otid-008-guard-fresh-migrations.log. Den första lokala 0037-
körningen hade tidigare tabellåsläge; inget produktionssystem fick den versionen.

## TASK 008: serveracceptans och betrodd speaker-CLI, 2026-09-06

Föregående användarturn gav verifierad lokal HTTP 200 och ett avgränsat svar
om testbarhet, inte bevis på produktionsberedskap. Huvudmålet kvarstår öppet.
Nu har de nya serverproven granskats och körts tillsammans med hela projektet.
Terra Medium ändrade endast task-008-speaker-manual.test.ts; main granskade
filen, integrerade övriga tester/CLI och körde regressionen. Agenten gjorde
också en separat read-only-granskning av CLI och driftinstruktion.

Sju riktiga PostgreSQL-servicekedjor verifierar aktiv DSQ/approval/DNF/OOC/NT
över senare tekniska revisioner, manuellt DNS-återtagande och avpricknings-DNS
följt av FINISH_CORRECTION. Båda DNS-kedjorna visar NO_ACTIVE_RESULT utan
resultat/tid efter återtagandet; manuell withdrawal prövas även med oförändrad
raceSnapshotVersion. Avprickningsfallet använder riktiga device-, roster- och
synktjänster samt hashbunden operation, inte fabricerat resultatunderlag.
Korrupt lagrat utfall avvisar hela speakerprojektionen utan att originalet
ändras. Dubbla valda entry-id:n avvisas före historikläsning/minimering.

Historikgränsen 1 000/1 001 har tio nya enhetstester med mockad databasgräns:
var och en av sex beslutssamlingar, summerad overflow, dubblett och authfel.
Det bevisar grindens orkestrering, inte en full PostgreSQL-kedja med 1 000
giltiga livscykelbeslut eller produktionslast. Sådan belastning är fortfarande
overifierad; proven får inte användas som ett prestandapåstående.

scripts/speaker-board-access.ts och docs/speaker-access.md ger betrodd
utfärdning/spärrning med statisk VIEW_SPEAKER_BOARD. Ingen secret i argv eller
interaktiv stdout. Högst åtta timmar, snäv session och generiska fel återbrukar
befintlig policy. Okänt utfärdande efter commit/utdatafel kräver journalgranskning
och avsiktlig spärrning, inte blind retry. Main rättade instruktionen till
pnpm --silent så scriptstarttext inte förorenar JSON; integrationstestet kör nu
själva dokumenterade pnpm-entrypointen, inte enbart tsx direkt.

Exakta verifieringsresultat:

- CI=true pnpm lint: exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 214 filer / 1 400 tester.
- CI=true pnpm build: exit 0.
- CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema
  pnpm --filter @o-tid/application test:integration: exit 0,
  18 filer / 230 tester, 37,77 sekunder.
- Efter ändring till verklig pnpm-CLI i testet: riktat task-008-speaker.test.ts
  exit 0, 1 fil / 11 tester, 3,44 sekunder; application lint/typecheck exit 0.
- CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json och
  CI=true pnpm exec eslint scripts/speaker-board-access.ts: båda exit 0.
  Den första tidigare scriptkontrollen gav fyra TS2322-fel på vidgad command-
  literal; discriminated intent rättades före dessa gröna omkörningar.

Loggar: /private/tmp/otid-008-acceptance-{lint,typecheck,unit,build,integration,
cli-final}.log. Inga browserprov kördes i denna del eftersom ingen speaker-
HTTP/UI ännu finns; TASK008 är därför inte klar. Nästa arbete inom samma
snitt är separat session/cookie, skrivfri HTTP-route, persondatafritt shell,
polling/stale/logout och browseracceptans enligt ADR-0058/0059.

Inga nya dependencies, teknikval, domänregler eller migrationer i denna del.
Privat tävling, manuell demos databas, Eventor, kartor och riktig hårdvara
ändrades inte. Legacy-auth-preflight och fysisk mobil/USB/produktionslast är
fortfarande öppna begränsningar, inte täckta av gröna speakerprov.

## TASK 008: separat privat HTTP/session, 2026-09-06

Föregående målturn var konkret framsteg: integrerade serveracceptansprov,
betrodd CLI och full regression. Nu finns speaker-board GET samt
speaker-board-session GET/POST/DELETE. Terra Medium ägde bara nya säkerhets-,
cookie-, handler- och routefiler. Main läste bundled Next route/cookiedokument,
granskade implementationen och skrev de tre nya testfilerna själv.

Routes använder statisk VIEW_SPEAKER_BOARD och egna host-only cookies.
Login/logout kräver exakt konfigurerad Origin; logout för vidare CSRF-bevis
och tom-body-kontroll till befintlig tjänst. Resultat-GET går endast genom
listSpeakerBoardAsAdmin med dess skyddade snapshot/authgräns. Strict schema
och exakt response-race gäller även login och sessionsmetadata. Alla egna
svar, även fel, har private/no-store, no-referrer och nosniff; exceptiontext
och oväntade personfält lämnas inte ut. Sessionsstatus läser bara metadata,
är ingen ny resultatbehörighet och ersätter aldrig data-GET:s separata auth.

Main fann och lät rätta två brister i första agentversionen före slutkontroll:
arrayBuffer före storlekskontroll tillät obegränsad bodyallokering, och eager
DB-import skedde före UUID-grinden. Nu stoppas/cancelleras bodyströmmen vid
4 KiB overflow respektive första logout-byte. Canonical lopp-id kontrolleras
före dynamisk DB-hämtning och DB-konfigurationsfel ger privat generiskt svar.
Nya tester kontrollerar faktisk läsräkning/cancel och ingen DB-hämtning för
ogiltigt scope, inte bara slutstatus. Ingen befintlig adminroute refaktoreras.

Verifiering:

- Riktade webbstester: exit 0, 3 filer / 18 tester.
- CI=true pnpm lint: första exit 1, två no-unsafe-fel i mains mockade
  DB-getter. Explicit unknown-returtyp rättad; omkörning exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 217 filer / 1 418 tester.
- CI=true pnpm build: exit 0; båda speaker-API-rutterna finns i byggmanifestet.
- CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema
  pnpm --filter @o-tid/application test:integration: exit 0,
  18 filer / 230 tester, 24,61 sekunder.

Loggar /private/tmp/otid-008-http-{lint,lint-fixed,typecheck,unit,build,
integration}.log. HTTP-enhetstesterna mockar applicationgränsen och wrapper-
proven mockar DB; den separata PostgreSQL-regressionen binder inte ihop dem.
Ingen genomgående browser/HTTP/PostgreSQL-körning gjordes ännu. Detta är
alltså inte ett bevis på färdigt speakeranvändarflöde. Nästa arbete inom samma
snitt är persondatafritt shell, mobilvy och timeout/polling/stale/logout med
det genomgående acceptansprovet. TASK008 och huvudmålet förblir öppna.

Inga nya teknikval, migrationer, dependencies, externa anrop eller ändringar
i privat tävling/manuell demo. Riktig hårdvara, fysisk mobil, driftrate-limits
och produktionslast är fortfarande inte verifierade av dessa kontroller.

## TASK 008: första mobilvy och genomgående browserprov, 2026-09-06

Föregående målturn var framsteg genom privata HTTP-routes och verifierad
regression. Nu finns /admin/{raceId}/speaker med persondatafritt serverskal,
egen login, femsekunders uppdatering, lästid/tävlingsversion, effektiv status
och tillåten tid, tomt underlag samt tydlig minnesburen stale-varning.
Tävlingsöversikten länkar dit utan att bredda dess capability. Svensk text är
externaliserad; gränssnittet visar inte slot som placering. Lång urvalsförklaring
ligger i tydligt märkt detaljsektion, men begränsningen att listan inte är
placering/målgångsordning är alltid synlig. Privat headerpolicy omfattar sidan.

Terra Medium ägde bara ny browserklient och dess fem tester. Main granskade
klienten, implementerade UI/report/page/CSS, fyra presentationsprov och det
genomgående browserprovet. En separat read-only-agentgranskning fann att
redan startad hämtning kunde fortsätta i dold flik. Main rättade abort vid
visibilitychange och visibility-kontroll före commit. Polling kräver aktiv
session och synlig flik, högst en hämtning. Exakt expiry-timer och authfel
döljer data. Pagehide/bfcache rensar synligt underlag; logout döljer omedelbart
och aborterar gammal läsning. Misslyckad serverlogout har explicit varning
om att reload kan återanvända den fortfarande giltiga cookie-sessionen.

Riktigt browser/HTTP/PostgreSQL-prov skapar eget syntetiskt lopp genom
createEvent + IOF-import, utfärdar egen speakercredential och loggar in via UI.
Tom lista följs av riktig ingest och automatisk poll som visar Ada/OK/40:00.
Det provar no-store, 390px bredd utan horisontell överrinning, touchknapp,
offline/stale, återanslutning, tom Web Storage/appcache, ett hållet verkligt
GET-svar som släpps efter logout, serverns 401 och credentialrevocation.
Port 3108 och separat .next-demo-test används, inte den manuella demodatabasen.
Mobilskärmbilden test-results/task-008-speaker-mobile.png granskades visuellt;
spacing gjordes kompaktare och browserprovet kördes om till grönt.

Verifiering och rättningar:

- CI=true pnpm lint, typecheck, test, build: alla exit 0.
  Hela enhetssviten: 219 filer / 1 427 tester.
- Efter sista overviewlänk/layoutändring: web lint/typecheck exit 0,
  web test exit 0 (105 filer / 533 tester), web build exit 0.
- Separat tsc och eslint för speaker-Playwrightspec/config: exit 0.
- Första två browserstarter: exit 1 före test, require/ES-module-fel.
  Explicit tsconfig räckte inte; import.meta i den CJS-transformerade
  testfilen ersattes med repositoryrelativ resolve för syntetiska fixtures.
  Därefter körde testet och gav exit 1 på tvetydig alert-selector som även
  matchade Nexts route-announcer. Selector avgränsades till vår varning.
- Browser efter selectorrättning: exit 0, 1/1 på 12,4 sekunder.
- Browser efter slutlig mobil-layout: exit 0, 1/1 på 14,1 sekunder.
- Full application-PG-svit kördes inte om i denna UI-del; föregående 230/230
  gäller oförändrad applicationkod. Nya browserprovet använder riktig PG.

Loggar /private/tmp/otid-008-ui-{lint,typecheck,unit,build,web-final-test,
web-final-build}.log och /private/tmp/otid-008-browser{,-fixed,-cjs,-selector,
-layout}.log. Ett diagnostiskt pnpm --version utan CI=true utlöste åter
workspace-install-preflight och avbröts non-TTY; ingen reinstall genomfördes.

TASK008 är ännu inte helt accepterad: sessionexpiry, dold flik och
pagehide/bfcache har kod men behöver egna browserregressioner. Följande
arbetssteg är dessa övergångsprov och slutgranskning inom samma snitt, inte
en ny speakerfunktion. Produktionslast, fysisk mobil och riktig hårdvara
är fortsatt overifierade. Privat tävling, Eventornyckel och kartor är orörda.

## TASK 008: sessions-/flikövergångar och DNS-poll, 2026-09-06

Föregående målturn var konkret framsteg med mobilvy och första genomgående
browserprov. Main har nu lagt till kontrollerad browserklocka för exakt
sessionsutgång (synlig vid expiry minus 1ms, dold vid expiry och ingen senare
poll), emulerad dold/synlig flik, syntetiska pagehide/pageshow och ett faktiskt
pågående browseranrop som aborteras vid flikbyte. Hållet svar får inte ersätta
det gamla minnesunderlaget och en ny poll får inte överlappa. Dessa är riktiga
browserkomponenter med simulerade API-svar/event, inte bevis på faktisk bfcache.

Den utökade körningen hittade en inloggningskapplöpning: första formuläret var
aktivt innan inledande cookie-sessionkontroll var klar, och dess unauthorized
kunde tömma användarens inmatning. Main ändrade initial busy till true och
lade ett deterministiskt prov med hållet sessionssvar; båda inloggningskontroller
är låsta tills svaret kommit. Rättningen ändrar inte credential eller authpolicy.

Terra Medium granskade acceptans read-only och pekade ut återstående bevisluckor.
Agenten implementerade därefter bara task-008-speaker-manual.spec.ts med riktig
DNS-/withdrawal-service, egen privat speakerlogin och automatisk UI-poll.
Main granskade och korrigerade provets jämförelsegräns: vald revision ska vara
oförändrad men den effektiva revisionens suffix ska försvinna. Browsern visar
NO_ACTIVE_RESULT utan tid, med samma registreringstid och tävlingsversion.
Inga API-stubbar används i detta DNS-prov.

Browserutfall i ordning:

- Inledande sessions-/eventprov med tidigare realflöde: exit 0, 3/3, 15,0s.
- Efter hållet hidden-svar: exit 1, 3 passerade / 1 misslyckat; realflödets
  login avslöjade kapplöpningen ovan. Inget test skip:ades.
- Efter initial-busy-rättning: exit 0, 4/4, 17,6s.
- Med deterministiskt initial-loginprov och verklig DNS-withdrawal: exit 0,
  6/6, 30,4s. Logg /private/tmp/otid-008-transition-combined.log.
- Separat tsc för tsconfig.speaker.json och eslint för båda specs/config:
  exit 0. Konfiguration och AGENTS innehåller nu båda browserfilerna.

Verklig navigation/back med observerat pageshow.persisted återstår; det går
inte att härleda bfcache-inträde från dispatchEvent. TASK008 och huvudmålet
förblir öppna tills återstående kontroll och slutbedömning är gjorda.
Ingen privat tävlingsdata, manuell demodatabas, Eventor eller hårdvara berördes.

Full slutregression efter initial-busy-rättningen: CI=true pnpm lint,
typecheck, test och build gav alla exit 0. Enhetssvit 219 filer / 1 427 tester.
Loggar /private/tmp/otid-008-transition-{lint,typecheck,unit,build}.log.
Application-PG-sviten kördes inte separat i denna browserdel; applicationkod
är oförändrad och två av de sex browserproven går genom riktig PostgreSQL.
Fysisk mobil, produktionslast och hårdvarufältprov är fortsatt overifierade.

## TASK 008: faktisk tillbaka-navigation, 2026-09-06

Föregående målturn var framsteg med sessionsprov och inloggningsrättning.
Det riktiga DNS-browserprovet navigerar nu bort till checkin-appskalet och
tillbaka med page.goBack. Testets addInitScript observerar äkta pageshow,
inte dispatchEvent. Playwrights verifierade defaultflagga
--disable-back-forward-cache tas bort bara i denna isolerade testkonfiguration.
Endast persisted=true får räknas som bfcache-bevis; false prövar färsk laddning
och auth via den fortfarande giltiga HttpOnly-sessionen. Observationsdata är
endast testets window-minne/rapport, inga tokens eller namn loggas.

Resultat: alla sex browserprov passerar, men faktiskt pageshow.persisted=false.
Detta styrker ny laddning/auth efter tillbaka-navigation, inte bfcache-grenen.
Terra Medium granskade grenarnas bevisnivå read-only. En produktionsbyggd
lokal testmiljö utan utvecklingsserverns anslutningar är nästa kontroll;
orsaken till utebliven bfcache är inte bevisad och antas inte vara HMR.
Produktionsläget kräver HTTPS för speakerlogin, så HTTP-loopback får inte
användas genom att försvaga origin/cookiepolicyn. Eventuell lokal TLS för
test ska inte installera systemtrust eller ändra riktiga tävlingsbehörigheter.

Verifiering denna del:

- Speaker tsconfig och riktad ESLint: exit 0.
- Första hela browserkörningen med navigation: exit 0, 6/6, 25,3s.
- Riktat observationsprov: exit 0, 1/1, 11,3s; persisted=false. Initial
  instrumentering via html-dataattribut gav hydration-varning och flyttades
  till testets window-minne, utan ändring av produktionskod.
- Slutkörning: exit 0, 6/6, 24,6s; persisted=false och ingen motsvarande
  hydration-varning. Logg /private/tmp/otid-008-navigation-final.log.
- Workspace lint/typecheck/unit/build kördes inte om: endast browsertest,
  testkonfiguration och dokument ändrades. Senaste fulla gröna regression
  (1 427 enhetstester) redovisas ovan, inte som ny körning i denna del.

Ingen ny produktionsfunktion, dependency, migration eller privat databasändring.
TASK008 är fortsatt öppen för bfcache-kontroll och slutbedömning; huvudmålet
är inte blockerat eller uppnått. Nästa arbete är det lokala produktionsprovet,
inte bredare speakerfunktioner, GPS, stafett eller hårdvara.

## TASK 008: standalone/HTTPS och korrigerat cachekrav, 2026-09-06

Föregående målturn gav faktisk navigation och explicit persisted=false. Nu
finns en isolerad produktionsharness med genererad standalone-kopia och
public/static-assets i privat mkdtemp, en egen ett-dygns TLS-nyckel/certifikat,
HTTP-loopback 3110 och HTTPS-loopback 3111. Ingen systemtrust installeras och
produktionens origin/Secure-cookiepolicy ändras inte. Testets certifikatundantag
är avgränsat till Playwright. Terra Medium implementerade bara harnessfilen;
main granskade den, skrev config/teständringar och körde proverna.

Första produktionsprovet gav exit 1 därför att main hade lagt in ett extra
krav på persisted=true. Browserns faktiska notRestoredReasons anger
response-cache-control-no-store samt no-store-with-js-network-request.
Det är inte ett observerat authfel. ADR-0060 dokumenterar öppet korrigeringen:
originalkravet är privat no-store och säker navigation, inte obligatoriskt
cacheinträde. Inga headers försvagas, inga browserfeatures framtvingas och
inget test skip:as. Produktionsprovet kräver vid false nu både observerat
no-store-hinder och verklig session:200 före data:200 efter ny laddning;
vid true krävs fortsatt dold vy och inloggning. Äkta bfcache på en browser som
väljer den är fortfarande overifierad, inte rapporterad som grönt fältprov.

Next varnade också att next start inte stöds med output:standalone. Harness
ändrades därför till genererad server.js och separat privat staging enligt
bundled output-dokumentation, inte custom server eller ändrat teknikval.
Main krävde tidsbegränsad child-stängning, exakt validerad runtimecleanup och
synliga generiska städfel. Efter första körningarna fann main två kvarlämnade
testkataloger eftersom Playwright normalt dödar gruppen utan ordnad cleanup.
gracefulShutdown SIGTERM/15s lades till. De två exakt identifierade katalogerna
och deras genererade certifikat raderades; inga användarfiler togs bort.
Ny körning verifierar både tomt matchande temp-prefix och inga lyssnare på
3110/3111 efteråt. Tillfälliga certifikat kan genereras på nytt, inte återställas.

Exakta verifieringsresultat:

- Första extra bfcache-gate: exit 1, 0/1; orsakerna ovan bevaras i
  /private/tmp/otid-008-production-navigation.log.
- Stödd standalone och ADR-0060-grenar: exit 0, 1/1, 14,0s.
- Efter gracefulShutdown: exit 0, 1/1, 10,7s; faktisk persisted=false,
  observerad no-store-orsak och ny session före privat data.
- node --check och ESLint för mjs-harness: exit 0.
- Separat speaker-tsconfig samt ESLint för spec/productionconfig: exit 0.
- CI=true pnpm lint, typecheck, test, build: alla exit 0.
  Enhetssvit: 219 filer / 1 427 tester.
- CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema
  pnpm --filter @o-tid/application test:integration: exit 0,
  18 filer / 230 tester, 60,42s.

Loggar /private/tmp/otid-008-close-{lint,typecheck,unit,build,integration}.log
och /private/tmp/otid-008-production-{navigation,standalone,cleanup}.log.
Fulla vanliga browserpaketet med sex tester kördes inte igen i denna del;
det förändrade manuella browserflödet kördes tre gånger över produktion/TLS.

Slutgranskningen hittade två kvarvarande originalacceptansluckor: 1 000/1 001
beslut är hittills bara mockat vid DB-gränsen, och historisk resultatklass
tillsammans med aktuella namn/klubb saknar riktat regressionsprov. TASK008
är därför fortfarande under acceptans, inte klart. Nästa avgränsade arbete
är dessa PostgreSQL-prov inom samma snitt. Huvudmålet är öppet. Verklig
tävling, Eventor, kartor, fysisk mobil och hårdvara har inte använts eller ändrats.

## TASK 008: avgränsat speakerunderlag slutverifierat, 2026-09-06

De två kvarvarande acceptansluckorna är nu täckta med riktig PostgreSQL.
Terra-agenten skrev endast task-008-speaker-history-cap.test.ts: 25 importerade
syntetiska entries genomgår riktiga readout-/DSQ-/withdrawal-livscykler. Exakt
1 000 beständiga beslut resolveras till 25 aktiva DSQ-rader; exakt 1 001
avvisar hela projektionen. Main granskade provet och krävde explicit DB-count
och effektiv status vid gränsen. Main skrev klass-/namnprovet i befintlig
speaker-PG-fil: IOF-import ändrar namn, klubb, klass och klassnamn, samtidigt
som originalresultatet och dess historiska klassidentitet bevaras. Ny riktig
ingest ger därefter nästa revision i den nya klassen.

Ingen produktionskod, dependency, domänregel eller migration ändrades i detta
slutsteg. Ett befintligt CLI-prov fick explicit 65 s total timeout för fyra
processer med 15 s per-processgräns efter ett observerat femsekundersfel.
Ingen assertion togs bort. Första enhetssviten fick också en IOF-timeout under
samtidig lint/typecheck. Första fulla PG-sviten fick ett skrivfotavtrycksfel
under överlappande testskrivningar. Dessa röda utfall och agentens observationer
utan slutrapport redovisas i docs/task-008-acceptance.md, inte som gröna prov.

Slutlig verifiering:

- CI=true pnpm lint, typecheck, test, build: samtliga exit 0.
- Enhetstester: 219 filer, 1 427 tester.
- Full isolerad PostgreSQL-omkörning: exit 0, 19 filer, 232 tester, 63,49 s.
- Separat speaker-browser-tsconfig och riktad ESLint: exit 0.
- Speakerbrowser: exit 0, 6/6, 23,9 s.
- Produktionsbyggd standalone/HTTPS: exit 0, 1/1, 10,0 s; verklig ny
  dokumentladdning med no-store-hinder och serverauth före privat data.
- Tillfälliga testportar 3108/3110/3111 och TLS-tempkataloger är städade.

Kravvis evidens och loggvägar finns i docs/task-008-acceptance.md. TASK008
är klart som avgränsat mjukvarusnitt, inte hela speakerläget eller V1.
Huvudmålet lämnas aktivt. Bfcache på verklig browser som väljer cache,
fysisk mobil, produktionslast och riktig hårdvara är fortsatt overifierade.
Privat tävling, manuell demo, Eventornyckel och kart-/importfiler är orörda.

Nästa minsta vertikala uppgift är den befintliga privata klassbyteslistans
spärrsäkra läsning under samtidig logout/revocation. Den använder fortfarande
äldre auth-preflight och ska föras till ADR-0059:s protected-read-gräns med
reproducerande PostgreSQL-prov, utan bred UI- eller behörighetsändring.

## TASK 009: klassbyteslistans authgräns, 2026-09-06

TASK_009_PRIVATE_CLASS_LIST_AUTH.md skrevs före produktionsändringen och
tillämpar accepterad ADR-0059. Main äger results.ts och isolerad browserconfig;
Terra-agenten skrev endast task-009-class-list.test.ts och slutgranskade sedan
read-only. Inga agenttester kördes parallellt mot databasen.

Före fix gav de två riktade reader-gap-proven exit 1, 2 failed/4 bortvalda av
testfiltret. En verklig credential-/sessionsspärr committades medan läsaren
väntade på race SHARE efter sin fristående preflight. När racelåset släpptes
returnerade den gamla koden OK med syntetisk deltagarlista i stället för
unauthorized. Logg /private/tmp/otid-009-red.log. Felet är därmed reproducerat,
inte enbart antaget från kodläsning.

listEntryClassesAsAdmin gör nu protected-read-auth som första steg i samma
transaktion som race SHARE och DTO-projektion. READ COMMITTED, capability,
ordning, DTO och klassbytesmutationen är oförändrade. Ingen migration eller
ny domänregel tillkom. Spärr som vinner authgrinden avvisar läsning; auktoriserad
läsning håller låsen tills den avslutas och spärren kan därefter committa.

Första post-fix-provet gav 5/6: testets väntkontroll för samtidig klassändring
antog två direkta blockerare på raceLocker. Den räknar nu även kön via den
observerade läsaren, fortfarande genom pg_blocking_pids och med samma slutliga
snapshot-/klassassertioner. Omkörningen passerade 6/6, exit 0, 18,95 s.
Första lint/typecheck gav två lintfel/fyra TS-fel: ReturnType av pool.connects
överlagrade callbacksignatur blev void i testhjälparen. En minimal querytyp
ersätter den; lint/typecheck passerar nu, exit 0. Ingen produktionsassertion
eller test har tagits bort för att nå grönt.

Slutverifierat 2026-09-07:

- CI=true pnpm lint, typecheck, test, build: samtliga exit 0.
- Enhetssvit: 219 filer / 1 427 tester, inklusive befintliga klassadmin-HTTP-prov.
- Full PostgreSQL: exit 0, 20 filer / 238 tester, 88,97 s.
- Separat klassliste-browserconfig: tsc och ESLint exit 0; --list väljer
  exakt ett befintligt klassadminflöde.
- Browser: exit 0, 1/1, 22,3 s; verklig login/lista/klassändring,
  tappat commitsvar och exakt retry utan dubbel ändring, därefter logout.
- Loopback-testserver 3109 är stängd; den använde separat testbyggkatalog.

Exakta kommandon, loggvägar och kvarvarande antaganden finns i TASK009.
TASK009 är klart som avgränsad säkerhetsrättning. Övriga legacy-läsare och
full V1/drift är fortsatt öppna; huvudmålet är inte uppnått eller blockerat.
Privat tävling, manuell demo, Eventornyckel, kartor, stationsdata och hårdvara
är orörda. Ingen ny migration eller ny arkitektur tillkom.

Nästa minsta användbara steg är att kontrollera och förbereda en aktuell,
isolerad lokal testtävling med giltiga testbehörigheter, så användaren kan
prova den senaste versionen. Kontrollera först faktisk schema-/serverstatus
och ersätt inte eller migrera en privat tävling för att få en demo att fungera.

## TASK 010: aktuell isolerad lokal demo, 2026-09-07

TASK_010_CURRENT_LOCAL_DEMO.md dokumenterade snittet före ändringen.
Utvecklingsflaggan O_TID_LOCAL_DEMO väljer .next-local-demo, skild från
normal build och browsertest. Fem konfigurationsprov täcker isolering,
motstridiga flaggor och oförändrad produktion. ADR-0057 tillämpas; ingen
ny teknik, domängräns, migration eller behörighetsregel infördes.

Gamla demodatabasen hade migrations-id 36 och saknade authguard. Den och
den privata tävlingen lämnades orörda. Ny kontrollerat tom databas
otid_demo_20260907_preview migrerades genom 0037 (migrations-id 38,
authguard finns) och provisionerades med befintlig CLI. Den har ett event,
ett race, två syntetiska deltagare, två klasser, en råpost och en revision.
Race: fd400248-8b3b-4d9b-a6f8-62f8d52f7c73. Servern på 127.0.0.1:3001
lämnades avsiktligt igång. Guide: docs/local-demo-20260907.md.

Verifiering: CI=true pnpm lint, typecheck, test och build gav alla exit 0.
Enhetssvit: 220 filer / 1 432 tester. Typecheck efter build gav också exit 0.
Loggar: /private/tmp/otid-010-*.log. Full PostgreSQL-, Android- och
browserregression kördes inte om för denna utvecklingsconfigändring;
TASK009:s 238 PG-prov är tidigare evidens, inte en ny körning.

Separat driftprov mot nya databasen: fem privata rollvyer gav anonymt 401,
login 200 och privat GET 200/no-store. Syntetisk ingest och exakt retry gav
stored respektive duplicate, en råpost och en revision. Publikresultatet
visades i browser: Ada Löpare, godkänd 40:00. Den synliga simulatorn har
egen devicebunden credential och orörd lokal kö/sekvens; ingen hemlighet
matades in i den personliga browsern.

Första tillfälliga kontrollskriptet slutade med exit 1 efter lyckad ingest:
cleanup skickade fel argumentform till revokeStationCredential. Argumentet
rättades och exakt kontrollcredential spärrades via befintlig CLI, exit 0.
Slutkontroll utan ny avläsning gav exit 0 och verifierade rätt spärr, en
råpost/en revision och att browsercredentialen inte spärrats. Rollinloggningar
gjordes om; kontrollen var alltså inte fri från sessionsskrivningar.
Logg: /private/tmp/otid-demo-preview.qwcoC7/verification-final.log.

Fyra privata credentialfiler verifierades som 0600. De löpte ut kl. 07:39:49
svensk tid denna dag. Vid återkontroll kl. 20:35 lyssnade node fortfarande
på exakt 127.0.0.1:3001, men behörigheterna var utgångna. Guiden markerar
detta; inga tokens förlängdes eller authkrav kringgicks. Publikresultat är
utan inloggning, privata vyer kräver nya behörigheter.

TASK010:s lokala demonstration är genomförd, inte full V1 eller driftklarhet.
Kvarvarande antaganden: lokal dator/PostgreSQL/server måste vara igång;
annan browser kräver egen enhetsbehörighet; offlineförberedelse kräver eget
samtycke och lösenfras. Fysisk mobil, riktig hårdvara och produktionslast är
inte verifierade här. Eventornyckel, kartor och privata original är orörda.
Huvudmålet lämnas aktivt. Föregående målvarv innebar konkret framsteg genom
ny isolerad demo, konfigurationsändring och verifierad HTTP-kedja.

Nästa minsta vertikala uppgift är den privata omräkningskandidatlistans
spärrsäkra läsning enligt ADR-0059, med reproducerande PostgreSQL-prov och
utan bred ändring av UI eller omräkningsregler.

## TASK 011: omräkningskandidatlistans authgräns, 2026-09-07

Föregående målvarv var framsteg: lokal demo verifierades och dess utgångna
behörigheter dokumenterades korrekt. TASK011 dokumenterades före kodändring
och tillämpar ADR-0059 utan ny arkitektur, migration eller domänregel.
Main ägde results.ts, dokumentation och körningar; befintlig agent skrev enbart
det nya integrationstestet och gjorde read-only-granskning. Inga andra
DB-skrivande tester kördes samtidigt.

listResultRecalculationCandidatesAsAdmin autentiserar nu som första steg i
samma transaktion som race SHARE och privat kandidatprojektion. Befintlig
READ COMMITTED, capability, strikt DTO, readiness, ordning och senaste
readout/revision är oförändrade. Omräkningsmutationen och råhistorik ändras inte.

Före fix gav två deterministiska reader-gap-prov exit 1: committad credential-
respektive sessionsspärr följdes av privat OK i stället för unauthorized.
pg_blocking_pids styrde låsordningen. Första post-fix-körningen gav 4/5:
samtliga samtidighetsprov passerade, men DTO-testet antog fel Bo-klass D21.
XML-fixturen anger H21, vilket assertionen rättades till. Inga produktionsregler
eller säkerhetsassertioner ändrades för att få grönt.

Slutverifiering, samtliga med CI=true:

- pnpm lint: exit 0.
- pnpm typecheck: exit 0.
- pnpm test: exit 0, 220 filer / 1 432 tester.
- pnpm --filter @o-tid/application test:integration: exit 0,
  21 filer / 243 tester, 76,50 s, inklusive TASK011:s fem prov och befintliga
  READY/NO_READOUT/NO_ACTIVE_ASSIGNMENT/MULTIPLE_ACTIVE_ASSIGNMENTS-prov.
- pnpm build: exit 0.

Testdatabas: otid_006w_review_schema, med authguard verifierad före körning.
Exakta kommandon och loggar i TASK_011_PRIVATE_RECALCULATION_LIST_AUTH.md;
loggar under /private/tmp/otid-011-*.log. Browser/Android kördes inte om för
denna servertransaktionsändring; befintliga HTTP-kontrakttester kördes i
enhetssviten. Verklig mobil, hårdvara och produktionslast är inte verifierade.
Migration 0037 är en förutsättning för drift, inte en migration av användarens
privata databaser i detta snitt. Lokala demodata, privata tävlingen, Eventornyckeln
och kartfilerna lämnades orörda.

TASK011 är klart som avgränsad rättning; huvudmålet och full V1 är fortsatt
öppna. Nästa minsta vertikala uppgift är motsvarande spärrsäkra läsning av
listPairingGrantsAsAdmin med PostgreSQL-regression, utan ändring av pairingflödet.

## TASK 012: parkopplingslistans authgräns, 2026-09-07

Föregående målvarv innebar verifierat framsteg genom TASK011:s säkerhetsfix.
TASK012 skrevs före kodändring och tillämpar accepterad ADR-0059.
Befintlig agent skrev enbart task-012-pairing-list.test.ts och slutgranskade
read-only; main ägde produktion, dokument och alla körningar.

listPairingGrantsAsAdmin gör nu protected-read-auth, granturval och varje
grantMetadata-uppslag inom samma READ COMMITTED-transaktion. Ingen ny
race/grant-låsning, schemaändring, teknik eller dependency. Capability,
1000-gräns, sortering, statusprioritet och utfärdning/inlösen/spärrning är
oförändrade. Detta är authskydd, inte en gemensam fryst grantstatus-snapshot.

Före fix gav två reader-gap-prov exit 1, 2 failed/3 bortvalda. Ett verkligt
ACCESS EXCLUSIVE-lås på station_pairing_redemption pausade metadatajoinen
efter granturvalet. Credential-/sessionsspärr committade före upplåsningen,
men gammal kod lämnade privat OK. Låsordningen observerades med
pg_blocking_pids. Efter fix passerade helfilen: 5/5, exit 0, 1,92 s.
Testfixturens CSRF-värde korrigerades under framtagningen, före första körning;
inga assertions ändrades efter det reproducerade felet.

Full PostgreSQL-svit: exit 0, 22 filer / 248 tester, 74,79 s. Testdatabasen
otid_006w_review_schema hade authguard och ingen annan aktiv testskrivare
före körning. Lint och typecheck har båda gett exit 0.
Enhetstest: exit 0, 220 filer / 1 432 tester. Build: exit 0.
TASK012 är därmed klart som avgränsad säkerhetsrättning.
Exakta kommandon och loggar finns i TASK_012_PRIVATE_PAIRING_LIST_AUTH.md.

Privat tävlingsdatabas, demodatabaser, Eventornyckel och kartfiler är orörda.
Browser/Android körs inte om för denna rena servergränsändring; HTTP-prov
ingår i enhetssviten. Migration 0037 krävs vid deploy. Upp till 1000
metadatauppslag håller nu authlåsen till commit; produktionslast/väntetider
är fortsatt overifierade. Ingen fysisk hårdvara eller mobil är fältverifierad
genom dessa serverprov. Huvudmålet är fortsatt öppet.

Nästa minsta produktuppgift är ett PM-flöde för en PDF: privat uppladdning,
explicit publicering och publik nedladdning. Arkitektur/ADR för filvalidering,
privat objektlagring och återtagande ska låsas före implementation; inga kartor
eller GPS-funktioner ingår i detta nästa snitt.

## TASK 013: PM-arkitektur och första kontrakt, 2026-09-07

Föregående målvarv var framsteg: TASK012:s reproducerade spärrlucka rättades
och verifierades. TASK013 påbörjades med full vertikal acceptans, research och
ADR-0061 före någon kod. Scope är fortfarande privat PDF-uppladdning, verklig
lagring/scan, granskning, explicit publicering, publik nedladdning och återtagande.
Det är inte färdigt genom att requestkontrakten nu finns.

Befintlig agent inventerade MinIO/worker/miljö read-only och granskade ADR.
Faktiskt finns bara privat MinIO i Compose; ingen applikationsadapter, scan-
pipeline eller worker utöver placeholder. Docker/minio/mc/qpdf/clamscan
saknas på PATH. Inga installationer, processstarter, användarfiler eller
hemligheter behövdes för inventeringen. Primärkällor finns i
docs/research/pm-pdf-upload.md; ingen extern implementationskod återanvändes.

ADR-0061 beslutar versionsbundet manifest, durabel reservation/scanjobb,
fencing för workers, fail-closed qpdf/ClamAV, fryst publiceringsjournal och
återtagande utan offentlig bucket/presigned URL. N+1-läsningar från tidigare
task påverkas inte. SDK-/binärpinnar, sandbox/resursprofil och gemensam limiter
är fortfarande explicita grindar före runtimeaktivering. Agentens fråga om
historikkvot rättades till kumulativ gräns, inklusive osäkra överföringsförsök;
inga löften om obegränsad lagring eller automatiska raderingar finns.

Main byggde bara strikta init/publish/withdraw-requestkontrakt och tester i
packages/contracts. Klienten kan inte ange bucket/key/versionId/actor/scanstatus.
Storlek/SHA/MIME, canonical titel/UUID, revision och operationsegna idempotency-
nycklar valideras utan tyst normalisering. Detta bedömer inte faktiska PDF-bytes
och ger aldrig ett READY-bevis. Inga PM-routes eller capabilities är aktiva.

Verifiering: CI=true pnpm --filter @o-tid/contracts test gav exit 0,
42 filer / 270 tester. CI=true pnpm lint, typecheck, test och build gav alla
exit 0; full enhetssvit 221 filer / 1 458 tester (26 nya).
Loggar: /private/tmp/otid-013-{contracts,lint,typecheck,unit,build}.log.
Full PostgreSQL/MinIO/scanner/browser kördes inte för denna rena kontraktsdel:
runtimekedjan finns ännu inte. Dessa prov är fortfarande obligatoriska i TASK013.
Ingen tidigare integrationskörning presenteras som ny verifiering.

Arkitektur och offlinegräns uppdaterades; befintlig tävling, demo, API-nyckel,
kartor, rådata och stationspaket lämnades orörda. Hårdvara och produktionslast
är fortsatt overifierade. Huvudmålet är aktivt och TASK013 inte klart.
Nästa steg inom samma snitt är privat versionsbunden objektlagringsadapter
med pinnad SDK och isolerade lagringsprov, inte en ny produktuppgift.

## TASK013: Node-only lagringsadapter, 2026-09-07

Föregående målvarv var framsteg: ADR0061 och 26 requestprov skapades/verifierades.
Nu har packages/infrastructure tillkommit med pinnad minio 8.0.7 och zod 4.1.5.
Registret saknade 8.0.8; installerad kod/typer kontrollerades i stället för att
anta mastersemantik. Full dependency-/licensmetadata finns i
docs/research/pm-storage-sdk.md. Ingen egen SigV4 eller extern källkod kopierades.

Adaptern äger bounded bytes före await, använder en operationsegen signal/
transport, fixed region, disableRetry och högst en PUT. Versionering Enabled
och specifik NoSuchBucketPolicy-frånvaro krävs. Inga andra policyfel räknas
som privat bucket. Manifest binder config-id, opak key, exakt version, SHA och
längd. Versionsbunden readback krävs före retur och vid separat read, inklusive
versionsheader och hash. Ingen latest-fallback, delete eller presigned URL.
Inga routes/worker/application-tjänster använder adaptern ännu.

Agenten skrev initialt 11 faktiska SDK/HTTP-loopbackprov och granskade koden.
Main utökade till 19 med bland annat tappat PUT-svar, timeout-PUT, 10 MiB,
callerbuffer-mutation, extra bytes, fel version och produktionskonfigurationsgräns.
Ett föreslaget granskningsfynd om HTTPS-loopback klargjordes: privat lokal
HTTPS-server är giltig; det som aldrig tillåts i produktion är HTTP-undantaget
loopback-development. Detta är nu uttryckligt i ADR och test.

Första installationen stoppades av frozen lockfile (exit 1); explicit
--no-frozen-lockfile --ignore-scripts passerade. Första paket-typecheck/lint
hittade testets Buffer-typ respektive regexescape/unsafe chunk-typ; de rättades.
Ett initialt felaktigt antagande om getBucketPolicy:s tomma svar korrigerades
mot installerad SDK innan protokollproven kördes. Ingen säkerhetsassertion
försvagades. Metadata-inventering via pnpm list misslyckades med SQLitefel;
direkt read-only-traversering av installerade package.json gav komplett träde.

Slutresultat:

- CI=true pnpm lint, typecheck, test och build: exit 0.
- Efter sista testtillägget: paket-lint/typecheck och full enhetssvit omkörda,
  exit 0. Slutligt 222 filer / 1 477 tester, varav 19 lagringsprotokollprov.
- Build av produktionskoden passerade före sista test-/dokumenttillägget;
  ingen produktionskod ändrades efteråt.
- Loggar /private/tmp/otid-013-storage-*.log; kommandon och detaljer i TASK013.

Detta är inte riktig MinIO-acceptans: testservern är syntetisk, utan signatur-
kontroll eller durabilitet. Inga nya PostgreSQL-/browser-/scanner-/Androidprov
kördes; motsvarande PM-runtimekedja finns ännu inte. Verklig MinIO-versionering,
privat åtkomst och restore samt reservation/scan/publicering/UI återstår.
Dokumentation och AGENTS har uppdaterats. Privat tävling, demo, nycklar,
kartfiler, rådata och stationspaket lämnades orörda. Huvudmålet/TASK013 är öppna.
Nästa steg är isolerad verklig MinIO-versionsacceptans inom samma PM-snitt.

## TASK013: verklig MinIO-versionering verifierad, 2026-09-07

Föregående arbetsvarv gav framsteg genom verklig MinIO-körning; det efterföljande
statussvaret ändrade ingen implementation men verifierade att publika demon
svarade HTTP 200. Nu har körningens slutliga loggar och processläge kontrollerats.
Den isolerade MinIO-servern är avslutad; ingen ny server startades på antagande
om att det tidigare provet hade hängt sig.

Native runner och separat integrationssvit finns i packages/infrastructure.
Pinnad officiell darwin-arm64-binär kontrolleras med SHA-256 före körning.
Privata slumpcredentials och datakatalog används, endast loopback exponeras.
Agenten granskade dessa testfiler read-only utan konkreta säkerhetsfynd.
Testbarnet saknar ännu runnerövergripande processdeadline; adaptorns egna
operationsdeadlines påverkas inte av detta testdriftsförbättringsbehov.

Exakta resultat:

- MinIO: 1 integrationsfil / 3 tester passerade, plus runnerns byteidentiska
  läsning av äldre version efter ren processomstart på samma datakatalog.
- CI=true pnpm --filter @o-tid/infrastructure lint och typecheck: exit 0.
- CI=true pnpm lint: exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 222 filer / 1 477 tester.
- CI=true pnpm build: exit 0.

Workspace-loggar: /private/tmp/otid-013-minio-{lint,typecheck,unit,build}.log.
MinIO-logg: /private/tmp/otid-013-minio-run.log och privat
/private/tmp/otid-minio-run-ybeVew/integration.log. Ingen testdata raderades.

Detta är single-node med syntetiska bytes/rootcredentials och lokal HTTP,
inte PDF-/scanner-, least-privilege-, TLS-, HA- eller backuprestorebevis.
Ingen ny PostgreSQL-, browser- eller hårdvarusvit kördes eftersom detta steg
bara ändrar lagringstestharnesk och dokumentation, inte DB/web/stationsruntime.
PM:s reservation/scan/publicering/UI återstår; TASK013 och huvudmålet är öppna.
Nästa minsta steg i samma vertikala snitt är additiv reservation-/manifest-/
scanjobbsmigration med återställningsnot och riktiga PostgreSQL-prov.

## TASK013: durabel PM-uppladdningsgrund, 2026-09-07

Föregående målvarv var framsteg: verklig MinIO-versionering och processomstart
verifierades och testharnesk/dokumentation färdigställdes. Detta varv inför
schema enligt ADR0061:s dokumenterade tillägg före kod, utan teknikbyte eller
förändring av resultatdomänen.

Migration0038 lägger till MANAGE_PM_DOCUMENT och dess åttatimmarsgräns,
immutable reservation/försök/manifest samt mutable scanjobb. Scope/content-FK
binder race, credential, försök, SHA och längd. 100 raceunika slots × 8
försök × 10 MiB ger högst 8000 MiB, under 8 GiB; inga deletes frigör kvot.
Manifestets deferred korsreferens kräver ett jobb i samma commit. Jobbet är
orkestrering, inte godkänd scan; fencing/rapporttjänster är ännu inte byggda.

Agenten ändrade endast databasschema, migration, journal och migrationsnot.
Main granskade och skrev PG-prov. En halvt ifylld lease-tuple kunde passera
första CHECK-förslaget; detta rättades före migration och fick negativa prov.
Versions-id fick adapterparitet. Generation läses som bigint, med prov över
Number.MAX_SAFE_INTEGER. Ingen säkerhetsassertion försvagades.

Verifiering:

- Första riktade PostgreSQL-körningen: 8 tester, exit 0.
- Slutlig full PostgreSQL-svit: 23 filer / 257 tester, inklusive 9 PM-prov,
  exit 0. TEST_DATABASE_URL och DATABASE_URL pekade endast på
  otid_006w_review_schema på loopback 55432.
- CI=true pnpm lint: exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 222 filer / 1 477 tester.
- CI=true pnpm build: exit 0.

Loggar /private/tmp/otid-013-pm-schema-{pg,full-pg,lint,typecheck,unit,build}.log.
Ingen privat tävling/demo migrerades och inga användarfiler eller credentials
ändrades. Inga nya MinIO/scanner/browser/hårdvaruprov: schemafasen har ingen
aktiverad fil-/UI-runtime. PG-fixturmanifest verifierar referensintegritet,
inte fysisk fil eller scan. Full backup/restore, application-retry/kvot,
worker-CAS/rapporter, autentisering/HTTP och publicering återstår i TASK013.
Huvudmålet är öppet. Nästa steg är authskyddad reservations-/försöksallokering
med exakt retry och kvot, inom samma vertikala PM-snitt.

## TASK013: autentiserad reservation och försöksdebitering, 2026-09-07

Föregående målvarv var framsteg: migration0038 och nio verkliga schema-PG-prov
infördes/verifierades. Detta varv kopplar application-policy och tjänster till
den durabla grunden enligt ADR0061, utan att aktivera HTTP eller lagrings-PUT.

Agenten skrev separat PM-login/prefix/policy och två kontraktsprov. Main skrev
strikt reservationssvar med två prov, reservationstjänst, serverintern
försöksallokering och nio PG-prov. Init använder auth först, sedan race och
request-advisory; gammalt exakt intent fungerar även vid full kvot. En ny
allokering debiterar nytt försök; den får inte användas som återanvändbart
PUT-tillstånd. Befintligt manifest ger ingen ytterligare debitering. Inga
nätanrop sker inom transaktionerna; raceversion/resultat lämnas oförändrade.

Första typecheck rättade testets revoke-anrop från optionsobjekt till Date.
Första riktade PG-körningen: 8 pass / 1 felaktig expected unauthorized för
fel roll. Befintlig authkod returnerar forbidden; testet rättades utan ändrad
produktionsemantik. Agentens auditinvändning om SHA/längd avfärdades efter
kontroll: de är operationsmetadata, inte filens innehåll. ADR förtydligades.
En agentkommandokedja försökte installera dependencies och stoppades av
nät/TTY; huvudagentens efterföljande verifiering använde genomgående CI=true.

Slutlig verifiering:

- CI=true pnpm lint: exit 0.
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0; slutlig omkörning efter sista svarskontraktsproven
  gav 224 filer / 1 481 tester. Paketets lint/typecheck omkörda, exit 0.
- CI=true pnpm build: exit 0; ingen produktionskod ändrades efter build.
- CI=true pnpm --filter @o-tid/application test:integration med samma
  isolerade DATABASE_URL/TEST_DATABASE_URL: exit 0, 24 filer / 266 tester.

Loggar /private/tmp/otid-013-pm-reservation-{full-pg,lint,typecheck,unit-final,build}.log
och /private/tmp/otid-013-pm-response-{lint,typecheck}.log.
PG-proven omfattar exakta och samtidiga retries, full reservationskvot,
åtta samtidiga debiteringar av tio försök, audit/rollback, racescope, roll,
CSRF/expiry och credentialspärr som vinner medan mutation-auth väntar.

Ingen ny migration, ingen ändring av privat tävling/demo/nyckel/kartor.
Inga nya MinIO/scanner/browser/hårdvaruprov för tjänster utan transport/UI.
Slutlig filcommit, verklig scan/fencing, limiter, HTTP, publicering och
kombinerad PG/objektrestore återstår. TASK013/huvudmålet är öppna.
Nästa steg inom samma snitt är bytevaliderad PUT med slutlig auth och atomisk
manifest-/pendingjobcommit samt riktiga lagrings-/rollback-/retryprov.

## TASK013: verifierad objektöverföring och manifestcommit, 2026-09-07

Föregående målvarv var framsteg: authskyddad reservation och försöksdebitering
infördes och verifierades. Nu kopplas dessa till transferPmDocumentAsAdmin
enligt ADR0061:s dokumenterade port-/överföringsgräns före kod.

Body läses först efter auth/debitering, till fast bounded buffer, med längd,
SHA och 30 s totaldeadline. Monoton klocka kontrolleras även mellan omedelbara
chunks. Fel/timeout ger inget PUT men behåller debitering. Porten anropas en
gång; verifierat exact-manifest följs av ny aktuell auth, race-lås och atomisk
manifest/job/audit. Återförsök av committad upload läser ingen body/PUT.
Samtidiga förlorare får samma kvittens och privata orphanobjekt bevaras.
Tjänsten gör inga lagringsanrop inom DB-transaktion. Lagringsreceipt säger
ingenting om PDF-säkerhet, scanstatus eller publicering.

Agenten flyttade manifestformvalideringen till contracts, uppdaterade adaptern
och skrev verkligt MinIO/PG-prov samt runnerkoppling. Main skrev orkestrering,
receiptkontrakt och tio riktiga PG-felprov med uttrycklig lagringsdubbel.
Infrastructure:s application/database/Drizzle-kopplingar är endast testberoenden.
Första install avbröts av nätbegränsning efter påbörjad node_modules-återskapning;
main återställde från lock och installerade de explicita workspace-testberoendena
med CI=true och --ignore-scripts. Inga nya externa runtime-SDK:er infördes.
Första lint rättade en generator utan yield i testet; en initial felaktig
testförväntan generation:0 rättades till bigint 0n före verklig MinIO-körning.

Slutlig verifiering:

- CI=true pnpm lint: exit 0 (omkörning efter test-linträttningen).
- CI=true pnpm typecheck: exit 0.
- CI=true pnpm test: exit 0, 226 filer / 1 485 tester.
- CI=true pnpm build: exit 0.
- Full application PostgreSQL-svit: exit 0, 25 filer / 276 tester;
  timeoutprovet avbröt efter 30 068 ms utan PUT.
- Egen pinnad native MinIO: 3 lagringsprov + 1 genomgående faktisk PG/MinIO-
  reservation/PUT/manifest/PENDING/retry/readback passerade. Äldre version
  överlevde dessutom processrestart. Testprocess avslutad och separat pgrep
  gav ingen match. Inga buckets eller testversioner raderades.

Loggar /private/tmp/otid-013-transfer-{lint-final,typecheck,unit,build,full-pg,minio}.log.
Privat MinIO-körunderlag /private/tmp/otid-minio-run-HdhKlg/integration.log.
Endast otid_006w_review_schema användes; ingen privat tävling/demo migrerades,
inga användarkartor/nycklar/råavläsningar ändrades. PG-writing-sviter kördes
sekventiellt. Native MinIO är fortsatt single-node/root-testcredentials/HTTP
loopback, inte least-privilege/TLS/HA eller kombinerad backuprestore.

Ingen scanner, browser eller hårdvara kördes här. Syntetiska filbytes är inte
godkänd PDF och inga PM-routes är aktiva. HTTP-reader/limiter, worker-CAS,
immutable rapport, verklig qpdf/ClamAV, publicering/UI och restore återstår.
TASK013 och huvudmålet är öppna. Nästa steg inom samma snitt är verklig PDF-/
antivirusskanning kopplad till durabelt jobb och spårbar scanrapport.

## 2026-09-07: TASK013, verkligt native-motorprov

Föregående implementationstur var framsteg med faktisk PG/MinIO-verifiering.
Efter användarens statusfråga verifierades också lokal publik demo med HTTP200;
inga testbehörigheter förnyades. Denna tur tillför ett körbart motorprov.

Hashpinnad qpdf 12.4.1 och ClamAV 1.5.4 med officiell signaturdatabas kördes
privat utan systeminstallation eller användarfil. Tio steg passerade med
förväntad exitkod: giltig ensidig PDF, krypterad PDF, trasig PDF, saknad
signaturdatabas och EICAR-testmarkör. Read-only agentgranskning ledde till
kontroll av faktisk scan-summary utöver exitkod. Slutligt underlag:
/private/tmp/otid-pm-engine-probe-JVNWQf/observations.json.

CI=true pnpm lint, typecheck, test och build: samtliga exit 0. Enhetstester:
226 filer / 1 485 tester. Infrastrukturens lint/typecheck upprepades efter
sista assertionsändringen, båda exit 0. Nativeprovet exit 0. Första
workspace-testet exit 1 (17 HTTP-tester fick sandboxens listen EPERM);
hela kedjan kördes om med loopbackåtkomst. Slutloggar:
/private/tmp/otid-013-scanner-{lint,typecheck,test,build}-final.log.

Misslyckad nollsidesfixtur och för strikt qpdf-textassertion dokumenteras,
liksom FreshClams NULL X509 store-varning och ogiltig macOS-PKG-signatur
trots separat godkänd GPG-verifiering. Exakta hashar, källor och avgränsningar:
docs/research/pm-native-scanner-probe.md och ADR-0061.

Inga PG/MinIO-, browser-, Android- eller hårdvaruprov upprepades: ingen sådan
runtime/schema ändrades. Ingen worker/publicering aktiverades. Native
hostbibliotek är inte hermetiska; produktionsisolering och validerad
uppdateringskedja återstår. TASK013 och huvudmålet är öppna. Nästa minsta steg
är worker-lease/fencing och immutable scanrapport i samma vertikala snitt,
utan aktivering innan produktionsprofilens acceptans är uppfylld.

## 2026-09-08: TASK013, beständig scanlease och återlämningsgrind

Föregående måltur var framsteg: faktiskt motorprov och verifierad testkod.
Denna tur implementerar första jobblivscykeln inom samma öppna vertikala
snitt. ADR-0061 utökades före implementation; architecture, migrationsnot
och testkommandon är uppdaterade. Teknikval och resultatdomän är oförändrade.

Migration0039 inför immutable pm_scan_attempt per upload/generation, med
femminuterslease och existens-FK till jobbet. Serverintern claim använder
SKIP LOCKED och DB-klocka, journalför attempt och jobbtillstånd atomiskt,
returnerar exakt manifest och gör ingen scanner-/nät-I/O under lås.
Generation är bigint utan overflow; globala uttag hoppar över uttömda jobb.
Release kräver state/owner/generation och lease_until > clock_timestamp()
i själva UPDATE RETURNING efter lås. Ingen historik raderas vid release.
Den självständiga agentgranskningen bidrog med kontroll av den slutliga
SQL-expirygrinden. Detta är inte ännu fencing av rapportcommit.

Verifierat på endast otid_006w_review_schema: 40 migrationer (0000–0039).
Full application PostgreSQL-svit exit 0: 26 filer / 288 tester. De tolv nya
proven täcker samtidiga claimers, SKIP LOCKED, verklig observerad låsväntan
med expiry, sena/felaktiga workers, immutable history, constraints, rollback,
globalt urval, framtida/finished jobb och exakt bigint över JS-safeinteger.
Separat sista SQL-grindprov: 12/12 passerade, exit 0.

CI=true pnpm lint/typecheck/test/build: alla exit 0. Enhetstester 226 filer /
1 485 tester. Loggar /private/tmp/otid-013-lease-{lint,typecheck,test,build}-verified.log;
full PG /private/tmp/otid-013-lease-pg.log; separat PG
/private/tmp/otid-013-lease-pg-final-targeted.log.
Efter sista ändringen av enbart globalvalets testfixtur kördes paketlint,
pakettypecheck och alla tolv leaseprov igen: exit 0. Fixturen väljer sina två
nya jobb före bevarade äldre testjobb utan att ändra de gamla; upprepade
körningar blir därmed inte beroende av gamla leasers expiry. Loggar:
/private/tmp/otid-013-lease-final-package.log och
/private/tmp/otid-013-lease-pg-repeatable.log.
Tidigare försök hittade faktisk timestamprepresentation i rå Drizzle-SQL
(7/9 PG-fel), en unsafe-return/onödig assertion i test samt för snäv infererad
UUID-typ. De rättades före slutverifiering. Ingen lokal klockfallback infördes.

Ingen demo/privat tävling migrerades; användarfiler och credentials orörda.
Inga MinIO-/scanner-, browser- eller hårdvaruprov upprepades denna tur eftersom
de delarna inte ändrades. Ingen workerloop eller PM-route aktiverades.
Fem minuter är en beslutad leasebudget, inte verifierad produktionsscanbudget.
Produktionsisolering, scanrapport/proveniens, full publication/UI och restore
återstår. TASK013 och huvudmålet är öppna. Nästa minsta steg: immutable
scanrapport som sparas atomiskt med samma aktuella lease-/fencinggrind.

## 2026-09-08: TASK013, immutable rapport och atomisk slutgrind

Föregående måltur var framsteg med verifierad lease/journal. Denna tur lägger
strikt serverintern scan-evidens, deterministisk klassificering och rapport-
commit enligt ADR-0061, utökat före implementation. Berörda paket: contracts,
database och application. Inga nya dependencies eller teknik-/domängränser.

Migration0040 ger immutable pm_scan_report med composite attempt/owner-FK,
unikt upload/generation, canonical evidenshash och DB-recorded_at. Rapporten
fryser exakt manifest och faktisk deklarerad motor-/signaturproveniens utan
paths/loggar/filbytes. Application härleder PASSED/REJECTED/FAILED; caller
får inte ange outcome/READY/publiceringsrätt. Saknade verktyg är null.
Native-profilen är alltid publishable=false, även PASSED, med DB-constraint.
Denna profil får inte användas för framtida offentlig PM-publicering.

Jobblås serialiserar rapportcommit. Identisk worker/hash/canonical-evidens
returnerar samma historiska rapport efter tappat svar/expiry. Ändrat innehåll
eller worker konflikterar. Ny rapport kräver exakt manifest och scanintervall
inom immutable attempt. Rapportinsert och FINISHED är atomiska; final SQL-CAS
kräver current owner/generation, både jobblease och ursprunglig attemptdeadline
fortfarande giltiga samt scan-end <= DB-tid. Missad grind rollbackar rapport.
Read-only agentgranskning kontrollerade särskilt attemptdeadline-grinden.

Slutverifiering, CI=true:

- pnpm lint: exit 0.
- pnpm typecheck: exit 0.
- pnpm test: exit 0, 228 filer / 1 503 tester (18 nya kontrakt/policytester).
- pnpm build: exit 0.
- Full application test:integration: exit 0, 27 filer / 301 tester, inklusive
  13 nya rapportprov. De täcker exakt/ändrat/samtidigt retry, scope/manifest/
  tidsfel, expiry under insert före CAS, hypotetiskt förlängd jobblease,
  rollback, immutable history och native-publiceringsspärr.
- Sista application lint/typecheck efter testtillägg: exit 0.
- Isolerad otid_006w_review_schema: 41 migrationer (0000–0040), verifierat SQL.

Loggar /private/tmp/otid-013-report-{lint,typecheck,test,build,pg}.log och
/private/tmp/otid-013-report-final-package.log. Första riktade PG-körningen
passerade 11/11, därefter tillkom två fall i fullsvitens 13/13. Full PG tog
178,79 s; långsamt historikprov passerade, ingen process startades om på grund
av observationstimeout. DB-writers kördes sekventiellt på samma testdatabas.

Inga MinIO-/native-scanner-, browser-, Android- eller hårdvaruprov kördes i
denna tur: dessa adaptrar/runtime ändrades inte. Alla nya motorobservationer
i testen är syntetiska, aldrig verkligt scannerbevis. Ingen användarfil,
Eventornyckel, privat tävling eller manuell demo ändrades/migrerades.

TASK013 och huvudmålet är öppna. Godkänd produktionsisolering, actual parser/
scannerkomposition, omskanning, publicerings/UI-flöde och komplett restore
återstår. Nästa minsta steg inom samma snitt är att koppla verkliga motor-
observationer till denna rapportmodell via en strikt scanneradapter; native
kompatibilitetsprov får fortfarande inte ge publiceringsrätt.

## 2026-09-08: TASK013, verkliga motorutskrifter och signaturunderlag

Föregående måltur var framsteg med atomisk rapportlagring. Denna tur tillför
infrastructure:s strikta outputparsers samt verklig nativeverifiering av dem.
ADR-0061 uppdaterades före kod. Inga nya dependencies eller domängränser.
Qpdf check/encryption, ClamAV-summary och sigtool-info kräver fullständigt
känt outputformat, exakt temporär målfil, separata stdout/stderr och giltig
processstatus. Dubbel/extra/trunkerad text, fel räknare/datum, stderr, timeout
och signal får aldrig clean-summary. Rapporteringsobservationen saknar paths.

Nativeproben verifierar/hashpinnar även sigtool och certifikatkonfiguration,
kopierar exakt tre CVD plus versionsmatchade signaturfiler till egen 0500/0400-
katalog och ger samma kopia till verifieraren och skannern. Inventory/hashar
kontrolleras efter skanning. Verifieringsmetoden märks sigtool-default-cvd;
detta påstår inte att X509 användes framför legacy CVD-signatur. Agentens
read-only-granskning bidrog med dessa proveniensgränser och exakt DB-urval.

Verkligt slutprov exit 0, 13 steg: tre Verification OK., PDF check0/encryption2,
kryptering/trasig fil/saknad DB nekade och EICAR upptäckt. Parsed underlag:
/private/tmp/otid-pm-engine-probe-YLI0dC/parsed-observations.json.
Första utökade nativeprov stoppade på bytecodes -0400-byggtid; strikt offset-
konvertering och regressionsprov infördes utan sänkt verifieringskrav.
Privata testfiler/kopior bevaras. Ingen systeminstallation eller DB-uppdatering.

Slutlig CI=true pnpm lint/typecheck/test/build: samtliga exit 0.
Enhetstester: 229 filer / 1 528 tester, inklusive 25 nya parserprov.
Paketets separata lint/typecheck/test passerade också (2 filer / 44 tester).
Första lint hittade kontrollteckenregex, mellanslagsregex och en onödig
typassertion; de rättades före slutkedjan. Slutloggar:
/private/tmp/otid-013-parser-{lint,typecheck,test,build}-final.log och
/private/tmp/otid-013-parser-package-final.log. Senaste produktionskodens
timeout/signal-grind ingår i hela slutkedjan; den ändrar inte normalutfallet
i den redan genomförda verkliga nativekörningen.

Ingen ny PG/MinIO-, browser-, Android- eller hårdvaruintegration kördes:
de lagren ändrades inte. Dessa parser/prober lagrar ännu ingen full rapport.
Ingen användarfil, privat tävling, demo eller Eventornyckel berördes.
Varken produktionsisolering, komplett verifierad certifikatkedja, scanner-
cleanup eller MinIO→worker→rapport är färdigbevisat. TASK013 och huvudmålet
är öppna. Nästa minsta steg är en sammanhängande workeriteration som binder
exakt lagrad filversion till verkliga kontroller och atomisk rapportcommit,
fortfarande utan native-publiceringsrätt. Fulla publicerings-/restorekrav kvarstår.

## 2026-09-08: TASK013, verklig workeriteration och avbrottsgränser

Den senaste statusfrågan gav verifierad information om att den manuella demon
inte svarade, men ingen implementation. Denna måltur gör konkreta framsteg i
den öppna TASK013; huvudmålet och snittets fulla acceptans behålls.
ADR-0061:s workerbeslut fanns före implementation. Application/infrastructure
kopplar nu durabel claim → exakt MinIO-version → qpdf/ClamAV → immutable rapport.
Agenten granskade ägarskap/deadlines och byggde regressions-/integrationstester;
main integrerade, rättade testfixture och körde alla riktiga DB/nativeprov.

Manifestets interna kontrollgrund delas inte med porterna och bytes kopieras.
240 s monoton deadline efter varje portresultat samt abort i outer finally
hindrar sena svar och lämnar inga fabricerade rapporter. Storage vidarebefordrar
abort till riktig HTTP och kontrollerar monoton tid även efter operationen.
Nativebarn har 60 s monoton deadline, separat outputgräns och väntan på close.
Abort under slutlig verifiering/cleanup ogiltigförklarar clean-evidens.
Nativeprofilens PASSED förblir publishable=false; inga routes eller daemon.

Verklig slutlig MinIO/PG/nativekörning exit 0:
/private/tmp/otid-minio-run-RjQQ1W/integration.log. Tre lagringstester, ett
transferprov och två scannerintegrationer passerade. Giltig egen PDF gav
PASSED med exakt sparad evidens/hash och FINISHED; trasig PDF gav FAILED utan
påhittad AV. Retry gjorde inget extra read/scan. Exakt äldre objektversion
överlevde ren serveromstart. Runnern stoppade servern. Endast skannerns egna
namngivna temporära PDF-/signaturkopior och tomma kataloger togs bort;
originalunderlag, MinIO-versioner och databashistorik bevaras.

Full CI=true pnpm test:integration: exit 0, 28 filer / 316 tester, inklusive
15 nya iterationsprov. Logg: /private/tmp/otid-013-iteration-pg.log.
Isolerad otid_006w_review_schema har verifierat 41 migrationer; ingen ny
migration i denna tur. Paketlint/typecheck/test: exit 0, 3 filer / 58 tester,
inklusive 11 process-/factoryprov och 22 storageprov. Processproven är doubles,
inte ytterligare riktiga verktygskörningar; integrationen ovan är separat.

Första lint stoppade på oanvänd import. Första PG-försök blockerades av
sandbox-EPERM; godkänd loopbackkörning hittade 14 fixturefel/1 pass därför att
manifest och scanjobb skrevs i olika transaktioner. Fixture rättades till
atomisk commit utan ändrad DB-constraint; samtliga 15 passerade därefter.
Agentens nya processdouble fick först explicit returtyp efter inferensfel;
dess första loopbacktest krävde också godkänd eskalering. Slutproven passerar.

Slutlig CI=true pnpm lint, typecheck, test och build efter alla kod-/teständringar:
samtliga exit 0. Enhetssvit 230 filer / 1 542 tester. Loggar:
/private/tmp/otid-013-iteration-{lint,typecheck,test,build}-final.log.
Den tidigare workspacekedjan passerade också men räknas inte som slutbevis
för de senare monotona tidskontrollerna; dessa ingår i slutkedjan ovan.

Ingen verklig tävling, demo, användarfil eller Eventornyckel användes.
Browser-/Android-/USB-prov kördes inte eftersom dessa vägar inte ändrades.
Nativeprofilen är inte verifierad produktionsisolering eller X509-policy;
CPU/minne/tempdisk/nät, gemensam limiter, publicerings-UI/HTTP och samlad
backup/restore återstår. Ingen PDF beskrivs som garanterat ofarlig.
Nästa minsta vertikala steg är samma fil→rapportkedja i en verifierad isolerad
workerprofil med verkliga resurs-/nät-/cleanupfelprov, innan publiceringsrätt.
TASK013 och huvudmålet är öppna.

## 2026-09-08: TASK013, konkret Linuxprofil utan falskt isoleringsbevis

Föregående måltur var framsteg: faktisk MinIO/native/PG-kedja och avbrottsprov.
Nu verifierades aktuell miljö: Docker/Podman/Colima/Lima/nerdctl/QEMU saknas
på PATH, kontrollerade Docker/OrbStack-appar och socketar saknas. Darwin arm64
har sandbox-exec men det bevisar inte Linuxisolering. Cirka20GiB disk ledigt;
ingen VM eller systeminstallation gjordes och ingen fjärrmiljö togs i bruk.

Primärresearch och ADR-0062 skapades före kod. Beslutet håller skanningen inom
befintlig worker men använder en kortlivad Linux-container som isoleringsgräns.
Rootless cgroupvillkor, faktiskt resurs-/nätprov och oberoende crash-watchdog
krävs före aktivering. En explicit 2GiB/1CPU/64pids/256MiBtmpfs-kandidat är
dimensionering att verifiera, inte ett redan fungerande produktionslöfte.

buildPmDockerCreatePlan i infrastructure genererar nu strikt argv med fast
policyhash, immutable image-ID och två read-only, icke-rekursiva stagingmounts.
Ingen fri env/argv/mount, shell, pull, auto-remove, root eller privilegiehöjning
kan begäras genom dess input. Enbart fyra fasta miljövärden tillförs; image-
ärvda environment/volumes måste kontrolleras separat före start. Sökvägens
syntax kontrolleras, men realpath/ägarskap/symlänkar kräver kommande faktisk I/O.
Planen utför inget och kan aldrig styrka scan/proof/publicering.

Agenten bidrog med primärresearch och ett testutkast. Efter AGENTS-uppdatering
visade agentstatus pending_init; main avbröt den initieringen och slutförde
testet lokalt. Första riktade körningen gav 46 pass/3 fel på olika giltiga
CLI-stavningar (container create samt source/target). Testerna justerades till
vald exakta argv-form och kontrollerar också de fyra fasta env-värdena.
Sista riktade lint/typecheck/test: exit 0, 49 tester. Inga säkerhetskrav sänktes.

Slutlig CI=true pnpm lint, typecheck, test och build: samtliga exit 0.
Enhetstester 231 filer / 1 591 tester; infrastructure 4 filer / 107 tester.
Loggar: /private/tmp/otid-013-profile-{lint,typecheck,test,build}.log.
Ingen PG-/MinIO-/native-/browser-/Android-/USB-omkörning i denna del:
databas, befintlig runtime, UI och hårdvaruvägar ändrades inte. Nya profilen är
ren konfigurationsgenerering. Inga Docker-/Linuxprov kunde köras utan runtime;
syntetiska profiltester ersätter uttryckligen inte dessa acceptanskrav.

Ingen användarfil, tävling, demo eller Eventornyckel berördes. Kontraktets
executionProfile och DB:s publishable=false är oförändrade. Pinnad Linuximage,
betrodd image/runtime/container-preflight, livscykel/cleanup/watchdog och verklig
isolering återstår, liksom full PM-publicering och restore. Nästa minsta steg
är betrodd preflight som nekar oväntad image-/containerkonfiguration före start.
TASK013 och hela huvudmålet kvarstår; ingen komplett produktion påstås.

## 2026-09-08: TASK013, strikt kontroll av prestartmetadata

Föregående måliteration gav implementation och verifiering; den mellanliggande
statusfrågan bekräftade dessutom att demon på 3001 inte svarar (curl exit 7,
HTTP 000). Den startades inte och inga testbehörigheter ändrades.

ADR-0062 uppdaterades före implementation. Infrastructure har nu
checkPmDockerPrestartConfiguration för strikt tillförd Engine API1.53-metadata.
Identitet, image-defaults, exakt miljö, båda mountrepresentationerna, resurser,
privilegier, nät och aldrig startat livscykeltillstånd måste stämma. Separata
betrodda releasepins krävs för mask-/readonlylistor. Startplanen gör runc,
init=false och SIGTERM/5s explicita; profilhashen ändras innan någon release.

Agenten granskade API-semantik och skrev en separat syntetisk testfixture.
Main integrerade kontrollen och granskade hela testfilen. Ett tidigare pågående
lintkommando slutade med tre teststil-/typfel; agentens rättningar finns i den
nuvarande filen. Ny riktad körning av lint, typecheck och båda profiltesterna:
samtliga exit 0, 2 filer / 250 tester (49 plan + 201 prestart).

Kontrollen gör ingen I/O, startar ingen container och utfärdar inget scanproof.
Ingen ny dependency, migration, executionProfile eller publiceringsrätt.
Aktuella native-rapporter förblir publishable=false. Syntetiska fixtures kan
inte bli releasepins eller ersätta faktisk Linuxisolering. Insamling från
betrodd daemon, verifierad image/runtime, realpaths och livscykel-/kraschprov
återstår, liksom full PM-publicering och samlad restoreacceptans.

Slutlig CI=true pnpm lint, typecheck, test och build: samtliga exit 0.
Enhetssviten omfattar 232 filer / 1 792 tester; infrastructure 5 filer / 308
tester. Loggar: /private/tmp/otid-013-prestart-{lint,typecheck,test,build}.log.
Ingen privat tävling, användarfil eller Eventornyckel berördes. PG-/MinIO-/
native-/browser-/Android-/USB-prov körs inte om för dessa rena metadatafunktioner;
inga sådana runtimevägar har ändrats. Verklig Linuxacceptans är ännu inte körd.

Nästa minsta steg är betrodd insamling av faktisk image-/container-metadata
till denna kontroll, med avbrott och begränsad output; ingen automatisk start
eller publicering innan övriga runtimegrindar är verifierade. TASK013 och
huvudmålet kvarstår öppna.

## 2026-09-08: TASK013, faktisk Unix-HTTP-transport till inspect-kontrollen

Föregående måliteration var framsteg: metadatafunktionen implementerades och
hela workspacekontrollen passerade. I denna iteration utökades ADR-0062 före
kod med fast lästransport via privat Unix-socket. Ingen ny domängräns eller
dependency; Node HTTP och fs används bara i infrastructure.

inspectPmDockerPrestartConfiguration validerar/äger input före await, kräver
socket/privat förälder med samma nonroot-ägare och kanonisk path, läser exakt
image-ID och container-ID via två fasta GET-anrop och använder befintlig
metadatafunktion. Gemensam monoton10s, 16KiB headers och 1MiB svar gäller;
fel/abort stänger egen request innan svar returneras. Filesystemoperationer
är inte avbrytbara, men sena utfall får inte leda till nytt HTTP-anrop eller
godkännande. Ingen CLI/TCP-fallback/ambient auth/retry/redirect eller skrivväg.

En testagent extraherade den oberoende syntetiska fixturen och byggde verkliga
Unix-HTTP-prov. En separat read-only-granskning hittade per-chunk-allokering
som kunde förstora minnesåtgången trots bytegränsen; main ersatte den med en
enda begränsad buffer och avkodar enbart dess fyllda del. Main granskar hela
teständringen och kör slutliga workspacekommandon efter stabilisering.

Återkontroll: Docker/Podman/Colima/Lima/nerdctl saknas fortsatt på PATH; cirka
28GiB disk ledigt. Ingen installation/VM/daemon har startats. Riktiga sockets
med syntetiska svar är transportprov, inte verklig Dockerkompatibilitet,
releaseproveniens eller kernelisolering. Ingen executionProfile/rapportpolicy,
DB-migration, PM-publicering, demo eller privat tävlingsdata ändras här.

Riktad slutkörning: infrastructure lint/typecheck exit 0, Vitest 2 filer /
264 tester (63 nya transportprov + 201 bevarade metadatafall). Ingen skip.
Första socketförsöket nekades av sandbox EPERM; godkänd eskalering passerade.
Ett lintprov under pågående testredigering hittade en typad getuid-spy som
rättades; slutlig riktad lint/typecheck passerade. Node ESM tillåter inte den
provade filesystem-exportspyn, så no-HTTP kontrolleras med serverobservationer;
ingen runtimegräns påstås bevisad av en oanvänd mock. Faktiska socketprov
bekräftar bland annat delad10s-deadline, sen monoton gräns, uppdelad UTF-8,
abort/anslutningsstängning, fel i båda svaren och identitetsmismatch.

Slutlig CI=true pnpm lint, typecheck, test och build: samtliga exit 0.
Enhetssvit 233 filer / 1 855 tester; infrastructure 6 filer / 371 tester.
Den riktiga10s-timeouten tog 10005ms i workspacekörningen. Loggar:
/private/tmp/otid-013-inspect-{lint,typecheck,test,build}.log.
Endast testens egna syntetiska temporärfiler/symlänkar/socketar och tomma
kataloger städades; inga användarfiler eller bevarade tävlingsunderlag rördes.

Ingen PG-/MinIO-/native-/browser-/Android-/USB-omkörning: dessa implementationer
ändrades inte. Dockercompatibility, ACL/peertrust, releasepins och faktisk
Linuxisolering är fortfarande overifierade. Nästa minsta steg är avgränsad
förberedelse av en separat Linux-testmiljö och prov mot riktig rootless Docker,
utan användarfiler, hostens hemligheter eller produktionsaktivering. Ytterligare
syntetiska metadatafall ersätter inte denna acceptans. TASK013 och huvudmålet
kvarstår öppna, inklusive PM-användarflöde, publicering och återställning.

## 2026-09-08: TASK013, verklig privat Linux-testvärd

Föregående måliteration gav adapter/testframsteg. Nu skapades faktisk
Linux-testinfrastruktur enligt ADR-0062:s separata förberedelsebeslut.
Agenten granskade pinnade Lima-konfigurationsregler; main kontrollerade
primärkällor, hashade underlag och körde den egna instansen. Standardbasernas
hostmounts och macOS-cachebeteende identifierades före start, utan att ge
syntetiska svar eller miljövariabler som saknar stöd någon bevisstatus.

Privat katalog /private/tmp/otid-linux-probe.a1rGvP: Lima2.2.0-arm64arkivets
SHA-256 och Ubuntu24.04 release-20260705-imagens SHA-256 matchar officiella
referenser (research innehåller exakta hashar). Ingen systeminstallation.
Konfigurationsvalidering/create/start/grundassertioner/stop: alla exit 0.
Effektiv konfiguration: 2 CPU,4GiB RAM,12GiB disk, ingen hostmount, ingen
SSH-agent-/X11-/applikationsportforwarding eller containerd. Faktisk gäst:
Ubuntu24.04.4, Linux6.8.0-134-generic aarch64, UID1000, systemd255, cgroup v2
med cpu/memory/pids. Docker saknas ännu (diagnostikens sista command -v gav
exit127; det separata Linux-grundprovet passerade).

Stopploggen visar VZ stopped och slutligt shut down; en accept-on-closed-socket-
loggrad uppstod under nedstängningen, inte en kvarstående lyssnare enligt
Limas slutstatus. list visar pmtest Stopped. Testunderlag/disken bevaras,
cirka2.6GiB faktiskt använt och cirka25GiB hostdisk ledigt. Vanlig användarcache
för Lima saknas fortsatt. Inga användarfiler, credentials, kartor, Eventor,
testdatabaser eller appar användes/ändrades. Inga filer raderades här.

Inga applikationskällor ändrades. Lint/typecheck/enhetstest/build kördes därför
inte om; senaste faktiska fullkörning är fortsatt exit0/233filer/1855tester
i föregående statuspost. PG/MinIO/native/browser/Android/hårdvara kördes inte.
Detta är verifierad Linuxstart, inte Dockerdelegation, skannerisolering eller
full TASK013. Detaljer och start/stopkommandon: docs/pm-linux-test-host.md.
Nästa minsta steg är hash-/versionskontrollerad rootless Docker i den privata
gästen med faktisk runtime/cgroupkontroll. Huvudmålet hålls öppet.

Efterkontroll med godkänd lsof: ingen lyssnare på tilldelade SSH-porten50058
(exit1/ingen träff). Ursprunglig och lagrad VM-YAML har samma hash; se
testvärdsdokumentet. Ingen bakgrunds-VM lämnas igång från detta provpass.

## 2026-09-08: TASK013, faktisk rootless Docker i privat Linuxgäst

Föregående måliteration gav en verifierad Linux-testvärd. Den återstartades
utan ändrade mounts/resursgränser. Agenten granskade officiella rootless-
förutsättningar medan main versionslåste, installerade och verifierade.
ADR-0062 utökades före installation; inga produktionsteknikval ändrades.

Docker29.8.0, rootless-extras och containerd2.3.5 samt uidmap/dbus/slirp
installerades endast i pmtest. Officiell signeringsnyckel och alla hämtade
DEB-hashar registrerades; APT update/download-only/no-download-install gav
exit0 utan signaturvarningar. Rootful systemtjänster maskerade före installation.
Rootless-setuptool kördes som otidtest via SSH/PAM, exit0, utan --force.

Faktisk daemon29.8.0/API1.56(min1.40), runc1.5.1, RootlessKit3.1.0:
Docker info visar rootless/seccomp-builtin/cgroupns och systemd/cgroup2.
Dockerd-processen ägs av otidtest, inte UID0. Rootful tjänster masked/inactive,
ingen system-docker.sock. Privata /run/user/1000 är0700. Subuid/subgid
100000:65536, AppArmor-userns-restriktion fortsatt1. User- och Docker-cgroups
har cpu/cpuset/io/memory/pids tillgängliga utan extra override; ännu inga
containers, leafvärden eller faktisk gränsverkan. Rootless container-AppArmor
är inte därmed verifierad eller aktiverad. Runtimeassertionerna gav exit0.

User-daemon stop/socketborttagning och VM-stop gav exit0. list visar Stopped;
lsof hittar ingen lyssnare på denna körnings SSH-port50119 (exit1/ingen träff).
Underlaget/disken bevaras, cirka3.2GiB använt och cirka25GiB ledigt på host.
Ingen värddatorinstallation, användarfil, tävlingsdatabas, Eventornyckel eller
applikationskälla ändrades. Ingen global säkerhetskontroll stängdes av.
Setup aktiverade enbart gästens user-service, inte hostautostart.

Lima-loggar och exakta versioner/hashar finns i docs/pm-linux-test-host.md och
research samt /private/tmp/otid-linux-probe.a1rGvP. Inga applikationsändringar:
lint/typecheck/test/build kördes inte om; senaste fullkörning fortsatt exit0,
233filer/1855tester. PG/MinIO/native/browser/Android/hårdvara kördes inte här.
Nästa minsta steg är verklig syntetisk container för leaf-cgroups och vår
inspect-adapter. Ingen Linux-skannerrelease, publicering eller full TASK013
anses klar; huvudmålet är fortsatt öppet.

## 2026-09-08: syntetisk container, därefter produktomprioritering

Föregående statusfråga var en lägeskontroll, inte implementation. Denna
måliteration gav faktiskt underlag: privat Node24.20.0 hashverifierades,
egen minimal diagnostikimage importerades och projektets startplan skapade
en verklig container i rootless-gästen. Prepare-probe: exit0. API1.53-svar
hämtades via riktig Unix-socket. Containern startades aldrig; runtime-/
cgroup-/scanneracceptans återstår. Extra maskerad /proc/interrupts saknar
ännu oberoende releasepin. Ingen inspect-observation gjordes till eget proof.
Detaljer, misslyckat redundant DEB-hashförsök och artefakter finns i
docs/pm-linux-test-host.md. Ingen användarfil, databas eller Eventornyckel rördes.

Agentens read-only inspect-CLI och 30 fokuserade tester har granskats.
Main körde CI=true pnpm --filter @o-tid/infrastructure exec vitest run
test/probe-pm-docker-inspect.test.ts: exit0, 1fil/30tester, 3.10s.
CI=true pnpm --filter @o-tid/infrastructure typecheck: exit0.
CI=true pnpm --filter @o-tid/infrastructure exec eslint
test/probe-pm-docker-inspect.ts test/probe-pm-docker-inspect.test.ts: exit0.
CLI-proven har riktiga temporärfiler men mockad adapter/plattform; faktisk
Linux-CLI mot daemonen är inte verifierad. Ingen produktionskod ändrades.
Full build/workspacesvit/PG/browser/hårdvara kördes inte om för dessa opt-in-
testverktyg och dokument. Senaste fulla verifiering är separat noterad ovan,
inte ett påstående om ny fullkörning.

Användaren begärde proportionerliga tester, mer produktutveckling, minst
MeOS-likvärdiga orienteringsfunktioner och tydlig informationstät UI med mindre
scroll. CODEX_BRIEF §24 dokumenterar detta utan att påstå uppnådd paritet.
TASK014 avgränsar nästa användbara snitt: kompakt tävlingsöversikt med grupperade
arbetsområden och bevarad behörighet/status. Ingen sådan UI är ännu levererad.

Linuxprovets tjänst och VM stoppades: båda exit0, container created/false.
SSH-port50244 saknade efteråt lyssnare. Testdisk/image/container bevaras;
inget raderades. TASK013 pausas i prioriteringen men förblir ofärdig och
publiceringsspärrad. Huvudmålet är öppet. Nästa minsta produktuppgift är TASK014.

## 2026-09-09: TASK014, kompakt tävlingsöversikt levererad

Föregående måliteration gav verkligt testunderlag och dokumenterad
produktomprioritering. Nu är själva produktförbättringen implementerad:
fyra arbetsområden före de långa listorna, kompakt status/antal, svenska
startregler, synliga fel-/offlinevarningar och oförändrade29 funktionslänkar.
Resultatbeslut/rättningar samt klass-/banlistor kan öppnas med native details.
Avläsningsantal skiljs uttryckligen från antal målgångna. CSS är avgränsad
till översikten och kontrollerna är minst44px; inga andra sidor omformades.

Agenten ändrade komponent/texter/scoped CSS; main granskade diffens faktiska
innehåll, förkortade mobilens revisionsetikett och gjorde browseracceptans.
Ingen ny teknik, dependency, domängräns, schema, resultatlogik, credential-
modell eller datahämtning. Därför behövdes ingen ny ADR. Befintlig
authenticated+DTO-grind och direkt DTO-rensning vid logout/authfel bevaras.

Exakta slutresultat (alla med CI=true):
- pnpm --filter @o-tid/web lint: exit0.
- pnpm --filter @o-tid/web typecheck: exit0.
- pnpm --filter @o-tid/web exec vitest run
  src/components/race-overview-admin-ui.test.tsx
  src/lib/race-overview-admin-client.test.ts: exit0,2filer/12tester,770ms.
- pnpm --filter @o-tid/web build: exit0 (inklusive build:checkin/Next).
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json: exit0.
- pnpm exec eslint tests/e2e/task-014-workspace.spec.ts
  tests/e2e/playwright.workspace.config.ts med explicit project: exit0.
- pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts:
  exit0,2tester,5.8s.

Riktig Next/browser,1366×768 och390×844, syntetiska browserinterceptade svar:
29unika länkmål, desktopens4 områdesrubriker ovanför vikningen, ingen
horisontell sidskroll, öppningsbara beslut/listor,44px länkar, offlinevarning,
privat innehåll före login/efter authfel respektive logout. Main granskade
även skärmbilder visuellt. Detta är inte ny server-/PostgreSQL-authacceptans.
Tidiga browserförsök: desktopfail före färdig CSS, därefter2pass; tillagt
offlineprov gav2fail på tvetydig alert-selector (Next har egen announcer).
Selector avgränsades till komponenten och slutkörningen ovan passerade.

Loggar /private/tmp/otid-014-{lint,typecheck,unit,build,browser}.log.
Skärmbilder test-results/task-014-workspace-compact-*/workspace-{1366,390}.png.
Separata testservern3114 stoppad, ingen lyssnare efteråt. Ingen manuell demo,
privat tävling, Eventor, karta, USB, databas eller Linuxgäst ändrades/startades.

Proportionerlig avgränsning: ingen full workspace-/PG-/MinIO-/Android-/
hårdvaruomkörning för denna UI-ändring. Fysisk mobil, skarp tävling och
produktionsbrowser är inte verifierade här; bygget är verifierat. En mobil
behöver fortfarande vertikal scroll för alla arbetsområden. Full funktionell
MeOS-paritet och hela huvudmålet är fortfarande ofärdiga.
Nästa minsta produktuppgift: kompakt, sökbar startlista för startpersonal med
klass, bricka och starttid samlade, byggd på befintligt behörigt underlag.

## 2026-09-09: TASK015, kompakt sökbar startlista

Föregående måliteration var produktframsteg (TASK014). Nu är startpersonalens
lista en kompakt desktop-tabell med klass, planerad start, namn/klubb och
bricka. Samma DOM-rader får läsbar mobillayout, utan duplicerad persondata.
Namn/klubb/bricknummer kan sökas lokalt, NFC-/skiftlägesnormaliserat och
kombinerat med klassval. Visatantal och Rensa filter gör urvalet tydligt.
Serverordning och tävlingens tidszon behålls. Startstämpling fabricerar ingen
klocktid; saknad tid och saknad/flertydig brickkoppling har uttrycklig text.
Listan skiljs fortsatt från faktisk start och länkar till offlineavprickningen.

Agenten ägde komponent/texter/scoped CSS och ren presentationsfilterfunktion.
Main granskade ändringarna, lade till fokuserade prov och kontrollerade riktiga
browserbilder. Filter och data ligger enbart i minnet; nya filter rensas vid
logout, authfel och loginfel. Befintliga API-anrop/cookies/resultatregler
ändrades inte. Ingen dependency, schemaändring eller ny domängräns; därför
ingen ny ADR för detta UI-snitt.

Exakta slutresultat, samtliga med CI=true:
- pnpm --filter @o-tid/web lint: exit0.
- pnpm --filter @o-tid/web typecheck: exit0.
- pnpm --filter @o-tid/web exec vitest run src/lib/start-list-filter.test.ts
  src/lib/start-list-time.test.ts: exit0,2filer/5tester,340ms.
- pnpm --filter @o-tid/web build: exit0, inklusive checkin/Next.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.start-list.json: exit0.
- pnpm exec eslint tests/e2e/task-015-start-list.spec.ts
  tests/e2e/playwright.start-list.config.ts med explicit project: exit0.
- pnpm exec playwright test --config tests/e2e/playwright.start-list.config.ts:
  exit0,2tester,28.7s.

Browser:1366×768/390×844, riktig Next och syntetiska interceptade API-svar.
Verifierat kombinerat urval, Unicode/case, klubb, bricka, clear, båda
startreglerna, varningar, bibehållna rader med stalevarning vid503 samt
rensning/relogin efter401 respektive logout. Browserns tidszon New York,
tävlingens Stockholm:11:01 visas korrekt. Ingen horisontell sidskroll;
main såg bilderna och desktopens fyra testrader ryms på första skärmen.
Agentens första riktade eslint fann ett extra renderingsparentes; rättat
före ovanstående slutkontroller, omkörning exit0.

Loggar /private/tmp/otid-015-{lint,typecheck,unit,build,browser}.log.
Bilder test-results/task-015-start-list-start-*/start-list-{1366,390}.png.
Testserver3115 avslutad, ingen lyssnare vid efterkontroll. Ingen privat tävling,
demo, Eventor, karta, databas, hårdvara eller Linuxgäst användes/ändrades.

Ej verifierat här: fysisk mobil/skärmläsare, storskalig browserprestanda vid
10000deltagare eller ny serverauth/PG-acceptans. Ingen full workspace-/PG-/
Android-/MinIO-omkörning behövdes för avgränsad presentation. Detta är planerad
startlista, inte beständig offlinekö eller faktisk-startregister. Huvudmålet
och MeOS-paritet är fortsatt ofärdiga. Nästa minsta produktuppgift är en
utskriftsvänlig startlista för aktuellt urval med tydlig lästid och stalevarning.

## 2026-09-09: TASK016, utskrift av aktuellt startlisteurval

Föregående måliteration levererade sökbar startlista. Nu kan startpersonal
uttryckligen välja Skriv ut urval för hämtad, icke-tom lista. Knapp och handler
spärrar under pågående anrop. Endast window.print används, ingen ny hämtning,
serverfil, publicering eller persistence. Print-only-kontext identifierar
lopp-id, snapshot, tidszon/lästid, klass-/sökfilter och antal. Integritetsnotis
finns på skärmen och utskriften. Det redan filtrerade tabellinnehållet används;
ingen separat kopia av deltagarlistan finns. Stale- och datavarningar behålls.

Print-CSS är avgränsad till startlistesidan, döljer navigation och kontroller
och återställer även mobilkort till semantisk tabell. Tabellhuvud har
table-header-group och rader break-inside:avoid, men flersidig pagination
är ännu inte verifierad. Main läste implementationen och granskade faktiska
screenshots av print-media vid1366px och390px. Detta är inte en PDF-rendering
eller fysisk skrivaracceptans. Loppnamn saknas i befintligt DTO, därför används
exakt lopp-id i rapporten; inget namn gissas eller nytt API införs.

Agenten ändrade komponent/texter/scoped CSS; main utökade befintliga två
browserfall med printanrop, korrekt filtrerad rad, identitet/filter/lästid,
varningar, dolda kontroller, tabellstruktur och frånvaro efter logout/authfel.
Ingen behörighetsmodell, resultatlogik, schema eller dependency ändrades;
ingen ny ADR behövdes. Sparade eller tryckta kopior kan inte återkallas.

Slutresultat, samtliga CI=true:
- pnpm --filter @o-tid/web lint: exit0.
- pnpm --filter @o-tid/web typecheck: exit0.
- pnpm --filter @o-tid/web exec vitest run src/lib/start-list-filter.test.ts
  src/lib/start-list-time.test.ts: exit0,2filer/5tester,311ms.
- pnpm --filter @o-tid/web build: exit0.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.start-list.json: exit0.
- pnpm exec eslint tests/e2e/task-015-start-list.spec.ts
  tests/e2e/playwright.start-list.config.ts med explicit project: exit0.
- pnpm exec playwright test --config tests/e2e/playwright.start-list.config.ts:
  exit0,2utökade tester,5.7s.

Loggar /private/tmp/otid-016-{lint,typecheck,unit,build,browser}.log.
Screenshots test-results/task-015-start-list-start-*/start-list-print-*.png.
Browserns printfunktion fångades av testet; ingen utskrift/PDF sparades.
Testservern körde isolerat på3115 med syntetiska browserinterceptade svar;
ingen PG, demo, privat tävling, Eventor, karta eller fysisk hårdvara användes.
Ingen full backend-/workspace-/hårdvaruomkörning för presentationsfunktionen.
Huvudmålet är fortsatt ofärdigt. Nästa minsta produktuppgift är kompakt
deltagarsökning i målpersonalens Kvar i skogen-vy, med tydliga osäkerhetsgrupper.

## 2026-09-09: TASK017, sökning med bevarad helhetsbild i Kvar i skogen

Föregående måliteration levererade startlisteutskrift. Nu kan målpersonal
söka namn/klubb/bricknummer och kombinera med klassfilter. NFC/case-normaliserad
filtrering är lokal presentation och behåller serverordning/forestState.
Alla5 grupper visar separata urvals-/hela-loppet-antal. Enhetsuppgifter,
serverlästid och osäkerhetsvarningar består även vid noll träffar och i print.
Aktivt filter och nollträff förklaras uttryckligen: inget bevis för tom skog.
Söktext rensas av befintlig hide/låsning, även vid authfel/logout/expiry.
Konfliktgranskningspanelen får fortfarande hela data.entries, inte urvalet.

Agenten ändrade admin/report/texter/CSS-module och ren filterhjälpare. Main
granskade kod och browserbilder och kompakterade tomma grupper utan att
dölja något gruppantal. Ingen backend, behörighetsmodell, resultatlogik,
schema, dependency eller domängräns ändrades; ingen ny ADR behövdes.

Slutresultat med CI=true:
- pnpm --filter @o-tid/web lint: exit0.
- pnpm --filter @o-tid/web typecheck: exit0.
- pnpm --filter @o-tid/web exec vitest run
  src/components/forest-watch-report.test.tsx: exit0,1fil/7tester,516ms.
- pnpm --filter @o-tid/web build: exit0.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.forest-search.json: exit0.
- pnpm exec eslint tests/e2e/task-017-forest-search.spec.ts
  tests/e2e/playwright.forest-search.config.ts med explicit project: exit0.
- pnpm exec playwright test --config tests/e2e/playwright.forest-search.config.ts:
  exit0,2tester,4.2s.

Riktig Next/browser på1366×768/390×844 med syntetiskt interceptat underlag:
Unicode/case, klubb/bricknummer, klass+query, nollträff med oförändrade globala
antal/enheter/varningar, print-media, clear samt authfel/relogin med tom söktext.
Main granskade desktop- och mobilskärmbilder. Initialt mobiltest skickade login
innan initial sessionkontroll hunnit avslutas (1pass/1fail); testet väntar nu
ut observerad login-required-status. Därefter2pass och efter kompaktering
slutliga2pass ovan. Ingen produktions-timeout eller authregel lättades.

Loggar /private/tmp/otid-017-{lint,typecheck,unit,build,browser}.log.
Bilder test-results/task-017-forest-search-*/forest-search-{1366,390}.png.
Testserver3116 avslutad, ingen lyssnare vid efterkontroll. Ingen verklig person,
privat tävling, demo, Eventor, PostgreSQL, karta, USB eller Linuxgäst berördes.
Ingen full workspace-/backend-/hårdvaruomkörning för presentationsändringen.
Fysisk mobil/skärmläsare, produktion, flersidig utskrift och prestanda vid
10000deltagare är inte verifierade här. Full huvudmål/MeOS-paritet kvarstår.
Nästa minsta produktuppgift: sökbar deltagarväljare vid brickbyte, så personalen
slipper leta i en lång dropdown; befintlig gransknings-/sparandegrind bevaras.

## 2026-09-09: TASK018, deltagarsökning vid brickbyte

Föregående måliteration gav användbar sökning i Kvar i skogen. Nu kan
brickbytespersonal söka namn, klass och aktuell bricka före uttryckligt val.
NFC/case-normalisering och serverordning bevaras. Träffantal och Rensa sökning
är synliga; alternativen visar även aktuell/saknad/flertydig bricka. Inget
första sökresultat väljs automatiskt. Ny sökning rensar osparat deltagarval/
nytt bricknummer, vilket förklaras i UI. Busy/fryst attempt spärrar sökningen
både i UI och handler. Query rensas vid authfel/loginfel/logout, men befintligt
okänt bytesintent och dess reauth/retry bevaras oförändrade.

Agenten ändrade komponent/texter/scoped CSS och ren filterhjälpare; main
granskade kod, kompletterade två rena filterprov/browsertest och flyttade
granskat/okänt försök ovanför editorn för mindre scroll. Namn, gammal/ny bricka
och retry ligger i samma panel. Slutlig mobilbild granskad visuellt. Ingen ny
dependency, schema, API, authmodell, domängräns eller resultatlogik; ingen ADR
behövdes. DTO saknar klubb och sådan sökning utlovas inte här.

Slutresultat med CI=true:
- pnpm --filter @o-tid/web lint: exit0.
- pnpm --filter @o-tid/web typecheck: exit0.
- pnpm --filter @o-tid/web exec vitest run src/lib/entry-card-filter.test.ts
  src/lib/entry-card-admin-route-handlers.test.ts: exit0,2filer/5tester,1.01s.
- pnpm --filter @o-tid/web build: exit0.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.card-search.json: exit0.
- pnpm exec eslint tests/e2e/task-018-card-search.spec.ts
  tests/e2e/playwright.card-search.config.ts med explicit project: exit0.
- pnpm exec playwright test --config tests/e2e/playwright.card-search.config.ts:
  exit0,2tester,4.8s.

Riktig Next/browser1366×768/390×844, enbart syntetiska interceptade API-svar.
Proven täcker likadana namn i olika klasser, Unicode/case/klass/bricknummer,
flertydig koppling, nollträff, clear, inget automatval, rensat osparat utkast,
explicit granskning, låst sökning och identiska PATCH-path/idempotency-key/body
efter syntetiskt500 och retry. Ny inloggning efter401 ger tom söktext.
Detta bevisar klientdisciplin, inte ett verkligt DB-committat brickbyte.
Första browserkörningen gav2fail på tvetydig alert-selector (Nexts announcer);
testet avgränsades till komponenten. Därefter2pass, och efter omplacering ovan
slutliga2pass. Ingen säkerhetsregel ändrades för att få gröna prov.

Loggar /private/tmp/otid-018-{lint,typecheck,unit,build,browser}.log.
Bilder test-results/task-018-card-search-*/card-search-{1366,390}.png.
Testserver3117 avslutad, ingen lyssnare vid efterkontroll. Ingen privat tävling,
demo, Eventor, PG, karta, verklig bricka eller hårdvara berördes. Ingen full
workspace-/PG-/hårdvaruomkörning för denna väljare. Fysisk mobil, stora listor
och nytt fältprov är inte verifierade. Full huvudmål/MeOS-paritet kvarstår.
Nästa minsta produktuppgift: samma tydliga deltagarsökning vid ändring av
individuell fast starttid, med bevarat granskat intent och låst återförsök.

## 2026-09-09: TASK019, deltagarsökning vid fast starttidsändring

Föregående svar var endast prioriteringsbekräftelse (ingen produktändring).
Denna fortsättning implementerar TASK019: namn-/klassökning, synligt
träffantal, tomträff och rensning. Sökändring rensar ogranskat deltagarval och
tidsutkast; ett granskat eller okänt försök låser sökningen. Query rensas vid
authförlust/loginfel/logout. Bekräftelse och återförsök ligger före redigeraren.
Agent compact_overview_ui ägde UI/helper/texter/scoped CSS; huvudagenten ägde
uppgiftsdokument, tester och verifiering. Ingen ny ADR: presentation inom
befintliga kontrakt; inga teknikval, domängränser eller startregler ändrade.

Serverns starttidslista filtrerar fortfarande FIXED och mutation avvisar annan
startregel. Namn/klass är de tillgängliga sökfälten; ingen fabricerad klubb
eller bricka. Befintlig UTC-normalisering, versionsvillkor, explicit omräkning
och exakt återförsök behålls.

Verifierat, samtliga slutkommandon exit 0:

- `CI=true pnpm --filter @o-tid/web lint`
- `CI=true pnpm --filter @o-tid/web typecheck`
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-start-time-filter.test.ts src/lib/entry-start-time-admin-route-handlers.test.ts`: 2 filer, 5 tester, 4.23 s.
- `CI=true pnpm --filter @o-tid/web build`
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.start-time-search.json`
- `CI=true pnpm exec eslint tests/e2e/task-019-start-time-search.spec.ts tests/e2e/playwright.start-time-search.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.start-time-search.json"}'`
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.start-time-search.config.ts`: 2 tester, 6.9 s.

Första test-ESLint gav exit 1 för unsafe member access på JSON.parse i en
assertion. Ändrad till toMatchObject; separat tsc/lint och browser återkörda
godkänt. Första browserkörningen passerade också båda testerna (9.6 s).
Slutprovet verifierar 1366/390 px, Unicode, klass, saknad tid, inget automatval,
rensat utkast, låst försök, +02:00→UTC samt exakt samma URL/body/nyckel efter
HTTP 500 och återställd tom sökning efter authförlust. Mobilbild visuellt
granskad: återförsök före redigeraren, ingen horisontell overflow.

Loggar `/private/tmp/otid-019-{lint,typecheck,unit,build,browser}.log`.
Loopback 3118 stoppad och ingen lyssnare vid efterkontroll. Inga privata
tävlingar, Eventor, kartor eller databaser berörda. Browserprovet har mockade
HTTP-svar, inte ny PG-acceptans. Full workspace/integration/hårdvarusvit har
inte återkörts för denna presentationsändring. Fysisk mobil och mycket stora
listor förblir overifierade. Huvudmålet och MeOS-paritet är fortsatt öppna.

Nästa minsta produktuppgift: visa starttider i tävlingens tidszon i detta
ändringsflöde, med entydig offset och bevarad kanonisk UTC-begäran.

## 2026-09-09: TASK020, starttidsrättning i tävlingens tidszon

Föregående målturn var konkret produktprogress (TASK019). TASK020 och
ADR-0063 skrevs före ändring av kontrakt/applikation. Listan kräver nu en
validerad timeZone från eventet via loppet i den behöriga lästransaktionen.
UI återanvänder startlistans datum-/offsetformatterare och fryser zonen i
granskat försök. Saknad zon får inte ersättas med enhetens. UTC-mutation,
versionsvillkor, FIXED-gräns och separat omräkning är oförändrade.
Agent compact_overview_ui ägde UI/texter; huvudagenten övriga lager och tester.

Exakta slutresultat:

- `CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint`: exit 0.
- Samma filter med `typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/contracts build`, application build och web build: exit 0 vardera.
- Contracts `vitest run test/entry-start-time-admin.test.ts`: exit 0, 4 tester (1.49 s).
- Web `vitest run src/lib/start-list-time.test.ts src/lib/entry-start-time-filter.test.ts src/lib/entry-start-time-admin-route-handlers.test.ts`: exit 0, 6 tester (2.87 s).
- Separat tsc/ESLint enligt TASK019:s AGENTS-kommandon: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.start-time-search.config.ts`: exit 0, 2 tester (7.9 s), 1366/390 px med New York-enhetszon och Stockholm-tävlingszon.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55440/otid_020_test pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK 006O individuell fast starttid PostgreSQL'`: exit 0, 3 passerade/125 avsiktligt bortvalda, 3.30 s.
- Riktad application ESLint efter tillagd PG-zonassertion: exit 0.

Agentens tidiga riktade UI-lint gav exit 1 mot gammal byggd kontraktstyp.
Kontraktet byggdes; ovanstående slutliga paketlint/typecheck passerade utan
casts eller fallback. Gamla testservern 55432 svarade connection refused
(psql exit 2), därför startades inte den. Ny privat tempcluster skapades i
`/private/tmp/otid-020-pg.fKyWpj`, PostgreSQL 17 på loopback 55440. Endast
syntetiska importer användes; migreringen skedde i ny tom testdatabas.
De tre proven kontrollerar även PUNCH-spärr, samtidighet/idempotens och att
resultat/manuella beslut inte ändras automatiskt. Clustern stoppades exit 0;
testdata/loggar bevaras. Inga gamla databaser, Eventor eller användarfiler rördes.

Loggar `/private/tmp/otid-020-{lint,typecheck,contracts,unit,build,browser,pg}.log`.
Mobilbild visuellt granskad: tydlig lokal tid med offset och ingen horisontell
overflow. Antaganden: samordnad driftsättning av strikt server/webbkontrakt och
aktuell Intl-zondata. Fysiska enheter/produktion/stora listor är overifierade.
Full workspace-/integrations-/hårdvarusvit kördes inte för detta snitt.
Huvudmålet och MeOS-paritet är fortsatt ofärdiga.

Nästa minsta produktuppgift: separata datum- och tidsfält vid starttidsrättning,
med explicit offset, så personalen slipper skriva en hel ISO-tidsstämpel.

## 2026-09-09: TASK021, separata starttidsfält

Föregående målturn var produktprogress (TASK020). TASK021 skrevs före ändring.
Webbens starttidsrättning använder nu Startdatum, Klockslag och UTC-offset.
Ren hjälpare komponerar explicita fält och validerar med befintligt kontrakt.
HH:mm ger sekunder 00; sekunder och 1–3 decimaler bevaras. Saknat datum/offset,
ogiltiga kalenderdatum/klockslag och offset över kontraktsgränsen avvisas.
Ingen enhetszon eller sommartid gissas. Samma UTC-intent, granskning och
immutable retry används. Alla tre utkastfält rensas vid val-/sökbyte och låses
under försök. Agent compact_overview_ui ägde UI/i18n/CSS, huvudagenten hjälpare,
tester och verifiering. Inga domän-/API-/databasändringar eller nya ADR-beslut.

Exakta resultat, alla exit 0:

- `CI=true pnpm --filter @o-tid/web lint`
- `CI=true pnpm --filter @o-tid/web typecheck`
- `CI=true pnpm --filter @o-tid/web build`
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/start-time-fields.test.ts src/lib/start-list-time.test.ts src/lib/entry-start-time-admin-route-handlers.test.ts`: 3 filer, 7 tester, 1.95 s.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.start-time-search.json`
- `CI=true pnpm exec eslint tests/e2e/task-019-start-time-search.spec.ts tests/e2e/playwright.start-time-search.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.start-time-search.json"}'`
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.start-time-search.config.ts`: 2 tester, 8.3 s.

Browserprovet återanvänds och uppdateras från TASK019/020; det testar explicit
val, rensade fält, ogiltig offset utan request, låsta fält, lokal visning och
exakt kanoniskt retry. Mobilbild granskad, ingen horisontell overflow. Datum
har egen rad och tid/offset två kolumner på mobil. Ingen extra PDF eller
lagring. Port3118 stoppad och utan lyssnare vid efterkontroll.
Loggar `/private/tmp/otid-021-{lint,typecheck,unit,build,browser}.log`.

Antaganden: personalen anger rätt datum och explicit offset. Fysisk mobil och
dess datumväljare, produktion och stora deltagarlistor återstår att verifiera.
Ingen full workspace-/PG-/hårdvarusvit kördes för oförändrad server; TASK020
har föregående starttidsintegration. Inga privata data eller Eventor rördes.
Huvudmålet och MeOS-paritet är fortfarande öppna.

Nästa minsta produktuppgift: sökbar deltagarlista i tävlingsöversikten med
direktlänkar till befintliga rättningsflöden, med oförändrade behörighetsgränser.

## 2026-09-09: TASK022, sammanhängande deltagarnavigering

Föregående målturn var produktprogress (TASK021). Läste ADR-0020/0042 och
befintliga kontrakt: overviewcapabilityn är uttryckligen PII-fri. Därför
skrevs ADR-0064 och TASK022 före implementation. Översiktens befintliga länk
heter nu Deltagare och startlista; personunderlag hämtas fortfarande endast
under separat VIEW_START_LIST. Ingen breddning av översiktens DTO/behörighet.

Den sökbara startlistans Rätta-meny leder till brickbyte eller, vid FIXED,
starttidsrättning. Race/entry/destination lämnas i flyktigt modulminne och
konsumeras en gång med race-/målmatchning. Inga deltagaruppgifter i URL,
cookies eller Web Storage. Målflödets egen auth och listmatchning måste
passera före namn/klass och knappen Välj länkad deltagare visas. Explicitval
rensar gammalt utkast. Busy/granskat försök kan inte ersättas. Genvägar
döljs vid stale/busy och print. Ingen mutation eller requestgranskning ändrad.
Agent compact_overview_ui ägde UI/i18n/CSS, huvudagenten minneshelper,
dokumentation, tester och verifiering.

Slutresultat, samtliga exit 0:

- `CI=true pnpm --filter @o-tid/web lint`
- `CI=true pnpm --filter @o-tid/web typecheck`
- `CI=true pnpm --filter @o-tid/web build`
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-navigation.test.ts src/lib/start-list-filter.test.ts src/components/race-overview-admin-ui.test.tsx`: 3 filer, 15 tester, 2.26 s.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.participant-navigation.json`
- `CI=true pnpm exec eslint tests/e2e/task-022-participant-navigation.spec.ts tests/e2e/playwright.participant-navigation.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.participant-navigation.json"}'`
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.participant-navigation.config.ts`: 4 tester, 11.2 s.

Första browserkörningen exit 1/4 fel: testet förväntade annan startliste-
inloggningstext än befintlig UI. Rättad assertion, inga authändringar. Ny körning
passerade båda destinationerna i 1366/390 px: PUNCH-spärr, stale utan genvägar,
separat auth, inget förvalt val/PATCH, vanlig URL utan entry-id och ingen hint
efter hård omladdning. Mobilbild för starttidsmål visuellt granskad utan
horisontell overflow. Loggar `/private/tmp/otid-022-{lint,typecheck,unit,build,browser}.log`.

Antaganden: samma flik och mjuk Next-navigering för hint; vanlig sökning används
efter omladdning. Fysisk mobil, stora listor och produktionsdrift ej verifierade.
Inga server-/databasändringar, därför ingen ny full PG-/hårdvaruomkörning.
Inga privata tävlingar, kartor, credentials eller Eventor användes. Huvudmålet
och MeOS-paritet är fortsatt öppna.

## 2026-09-09: TASK023, deltagargenväg till klassbyte

Föregående turn var produktprogress (TASK022). TASK023 dokumenterades före
implementation och ADR-0064 kompletterades med samma regel för classes-mål.
Startlistans Rätta-meny erbjuder nu Ändra klass. Dess flyktiga engångshint
konsumeras av klassbytets egen auth/listmatchning. Först uttryckligt Välj
länkad deltagare begränsar listan till exakt entry. Målklass återställs till
den radens aktuella klass; inga andra rader ändras. Visa alla deltagare tar
bort fokuset. Busy eller bevarat okänt försök spärrar visningsbyte. Saknad
fokuserad deltagare får tydlig varning, ingen godtycklig ersättare.

Det befintliga klassflödet skickar request när operatören valt en ny klass
och tryckt Ändra klass. Det har inte fått någon ny automatisk mutation eller
ny separat förgranskning. Auth, versionsvillkor och retry är oförändrade.
Agent compact_overview_ui ägde UI/i18n/CSS; huvudagenten helper/test/docs.

Exakta slutresultat, alla exit 0:

- `CI=true pnpm --filter @o-tid/web lint`
- `CI=true pnpm --filter @o-tid/web typecheck`
- `CI=true pnpm --filter @o-tid/web build`
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-navigation.test.ts src/lib/entry-class-admin-client.test.ts src/components/entry-class-admin-ui.test.tsx`: 3 filer, 16 tester, 962 ms.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.participant-navigation.json`
- `CI=true pnpm exec eslint tests/e2e/task-022-participant-navigation.spec.ts tests/e2e/playwright.participant-navigation.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.participant-navigation.json"}'`
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.participant-navigation.config.ts`: 6 tester, 16.7 s.

Sviten omfattar alla tre destinationer i 1366/390 px och verifierar separat
auth, rätt deltagare, inget automatiskt PATCH, normal URL och tappad hint vid
omladdning. Klassproven kontrollerar 2→1 rad vid explicitval, aktuell målklass,
spärrad ändringsknapp och återgång 1→2 rader. Ingen horisontell overflow.
Port3119 är stoppad och utan lyssnare vid efterkontroll.
Loggar `/private/tmp/otid-023-{lint,typecheck,unit,build,browser}.log`.

Antaganden: samma flik och mjuk navigering; vanlig lista efter omladdning.
Fysisk mobil, stora listor och produktion ej verifierade. Inga serverändringar,
ingen ny full PG-/hårdvarusvit. Privata data/Eventor/originalfiler orörda.
Huvudmålet och MeOS-paritet är fortsatt öppna.

Nästa minsta produktuppgift: deltagarspecifik genväg till avläsningshistoriken
från samma lista, med historikens separata läsbehörighet.

## 2026-09-09: TASK024 påbörjad, serverbunden deltagarhistorik

Föregående målturn var produktprogress (TASK023). Granskning av befintlig
historylist visade att LIMIT 50 sker före identitetsuppslag. Att lägga samma
lokala filter som klassbytesvyn skulle missa deltagare längre bak i historiken.
Detaljen binder första CARD_READOUT-revisionen, medan discovery idag binder
via ingestutfallet; detta är dokumenterat befintligt legacybeteende, inte en
grund för att hitta på en tredje identitetsregel.

Huvudagenten läste list/detalj och ADR-0024, agent compact_overview_ui gjorde
oberoende read-only-granskning av SQL/cursor/integrationsprov. ADR-0065 och
TASK024 skrevs före ny implementation. Beslut: separat deltagarbunden GET
med samma historikbehörighet, SQL-filter före LIMIT, ursprunglig bindning före
entryjämförelse, egen entry/race-scopad cursor och tydlig tom deltagarsida.
Inga personhintar i browseradress/lagring; routebundna API-id:n hanteras privat.
Ingen aktuell brickassignment används som historisk identitet.

Nytt strikt `entryReadoutHistoryResponseSchema` är infört: explicit entry,
validerad bounded historiksida, samma race och identitet på alla rader.
Giltig tom sida betyder inga kopplade readouts, inte avsaknad av manuella
resultatrevisioner. Befintliga historykontrakt och endpoints ändrades inte.

Exakt verifiering, samtliga exit 0:

- `CI=true pnpm --filter @o-tid/contracts lint`
- `CI=true pnpm --filter @o-tid/contracts typecheck`
- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-readout-history.test.ts`: 1 fil, 3 tester, 390 ms.
- `CI=true pnpm --filter @o-tid/contracts build`

TASK024 är INTE klar: applicationprojektion, cursor, route, UI och verkliga
PG-/browserprov återstår. Ingen genväg har kopplats till ofärdig endpoint.
Ingen full workspace/build/PG/hårdvarusvit påstås körd för detta kontraktssteg.
Ingen privat tävling, Eventor eller användarfil berördes. Huvudmålet är öppet.
Nästa arbete inom samma vertikala snitt är SQL-projektionen och deltagarbunden
keysetcursor, med PG-prov som hittar en readout bakom minst 51 andra readouts.

## 2026-09-09: TASK024 serverprojektion och privat route verifierade

Föregående turn gav faktisk arkitektur/kontraktsprogress. Nu finns
listEntryReadoutHistoryAsAdmin och GET /api/admin/races/{raceId}/entries/{entryId}/readouts.
Befintlig historikcapability kontrolleras i protected-read-transaktionen före
entryprojektion. SQL lateral väljer första CARD_READOUT för readout/race över
alla entries, sedan jämförs entry före LIMIT. Ingen brickassignment används.
Response har aktuell entryidentitet även vid tom sida och validerad sida10.
Route återanvänder befintlig query-/cookie-/no-store-gräns och kontrollerar
returnerad race/entry mot routeparametrarna.

Ny cursor binder typ/version/race/entry/seek. PostgreSQL-schema har obegränsad
timestampprecision och fixturedata visade verkliga mikrosekunder. Ny cursor
bevarar sex decimaler med SQL-formattering och exakt timestamptz-seek; Date
används bara för kalenderkontroll, inte seekavrundning. ADR-0065 uppdaterad.
Gammal discoverycursor är oförändrad; dess Date-baserade precision bör granskas
separat innan man påstår full sidningsacceptans där.

Agent compact_overview_ui skrev tre PG-tester i task-001.test.ts; huvudagenten
skrev applikation/route/routeprov och kompletterade mikrosekundsfallet. Test
använder ny otid_024_test i vår tidigare privata syntetiska cluster på55440,
inte gamla review/demo/tävlingsdatabaser. Alla sådana data lämnades orörda.

Exakta slutresultat:

- `CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint`: exit 0; efter sista ändringar också riktad web-test-ESLint och application lint/ESLint exit 0.
- Application `typecheck` och `build`: exit 0, återkörda efter cursorändringen.
- Web `typecheck`: exit 0 efter rättning; `CI=true pnpm --filter @o-tid/web build`: exit 0 slutligen.
- Web `vitest run src/lib/entry-readout-history-route.test.ts src/lib/readout-result-history-admin-route-handlers.test.ts`: exit 0, 2 filer/7 tester, 2.88 s. De 2 nya proven återkörda efter typningsrättning, exit 0/1.85 s.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55440/otid_024_test pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t TASK024`: slutligen exit 0, 3 passerade/128 avsiktligt bortvalda, 2.48 s.

Första webtypecheck/build föll på två vi.fn-dubblars vidgade status:string;
rättat till literaltyper utan produktionscasts. Första extra mikrosekundstestet
föll på antagandet att fixturetider slutade000; riktiga defaultNow hade fler
decimaler. Testet använder nu PostgreSQL +1 mikrosekund på verklig gränstid.
Det passerar tillsammans med ordinarie sidning, bakom51 avläsningar, 2+1 egna
sidor, cursor/race/entry-avvisning, crossrace404/felcap403/tomentry, riktigt
brickbyte och senare falsk CARD_READOUT-bindning. Oförändrat antal raw/readout/
revision/outcome/audit kontrolleras för läsningarna; inget fabricerat utfall.

Loggar `/private/tmp/otid-024-{pg-final,route,route-final,lint,typecheck,web-typecheck-final,app-build,build-final}.log`.
Syntetisk cluster stoppades med pg_ctl exit 0 och bevarad testdata. Ingen
användarfil, Eventor eller privat tävling användes. Ingen full workspace-/PG-
eller hårdvarusvit kördes. Produktionsvolymer/queryplan/indexbehov är ännu
overifierade; ingen migration/indexändring gjord. TASK024 är inte färdig:
nästa arbete inom samma snitt är UI-koppling och browseracceptans. Huvudmålet
och MeOS-paritet är fortsatt öppna.

## 2026-09-09: TASK024 UI och avgränsad browseracceptans

Föregående målturn implementerade/verifierade serverprojektion och route. Nu
är deltagarlistans Visa avläsningshistorik kopplad via flyktig historyhint.
Historikens egen login krävs; explicit Visa deltagarens avläsningar hämtar
entrybunden serverprojektion. Namn visas från dess validerade svar, även vid
tom sida. Scoped äldre/refresh förblir på samma endpoint/cursor. Visa alla
avläsningar rensar scope/detaljer och hämtar första allmänna sidan.

Auth401/403/logout rensar identitet/listor/detaljer/scope. Hint kan behållas i
flyktigt minne för ett nytt explicit val efter reauth, aldrig egen behörighet.
Generationskontroll hindrar sena svar att återvisa tidigare scope. Blandade
entry/race-svar, upprepade readout-id:n och ändrad sididentitet avvisas; en
scopad detalj måste också höra till vald entry. UI förklarar att manuella
resultat utan readout och okända avläsningar utan ursprunglig koppling inte
ingår. Det är inte en fullständig resultat-/säkerhetslista.

Agent compact_overview_ui ägde komponent/i18n/CSS, huvudagenten browserprov,
hinthelper/test, granskning och slutlig kompaktering av marginaler. Inga nya
server- eller databasändringar i denna fortsättning.

Exakta slutresultat, alla exit 0:

- `CI=true pnpm --filter @o-tid/web lint`
- `CI=true pnpm --filter @o-tid/web typecheck`
- `CI=true pnpm --filter @o-tid/web build` (återkörd efter slutlig CSS).
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-navigation.test.ts src/lib/readout-result-history-admin-client.test.ts src/components/readout-result-history-admin-ui.test.tsx`: 3 filer, 11 tester, 1.46 s.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.entry-history.json`
- `CI=true pnpm exec eslint tests/e2e/task-024-entry-history.spec.ts tests/e2e/playwright.entry-history.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.entry-history.json"}'`
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.entry-history.config.ts`: 2 passerade, 8.7 s efter CSS (första körningen också godkänd, 8.0 s).

Browser provar1366/390 px: separat auth, inga scopade anrop före explicitval,
två egna sidor utan allmänna Bo-rader, terminal cursor, tydlig begränsning,
401 som tar bort privata namn, reauth→giltig tom entrysida, felaktig entry
som avvisas utan falsk tomhet, explicit återgång till allmän lista och normal
browseradress utan entry-id. Slutlig mobilbild granskad; inga horisontella
överflöden och reducerade marginaler utan mindre knappar.

Loggar `/private/tmp/otid-024-ui-{lint,typecheck,unit,build,browser}.log`.
Port3120 stoppad och utan lyssnare vid efterkontroll. PG-proven från föregående
steg gäller oförändrad server; ingen ny full workspace/PG/hårdvarusvit påstås.
TASK024:s avgränsade vertikala funktion är färdig. Fysisk mobil, produktions-
volymer/queryplan/indexbehov och produktion är fortfarande overifierade.
Privata data/Eventor/originalfiler rördes inte. Huvudmålet/MeOS-paritet kvarstår.

Nästa minsta uppgift: bevara samma mikrosekundprecision i den äldre allmänna
historiklistans cursor och verifiera att täta avläsningar inte tappas vid sidbyte.

## 2026-09-09: TASK025, allmän historik med exakt mikrosekundcursor

Föregående målturn slutförde TASK024:s avgränsade funktion. TASK025 och
ADR-0066 skrevs före rättning. Allmän listcursor använder nu v2 och exakt
sexdecimals UTC-text från PostgreSQL; seek gör timestamptz-jämförelse utan
JavaScript Date-avrundning. V1-listcursor avvisas och användaren får börja om
via befintlig Uppdatera uttryckligen. Detaljcursor v1/revisionsvattenmärke och
listans responseformat10 är oförändrade. Inga rättningswrites, datamigrationer,
behörighetsförändringar eller nya dependencies infördes.

Agent compact_overview_ui skrev deterministic PG-regression med fyra initiala
syntetiska raw/readout-insättningar på .123900/.123800/.123800/.123100 inom
samma millisekund. Inga immutable rader uppdateras. Testet bevisar 2+2-sidning,
exakt SQLordning inklusive UUID-tie, unik union och terminal cursor, samt
v1/felrace/ogiltig kalender/tid-avvisning. Huvudagenten ägde source/docs/körning.

Exakta resultat, alla exit 0:

- `CI=true pnpm --filter @o-tid/application lint`
- `CI=true pnpm --filter @o-tid/application typecheck`
- `CI=true pnpm --filter @o-tid/application build`
- Riktad `eslint src/readout-result-history.ts test/integration/task-001.test.ts` och application typecheck återkörda efter agentens slutliga test.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55440/otid_025_test pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK025|TASK 005N|TASK024'`: 8 passerade/124 bortvalda, 3.45 s.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/readout-result-history-admin-client.test.ts src/lib/readout-result-history-admin-route-handlers.test.ts`: 2 filer, 8 tester, 1.83 s.
- `CI=true pnpm --filter @o-tid/web build`: exit 0.

Ny otid_025_test i vår syntetiska cluster användes; inga gamla privat/demo/
reviewdatabaser berördes. pg_ctl stop exit 0, data och loggar bevarade.
Loggar `/private/tmp/otid-025-{lint,typecheck,build,pg,web-tests,web-build}.log`.
Ingen full workspace/PG-/browser-/hårdvaruomkörning för detta opaque-cursorsnitt.
Produktionsvolymer och skarp driftsättning är inte verifierade. Gammal v1cursor
kräver uttrycklig listuppdatering. TASK025 är avgränsat klar; huvudmålet och
MeOS-paritet är inte klara.

Nästa minsta produktuppgift: versionsstyrd rättning av deltagarens namn och
klubb, med bevarad ändringshistorik och oförändrade resultat.

## 2026-09-09: TASK026, beslut och kontrakt för namn-/klubbrättning

Föregående målturn var ett prioriteringssvar utan produktändring. Nästa säkra
arbete är nu påbörjat: TASK026 och ADR-0067 skrevs före kod. Read-only granskning
av compact_overview_ui bekräftade importens overwrite-risk, separata frysta
exportbytes och konservativ snapshotaktualitet. Inga privata data eller
externa system användes. En kvarhängande nästa-uppgift-rad om redan färdigt
klassbyte (TASK023) har tagits bort från slutet av TASK025-noteringen.

Beslut: egen CHANGE_ENTRY_IDENTITY, endast deltagarens tre textfält, exakt
versionsgrund, append-only journal och atomär audit. Ny import med avvikande
text efter journalförd rättning ska avvisas; identisk gammal fil förblir
skrivfri retry. Inga gamla resultat eller publicerade bytes ändras. Namn är
inte matchningsnyckel, klubben är inte ett globalt register och ingen ny
person/extern identitet skapas. Snapshotökning kräver fortsatt explicit
omräkning inför ny finalisering enligt befintlig regel.

Kontrakt för login, begränsad lista och rättningens request/response finns;
nya värden trimmas, förväntade/historiska värden bevaras exakt. Tester täcker
fältgränser, nullable klubb, CAS-underlag, strikt scope, faktisk ändring,
versionssteg, capabilityprefix och begränsad projektion. Detta är endast
kontraktsvalidering, inte bevis för serverbehörighet eller databasträttningar.

Migration, capabilitykoppling, tjänst/importskydd, journalens läskontrakt,
routes, UI och genomgående PG/browseracceptans återstår. TASK026 är inte klar.
Nästa minsta genomförandesteg inom samma snitt är den additiva journalen och
atomisk rättning/importspärr mot isolerad syntetisk PostgreSQL.

Exakta kontroller för denna kontraktsändring, alla exit0:

- `CI=true pnpm --filter @o-tid/contracts lint`
- `CI=true pnpm --filter @o-tid/contracts typecheck`
- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-identity-admin.test.ts`: 1 fil, 5 passerade, 333 ms.
- `CI=true pnpm --filter @o-tid/contracts build`

Inga PG-/browser-/hårdvaruprov kördes: inget server- eller UI-beteende är
infört i detta steg. Ingen full workspacebuild påstås. Antaganden att verifiera
i nästa steg: auth/atomisk retry under riktiga lås, importens rollback och
oförändrade gamla exportbytes. Fysisk mobil och produktionsvolymer återstår.

## 2026-09-09: TASK026, atomisk rättning och importskydd

Föregående målturn gav konkret progress med ADR/grundkontrakt. Nu finns
migration0041, separat capability/actor, racebundna journal-FK och immutable
update/delete-spärr, skyddad listtjänst och atomisk ändring av de tre fälten.
Entry/snapshot ökar ett; historiskt retry kräver samma actor/target/intent och
återger gammal kvittens utan ny audit. Import med avvikelse på tidigare rättad
entry ger hel rollback. Ingen UI/route eller credential-provisionering infördes.

Granskningen fann skillnad mellan ursprunglig ADR-gräns240 och befintligt
stationspakets max200 för klubb. ADR-0067 korrigerades före serveracceptans:
ny text max200, förväntad/historisk text max240. Paketformatet ändras inte.
Det riktiga signerade paketprovet täcker200 och mutation avvisar201.

Agent compact_overview_ui skrev fyra PG-prov; huvudagenten ägde implementation,
migration, dokumentation och körning. Första PG-körningen exit1 (3 fel/1pass)
berodde på testhjälpens sortering på iofImportRequests.id som inte finns.
Rättat till requestId. Riktad eslint hittade även osäker nested expect-matcher;
ersatt med typnarrowad jämförelse. Ingen produktregel försvagades för testen.

Slutliga resultat:

- `CI=true pnpm --filter @o-tid/contracts lint`, `typecheck`, `build`: exit0.
- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-identity-admin.test.ts`: 5pass, 322 ms, exit0.
- `CI=true pnpm --filter @o-tid/database lint`, `typecheck`, `build`: exit0.
- `CI=true pnpm --filter @o-tid/application lint`, `typecheck`, `build`: exit0, återkörda efter slutliga teständringar.
- `CI=true pnpm --filter @o-tid/web typecheck` och `build`: exit0.
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55440/otid_026_test pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK026|TASK 005G|TASK 006P'`: 18pass/118 bortvalda, 2.78 s, exit0.
- Samma kommando med `-t TASK026` efter sista testassertionen: 4pass/132 bortvalda, 2.37 s, exit0.

Nya prov verifierar verkligt fryst Complete/startliste-XML, oförändrade
raw/readouts/revisions/klass/brickor/övrigaentryfält, gammalt och nytt signerat
paket, retry efter senare rättning, auth/CAS/no-op/CSRF, två konkurrerande
actors med exakt en vinnare/journal, immutable journal och importrollback
efter tidigare rad i filen hunnit uppdateras. Identisk gammal contentretry och
matchande ny import fungerar fortsatt. Endast syntetiska data i ny isolerad
otid_026_test användes; inga privata/demo/Eventor-resurser berördes.

PG-/buildloggar: `/private/tmp/otid-026-pg.log`,
`/private/tmp/otid-026-pg-final.log`, `/private/tmp/otid-026-web-build.log`.
Testservern stoppad med pg_ctl exit0; syntetiska data bevaras. Ingen full
workspace/browser/hårdvarusvit kördes för detta serversteg.

TASK026 är inte klart: journalens skyddade läsväg, HTTP och kompakt UI återstår.
Separat overflowprov och samtidig import/rättning är fortfarande overifierade,
liksom fysisk mobil och produktionsvolymer. Huvudmålet/MeOS-paritet kvarstår.
Nästa minsta steg inom samma vertikala snitt: journalens läsväg och skyddade
HTTP-anrop, därefter koppling till deltagarlistans rättningsvy.

## 2026-09-09: TASK026, journalens läsväg och skyddade HTTP-routes

Föregående målturn gav konkret serverprogress. Nu finns strikt historikDTO
med högst50 poster, sjunkande unika entryversioner och inga actorcredentials.
Cursor v1 binder race/entry/exklusiv beforeEntryVersion; senare rättning
ändrar inte äldre sidor. Känd entry utan journal skiljs från404 efter auth.
ADR-0067 kompletterades före införandet. Service använder samma capability,
repeatable read och race SHARE. Historiska namn hämtas från journalen, inte
aktuella displayjoins.

Agent compact_overview_ui ägde fyra routefiler samt cookies/security/handlers
och tester. Main ägde kontrakt/tjänst/PG-prov, granskning och build. Egen
session/lista under entry-identity, PATCH entries/:entryId/identity och GET
entries/:entryId/identity/history. Origin/CSRF, auth före mutationens body,
strikt race/entry/request-bindning, private no-store och egna cookies. Reader
begränsar faktisk UTF-8-body till8192 byte; andra adminytor ändras inte.
No-store-path för kommande UI är /admin/:raceId/entry-identity.

Verifiering, slutliga kommandon exit0:

- `CI=true pnpm --filter @o-tid/contracts lint`, `typecheck`, `build`.
- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-identity-admin.test.ts`: 6pass, 338 ms.
- `CI=true pnpm --filter @o-tid/application lint`, `typecheck`, `build`, inklusive nya PG-prov.
- `CI=true pnpm --filter @o-tid/web lint`, `typecheck`, `build`.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-identity-admin-route-handlers.test.ts`: 7pass, 2.68 s (agentkörning).
- `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55440/otid_026_test pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t TASK026`: 7pass/132 bortvalda, 3.19 s.

PG använder endast vår syntetiska otid_026_test. Nya prov täcker äldre
journalblad efter en fjärde rättning, terminal/tom sida, fel scope/cursor/
auth, inga läswrites, overflow för både entry och race samt samtidiga
import-/rättningsanrop med endast ett helt vinnande tillstånd. Ingen claim att
alla möjliga låsscheman bevisats. Befintligt bytebevaringsprov kördes också.

Initial webtypecheck hittade saknad unionguard i route, rättad av agenten.
Initial applicationlint hittade onödig testassertion (!), borttagen utan
runtimeändring; alla slutkontroller ovan gröna. Ingen produktregel försvagades.
Loggar `/private/tmp/otid-026-history-pg.log` och
`/private/tmp/otid-026-http-build.log`. Testserver stoppad med pg_ctl exit0;
syntetiska data bevaras. Inga privat/demo/Eventor-filer eller databaser berördes.

TASK026 återstår: kompakt UI, betrodd credential-provisionering och verklig
browser→HTTP→PG-kedja. Routetester använder stubbtjänster; de ersätter inte
slutlig browseracceptans. Ingen ny full workspace-/hårdvarusvit behövdes för
detta steg; fysisk mobil/produktion/stor volym är overifierat.
Nästa minsta steg inom samma snitt är att koppla namn-/klubbvyn till
deltagarlistans Rätta-meny och verifiera hela spara/retry/historikflödet.

## 2026-09-09: TASK026, kompakt UI och genomgående browseracceptans

Föregående målturn slutförde HTTP/journalsteget. Agent compact_overview_ui
ägde UI/klient/i18n/page/scopedCSS och deltagargenväg. Main ägde betrodd
credential-CLI, dokumentation och verkliga HTTP/PG-browserprov samt granskning.
Ny Rätta→Namn och klubb använder bara flyktigt entry-id enligt ADR-0064.
Egen auth, explicit val, sök namn/klubb/klass, granska före/efter, samma frysta
request vid okänt svar och privat journalsidning finns. Inga automatiska
resultatändringar eller publiceringar. Empty klubb konverteras till null.

Logout tilläts efter review även under pågående anrop: omedelbar lokal
rensning/abort/generationbyte före serverlogout. Authfel och expiry döljer
persondata; pagehide/logout kastar minnesintent. Ingen Web Storage/URL-PII.
Efter authfel kan tidigare exakt request återupptas under ny auth; serverns
actorbindning gäller fortsatt. Inget nytt offline- eller synksystem infördes.

Slutliga kontroller, exit0:

- `CI=true pnpm --filter @o-tid/web lint` och `typecheck`.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-identity-client.test.ts src/lib/entry-navigation.test.ts src/lib/entry-identity-admin-route-handlers.test.ts`: 16pass i3filer,2.65s (agent;22:05:33svensk tid).
- `CI=true pnpm --filter @o-tid/web build`.
- `CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json` och `CI=true pnpm exec eslint scripts/entry-identity-access.ts`.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.entry-identity.json` och riktad eslint enligt AGENTS.
- Med DATABASE_URL=TEST_DATABASE_URL till isolerad otid_026_test:
  `CI=true pnpm exec playwright test --config tests/e2e/playwright.entry-identity.config.ts`: 2pass,17.7s.

Browser använder riktig Next/HTTP/PG och syntetiska deltagare på1366/390px:
startlisteauth→genväg→egen auth/explicit val→granskning utan writes→servercommit
följd av aborterat svar→byteidentiskt retry med samma nyckel/body→exakt en
journal och oförändrad annan entry/resultatmängd→synlig före/efterhistorik→
credentialspärr med PII-rensning. Desktop håller dessutom ett verkligt lässvar
över logout; det får inte återöppna vyn, och ny login fungerar. Bilder
granskade: desktopformulär/första journalpost ryms i900px, mobil utan
horisontellt överflöd. Stora tryckytor behålls.

Första grundbrowserkörningen:2pass,18.9s. Tillagt logoutprov hade ett
testselektorfel för select efter återlogin: snapshot visade comboboxen men
getByLabel exact matchade inte; ändrat till dess verifierade combobox-roll.
Mellanrun1fail/1pass,23.6s; slutrun ovan passerar utan ändrad produktlogik.
Initial e2etsc fångade fel namn på credentialId i test, rättat. Agentens
initiala lintkommentar hänvisade till ej installerad regel, borttagen.

Loggar `/private/tmp/otid-026-browser.log`,
`/private/tmp/otid-026-browser-final.log`, `/private/tmp/otid-026-ui-build.log`.
Testserver stoppad med pg_ctl exit0; syntetiska data bevarade. Browserns
server på3121 stoppas av Playwright. Inga riktiga credentials, privata
tävlingsdatabaser, Eventoranrop, originalkartor eller hårdvara berördes.

TASK026 är avgränsat klar. Tidigare kontrakts-/PG-bevis gäller oförändrad
server. Ingen full workspace-/hårdvarusvit påstås. Fysisk mobil, stora volymer,
verklig bfcache, produktion och direkt CLI-processprov kvarstår overifierade.
CLI:s bakomliggande issue/revoke-tjänster används av browserprovet; hemlig
utdata måste alltid omdirigeras avsiktligt privat. Huvudmålet/MeOS-paritet
är fortfarande inte klart.

Nästa minsta uppgift: göra deltagarlistan och namn-/klubbrättningen tillgängliga
i en separat lokal, syntetisk testtävling för manuell provning.

## 2026-09-09: TASK027, manuellt provbar syntetisk deltagartävling

Föregående målturn slutförde TASK026. TASK027 skrevs före operationerna.
Agent compact_overview_ui granskade befintlig demo-policy read-only: hela
schemat inklusive0041 upptäcks av tomhetsgrinden, originalmanifestet ska
behålla exakt tre roller och extra roller utfärdas efter provisioneringen.
Ingen produktkod/teknik/domängräns ändrades och inget nytt ADR behövdes.

Ny privat katalog `/private/tmp/otid-manual-027.XY2nPs` (0700), egen PostgreSQL
cluster i data/ på127.0.0.1:55441, databas otid_demo_20260909_participants.
Den är skild från automatiska testers55440 och alla äldre privat/demo-mål.
Lokal trust-auth används endast för syntetisk loopbackmiljö, inte produktion.
Initdb/start/createdb exit0, db:migrate exit0,42 migrationer genom0041.
demo:provision exit0 skapade ett lopp/två entries och originalroller i0600fil.
Separata start:list:access:issue och entry:identity:access:issue exit0, respektive
privat0600fil, giltiga till2026-09-10T03:16:01Z (05:16:01svensk tid).

Race6b44804f-c75f-4118-8726-9fad7446ea88, event22b91e0a-a9f7-4956-b448-af11234768ac.
Nya underlaget är Ada/Bo från repo-fixtures; inga verkliga tävlingsnamn/kartor/
API-nycklar hämtades eller ändrades. Båda entryversioner1 och rättningsjournal0
verifierades efter readiness, alltså inga provrättningar i manuell demo.

Webben lämnas aktiv på127.0.0.1:3002 med O_TID_LOCAL_DEMO=1 och separat
.next-local-demo. Livehandle execsession53159, lyssnare nodePID20643;
PostgreSQLPID20476. Kontrollera alltid aktuellt lsof/pg_ctl före senare åtgärd,
återanvänd aldrig lagrat PID blint. **Stoppa inte denna manuella cluster när
automatiska testkörningar på55440 stängs.** Privata loggar i ovanstående katalog.
Ingen annan server använder3002; gamla3001 var inte igång vid kontroll.

Verifierad HTTP-readiness med CLI-utfärdade credentials och utan tokenutskrift:
anonyma privata GET401, respektive login/read200, entryCount2, fel roll401,
logout204 och no-store för både VIEW_START_LIST och CHANGE_ENTRY_IDENTITY.
Sessionscookies hölls endast i kontrollprocessens minne och kontrollsessionerna
är utloggade. HTML-startlistan gav200. Första readinessförsöket exit1 berodde
på kontrollens felaktiga start-list/session-adress (404); kodens befintliga
start-list-session användes därefter och slutkontroll exit0. Ingen authpolicy
ändrades för att få kontrollen grön.

Guide docs/local-demo-20260909.md innehåller klickbar testlänk, privata filvägar,
manuellt flöde, exakt giltighet, återstart utan seed och scoped stopphantering.
Browseröppningen i Codex är köad via open_in_codex; nätadressen är redan
verifierat tillgänglig. Ingen privat browsersession eller offlinekö förbereddes.

TASK027 avgränsat klar. Ingen ny lint/typecheck/test/build-körning: detta var
provisionering med oförändrad produktkod, inte en implementation. TASK026:s
senaste lint/type/build och riktade browser/PG-bevis gäller. CLI issue är nu
även runtimeverifierat; direkt CLI-revoke, fysisk mobil, nätåtkomst från andra
enheter och produktion är inte verifierade. MeOS-paritet/huvudmålet kvarstår.

Nästa minsta vertikala produktuppgift: visa möjliga befintliga deltagare vid
direktanmälan, med dubblettvarning utan automatisk sammanslagning.

## 2026-09-12: TASK028 påbörjad; administratörsflöde omprioriterat

Föregående svar var en prioriteringsbekräftelse, inte färdig produktutveckling.
TASK028 och ADR-0068 skrevs före kod: separat begränsad kandidatsökning under
REGISTER_ENTRY, oförändrat skrivkontrakt och ingen automatisk sammanslagning.
Kontrakt och ren matchningsfunktion finns nu i contracts/application.
NFC/whitespace/svensk gemen, exakt helt namn, historisk brickägare som indata,
unika träfforsaker och max20 efter totalt träffantal täcks av riktade tester.
Ingen endpoint, databasläsning eller UI har kopplats in: TASK028 är inte klar.

Agent registration_review granskade read-only och bekräftade behovet av ADR
för den nya läsrätten. Den identifierade också befintliga UI-brister:
pendingpanelen visas utanför authenticated-guard, logout är busy-blockerad,
och sena svar saknar generation/abortskydd. Dessa måste hanteras innan mer
privat kandidatinformation läggs till. Agenten ändrade inga filer.

Exakta kontroller för denna delimplementation, samtliga exit0:
- CI=true pnpm --filter @o-tid/contracts lint
- CI=true pnpm --filter @o-tid/contracts typecheck
- CI=true pnpm --filter @o-tid/contracts build
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-registration-admin.test.ts test/entry-registration-candidates.test.ts
  — 2 filer,5 tester godkända,3,09s.
- CI=true pnpm --filter @o-tid/application lint
- CI=true pnpm --filter @o-tid/application typecheck
- CI=true pnpm --filter @o-tid/application build
- CI=true pnpm --filter @o-tid/application exec vitest run test/entry-registration-matching.test.ts
  — 1 fil,4 tester godkända,1,63s.

Ingen PostgreSQL/browser/hårdvara eller full workspace-svit kördes; denna
del ändrar enbart kontrakt och ren matchning, inte en aktiv produktväg.
Ingen riktig API-nyckel, originalfil, deltagardata eller manuell demo berördes.
Antagande: exakt namn är rådgivande och hittar inte stavfel; serverns race/
snapshot/brickägarskap och UI:s livscykel måste fortfarande verifieras.

Användaren omprioriterade under arbetet: en utsedd tävlingsadministratör ska
kunna göra vanliga tävlingsändringar med sammanhängande behörighet, inklusive
byte mellan tävlingsklass och öppen klass om plats finns. ADR-0018 visar att
separat funktionsinloggning valdes som ett tidigt avgränsat säkerhetssnitt,
inte som det önskade slutliga administratörsflödet. Behörighetssammanslagning
kräver ett nytt ADR före implementation; befintliga stations-/startroller
ska inte automatiskt få administratörsrätt.

Nästa minsta vertikala uppgift prioriteras därför till ett sammanhängande
klassbytesflöde för tävlingsadministratör: undersök nuvarande medlems-/rollstöd,
målklassens startregel och platsmodell, dokumentera beslut och implementera
utan separata funktionsnycklar för redan behörig administratör. TASK028-grunden
bevaras som ofärdig; inget påstående om MeOS-paritet eller färdig ny behörighet.

## 2026-09-12: TASK029, första gemensamma administratörsrollen på servern

Föregående målturn gav konkret kontrakts-/matchningskod och ny prioritering.
Nuvarande kod visar ingen generell medlemsmodell, klasskapacitet eller atomiskt
klass-/starttidsbyte. TASK029 och ADR-0069 skrevs före implementation. Målet är
sammanhängande tävlingsarbete, inte fler användarsynliga funktionsnycklar.

MANAGE_RACE använder samma credential/sessionlager med explicit ny prefix,
åttatimmars credential och entimmes session. Agent registration_review ägde
enbart authpolicy, dess rena test och klassbytets auditaktör. Huvudagenten
ägde kontrakt, migration0042, schema, PostgreSQL-test och dokumentation.
Rollens första godkända åtgärder är VIEW_RACE_OVERVIEW, VIEW_START_LIST och
CHANGE_ENTRY_CLASS; fler vyer integreras stegvis utan ny inloggning. Det är
inte en färdig bred administratörsroll och inte wildcard över nya capabilities.
Gamla credentials behåller exakt tidigare rätt. Principal, journal och audit
behåller verklig administratör; login/logout förblir bundna till verklig roll.

Ny isolerad PG-katalog /private/tmp/otid-029-pg.j8axXh, databas otid_029_test
på127.0.0.1:55442. Äldre sparad testkatalog fanns inte och återanvändes inte.
Initdb i sandbox exit1: delat minne blockerades. Samma initdb med godkänd
eskalering exit0; pg_ctl start och createdb exit0. Ingen annan databas eller
demo berördes. Migrationer genom0042 kördes av testerna. PG stoppad med
pg_ctl -m fast -w stop exit0 efter proven; syntetiska data bevarade.

Exakta slutresultat, samtliga exit0:
- CI=true pnpm --filter @o-tid/contracts lint / typecheck / build
  (tre separata kommandon).
- CI=true pnpm --filter @o-tid/database lint / typecheck / build
  (tre separata kommandon).
- CI=true pnpm --filter @o-tid/application lint / typecheck / build
  (tre separata kommandon).
- CI=true pnpm --filter @o-tid/web typecheck.
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/race-administrator.test.ts test/entry-class-admin.test.ts
  — 2 filer,7 tester godkända,458ms.
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil,2 tester godkända,223ms (agentkörning).
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK029|TASK 005H'
  — 1 fil,9 tester godkända,133 avsiktligt bortvalda,2,17s.

Första application-typecheck exit2 hittade två fel i ny testkod (fixture-DTO
saknade version; revoke tog Date, inte optionsobjekt). Rättat genom explicit
DB-läsning av entryversion och korrekt Date-argument; slutkontroll exit0.
Produktregler försvagades inte. PG-proven visar samma session genom tre
applikationsåtgärder, exakt retry/en journal, sann aktör, annan aktör nekad,
race/CSRF/rollgräns, expiry/revocation och DB-livslängdsvillkor.

Ingen HTTP/browser eller full workspace-/hårdvarusvit kördes i denna serverdel.
TASK029 är fortsatt ofärdig: ingen gemensam browserinloggning eller CLI ännu,
ingen klasskapacitet, inget nytt atomiskt starttidsbyte och ingen ändring i
den manuella demon. Antagande: nuvarande explicita racecredential är första
administratörstilldelning; ett konto-/medlemsregister för flera tävlingar
finns inte ännu. Ingen användarfil, Eventor-nyckel eller riktig hårdvara berördes.

Nästa minsta steg inom samma TASK029: koppla gemensam administratörsinloggning
och deltagar-/klassarbetsvy till den verifierade serverrollen utan extra
funktionsnycklar. Därefter slutförs plats-/starttidsdelen innan TASK029 är klar.

## 2026-09-12: TASK029, gemensam webbinloggning och klassarbetsvy

Föregående målturn etablerade serverrollen med riktig PostgreSQL-acceptans.
Den nya /admin/[raceId]/manage har nu en enda administratörsinloggning,
sökbar/paginerad deltagarlista och klassgranskning bredvid listan. Hemsidan
har en separat länk Tävlingsadministration; äldre arrangörsvyer bevaras.
Agent registration_review ägde komponent, CSS-modul, svensk text och page.
Huvudagenten ägde cookies, routes, routeprov, browserprov, CLI och dokument.
Bundlad Next-dokumentation lästes före webbarbetet.

Dedikerade /administrator/session, /participants och /entries/[entryId]/class
använder bara den gemensamma cookien och kräver faktisk MANAGE_RACE före data/
body. Ingen fallback från begränsade cookies. Befintliga applikationstjänster
och klassbytes-v1 återanvänds; ingen ny mutation eller schemaändring här.
Svaren har no-store, scopes och kvittensmål valideras. UI har generation/abort,
15s requestdeadline, sessionexpiry och pagehide-rensning; logout går även under
pågående request. Okänt commitsvar behåller exakt retryintent, aldrig nytt id.

CLI race:admin:access:issue/revoke och operationsguide finns. Inga credentials
utfärdades till riktig tävling eller manuell demo. CLI har typ-/lintkontroll,
men direkt CLI-processprov är ännu inte kört; backing issue/login/logout/
revocation är verifierade i server/browserproven. All persondata är syntetisk.

Slutkontroller, exit0:
- CI=true pnpm --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/web build (Next16.3.3; nya routes inkluderade)
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,5 tester godkända (första körning919ms; slutomkörning också grön).
- CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json
- CI=true pnpm exec eslint scripts/race-administrator-access.ts
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med samma DATABASE_URL/TEST_DATABASE_URL till isolerade otid_029_test:
  **2 godkända,6,7s**, bredder1366/390, riktig HTTP och PostgreSQL.

Första web-typecheck exit2: routeaction var union av två kind-värden i en
gren och kunde inte smalnas; ändrat till tre diskriminerade grenar. Första
browserkörningen fastnade på getByLabel för select trots synligt fält,
avbröts exit130. Ändrat test till getByRole combobox och inväntad initial
sessionskontroll. Nästa start exit1 på kvarvarande egen testserver3122;
lyssnare PID5335 identifierades och stoppades specifikt före grön omkörning.
Inga produkt-/säkerhetsregler försvagades för att få tester gröna.

Browserprovet bevisar en enda sessionscookie, klassbyte i PostgreSQL,
tappat commitsvar/exakt retry/en journal, rätt aktör, ingen resultatrevision,
ingen PII i Web Storage, ingen horisontell overflow och ett sent list-svar
efter logout som inte återöppnar data. Skärmbilderna i test-results granskades
visuellt: dator två arbetskolumner inom900px; mobil läsbar vertikal stapling.
Syntetiska fixtureklasser har PUNCH; FIXED-byte eller verkliga platsgränser
påstås inte vara verifierade. Testserver3122 avvecklad och PG55442 stoppad
med pg_ctl exit0; testdata bevarade i /private/tmp/otid-029-pg.j8axXh.

TASK029 fortfarande inte klar. Antaganden/overifierat: fysisk mobil, verklig
bfcache, stora deltagarvolymer, produktion och direkt CLI-processprov. Vyn
varnar uttryckligen att v1 inte ändrar fast starttid, kontrollerar platstak
eller räknar om resultat. Inget komplett medlemsregister finns ännu.

Nästa minsta del inom TASK029: atomiskt klass-/starttidsbyte från samma vy,
med målklassens faktiska startregel och historik. Platsgränsen följer inom
samma uppgift före full klassbytesacceptans; huvudmålet förblir aktivt.

## 2026-09-12: TASK029, atomiskt klass-/starttidsbyte genom hela arbetsvyn

Föregående målturn levererade gemensam webbinloggning och klassbytes-v1.
ADR-0069 kompletterades med fryst transferintent/egen journal innan kodning.
Contracts/schema/migration0043 och HTTP/browserprov ägdes av huvudagenten;
registration_review implementerade application och fyra PG-testgrupper;
transfer_ui uppdaterade endast arbetsvyns komponent/text/CSS efter Next-docs.

Ny transfer-candidates-projektion innehåller faktisk startregel/banversion,
entryversion, gammal fast tid och tävlingens datum/tidszon. Separat transfer
kräver samma MANAGE_RACE-session och granskat helt intent. Klass och tid
sparas tillsammans under race-/entrylås, med en entry-/snapshotökning,
immutable entry_transfer_request och sann adminaudit. Exakt retry returnerar
historiskt intent före aktuellt snapshot-CAS. PUNCH sparar null; FIXED kräver
explicit datum/klockslag/UTC-offset. UI gissar inte tid eller regel från namn.
Kvittensen binds till hela normaliserade intentet, inte bara målklass.

Gamla klassbytes-v1-journaler/routes är orörda. Ingen platstaksmodell är ännu
aktiverad och UI säger detta. Nytt paket använder nya uppgifter, äldre
paket/outbox/resultat/publiceringar skrivs inte om. Precision över ms i äldre
lagrad tid avvisas, inte avrundas. Import följer befintlig policy.

Exakta slutkontroller, exit0:
- CI=true pnpm --filter @o-tid/contracts lint / typecheck / build
  (tre separata kommandon).
- CI=true pnpm --filter @o-tid/database lint / typecheck / build
  (tre separata kommandon).
- CI=true pnpm --filter @o-tid/application lint / typecheck / build
  (tre separata kommandon; agentens nya service/test även riktat ESLint exit0).
- CI=true pnpm --filter @o-tid/web lint / typecheck / build
  (tre separata kommandon; Next16.3.3 produktionsbygge inkluderar nya routes).
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-transfer.test.ts
  — 1 fil,3 godkända,393ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-029-entry-transfer.test.ts
  — 1 fil,4 godkända,746ms.
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,6 godkända,1,11s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika DATABASE_URL/TEST_DATABASE_URL till otid_029_test: **2 godkända,7,6s**.

db:migrate exit0 till enbart isolerade otid_029_test på55442. PG-prov visar
verklig ingest före byte och bevarade raw/readout/result/card-rader, båda
bytesriktningar, historisk exactretry efter senare byte, stale/crossrace/actor/
CSRF-konflikter utan writes, en samtidig vinnare, overflow och immutablejournal.
Browser1366/390 kör hela HTTP/PG-kedjan PUNCH→FIXED→PUNCH, tappat första svar,
exakt retry och två avsiktliga journalposter, sedan logout/sent list-svar.
Ingen PII i Web Storage eller horisontell overflow. Mobilskärmbild granskad.

Första web/application-typecheck exit2 hittade fel import av lockRaceForSnapshot
i agentens nya service; rättad till concurrency, slutkontroller exit0. Agentens
första scoped lint hittade två oanvända bindningar; borttagna utan regeländring.
Ingen full workspace-/hårdvarusvit körd. PG55442 stoppad exit0 efter testerna,
syntetiska data kvar i /private/tmp/otid-029-pg.j8axXh. Inga riktiga tävlingar,
Eventor-nycklar, originalfiler eller manuella democredentials berördes.

TASK029 inte färdig: klassens platsgräns saknas fortfarande. Kvarvarande
antaganden/overifierat: antalskapacitet är inte startluckor, fysisk mobil,
produktionsdrift, stora volymer och verklig bfcache. Gamla v1-klienter ändrar
fortfarande endast klass. Ingen MeOS-paritet påstås.

Nästa minsta del inom TASK029: konfigurerbart platstak per klass som gäller
atomiskt även för direktanmälan, import och äldre klassbytesvägar, med samma
administratörsvy för att se och ändra taket. Ingen annan senare funktion startas.

## 2026-09-12: TASK029, deltagartak genom samma administratörsinloggning

ADR-0070 accepterades före implementation. Migration0044 lägger valfritt
maxEntries, separat capacityVersion och immutable ändringsjournal. En ren
gränsändring påverkar inte racesnapshot, entryversion, resultat eller paket.
Samma MANAGE_RACE-session granskar/sparar taket i en hopfälld inställningsdel.
Tomt betyder obegränsat, noll stänger tom klass; alla registrerade räknas.
Klassbyte visar antal/gräns och stoppar ny granskning av full målklass.

Application kontrollerar plats under gemensamt racelås för transfer,
direktanmälan, båda äldre klassbytesvägar och hela EntryList-importens slutläge.
Överfull import rullas tillbaka helt; byte av plats mellan fulla klasser tillåts
när slutläget ryms. Historiska exakta retries skapar inga nya writes.
Kapacitetsmutation har egen CAS/aktörsbunden retry/audit. Inga nya dependencies,
teknikval, AGPL-källor, externa API-anrop eller verkliga tävlingsdata användes.

registration_review ägde gemensam guard/writers och PG-testfil; transfer_ui
ägde komponent/text/CSS. Huvudagenten ägde ADR/schema/contracts/setter/HTTP,
browserintegration, slutkontroller och dokumentation.

Exakta slutkontroller (samtliga exit0):

- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/database --filter @o-tid/application --filter @o-tid/web lint
- Samma fyrpaketskommando med typecheck respektive build: exit0 båda.
  Produktionsbygget inkluderar kapacitetsroute och administratörsvy.
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/class-capacity.test.ts test/entry-transfer.test.ts
  — 2 filer,5 godkända,403ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run --no-file-parallelism test/integration/task-029-class-capacity.test.ts test/integration/task-029-entry-transfer.test.ts
  — 2 filer,8 godkända,1,21s.
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,7 godkända,849ms.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL: 2 godkända,9,7s.

Browser1366/390 provar gräns0→1, fullklasspärr, oförändrad racesnapshot efter
kapacitetsändring, samma login och verkligt PUNCH→FIXED→PUNCH inklusive tappat
transfersvar/exakt retry. Logout med sent listsvar, ingen PII i Web Storage
och ingen horisontell overflow kontrolleras också. Båda skärmbilder granskade.
PG provar samtidigt sista-platsen-race, historiskt setterretry/immutability,
alla skrivvägar, importrollback och byte mellan fulla klasser.

Ingen full workspace-/hårdvarusvit: riktade kontroller valdes för detta snitt.
Betrodd CLI-process har inte körts denna turn; dess bakomliggande rollfunktioner
är tidigare PG-verifierade. Fysisk mobil, verklig bfcache, stora volymer och
produktionsdrift återstår. Deltagartak är inte startluckereservation eller
automatisk kontroll av ålders-/klassbehörighet. Äldre funktionssidor delar inte
ännu denna webbsession; ingen full MeOS-paritet eller färdig produkt påstås.

PG55442 stoppad exit0; syntetiska data bevarade i
/private/tmp/otid-029-pg.j8axXh. Ingen lyssnare kvar på browserport3122
(lsof exit1 utan träff). Ingen manuell demo/privat tävling migrerad.

Klass-/starttids-/kapacitetssnittet är färdigt. Nästa minsta vertikala uppgift:
anslut befintligt brickbyte till samma administratörsinloggning och arbetsvy,
med bibehållen historik och utan ytterligare funktionsnyckel.

## 2026-09-12: TASK030, brickbyte med samma administratörsinloggning

Föregående målturn var konkret progress: klass-/starttids-/kapacitetsflödet
verifierades. Denna turn fortsatte med nästa vardagsåtgärd i samma vy.
ADR-0071 skrevs före implementation. Ingen schemaändring: befintlig
brickbytesjournal stöder verklig administratörscredential. Explicit policy
ansluter CHANGE_ENTRY_CARD och audit väljer korrekt faktisk aktör.

Gemensamt kandidatunderlag innehåller aktiv bricka/flerkopplingskonflikt i
samma låsta repeatable-read som klass/start/version. Ny dedikerad admin-PATCH
återanvänder brickbytestjänsten med hela intentet kontrollerat mot kvittensen.
UI visar aktuell/ny bricka vid vald deltagare, söker även aktivt nummer och
har gemensamt väntande intent för transfer, kapacitet och brickbyte. Ingen
extra login, automatisk omräkning eller beständig klientkö tillkommer.

registration_review ägde policy/audit/projektion och nytt PG-prov; transfer_ui
ägde komponent/text/CSS. Huvudagenten ägde ADR/contracts/HTTP/browser/docs och
slutverifiering. Inga externa källor, dependencies, API-nycklar eller verkliga
tävlings-/kartfiler användes.

Exakta slutkontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-card-admin.test.ts test/entry-transfer.test.ts
  — 2 filer,5 godkända,373ms.
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil,2 godkända,185ms.
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,8 godkända,846ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK 006P'
  — 1 fil,4 godkända,138 avsiktligt bortvalda,1,57s.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run --no-file-parallelism test/integration/task-030-administrator-card.test.ts test/integration/task-029-entry-transfer.test.ts
  — 2 filer,6 godkända,1,12s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL: 2 godkända,10,9s.

Totalt27 godkända riktade testfall. Browser1366/390 visar gräns0→1,
PUNCH→FIXED→PUNCH och därefter brickbyte med samma session. Både transfer och
brickbyte provas med tappat commitsvar/exakt retry. Brickjournalen har en post,
gammal bricka finns kvar inaktiv och audit anger verklig admin. Båda
skärmbilder granskade; ingen horisontell overflow, inget PII i Web Storage och
logout/sent listsvar återöppnar inte data. PG provar även faktiskt rådata/
resultatbevarande, egen återaktivering, historiskt retry efter senare byte,
nekad annan aktör och annans historiska bricka samt flera aktiva kopplingar.

Ingen full workspace-/hårdvarusvit kördes; riktade regressionsgrupper valdes
för proportionerlig verifiering. Fysisk mobil, riktig bfcache, produktion och
stora datavolymer återstår. Byte kräver server. Äldre strikt underlagsklient
kan behöva omladdning med denna release. Administratörsrollen är ännu explicit
racecredential, inte färdigt webbhanterat medlemsregister, och övriga äldre
funktionssidor är inte automatiskt integrerade. Ingen MeOS-paritet påstås.

Test-PG55442 stoppad exit0, data bevarade i /private/tmp/otid-029-pg.j8axXh.
Ingen lyssnare kvar på3122 (lsof exit1 utan träff). Ingen manuell/privat demo
migrerad eller uppdaterad. TASK030:s snitt är klart, huvudmålet kvarstår.

Nästa minsta vertikala uppgift: individuell starttidsrättning utan klassbyte
i samma administratörsvy och session, med befintlig historik och exakt retry.

## 2026-09-12: TASK031, starttidsrättning och kompakt gemensam arbetsvy

Föregående målturn var progress: brickbyte integrerades och verifierades.
Denna turn ansluter individuell starttidsrättning enligt ADR-0072, skriven
före implementation. Samma adminroll får uttryckligen CHANGE_ENTRY_START_TIME,
med faktisk auditaktör och befintlig immutable journal utan migration.
FIXED kan rättas utan klassbyte; PUNCH och null som ny tid avvisas som tidigare.

SQL-precisionskontroll införs för listning, aktuell entry och journalens
båda tider före Date-konverterad jämförelse. Mikrosekunder får aldrig tyst
avrundas till godkänt intent/kvittens. Giltigt historiskt retry behandlas
fortfarande före kontroll av dagens entry. Inga rådata/resultat skrivs om.
Ny admin-PATCH verifierar hela normaliserade intentet mot kvittensen.

UI visar endast vald åtgärd: Klassbyte, Brickbyte eller Starttid, med samma
deltagare/session. Starttidsgranskning fryser tävlingszon och explicit
datum/tid/offset. Gemensamt pendingläge spärrar vybyte/andra mutationer under
granskning och okänt svar; logout förblir tillgängligt. Ingen ny beständig kö.

registration_review ägde application/policy och PG-testfil; transfer_ui ägde
komponent/text/CSS. Huvudagent ägde ADR/HTTP/browser/docs/slutverifiering.
Inga nya dependencies, externa API-anrop, privata filer, verkliga tävlingar
eller hårdvaruändringar. Arkitektur/domängränser bevaras.

Exakta slutkontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,9 godkända,958ms.
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil,2 godkända,195ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK 006O'
  — 1 fil,3 godkända,139 avsiktligt bortvalda,1,32s.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-031-administrator-start-time.test.ts
  — 1 fil,3 godkända,1,19s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL: 2 godkända,12,8s.

Totalt19 riktade godkända testfall. Browser1366/390 provar gränssättning,
PUNCH→FIXED, tidsrättning12:30→12:32:00.125, tillbaka till PUNCH och brickbyte.
Alla tre mutationstyper provas med tappat commitsvar och identiskt retry;
tidsjournalen visar en post och oförändrad klass. PUNCH saknar tidsformulär,
åtgärdsbyte är spärrat under granskning, och samma sessionscookie används.
Logout/sent svar, Web Storage och horisontell overflow provas som tidigare.
Båda slutskärmbilder granskade: ett formulär i taget, kortare sida.
PG visar verklig admin/begränsad audit, bevarad klass/raw/readout/result,
historiskt retry, precision i current/journal och oförändrad immutability.

Ingen full workspace-/hårdvarusvit; riktade regressioner valdes proportionerligt.
Fysisk mobil, verklig bfcache, stora volymer och produktion är inte verifierade.
Ingen startlucka reserveras och sparad starttid räknar inte om gamla resultat.
Gemensam inloggning är ännu racecredential, inte webbhanterat medlemsregister;
alla äldre funktionssidor är inte integrerade. Ingen full MeOS-paritet påstås.

PG55442 stoppad exit0, syntetiska data bevarade i /private/tmp/otid-029-pg.j8axXh.
Ingen lyssnare på3122 (lsof exit1 utan träff). Inga privata/manuella demos
migrerade. TASK031:s snitt är klart; produktens huvudmål kvarstår.

Nästa minsta vertikala uppgift: explicit omräkning av vald deltagares resultat
efter klass-/brick-/starttidsändring i samma administratörsvy och session.

## 2026-09-12: TASK032, explicit omräkning med gemensam inloggning

Föregående målturn var progress: starttidsrättning och kompakt åtgärdsväljare.
ADR-0073 skrevs före denna implementation. RECALCULATE_RESULT är nu uttryckligt
integrerad med verklig adminaudit; befintlig tjänst, immutable journal och
publicerad teknisk revision återanvänds utan schema-/resultatregeländring.

Ny admin-GET läser omräkningskandidater och POST skapar granskad revision.
Kvittensen binds till request/race/entry/readout, revision, snapshot och motor.
UI hämtar roster+kandidater vid val av Omräkning och kontrollerar matchande
entry/klass/version/snapshot/kortkoppling innan granskning. Ett gemensamt
pendingintent bevarar exakt retry; ingen automatisk omräkning eller klientkö.
Varning skiljer teknisk revision från effektivt resultat med manuella beslut.

registration_review ägde policy/audit/PG-prov; transfer_ui komponent/text/CSS.
Huvudagenten ägde ADR/routes/browser/docs/slutkontroller. Ingen extern källa,
dependency, migration, riktig tävling, privat fil eller API-nyckel användes.

Slutkontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,10 godkända,1,15s.
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil,2 godkända,194ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK 005I'
  — 1 fil,11 godkända,131 avsiktligt bortvalda,1,65s.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-032-administrator-recalculation.test.ts
  — 1 fil,2 godkända,900ms.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL: 2 godkända,14,9s.

Totalt27 godkända riktade testfall. Browser1366/390 kör tidigare gemensamma
klass-/start-/brickkedjan, nu med syntetisk ingest och explicit omräkning efter
starttid12:30→12:32:00.125. Ny teknisk OK-revision har elapsedMs1079875 och
snapshot3; gammal revision och raw är oförändrade. Tappat svar/exakt retry
ger en journalpost och en ny revision, samma adminsession/audit. PG verifierar
verklig manuell DSQ som fortsatt effektiv publik revision efter tekniska
omräkningar av både admin och begränsad operatör; gamla beslut/raw/revisioner
och entry/snapshot bevaras. Historiskt retry, annan aktör och stale avvisas
korrekt. Journalimmutability kvar. Båda slutskärmbilder granskade; fyrvalet
fungerar i mobil2×2 utan horisontell overflow. Logout/sent svar/Web Storage
kontrolleras i samma browserkedja.

Ingen full workspace-/hårdvarusvit körd; fokuserade regressioner är valda för
denna integration. Fysisk mobil, riktig bfcache, stora volymer och produktion
återstår. Kvittensen visar tekniskt utfall, inte resolverat effektivt resultat.
Frysta exporter och manuella beslut kräver fortsatt sina explicita livscykler.
Gemensamt medlemsregister/all funktionsintegration och MeOS-paritet återstår.

PG55442 stoppad exit0; syntetiska data bevarade i /private/tmp/otid-029-pg.j8axXh.
Ingen lyssnare kvar3122 (lsof exit1 utan träff). Inga manuella/privata demos
migrerade. TASK032:s avgränsade flöde är klart, huvudmålet kvarstår.

Nästa minsta vertikala uppgift: visa vald deltagares effektiva resultat och
gällande manuella beslut i samma administratörsvy efter omräkning.

## 2026-09-12: TASK033, gällande resultat i gemensam administratörsvy

ADR-0074 skrevs före implementation. En läsning för exakt MANAGE_RACE hämtar
senaste publicerade revision och använder befintlig central resolver i en
repeatable-read-transaktion med racelås. Ingen resultatregel, migration eller
publicering har tillkommit. Inget publicerat resultat och återtaget resultat
skiljs åt. Äldre styrande manuellt beslut kan visas över nyare teknisk revision.
Historisk resultatklass och resultatunderlag skiljs från deltagarens nuvarande
klass och snapshot. Rådata exponeras inte.

Den kompakta deltagarvyn visar status, tillåten tid, styrande beslut, historisk
klass, äldre underlag och lästid. Samma klientoperation/session används;
resultatfel visas separat från ändringskvittensen. Ingen polling eller offlinekö.
registration_review ägde application/PG-prov, transfer_ui komponent/text/CSS;
huvudagenten kontrakt/HTTP/browser/ADR/dokumentation/slutkontroller.

Slutkontroller, samtliga exit 0:

- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/administrator-effective-result.test.ts
  — 1 fil, 2 godkända, 224ms.
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil, 11 godkända, 1,81s.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-033-administrator-effective-result.test.ts
  — 1 fil, 3 godkända, 867ms.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 2 godkända, 16,4s.

Totalt 18 riktade testfall godkända. PostgreSQL verifierar bland annat DSQ
över senare teknisk revision, återtaget DNS, NT utan tid och oförändrat lagrat
underlag vid läsning. Browserkedjan på 1366/390px verifierar saknat resultat,
OK 17:59.875 efter omräkning och historisk klass efter klassbyte. Båda
skärmbilder granskade; ingen horisontell overflow. Befintlig exakt retry,
utloggning och gemensam session ingår fortsatt i kedjan.

Avgränsningar/antaganden: central resolver återanvänds; alla beslutstyper har
inte egna nya PG-fall i detta snitt. Lästid är inte ett löfte om liveuppdatering
eller slutgiltig export. Ingen full workspace- eller hårdvarusvit kördes;
riktade kontroller valdes efter ändringens omfattning. Fysisk mobil, stora
volymer och produktion är inte verifierade. Gemensamt medlemsregister och
återstående funktionsintegration/MeOS-paritet kvarstår.

PG55442 stoppad exit 0; syntetiska data bevarade i /private/tmp/otid-029-pg.j8axXh.
Ingen lyssnare kvar på3122 (lsof exit 1 utan träff). Inga riktiga tävlingar,
privata filer, Eventornycklar eller manuella demos användes eller migrerades.
TASK033 är avgränsat klar; produktens huvudmål kvarstår.

Nästa minsta vertikala uppgift: namn-/klubbrättning för vald deltagare med
samma tävlingsadministratörsinloggning.

## 2026-09-12: TASK034, verifierad integrationsgräns före kod

Föregående målturn var progress: TASK033 avslutades med dokumenterade gröna
kontroller. Aktuella instruktioner och arkitektur har lästs; samma två agenter
gjorde read-only granskning av service/databas respektive klient/UI.

Granskningen bekräftar att migration0041:s capability-check bara tillåter
CHANGE_ENTRY_IDENTITY och att actor-FK binder verklig credential/race/capability.
Enbart policy/knapp skulle alltså inte fungera. ADR-0075 beslutar en begränsad
utökning av checken, verklig aktörsjournal och återanvändning av befintlig tjänst.
TASK034 beskriver hela snittet. Separat identity-list väljs för strukturerade
namn, utan att gissa genom att dela displayName eller bredda transferkontraktet.

Denna del har endast ändrat dokument. Ingen migration, tjänst eller browser
har aktiverats och inga tester/build körts för TASK034 ännu. Tidigare gröna
TASK033-resultat är inte acceptansbevis för den nya funktionen. Nästa arbete
är implementation och genomgående verifiering av samma TASK034, inte nytt snitt.

## 2026-09-12: TASK034, namn-/klubbrättning genomgående klar

Föregående målturn var progress: konkret databasgräns verifierades och ADR-0075
skrevs före kod. Nu är samma snitt implementerat. registration_review ägde
migration0045/schema/application/policy/PG-prov; transfer_ui ägde formulär,
svenska texter och CSS; huvudagenten HTTP, browser, granskning och slutkontroller.

MANAGE_RACE får uttrycklig rätt till befintlig CHANGE_ENTRY_IDENTITY-tjänst.
Journal och audit behåller verklig capability/aktör; composite-FK och immutable
historik kvar. Separat kandidatläsning ger strukturerade namn. Femte åtgärden
delar session/operation/pending, visar före/efter och återförsöker exakt samma
request vid tappat svar. Nytt namn filtreras inte bort av föregående söktext.
Ingen dependency, extern källa eller ny resultatregel infördes.

Slutkontroller, samtliga exit 0:

- CI=true pnpm --filter @o-tid/database --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/database --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/database --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil, 12 godkända, 1,11s.
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/entry-identity-client.test.ts
  — 1 fil, 3 godkända, 404ms.
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil, 2 godkända, 151ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-034-administrator-identity.test.ts
  — 1 fil, 2 godkända, 751ms; migration0045 applicerad enbart i testdatabasen.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t TASK026
  — 1 fil, 7 godkända, 135 avsiktligt bortvalda, 1,29s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 2 godkända, 18,5s.

Totalt28 riktade testfall godkända. Browser1366/390 provar hela kedjan med
samma session, inklusive namn/klubb efter klass/start/omräkning/brickbyte,
tappat svar och exakt retry. En identityjournal, verklig adminaudit,
entry/snapshot5→6, oförändrade resultat/raw/brickkopplingar. Båda skärmbilder
granskade; femvalet ryms utan horisontell overflow och bara valt arbetsområde
visas. PG provar även begränsad rättare efter admin, historiskt retry,
stale/no-op/CSRF och felaktig actor/capability som avvisas av kvarvarande FK.

Antaganden/avgränsningar: klubb är fortsatt lokal fritext, inte medlemsregister.
Aktuellt namnunderlag krävs före ytterligare rättning. Frysta publiceringar
ändras inte; befintlig snapshotregel kan kräva explicit omräkning före ny
finalisering. Fysisk mobil, stor tävling och produktion är inte verifierade.
Ingen full workspace-/hårdvarusvit kördes; riktade regressioner valdes efter
ändringens risk. Inga riktiga tävlingar, privata filer eller Eventornycklar
användes, och inga manuella demodatabaser migrerades.

PG55442 stoppad exit0; syntetiska data bevarade. Browser3122 har ingen lyssnare
(lsof exit1 utan träff). TASK034 är avgränsat klar; hela produktmålet kvarstår.

Nästa minsta vertikala uppgift: direktanmälan till befintlig klass med samma
tävlingsadministratörsinloggning och befintlig platskontroll.

## 2026-09-12: TASK035, direktanmälan med samma session

Föregående målturn var progress: namn-/klubbrättning integrerades/verifierades.
ADR-0076 skrevs före implementation efter read-only granskning av befintlig
registrering/journal. Ingen migration behövdes: journalen binder redan verklig
actorcredential och har ingen begränsande capability-check. REGISTER_ENTRY
är explicit åttonde integrerade åtgärd; adminaudit har rätt aktörstyp.

Ny deltagare i listans toolbar öppnar registrering utan vald entry. Befintlig
roster ger klass/bana/startregel och kapacitet; samma operation/pending används.
PUNCH har null tid, FIXED kräver explicit tidsgrund. Full klass blockerar
granskning och serverns race-låsta platskontroll gäller vid commit. POST har
4KiB-gräns och delad ren full kvittensvalidering. Efter kvittens väljs skapad
entry i ordinarie arbetsvy. Ingen automatisk namndeduplicering eller resultatstatus.

registration_review ägde application/policy/PG-prov, transfer_ui workspace/
svenska texter/kvittenshelper, huvudagenten ADR/HTTP/browser/granskning/docs.
Inga externa källor, dependencies, riktiga tävlingsdata eller API-nycklar användes.

Slutkontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,13 godkända,1,08s.
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil,2 godkända,168ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-035-administrator-registration.test.ts
  — 1 fil,2 godkända,724ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-001.test.ts -t 'TASK 006Q'
  — 1 fil,3 godkända,139 avsiktligt bortvalda,1,14s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — slutkörning2 godkända,20,0s.

Första browserkörningen gav exit1: båda fall timeout60s vid getByLabel exakt
Anmälningsklass. Snapshot visade korrekt combobox; testet ändrades till
getByRole combobox med exakt tillgängligt namn, varefter samma fulla kedja
passerade. Ingen produktbarriär försvagades och inget fall valdes bort.

Totalt22 riktade testfall godkända. Browser1366/390 använder riktig HTTP/PG:
fri registrering utan bricka, minutregistrering med bricka och exakt
12:40:00.125+02, tappat svar/exakt retry med en journal, fullklassspärr samt
fortsatt brickbyte av nya deltagaren. Endast två anmälningar, korrekt audit,
oförändrade tidigare resultat/raw. Båda registreringsskärmbilder granskade;
ingen horisontell overflow. Mobilen har vertikal scroll för hela arbetsytan,
inte komprimerad text eller små tryckytor.

Avgränsningar/antaganden: ingen automatisk dubblettkontroll eller reserverad
startlucka. TASK028:s rådgivande sökning är fortfarande separat/oavslutad.
Platsläge kan ändras före commit. Fysisk mobil, stor tävling och produktion
är inte verifierade; ingen full workspace-/hårdvarusvit kördes eftersom
riktade regressioner valdes efter ändringens risk. Inga privata/manuella
databaser migrerades. PG55442 stoppad exit0 med syntetiska data bevarade;
ingen lyssnare kvar3122 (lsof exit1 utan träff). Huvudmålet kvarstår.

Nästa minsta vertikala uppgift: visa rådgivande träffar på redan registrerad
deltagare före direktanmälan, utan automatisk sammanslagning.

## 2026-09-12: TASK036, dubblettvarning i gemensam direktanmälan

Föregående målturn var progress: direktanmälan integrerades och verifierades.
ADR-0077 skrevs före kod och återanvänder ADR-0068:s kontrakt/matchningsregel.
registration_review ägde application/export/PG-prov, transfer_ui panel/texter/
CSS, huvudagenten HTTP/browser/ADR/granskning/slutkontroller och dokumentation.

Skrivfri REGISTER_ENTRY-läsning använder skyddad RR/CSRF/race SHARE och exakt
snapshot. Vänsterjoin bevarar trasiga klassrelationer för avslag; max10000
kontrolleras före matchning. Historisk brickägare inkluderas även inaktiv.
Max20 kandidater med exakt totalantal; inga kontaktuppgifter eller rådata.
Gemensam admin-POST använder4KiB och no-store. Granskad namnträff kräver
checkbox, brickträff spärrar anmälan. Befintlig deltagare kan väljas utan
utkastkopiering. Okänt commitsvar retryas utan omsökning eller nytt beslut.

Slutkontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,14 godkända,910ms.
- CI=true pnpm --filter @o-tid/application exec vitest run test/entry-registration-matching.test.ts
  — 1 fil,4 godkända,146ms.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-036-administrator-registration-candidates.test.ts
  — 1 fil,3 godkända,718ms.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 2 godkända,22,4s.

Totalt23 riktade testfall godkända. PG provar23 matchningar med20 visade,
normalisering över klass/klubb, inaktiv bricka, andra lopp, stale/CSRF/roll,
ärligt nollresultat, trasiga relationer och oförändrat underlag vid läsning.
Browser1366/390 provar historisk brickspärr, välj befintlig, namncheckbox och
avsiktligt två skilda entries med samma namn. Tappat dubblettregistreringssvar
ger exakt retry med oförändrat antal kandidatsökningar (fyra) och endast en
ny journal. Registrerings-/rättningskedjan och logout ingår fortsatt.
Båda kandidatskärmbilder granskade; ingen horisontell overflow, läsbara knappar.

Avgränsningar: ingen fuzzy-/felstavningsmatchning och ingen unikhetsgaranti
för personer. Ingen reservation eller förändrad serverregistreringsregel.
Sökfel behandlas som fel, men nätfel under just kandidatsökningen har inget
eget nytt browserfall i detta snitt. Fysisk mobil, stor tävling och produktion
är inte verifierade. Full workspace-/hårdvarusvit kördes inte; riktade tester
valdes för denna läs-/UI-integration. TASK028:s separata operatörs-HTTP/UI
återstår och markeras inte klar genom TASK036.

Ingen migration, dependency, extern källa/API eller riktig tävlingsdata
användes. PG55442 stoppad exit0, syntetiska data bevarade; ingen lyssnare3122
(lsof exit1 utan träff). Produktens huvudmål är fortfarande inte uppnått.

Nästa minsta vertikala uppgift: kompakt mobilväxling mellan deltagarlista och
valt arbetsformulär, så direktanmälan/rättning kräver mindre vertikal scroll.

## 2026-09-12: TASK037 kompakt mobil administration

Klart avgränsat webbsnitt. Vid <=720px visas deltagarlista eller arbetsvy;
dator behåller två kolumner. Deltagarval/Ny deltagare öppnar arbetsvyn och
explicit mobilnavigation flyttar fokus. Båda panelerna behålls i DOM så ren
växling inte tappar utkast. Pending spärrar växling; status, logout och
deltagargränser ligger utanför. Inga API-/domän-/behörighetsändringar eller
ny ADR behövdes. Oberoende kodgranskning gav inga konkreta fynd.

Slutkontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/web build
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika DATABASE_URL/TEST_DATABASE_URL till isolerad otid_029_test:
  2 godkända,23,1s. Föregående körning också 2 godkända,23,8s före extra
  assertioner för sökbevarande och inga API-anrop vid ren växling.

Browserkedjan använder syntetiska deltagare, riktig Next/HTTP/PostgreSQL.
Mobilens list-/arbetsväxling, fokus, bibehållen sökning/starttidsutkast,
spärrat vybyte vid okänt commitsvar och tidigare spar-/retrykedja passerar.
Mobilregistrering och desktopöversikt visuellt granskade; ingen horisontell
overflow. Ingen extra enhetssvit eller full workspace-/hårdvarusvit för denna
presentationsändring. Reauth med pending kodgranskat, inte separat nytt
browserprov. Fysisk mobil, stor tävling och produktion återstår att verifiera.

PG55442 stoppad exit0, syntetiska data bevarade. Ingen lyssnare3122 (lsof
exit1 utan träff). Inga riktiga tävlingsuppgifter, API-nycklar eller hårdvara
användes. Huvudmålet är fortsatt aktivt och inte uppnått.

Nästa minsta vertikala uppgift: visa redan tilldelade starttider i målklassen
vid klassbyte, så administratören får underlag att välja minutstart utan
ytterligare inloggning. Detta ska inte påstå att en startlucka reserverats.

## 2026-09-12: TASK038 målklassens tilldelade starttider

Klart avgränsat webbsnitt. Klassbyte till FIXED visar utfällbart underlag från
befintlig validerad transfer-roster: namn och fasta tider i tävlingens tidszon,
kronologiskt efter tidsögonblick,20 rader/sida och separat antal utan tid.
Målklass/snapshotbyte återställer sidan. Rullområdet har begränsad höjd och
fokuserbar region; sidknappar ligger utanför. Fri start har ingen tidstabell.
Likadan tilldelad instant ger synlig rådgivande varning, inte nytt hinder.
Ingen ny request, reservation, startregel, domänlogik eller ADR infördes.

Slutkontroller, exit0:

- CI=true pnpm --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/target-class-start-times.test.ts src/lib/start-list-time.test.ts
  — 2 filer,5 godkända,212ms.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL:3 godkända,24,0s.
- Efter sista tabellhöjdsjusteringen samma browserkommando med --grep TASK038:
  1 godkänt,7,3s. De två äldre fallen återkördes inte för denna wrapper.

Totalt8 olika riktade testfall godkända. Initial UI-lint innan helperfilen
hade integrerats gav exit1/22 följdfel för saknad typ; slutlig lint/typecheck
är godkända utan undantag. Inga browserfel. Readonly review identifierade lång
utfälld mobiltabell; begränsad tabellhöjd och öppna skärmbilder tillkom därefter.

Helperproven täcker offsets/dygn, stabil sortering, exakt millisekund, null och
klassavgränsning. Browser har22 tilldelade tider plus null/annan klass:20+2
rader via sidbyte, reset vid klassbyte, PUNCH döljer, svensk datum/zon visas.
Inmatad annan offset till samma instant varnar och kan ändå sparas som ett
verkligt klassbyte med en journal. Läs-/sidväxling gör inga nya API-anrop.
Mobil390/dator1366 granskade med utfälld tabell och utan horisontell overflow.

Antaganden/avgränsningar: endast senaste inlästa roster, ingen live-/luck-
reservation, startintervall eller kontroll mot annan klass/gemensam bana.
Fysisk mobil, stora tävlingar och produktion ej verifierade. Full workspace-
och hårdvarusvit kördes inte för denna rena webbprojektion. Ingen riktig
tävlingsdata, extern tjänst, ny dependency eller migration användes.
PG55442 stoppad exit0 och syntetiska data bevarade; ingen lyssnare3122
(lsof exit1 utan träff). Huvudmålet kvarstår, inte markerat komplett.

Nästa minsta vertikala uppgift: deltagarens ändringshistorik åtkomlig med
samma administratörsinloggning från den gemensamma arbetsvyn.

## 2026-09-12: TASK039 journalförda deltagarändringar

Klart avgränsat snitt enligt ADR-0078 (skriven före implementation).
Historik i gemensam arbetsvy läser sex befintliga journaler: äldre klassbyte,
klass/startbyte, brickbyte, individuell starttid, namn/klubb och direktanmälan.
Samma MANAGE_RACE-session, ingen ny funktionsinloggning. RR/race SHARE,
race-/entryrelationer, lagrade intents och versioner valideras i application.
Frysta värden visas före/efter, klassnamn uttryckligen enligt dagens register.
20 poster/sida via exklusiv deltagarversion; ingen ny write eller migration.
Normala mikrosekundtidsstämplar serialiseras exakt; starttidsvärden avrundas inte.

Slutkontroller, alla exit0:

- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/contracts exec vitest run test/administrator-entry-changes.test.ts
  — 1 fil,3 godkända,179ms.
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,15 godkända,1,22s.
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-039-administrator-entry-changes.test.ts
  — 1 fil,4 godkända,744ms (agentens slutkörning).
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med samma isolerade DATABASE_URL/TEST_DATABASE_URL — 3 godkända,27,0s.

25 olika riktade testfall godkända. Inledande kontraktstypecheck exit2 och
lint exit1 berodde på testets toReversed utanför befintligt TS-lib; ändrat
till kopia+reverse utan teknikbyte. Initial sandbox-PG nekades EPERM;
eskalerat isolerat loopbackprov passerade. Inga browserfel.

PG visar sex källor, frysta värden/oförändrad DB, pagination, nekad begränsad
roll/annan entry, dubblett-/framtidsversioner, finare starttid och främmande
klassrelation. Browser390/1366 visar5 journalposter efter faktisk sparkedja,
korrekta namn-/brickföre/efter, rensning vid simulerat nätfel och lyckad
uppdatering. Nyregistrerad deltagare visar endast egen anmälan. Befintliga
klass-/start-/registreringsretry och logout passerar. Historikskärmbilder
granskade; utfällbara detaljer håller listan överskådlig.

Avgränsningar: resultat, import, lottning och avprickning ingår inte i denna
historiklista, vilket UI anger. Klassenamnen är aktuella, inte frysta gamla
visningsnamn. UI-pagination för21+poster har inte ett separat browserfall;
serverpagination är PG-verifierad. Fysisk mobil, stor tävling och produktion
ej verifierade. Ingen full workspace-/hårdvarusvit för detta avgränsade snitt.
Inga riktiga tävlingsdata, externa API:er eller nya dependencies användes.
PG55442 stoppad exit0 med syntetiska data kvar; ingen lyssnare3122 (lsof
exit1 utan träff). Huvudmålet är fortfarande aktivt, inte komplett.

Nästa minsta vertikala uppgift: markera en deltagare som ej startande från
den gemensamma administratörsvyn med befintlig besluts-/historikmodell.

## 2026-09-12: TASK040 ej start och återtagande

Klart avgränsat snitt. ADR-0079 skrevs före implementation och ersätter
separat funktionslogin för administratörens DNS/withdrawal, inte äldre
begränsade roller eller befintlig resultatpolicy. Policylistan har nu10
integrerade åtgärder. Båda tjänster skriver sann RACE_ADMIN_ACCESS_CREDENTIAL
för admin; replay och immutable original är oförändrade. Fyra gemensamma
HTTP-routes och en Ej startande-arbetsvy använder befintliga kontrakt/helpers.

Slutliga kontroller, exit0:

- CI=true pnpm --filter @o-tid/application lint
- CI=true pnpm --filter @o-tid/application typecheck
- CI=true pnpm --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 1 fil,2 godkända,168ms (agentens körning).
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-040-administrator-did-not-start.test.ts
  — 1 fil,2 godkända,807ms (agentens körning).
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
  — 1 fil,16 godkända,1,05s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK040
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 1 godkänt,9,2s.

Den fulla riktade browserfilen kördes först utan grep: exit1,3 godkända och
1 fel,35,2s. Felet var testets textförväntan Ej startande medan befintlig
resultatremsa säger Ej start. Endast assertionen rättades, sedan återkördes
TASK040. Totalt24 olika riktade fall har godkända utfall över körningarna;
inte ett påstående om en slutlig full browserkörning efter textändringen.
En inledande webtypecheck exit1 fann vidgade policyliteraltyper i HTTP-testets
mock; typerna preciserades, slutkontrollen passerar. Inga lintundantag.

PG provar admin och äldre begränsade aktörer, sann audit, exakt replay,
aktörskonflikt, resultat-/stale-/CSRF-/reader-spärr och oförändrade raw/entry/
snapshot/DNSrevisioner. Browser skapar manuellt DNS, tappar svar och retryar
byteidentiskt; återtagandet gör samma sak och lämnar exakt ett beslut, en
withdrawal och samma originalrevision. Gällande resultatremsa går från Ej
start till Inget aktivt resultat. Inget nytt manuellt DNS erbjuds därefter
enligt befintlig policy. Review/bekräftelse390/1366 visuellt granskad utan
horisontell overflow. Pending spärrar mobilvybyte; logout är tillgänglig.

Antaganden: ett manuellt DNS kräver tom revisionshistorik; återtagande kräver
aktuellt manuellt DNS. Avpricknings-DNS och redan ersatt resultat rättas inte
här. Återtagande bevisar inte start/återkomst. Fysisk mobil, produktionslast,
full workspace-/hårdvarusvit ej körda i detta snitt. Ingen migration, extern
tjänst, verklig tävling eller ny dependency. PG55442 stoppad exit0 med data
kvar; ingen lyssnare3122 (lsof exit1 utan träff). Huvudmålet fortsätter.

Nästa minsta vertikala uppgift: registrera och rätta Avbrutit lopp (DNF) i
samma administratörsvy, med befintlig besluts- och resultathistorikmodell.

## 2026-09-12: TASK041 DNF och återtagande

Klart avgränsat snitt enligt ADR-0080, skriven före implementation. Samma
administratörssession erbjuder Avbrutit lopp och rättning. Tolv integrerade
policyåtgärder, sann adminaudit och fyra gemensamma HTTP-routes; äldre roller
och befintlig resultatpolicy behålls. Kvittenshelpers kontrollerar även exakt
nästa revision och återställd status/reason mot granskad teknisk källa.

Slutliga kontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 2 godkända,154ms (agentens körning).
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-041-administrator-did-not-finish.test.ts
  — 2 godkända,181ms test/810ms totalt (agentens körning).
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts src/lib/did-not-finish-admin-client.test.ts src/lib/did-not-finish-withdrawal-admin-client.test.ts
  — 3 filer,21 godkända,1,10s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 5 godkända,36,5s.

30 olika riktade testfall passerade. Inledande webtypecheck exit2 upptäckte
fel success-discriminator i nya HTTP-integrationen (decided i stället för
did-not-finish); rättat före slutkontroller och browser. Ingen browserfailure.
Readonly agentreview utan konkreta fynd. Build kördes efter browser, inte
samtidigt. NO_COLOR/FORCE_COLOR-varningar påverkade inte browserresultatet.

Riktig syntetisk HTTP/PG-kedja: teknisk revision1 → manuellt DNF revision2 →
senare teknisk revision3 medan DNF gäller → återtagande revision4 från exakt
revision3. Båda beslut retryas byteidentiskt efter tappade lyckade svar.
Rawdata, originalrevision1–3, entry/snapshot och sann aktörshistorik bevaras.
PG provar också äldre begränsade roller, CSRF/reader och ändrad aktör vid retry.
Skärmbilder390/1366 granskade: review och bekräftelse läsbara, ingen horisontell
overflow. Den tekniska policyförklaringen är fortfarande ganska omfattande.

Antaganden/avgränsningar: DNF kräver direkt tekniskt OK/MP-underlag; utan
avläsning eller direkt på manuell restaurering stöds det inte här. DNF eller
återtagande bevisar inte fysisk återkomst. Fysisk mobil, stor produktionslast,
full workspace-/hårdvarusvit ej körda. Inga verkliga tävlingsdata, externa
API:er, migrationer eller dependencies. Isolerad PG55442 stoppad exit0 med
syntetiska data kvar; ingen lyssnare3122 (lsof exit1 utan träff).
Huvudmålet är fortsatt aktivt; systemet är inte färdigt eller MeOS-likvärdigt.

Nästa minsta vertikala uppgift: diskvalificering och rättning i samma
administratörsvy med befintlig beslutsmodell.

## 2026-09-12: TASK042 diskvalificering och återtagande

Klart avgränsat snitt enligt ADR-0081, dokumenterad före implementation.
Gemensam adminsession integrerar nu14 policyåtgärder, inklusive DSQ/beslut och
återtagande. Befintlig resultatmodell och äldre begränsade roller behålls;
audit använder sann administratör. Fyra gemensamma routes och arbetsvyn
Diskvalificering återanvänder strikta kontrakt, intent och kvittenshelpers.
Kvittens binder även nästa revision och restaurerad status/reason.

Slutliga kontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 2 godkända,174ms (agentens körning).
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-042-administrator-disqualification.test.ts
  — 2 godkända,200ms test/855ms totalt (agentens körning).
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts src/lib/result-disqualification-admin-client.test.ts src/lib/result-disqualification-withdrawal-admin-client.test.ts
  — 3 filer,24 godkända,1,20s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 6 godkända,42,9s.

34 olika riktade fall godkända. Initialt ofullständig HTTP-testedit gav ett
syntaxfel (1 suite fel,6 helpers godkända) och agentens samtidiga lint exit1;
rättat. En mellanliggande grön körning inkluderade ett oavsiktligt tomt test,
vilket togs bort; slutligt antal är24, inte25. PG-agentens första start via
PATH använde fel huvudversion; ingen server startade. Ett mellanliggande PG-
försök gav ECONNREFUSED/2skippade före explicit PG17-start och godkänd slutkörning.
Första browserstart exit1 på sandboxens EPERM för loopback3122; eskalerad
lokal körning passerade alla6. Ingen browserassertion behövde rättas.

Browser provar teknisk revision1 → DSQrevision2 → teknisk revision3 medan
DSQ gäller → restaureringsrevision4 med exakt evaluation från3. Båda POSTs
tappar första lyckade svaret och retryar med identisk body/nyckel. Raw2 och
revision1–3 är oförändrade; exakt ett beslut/återtagande och sann adminaudit.
PG provar även äldre begränsade aktörer, reader/CSRF, ingen fabricerad DSQ,
ändrad aktör vid retry och oförändrade entry-/snapshotversioner. Readonly
agentreview utan konkreta fynd. Skärmbilder390/1366 granskade, ingen horisontell
overflow; teknisk förklaring/revisionspresentation är dock fortfarande lång.

Antaganden: aktuellt direkt tekniskt OK/MP krävs; ingen DSQ utan avläsning
eller direkt på manuell restaurering. Manuell status bevisar inte fysisk
återkomst. Fysisk mobil, produktionslast och full workspace-/hårdvarusvit ej
körda. Ingen migration, extern API, verklig tävling eller ny dependency.
Build körd efter browser. PG55442 stoppad exit0 med syntetiska data kvar;
ingen lyssnare3122 (lsof exit1 utan träff). Huvudmålet är fortsatt aktivt.

Nästa minsta vertikala uppgift: kompaktare granskning av resultatbeslut med
tydlig resultatpåverkan och utfällbara tekniska revisionsdetaljer.

## 2026-09-12: TASK043 kompakt resultatgranskning

Klart presentationssnitt i web workspace och svensk text. DNF/DSQ visar
namn/klass och status före→efter direkt; återtagande visar dessutom fryst
källstatus/orsak. Revisionsnummer och teknisk bakgrund ligger i native details
med request-id som key och stängd default. Kort konsekvens, bekräftelse och
okänt svar/retry ligger utanför detaljer. Lång policyhjälp visas före granskning,
inte dubblerad ovanför den. Ingen auth/API/intent/resultatpolicy ändrades.
Ingen ny ADR: presentationsändringen behåller ADR-0080/0081 och teknikval.

Kontroller, samtliga exit0:

- CI=true pnpm --filter @o-tid/web lint (UI-agentens körning)
- CI=true pnpm --filter @o-tid/web typecheck (UI-agentens körning)
- CI=true pnpm --filter @o-tid/web build
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep 'TASK041|TASK042'
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 2 godkända,16,2s.

Inga misslyckade tester. Browserproven verifierar synlig statuspåverkan,
revisionsrader dolda innan öppning och synliga därefter, Enter-toggle utan
nätanrop, nytt oskickat intent återställer stängda detaljer. Granskningsrutan
är under520px på390-bredd för båda beslut och återtaganden. Oförändrad kedja
med senare ingest, tappade svar, identiskt retry och raw/revisioner passerar.
Mobilbilder för båda och DSQ-desktop granskade: mindre text/scrollning men
sidans övergripande header/navigation tar fortfarande plats.

Avgränsning: endast dessa två browserfall, inte hela workspace- eller tidigare
sexfallsfilen. Ingen ny enhetstestmatris för oförändrad resultatlogik. Browser
återställer OK i proven; MP-text använder samma befintliga status/orsaksmappar
men har inte ett separat nytt browserfall. Fysisk mobil/skärmläsare/produktion
ej verifierade. Ingen verklig tävling/API/hårdvara. PG55442 stoppad exit0 med
syntetiska data kvar, ingen lyssnare3122 (lsof exit1 utan träff). Build kördes
efter browser. Huvudmålet är aktivt och hela systemet ännu inte färdigt.

Nästa minsta vertikala uppgift: manuellt godkännande och rättning med samma
administratörsinloggning och den kompakta granskningsformen.

## 2026-09-12: TASK044 manuellt godkännande och återtagande

Klart avgränsat snitt enligt ADR-0082, skriven före implementation. Befintlig
approval/withdrawal ansluten till MANAGE_RACE, nu16 integrerade åtgärder.
Sann adminaudit, befintliga begränsade roller och ADR-0032:s tidskompletta MP-
policy bevaras. Fyra gemensamma routes, kvittensbindning till nästa revision/
targetReason/restaurerad status och kompakt arbetsvy. Direkt synlig status,
orsak och placeringspåverkan; revisionsdetaljer utfällbara.

Slutliga kommandon, samtliga exit0:

- CI=true pnpm --filter @o-tid/application --filter @o-tid/web lint
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- CI=true pnpm --filter @o-tid/application --filter @o-tid/web build
- CI=true pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  — 2 godkända,195ms (agentens körning).
- CI=true TEST_DATABASE_URL=<isolerad otid_029_test> pnpm --filter @o-tid/application exec vitest run test/integration/task-044-administrator-approval.test.ts
  — 3 godkända,157ms test/842ms totalt (agentens körning).
- CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts src/lib/result-approval-admin-client.test.ts src/lib/result-approval-withdrawal-admin-client.test.ts
  — 3 filer,24 godkända,1,20s.
- CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL — 7 godkända,49,2s.

36 olika riktade fall passerade. Initial HTTP-testkörning exit1: 23 godkända,
1 fel på testmockens felaktiga expectedDisqualifiedResultRevision i stället
för expectedApprovedResultRevision. Mock rättad, slutkörning24/24. Ingen
browserfailure. Readonly agentreview utan konkreta fynd. Build efter browser.

PG provar admin/äldre roller, tidslöst INVALID_TIME_ORDER/ingenavläsning,
CSRF/reader, senareOK respektiveMP under aktivt beslut, exactretry/actorconflict,
raw/entry/snapshot/historik. Browser använder tidskomplett MP/MISSING_CONTROL
revision1 → manuelltOK revision2 → senareMP revision3 → exaktMP revision4.
Beslut och återtagande tappar var sitt lyckat svar och retryar byteidentiskt.
Kompakt review visar status före/efter, stängda detaljer återställs vid nytt
intent, tangentbordstoggle gör inga nätanrop. Review under520px på390-bredd.
Mobil/desktopbilder granskade utan horisontell overflow.

Antaganden: endast MISSING_CONTROL/WRONG_ORDER med fullständig tid är
godkännandebara. Tidsrättning, kontrollneutralisering och fria jurybeslut ingår
inte. Full workspace-/hårdvarusvit, fysisk mobil/skärmläsare och produktion ej
verifierade. Ingen migration, ny dependency eller verklig tävling/API/hårdvara.
PG55442 stoppad exit0 med syntetiska data kvar; ingen lyssnare3122 (lsof exit1
utan träff). Huvudmålet är fortsatt aktivt, inte ett färdigt MeOS-likvärdigt system.

Nästa minsta vertikala uppgift: utom tävlan och återtagande i samma gemensamma
administratörsvy med befintlig beslutsmodell.

## 2026-09-12: TASK045 utom tävlan

Klart enligt ADR-0083.18 integrerade adminåtgärder, sann audit, gemensamma
OOC-routes och kompakt UI. En billigare Luna-agent användes för UI-utkast;
main rättade ofullständig pending-/efterläsningskoppling till befintligt
DSQ-mönster. Ingen andra reviewagent eller bred testmatris.

Slutkontroller exit0 (CI=true i samtliga kommandon):

- pnpm --filter @o-tid/application lint
- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck:
  application passerade; web återkördes separat efter UI-rättning och passerade.
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  —2pass,196ms.
- pnpm --filter @o-tid/web exec vitest run src/lib/out-of-competition-admin-client.test.ts src/lib/out-of-competition-withdrawal-admin-client.test.ts
  —4pass,422ms.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK045
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL —1pass,11,9s.

Två tidigare webtypechecks exit2 hittade saknad pending-union respektive
readiness-text för ACTIVE_DID_NOT_START; rättat före browser.7 riktade testfall
totalt, inget browserfel. Provet visar OK→OOC→senareOK→återtagande med sann
adminaudit, exakt retry och oförändrade raw/originalrevisioner. Mobilbild
granskad; details/reset/tangentbord och reviewhöjd testade som tidigare.
PG55442 stoppad exit0 med syntetiska data bevarade. Build efter browser.

Kvar: direkt tekniskt OK/MP-underlag krävs. Äldre begränsade roller bara
policyprovade nu, ingen ny PG-/full regressionsmatris; fysisk mobil,
produktion och hårdvara ej verifierade. Inga externa API:er eller privata data.
Nästa minsta uppgift: utan tidtagning och återtagande med samma adminsession.

## 2026-09-12: TASK046 utan tidtagning

Klart enligt ADR-0084.20 integrerade adminåtgärder. Billigare Luna-agent
ändrade endast policyn/audit; main återanvände OOC-flödet för NT med faktisk
NT-kontrakt och synlig export-/finaliseringsspärr. Ingen ny resultatpolicy.

Kontroller (CI=true), exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  —2pass (agentens körning).
- pnpm --filter @o-tid/web exec vitest run src/lib/without-timing-admin-client.test.ts src/lib/without-timing-withdrawal-admin-client.test.ts
  —4pass,456ms.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK046
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL —1pass,14,0s.

Sju riktade fall, ingen bred regression eller misslyckad testkörning. Riktig
syntetisk HTTP/PG provar OK→NT→senareOK→återtagande med exakt retry/audit och
oförändrade raw/originalrevisioner. Tid20:00 döljs under NT, källa3 återställs
med25:00. Exportvarning, kompakt review och details/reset provade. Mobilbild
granskad. PG55442 stoppad exit0 med testdata kvar. Build efter browser.

Kvar: endast direkt tekniskt OK/COMPLETE kan bli NT. Befintlig aktiv NT-spärr
för IOF/finalisering ändras inte och har inte återtestats separat på servern
i detta UI-snitt. Fysisk mobil, produktion och full regression ej verifierade.
Ingen verklig tävling, API eller hårdvara. Huvudmålet fortfarande aktivt.
Nästa minsta uppgift: IOF-resultatexport med samma administratörsinloggning.

## 2026-09-12: TASK047 aktuell IOF-resultatexport

Klart enligt ADR-0085.21 integrerade adminåtgärder. En billig Luna-agent
gjorde endast policy/test; main kopplade befintlig application-export till
gemensam route och kompakt utfällbar UI. Read-only Snapshot, ingen Complete
eller finalisering. Nedladdning tömmer inte deltagarunderlaget.

Kontroller med CI=true, slutligt exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
  (web även återkört efter sista ändring).
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
  (application godkänt; web återkört separat efter rättning).
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  —2pass, agentkörning.
- pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts -t TASK047
  —1pass/19 avsiktligt bortvalda,1,07s.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK047
  —1pass,7,4s med lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Fyra unika riktade testfall. Första webtypecheck exit2 och HTTP-test exit1:
413 använde klassadminfelschema som inte stödjer TOO_LARGE. Rättat till
befintligt exportfelschema; omkört godkänt. Första browserpass6,9s; slutligt
pass även efter tillagt manipulerat filinnehåll. Ingen ny full regression.

Riktig syntetisk HTTP/PG visar samma adminsession utan deltagarval, korrekt
XML/hash/Snapshot,1 resultat/1 utelämnad deltagare och oförändrade revisioner.
Konflikt/ändrad fil provas med browserstubbar. PG stoppad exit0, testdata
bevarade. Ingen verklig tävling, API-nyckel eller hårdvara använd.

Kvar: NT-spärr/enloppspolicy återanvända utan ny separat integrationsmatris;
fysisk mobil, produktion och full regression ej verifierade. Ingen offline-
export utlovas. Huvudmålet kvarstår. Nästa minsta uppgift: nedladdning av
redan finaliserat officiellt resultat med samma inloggning.

## 2026-09-12: TASK048 frysta officiella resultat

Klart enligt ADR-0086. Befintlig exportbehörighet återanvänds, inga nya
application-/domänregler. Kompakt väljare för fastställd version; download
kontrolleras mot metadata/hash och bevarar historiska Complete-bytes.
En billig agent gjorde endast imports och lämnade resten ofärdigt; main
slutförde routes/test/UI. Ingen extra granskningsagent.

Kontroller med CI=true, slutligt exit0:

- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm --filter @o-tid/web build
- pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts -t 'TASK04[78]'
  —2pass,19 bortvalda,1,11s.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK048
  —1pass6,6s, lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Fyra unika riktade fall inklusive föregående Snapshot-browser. Första
e2e-typecheck exit2 hittade fixturefält completeXmlSha256 i stället för DB:s
completeXmlHash; rättat. Browserkörning --grep 'TASK04[78]' gav Snapshot pass
och Complete fail(14,1s): getByLabel hittade inte select trots korrekt synlig
historik. Ändrat till combobox-roll; endast TASK048 återkört, godkänt.

Riktig syntetisk application-finalisering+HTTP/PG visar tom lista, senare
ingest, exakt historisk XML/hash, oförändrade finaliseringsrader och rensad
väljare vid logout. Inga riktiga tävlingsdata/nycklar eller externa anrop.
PG stoppad exit0 och testdata bevarade; build efter browser.

Kvar: ingen ny finalisering i adminvyn ännu; fysisk mobil, produktion och
full regression ej verifierade. Huvudmålet kvarstår. Nästa minsta uppgift:
granska och uttryckligen fastställa resultat med samma administratörsinloggning.

## 2026-09-12: TASK049 uttrycklig finalisering

Klart enligt ADR-0087.22 integrerade adminåtgärder. Billig Luna-agent gjorde
application-policy/audit och två policytester; main gemensamma routes/UI och
ett browserprov. Välj klass/lopp, läs blockerare, granska och bekräfta. Fryst
avsikt behålls vid okänd kvittens, och andra åtgärder blockeras under retry.
Ingen ändring av täckningsregler, rådata, resultatberäkning eller gammal Complete.

Kontroller med CI=true, slutligt exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
  —application passerade; web återkört separat efter rättning, exit0.
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  —2pass, agentkörning. Efteråt endast testnamnets inaktuella antal borttaget.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK049
  —1pass8,4s med lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Tre riktade fall. Första webtypecheck exit2: dubbel sv-import och saknad
textnyckel; första e2e-typecheck exit2: auditLogs i stället för auditEvents.
Rättat före godkänt browserprov. Ofärdig klass blockeras, granskning kan
avbrytas utan write, tappat klassvar återförs exakt, klass→lopp ger exakt två
finaliseringar och två auditposter med riktig adminroll samt Complete-fil.
PG stoppad exit0, syntetiska testdata kvar. Build efter browser.

Kvar: befintliga blockerregler/äldre roller inte fullmatrisprovade igen;
fysisk mobil/produktion inte verifierade. Ingen offlinefinalisering eller
verklig tävling/API/hårdvara berörd. Huvudmålet kvarstår. Nästa minsta uppgift:
befintlig minutstartslottning med samma administratörsinloggning.

## 2026-09-12: TASK050 minutstartslottning

Klart enligt ADR-0088.23 integrerade adminåtgärder. Billig Luna-agent tog
application-policy/audit och policytest; main routes, receiptkontroll, kompakt
granskningstabell och browserprov. Befintlig FIXED-algoritm återanvänds, fri
start lämnas utanför. Ingen automatisk resultatberäkning/startlistepublicering.

Kontroller med CI=true, samtliga exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  —2pass, agentkörning.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK050
  —1pass9,1s, lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Tre riktade fall; inga misslyckade kontroller eller breda sviter. Riktig
syntetisk HTTP/PG: preview/avbryt utan write, två tider med120s intervall,
tappat commitsvar och exakt retry, en adminauditpost. Fri-startdeltagarens
hela DB-rad förblir oförändrad. PG stoppad exit0, testdata bevarade; build efter
browser. Inga verkliga data/API/hårdvara.

Kvar: FIXED-klasser, enkel lottning utan klubbseparering/seedning, första
datum anges med sekunder och UTC-offset. Befintliga omräknings-/publicerings-
gränser återanvända utan separat ny matris. Fysisk mobil, produktion och full
regression inte verifierade. Huvudmålet kvarstår. Nästa minsta uppgift:
publicera startlista med samma administratörsinloggning.

## 2026-09-12: TASK051 startlistepublicering

Klart enligt ADR-0089.24 integrerade adminåtgärder. Billig Luna-agent gjorde
policy/audit och policytester; main privat underlag, explicit granskning,
publicera/avpublicera, race/request/revision/hash-bunden kvittens och browser.
Granskningen visar även tomma klasser och ingen brickinformation. Endast
syntetiska personuppgifter publicerades på loopback under provet.

Kontroller med CI=true, slutligt exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
  —web även återkört efter sista tabelländring.
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
  —application godkänt; web återkört separat efter textnyckelrättning.
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/application exec vitest run test/race-administrator-policy.test.ts
  —2pass, agentkörning.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK051
  —1pass9,5s med lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Tre riktade testfall, ingen bred regression. Första webtypecheck exit2 för
saknad startTime-textnyckel; rättat. Browser passerade första körningen:
preview/avbryt utan publicering, tappad kvittens/exakt retry, publicerad kopia
oförändrad efter senare källändring, sedan404 efter avpublicering. Exakt två
beslut och två auditposter med adminroll och rätt credential-id. PG stoppad
exit0, testdata bevarade; build efter browser.

Kvar: fysisk mobil/produktion/full regression och separat IOF-XML-publicerings-
matris ej körda här. Gamla exporter/roller återanvänds. Avpublicering återkallar
inte nedladdade kopior. Inga riktiga data/API/hårdvara berörda. Huvudmålet
kvarstår. Nästa minsta uppgift: kvar-i-skogen-lista med samma admininloggning.

## 2026-09-12: TASK052 kvar-i-skogen-rapport

Klart enligt ADR-0090. Billig Luna-agent gjorde endast read-wrapper/export;
main route/UI och ett HTTP/PG-browserprov. Ingen FINISH_FOREST_WATCH-grant
eller ändring av checkin-mutationer. Befintlig rapport/filter/domänprojektion
återanvänds. Manuell uppdatering; gammalmärkt efter30s eller misslyckad läsning.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK052
  —1pass7,2s, lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Ett riktat browserfall, inga misslyckade körningar eller breda sviter.
Provar401 utan session, okänd start→registrerad återkomst efter syntetisk
avläsning, ingen resultatmutation från läsning, filtertotal/varning, gammal
rapport vid nätfel och rensning vid logout.30s-timer separat ej testad.
PG stoppad exit0, testdata kvar; build efter browser. Inga riktiga uppgifter,
API eller hårdvara. Fysisk mobil/produktion/full regression ej verifierade.
Rapporten garanterar aldrig tom skog eller tomma offlineköer. Huvudmålet
kvarstår. Nästa minsta uppgift: utskrift av kvar-i-skogen från adminvyn.

## 2026-09-12: TASK053 rapportutskrift

Klart presentationssnitt under ADR-0090. Ingen agent behövdes för den lilla
UI/CSS-ändringen. Endast separat rapportyta visas i print-media; data/filter/
datum/varningar kommer från samma privata state. Övrig admin och login döljs.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm --filter @o-tid/web build
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK053
  —1pass7,3s, lika isolerade DATABASE_URL/TEST_DATABASE_URL på55442.

Befintligt TASK052-fall utökat, ingen bred regression/felaktig körning.
Printanrop fångas; print-media behåller gammaldata/filtervarning och hela
loppets gruppantal men döljer deltagaradmin och knappar. Inga printnätanrop;
printytan döljs på skärm och rensas vid logout. PG stoppad exit0 med testdata
kvar; build efter browser. Ingen fysisk skrivare, PDF-sidbrytningskontroll,
produktion eller verkliga uppgifter. Huvudmålet kvarstår. Nästa minsta uppgift:
manuell återkomstregistrering med samma administratörsinloggning.

## 2026-09-12: TASK054 källmodell för manuell återkomst

Påbörjad, inte implementerad. Förundersökning verifierar att device-check
och credential-scope-FK hindrar en enkel behörighetsaliasning. ADR-0091
beslutar ärlig MANAGE_RACE-källa, stabil per credential och serversekvenserad,
med befintlig checkin-writer. Personalens offline/recovery-gränser behålls.
TASK054 anger migrations-/kontrakts-/källvalideringsarbete och acceptans.

Billig Luna-agent kartlade beroenden read-only; main verifierade centrala
schema- och domänantaganden. Bara dokument ändrade i detta steg. Inga
kodtester/build körda, eftersom ingen körbar kod ändrats eller migration
aktiverats. Ingen databas/server startad, ingen verklig uppgift använd.
Återstår: migration, smalt kontrakt, source-kompatibilitet, tjänst/UI och
riktad verifiering. Huvudmålet aktivt; nästa steg är implementation av TASK054.

## 2026-09-12: TASK054 datagrund och kontrakt

Delsteg, inte färdig funktion. Billig Luna-agent gjorde schema/migration0046
med bibehållen aktörs-FK. Main ändrade indexpredikatets enum::text-cast till
direkt enumjämförelse före körning, samt skrev smalt adminintent/kvittens och
två kontraktsprov. Ingen application-writer eller UI ännu.

Kontroller med CI=true där pnpm används, alla exit0:

- pnpm --filter @o-tid/contracts --filter @o-tid/database lint
- pnpm --filter @o-tid/contracts --filter @o-tid/database typecheck
- pnpm --filter @o-tid/contracts --filter @o-tid/database build
- pnpm --filter @o-tid/contracts exec vitest run test/administrator-return.test.ts
  —2pass,442ms.
- DATABASE_URL till isolerade otid_029_test på55442: pnpm db:migrate
  —0046 applicerad.
- PostgreSQL17 psql mot samma testdatabas med
  -v ON_ERROR_STOP=1 -f packages/database/test/administrator-source.sql
  —korrekt adminkälla accepterad, dubblett och falsk målroll avvisade; ROLLBACK.

Testdatabasen stoppad exit0. Migration bevarad där, inga adminkällor sparade
av SQL-provet. Ingen verklig tävling/nyckel eller produktionsdatabas använd.
Kvar: historiska källvalidatorer, online-wrapper, klient/serverintegration
och genomgående återkomstprov. Gamla offlineklienter får ännu inga nya
capabilityvärden. Huvudmålet aktivt; fortsätt inom samma TASK054.

## 2026-09-12: TASK054 manuell återkomst färdig i adminvyn

Online-wrapper, historisk källvalidering och granska/bekräfta/retry i gemensam
admin implementerade enligt ADR-0091. Luna-agent gjorde en avgränsad
källvalidatorändring; main integrerade tjänst/UI och riktad acceptans.
Ingen ny personalbehörighet eller offlinekö. Startstatus bevaras; befintlig
checkin-domän hanterar eventuell DNS-återkallelse, inte UI eller route.

Kontroller med CI=true, slutresultat exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts
  —2pass,1,29s, isolerade otid_029_test på55442.
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK054
  —1pass,9,6s, samma isolerade DATABASE_URL/TEST_DATABASE_URL.

Första application-typecheck gav exit2 för två överflödiga formatVersion-fält
i internt sync-anrop; rättat och omkontrollerat. PostgreSQL-provet kördes först
med2pass/1,12s och därefter med utökade konfliktassertioner enligt ovan.
Slutlig typecheck/build körd efter browserprovet. Vid avslut bekräftar pg_ctl
status att testservern inte körs (exit3); bevarade testdata har inte raderats.

Verifierat: samtidig exakt retry, förändrad avsikt/aktör, versionskonflikt,
historisk personalkompatibilitet och checkin-DNS-effekt. Browsern provar tappat
verkligt HTTP-svar, oförändrad begäran vid retry och uppdaterad återkomstrapport
utan fabricerat resultat. Inga breda regressionssviter körda i detta snitt.
Fysisk mobil, produktion och full offline/recovery-matris är inte verifierade;
adminåterkomst förutsätter nät. Inga riktiga uppgifter, API-nycklar eller
hårdvara användes. Huvudmålet kvarstår. Nästa minsta uppgift: rätta en felaktig
manuell återkomstregistrering med samma admininloggning, med explicit historik.

## 2026-09-12: TASK055 rättning av manuell återkomst avgränsad

ADR-0092 beslutar separat rättningsanrop och utvidgar uttryckligen ADR-0091.
Lokal läsning av planStartCheckinSync bekräftar att false med bevarad
REPORTED_NOT_STARTED kan skapa en ny checkin-DNS-revision; teknisk återkomst
eller annat resultat kan ge konflikt. Detta måste framgå vid granskning.
Ingen ny resultatlogik eller schemaändring planeras.

TASK055 anger tjänst/UI och riktad acceptans, inklusive replay efter senare
återregistrering. Bara dokument ändrade i detta steg; inga kodtester eller
byggkörningar behövdes, ingen server startades. Ingen agent användes för
det lilla dokumentsteget. Funktionen är ännu inte implementerad.

## 2026-09-12: TASK055 rättning av manuell återkomst implementerad

Luna-agent gjorde gemensam true/false-tjänst och källvalidator. Main kopplade
separat rättningsroute, samma admin-UI/retry samt browseracceptans. Agenten
utökade PG-provet; main rättade testets aktuella revision och skärpte
målbytesassertionerna så att endast målflaggan skiljer samma begäran.
Ingen migration, ny roll, offlinekö eller resultatlogik tillkom.

Kontroller med CI=true, slutresultat exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts
  —2pass,978ms; TEST_DATABASE_URL till isolerade otid_029_test på55442.
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK055
  —1pass,10,7s; samma isolerade DATABASE_URL/TEST_DATABASE_URL.

Första PG-körningen:1pass/1fail, exit1 (test för startstatusbyte använde
revision1 efter att kedjan nått revision3, alltså korrekt durabel konflikt
i stället för invalid-request). Testreferens rättad; tjänsten ändrades inte
för att få provet grönt. Agenten rapporterade också ett pnpm-försök som
stoppades av installations-/nätfel innan något prov kördes.

Startförsök av PG gav exit1 eftersom servern redan körde. Eskalerad pg_ctl
status och logg bekräftade rätt loopbackserver/PID27235; befintlig server
återanvändes. Tidigare oeskalerad status som sade att ingen server körde var
inte tillförlitlig processinsyn. Efter proven stoppad med pg_ctl, exit0;
testdata bevarade. Browser avslutad före build.

Proven omfattar replay efter senare registrering, exakt målbindning,
återinförd checkin-DNS, tappat HTTP-svar och fortsatt teknisk återkomst med
oförändrade avläsningar/resultat. En separat personalbrowser med ny false-
historik och full offline/recovery-matris kördes inte; gemensam källvalidering
är använd av adminrapporten. Fysisk mobil och produktion ej verifierade.
Inga verkliga deltagare, API-nycklar eller fysisk hårdvara användes.
Huvudmålet kvarstår. Nästa minsta snitt: rätta startpersonalens startmarkering
från samma adminvy, med tydlig konsekvens för ej startande och kvar-i-skogen.

## 2026-09-12: TASK056 administrativ startmarkering

ADR-0093 skapades före kod och utvidgar uttryckligen ADR-0091. Separat
MARK_START-åtgärd, smalt målstatuskontrakt och granska/bekräfta i samma
adminvy är implementerade. Återkomstflödets FINISH_CORRECTION behåller sin
spärr mot startbyte. Befintlig domänplan hanterar DNS och bevarar återkomst.
Ingen ny migration, roll eller offlinekö.

Luna-agent gjorde källvalidator och gemensam tjänsteutvidgning. Main gjorde
kontrakt/UI/route/tester och slutförde typnarrowing samt den avgränsade
writer-guardändringen. Ingen separat agentgranskning eller bred regression.

Kontroller med CI=true, slutresultat exit0:

- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application typecheck (efter PG-testtillägget)
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint
  —contracts passerade första körningen; application/web passerade omkörningen.
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm --filter @o-tid/contracts exec vitest run test/administrator-return.test.ts
  —3pass,431ms.
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts
  —3pass,1,45s, isolerade TEST_DATABASE_URL otid_029_test på55442.
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK056
  —1pass,8,1s, samma isolerade DATABASE_URL/TEST_DATABASE_URL.

Första lint gav exit1 för oanvänd destrukturerad testvariabel; nu verifierar
den fixturens utgångsläge. Första browserprovet gav exit1/60s-timeout eftersom
getByLabel exact inte hittade selectens labeltext; snapshot visade korrekt
fält, och getByRole combobox med dess tillgängliga namn passerade. Endast
testväljaren ändrades. Build kördes efter avslutad browser. PG start/stopp
exit0; testhistorik bevarad. Inga riktiga deltagare, API eller hårdvara.

Verifierat: ej startande→startad återkallar checkin-DNS; manuell återkomst
bevaras; negativ rapport efter återkomst ger konflikt; replay efter senare
ändring återspelar inte effekten; fel action/mål med samma id avvisas;
personalens roster läser den administrativa historiken. Browser provar
avbryt, tappat riktigt HTTP-svar, exakt retry och uppdaterad skogsrapport.
Fysisk mobil, startstation, produktion och full offline/recovery-regression
ej verifierade. Markeringen bygger på mänsklig observation, inte stämpling.
Huvudmålet kvarstår. Nästa minsta uppgift: visa start-/återkomsthistoriken
för vald deltagare i samma adminvy så att personalen kan följa rättningarna.

## 2026-09-12: TASK057 journalens läskontrakt

Påbörjad, inte färdig UI-funktion. Förundersökning visar att rosterlästjänsten
läser operationer men inte skickar deltagarens fulla journal. Befintlig
avläsningshistorik ger mönster för scopebunden keysetpaginering.
ADR-0094 och TASK057 dokumenterades före kod. Nytt strikt läskontrakt bevarar
skillnaden mellan APPLIED/UNCHANGED/CONFLICT, källroll och två tidsbegrepp.
Det avvisar fel roll/action, extra privata fält, dubbletter och tom sida med
fortsättningscursor. Inget endpoint eller skrivflöde har aktiverats.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/contracts lint
- pnpm --filter @o-tid/contracts typecheck
- pnpm --filter @o-tid/contracts exec vitest run test/checkin-history.test.ts
  —1pass,374ms.
- pnpm --filter @o-tid/contracts build

En riktad kontraktskontroll, ingen bred regression eller agent behövdes för
det lilla delsteget. Ingen PG/browser körd: tjänst och UI återstår och är
inte verifierade. Ingen databas/server startad, ingen riktig uppgift läst.
Huvudmålet aktivt; nästa steg inom TASK057 är paginerad lästjänst och UI.

## 2026-09-12: TASK057 deltagarjournal färdig

Luna-agent gjorde avgränsad lästjänst. Main slutförde exakt mikrosekundcursor,
kanonisk cursorvalidering och källans loppskontroll, samt route/UI och prov.
Gemensam kvittensvalidator verifierar intent/hash utan dubblerad hashlogik.
25 rader per UI-sida, kompakt tabell och inga skrivningar. Gamla mobila
kontrakt utvidgas inte. Underlag rensas vid annan operation, deltagarbyte/logout.

Kontroller med CI=true, slutresultat exit0:

- pnpm --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application lint och typecheck kördes även efter testtillägg.
- pnpm --filter @o-tid/application --filter @o-tid/web build
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts -t TASK057
  —1pass/3 avsiktligt bortvalda,1,04s; TEST_DATABASE_URL otid_029_test på55442.
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK057
  —1pass,6,9s; samma isolerade DATABASE_URL/TEST_DATABASE_URL.

Första PG-provet gav exit1: testets frysta tid låg före personalcredentialens
utfärdning. Källor/sessioner förbereds nu före den gemensamma testtiden.
Första browserprovet gav exit1/60s-timeout vid exakt deltagarnamn som saknade
UI:s klubbtext; testväljaren rättad. Ingen tjänst ändrades för dessa fel.
Browser avslutad före build; PG start/stopp exit0 och testhistorik kvar.

Verifierat: mottagningstidskollision/paginering, alla tre källroller och
effekter, fel scope/cursor, skyddad läsning,25+3 browserrader, tom journal,
rensning vid deltagarbyte/logout och oförändrade operationer/resultat.
Ingen bred regression, fysisk mobil eller produktion verifierad. Historiken
är serverlagrad: osynkade mobiluppgifter kan saknas. Inga riktiga deltagare,
API-nycklar eller hårdvara användes. Huvudmålet kvarstår. Nästa minsta snitt:
öppna vald deltagares journal direkt från kvar-i-skogen-listan.

## 2026-09-12: TASK058 journalgenväg

Klart UI-snitt under ADR-0094, utan extra agent. Journal på deltagarraden
väljer deltagaren, öppnar/fokuserar journalen och hämtar senaste sidan.
Ingen ny route eller skrivning. Print/personalyta saknar callback och knapp.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK058
  —1pass,8,6s, lika isolerade DATABASE_URL/TEST_DATABASE_URL otid_029_test på55442.
- pnpm --filter @o-tid/web build (efter browser)

Inga misslyckade körningar eller extra PG-svit. PG start/stopp exit0, testdata
kvar. Browser verifierar rätt journal utan tidigare deltagarval,25+3 rader,
rensning/logout och ingen knapp i printkopian. Fysisk mobil/skrivare,
produktion och bred regression ej verifierade. Inga riktiga uppgifter/API.
Huvudmålet kvarstår. Nästa minsta snitt: visa journaltider i tävlingens tidszon
i stället för rå UTC-text, med bibehållen entydig tidsangivelse.

## 2026-09-12: TASK059 lokal journalvisning

Klart presentationssnitt utan extra agent eller ny ADR. Återanvänder
formatStartListTime och validerad tävlingstidszon. Datum, offset och
millisekunder visas; time/dateTime behåller originalets UTC. Saknas underlag
används uttrycklig UTC, aldrig enhetens zon. Inga tjänster/lagringsfält ändrade.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/web exec vitest run src/components/checkin-history-table.test.tsx
  —1pass,252ms, upprepad sommartidstimme/offset/millis och UTC-attribut.
- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm --filter @o-tid/web build

Inga misslyckade körningar. PG/browser/bred regression kördes inte för denna
rena formatteringsändring. Ingen server startad eller verklig uppgift läst.
Fysisk mobil och produktion ej verifierade; zonen följer inläst tävlingsunderlag.
Huvudmålet kvarstår. Nästa minsta snitt: automatisk uppdatering av kvar-i-skogen
när adminrapporten används, utan att störa pågående granskning eller rättning.

## 2026-09-12: TASK060 valbar automatisk skogsrapport

ADR-0095 före implementation utvidgar manuell uppdatering i ADR-0090.
Checkboxen aktiverar15s-intervall vid inaktivitet; paus under granskning,
begäran, redigering, dold/stängd vy och öppen journal. Samma skyddade GET och
gammalmarkering, inget nytt serverarbete. Ingen extra agent för detta UI-snitt.

Kontroller med CI=true, slutresultat exit0:

- pnpm --filter @o-tid/web exec vitest run src/lib/forest-auto-refresh.test.ts
  —1pass,186ms.
- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm --filter @o-tid/web build (klar före separat browserkörning)
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK060
  —1pass,7,0s; lika isolerade DATABASE_URL/TEST_DATABASE_URL otid_029_test på55442.

Första browserförsöket gav exit1/60s-timeout innan deltagarval: inloggningen
hade inte etablerats när klockan styrdes från sidstart. Testet väntar nu på
loginberedskap och installerar klockan efter vanlig inloggning/rapportläsning.
Ingen produktionskod ändrades för omkörningen. PG start/stopp exit0, testdata
kvar. Browser provar auto-GET, paus under granskning, nätfel/gammaldata,
avstängning/logout; övriga villkor har riktat enhetsprov, inte extra browserfall.
Inga riktiga data/API, separat PG-matris eller bred regression. Fysisk mobil,
bakgrundstimer och produktion ej verifierade. Huvudmålet kvarstår. Nästa minsta
snitt: visa tid sedan rapporterad start i kvar-i-skogen, tydligt åtskild från
verifierad löptid och med okänd tid när startobservation saknas.

## 2026-09-12: TASK061 startobservationens källa

Påbörjad, inte färdig funktion. ADR-0096 dokumenterades före kod: aktuell
STARTED-periods första observation, inte senaste återkomsträttning eller
planerad start. Separat adminutvidgning ska skydda äldre offlinekontrakt.
Rent domain-stöd infördes utan I/O, beroende eller lagringsändring.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/domain exec vitest run test/reported-start.test.ts
  —1pass,216ms.
- pnpm --filter @o-tid/domain lint
- pnpm --filter @o-tid/domain typecheck
- pnpm --filter @o-tid/domain build

Provet täcker bevarad startperiod, nollställning/ny start, oordnat underlag,
saknade/dubbla revisioner och motsägande aktuell status. Ingen agent behövdes
för det lilla rena delsteget. Ingen PG/browser/server körd; application,
kontraktsutvidgning och UI återstår. Ingen fysisk eller produktionsverifiering.
Huvudmålet aktivt; fortsätt samma TASK061 med den separata adminprojektionen.

## 2026-09-12: TASK061 rapporterad startålder integrerad

Separat adminresponse med reportedStarts; personalens strikt validerade
response får inga nya fält. Befintlig kvittensvalidering ger APPLIED-kedjan
till rent reportedStartAt. Endast adminläsaren härleder startperioden.
UI och print visar minuter vid rapportens generatedAt, inte en levande
klientklocka/löptid. Okänd/framtida observation ger okänd tid. Ingen ny agent
behövdes för den sammanhängande integrationen, inga nya beroenden/migrationer.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web typecheck
- pnpm --filter @o-tid/application --filter @o-tid/web typecheck (efter testtillägg)
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm --filter @o-tid/web exec vitest run src/lib/reported-start-age.test.ts src/components/forest-watch-report.test.tsx -t TASK061
  —2pass/7 avsiktligt bortvalda,457ms.
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts -t TASK061
  —1pass/4 avsiktligt bortvalda,996ms; isolerade TEST_DATABASE_URL otid_029_test på55442.
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK061
  —1pass,8,9s; samma isolerade DATABASE_URL/TEST_DATABASE_URL.

Inga misslyckade körningar. Build efter browser; PG start/stopp exit0 och
testdata kvar. Verifierat: återkomsträttning/no-op/konflikt flyttar inte
startperiod, ny start väljer ny tid, legacyresponse är oförändrad och gamla/
framtida tider hanteras utan fabricerad löptid. Ingen bred regression,
fysisk mobil eller produktion verifierad; observationen förutsätter rimlig
rapportörsklocka. Inga riktiga uppgifter/API användes. Huvudmålet kvarstår.
Nästa minsta snitt: valbar sortering av startade utan återkomst efter längst
tid sedan rapporterad start, utan att dölja okända tider eller konflikter.

## 2026-09-12: TASK062 valbar startålderssortering

Klart UI-snitt, ingen extra agent eller ny ADR. Endast STARTED_NO_RETURN
sorteras: okänd tid först för uppföljning, sedan längst visad tid. Lika
tider behåller ordning; konflikter ligger kvar i första gruppen. Samma
val/upplysningsrad finns i printkopian och rensas vid logout. Ingen riskklassning.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/web exec vitest run src/components/forest-watch-report.test.tsx -t TASK062
  —1pass/8 avsiktligt bortvalda,481ms.
- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm --filter @o-tid/web build

Inga misslyckade körningar. Komponentprovet verifierar okänd/lång/lika tid,
konfliktgrupp, gammalvarning, defaultordning och oförändrad indata. Inga nya
PG/browserprov för ren sortering; checkboxinteraktion/fysisk utskrift och
produktion ej separat verifierade. Ingen server eller riktig uppgift använd.
Huvudmålet kvarstår. Nästa minsta snitt: markera utredda avprickningskonflikter
från samma adminvy, med bibehållen journal och utan att automatiskt dölja dem.

## 2026-09-12: TASK063 serverdel för administrativ konfliktgranskning

ADR-0097 föregick implementation. Källetiketter läses nu från riktiga
loppbundna enheter, inte personalens avsiktligt filtrerade offline-roster.
Migration0047 utvidgar endast granskningsheaderns capability-check och är
registrerad i migrationsjournalen. Befintliga scope-FK/immutable-triggers
behålls. Tjänsten och historikvalidatorn stödjer verklig MANAGE_RACE;
audit använder RACE_ADMIN_ACCESS_CREDENTIAL. Ingen extra granskningsroll.

Kontroller med CI=true:

- pnpm --filter @o-tid/application lint/typecheck/build (separata kommandon)
  — exit0 för den första källetiketträttningen.
- pnpm --filter @o-tid/database --filter @o-tid/application lint
  — exit0.
- pnpm --filter @o-tid/database --filter @o-tid/application typecheck
  — exit0.
- pnpm --filter @o-tid/database --filter @o-tid/application build
  — exit0.
- pnpm --filter @o-tid/database migrate — exit0, endast isolerade
  DATABASE_URL otid_029_test på loopback55442.
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts -t TASK063
  — exit0, slutlig körning 2pass/5 avsiktligt bortvalda,978ms; samma isolerade
  TEST_DATABASE_URL. Första källetikettprovet före utvidgning:1pass/5 bortvalda,1,01s.

Proven täcker båda aktörerna, oförändrade originalrapporter, rätt auditaktör,
en enda header efter retry, konflikt vid ändrad orsak, och att senare konflikt
inte döljs av återspelat beslut. Personalens enhetslista förblir filtrerad.
PG stoppad exit0; syntetiska testdata bevarade. Inga misslyckade tester.
Ingen bred regression eller produktionsmigration körd. Ingen verklig tävling,
API-nyckel eller hårdvara använd. Befintlig domänplan/låsning återanvänds;
nytt samtidighetsprov har inte körts i detta delsteg.

TASK063 och huvudmålet är fortsatt ofärdiga. Nästa steg inom samma snitt:
adminroute/UI och tydlig granskningsmarkering utan omskrivning av CONFLICT,
därefter ett genomgående browserprov. Ännu ingen ny knapp i adminvyn.

### TASK063 fortsättning: admin-API och granskad journal

Gemensamma adminroutes för GET granskningsunderlag och POST beslut använder
MANAGE_RACE, samma cookie/CSRF-gräns och befintlig 64KiB-läsare. Kvittensen
binds till inskickat intent. Journalen visar separat granskningsorsak/tid;
CONFLICT ändras inte. Den gemensamma medlemsvalidatorn returnerar validerad
metadata och kan avgränsas till en deltagare, utan dubbla journalhämtningar.
Ett litet gpt-5.6-luna-uppdrag användes för journalen. Huvudagenten rättade
deltagarscope, tidsvalidering och återanvände den befintliga medlemskontrollen.

Kontroller med CI=true, slutresultat exit0:

- pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts src/components/checkin-history-table.test.tsx -t TASK063
  —2pass/22 avsiktligt bortvalda,1,06s.
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts -t TASK063
  —2pass/5 avsiktligt bortvalda,1,22s. Isolerade TEST_DATABASE_URL
  otid_029_test på55442; granskad journal samt annan deltagare i samma lopp.
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web lint
  —contracts/application exit0; web först exit1 för oanvänd testvariabel.
  Efter rättning: pnpm --filter @o-tid/web lint —exit0.
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web typecheck
  —exit0.
- pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build
  —exit0 inklusive Next-produktionsbygge.

Första routetestet misslyckades på fixture med icke-kanonisk tidsstämpel;
rättat till millisekunder, därefter grönt. Agentens egna pnpm-prov startade
inte på grund av installationsmiljö; ovanstående CI=true-körningar ersätter
dem. PG start/stopp exit0, testdata kvar. Inget browserprov i detta delsteg,
ingen produktion eller riktig persondata. Granskningspanelen och genomgående
browserprov återstår inom TASK063; huvudmålet är fortsatt ofärdigt.

### TASK063 slutfört UI-snitt: granskning i gemensam adminvy

Vald deltagare → Start- och återkomsthistorik → Hämta granskningsunderlag.
Panelen visar registrerat läge och originalkonflikter, kräver orsak/bekräftelse
och behåller exakt intent vid tappat svar. Samma session, globala pending-
spärr och kvittensvalidering som andra adminändringar. Skogsauto-refresh
pausar när granskningsunderlag är öppet eller beslut väntar. Gamla underlag
rensas vid andra anrop/deltagarbyte; ingen återkomst fabriceras.

Kontroller med CI=true, samtliga exit0:

- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK063
  —1pass,11,2s. Riktig lokal HTTP/PG; lika isolerade DATABASE_URL och
  TEST_DATABASE_URL otid_029_test på55442. Tappat svar efter commit, samma
  body vid retry, en reviewheader, synlig granskningsorsak i journalen.
- pnpm --filter @o-tid/domain exec vitest run test/start-checkin-conflict-review.test.ts
  —9pass,178ms; befintliga tester för förändrat underlag/set och motsägande
  aktuella fakta, ingen ny domänlogik.
- pnpm --filter @o-tid/web build —exit0 efter browserprovet.

Inga misslyckade prov i detta delsteg. PG start/stopp exit0; syntetiska data
bevarade. Ingen bred regression, verklig mobil, samtidighetsstress eller
produktionsmigration. Auto-paus vid just konfliktpanelen är implementerad
men inte separat browserassertad. Tidigare TASK063 server-/journalprov ovan
gäller också. Huvudmålet är inte klart. Nästa minsta snitt: direktgenväg
från en konfliktrad i skogsrapporten till samma granskningsunderlag.

## 2026-09-12: TASK064 direktgenväg till konfliktgranskning

Adminens skogsrad med conflictingReports erbjuder Granska konflikt. Klick
väljer deltagaren och hämtar nytt serverunderlag med uttryckligt deltagar-id,
utan att invänta React-state eller skicka beslut. Befintlig journalgenväg
behålls. Personal/print saknar callback och får ingen granskningsknapp.
Ingen ny ADR behövs utöver ADR-0097; ingen agent eller bred testsuite använd.

Kontroller med CI=true, alla exit0:

- pnpm --filter @o-tid/web lint
- pnpm --filter @o-tid/web typecheck
- pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
- pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
- pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK064
  —1pass,10,0s. Återanvänt TASK063-fall: skogsrad → rätt deltagare →
  granskning → tappat svar → exakt retry → bevarad journal.
- pnpm --filter @o-tid/web build —exit0 efter browser.

Samma isolerade DATABASE_URL/TEST_DATABASE_URL otid_029_test på55442.
PG start/stopp exit0, syntetiska testdata kvar. Inga misslyckade prov.
Verklig mobil, fysisk print och produktion ej verifierade. Huvudmålet kvarstår.
Nästa kandidat till avgränsat funktionellt snitt är klassens startupplägg
(fri start/minutstart) i gemensam admin; kontrollera befintligt stöd först
så att ingen parallell funktion byggs.

## 2026-09-12: TASK065 klassens startregel påbörjad

Kontroll visar att PUNCH/FIXED redan stöds per klass, att StartList-import
kan sätta FIXED och att lottning kräver FIXED. Manuell adminändring saknas.
ADR-0098 dokumenterar ändring även med deltagare/resultat, explicit tömning
och journalföring av gamla fasta tider samt separat omräkning/publicering.
Ren domänplan implementerad; no-op behåller tider, verkligt byte i båda
riktningar tömmer tider och ökar entryversioner utan mutation av indata.

Kontroller med CI=true:

- pnpm --filter @o-tid/domain exec vitest run test/class-start-rule-change.test.ts
  —exit0,1pass,171ms; båda riktningar/no-op/dubbletter/versionsgräns.
- pnpm --filter @o-tid/domain lint —exit0.
- pnpm --filter @o-tid/domain typecheck —exit0.
- pnpm --filter @o-tid/domain build —exit0.

Ingen databas/server/browser körd för ren plan. Inga nya agenter eller breda
tester. TASK065 är inte klar: journal/migration, kontrakt, skrivtjänst och UI
återstår. Snapshot-/resultatuppföljning måste verifieras i integration när
skrivvägen finns. Huvudmålet kvarstår; nästa steg är samma snitts persistens,
inte ytterligare funktioner.

### TASK065 serverjournal och kontrakt

Migration0048 tillför immutable header/items med race/class/actor-scope-FK.
Skrivtjänsten använder befintligt race UPDATE-lås och samma MANAGE_RACE-
session. Exakt request replayas före versionskontroll; oförändrad regel
journalförs utan att tömma tider eller höja versioner. Verkligt byte höjer
snapshot/entryversioner och bevarar tidigare tider i journalen. Ingen
omräkning eller operativ markering görs automatiskt. Mikrosekundstider som
inte kan representeras exakt i millisekundskontrakt avvisas utan ändring.
En billig luna-agent skrev kontrakten; huvudagenten kompletterade kanonisk
tidsvalidering och antalgräns. Ingen dubbelgranskning eller bred testsvit.

Kontroller med CI=true:

- pnpm --filter @o-tid/contracts --filter @o-tid/database --filter @o-tid/application lint —exit0.
- pnpm --filter @o-tid/contracts --filter @o-tid/database --filter @o-tid/application typecheck —exit0.
- pnpm --filter @o-tid/contracts --filter @o-tid/database --filter @o-tid/application build —exit0.
- pnpm --filter @o-tid/contracts lint/typecheck/build (tre separata kommandon
  efter kontraktskomplettering) —alla exit0.
- pnpm --filter @o-tid/database migrate —exit0, endast isolerade
  DATABASE_URL otid_029_test på55442.
- pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts -t TASK065
  —exit0,1pass/7 avsiktligt bortvalda,1,41s; samma TEST_DATABASE_URL.

Agentens egen pnpm-kontroll startade inte pga installationsmiljön; ovanstående
CI=true-kontroller ersätter den. Inga misslyckade faktiska tester. PG
start/stopp exit0, syntetiska data kvar. UI/API-route, förhandsunderlag,
resultatstale-/rollbackprov och browser återstår. Ingen produktionsmigration,
verklig startstation eller offlineenhet verifierad. TASK065/huvudmålet ej klart.

### TASK065 slutfört vertikalt adminsnitt

Gemensam admin kan nu förhandsgranska och ändra en klass mellan PUNCH och
FIXED. Förhandsgranskningen visar antal deltagare, fasta tider och deltagare
med resultat. Ändringen kräver orsak och uttrycklig bekräftelse, behåller ett
fryst intent för exakt retry och visar osäkert svar utan att fabricera utfall.
Ett verkligt byte tömmer klassens fasta tider, höjer snapshot och entryversioner
och journalför de gamla tiderna; no-op behåller tider/versioner. Befintliga
resultatrevisioner och operativa startmarkeringar ändras inte automatiskt.

Riktade kontroller med `CI=true`, samtliga slutliga körningar exit0:

- Domän: `pnpm --filter @o-tid/domain exec vitest run test/class-start-rule-change.test.ts`
  —1 fil/1 test passerade,493ms.
- Route: `pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts -t TASK065`
  —1 passerade/22 avsiktligt bortvalda,1,90s.
- PostgreSQL: `pnpm --filter @o-tid/application exec vitest run test/integration/task-054-administrator-return.test.ts -t TASK065`
  —1 passerade/7 avsiktligt bortvalda,1,80s mot ny isolerad
  `otid_065_test` på loopback55443, migrerad genom0048.
- Browser: `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK065`
  —1 passerade,10,2s mot samma isolerade DB; tappat commitsvar följdes av
  exakt samma request och gav en journalheader.
- Lint: domain/contracts/database/application tillsammans exit0; web separat
  exit0. E2E-spec och konfiguration exit0.
- Typecheck: domain/contracts/database/application/web tillsammans exit0;
  E2E-tsconfig separat exit0.
- Build: domain/contracts/database/application/web tillsammans exit0;
  Next-produktionsbygget kompilerade på1,728s och genererade7/7 statiska sidor.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat, exit0; syntetiska
  testdata lämnades i den privata temporärkatalogen.

Under framtagningen hittade de riktade proven fyra test-/selectorfel: ett
Drizzle-omslaget rollbackfel och tre browserselektorer med tvetydiga element.
Testförväntningar/selektorer rättades; ingen produktionslogik försvagades.
Ingen bred regression kördes enligt användarens önskemål. Ingen verklig
tävling, produktionsmigration, fysisk mobil, offlineåterhämtning eller
SPORTident-hårdvara verifierades. Belastning över gränsen10000 deltagare och
flerprocess-samtidighetsstress är inte provade; servern avvisar gränsöverskridande.

TASK065 är genomfört som avgränsat snitt. Huvudmålet är fortsatt ofärdigt.
Nästa minsta vertikala uppgift är en kompakt uppföljningslista efter byte till
FIXED: deltagare som saknar fast tid, med genväg till befintlig tidstilldelning.

## 2026-09-18: TASK066 uppföljning av saknade fasta starttider påbörjad

Snittet är dokumenterat före implementation. Endast webblagret berörs: en ren
projektion av redan validerat deltagarunderlag, en kompakt lista i TASK065-
panelen och en skrivfri genväg till befintlig individuell starttidsrättning.
Ingen ny ADR behövs eftersom domän, behörighet, API, persistens och offlinegräns
är oförändrade enligt ADR-0098/ADR-0072. Inga tester har körts i plansteget.

### TASK066 slutfört: kompakt uppföljning och genväg

Startuppläggspanelen behåller nu sitt öppna läge efter sparande och visar en
sidindelad lista över deltagare som saknar fast starttid i vald FIXED-klass.
Åtta visas åt gången med svenskt namnurval, stabil ID-ordning och ärlig total.
Genvägen väljer rätt deltagare, växlar till den befintliga TIME-åtgärden och
fokuserar arbetsytan utan skrivning. Först den redan etablerade granskningen/
bekräftelsen sparar tiden; roster laddas då om och den klara raden försvinner.
PUNCH visar ingen sådan uppföljning. Ingen ny route, migration, behörighet,
offlinekö, automatisk lottning eller resultatändring infördes.

En billig gpt-5.6-luna-agent gjorde en skrivfri återanvändningskartläggning.
Den identifierade befintligt rosterkontrakt, projektion och TIME-flöde; detta
minskade ändringsytan till webblagret. Agenten ändrade inga filer och körde
inga tester.

Slutliga riktade kontroller med `CI=true`:

- `pnpm --filter @o-tid/web exec vitest run src/lib/target-class-start-times.test.ts`
  —exit0,1 fil/5 tester passerade,1,33s.
- `pnpm --filter @o-tid/web lint` —exit0.
- `pnpm --filter @o-tid/web typecheck` —exit0.
- E2E-tsconfig och riktad ESLint för adminspec/config —båda exit0.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK066`
  —exit0,1 passerade,14,4s mot isolerad `otid_065_test` på loopback55443.
  Provet visar PUNCH→FIXED med exakt retry, synlig saknad deltagare, skrivfri
  genväg, befintlig starttidsbekräftelse, version2→3 och borttagen uppföljningsrad.
- `pnpm --filter @o-tid/web build` —exit0; Next kompilerade på2,9s,
  TypeScript på3,9s och genererade7/7 statiska sidor.
- Isolerad PostgreSQL stoppades kontrollerat, exit0; syntetiska data bevarades.

Första browserstarten i sandlådan gav EPERM på loopback3122; samma prov kördes
därefter med tillåten loopback. Nästa körning visade en befintlig timingrisk i
testet (login före avslutad sessionskontroll) och därefter att details-elementet
stängdes efter sparande. Testet inväntar nu sessionskontrollen och produkt-UI:t
bevarar panelens öppna tillstånd; slutkörningen är grön. Ingen bred regression.

Kvarvarande antaganden: listan visar senast inläst roster och är ingen
reservation; serverns befintliga versionskontroll avgör skrivningen. Fysisk
mobil/fokus med skärmläsare och produktion är inte fältverifierade. TASK066 är
klart som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: en direkt genväg från samma uppföljning till
befintlig klasslottning för att tilldela tider till hela FIXED-klassen, utan
automatisk lottning eller ny serverlogik.

## 2026-09-18: TASK067 genväg till klasslottning påbörjad

Snittet är dokumenterat före kod. Endast webblagret berörs: TASK066-panelen
ska öppna/fokusera befintlig lottning, läsa dess aktuella serverunderlag och
förvälja samma klass. Klicket får inte skapa preview eller skrivning. Ingen ny
ADR behövs eftersom ADR-0045/ADR-0098, kontrakt, behörighet och persistens är
oförändrade. Inga tester har körts i plansteget.

### TASK067 slutfört: skrivfri genväg till klasslottning

TASK066-panelen erbjuder nu Öppna klasslottning när minst en deltagare saknar
fast tid. Klicket öppnar, scrollar till och fokuserar den befintliga panelen,
hämtar alltid färskt `/draw-classes`-underlag och förväljer samma klass endast
om den fortsatt är lottbar och har deltagare. Ingen preview, request-id, POST,
lottning eller databasändring skapas av genvägen. Den individuella rättningen
finns kvar separat.

En billig gpt-5.6-luna-agent kartlade state/ref/route skrivfritt och ändrade
inga filer. Huvudagenten valde färsk GET även när äldre lottdata finns för att
inte återanvända stale underlag efter regelbyte.

Slutliga riktade kontroller med `CI=true`:

- `pnpm --filter @o-tid/web lint` —exit0.
- `pnpm --filter @o-tid/web typecheck` —exit0.
- E2E-tsconfig och riktad ESLint för adminspec/config —båda exit0.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK067`
  —exit0,1 passerade,13,4s mot isolerad `otid_065_test` på loopback55443.
  Samma verkliga HTTP/PG-kedja verifierar öppnad/fokuserad lottningspanel,
  rätt förvald klass, noll draw-preview/draw-POST och fortsatt individuell
  starttidsrättning.
- `pnpm --filter @o-tid/web build` —exit0; Next kompilerade på2,1s,
  TypeScript på3,9s och genererade7/7 statiska sidor.
- Isolerad PostgreSQL stoppades kontrollerat, exit0; syntetiska data bevarades.

Första browserkörningen nådde rätt val i renderad UI men testets label-locator
var för skör; den avgränsades till panelens enda select. Slutkörningen är grön
utan ändring av produktbeteendet. Ingen bred regression kördes.

Kvarvarande antaganden: fokus/scroll på fysisk mobil och med skärmläsare är
inte fältverifierat; om klassen ändras mellan roster och draw-GET visar vyn
befintligt läsfel och förväljer inget. Själva lottningens sedan tidigare
verifierade preview/commit kördes avsiktligt inte om. TASK067 är klart som
snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: visa deltagare med befintliga resultat som kan
behöva uttrycklig omräkning efter ändrat startupplägg, med genväg till det
befintliga individuella omräkningsflödet och utan automatisk omräkning.
## 2026-09-18: TASK068 uppföljning av äldre klassresultat påbörjad

Snittet är dokumenterat före kod. Endast webblagret berörs: vald klass ska
kunna visa resultatrevisioner från en äldre race-snapshot och erbjuda en
skrivfri genväg till den befintliga explicita omräkningen. Texten säger "kan
behöva omräkning" eftersom snapshotjämförelsen inte bevisar att just
startregeländringen är orsaken. Ingen ny ADR krävs; kontrakt, route,
behörighet, persistens och domängränser förblir oförändrade. En billig
gpt-5.6-luna-agent gjorde en läsrevision utan filändringar eller tester.

### TASK068 slutfört: rådgivande resultatlista och skrivfri genväg

Den valda startregelklassen kan nu hämta befintligt, servervaliderat
omräkningsunderlag. En ren webbprojektion visar endast klassens deltagare vars
senaste lagrade resultatrevision har lägre snapshotVersion än aktuell race.
Texten säger uttryckligen "kan behöva omräkning" och tillskriver inte orsaken
till startregeländringen. Revision, gammal/aktuell tävlingsversion och teknisk
readiness visas kompakt.

Genvägen väljer deltagaren, öppnar/fokuserar den befintliga omräkningsvyn och
hämtar roster/kandidater på nytt. Den skapar inte request-id, POST eller
resultatrevision; befintlig separat granskning och bekräftelse är oförändrad.
Ingen route, migration, behörighet eller ADR tillkom.

Slutliga riktade kontroller med `CI=true`:

- `pnpm --filter @o-tid/web exec vitest run src/lib/class-result-recalculation-follow-up.test.ts`
  —exit0,1 fil/1 test passerade,559ms.
- `pnpm --filter @o-tid/web lint` —exit0.
- `pnpm --filter @o-tid/web typecheck` —exit0.
- E2E-tsconfig och riktad ESLint för adminspec/config —båda exit0.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK068`
  —exit0,1 passerade,16,5s mot ny isolerad `otid_068_test` på loopback55447.
  Riktig HTTP/PostgreSQL verifierar revision1 mot snapshot2, rätt klass och
  deltagare, noll omräknings-POST och fortsatt exakt en resultatrevision.
- `pnpm --filter @o-tid/web build` —exit0; Next kompilerade på2,9s,
  TypeScript på4,1s och genererade7/7 statiska sidor.
- PostgreSQL17/PostGIS stoppades kontrollerat, exit0; syntetiska testdata
  bevarades i `/private/tmp/otid-068-pg17.52jY6C`.

Ett första migrationsförsök mot en ny PostgreSQL16-instans avbröts exit1
innan tester startade eftersom den lokala installationen saknade PostGIS.
Servern stoppades exit0. Samma avgränsade prov kördes därefter grönt med den
lokalt installerade PostgreSQL17/PostGIS. Ingen bred regression kördes.

Kvarvarande antaganden: äldre snapshot bevisar inte vilken ändring som gjorde
resultatet äldre eller att ett manuellt styrt publikresultat kommer att ändras.
Fysisk mobil, skärmläsare och produktion är inte verifierade. TASK068 är klart
som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: lägg samma rådgivande markering direkt på den
valda deltagarens befintliga resultatkort så att administratören ser äldre
underlag utan att först öppna klassens uppföljningspanel; återanvänd samma
snapshotsemantik och gör ingen automatisk omräkning.

## 2026-09-18: TASK069 direkt genväg från äldre resultat påbörjad

Aktuell kodgranskning visade att TASK033 redan visar den rådgivande
stale-markeringen direkt på resultatkortet. Det tidigare förslaget ska därför
inte dupliceras. TASK069 avgränsas till det verkliga glappet: en skrivfri
genväg från just denna varning till befintlig explicit omräkningsgranskning
med färskt underlag. Endast webblagret berörs. Ingen ny ADR krävs eftersom
ADR-0074, serverkontrakt, behörighet och persistens är oförändrade.

### TASK069 slutfört: direkt skrivfri omräkningsgenväg

Det befintliga gällande-resultatkortet visar nu en direkt knapp under
stale-varningen när `resultSnapshotVersion < snapshotVersion`. Knappen väljer
samma deltagare i befintlig `RECALCULATION`, fokuserar arbetsvyn och hämtar
roster/kandidater på nytt. Den skapar inte request-id, POST eller revision;
separat granskning och bekräftelse är fortsatt obligatoriska. Aktuella,
saknade och återtagna resultat får ingen knapp. Manuellt styrande beslut och
den rådgivande texten är oförändrade.

En billig gpt-5.6-luna-agent gjorde en läsrevision och bekräftade befintlig
versionsinvariant samt `NO_ACTIVE_RESULT`/`NO_PUBLISHED_RESULT`-gränsen. Den
ändrade inga filer och körde inga tester. Ingen ny ADR, route, migration eller
serverlogik tillkom.

Slutliga riktade kontroller med `CI=true`:

- `pnpm --filter @o-tid/web lint` —exit0.
- `pnpm --filter @o-tid/web typecheck` —exit0.
- E2E-tsconfig och riktad ESLint för adminspec/config —exit0; efter den sista
  aktuellt-resultat-assertionen kördes E2E-tsconfig och spec-lint åter, exit0.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK069`
  —slutkörning exit0,1 passerade,18,5s. Ett föregående grönt steg passerade
  också1/1 på17,5s innan acceptansen kompletterades.
- `pnpm --filter @o-tid/web build` —exit0; Next kompilerade på1,810s,
  TypeScript på4,0s och genererade7/7 statiska sidor.
- Isolerad PostgreSQL17/PostGIS `otid_069_test` på loopback55448 stoppades
  kontrollerat efter båda browserkörningarna, exit0; endast syntetiska data.

Browserfallet visar aktuellt aktivt resultat utan knapp, därefter revision1
från snapshot1 mot race-snapshot2 med varning och knapp, färskt
omräkningsunderlag för rätt deltagare, noll omräknings-POST och fortsatt exakt
en resultatrevision. Ingen bred regression kördes.

Kvarvarande antaganden: äldre snapshot bevisar inte orsaken eller att ett
manuellt styrt publikresultat ändras; fysisk mobil, skärmläsare och produktion
är inte verifierade. TASK069 är klart som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: visa en kompakt rådgivande "Äldre resultat"-
markering direkt i deltagarlistans rad så att administratören kan hitta
berörda deltagare utan att öppna dem en och en; servern måste härleda den
versionsbundna flaggan och ingen automatisk omräkning får införas.

## 2026-09-18: TASK070 serverhärledd resultataktualitet påbörjad

TASK070 och ADR-0099 är dokumenterade före kod. Kontraktet ska skilja ingen
publicering, inget aktivt resultat, aktuell snapshot och äldre snapshot.
Endast det sista visas som "Äldre resultat" i deltagarlistan. Application ska
välja publicerade huvuden och använda central resolver i bulk i samma
repeatable-read; ingen N+1-route, migration eller automatisk omräkning.
Berörda paket är contracts, application och web. En billig gpt-5.6-luna-agent
gjorde läsrevision utan filändringar eller tester.

### TASK070 slutfört: kompakt markering av äldre resultat

Deltagarlistans befintliga rosterkontrakt redovisar nu fyra explicita lägen:
`NO_PUBLISHED_RESULT`, `NO_ACTIVE_RESULT`, `CURRENT_SNAPSHOT` och
`OLDER_SNAPSHOT`. Application hämtar publicerade resultathuvuden i bulk i
samma låsta repeatable-read-snapshot och använder den centrala resolvern för
manuella beslut och återtaganden. Endast ett aktivt resolverat resultat med
lägre snapshotVersion än tävlingen visas som textmärket "Äldre resultat".

Markeringen ligger på rätt kompakt deltagarrad, är inte enbart färgburen och
ändrar varken sökning, sortering, resultat eller skrivflöden. Ingen HTTP-N+1,
ny route, migration, behörighet, dependency eller automatisk omräkning
tillkom. ADR-0099 dokumenterar den nya observerbara kontraktssemantiken.

Slutliga riktade kontroller med `CI=true`:

- Kontraktsprov: `pnpm --filter @o-tid/contracts exec vitest run test/entry-transfer.test.ts`
  — exit0, 1 fil/3 tester passerade, tester42ms, total1,17s.
- Typecheck för `@o-tid/contracts`, `@o-tid/application` och `@o-tid/web`
  — samtliga exit0.
- PostgreSQL-integrationsprov:
  `pnpm --filter @o-tid/application exec vitest run test/integration/task-033-administrator-effective-result.test.ts`
  — exit0, 1 fil/3 tester passerade, tester785ms, total2,02s mot isolerad
  PostgreSQL17/PostGIS `otid_070_test` på loopback55449.
- Lint för contracts, application och web — samtliga exit0.
- E2E-tsconfig samt riktad ESLint för adminspec/config — båda exit0.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK070`
  — exit0, 1 passerade, 15,8s mot samma isolerade HTTP/PostgreSQL-miljö.
- `pnpm --filter @o-tid/contracts --filter @o-tid/application --filter @o-tid/web build`
  — exit0 för alla tre paket; Next kompilerade på2,9s, TypeScript på8,8s
  och genererade7/7 statiska sidor på94ms. Checkin-skalets hash var
  `b2bff3628105` med3 publika assets.
- PostgreSQL stoppades kontrollerat efter proven, exit0. Endast syntetiska
  data användes och ingen bred regressionssvit kördes.

Kvarvarande antaganden: märket betyder enbart äldre snapshot och bevisar inte
orsaken eller att omräkning är nödvändig. Ingen publicering och inget aktivt
resultat visas avsiktligt utan märke. Historikskyddets gräns1000 är en
konservativ fail-closed driftgräns för trasigt eller orimligt stort underlag.
Fysisk mobil, skärmläsare och produktionsmiljö är inte verifierade. TASK070 är
klart som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: lägg till ett lokalt filter "Visa endast äldre
resultat" i deltagarlistan med det redan serverhärledda freshness-fältet,
utan ny serverlogik, skrivning eller automatisk omräkning.

## 2026-09-18: TASK071 lokalt filter för äldre resultat påbörjat

Snittet är dokumenterat före kod. Endast webblagret berörs: en svensk
checkbox ska kombinera befintlig sökning med ADR-0099:s serverhärledda
`OLDER_SNAPSHOT`, återställa pagination till första sidan och inte skapa
HTTP-anrop eller skrivning. Vald deltagare bevaras eftersom filtret endast
styr listans synlighet. Ingen ny ADR eller licensfråga behövs. En billig
gpt-5.6-luna-agent gjorde en strikt läsrevision utan filändringar eller tester.

### TASK071 slutfört: lokalt filter för äldre resultat

Den gemensamma administratörslistan har nu en touchvänlig svensk checkbox
"Visa endast äldre resultat". Predikatet använder bara ADR-0099:s redan
serverhärledda `OLDER_SNAPSHOT`, kombineras som ett snitt med befintlig
sökning och återställer sidindex till 0. Söktext och valt deltagarärende
bevaras; utloggning rensar filterläget.

Filtret gör inga egna HTTP-anrop, skrivningar eller omräkningar. Ingen route,
kontrakts-, server-, databas-, behörighets-, dependency- eller ADR-ändring
tillkom.

Slutliga riktade kontroller med `CI=true`:

- `pnpm --filter @o-tid/web lint` — exit0.
- `pnpm --filter @o-tid/web typecheck` — exit0.
- E2E-tsconfig — slutkörning exit0, 6,0s.
- Riktad ESLint för adminspec/config — slutkörning exit0, 4,3s.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK071`
  — slutkörning exit0, 1 passerade, 16,2s mot isolerad PostgreSQL17/PostGIS
  `otid_070_test` på loopback55449. Fallet använder 27 syntetiska deltagare,
  går till sida 2/2, återställs till sida 1 vid filterbyte, visar exakt den äldre
  posten, kombinerar med sökning, bevarar urval och observerar 0 nya
  `transfer-candidates`-anrop.
- `pnpm --filter @o-tid/web build` — exit0; Next kompilerade på 1,601s,
  TypeScript på 3,9s och genererade 7/7 statiska sidor på 99ms. Checkin-skalets
  hash var `b2bff3628105` med 3 publika assets.
- PostgreSQL stoppades kontrollerat, exit0. Endast syntetiska data användes.
  Ingen ny enhets- eller bred regressionssvit kördes.

Kvarvarande antaganden: fysisk mobil, handskar/regn, skärmläsare och produktion
är inte verifierade. Ett valt ärende kan avsiktligt ligga kvar i arbetsytan
även om ett nytt listfilter döljer raden. Filterläget är lokalt och delas inte
mellan administratörer eller enheter. TASK071 är klart som snitt, men
huvudmålet kvarstår.

Nästa minsta vertikala uppgift: visa det redan lokalt härledda antalet äldre
resultat direkt i filteretiketten, så att administratören ser arbetsmängden
utan att först aktivera filtret; ingen ny serverlogik eller skrivning.

## 2026-09-18: TASK072 antal äldre resultat påbörjat

Snittet är dokumenterat före kod. Endast webblagret berörs. Filteretiketten
ska visa hela det inlästa rosterunderlagets antal `OLDER_SNAPSHOT`, oberoende
av söktext och filterläge. Oinläst underlag får inget fabricerat nollvärde.
Ingen ny ADR, serverlogik, persistens eller licensfråga tillkommer.

En billig gpt-5.6-luna-agent gjorde en strikt läsrevision utan filändringar
eller tester och bekräftade att totalen ska vara oberoende av sökningen.

### TASK072 slutfört: synlig arbetsmängd i resultatfiltret

Filteretiketten visar nu hela det inlästa rosterunderlagets antal
`OLDER_SNAPSHOT`, exempelvis "Visa endast äldre resultat (1)". Antalet är
oberoende av söktext, pagination och om filtret är aktiverat. När underlaget
inte är inläst visas etiketten utan tal i stället för en fabricerad nolla.

All härledning sker lokalt från det redan validerade rosterunderlaget. Ingen
ny HTTP-läsning, skrivning, omräkning, route, kontrakts-, server-, databas-,
behörighets-, CSS-, dependency- eller ADR-ändring tillkom.

Slutliga riktade kontroller med `CI=true`:

- `pnpm --filter @o-tid/web lint` — exit0, 15,2s.
- `pnpm --filter @o-tid/web typecheck` — exit0, 13,5s.
- E2E-tsconfig — exit0, 8,9s.
- Riktad ESLint för adminspec/config — exit0, 6,5s.
- `pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK072`
  — exit0, 1 passerade, 17,2s mot isolerad PostgreSQL17/PostGIS
  `otid_070_test` på loopback55449. Samma 27 syntetiska deltagare visar `(0)`
  före versionsändringen och `(1)` efter den; totalen kvarstår med aktiverat
  filter och en sökning med noll synliga träffar.
- `pnpm --filter @o-tid/web build` — exit0; Next kompilerade på 1,295s,
  TypeScript på 3,8s och genererade 7/7 statiska sidor på 96ms. Checkin-skalets
  hash var `b2bff3628105` med 3 publika assets.
- PostgreSQL stoppades kontrollerat, exit0. Endast syntetiska data användes.
  Ingen ny enhets- eller bred regressionssvit kördes.

Kvarvarande antaganden: totalen avser senaste inlästa roster, inte serverstate
som ändrats därefter. Fysisk mobil, handskar/regn, skärmläsare och produktion
är inte verifierade. TASK072 är klart som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: inför en explicit, journalförd hyrbrickemarkering
på den befintliga brickkopplingen och visa den i administratörens deltagarrad;
betalning och hyrbrickerapport lämnas till senare snitt. Beslutet ska först
dokumenteras i en ADR eftersom deltagarmodellen och persistensen utökas.

## 2026-09-18: TASK073 journalförd hyrbrickemarkering påbörjad

TASK073 och ADR-0100 är dokumenterade före migration och produktkod. Hyrstatus
tillhör den konkreta brickkopplingen, ändras genom ett separat idempotent
kommando och får inte förväxlas med brickbyte, betalning eller återlämning.
Snittet berör database, contracts, application och web. En billig
gpt-5.6-luna-agent gjorde en strikt läsrevision utan filändringar eller tester.

### TASK073 slutfört: journalförd hyrstatus i gemensam administration

Den enda aktiva brickkopplingen kan nu markeras och avmarkeras som hyrbricka
av samma `MANAGE_RACE`-administratör. Ändringen binder assignment-id,
bricknummer, föregående status, entryversion, race-snapshot, aktör och request-id.
Den uppdaterar hyrstatus och båda versionerna atomiskt, skapar en separat
immutable journal samt audit-event och återger samma kvittens vid exakt retry.

Den privata rosterprojektionen exponerar status endast för exakt en aktiv
assignment. Deltagarraden visar den textbundna markeringen "Hyrbricka" och
brickpanelen kräver granskning före markering eller avmarkering. Tappat svar
behåller exakt request. Bricknummer, råmeddelanden, avläsningar och resultat
ändras inte. Betalning, avgift, återlämning, rapport, stationpackage och
startlista ingår inte.

Slutliga riktade kontroller med `CI=true`:

- Lint: database exit0 3,77s; contracts exit0 4,23s; application exit0
  12,74s; web exit0 12,66s.
- Typecheck: database exit0 2,40s; contracts exit0 2,05s; application exit0
  7,48s; web exit0 10,52s.
- Kontrakt: 2 filer, 5 tester passerade, exit0, 787ms.
- Riktad PostgreSQL-integration: 1 fil, 2 tester passerade, exit0, 1,47s.
- Webbens route-handler: 1 fil, 24 tester passerade, exit0, 2,14s.
- E2E TypeScript och riktad ESLint: exit0.
- Riktat browserprov `--grep TASK073`: 1 test passerade, exit0, 22,7s mot
  isolerad PostgreSQL17/PostGIS `otid_070_test` på loopback55449. Det tappade
  första commitsvaret, återförde exakt samma body, visade "Hyrbricka" och
  verifierade en journalrad.
- Build: database exit0 2,53s; contracts exit0 2,19s; application exit0 5,85s;
  web exit0 22,03s. Next kompilerade på 5,8s, TypeScript på 10,8s och
  genererade 7/7 statiska sidor på 99ms. Checkin-skalets hash var
  `bc8e5014c2b1` med 3 publika assets.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat, exit0.

Första PostgreSQL-försöket kunde inte ansluta från sandboxen (`EPERM`) och
utförde inga tester. Första tillåtna körningen blottlade två felaktiga
testförväntningar (ett credential-audit-event och ett schemaogiltigt
oförändrat intent); produktkoden ändrades inte för dessa. Efter korrigering
passerade slutkörningen 2/2.

Kvarvarande antaganden: befintliga kopplingar får avsiktligt `false`; det är
inte bevis på privat ägande. Statusen ingår ännu inte i startlista,
stationspaket, avgift eller återlämningsflöde. Fysisk mobil, handskar/regn,
skärmläsare, samtidighet under produktionslast och produktionsmigration är
inte verifierade. Endast syntetiska data användes. TASK073 är klart som snitt,
men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: en read-only hyrbrickslista för mål-/
tävlingsadministration som sammanställer de redan markerade aktiva
kopplingarna; ingen betalning eller återlämningsskrivning.

## 2026-09-18: TASK074 skrivskyddad hyrbrickslista påbörjad

TASK074 är dokumenterad före kod. Snittet återanvänder TASK073:s skyddade
roster och blir ett lokalt filter med total, namn, klass och aktivt
bricknummer. Inaktiva, saknade eller multipla assignments får ingen träff.
Ingen ny route, databasfråga, capability, dependency eller ADR behövs eftersom
domän- och persistensbeslutet redan finns i ADR-0100. En billig
gpt-5.6-luna-agent gjorde en strikt läsrevision utan filändringar eller tester.

### TASK074 slutfört: lokal hyrbrickslista med synligt bricknummer

Den gemensamma deltagarlistan har nu filtret "Visa endast hyrbrickor (N)".
Totalen räknas från hela den redan validerade rostern och filtreringen sker
strikt på `activeAssignment.isRental === true`. En träff visar namn, klass och
"Hyrbricka · bricknummer". Sökning och äldre-resultat-filter kombineras med
hyrfiltret, sidindex återställs och valt deltagarärende bevaras.

Filtret gör inga HTTP-anrop eller skrivningar. Inaktiv historisk hyrassignment,
saknad assignment och multipla aktiva assignments ger ingen falsk träff. Ingen
route, databasfråga, capability, migration, dependency eller ADR tillkom.

Slutliga riktade kontroller med `CI=true`:

- Web lint — exit0, 13,04s.
- Web typecheck — exit0, 10,55s.
- Befintliga rental-/rosterkontrakt — 2 filer, 5 tester passerade, exit0,
  778ms (kommandot 1,59s).
- E2E TypeScript — exit0, slutkörning.
- Riktad E2E ESLint — exit0, slutkörning.
- Browser `--grep TASK074` — exit0, 1 test passerade, 24,0s mot isolerad
  PostgreSQL17/PostGIS `otid_070_test` på loopback55449. Underlaget innehöll
  en aktiv hyrbricka, en inaktiv historisk hyrbricka och en deltagare med två
  aktiva kopplingar; totalen var exakt 1, kortnumret visades, sökningen
  kombinerades och 0 nya rosteranrop observerades.
- Web build — exit0, 16,00s. Next kompilerade på 1913ms, TypeScript på 5,9s,
  genererade 7/7 statiska sidor på 137ms och checkin-skalet behöll hash
  `bc8e5014c2b1` med 3 publika assets.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat, exit0.

Första browserkörningen avvisade endast en felaktig testförväntning om
klassnamnet: startupplägget ändrades på `Testklass`, deltagaren flyttades inte.
Efter korrigering och tillägg av negativa assignmentfall passerade
slutkörningen. Produktkoden ändrades inte för detta testfel.

Kvarvarande antaganden: listan avser senast inlästa skyddade roster och är inte
en ekonomisk eller fysisk återlämningslista. Fysisk mobil, handskar/regn,
skärmläsare och produktion är inte verifierade. Endast syntetiska data användes.
TASK074 är klart som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: lägg till en skrivskyddad utskriftsvy för den
filtrerade hyrbrickslistan, med tävlingsnamn, genereringstid, namn, klass och
aktivt bricknummer; ingen betalning eller återlämningsstatus.

## 2026-09-18: TASK075 privat hyrbricksutskrift påbörjad

TASK075 är dokumenterad före kod. Befintlig rosterprojektion utökas additivt
med eventnamn, loppnamn och serverns genereringstid; interna id:n får inte
ersätta användarens tävlingsnamn. Ett explicit print-target ska isolera
hyrbricksrapporten från befintlig skogsrapport. Ingen ny route, capability,
migration, PDF-generator eller ADR behövs. En billig gpt-5.6-luna-agent gjorde
en strikt läsrevision utan filändringar eller tester.

### TASK075 slutfört: isolerad privat hyrbricksutskrift

Den gemensamma skyddade rostern binder nu eventnamn, loppnamn och serverns
`generatedAt` i samma repeatable-read-transaktion som deltagarunderlaget.
Administratören får en knapp "Skriv ut hyrbrickor" endast när minst en
entydig aktiv hyrbricka finns. Utskriften visar tävling, lopp, tävlingsdatum,
servergenereringstid/tidszon, antal, namn, klubb, klass och aktivt bricknummer
samt en tydlig personuppgifts- och avgränsningsnotis.

Ett explicit `RENTAL`/`FOREST` print-target gör att hyrbricksrapporten,
skogsrapporten och adminformulären aldrig visas samtidigt i printmedia.
Knappen använder browserns `window.print()` och gör inget HTTP-anrop eller
skrivning. Ingen PDF-generator, ny route, capability, migration, dependency
eller ADR tillkom.

Slutliga riktade kontroller med `CI=true`:

- Kontraktsprov `entry-transfer` — exit0, 1 fil och 3 tester passerade, 686ms
  (kommandot 1,46s).
- Contracts lint/typecheck — exit0, 4,17s / 1,89s.
- Application lint/typecheck — exit0, 11,70s / 6,80s.
- Web lint/typecheck — exit0, 11,36s / 8,94s.
- E2E TypeScript/riktad ESLint — exit0, 5,42s / 3,56s.
- Browser `--grep TASK075` — exit0, 1 test passerade, 21,7s mot isolerad
  PostgreSQL17/PostGIS `otid_070_test` på loopback55449. Det verifierade att
  knappen saknas före hyrmarkering, fångade `window.print`, observerade 0 nya
  rosteranrop, visade bara hyrbricksrapporten i printmedia och uteslöt den
  inaktiva och den tvetydiga assignmenten.
- Befintlig printregression `--grep TASK052` — slutkörning exit0, 1 test
  passerade, 9,5s; skogsrapporten förblev isolerad.
- Builds: contracts exit0 3,79s; application exit0 9,14s; web exit0 24,25s.
  Next kompilerade på 3,0s, TypeScript på 13,4s, genererade 7/7 statiska sidor
  på 135ms och checkin-skalets hash var `db6f1c7194f7` med 3 publika assets.
- Den isolerade PostgreSQL-instansen stoppades kontrollerat, exit0.

Första TASK052-körningen timeoutade efter login innan printsteget och visade
den återställda loginytan; ingen databas- eller serveravvikelse registrerades.
En oförändrad omkörning passerade på 9,5s, vilket klassas som transient
testmiljö och inte produktbevis från den misslyckade körningen.

Kvarvarande antaganden: utskriften använder browserns och operativsystemets
utskriftsdialog; ingen fysisk skrivare eller sparad PDF verifierades. En
utskriven eller sparad kopia kan inte återkallas vid logout. Fysisk mobil,
skärmläsare och produktion är inte verifierade. Endast syntetiska data
användes. TASK075 är klart som snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: inför en explicit, journalförd markering av att
en hyrbricka har återlämnats och visa endast ännu inte återlämnade hyrbrickor;
betalning och avgifter ska fortsatt lämnas utanför och databeslutet kräver en
ny ADR före implementation.

## 2026-09-18: TASK076 hyrbrickans återlämning påbörjad

TASK076 och ADR-0101 är dokumenterade före kod. Återlämningsstatus binds till
den konkreta brickassignmenten och får inte härledas ur `active`: resultatets
brickkoppling ska bestå efter fysisk återlämning. Snittet blir ett additivt,
idempotent `MANAGE_RACE`-kommando med immutable journal, explicit rättning och
ett rosterfält som låter befintlig lista/utskrift utesluta återlämnade brickor.
Betalning, avgift, lager, fysisk skanning, SPORTident-USB, GPS och stafett
ingår inte. En billig gpt-5.6-luna-agent gjorde en strikt läsrevision utan
filändringar eller tester.

### TASK076 slutfört: journalförd återlämning och rättning

Migration0050 lägger additivt `card_assignment.rental_returned` och den
immutable journalen `entry_card_rental_return_change`. Ett strikt
`MANAGE_RACE`-kommando binder request-id, aktör, race, entry, exakt aktiv
hyrassignment och entry-/snapshotversion. Projection, journal, audit och båda
versionerna sparas atomiskt; exakt retry ger samma kvittens. Fel scope, stale,
icke-hyrd eller oklar assignment avvisas utan skrivning.

Administratören kan nu granska och markera "Återlämnad" samt rätta till
"Inte registrerad som återlämnad". Assignmenten förblir aktiv och samma
bricknummer/resultatkoppling bevaras. Roster, lokalt filter, total och privat
utskrift omfattar endast `isRental && !rentalReturned`; den vanliga
deltagarraden visar återlämningsstatus textuellt.

Slutliga riktade kontroller med `CI=true`:

- Kontraktsprov — exit0, 2 filer och 5 tester passerade, Vitest 2,07s.
- PostgreSQL-integration TASK076 — exit0, 1 fil och 2 tester passerade,
  slutlig testtid 181ms och Vitest 2,22s mot isolerad PostgreSQL17/PostGIS
  `otid_076_test` på loopback55449.
- Browser `--grep TASK076` — exit0, 1 test passerade på 23,0s mot samma
  isolerade databas. Det verifierade återlämning, tappat commitsvar/exakt
  retry, fortsatt aktiv assignment, borttagning ur list-/printurval samt
  explicit rättning tillbaka.
- Lint — database, contracts, application, web och riktad E2E: samtliga exit0.
- Typecheck — database, contracts, application, web och E2E: samtliga exit0.
- Builds — database, contracts, application och web: samtliga exit0. Webben
  kompilerade på 6,6s, TypeScript på 10,9s, genererade 7/7 statiska sidor på
  108ms och checkin-skalets hash var `78bc94c80798` med 3 publika assets.
- Den isolerade PostgreSQL17-instansen stoppades kontrollerat, exit0; testdata
  bevarades i den privata temporära testklustern.

Första integrationsförsöket nådde ingen testkod: ett äldre isolerat PG16-
kluster utan PostGIS startades av misstag och gav exit1 med 2 avsiktligt
skippade testfall. Det klustret stoppades; oförändrat test passerade mot rätt
PG17/PostGIS. Första browserkörningen gav exit1 efter produktflödet eftersom
testet hade kvar sökordet "Bertil" när Åsa-raden kontrollerades. Endast testets
sökfält nollställdes; oförändrad produktkod passerade slutkörningen.

Kvarvarande antaganden: befintliga rader får default `false`, vilket betyder
"inte registrerad som återlämnad" och inte bevisar fysisk utlåning. Fysisk
inventering, verklig mobil, skärmläsare, produktionsmigration och fysisk
utskrift är inte verifierade. Endast syntetiska data användes. Betalning,
avgift, lager, SPORTident-USB, GPS och stafett ingår inte. TASK076 är klart som
snitt, men huvudmålet kvarstår.

Nästa minsta vertikala uppgift: visa hyrmarkeringar och återlämningsbeslut i
den befintliga deltagarhistoriken, inklusive tidpunkt och rättningar, utan ny
skrivväg eller ekonomifunktion.

## 2026-09-18: TASK077 hyrbricksbeslut i deltagarhistoriken påbörjad

TASK077 är dokumenterad före kod. Snittet utökar enbart ADR-0078:s befintliga
privata read-only-projektion med TASK073/076:s immutable journaler och behåller
samma `MANAGE_RACE`, repeatable-read, race-/entry-scope och exklusiva
deltagarversionscursor. Ingen migration, ny route, capability eller ADR behövs;
ADR-0100/0101 äger redan statussemantiken. En billig gpt-5.6-luna-agent gjorde
en strikt läsrevision utan filändringar eller tester.

## 2026-09-19: projektgenomgång och plan, ingen fortsatt implementation

På användarens uttryckliga begäran gjordes en skrivskyddad genomgång med två
avgränsade GPT-5.6-agenter. Plan och nuläge finns i
`docs/project-review-and-plan-2026-09-19.md`, funktionstäckningen i
`docs/meos-feature-matrix.md` och externa produktkällor i
`docs/research/meos-product-reference-2026-09-19.md`.

TASK077 är fortsatt halvfärdig: kontrakt, kontraktstest och application-
projektion är påbörjade, UI:s text-/värdemappning och slutacceptans återstår.
Ingen produktkod ändrades eller återställdes i genomgången. Inga tester,
byggen, migrationer eller Eventor-anrop kördes; tidigare gröna kontroller
innebär inte att arbetskopian efter TASK077-starten är verifierad.
Webbserver saknades på kontrollerade projektportar, så UI-bedömningen bygger
på kod/CSS och tidigare dokumenterade browserprov. Genomförandet fortsätter
först i den separata tråd användaren avser att starta.

### TASK077 slutfört: hyrstatus och återlämning i deltagarhistoriken

Planens A1 är nu genomförd. Den befintliga `MANAGE_RACE`-skyddade
deltagarhistoriken läser TASK073:s hyrmarkeringar och TASK076:s
återlämning/rättning i samma repeatable-read-transaktion, race-/entry-scope,
fallande merge-sort och exklusiva deltagarversionscursor som övriga
administrativa ändringar. Journalernas assignment, aktör/capability, statusbyte
och versionssteg valideras; dubbla versioner över journaltyper avvisas
fail-closed.

Den befintliga Historik-vyn visar `Hyrstatus` och `Återlämning` med svenska,
frysta före-/eftervärden. Ingen ny route, mutation, capability, migration,
dependency eller ADR tillkom. GPT-5.6 Terra tog fram det avgränsade
PostgreSQL-provet och GPT-5.6 Luna UI-/browserdelen; huvudagenten granskade,
kompletterade det negativa databasfallet och körde verifieringen.

Slutliga riktade kontroller med `CI=true`:

- kontraktsprov — exit0, 1 fil och 4 tester passerade, Vitest 492ms;
- PostgreSQL-integration — exit0, 1 fil och 2 tester passerade, Vitest 845ms
  (testtid 91ms) mot isolerad PostgreSQL17/PostGIS `otid_077_test` på
  loopback55449;
- browser `--grep TASK077` — exit0, 1 test passerade på 16,2s mot samma
  isolerade databas;
- lint — contracts, application, web och riktad E2E: samtliga exit0;
- typecheck — contracts, application, web och E2E: samtliga exit0;
- builds — contracts, application och web: samtliga exit0. Webben kompilerade
  på 2,9s, TypeScript på 4,9s, genererade 7/7 statiska sidor på 54ms och
  checkin-skalets hash var `e22b5520cfa8` med 3 publika assets.
- den isolerade PostgreSQL17-instansen stoppades kontrollerat, exit0; testdata
  bevarades i den privata temporära testklustern.

Första PostgreSQL-starten i sandlådan nådde ingen testkod: macOS SysV shared
memory avvisades. Ett eskalerat försök utan den privata klusterns port försökte
5432 och avvisades eftersom porten redan användes. Start med uttrycklig port
55449 lyckades; därefter passerade samtliga tester utan produktändring för
miljöfelen.

Kvarvarande antaganden: historiken bevisar journalförda administrativa beslut,
inte fysisk utlämning eller inventering. Fysisk mobil, skärmläsare, produktion
och verkliga tävlingsdata är inte verifierade. Betalning, avgift, lager,
SPORTident-USB, GPS och stafett ingår inte. Huvudmålet kvarstår.

Nästa minsta vertikala uppgift enligt genomförandeplanen är A2: gör aktuell
syntetisk demo enkel att prova via befintlig provisionering och ett gemensamt
administratörsinträde, med en deltagare i fri start och en i minutstart. Inga
nya demoverktyg eller produktfunktioner ska byggas om befintliga räcker.

## 2026-09-19: TASK078 aktuell provbar demo slutförd

Planens A2 är genomförd enligt ADR-0102. `demo:provision` återanvänder fortsatt
TASK007:s tomdatabasgrind, överordnade transaktion och privata mode-0600-fil,
men skapar nu exakt fyra entimmesroller: de tre tidigare operativa rollerna
samt befintlig racebunden `MANAGE_RACE`. Den hemlighetsfria sammanfattningen
innehåller en scopebunden `/manage`-länk men inget tokenmaterial.

Två demoegna IOF-fixtures ger Ada H21 med `PUNCH` och Bo D21 med `FIXED` och
fast tid 2026-09-19 10:00 +02:00. D21 installeras initialt med verklig gräns 2
och deltagarantal 1. Det utökade befintliga TASK007-browserfallet loggar in med
`MANAGE_RACE`, söker Ada, visar 1/2, genomför ett granskat klass-/starttidsbyte
till D21 och återställer Ada till H21. Därefter verifierar samma kedja
simulatoravläsning, oinloggat publikresultat, offline startavprickning, reload,
synk och privat skogslista. Ingen ny route, migration, capability, dependency,
resultatregel eller produktionsdeployment tillkom.

GPT-5.6 Terra genomförde backend-/kontraktsdelen efter läsgranskning och GPT-5.6
Luna uppdaterade den aktuella demoingången. Huvudagenten granskade ändringarna,
lade till browserkedjan, rättade dokumentationen och körde slutverifieringen.

Slutliga riktade kontroller med `CI=true`:

- demo-kontrakt — exit0, 1 fil och 2 tester passerade, Vitest 403ms;
- TASK007/TASK078 PostgreSQL-integration — exit0, 1 fil och 5 tester passerade,
  Vitest 3,67s (testtid 2,92s) mot isolerad PostgreSQL17/PostGIS på
  loopback55449;
- Playwright med `playwright.demo.config.ts` — exit0, 1 test passerade på
  16,6s mot en ny tom `otid_demo_078_a2`; testdatabasen lämnas bevarad;
- contracts lint+typecheck — exit0, sammanlagt 5,45s; application
  lint+typecheck — exit0, 12,73s; demo-E2E TypeScript+ESLint — exit0, 5,50s;
  scripts TypeScript+ESLint — exit0, 6,31s;
- builds — contracts exit0 1,34s; application exit0 3,66s; web
  lint+typecheck+build exit0 23,10s. Next kompilerade på 2,3s, TypeScript på
  4,8s, genererade 7/7 statiska sidor på 54ms och checkin-skalets hash var
  `e53e8e7fbe18` med 3 publika assets;
- den isolerade PostgreSQL17-instansen stoppades kontrollerat, exit0; testdata
  bevarades i den privata temporära testklustern.

Första integrationsförsöket nådde ingen testkod eftersom sandlådan avvisade
loopbackanslutningen med `EPERM`; samtliga fem fall visades som skipped och
kommandot gav exit1. Oförändrat prov med tillåten anslutning passerade 5/5.
Det var ett miljöfel och används inte som produktbevis. Ingen bred workspace-
eller äldre demosvit kördes eftersom planen uttryckligen föreskriver det enda
befintliga demofallet och berörda paketkontroller.

Kvarvarande antaganden: demon är syntetisk och den fasta 2026-09-19-tiden är
testunderlag, inte aktuell tävlingsdata. Fysisk mobil över lokalt nät,
produktions-HTTPS, fler samtidiga operatörer, riktig Eventorimport,
SPORTident-USB, skärmläsare och produktionslast är inte verifierade. Credential
löper ut efter en timme och får då återutfärdas betrott; auth får inte stängas
av. Huvudmålet och MeOS-likvärdigheten kvarstår.

Nästa minsta vertikala uppgift enligt planen är A3:s första vardagsyta i
befintliga `/manage`: välj en enda saknad operativ sammanställning och återanvänd
befintlig data/session. Bygg inte om hela arbetsvyn och starta inte B1, GPS,
stafett eller riktig USB i samma snitt.

## 2026-09-19: TASK079 kompakt tävlingsstatus slutförd

Planens första A3-snitt är klart. Efter `MANAGE_RACE`-inloggning visar
`/manage` nu en namngiven, kompakt `Tävlingsstatus` före mobilnavigation och
arbetskolumner. Den visar hela rosterunderlagets deltagare, klasser, klasser
med fri respektive minutstart, resultat från äldre tävlingsversion och ännu
inte återlämnade hyrbrickor. Underlagsversion och serverns `generatedAt` visas
i tävlingens tidszon.

Alla värden härleds klientlokalt ur den redan kontraktsvaliderade
`EntryTransferCandidates`; sökning, filter, sida och vald deltagare ändrar
inte totalerna. Äldre resultat betyder endast `OLDER_SNAPSHOT` och
hyrbrickantalet behåller TASK074/076:s entydiga aktiva assignmentdefinition.
Fri/minutstart räknar klasser, inte deltagare, kapacitet eller reserverade
startluckor. Befintliga mutationer uppdaterar remsan via ordinarie rosterreload.
Ingen ny route, fråga, polling, capability, kontraktsversion, migration,
dependency eller ADR tillkom.

GPT-5.6 Terra gjorde en skrivskyddad datagränsrevision och GPT-5.6 Luna en
skrivskyddad desktop-/mobilrevision. Huvudagenten låste TASK079, implementerade
den semantiska statusregionen, utökade ett befintligt browserfall och körde
slutverifieringen.

Slutliga riktade kontroller med `CI=true`:

- web lint — exit0, 8,44s;
- web typecheck — exit0, 7,24s;
- E2E TypeScript — exit0, 4,66s;
- riktad E2E ESLint — exit0, 3,31s;
- Playwright `--grep TASK079` — exit0, 1 test passerade på 16,6s mot isolerad
  PostgreSQL17/PostGIS `otid_077_test` på loopback55449. Fallet verifierade
  initiala rosterantal, PUNCH→FIXED, äldre resultat, hyrmarkering,
  återlämning och 390 px utan horisontell sidscroll;
- web build — exit0, 7,0s. Next kompilerade på 1,335s, TypeScript på 2,4s,
  genererade 7/7 statiska sidor på 57ms och checkin-skalets hash var
  `e53e8e7fbe18` med 3 publika assets;
- den isolerade PostgreSQL17-instansen stoppades kontrollerat, exit0; befintlig
  syntetisk testdata bevarades.

Ingen full workspace-, kontrakts- eller serverregression kördes eftersom
snittet inte ändrade serverbeteende eller DTO och planen kräver proportionell
verifiering. Inga testfel inträffade.

Kvarvarande antaganden: statusen är en serverläst rosterbild, inte livebevis om
nät, hårdvara eller skogen. Hyrbrickantalet är inte ett fysiskt lager och
utelämnar avsiktligt tvetydiga multipla assignments. 390 px verifierades i
desktopbrowserns emulering; fysisk mobil, handskar/regn/glare, skärmläsare och
produktion är inte verifierade. Huvudmålet och A3 kvarstår.

Nästa minsta vertikala uppgift: visa den redan kända aktiva brickan och
startupplägget kompakt på varje deltagarrad i samma roster. Återanvänd befintlig
DTO och mobil list-/arbetsväxling; lägg inte till ny serverfråga, mutation eller
generell tabellrefaktorering.

## 2026-09-19: TASK080 rosterdetaljer och Etapp A slutförda

Administratörens deltagartabell visar nu `Namn och klubb`, `Klass`, `Bricka`
och `Start` som synliga semantiska kolumner. Entydig aktiv bricka, ingen aktiv
bricka och flera aktiva brickor är olika textlägen; multipel konflikt visar
aldrig ett godtyckligt nummer. PUNCH visas som fri start/startstämpling även om
ett stale tidsfält skulle finnas. FIXED visar minutstart och full tid i
tävlingens tidszon eller explicit `Ingen fast starttid`.

Befintlig deltagarknapp/`aria-pressed`, sökning, filter, pagination,
hyrbrickbadge och äldre-resultatbadge är bevarade. Fast tabellayout och brytbar
text håller sidan inom 390 px. Allt kommer från befintlig
`EntryTransferCandidates`; ingen route, fråga, DTO, kontraktsversion, mutation,
migration, dependency eller ADR tillkom.

GPT-5.6 Terra granskade sanningsreglerna för start och aktiva assignments.
GPT-5.6 Luna granskade tabellsemantik och responsivitet. Huvudagenten låste
TASK080, implementerade rosterkolumnerna, utökade samma browserkedja och körde
en separat befintlig desktopacceptans för hela A3.

Slutliga riktade kontroller med `CI=true`:

- web lint — exit0, 7,90s;
- web typecheck — exit0, 3,31s;
- E2E TypeScript — exit0, 4,32s;
- riktad E2E ESLint — exit0, 3,19s;
- Playwright `--grep TASK080` — exit0, 1 test passerade på 16,8s mot isolerad
  PostgreSQL17/PostGIS `otid_077_test` på loopback55449. Fallet verifierade
  tabellheaders, entydig/ingen/multipel bricka, PUNCH, FIXED utan tid, FIXED
  med tävlingstidszon och 390 px utan horisontell sidscroll;
- web build — exit0, 6,9s. Next kompilerade på 1,464s, TypeScript på 2,3s,
  genererade 7/7 statiska sidor på 55ms och checkin-skalets hash var
  `e53e8e7fbe18` med 3 publika assets;
- A3:s avslutande befintliga desktopfall
  `TASK029 samma login och verkligt klassbyte 1366` — exit0, 1 test passerade
  på 21,1s. Samma login genomförde klass/start, starttidsrättning, brickbyte,
  namn/klubb och historik med begriplig återkoppling;
- den isolerade PostgreSQL17-instansen stoppades kontrollerat, exit0;
  syntetisk testdata bevarades.

Ingen full workspace-, kontrakts- eller serverregression kördes eftersom
TASK080 inte ändrade serverbeteende och A3-grinden valde ett uttryckligt
befintligt användarflöde. Inga testfel inträffade.

Etapp A är därmed klar enligt planens acceptans: aktuell demo, tydlig
`/manage`-ingång, informationsrik roster och samma administratörsinloggning för
klass/start, bricka och namn/klubb. Det betyder inte att O-Tid eller
MeOS-likvärdigheten är klar.

Kvarvarande antaganden: tidsfältet visar serverns rosterbild, inte live-
startbevakning; `Ingen aktiv bricka` utesluter inte historiska/inaktiva
assignments. 390 px är desktopbrowseremulering. Fysisk mobil, skärmläsare,
handskar/regn/glare, produktion och riktig SPORTident är inte verifierade.

Nästa minsta vertikala uppgift är B1:s första snitt: skapa en enkel bana med
ordnad kontrollföljd och en klass kopplad till den utan XML. Eftersom detta
inför en ny beständig skrivväg ska ADR och task låsa versions-, idempotens- och
historiksemantik före implementation. Ingen banritare, karta, GPS, stafett eller
USB ingår.

## 2026-09-19: TASK081 manuell bana och klass slutförd

ADR-0103 och TASK081 skrevs före produktkod. Den gemensamma `/manage`-vyn har
nu ett initialt stängt `Förbered bana och klass`-flöde med bannamn, klassnamn,
explicit fri/minutstart och kontrollföljd. Granskning skriver inget. Bekräftelse
skapar atomiskt en manuell bana, immutable version 1, ordnade kontroller och en
länkad klass. Samma kontrollkod kan förekomma flera gånger och bevaras i ordning.

Request-id, idempotency-key, aktör, race och hela normaliserade intentet binds i
en immutable journal. Exakt retry kontrolleras före aktuell snapshot och
returnerar samma skapade id:n. Ändrad aktör/intent och stale snapshot ger
konflikt utan delwrite. En giltig commit höjer snapshot exakt ett steg; inga
entries, starttider eller resultat skapas. Manuell extern identitet är null och
IOF-importens egna identiteter fortsätter separat.

Migration0051 registrerades i Drizzles journal och lägger additivt till
relationsbevis för journalen samt den tidigare saknade update/delete-triggern
på `course_control`. Rollback är att inaktivera writer/UI och rätta framåt eller
återställa verifierad full backup, inte att droppa historik.

GPT-5.6 Terra byggde databas-/kontrakts-/service-/routegränsen. GPT-5.6 Luna
byggde den svenska tvåstegspanelen och mobilfallet. Huvudagentens granskning
skärpte svarkontraktet, separerade bekräftad commit från misslyckad efterläsning
och ändrade browseracceptansen från syntetiskt lyckosvar till riktig
HTTP/PostgreSQL-commit följd av tappat svar och exact retry.

Slutliga riktade kontroller med `CI=true`:

- contracts lint — exit0, real 13,72s;
- contracts typecheck — exit0, real 7,87s;
- contracts TASK081 — exit0, 1 fil och 2/2 tester passerade, Vitest 1,79s,
  real 3,14s;
- database lint — exit0, real 11,60s;
- database typecheck — exit0, real 8,70s;
- application lint — exit0, real 21,66s;
- application typecheck — exit0, real 17,80s;
- web lint — exit0, real 22,26s;
- web typecheck — exit0, real 20,38s;
- riktad route-handlersvit — exit0, 1 fil och 25/25 tester passerade,
  Vitest 5,75s, real 7,64s;
- E2E TypeScript — exit0, real 16,53s;
- riktad E2E ESLint — exit0, real 12,96s;
- TASK081 PostgreSQL-integration — exit0, 1 fil och 3/3 tester passerade,
  testtid 427ms, Vitest 1,06s, real 1,47s;
- Playwright `--grep TASK081` — slutlig exit0, 1/1 test passerade på 6,2s,
  real 6,65s. Fallet använde riktig Next/HTTP och den isolerade databasen,
  tappade första svaret efter servercommit och bevisade en enda bana/klass,
  version 1, `31 → 31 → 32`, en journalrad, uppdaterat klassantal och 390 px
  utan horisontell sidoscroll;
- web build — exit0, real 24,59s. Checkin-skal `053229325b0e` med 3 assets;
  Next kompilerade på 9,5s, TypeScript på 8,5s och genererade 7/7 statiska
  sidor på 55ms. Den nya dynamiska course-classes-routen ingick.

Två mellanliggande kontrollkörningar var röda och rättades före slutgaten:
application lint fann två osäkra teståtkomster; explicit querytypning löste dem.
Första browserkörningen fann att testet saknade explicit väntan på login; ingen
produktmutation hade skett. Testet bands därefter till loginens 200-kvittens och
den slutliga verkliga retrykörningen passerade. Inga slutliga fel återstår.

Ingen full workspace-, full integrations- eller full browserregression kördes.
Detta följer planens proportionella testgräns: TASK081 har egna kontrakts-,
route-, transaktions-, migrations- och browserbevis och ändrar inte
resultatmotor, rawdata eller hårdvara. Den tillfälliga PostgreSQL17/PostGIS-
instansen på loopback55481 stoppades kontrollerat; dess syntetiska testdata
bevaras under `/private/tmp/otid-task081-pg.OEGzTW`.

Kvarvarande antaganden: fysisk mobil, skärmläsare, handskar/regn/glare,
produktionsmigration och backup/restore är inte verifierade. IOF-samexistens är
provat med repositoryfixture, inte alla verkliga filer. Lika namn är avsiktligt
tillåtna och interna UUID:n är identitet. FIXED skapar inga starttider.

B1 är inte klart. Nästa minsta vertikala uppgift är att skapa en ny immutable
banversion för en befintlig bana och länka om en befintlig klass först efter en
skrivfri påverkansgranskning av entries och resultat. Den ska få en egen kort
ADR/task före kod och får inte mutera äldre banversion eller resultat.

## 2026-09-19: TASK092 neutralisering av kontrollförekomst slutförd

ADR-0110 och TASK092 skrevs före implementation. Den första implementationen
har en additiv migration0057 med immutable `class_control_neutralization`,
en signerad snapshotprojektion, ren resultatmotor och skyddad `MANAGE_RACE`
preview/commit-väg. Regeln pekar på exakt `course_control`-id, sequence och
kontrollkod, så en upprepad kod inte neutraliserar någon annan förekomst.

Commit kräver canonical basis-hash, aktuell snapshot och exakt
`class-control-neutralization:<request-id>` som idempotensnyckel. Den skapar
ingen resultatrevision eller omräkning; den höjer endast snapshotversionen.
En senare teknisk bedömning binder den beslutade regelns id i den nya
revisionen. Äldre revisioner och råstämplingar lämnas orörda. IOF Snapshot-
exporten verifierar nu denna provenans, filtrerar exakt den neutraliserade
förekomsten och mappar om bara senare lika kontrollers XML-förekomstnummer.
Resultatfinalisering failar fortfarande stängt på neutraliserade revisioner
i väntan på sin motsvarande frysta projektion.

Den svenska tvåstegsvyn ligger som ett initialt stängt avsnitt i den
gemensamma tävlingsadministrationen. Operatören väljer alltid `#förekomst ·
kod`, läser varningen om att äldre resultat inte räknas om och bekräftar sedan
samma idempotenta begäran. Det riktade 390 px-browserprovet genomför både
valet och en retry med identisk body efter ett simulerat tappat svar.

Riktade kontroller: domain-/contracts-/database-/application-/station-
typecheck är gröna. Domainsviten passerar 258 tester; contractssviten 332.
Migration0057 och TASK092:s PostgreSQL-integrationsprov (2/2), inklusive en
syntetisk neutraliserad IOF Snapshot-export med upprepad kod samt
finaliseringsblockeraren `INVALID_RESULT_REVISION`, är gröna mot isolerad
loopbackdatabas. E2E TypeScript och ESLint passerar; 390 px-browserprovet
passerar med verklig server/isolera PostgreSQL och exakt retry.

Kvarvarande antaganden: finaliseringsvägen är medvetet fail-closed för en
neutraliserad revision; en framtida fryst Complete-projektion behöver egen ADR.
Fysisk mobil, skärmläsare, produktion, verklig SI-hårdvara och bred regression
är inte verifierade. Ingen avkortad bana, tidsrättning, GPS, karta/rutt,
stafett eller riktig USB infördes.

Nästa minsta B4-uppgift: välj en enda operativ regel som inte redan finns,
exempelvis tidsrättning för en tydligt avgränsad start eller mål, och skriv ADR
innan kod. Den får inte kombinera avkortad bana, bulkredigering eller GPS.

## 2026-09-19: TASK093 måltidsrättning är dokumenterad före kod

ADR-0111 och `TASK_093_MANUAL_FINISH_TIME_CORRECTION.md` låser snittet till
en explicit korrigering av en redan observerad måltid för en Entry med en
aktuell direkt teknisk källa. Källans rawdata, readout, tidigare revision och
frysta XML ändras aldrig; en ny revision ska få full beslutskedja. Saknade
målstämplingar, fria manuella tider, bulk, avkortad bana och tidsrättning av
start ligger uttryckligen utanför.

Kontrakten, revisionsorsaken `MANUAL_FINISH_TIME_CORRECTION`, migration0058
och den immutabla journaltabellen är nu implementerade. Riktade contractsprov
(40 tester i två filer) samt contracts/domain lint/typecheck och databasens
tre schematester med lint/typecheck passerar. Migration0058 har dessutom
applicerats av en riktad applikationssvit mot isolerad loopback-PostgreSQL;
TASK093:s shared state-loader batchläser nu journal + källrevision och
validerar den vid public result, Snapshot-IOF, finalisering, speaker, admin
och mål. Den nya entry-låsta application-skrivaren skapar journal och
resultatrevision atomiskt; ett riktat PostgreSQL-fall bekräftar append-only
källrevision, exakt retry och unchanged CardReadout. Migration0059 är en
separat roll-forward-komplettering av den äldre provenance-constrainten; den
försvagar inga tidigare källvarianter. Den privata resultathistoriken använder
nu format V11 och visar endast den granskningsbara rättningskedjan; journal och
källrevision laddas explicit och saknad/motsägande proveniens avvisas. Ingen
serverroute eller UI är exponerad förrän 390 px-flödet är klart. TASK093 är
påbörjad, inte klar.

## 2026-09-19: TASK093 korrigering av observerad måltid slutförd

ADR-0111 är nu accepterad och den avgränsade funktionen är tillgänglig i den
gemensamma `MANAGE_RACE`-administrationen. En ny GET/POST-route är strikt
race-/entry-scopad och delar samma sessions-, CSRF-, no-store- och
idempotensgräns som övriga adminändringar. Kandidaten måste visa exakt aktuell
direkt teknisk OK/MP-källa. Commit kräver dess versioner, hash, revision,
readout och tidigare måltid, samt exakt
`manual-finish-time-correction:<request-id>`.

Den svenska 390 px-panelen är initialt stängd. Den visar bevarad start, mål,
löptid och senaste matchade split, kräver ett nytt datum/klockslag med explicit
UTC-offset och en separat bekräftelse, och visar den beräknade nya löptiden
före commit. Efter osäkert svar behålls exakt samma request i minnet för retry.
Råmeddelande, CardReadout, källrevision, snapshot, stationpaket och äldre
Complete-XML muteras inte. Ny revision, journal och den privata V11-historiken
är fortsatt den enda spårbara beslutskedjan.

Slutlig riktad verifiering med `CI=true`:

- contracts lint/typecheck: exit 0; `manual-finish-time-correction` och
  `readout-result-history-admin`: 18/18 tester;
- database lint/typecheck: exit 0; migration0058–0059 applicerades additivt
  på isolerad PostgreSQL17 på loopback55484;
- application lint/typecheck: exit 0; proveniensprov 1/1 och
  PostgreSQL-integrationsprov TASK093 1/1;
- web lint/typecheck: exit 0; central route-handler-svit 31/31;
- E2E TypeScript och riktad E2E ESLint: exit 0;
- Playwright `--grep TASK093`: exit 0, 1/1 på 6,7 s mot riktig Next/HTTP och
  samma isolerade PostgreSQL, inklusive första tappade commitsvar, byteidentisk
  retry, ny revision och rådatajämförelse på 390 px;
- web production build: exit 0; Next kompilerade på 2,3 s, TypeScript på 2,3 s
  och genererade 7/7 statiska sidor på 47 ms. Checkin-skalets hash var
  `ff94380f5442`.

Ingen full workspace-, full integrations- eller full browserregression kördes.
Fysisk mobil, skärmläsare, produktion, verklig SPORTident/USB, incidentell
återtagning av en redan godkänd måltidsrättning och breda resultatfall är inte
verifierade. Ingen GPS, karta/rutt, stafett, bulkeditor eller riktig USB
infördes.

Nästa minsta vertikala B4-uppgift är en avgränsad återtagandeväg för en felaktig
manuell måltidsrättning, med eget ADR- och taskdokument före kod. Den får inte
införa generell resultateditor, bulkändring, split-/kontrollrättning eller
automatisk omräkning.

## Nästa pågående snitt: TASK094 återtagande av manuell måltidsrättning

ADR-0112 och `TASK_094_MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL.md` är skrivna
före produktionskod. Snittet får bara återställa den exakta, omedelbart
föregående direkta tekniska revisionen när TASK093-rättningen fortfarande är
entryns absoluta huvud. Det blir en ny immutable journal och revision, aldrig
en deletion eller generell resultateditor.

TASK094 är genomförd: kontrakt, domänorsak, additiv migration0060,
strict proveniens, låst `MANAGE_RACE`-writer, läsprojektioner/historikformat12,
privat GET/POST-route och kompakt svensk UI finns. Riktade lint/typecheck och
kontrakts-/proveniens-/PostgreSQL-prov passerar. Browseracceptansen på 390 px
med tappat första commitsvar passerar med exakt retry, ny restaureringsrevision
och oförändrad rawdata. Inga GPS-/kart-/stafett-/USB-funktioner har berörts.

Slutlig riktad verifiering: contracts/database/application/web lint/typecheck
exit0; kontraktsprov 1/1; proveniensprov 2/2; isolerat PostgreSQL-prov TASK094
1/1; route-handler-svit 31/31; E2E TypeScript/ESLint exit0; Playwright TASK094
1/1 på 7,0 s; web production build exit0 (checkin-skal `3f8a67fdf614`, 7/7
statiska sidor på 50 ms). Ingen full workspace- eller bred browserregression
kördes. Fysisk hårdvara, produktion och skärmläsare är inte verifierade.

## Nästa pågående snitt: TASK095 läsmarkering av måltidsrättning

`TASK_095_ROSTER_FINISH_TIME_CORRECTION_MARKER.md` avgränsar en enda
skrivskyddad deltagarlistemarkör efter TASK094. Den använder befintlig strikt
resultatresolver och privat `MANAGE_RACE`-läsunderlag. Ingen databasfråga,
behörighet, action eller ny domänregel tillkommer; ett ADR behövs därför inte.

TASK095 är genomförd: det befintliga privata deltagarunderlaget innehåller nu
en nullable, validerad markör för exakt den aktuella TASK093-rättningen eller
TASK094-återställningen. Deltagarlistan visar korta svenska badges, men ingen
journalidentitet eller annan intern proveniens. Vanlig teknisk eller annan
gällande revision får ingen markör. Ingen resultatskrivning, migration,
endpoint, GPS, karta/rutt, stafett eller USB-funktion har lagts till.

Slutlig riktad verifiering: contracts/application/web lint och typecheck
exit0; kontraktsprov `entry-transfer` 3/3; isolerat PostgreSQL-prov för
TASK094/TASK095 1/1; E2E TypeScript och ESLint exit0; Playwright TASK095 1/1
på 7,2 s vid 390 px; web production build exit0 (checkin-skal
`54ab19c3278a`, 7/7 statiska sidor på 58 ms). Ingen full workspace-, bred
integrations- eller full browserregression kördes.

## Nästa pågående snitt: TASK096 måltidsmarkering i resultatsammanfattning

`TASK_096_SELECTED_RESULT_FINISH_TIME_MARKER.md` begränsar nästa steg till
en läsbar detaljtext för den redan valda deltagaren. Den återanvänder enbart
TASK095:s laddade rosterunderlag och den befintliga resultatsammanfattningen;
ingen ny query, endpoint, kontrakt, behörighet, action eller ADR behövs.

TASK096 är genomförd: den privata resultatsammanfattningen visar nu
`Måltidsrättning: Måltid rättad` respektive `Måltidsrättning:
Måltidsrättning återtagen` när den valda rosterposten har en aktiv,
strikt validerad TASK095-markör. Ingen rad visas för omarkerat eller
icke-aktivt resultat. Ingen serveryta, resultatskrivning, migration, GPS,
karta/rutt, stafett eller USB har lagts till.

Slutlig riktad verifiering: web lint/typecheck exit0; E2E TypeScript/ESLint
exit0; Playwright TASK096 1/1 på 9,5 s vid 390 px med verklig privat
resultatsammanfattning; web production build exit0 (checkin-skal
`54ab19c3278a`, 7/7 statiska sidor på 52 ms). Ingen full workspace-, bred
integrations- eller full browserregression kördes.

Nästa minsta vertikala uppgift ska återgå till resultatmotorn: en separat,
ADR-avgränsad operativ regel med verkligt tävlingsvärde, inte ytterligare
duplikatpresentation av denna måltidskedja.

## TASK097: avkortningsgräns i resultatbärande banrättning

TASK097 är genomförd. ADR-0113 och
`TASK_097_SHORTENED_COURSE_BOUNDARY.md` skrevs före kod och skiljer en
framtida avkortad-bana-funktion från TASK084:s vanliga banrättning. En strikt,
icke-tom prefixförkortning av aktuell kontrollföljd avvisas nu både i den
svenska adminvyn och i serverns transaktionsskrivare när klassen har
resultathistorik. Avvisningen skapar ingen CourseVersion, requestjournal,
snapshot eller resultatrevision; icke-prefixmässiga TASK084-rättningar är
oförändrade.

Riktad verifiering: applicationens isolerade PostgreSQL-test för
TASK084/TASK097 passerade 3/3; web lint/typecheck passerade; prefix-enhetstest
passerade 1/1; E2E TypeScript/ESLint passerade; Playwright TASK097 passerade
1/1 vid 390 px och verifierade både svensk förklaring och noll
skrivbegäranden. Web production build passerade med checkin-skal
`54ab19c3278a` och 7/7 statiska sidor på 58 ms. Ingen bred
workspace-regression, fysisk SPORTidentavläsning eller produktionsdatabas kördes.

Nästa minsta produktuppgift är inte att utöka den vanliga banrättningen: om
avkortad bana prioriteras ska ett eget, ADR-avgränsat snitt definiera
banvariant per deltagare/resultat, ranking mellan hel och kort variant samt
export-/finaliseringspolicy innan kod skrivs.

## Nästa pågående snitt: TASK098 Testeventoranmälningar

ADR-0114 och `TASK_098_TESTEVENTOR_ENTRY_IMPORT.md` är skrivna före kod.
Detta snitt hämtar bara Testeventors individuella klass-/anmälningsunderlag
till redan förberedda interna klasser. En anslutningsägare ger en specifik
race-bunden `IMPORT_IOF`-credential en återkallelig grant; den som importerar
får aldrig se eller vidareanvända Eventor-nyckeln. Varje källklass måste
mappas uttryckligt och en-till-en — klassnamn matchas aldrig automatiskt.

Första commit får endast skapa nya eventoridentifierade entries. Den får inte
uppdatera, radera eller DNS-markera befintliga entries, eller ändra bricka,
starttid, bana, resultat, publicering, GPS, karta/rutt, stafett eller USB.
Utvecklingen börjar med en strikt Testeventoradapter och syntetiska fixtures;
ingen riktig Eventor-/Testeventornyckel används i kod, test eller browser.

Första byggblocket är genomfört: `packages/eventor` har nu den rena,
databasfria `parseEventorEntryImport` för just individuella Eventorentries
och explicita EventClassId:n. Den avvisar team, flerklass-entry, borttagna
klasser, namespaces, dubbletter och klasser som saknas i samma källunderlag.
Den smala transporten läser dessutom endast de två fasta Testeventor-resurserna,
validerar båda svar och ger separata SHA-256-hashar för deras kompletta bytes;
den använder ingen riktig nyckel eller nättrafik i verifieringen. Eventor-
paketets lint/typecheck passerar och riktat `vitest` passerar 1 fil/16 tester.
Grant, journal, write, HTTP och browserflöde återstår; ingen import eller riktig
Eventortrafik har skett.

Nästa serverbyggblock är påbörjat: migration0061 har append-only
`eventor_race_import_grant`, spärr och `eventor_entry_import_request`. En grant
kan enbart bindas till den exakta tidigare `eventor_import_request`-provenansen,
dess lopp och en befintlig racebunden `IMPORT_IOF`-credential; den innehåller
ingen ny hemlighet eller API-nyckel. Betrodd issue/revoke-CLI och application-
funktioner finns. Application/database lint och typecheck, CLI-TypeScript och
CLI-ESLint passerar. Ett nytt isolerat PostgreSQL-försök stoppades före samtliga
testfall eftersom den lokala PostgreSQL-installationen saknar PostGIS som
basmigrationen kräver; instansen stoppades igen och ingen extern eller befintlig
databas användes. Preview/commit, databasacceptans och browserflöde återstår.

TASK098:s kontraktsblock är också klart: en aggregat-only preview kan bära
källklassnamn, antal, interna klasskandidater och båda hashvärdena men aldrig
deltagarnamn, klubb, EntryId eller rå XML. Commit kräver unik explicit
ett-till-ett-mappning, båda hashvärdena och ett isolerat retry-id. Contracts
lint/typecheck passerar och riktade Eventor-kontraktsprov passerar 2 filer/8
tester.

Previewn har sedan byggts i applikationslagret: den kräver en racebunden
`IMPORT_IOF`-session och den specifika granten, kontrollerar recipient,
provenans, anslutning och ägarspärr före och efter fetch och svarar med just
det kontraktsbundna, personfria underlaget. Application/contracts lint och
typecheck passerar och det nya kontraktsprovet passerar 3/3. HTTP-route,
PostgreSQL-acceptans och atomisk entry-commit återstår.

Den skyddade previewrouten finns nu på
`/api/admin/races/{raceId}/eventor-entry-import/preview`. Den återanvänder
importsessionens Origin-/CSRF-skydd, begränsad JSON-läsning och privata
`no-store`-headers. Web lint/typecheck och routeprov passerar 2/2. Ingen
browserpanel eller skrivande commitroute finns ännu.

Commitgrunden har en canonical mapping-hash: mappningar sorteras på
`externalClassId` och SHA-256 beräknas över canonical UTF-8-JSON. Enbart
browserordning kan därför aldrig skapa ett nytt intent. Application lint och
typecheck samt riktat intentprov passerar 1/1. Atomisk writer återstår.

Journalen har nu en databasunik intent-hash per lopp, som binder grant, aktör,
båda källhashar och canonical mapping men inte request-id. Det gör att den
kommande writern kan avvisa omedveten dubbelcommit med nytt request-id utan att
förväxla den med exakt retry. Database/application lint och typecheck samt
intentprov passerar 1/1.

TASK098:s atomiska commit är nu implementerad. Den läser om båda Testeventor-
källorna utanför transaktionen, jämför de previewade hashvärdena och
omvaliderar sedan grant, provenans, anslutning och race under lås. Bara saknade
`eventor`-entries skapas; ändrade importerbara fält, felaktig mapping,
dubblettintent eller brist på klassplats rullar tillbaka hela writern. Receipt,
audit och högst ett snapshotsteg sparas tillsammans. Exakt retry återspelar
den immutable receipt utan nätläsning efter senare grantspärr, men ny write
kräver fortsatt giltig grant. En skyddad commitroute finns på
`/api/admin/races/{raceId}/eventor-entry-import`; den kräver Origin, CSRF,
importsession och `eventor-entry-import:<uuid>` före bodyläsning samt ger bara
en privat validerad receipt.

Importsidan innehåller nu en liten svensk panel för grant-UUID, personfri
preview och komplett unik klassmappning. Den skapar ett enda
`eventor-entry-import:<uuid>`-försök och behåller samma id vid osäkert
nätfel. Riktad statisk och enhetlig verifiering efter commit: eventor,
contracts, database, application och web lint/typecheck exit 0; adapter 16/16,
Eventor-kontrakt 8/8, intent 2/2 och panel-/preview-/commit-route 7/7.
Webbens produktionsbygge passerar med checkin-skal `6d26a06d4199` och 7/7
statiska sidor på 53 ms. Det finns ännu ingen PostGIS-baserad
integrationskörning eller browser-E2E. Det skrivna TASK098-PostgreSQL-provet
kan inte köras lokalt eftersom basmigrationen kräver PostGIS, som den nya tomma
lokala instansen saknar. Ingen riktig Eventor- eller Testeventortrafik har
utförts.

## Nästa pågående snitt: TASK099 operativ backup och återställning

ADR-0115, `TASK_099_OPERATIONAL_BACKUP_RESTORE.md` och
`docs/backup-restore-operations.md` är skrivna före kod. Snittet låser en
samordnad helhetsbackup under dokumenterat skrivstopp: full PostgreSQL/PostGIS-
dump plus de exakta versionsbundna PM-objekt som databasen refererar till.
Restore får endast ske i en ny tom separat miljö och måste verifiera hash,
migration, tävlingshistorik och PM-objekt utan nya revisionsskrivningar.
Credentials, hemligheter och Androids lokala kö inkluderas aldrig. PITR, HA,
generellt tävlingsarkiv, GPS, karta/rutt, stafett och SPORTident ligger utanför.

TASK099:s första kodblock är klart: contracts-paketet har ett strikt,
canonicaliserbart och hemlighetsfritt backupmanifest. Det binder backup-id/tid,
uttrycklig skrivstoppbekräftelse, dump-hash/längd, migrationsidentitet och
exakta PM-objektversioner. PM-delen återanvänder samma strikta
`pmObjectManifestSchema` som objektlagringen, och dubbletter eller extra
hemliga fält avvisas. Contracts lint/typecheck passerar; riktat manifestprov
passerar 2/2. Ingen databasdump, MinIO-kopia eller restore har körts.

TASK099:s andra kodblock är en liten infrastrukturport för exakt läsning av
ett manifestbundet PM-objekt. Den för vidare `storeId`, nyckel och version till
befintlig objektlagring och kontrollerar åter byteslängd och SHA-256;
minsta avvikelse avvisas fail-closed. Infrastructure lint/typecheck passerar;
riktat portprov passerar 3/3. Ingen objektkopia, databasdump eller restore har
körts.

TASK099 har också en ren deterministisk backupplan. PM-referenser sorteras på
store, nyckel och version före strict validering, canonical JSON och SHA-256,
så samma underlag i annan frågeordning får identiska bytes och hash.
Infrastructure lint/typecheck passerar; de två riktade backupmodulproven
passerar 6/6. Nästa steg är en läsande databasport, inte en dump eller restore.

TASK099:s läsande applicationmodell är också klar. Den projicerar strikt och
stabilt sorterat `pm_object_manifest` till backupreferenser och härleder
migrationsidentitet från den senast faktiskt tillämpade Drizzle-raden, inte
från repositoryts migrationsfiler. Tom/ogiltig journal samt felaktiga eller
dubbla PM-rader avvisas. Application lint/typecheck passerar; riktat
läsmodellprov passerar 3/3. Ingen databas skrivs och ingen dump/anslutning till
objektlagring har körts.

### TASK099: versions-ID-spärr för MinIO-restore (2026-09-19)

Officiell MinIO-dokumentation bekräftar att versions-ID tilldelas av servern
vid skrivning och att `mc mirror` inte återställer versionsattribut. Därför
kan en vanlig S3/MinIO-kopia till ny målmiljö inte återställa O-Tids
`pm_object_manifest`: databasen refererar originalets `versionId`, medan
målmiljön skapar nya. ADR-0115, TASK099 och driftsdokumentet har rättats före
någon objektskrivare. TASK099:s nuvarande kod kan verifiera den exakta
källversionen och bygga manifest, men är uttryckligen ingen objekt-copy eller
helrestore. Nästa tekniska förutsättning är TASK133:s isolerade prov mot den
exakt pinnade OSS-releasen; först därefter kan ett dokumenterat
versions-ID-bevarande MinIO-återställningssätt ens övervägas med den vanliga
PM-läsaren. Källsammanfattning:
`docs/research/minio-version-restore-2026-09-19.md`. Ingen O-Tid- eller
MinIO-miljö har kontaktats.

En riktad skrivskyddad genomgång av befintlig `docker-compose.yml`, MinIO-port
och driftsdokument bekräftar att arbetskopian bara har en ensam MinIO-instans
och bucket-initiering. Ingen repo-stödd restore som bevarar serverns
version-ID:n finns. TASK099 stoppas därför före objektskrivning och får inte
beskrivas som komplett återställning; minsta fortsättning är ADR-0138/TASK133:
pröva den dokumenterade replikeringskandidaten på syntetiskt, isolerat
underlag med den vanliga PM-läsaren utan att välja den som driftmekanism.

## 2026-09-19: TASK100 synligt uppdateringsläge i publikresultat

Den befintliga femsekunderspollingen i publikresultaten har nu en kort,
textlig `aria-live`-status i både tom och fylld lista. Efter ett lyckat
runtimevaliderat poll-svar visar den klientens lokala bekräftelsetid; initial
SSR innehåller ingen klocka och ger därför ingen hydratiseringsskillnad. Vid
fel behålls senast verifierade publika rader och befintlig varning. Statusen
skrivs inte ut. Ingen serverfråga, cache, kontrakt, databas, resultatregel,
identifierare eller pollingintervall ändrades.

Verifiering: riktat komponentprov exit 0, 1 fil / 9 tester; web lint och
typecheck exit 0; produktionsbuild exit 0 med checkin-skal `ce19fda93e4e`,
3 publika assets och 7/7 statiska sidor. Ingen fysisk mobil, skärmläsare eller
verkligt browsernätfel är provat. Se
`TASK_100_PUBLIC_RESULT_REFRESH_STATUS.md`.

## 2026-09-19: TASK098 PostgreSQL/PostGIS-acceptans

Den tidigare lokala PostgreSQL-spärren löstes utan att använda en befintlig
databas: PostgreSQL17 och PostGIS fanns redan lokalt och en ny syntetisk
loopbackinstans startades på port 55438. Basmigrationen inklusive PostGIS
lyckades, och `CI=true pnpm --filter @o-tid/application exec vitest run
test/integration/task-006v.test.ts -t TASK098` gav exit 0, 2 passerade och 6
avsiktligt bortvalda testfall i samma fil. Instansen stoppades efter körningen
och dess privata temporära katalog bevarades. Ingen riktig Eventor- eller
Testeventortrafik, API-nyckel, demo- eller tävlingsdatabas användes.

TASK098:s server-/transaktionsdel är därmed integrerad mot verklig PostgreSQL/
PostGIS för sina två namngivna grant- och entryimportfall. Browser-E2E för den
nya panelen är fortfarande inte kört, så hela acceptanspunkten för browser
påstås inte klar. Se `TASK_098_TESTEVENTOR_ENTRY_IMPORT.md`.

## 2026-09-19: TASK098 browseracceptans

Den sista browseracceptansen för TASK098 är körd på en ny, isolerad
PostgreSQL17/PostGIS-instans på loopback 55439. Typecheck och riktad ESLint
för `tests/e2e/task-006v.spec.ts` gav exit 0. `CI=true pnpm exec playwright
test tests/e2e/task-006v.spec.ts --grep TASK098` gav exit 0: 1 passerat fall.
Fallet använder riktig lokal Next-server, importinloggning och PostgreSQL, men
interceptar enbart de två entryimport-POST:arna för att injicera strikt
syntetiskt Testeventorunderlag. Det provar personfri förhandsvisning, D21-
mappning, tappat commitsvar och retry med samma idempotency-nyckel samt exakt
en skapad entry. Den temporära databasen stoppas efter körningen. Ingen riktig
Eventor/Testeventortrafik, API-nyckel, demo- eller tävlingsdatabas har använts.

TASK098:s riktade server- och browseracceptans är därmed verifierad; fortsatt
verifiering med en verklig separat Testeventor-miljö kräver uttryckligt privat
underlag och görs inte automatiskt.

## 2026-09-19: TASK101 produktionsprofil för Eventor dokumenterad före kod

ADR-0116 och `TASK_101_PRODUCTION_EVENTOR_READ_PROFILE.md` avgränsar nästa
C1-snitt till en explicit `production-se`-profil vid samma adaptergräns som
Testeventor. Den är fast bunden till Eventor Sveriges officiella API-origin,
den krypterade ApiKey-envelope och immutable importprovenans. Profilen får
återanvända enbart befintlig metadata- och explicit individuella Entry-import;
ingen Eventor-skrivning, bred synk, browsernyckel eller fri URL tillkommer.

Ingen produktkod eller verklig Eventor-request har körts i dokumentsteget.
Källkontroll med officiell metodlista, API-guide och schema sparas i
`docs/research/eventor-production-read-profile-2026-09-19.md`. Nästa steg är
den additiva schema-/adapterändringen med enbart syntetiska svar.

## 2026-09-20: TASK101 produktionprofil för read-only Eventor

TASK101 är implementerad enligt ADR-0116. En Eventoranslutning och dess
immutable importprovenans har nu exakt en av två slutna profiler:
`testeventor-se` eller `production-se`. Adapterorigin är fast i kod till
respektive svensk Testeventor- eller produktionsorigin; browser och CLI kan
inte skicka en URL. Profilen följer med i ApiKey-envelope:s AAD, advisory-lås,
unik extern importidentitet, receipt och audit. Samma externa event-id kan
därför vara separat provenans i test och produktion, medan en profilväxlad
envelope inte kan öppnas. Befintliga grants, idempotens, strikta
individparsern och read-only-gränsen är oförändrade.

Den privata provisioning-CLI:n kräver nu en explicit
`--profile testeventor-se|production-se`, och adminvyn visar alltid den
lagrade profiletiketten. Nyckeln lämnar fortfarande aldrig stdin/servern.
Migration0062 utvidgar endast två befintliga check constraints och är
registrerad i Drizzle-journalen; den skriver inte om äldre data. Rollback är
att stänga provisioning/spärra anslutningen och rätta framåt eller återställa
verifierad backup, aldrig att radera immutable historik.

Verifiering med enbart syntetiskt underlag: Eventor-adapter 18/18,
Eventor-kontrakt 5/5 och ApiKey-envelope 34/34 passerar. Ett nytt isolerat
PostgreSQL17/PostGIS-fall med migration0062 passerar 1/1 (8 avsiktligt
filtrerade bort), inklusive samma externa id i båda profiler. Typecheck/lint
för berörda fem paket, CLI och E2E-filen passerar. Produktionsbygge för webben
passerar. Slutligen passerar 2/2 browserfall mot ny tom migrerad PostgreSQL17/
PostGIS och en lokal Next-server; ett av fallen visar `production-se` i admin-
vyn och använder ändå uteslutande lokalt injicerat XML-underlag.

Ingen verklig Eventor/Testeventor-request, API-nyckel, tävlings-/persondata,
Eventor-skrivning eller liveacceptans har utförts. En faktisk
produktionsanslutning måste fortsatt provisioneras av ägaren i separat privat
drift och provas mot deras uttryckliga operativa godkännande.

## 2026-09-20: TASK099 går vidare med läsande restore-preflight

Efter den dokumenterade MinIO-version-ID-spärren fortsätter TASK099 inte med
en vanlig objektkopia. Nästa smala kodsnitt är i stället en hemlighetsfri,
skrivskyddad preflight och restore-verifierare för ett redan framtaget manifest
och en uttryckligen separat målmiljö. Den ska faila stängt på dump-/migrations-
eller PM-bevisfel, icke-tomt mål eller saknat PostGIS och bara räkna/läsa den
minsta historikkedjan. ADR-0115 täcker beslutet. Ingen dump, objektwrite,
MinIO-kopia eller användardatabas får röras innan det separata
versions-ID-beslutet finns.

## 2026-09-20: TASK102 dokumenterad före implementation

Nästa operativa produktdel är inte en ny konto-/medlemsmodell utan ett smalt
webbflöde där en redan autentiserad `MANAGE_RACE`-administratör kan utfärda och
spärra de befintliga, kortlivade racebundna rollerna `MANAGE_RACE`,
`START_CHECKIN` och `FINISH_FOREST_WATCH`. ADR-0117 begränsar uttryckligen
hemligheten till utfärdandesvaret; listor innehåller bara metadata och ett
tappat svar får aldrig autoåterförsökas. Befintlig credential-/spärrhistorik
och audit återanvänds, men en ny auditpost ska ange verklig utfärdande
administratör. Ingen schemaändring, kontaktregister, Eventor, PM, GPS eller
hårdvara ingår. Se `TASK_102_WEB_OPERATOR_ACCESS.md`.

## 2026-09-20: TASK099 läsande PostgreSQL-restoreverifiering

TASK099 har nu en liten, skrivskyddad målmiljöverifierare i applicationlagret.
Den läser migrationsjournalen på dess faktiska Drizzle-plats
`drizzle.__drizzle_migrations` och använder en enda `REPEATABLE READ, READ
ONLY`-transaktion, så en pågående ingest eller restore inte kan blanda olika
ögonblick i samma beslut. Den validerar manifestets exakta
migrationsidentitet, PostGIS, hela den sorterade PM-referensuppsättningen och
en minimal bevarad tävlingskedja med event, lopp, deltagare, råmeddelande,
avläsning, resultatrevision, audit och fryst resultat. Inget skrivs och den
läser inte PM-bytes eller dumpfil.

Application lint/typecheck passerar. De två riktade rena proven passerar 5/5.
Ett isolerat PostgreSQL17/PostGIS-prov med enbart syntetiska data passerar
1/1 och visar både godkänd sammanhängande kedja och fail-closed vid ändrat
PM-`versionId`. Första försöket avslöjade att migrationsjournalen låg i
`drizzle` snarare än `public`; det rättades före den gröna körningen. Ingen
MinIO, dump/restore, Eventor, API-nyckel, demo eller tävlingsdatabas har
använts. Se `TASK_099_OPERATIONAL_BACKUP_RESTORE.md`.

## 2026-09-20: TASK102 webbutfärdad operativ åtkomst

TASK102 är klar enligt ADR-0117. En inloggad `MANAGE_RACE`-administratör kan
nu från tävlingsvyn utfärda, lista och spärra de befintliga kortlivade,
racebundna rollerna `MANAGE_RACE`, `START_CHECKIN` och
`FINISH_FOREST_WATCH`. Listan innehåller enbart roll, label, tider och
spärrstatus. Hemligheten finns endast i lyckat utfärdandesvar och visas i
browsern tills arrangören stänger den; den sparas inte i URL, localStorage
eller sessionStorage. Oklart svar ger ingen automatisk ny utfärdning utan
den säkra operativa instruktionen att lista, spärra och skapa ny kod.

Varje utfärdande och spärr får en separat auditpost med den faktiska
administratörens credential-id, utöver den befintliga credentialhistoriken.
Spärren återanvänder den befintliga transaktionella spärrmodellen och gör
även befintlig session obrukbar. Ingen migration, konto-/kontaktregister,
Eventor, PM, GPS, USB/hårdvara eller offlineutfärdande ingår.

Riktad contracts-, application- och webblint/typecheck samt webbens
produktionsbygge passerar, liksom
contractsprovet 1/1, applicationprovet mot isolerad PostgreSQL17 1/1 och
routeprovet 32/32. Browserns typkontroll och ESLint passerar. Ett browserfall
mot samma isolerade PostgreSQL17 och lokal Next-server passerar 1/1 på 8,9 s
och provar 390 px utan sidscroll, engångskod utan browserpersistens, lista,
spärr, omedelbart avvisad startinloggning och audit. Allt underlag är
syntetiskt; inga externa anrop eller riktiga tävlingsdata används. Se
`TASK_102_WEB_OPERATOR_ACCESS.md`.

## 2026-09-20: TASK103 avgränsad före implementation

Den vanliga privata startlistan kan redan filtreras och skrivas ut, medan
startpersonalens separata offlineavprickning saknar en papperskopia av exakt
det lokalt upplåsta underlaget. TASK103 begränsar därför nästa UI-snitt till
en print-only tabell från den befintliga `START_CHECKIN`-vaultens nuvarande
klassurval. Den är uttryckligen privat och planerad: pappersrutan är tom och
förs inte över till startmarkering, DNS, synk eller resultat. Ingen route,
migration, ny capability eller cacheändring tillkommer och målpersonalens
skogslista berörs inte. Se `TASK_103_CHECKIN_ROSTER_PRINT.md`.

## 2026-09-20: TASK103 pappersunderlag från startmobilen

TASK103 är klar som ett rent UI-/printsnitt inom den befintliga avpricknings-
mobilen. En upplåst `START_CHECKIN`-roster har nu en knapp för browserns
utskrift av det aktuella klassurvalet. Printmediet innehåller bara en privat
planeringslista med roster-/tidszonsgrund, namn, klubb, klass, planerad start,
brickvarning och tom pappersnotering. Den senare är uttryckligen inte en
synkad avprickning. Skrivläge, synk, inloggning och återhämtning skrivs inte
ut. Målpersonalens vy, offlinekö, cache, routes och all domän-/resultatlogik
är oförändrade.

Webblint/typecheck och det riktade rosterprovet 5/5 passerar.
`build:checkin`, browserns TypeScript/ESLint, det verkligt byggda shellprovet
3/3 (6,5 s) och webbens produktionsbygge passerar. Browserfallet använder
syntetiskt underlag, provar 390 px, klassfilter, fri/minutstart,
brickvarning, printmedia och att utskrift inte synkar. Fysisk skrivare,
flersidig pagination och fältanvändning är inte verifierade. Se
`TASK_103_CHECKIN_ROSTER_PRINT.md`.

## 2026-09-23: TASK150 arrangörskonto syntetiskt verifierat

TASK150:s första arrangörsflöde har riktat syntetiskt bevis: PostgreSQL-
integration 5/5, contracts 3/3, CLI 4/4, webbens konto-/routeenhetstester
10/10 och ett Playwright-fall 1/1. Browserfallet körde en riktig Next-server
och browser mot en egen migrerad lokal PostgreSQL-databas med syntetiska
konton; det täckte login, eventskapande, ”Mina tävlingar”, enter till befintlig
`/manage`, sparad bana/klass genom delegerad behörighet, ny session, mobilvy
och avslag för ett annat konto. Browser-
harnessen använder port 3150, separat `.next-organizer-test`, privat fixture
och en ny `otid_task150_e2e_...`-databas skapad från en explicit lokal syntetisk
`TEST_DATABASE_URL`. Login- och sessionstatussvaren innehåller konto-ID för att
klienten ska kunna hålla pending create knutet till samma konto.

Web, contracts, application, database och scripts lint/typecheck/build
kontroller passerade med exit 0 efter sista berörda ändringar. Browserharnessen
typkontrollerades och lintades med exit 0; slutligt Playwright-omtag passerade
1/1 med exit 0 efter sista UI-ändringen. Efteråt fanns ingen kvarvarande `otid_task150_e2e_...`-databas
eller lyssnare på port 3150. TASK150 är syntetiskt verifierad, inte
fältverifierad eller fältklar. Inga riktiga tävlings-/demodata, externa
credentials eller SPORTident-enheter användes. Exakta kommandon och krav på
isolerad databas finns i `TASK_150_ORGANIZER_ACCOUNT_EVENT_CREATION.md` och
`AGENTS.md`. Nästa minsta produktuppgift är A2: ägarstyrd delning och
återkallelse av en medadministratör; den ingår inte i TASK150. Om E2E- eller
integrationskörning avbryts oväntat inspekteras databaskatalogen och bara
verifierade körningsunika `otid_task150_e2e_<32 hex>`/`otid_task150_spec_<32
hex>`-databaser städas manuellt; ingen automatisk cleanup eller demo-/privat-
eller tävlingsdatabas berörs.

## 2026-09-23: TASK151 medadministration avgränsad före kod

ADR-0145 är accepterad och TASK151 specificerar nästa A2-snitt: OWNER ger ett
redan provisionerat konto ADMIN till exakt ett event, ser och återkallar
granten; aktiv ADMIN får samma befintliga kontobundna race-enter till
`MANAGE_RACE` men aldrig rätt att styra kontogrants eller andra event.
Återtilldelning efter revocation kräver ny grant-id, och en befintlig
delegerad session ska avvisas vid nästa skyddade request. Den nuvarande
grantunikheten måste ersättas i en ny migration med bibehållen ägarunikhet.
Ingen A2-kod, databas eller riktig tävling har ännu ändrats i detta steg.

## 2026-09-23: produktmålplanens delmål förtydligade

Den styrande produktmålplanens A1–E-etapper har nu en avprickningsbar effekt
per delmål. A2 betyder direkt tilldelning till ett redan provisionerat konto,
inte e-postinbjudan, självregistrering eller kontoåterställning. B1 kräver ett
eget beslut om deltagarkonto och verifierad koppling till anmälan; A1:s
arrangörsinloggning bevisar inte deltagarägarskap. MeOS-funktionsmatrisens två
kontorader speglar nu TASK150:s syntetiska verifiering och TASK151:s planerade
status. Ingen produktkod, migration, testdatabas eller extern tjänst berördes.

## 2026-09-23: TASK151 medadministration syntetiskt verifierad

OWNER kan i `/organizer` direkt ge ett redan provisionerat konto ADMIN för ett
uttryckligt event, se aktiv/återkallad historik och återkalla exakt grant.
Migration 0078 bevarar gamla OWNER-grants och ger en ny immutable requestjournal;
återtilldelning får ny grant-id. Aktiv ADMIN ser bara rätt event, öppnar dess
befintliga `/manage` och kan utföra en vanlig åtgärd där men inte styra
kontogrants. En äldre delegerad racesession nekas vid nästa skyddade läsning
och mutation efter revoke; en separat legacycredential påverkas inte.

Slutlig riktad verifiering: contracts 6/6, TASK150+151 PostgreSQL 6/6, web
18/18 och Playwright 2/2. Databas/contracts/application/web lint, typecheck
och build samt browserharnessens TypeScript/ESLint gav exit 0. Browserprovet
använde en ny migrerad syntetisk måldatabas, loopbackserver 3150 och 390 px-
viewport; ingen körningsunik databas fanns kvar efteråt och testinstansen
stoppades. Ett första browserförsök stoppades före tester av källnamnsgrinden;
slutkörningen med godkänd syntetisk källa passerade. Under en oavsiktlig bred
contracts-körning noterades ett annat fel i `test/entry-transfer.test.ts:31`;
det breda utfallet är inte förklarat av TASK151:s riktade gröna prover.

Detta är inte fysisk mobil-, fält-, HTTPS- eller SPORTident-acceptans. Inga
verkliga event, privata credentials, Eventor-anrop, GPS- eller stafettfunktioner
ingick. Nästa minsta produktuppgift är B1:s separata ADR/TASK för verifierad
deltagarkoppling och personligt resultat på en annan enhet.

## 2026-09-23: produktmålplanen uppdelad efter TASK151

`docs/product-goal-roadmap-2026-09-23.md` har nu en avprickningsbar arbetskö:
A1/A2 är syntetiskt verifierad grund, B1 börjar med beslut om verifierad och
återkallelig koppling till exakt anmälan, följt av eget resultat på annan enhet;
därefter följer kontosynkade favoriter, egen privat rutt och separat GPS-klient.
Fysisk SPORTident, körbar backup/restore och pilot är en oberoende fältgrind;
fler tävlingsformer får varsin senare leverans. Ingen produktkod, migration,
testdatabas, verklig tävling eller extern tjänst ändrades i denna planuppdatering.

## 2026-09-23: TASK152 B1 syntetiskt verifierad och målplanen uppdaterad

ADR-0146 skrevs före TASK152:s kod. En aktiv `MANAGE_RACE`-operatör utfärdar
en privat engångskod för exakt vald anmälan efter en uttrycklig attest om
kontroll utanför systemet. Endast SHA-256 av koden lagras. Redan provisionerat
konto löser in koden under befintlig kontosession; issue, redeem och revoke
har immutable journaler i additiv migration 0079. ”Mitt resultat” visar endast
den befintliga publika V7-projektionen eller vänteläge, aldrig råavläsning,
opublicerad revision, intern entry-id eller privat rutt. Publik resultatsida
förblir kontofri. Felkoppling kräver spärr/ny kod, inte tyst överföring.

Riktad slutverifiering: databasschema 3/3, kontrakt 4/4, application mot
egen isolerad PostgreSQL 4/4, webbens route-/kodtester 6/6, Playwright 1/1
på 14,7 sekunder mot riktig Next-server och separat syntetisk PostgreSQL.
Browserflödet täckte arrangörskod, inlösen, vänteläge, publicerat resultat,
nytt browsercontext med samma konto, fel konto, anonym detalj och 390 px utan
horisontell overflow. Lint, typecheck och build för database, contracts,
application och web gav alla exit 0 efter sista produktändringen. Browser-
harnessens tsc och riktade ESLint gav exit 0. Ett första browserförsök stannade
på en överflödig testselector efter lyckad direktanmälan; slutkörningen
passerade utan produktkodändring. En tom och oanvänd körningsunik testdatabas
från tidigare försök inspekterades och togs bort; syntetisk källdatabas
bevarades och isolerad PostgreSQL-server stoppades. Inga verkliga tävlingar,
Eventor-anrop, privata API-nycklar, GPS, USB eller stafett ingick.

TASK152 är syntetiskt verifierad, inte fysisk mobil- eller fältacceptans.
Operatörens identitetskontroll och privat överlämning av konto/kod är externa
antaganden. Självregistrering, kontoåterställning, formellt vårdnadshavarbevis
och faktisk användarprovning återstår före bred deltagarlansering. Nästa minsta
produktdel är B2: serverlagd följ/avfölj av redan publika resultat för ett
inloggat konto utan att ta bort anonyma lokala favoriter.

## 2026-09-23: TASK153 B2 syntetiskt verifierad

ADR-0147 och TASK153 inför en separat append-only kontopreferens för att
följa ett redan offentligt `raceId` + `publicResultId`. Migration 0080 är
additiv med FK, unikt request-id och immutable journal. Det är inte B1:s
ägarkoppling och öppnar ingen privat resultaträtt. Nya följningar kräver
aktuell offentlig V7-rad; kontots privata lista resolverar alltid om genom
den offentliga projektionen. En syntetiskt otillgänglig följning ger
`result:null`, utan tidigare resultatfält. Exakt retry och ändrat intent
hanteras separat. Anonyma favoriter ligger kvar lokalt och importeras inte
tyst vid inloggning.

Riktad slutverifiering efter sista produktkodändring: databasschema 3/3,
kontrakt 3/3, application mot egen isolerad PostgreSQL 3/3 inklusive
samtidiga kommandon, webbrutt och
publik UI 13/13. Lint, typecheck och build för database, contracts,
application och web gav alla exit 0. Browserharnessens tsc och riktade
ESLint gav exit 0. Sista Playwright-körningen passerade 1/1 på 16,0 sekunder
mot riktig Next-server och ny syntetisk PostgreSQL: anonym lokal favorit,
inloggad följning på 390 px, återöppning med samma konto på 1280 px,
kontoseparation, avföljning och overflowkontroll. Ingen körningsunik test-DB
återstod; syntetisk källa bevarades och testinstansen stoppades. Ingen riktig
Eventor-nyckel, tävling, USB, GPS eller stafett ingick.

Detta är inte fysisk mobil- eller fältacceptans. Konton provisioneras och
överlämnas ännu manuellt; ingen automatisk import av lokala favoriter eller
offlinekö för kontoval finns. `result:null`-gränsen provades med en syntetisk
pekare till opublicerad anmälan, inte genom en komplett återtagandeväg för ett
tidigare publicerat resultat. Nästa minsta produktdel enligt målplanen är
C2:s första ADR/TASK för att rätt konto ska kunna se en redan privat uppladdad
rutt utan att få uppladdnings-/publiceringsrätt som bieffekt.

## 2026-09-23: produktmålet uppdelat i avprickningsbara nivåer

`docs/product-goal-roadmap-2026-09-23.md` skiljer nu individuell fältpilot,
användbar deltagarprodukt och bred tävlingsprodukt. Kontoinförande/återställning
är en egen införandegrind (A3); C2 delas i privat kontobunden ruttåtkomst,
bevisad kart-/bankontext och separat publicering; C3 avgränsar senare analys
utifrån faktiskt uppmätta data. D1 skiljer verklig SPORTident-hårdvara,
internetdrift/restore och fältpilot. Planen rättar också B2:s status:
kontosynkad följning är syntetiskt verifierad medan anonyma favoriter är lokala.
Nästa minsta arbete är ADR/TASK för C2a. Inga produktfiler, migrationer,
testdatabaser, credentials eller externa tjänster ändrades i denna planvända.

## 2026-09-23: TASK154 C2a privat GPX-faktavy syntetiskt verifierad

ADR-0148 avgränsar en ny, enbart läsande kontorätt till redan lagrade
GPX-manifest som hör till en aktiv, inlöst koppling till exakt anmälan.
`/me` listar egna versioner och en vald detalj visar härledd spårlängd,
punkt-/segmentantal och endast verkligt tillgänglig sammanhängande GPX-tid.
Varken gammal upload-grant eller publik resultatlänk används som behörighet;
inget samtycke, publicering, karta, bana, råkoordinater eller GPX-original
exponeras av denna väg. Ingen migration eller writer tillkom.

Riktad slutverifiering: contracts 3/3, application mot isolerad
PostgreSQL17/PostGIS 3/3, webbrutt 3/3 och Playwright 1/1 på 17,1 sekunder
med ny browsercontext för samma konto, annat konto och anonymt avslag samt
390 px utan horisontell overflow. Contracts, application och web lint,
typecheck och build gav var för sig exit 0; browserharnessens TypeScript
och ESLint gav exit 0. Ett första applicationförsök återanvände en syntetisk
engångskod mellan fall; ett första browserförsök delade testcookies mellan
arrangör och deltagare. Testfixturerna rättades och de sista körningarna
passerade. Körningsunika testdatabaser är borta och browserporten är stängd.

Detta är inte en kartvisning eller fältklar deltagarprodukt. Exakt kart-,
georeferens- och historisk banversion kan ännu inte bevisas från
ruttmanifestet. Fysisk mobil, säker kontoöverlämning och internetdrift
återstår. Nästa minsta uppgift är C2b:s ADR/TASK för ett exakt versionsankare
och endast därefter en kontobunden privat kartöverläggning.

## 2026-09-23: TASK155 C2b privat versionsbunden kartkontext syntetiskt verifierad

ADR-0149 och TASK155 inför en separat, explicit `MANAGE_RACE`-bindning av
exakt privat GPX-manifest, kartmanifest, georeferens, kontrollgeometri och
effektiv publicerad historisk resultat-/banversion. Migration 0081 är
additiv och journalen immutable. Ingen gammal GPX binds automatiskt.
Kontosession och aktiv exakt anmälningskoppling kontrolleras på varje privat
overlay- och bildläsning. Browsern får endast pixelrutt, kontrollpositioner
och verkliga GPX-fakta; bildbegäran måste bära samma kontextrevision som
overlayn. Saknad/föråldrad koppling visar vänteläge. Privat bindning kräver
varken samtycke eller offentligt kart-/ruttsläpp och ändrar inte publikvy.

Riktad slutverifiering efter sista produktkodändring: contracts 4/4,
application mot isolerad PostgreSQL17/PostGIS 1/1 med två GPX-versioner,
webbrutt 4/4 och Playwright 1/1 på 7,4 sekunder vid 390 px. Database,
contracts, application och web lint/typecheck/build gav var för sig exit 0;
browserharnessens riktade TypeScript/ESLint gav exit 0. Browserns
kartbildsbytestransport var simulerad, medan overlay- och obehöriga HTTP-
begäranden gick mot riktig lokal Next/PostgreSQL. Inga körningsunika
TASK155-testdatabaser återstod. Ett första kontraktsprov saknade nytt
versionsfält i fixturen; ett första browserprov hade för bred testselektor.
Båda korrigerades och slutkörningarna passerade.

Detta är inte fysisk mobil-, objektlagrings-, verklig kartprecisions- eller
fältacceptans. Rätt karta/geometri är fortfarande ett uttryckligt
arrangörsval; konton/claim-koder överlämnas fortfarande betrott utanför
systemet. C2c:s separata förklaring av privat kontra faktiskt offentlig
exakt version är nästa minsta uppgift. GPS, OMAP, Eventortrafik, SPORTident,
stafett och ny ruttanalys ingick inte.

## 2026-09-23: produktmålplanen samlad i fem delmål

`docs/product-goal-roadmap-2026-09-23.md` har uppdaterats med fem
användarorienterade delmål: arrangera tillsammans, följa tävlingen, egna
spår, genomförande/återställning och en ny tävlingsform i taget. Varje del
har verifierad nulägesnivå och återstående grind. En föråldrad formulering
om saknad privat kart-/bankontext har rättats efter TASK155. Nästa minsta
koduppgift är fortsatt C2c; C1 och D1 är separata beroendebeslut. Detta var
endast en planuppdatering: ingen produktkod, migration, testdatabas, verklig
tävling eller extern tjänst ändrades. Inga kodtester kördes.

## 2026-09-23: TASK156 C2c exakt delningsstatus syntetiskt verifierad

ADR-0150 skrevs före produktkod. TASK156 versionshöjer den befintliga
kontoskyddade privata GPX-detaljen till ett svar med tre separata fakta för
exakt vald version: senaste aktiva samtycke, administratörens exakta
kart-/ruttsläpp och faktisk publik åtkomst. Den sista härleds via samma
publika route-gate och full projektion som den öppna ruttsidan; bara då
returneras en offentlig länkidentitet. En återkallad anmälningskoppling
stoppar den privata läsningen. Ingen migration, ny skrivväg, GPS-funktion
eller ny publiceringsmotor infördes.

Slutlig riktad verifiering: contracts 4/4, webbrutt 3/3 och application
mot körningsunik isolerad PostgreSQL17/PostGIS 1/1. Applicationprovet
omfattar två versioner, samtycke, exakt publicering, kart-/samtyckes-/
ruttsåtertaganden, ändrad historisk bana samt obehörig/spärrad koppling.
Playwright 390 px passerade 1/1; privat HTTP och PostgreSQL var verkliga,
men länken i dess positiva UI-läge kom från ett syntetiskt API-svar.
Contracts/application/web lint, typecheck och build gav var för sig exit 0;
browserharnessens riktade TypeScript/ESLint gav exit 0. Ett första PG-prov
föll på fixtureordningen för två samtidiga upload-grants; fixturen rättades
och slutprovet passerade. Riktade TASK156-testdatabaser rensades efter proven.

Detta är inte fysisk mobil, riktig objektlagringsläsning, verifierad
kartprecision, internetdrift eller användaracceptans. C2a–c är syntetiskt
verifierade men C1:s GPS-inspelning, C3:s analys, A3:s kontoinförande och
D1:s fältgrind återstår. Nästa minsta produktuppgift enligt målplanen är
C1:s ADR/TASK för en uttryckligen vald fysisk mobilklient och privat GPS-
inspelning, om inte ett konkret D1-fältberoende först blir tillgängligt.

## 2026-09-23: C1a kodad men nativegrind öppen; A3a påbörjad

ADR-0151 och TASK158 har gett en separat Androiddeltagarapp med lokal
foreground-GPS-tjänst, app-privat SQLite-punktjournal och svensk statusvy.
Riktad web-typecheck/lint/bygg och 5/5 UI-/kontraktstester passerar. Den
native delen är inte kompilerad eller fysiskt provad. En Temurin 21.0.12+8-
arkivfil hämtades till privat temporär katalog och verifierades mot den
tidigare pinnade SHA-256; Gradle 8.14.3 `--version` gav exit 0 med den.
Android SDK 36 är inte installerad: SDK-hanteraren visade ett nytt
licensavtal, tom stdin avböjde och inga paket installerades. Ingen Android
lint, APK, instrumenterad journaltest eller GNSS-/skärmlåsacceptans får
därför räknas grön. Nativegrafens låsfiler/strict verification återstår.

I ett oberoende A-spår har ADR-0152 skrivits före kod och TASK159 avgränsar
en betrodd engångsinbjudan där mottagaren själv aktiverar ett nytt konto.
Snittet är nu syntetiskt verifierat enligt aktuell status överst. Beslutet
ger ingen automatisk eventgrant, anmälningskoppling eller e-postidentitet;
ägarstyrd UI-inbjudan och kontorecovery är senare separata snitt. Källunderlag finns i
`docs/research/account-invitation-2026-09-23.md`. Ingen verklig credential,
Eventortrafik, tävlingsdatabas eller persondata användes i detta beslut.
