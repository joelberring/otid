# TASK167: kompakt privat betalfilter i tävlingsarbetsytan

Status: riktat syntetiskt verifierad 2026-09-23; ingen fysisk enhetsacceptans.

## Användarutfall

En tävlingsadministratör ska snabbt kunna hitta de anmälningar vars redan
privata betalstatus är `UNMARKED` eller `UNPAID`, välja en deltagare och
använda den befintliga granska/bekräfta-rättningen. Det är en arbetslista,
inte en betaltransaktion eller ett påstående om att omarkerad är obetald.

## Omfattning

- Återanvänd den laddade, validerade adminrosterns `paymentStatus` i `/manage`.
  Visa ett textligt antal och en touchvänlig filterkontroll bland befintliga
  deltagarfilter. Kombinera med befintlig sökning och övriga filter.
- Filtrera endast `UNMARKED` och `UNPAID`; okänt värde ska inte råka komma
  med. Avmarkering återställer listan. Pagineringen börjar om vid filterbyte.
- När antalet är noll visas ett specifikt tomläge. Efter befintlig
  betalstatuskvittens används serveromladdning som redan finns; en konflikt
  ska fortsatt kräva nytt rosterunderlag.
- Håll filtren kompakta utan sidscroll vid 390 px och använd text, inte bara
  färg, för status. Den valda deltagarens befintliga betalformulär ändras inte.

## Verifiering

Riktat rent prov av statusurvalet och kombinationen med sökning, berörd
webb-lint/typecheck/build samt en proportionell UI-kontroll av filter/tomläge.
Ingen ny databasskrivning eller bred browsersvit behövs: TASK142:s redan
verifierade PATCH-/konfliktflöde återanvänds oförändrat.

## Utanför

Belopp, betalprovider, Swish/OCR, faktura, massändring, publik betalstatus,
nya API:er, ny journal eller migration, Eventor-skrivning, GPS, stafett,
SPORTident och USB. ADR-0141 har redan definierat statusarnas domän och
privata gräns; detta snitt ändrar endast presentation av befintliga fält,
så en ny ADR behövs inte.

## Resultat och kontroll 2026-09-23

Privat `/manage` visar nu antal `UNMARKED`+`UNPAID` och ett textligt
touchfilter. Det kombineras med sökning och befintliga äldre-resultat-/
hyrbrickfilter; val av en filtrerad rad öppnar den redan skyddade enskilda
betalstatusåtgärden. När uppdaterat roster saknar sådana poster visas ett
specifikt tomläge. En statusändring använder fortsatt TASK142:s befintliga
versionskontroll, serverkvittens och omladdning; ingen massändring infördes.

- Webb-lint och webb-typecheck: exit 0.
- E2e-lint och e2e-typecheck: exit 0.
- Riktat filterprov: 1 fil, 3/3 godkända.
- Riktig Next/browser med syntetiska avlyssnade API-svar på 390 och 1280 px:
  1/1 godkänt. Kontrollerade filter, betalformulär, avmarkering, tomläge,
  kompakt desktoprad och frånvaro av horisontell sidscroll. Ingen PostgreSQL
  eller riktig person.
- Checkin-shell-bygge och Next-produktionsbygge: exit 0.

Kvarstående antagande: browserprovet simulerar API-svar, så det bevisar inte
serverns behörighet eller samtidig betalstatusrättning. TASK142:s separata
PostgreSQL-/browserprov täcker den befintliga writern, men kördes inte om
för detta oförändrade serverflöde. Fysisk mobil/fältanvändning är oprövad.
