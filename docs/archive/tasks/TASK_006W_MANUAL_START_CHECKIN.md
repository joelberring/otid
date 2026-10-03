# TASK 006W – manuell avprickning för startpersonal

Status: Implementerat och verifierat avgränsat vertikalt snitt, 2026-09-05.
Krav-för-krav-evidens och fältantaganden: `docs/task-006w-acceptance.md`.
Rena avpricknings-/skogskontrollregler samt operationskontrakt och
PostgreSQL-journalsubstrat finns enligt ADR-0048, ADR-0049 och ADR-0050.
Separata start-/målcredentials och autentiserad, idempotent enhetsregistrering
finns på applikationsnivå. Atomisk avprickningssynk och DNS-koppling finns.
Separat DNS-provenans och dess återtagande har schema/källvalidering
enligt ADR-0051 och är kopplade till synkskrivaren och resultatläsarna.
Central resolver, publik/Snapshot, privat historik format 10 och nya
Complete-finaliseringar format 9 är nu kopplade. Atomisk synkskrivare med
negativ rapport-/återkomstgrind finns på applikationsnivå. Privat operativt
rosterunderlag med domänklassificerad skogsstatus finns enligt ADR-0052;
Skyddade HTTP-anrop finns för session, roster, enhetsregistrering och synk
med separata start-/målcookies. Målpersonalens privata läs-/utskriftsvy finns
på /admin/<raceId>/forest-watch med klassfilter, alla fem grupper och
daterad osäkerhet. Krypterad beständig IndexedDB-kö med lokal upplåsning,
CAS, bevarade kvittenser och enstegs HTTP-transport finns enligt ADR-0053.
Browserlagringen är provad över omladdning; transportsvaret är ännu
simulerat i dessa prov. Persondatafritt statiskt appskal, explicit lokal
förberedelse med lagringssamtycke och låst offlineupplåsning finns enligt
ADR-0054 på /checkin/index.html. Aktiverbart skrivläge, klassfilter, tre
startmarkeringar och separat målrättning med manuell återkomst är kopplade till
IDB och ordnad synk. Offline reload, tappad riktig HTTP/PG-kvittens, DNS-rättning
och sen negativ rapport är provade i browser med syntetisk tävling.
Credentialåterhämtning och explicit konfliktgranskning är implementerade och
browser/HTTP/PG-verifierade, inklusive mobilens krypterade granskningsunderlag
efter offline reload. Automatisk återanslutning, låsning under tappat svar och
säker explicit lokal rensning är browserverifierade. Fysisk fältverifiering
och produktionsdriftsättning ingår inte i detta färdiga implementationstest.

## Användarbehov

Startpersonalen ska från mobiler kunna ropa upp och pricka av deltagare i en
separat privat startlista när startinformation inte kommer automatiskt från
utrustningen. Arrangören behöver ett bättre underlag för vilka som har startat
och ännu inte registrerats tillbaka. Fri start och minutstart ska fungera i
samma tävling. Användaren föreslår en aktiverbar checkboxfunktion i startlistan.

## Beslutsgränser för kommande ADR

- VIEW_START_LIST är read-only och får inte tyst ge skrivrätt. Separat
  avprickningsbehörighet och ett uttryckligen aktiverat skrivläge behövs.
- En tom ruta betyder inte avprickad, inte ej start. UI måste skilja detta
  från bekräftat startat och uttryckligt rapporterad ej start.
- Rapportering är inte en SPORTident-avläsning eller officiell tidsändring.
  En uttrycklig ej-startmarkering ska vid synk ge spårbart DNS som kan rättas
  vid mål enligt ADR-0049. UNMARKED ger aldrig DNS. Ingen rådata fabriceras.
- Fri starts faktiska tid får inte sättas till mobilens klicktid. Tidpunkt
  för observation, registrering och servermottagning måste hållas isär.
- Rättning ska skapa historik med aktör och versionsgrund. Flera mobiler
  kräver idempotenta återförsök och synlig konflikt, inte last-write-wins.
- "Startat, ingen registrerad återkomst" är mer precist än ett säkert
  besked "i skogen". Återkomst/mål/avläsning och eventuella manuella
  återkomstbeslut behöver en uttrycklig domänregel. Ingen säkerhetsgaranti.
- Befintlig publik startlista och resultatsida får inte exponera privata
  avprickningar automatiskt.

## Bekräftat offlinekrav och målpersonalens lista

Användaren har bekräftat att även mobilen kan sakna internet. Markeringar ska
sparas och senare synkas. Målpersonal ska kunna producera kvar-i-skogen-listor.
Detta får inte ersättas med en onlineknapp/minneskö eller enbart en domänfunktion.

Hämtad privat startlista och avprickningar behöver hållbar
lokal lagring, tydlig paket-/listversion, lokal köstatus, säker kvittens och
återhämtning efter omladdning. Credential-/persondatalagring, logout,
lagringstid och radering följer ADR-0049 och behöver konkretiseras före I/O-kod. Återanvänd
projektets synkprinciper utan att bredda stationens råavläsningskontrakt.

## Berörda gränser och acceptans

Förväntade paket: domain (ren tillståndsregel), contracts, application,
database (additiv migration/restore-not), web. Lokal persistensgräns väljs
först när offlinekravet och ADR är fastlagda. Ingen ny dependency antas.

Acceptans ska omfatta:

1. Mobil upprop/klassfilter och aktiverbart avprickningsläge för båda startformer.
2. Omarkerad, startat och uppgiven ej start går att skilja utan enbart färg.
3. Felaktig markering rättas spårbart utan ändrad rådata/resultathistorik.
4. Två samtidiga mobiler, samma requestretry och motstridiga intents.
5. Ingen write med endast VIEW_START_LIST; inga personuppgifter före auth.
6. Explicit ej-startmarkering ger DNS vid synk, aldrig tom ruta. Rättning vid
   mål och sen negativ offlinesynk får inte skriva över verklig återkomst.
   Ingen fabricerad officiell tid eller återkomst.
7. Omladdning efter lokal lagring, tappat commitsvar och
   säker återanslutning utan förlorade/dubblerade markeringar. Flera lokala
   ändringar för samma deltagare binder föregående request; en avvisad
   föregångare får aldrig automatiskt bli en lyckad efterföljande ändring.
8. Privat, utskrivbar kvar-i-skogen-lista med filter, startat utan återkomst,
   okänd startstatus, konflikter, datatid och senaste kända startenhetssynk.

Avgränsning: ingen automatisk SPORTident-starttransport, stafett, GPS,
kartvisning eller riktig USB. Detta är inte en utökning av TASK 001.

## Pågående återhämtningsdel, 2026-09-05

ADR-0055 avgränsar återhämtning när ursprunglig arbetscredential gått ut eller
spärrats. Manifestkontrakt, read-only-export från upplåst mobilkö och additiv
migration 0034 finns. Betrodd utfärdning/spärrning för exakt detta manifest är
implementerad och PostgreSQL-verifierad. Recovery-route och samma domänskyddade
synkskrivare finns nu, utan ändrad originalactor. Mobilens token-/kvittensflöde
är verifierat genom riktig browser/HTTP/PostgreSQL med spärrad behörighet,
tappat svar, omladdning och låsning. Hela TASK 006W kräver även explicit
konfliktgranskning innan den kan kallas klar. Se docs/status.md för resultat
och återstående fältantaganden.

Konfliktgranskningen är beslutad i ADR-0056. Ren planering för ett explicit
KEEP_CURRENT_STATE-beslut finns och bevarar uppföljningsbehov för startad utan
återkomst respektive okänd status. Strikta granskningskontrakt och immutable
journal/migration 0035 finns nu. Auktoriserad application-tjänst och serverns
projektion av olösta rapporter är implementerade. HTTP, gransknings-UI och
mobilens opt-in reviewDetails-koppling är nu verifierade. Standardroster saknar
det nya fältet; gamla vault kan fortfarande läsas. En ny autentiserad mobil-
hämtning sparar granskade request-id krypterat och skiljer granskad historik
från ogranskad konflikt efter offline reload, utan att ändra originalkvittensen.
Automatisk online-synks kapplöpningar och slutlig acceptansaudit är genomförda.
Rensnings-UI som upptäcktes saknas under audit är nu implementerat och provat:
pending/ogranskad konflikt nekas, kvitterad färdig lokal lista rensas efter
separat bekräftelse. Serverhistorik bevaras. Se `docs/task-006w-acceptance.md`.
