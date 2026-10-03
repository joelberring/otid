# TASK157: välj deltagarklient och bevisgrind för privat GPS

Status: beslutssnitt dokumenterat 2026-09-23; ingen GPS-kod eller fysisk
acceptans. Beslut: ADR-0151. Delmål: C1, inte hela deltagarprodukten.

## Användarutfall att arbeta mot

En inloggad deltagare ska kunna starta/stoppa en privat inspelning i appen,
se om den verkligen pågår och om något ligger osynkat, fortsätta efter
uppkopplingsavbrott och efter varaktig serverkvittens hitta exakt sin privata
GPX-version. Ingen deltagare eller publik får se liveposition som bieffekt.

## Beslutssnittets leverans

1. Välj Androidtelefon som första klientkategori och en **separat**
   Capacitor-/Kotlindeltagarapp, utan stationsappens USB-/operatörsbehörigheter.
2. Dokumentera Androids foreground-service-/plats-/backupregler mot
   primärkällor och skilj plattformsmöjlighet från fysisk verifiering.
3. Lås delarnas ordning och stoppunkter i produktplanen. Innan C1:s
   kontoanknutna skrivväg byggs skrivs ett separat ADR; C1 får inte ta över
   ADR-0123:s adminutfärdade bearergrant eller B1:s läsclaim tyst.

## Fortsättning, en aktiv liten TASK åt gången

- **C1a – lokal inspelning:** bygg endast den separata Androidklientens
  synliga start/stopp/status, native foreground location service och
  app-privata beständiga sekvensjournal i ett utvecklarflöde. Ingen påstådd
  kontobunden produktinspelning ännu. Avslag på precisionsbehörighet,
  avstängd plats, avbrott, full kö och processomstart visas ärligt. Ingen
  serveruppladdning eller publikt spår ingår. Riktade Kotlin-/UI-prov och
  APK-bygg, inte en bred testsopning.
- **C1b – konto och exakt anmälningsval:** eget ADR för säker inloggning i
  installerad app, utan att anta att browserns host-only cookie kan återbrukas.
  Kontot väljer en serververifierad exakt anmälningskoppling; ett lokalt
  scoped underlag får stödja offlinestart, men servern omprövar rätt före
  synk. Annat konto på samma telefon får inte se gammal privat kö.
- **C1c – privat kontosynk:** eget skriv-ADR och avgränsat server-/klientsnitt
  för färdigfryst GPX med konto + exakt aktiv anmälningskoppling, stabil
  inspelningsidentitet/sekvens/hash, exakt idempotent retry och varaktig
  kvittens. En återkallad koppling stoppar ny skrivning men raderar inte den
  lokala kopian. Återanvänd privat GPX-lagring och C2-läsning utan att ge
  publik URL eller gammal uppladdningslänk ny rätt.
- **C1d – fysisk acceptans:** välj en faktiskt tillgänglig Androidtelefon
  och dokumentera modell/OS/appversion. Prova riktig GNSS, låst skärm,
  batterisparläge, frånslaget nät, processavbrott/omstart, ny inloggning,
  återanslutning och samma-batch-retry mot isolerad testtävling. Redovisa
  exakta punkter/luckor, batteripåverkan och serverkvittens; märk bara den
  prövade telefonen som fältverifierad.

## Stoppunkt och kvarvarande antaganden

TASK157 är klar som **arkitekturbeslut** när ADR, primärkällor och
acceptansordning finns. Den säger inte att Androidklienten är byggd, att
skärmlås fungerar i praktiken eller att iOS/browser har GPS-stöd. Ingen
fysisk telefon har inventerats i detta snitt. Den första koden hör till C1a.

Inget SPORTident, stafett, Eventor, automatisk resultatbedömning,
liveposition, Liveloxberoende eller ny ruttpublicering ingår.
