# TASK225: synligt fastställande och separat resultatexport

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

I `Efter tävlingen` ska arrangören direkt kunna se var resultat fastställs,
utan att först öppna en exportruta och passera filval. Skillnaden mellan att
**fastställa** en oföränderlig version och att **ladda ner** en befintlig
Snapshot-/Complete-fil ska framgå i text och ordning. Det ska vara lugnt,
kompakt och användbart på både 390 px mobil och bred arbetsyta.

## Avgränsning

Flytta endast det befintliga fastställandeflödet, inklusive kandidat,
blockerare, granskningskort, osäkert svar och idempotent återförsök, till en
egen direkt synlig del i `Efter tävlingen`. Låt den befintliga exportdelen
fortsatt vara en separat expanderbar del. Inga knappar får bli tillgängliga
när arbetsytan är låst. Svensk text ligger i i18n. Lägg bara till små,
scopade layoutregler; inga stora kort eller dekorativa färger.

Ingen server-/databasändring, ny officiell status, resultatregel, IOF-
serialisering, behörighet, publicering eller kart-/ruttfunktion ingår.
ADR-0028:s Complete-gate och övriga domängränser är oförändrade, så ingen
ny ADR behövs. Filer: `race-administrator-workspace.tsx`, dess CSS-modul,
`race-administrator-sv.ts` och ett riktat syntetiskt browserprov.

## Acceptans

Fastställandets rubrik och underlagsknapp syns utan disclosure. Snapshot och
historiska Complete-filer ligger under separat exportdisclosure. Pågående
granskning och okänt svar stannar hos fastställandet; samma begäran kan
återförsökas. 390/1280 px har inget sidspill och mobilens primära
tryckmål är minst 44 px. Kör berörd webblint/typecheck/build och ett litet
syntetiskt browserprov; ingen riktig tävlingsdatabas eller credential.

## Utfall

Fastställandet är nu en direkt synlig, kompakt sektion överst i Efter.
Den befintliga kandidatvyn, blockerarna och gransknings-/återförsöks-
knapparna flyttades utan ändring i anrop eller låsning. Exporten är en
separat expanderbar del efter rättningsområdena. En tunn avdelare används;
ingen ny dekorativ färg eller stor översiktsruta tillkom.

Riktad webblint och web-typecheck gav **exit 0**. E2E-TypeScript och
ESLint för browserprovet gav **exit 0**. Checkin-förberedelsen och
web-build gav **exit 0** när Next kördes med den befintliga
`npm_lifecycle_event=build`-markören. Ett första direkt `next build`
utan markören gav **exit 1** under sidinsamling eftersom projektets
build-only-databasfallback då inte aktiverades; ingen databas kontaktades.
Det enda syntetiska browserprovet gav **1/1, exit 0** vid 390 och
1280 px: synlig fastställandeknapp före stängd export, minst 44 px
primärt mobilmål, ingen sidscroll, granskning och samma request/body/
idempotensnyckel vid osäkert återförsök. Bilderna granskades visuellt.
Alla API-anrop avlyssnades, en fiktiv browsercredential användes och
inget verkligt resultat fastställdes eller exporterades.

Antagande: hur lätt verkliga funktionärer hittar och förstår steget har
ännu inte prövats med användare. Mobilens 390 px och datorns 1280 px är
syntetiska browserlägen, inte fysisk mobilacceptans.
