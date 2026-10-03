# ADR-0151: separat Androidklient för privat deltagar-GPS

- Status: Accepterad för C1:s beslutssnitt. C1a:s lokala kod finns, men
  nativebygge och fysisk inspelning är ännu inte verifierade; C1b–d saknas.
- Datum: 2026-09-23

## Kontext

O-Tid ska fungera på olika enheter, men C1 behöver först en klient där
inspelning genom skärmlås är tekniskt prövbar. Dagens `apps/station` har
USB-host, stationscredential och en SQLite-kö för råa SPORTident-meddelanden.
Att lägga deltagarens privata koordinater och kontosession i samma app skulle
blanda två privilegier och två offlineköer. En mobilbrowser kan inte antas
garantera fortlöpande position genom skärmlås. Dagens GPX-uppladdningslänk
ger inte ett inloggat konto skrivrätt; kontoanknuten läsning får inte tolkas
som motsvarande skrivbevis.

## Beslut

Första målet är **en Androidtelefon med en separat deltagarapp** under
`apps/participant`, med en egen appidentitet och privata data. Appen återbrukar
projektets pinnade Capacitor/Android/Kotlin-verktygskedja och svenska UI-
principer, men aldrig stationens USB-manifest, rådatabas, pairing eller
operatörscredentials. iOS och mobilbrowser förblir separata, oprövade klienter
för GPS-inspelning; de öppna resultat- och kontovyerna fungerar fortsatt i
browser på mobil och dator.

I den färdiga deltagarresan får en inspelning startas endast efter uttrycklig
användarhandling i synlig app, under ett tidigare autentiserat konto med en
serververifierad exakt anmälningskoppling lagrad för denna enhet. Lokal
offlinestart får utformas kring ett sådant tidigare bevis, men aktuell rätt
måste omprövas på servern före varje synk. Dagens B1-resultatsvar ger ingen
fullständig opak anmälningsväljare, och dagens host-only browsercookie är
inte en installerad appsession. **En separat ADR måste besluta mobil
autentisering och scoped offlineval innan detta blir en produktfunktion.**
C1a bygger därför endast en lokal recorder med utvecklarprov, inte en
kontobunden GPS-produkt. Återkallad koppling får senare inte ge ny serverrutt,
men lokala osynkade mätpunkter bevaras för användarens uttryckliga hantering.
Native Android ansvarar för platsåtkomst i en `location` foreground service
och för en egen app-privat, lokal beständig punktjournal. Första versionen ber om nödvändig
foreground-/precisionsbehörighet och visar avslag, avstängd plats, avbruten
tjänst och otillräcklig precision som **icke inspelande eller degraderade
tillstånd**, aldrig som en falsk grön inspelning. Den begär inte generell
bakgrundsplatsbehörighet eller startar om platsinsamling tyst från bakgrunden.
En pågående tjänst ska ha synlig systemnotis. Skärmlås, batterisparläge och
verklig telefon verifieras innan stöd utlovas.

Varje mottagen mätpunkt får en lokal inspelningsidentitet och monoton sekvens
i samma beständiga transaktion som koordinat, faktisk mättid och tillgänglig
noggrannhetsmetadata. Ingen punkt sorteras, fylls i eller tolkas som en
SPORTident-stämpling. Ett processavbrott får lämna en öppen men tydligt
`AVBRUTEN` inspelning; återöppning visar bevarade punkter och luckan och
kräver synlig, uttrycklig fortsättning. Stopp fryser en lokal version och en
kanonisk hash av punktjournalen; ett senare överföringssnitt fryser och
hashar även exakta GPX-bytes. Lokal originaldata tas inte bort för att en
begäran skickats, bara efter separat dokumenterat
retentionsbeslut och bevisad varaktig serverkvittens. Osynkade koordinater
ska inte ingå i automatisk appbackup. En annan inloggad användare på samma
telefon får varken se eller synka föregående kontos lokala spår.

Efter beslut om mobil inloggning får ett eget skrivsnitt införa en **separat,
konto- och exakt anmälningsbunden** auktorisation för överföring av en färdig
privat GPX-version. Det ska återanvända validering, immutable objekt/manifest
och hållbar kvittens där det är säkert, men inte göra `publicResultId`,
ruttväljaren, en gammal upload-länk eller B1:s läsbehörighet till en generell
skrivcredential. Före
serverkod krävs ett eget ADR för den nya skrivgränsen, inklusive återkallad
koppling, omvald anmälan, exakt retry och konflikt vid ändrat innehåll.
Uppladdning sker efter stopp; ingen liveposition eller tävlings-/resultatstatus
skapas av GPS. Existerande separata samtycke, kartsläpp och offentlig ruttgate
förblir oförändrade.

## Konsekvenser och gränser

Detta är ett medvetet första plattformsval, inte ett byte av serverarkitektur
eller löfte om stöd för alla telefoner. En ny klient innebär en egen bygg- och
fälttestgrind; stationens tester kan inte ersätta den. Första små snittet
provar lokal inspelning i ett avgränsat utvecklarflöde utan att ge ett
halvfärdigt server-API rätt att ta emot privat data. Riktad automatiserad
testning täcker journalens sekvens, stopp, hash, omstart och felstatus; fysisk
acceptans täcker riktig GNSS och skärmlås.
Om telefonen vägrar fortsatt insamling ska UI redovisa luckan och möjliggöra
säker återhämtning, inte dölja den.

Inget i beslutet ändrar resultatmotor, start-/målflöde, ruttpublicering,
kartsläpp, tävlingsklass, SPORTident eller Eventor. En inspelning är en privat
deltagarrutt och aldrig underlag för automatisk tidtagning eller ”kvar i
skogen”-status.

## Avvisade alternativ

- Utöka stationsappen: blandar deltagarkonto/position med USB och
  operatörscredential, och dess USB-krav utesluter vanliga telefoner.
- Lova PWA-inspelning genom skärmlås: saknar verifierad livscykel för detta
  produktkrav; browser kan prövas separat som foreground-alternativ.
- Kräva `ACCESS_BACKGROUND_LOCATION` från början: en användarstartad,
  fortgående foreground service kan prövas först utan den bredare
  behörigheten. Automatisk bakgrundsstart kräver nytt beslut.
- Låta inspelningen automatiskt publicera/livevisa GPS: bryter befintlig
  privat-, samtyckes- och releasegräns.

Faktaunderlag: [Androidförstudien](../research/android-participant-location-2026-09-23.md),
ADR-0009, ADR-0123, ADR-0146 och ADR-0148–0150.
