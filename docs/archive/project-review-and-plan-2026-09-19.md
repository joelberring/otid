# O-Tid: projektgenomgång och genomförandeplan

Datum: 2026-09-19. Avsedd som överlämning till en ny arbetstråd.

**Aktuell styrande målplan från 2026-09-23:**
[O-Tid: aktuell produktmålplan](product-goal-roadmap-2026-09-23.md).
Texten nedan bevarar 19–22 septembers genomgång, leveranshistorik och tekniska
delspår. Dess äldre prioritering och startinstruktion ska inte användas som
nästa uppgift när de avviker från den aktuella målplanen.

## Slutsats

O-Tid har en omfattande individuell tävlingskärna och många fungerande
administrationsflöden. Projektet är däremot ännu inte ett färdigt, fältverifierat
alternativ till MeOS. Det största återstående steget är en sammanhängande,
praktiskt körbar tävling: förberedelse, riktig brickavläsning, avvikelsehantering,
resultat och återställning. Ytterligare små adminfunktioner ersätter inte det steget.

Min bedömning är **avancerad utvecklingsversion**, med starkare backend och
administration än färdig operativ produkt. En procentsiffra skulle bli missvisande:
många små färdiga uppgifter väger inte upp att den riktiga avläsningskedjan saknas.

Rekommendation: färdigställ den pågående ändringen, gör systemet enkelt att prova,
samla vardagsarbetet, och arbeta parallellt med den konkreta SPORTident-blockeraren.
Sikta därefter på briefens fältprov med 30–100 deltagare. Behåll fullare
MeOS-likvärdighet som fortsatt produktmål med en synlig funktionsmatris.

## Vad denna genomgång faktiskt verifierat

- Skrivskyddad genomgång av produktbrief, arkitekturbeskrivning, domän-/offlineregler,
  relevanta ADR:er, statuslogg, implementation, konfiguration och befintliga testfall.
- Två avgränsade läsgranskningar: GPT-5.6 Sol för backend/drift och GPT-5.6 Luna
  för arbetsflöden. Huvudgranskningen har kontrollerat slutsatserna mot kod.
- Aktuell officiell MeOS-dokumentation som funktionsreferens; ingen extern källkod.
- Ingen webbserver lyssnade på projektets kontrollerade portar 3000/3001/3002/3122.
  Ingen aktuell inloggad vy kunde därför inspekteras. Utseendebedömningen nedan
  bygger på komponenter/CSS och tidigare dokumenterade browserprov.
- Inga tester, byggen, migrationer eller externa Eventor-anrop kördes här.
  Tidigare gröna resultat är historisk evidens, inte en ny grön kontroll av dagens filer.
- Ingen produktkod ändrades. Befintligt halvfärdigt TASK077-arbete lämnades orört.

## Nuläge per användarområde

| Område | Läget nu | Det som främst återstår |
|---|---|---|
| Individuell resultatmotor | FIXED/PUNCH, ordningskontroll, saknade/extra kontroller, tider, sträcktider, ranking och revisionshistorik finns. | Verklig kortnormalisering, operativa tids-/kontrollrättningar och fler regelvarianter. |
| Deltagare och sekretariat | Gemensam admin kan direktanmäla, varna för dubbletter, rätta namn/klubb, byta klass/starttid och bricka. | Enklare etablering/inloggning, bättre tabellöverblick och hantering av okända avläsningar. |
| Tävlingsklass ↔ öppen klass | Byte till en befintlig klass med platskontroll och samtidig ändring av startregel/tid finns. | Skapa/redigera själva klasserna enklare. Deltagartak är inte en reserverad minutstartlucka. |
| Start | Fri start och minutstart kan finnas i olika klasser i samma tävling. Lottning, fast tidsrättning och frysta startlistor finns. | Vakanser, verkliga startluckor, mer lottningsstöd; blanda inte ihop detta med redan fungerande PUNCH/FIXED. |
| Resultatbeslut | DNS, DNF, DSQ, manuellt godkännande, utom tävlan och utan tid samt rättning/återtagande finns. | Mer sammanhållen presentation, operativ omräkning av flera berörda deltagare. |
| Startpersonal och mål | Offlineavprickning, synk, konflikthantering, manuell återkomst, kvar-i-skogen-lista och utskrift finns. | Fysisk mobilacceptans, långvarigt nätbortfall och faktisk tävlingsövning. Rapporten kan sakna osynkade observationer. |
| Hyrbrickor | Markering, ej återlämnade-lista, utskrift, återlämning, rättning och privat historik finns. TASK143/144 kan också ge en uttryckligt återlämnad hyrbricka till en annan befintlig deltagare och visa riktningen hos båda, med bevarad historik. | Klubbglobalt lager, fysisk inventering och deposition saknas. Betalstatus är endast en separat privat markering. |
| IOF | CourseData, EntryList och StartList importeras. StartList och Snapshot/Complete-resultat exporteras. | Bredare verkliga filfall och komplett tävlingsarkiv. Stöd för delar av IOF är inte full formatparitet. |
| Eventor | Serverlagrad anslutning med en sluten Testeventor-/produktionsprofil finns för event-/loppmetadata och explicit individuellt mappad anmälningsimport. | Ägarstyrd produktionsacceptans med privat credential, samt separat beslut om eventuell uppladdning. 59081-testkopian är inte bevis på detta. |
| Publik och speaker | Publika start-/resultatlistor, sökning, sträcktider, browserutskrift, individuell deltagarrapport, lokala favoriter och separat speakerunderlag finns. | Kart-/spåranalys efter tävlingen. Radio, bevakningar och avancerad speaker saknas. |
| Station och SPORTident | Råtransport/capture/replay, Androidskal, SQLite-kö, signerat paket, lokal motor och retry finns. | SI-protokollparser, kortavkodning och verklig sammanhängande USB-avläsning. Hårdvarustatus är fortfarande untested. |
| Klasser och banor | Importerad modell, versionskopplingar, startregel och deltagartak finns. | Vanlig manuell bana-/klassadministration och kontrollerad banändring efter att resultat finns. |
| PM, kartor, spår | PM har omfattande lagrings-/skanningsgrund men ingen färdig publiceringsprodukt. Kart-/spårmodell är beskriven. | PM-flöde, kartsläpp och därefter V2:s kartviewer/GPS. Uppladdade .omap-filer innebär inte att kartvisning finns. |
| Drift | Lokal PostgreSQL/PostGIS, privat MinIO, bygg- och testverktyg finns. | Reproducerbar användardemo, enkel driftsättning, bevisad backup/restore och komplett tävlingsarkiv. |
| Andra tävlingsformer | Individuell tävling är implementerad. | Stafett, patrull, poängorientering, gaffling/slingor, flerdagars, jaktstart och kval/final. |

Den mer detaljerade jämförelsen finns i [MeOS-funktionsmatrisen](meos-feature-matrix.md).
"Finns" betyder implementation med tidigare avgränsad verifiering, inte
produktions- eller hårdvaruacceptans.

### Viktiga lokala belägg

- `packages/domain/src/evaluate-card-readout.ts`: gemensam ren resultatmotor.
- `packages/application/src/entry-transfer.ts` och `race-administrator-policy.ts`:
  deltagarunderlag och den gemensamma administratörsrollen.
- `apps/web/src/components/race-administrator-workspace.tsx`: den integrerade arbetsvyn.
- `packages/eventor/src/index.ts` och `packages/application/src/eventor-import.ts`:
  sluten Testeventor-/produktionsprofil för read-only event-/loppmetadata och
  explicit individuell anmälningsimport; ingen Eventor-skrivning.
- `docs/sportident.md`, `docs/research/sportident-protocol-source-gate.md` och
  `docs/research/sportident-hardware-inventory.md`: protokollgrind och fysisk status.
- `docs/task-006w-acceptance.md`: avgränsad acceptans för mobilavprickningen.
- `apps/web/src/components/public-results.tsx`: resultatpolling var femte sekund
  och en bred tabell med sträcktider i samma rad.
- `docs/status.md`, särskilt TASK013 och TASK073–077: faktisk leveranshistorik.

## Hur systemet ser ut och upplevs

Det befintliga uttrycket är ljust, med gräddvit bakgrund, mörkgrön huvudfärg,
vita paneler och tydliga knappar. Svenska texter och tryckytor på minst 44 px
är bra för tävlingsmiljön. Adminvyn använder deltagarlista till vänster och
vald deltagares arbetsyta till höger; mobilen växlar mellan lista och arbetsyta.
Sökning, filter och utfällbara detaljer begränsar scrollen.

Det är en bra grund. De tydligaste användbarhetsproblemen i koden är:

1. **Två parallella sätt att arbeta.** Tävlingsöversikten länkar till många äldre
   funktionssidor, medan `/admin/<raceId>/manage` samlar stora delar av jobbet.
   Äldre sidor delar inte automatiskt den gemensamma sessionen.
2. **För teknisk entré.** Behörigheter utfärdas fortfarande via CLI och användaren
   klistrar in en credential. En tävlingsadministratör bör komma in i sitt lopp
   och kunna utföra vanliga uppgifter med samma inloggning.
3. **Information finns men är inte alltid samlad där beslut fattas.**
   Deltagarlistan prioriterar namn/klass; bricka och vissa varningar visas som
   tillägg. En operativ tabell behöver även start, gällande status och tid.
4. **Begränsad användning av bred skärm.** Global `main` har maxbredd 1120 px.
   TASK136 ger enbart `/admin/<raceId>/manage` 1520 px från 1280 px viewport,
   utan att göra publiksidor eller mobil tätare.
5. **Många åtgärdsknappar och tekniska detaljer.** Samla vanliga uppgifter nära
   deltagaren, lägg sällan använda detaljer bakom en tydlig öppning. Behåll
   synlig osäkerhet, konflikt och synkstatus, men förkorta återkommande förklaringar.

Föreslagen arbetsstruktur, med befintliga funktioner som grund:

```text
Tävling / lopp     anslutning · synk/avvikelser · senaste uppdatering
Deltagare | Start | Mål & avläsning | Kvar i skogen | Resultat | Inställningar
Sök · klass · status                         Ny deltagare · Utskrift
Namn / klubb | klass | bricka | start | status | tid  │ Vald deltagare
                                                     │ Vanliga åtgärder
                                                     │ Resultat / stämplingar
                                                     │ Historik (utfällbar)
```

Detta är en målbild, inte en ny implementerad vy. På 1366×768 bör sökning,
statusrad, tabellrubriker och minst åtta deltagare få plats när detaljdelar är
stängda. På 390 px behålls läsbar text och stora tryckytor, med list-/detaljväxling
och utan horisontell sidscroll. Lokala tabeller får vid behov egen scroll.

## Genomförandestatus efter genomgången

**A1/TASK077 slutfördes 2026-09-19.** `RENTAL` och `RENTAL_RETURN` finns nu i
kontrakt, samma `administrator-entry-changes`-projektion och den befintliga
svenska Historik-vyn. Riktat kontraktsprov, två PostgreSQL-fall (inklusive
fail-closed vid dubbel journalversion), ett browserfall samt berörd
lint/typecheck/build passerade. Se `TASK_077_RENTAL_CARD_HISTORY.md` och den
daterade statusloggen för exakta resultat.

**A2/TASK078 slutfördes 2026-09-19.** Den aktuella syntetiska demon använder
befintlig demoprovisionering, gemensam `MANAGE_RACE`, blandad fri/minutstart,
kapacitetskontrollerat klassbyte och publikresultat i samma browserkedja.

**A3 slutfördes med TASK079–080 2026-09-19.** Befintliga `/manage` visar nu en
kompakt statusremsa med hela rosterunderlagets deltagare, fri/minutstart,
äldre resultat, ej återlämnade hyrbrickor och underlagstid/version. Inga nya
serveranrop eller behörigheter infördes. Deltagarraden visar dessutom klass,
aktiv bricka och start direkt. Ett riktat befintligt desktopfall verifierar
klass/start, bricka och namn/klubb med samma login; 390 px verifieras i
TASK080-fallet.

`git rev-parse --show-toplevel` gav "not a git repository". Nästa tråd ska därför
inte förutsätta en tillgänglig diff eller att ändringar kan återställas med Git.
Fastställ arbetskopians versionshantering/återställningspunkt före breda ändringar.

README och tidiga avsnitt i arkitekturdokumenten beskriver äldre TASK001-läge.
Senare accepterade ADR:er, kod och daterad status behövs för dagens bild. Lägg
hellre till en kort aktuell ingång än att varje agent läser hela statusloggen.

## Prioriterad genomförandeplan

Detta är ett planförslag, inte nya accepterade arkitekturbeslut. Behåll Next.js,
TypeScript, den modulära monoliten, PostgreSQL/PostGIS och befintliga adaptergränser.
Nya teknikval, beständiga modeller eller ändrade domän-/behörighetsregler kräver
en kort ADR före implementation. Vanliga UI-förbättringar inom accepterade beslut
behöver inte varsin ADR.

### Etapp A: provbar och sammanhållen administration

**A1. Stäng TASK077 och skapa en grön utgångspunkt.**

Status 2026-09-19: slutförd och riktat verifierad.

Terra äger kontrakt/application; Luna kan slutföra de två UI-filerna efter låst
kontrakt. Slutför svensk historikvisning och kontrollera sortering/cursor med
både hyrmarkering och återlämning/rättning. Inga nya skrivvägar eller tabeller.
Acceptans: befintlig Historik visar sanna före-/eftervärden i rätt ordning.
Verifiering: kontraktstest, ett sammanhållet PG-fall plus ett relevant felaktigt
underlag, ett utökat befintligt browserfall; berörd lint/typecheck/build.

**A2. Gör aktuell version enkel att prova.**

Status 2026-09-19: slutförd och riktat verifierad som TASK078 enligt ADR-0102.

Terra återanvänder befintlig demoprovisionering och dokumenterar en aktuell,
syntetisk demo med ett gemensamt administratörsinträde, fri start och minutstart.
Luna kan uppdatera README/demoanvisningen. Skapa inte nya demoverktyg om de
befintliga räcker. Acceptans: en ny operatör kan öppna rätt vy, hitta deltagare,
byta klass med platskontroll och se publikresultat enligt en kort instruktion.
Verifiering: en genomgång av detta flöde; ingen omkörning av varje äldre demosvit.

**A3. Samla vardagsarbetet i den befintliga adminvyn.**

Status 2026-09-19: slutförd och riktat verifierad genom TASK079–080 ovanpå de
redan accepterade gemensamma adminmutationerna.

Terra ansvarar för data-/sessionsgränsen; Luna för en avgränsad tabell-/panelyta.
Gör `/manage` till tydlig huvudentré. Visa de operativa fälten från befintliga
projektioner och behåll sökning/vald deltagare mellan åtgärder. Integrera
saknade vardagsytor en i taget; upphöj inte gamla begränsade credentials automatiskt.
Acceptans: klassbyte tävlingsklass↔öppen, brickbyte, starttid och namn/klubb nås
utan ny funktionsinloggning. Vanliga rättningar ska kunna sparas med kort,
begriplig återkoppling; extra bekräftelse används där konsekvensen motiverar det.
Verifiering: ett desktop-/mobilflöde, plus serverprov endast om serverbeteende ändras.

### Etapp B: få en liten tävling genom hela systemet

**B1. Skapa och justera klass/bana utan obligatorisk XML-omväg.**

Status 2026-09-19: TASK081–084 är slutförda enligt ADR-0103–0106. En ny
manuell bana, immutable version 1, ordnad kontrollföljd och länkad klass kan
skapas i `/manage` med exakt retry och fortsatt IOF-samexistens. En befintlig
manuell klass kan få en ny immutable banversion både utan och med resultat.
Efter resultat binds ändringen till ett hash-bundet kandidatunderlag; alla
äldre resultatrevisioner och manuella beslut bevaras. Ingen automatisk eller
gruppvis omräkning görs: den redan befintliga individuella omräkningen är ett
separat beslut. B1 har därmed en användbar liten manuell konfigurationskedja,
men ingen banritare eller bred redigering/importadministration.

Terra bygger ett litet snitt: en bana med kontrollföljd och en klass kopplad till
den. Därefter ett separat snitt för ny banversion/klasskoppling när deltagare
redan finns. Behåll gamla resultat och visa vilka som behöver omräkning.
Acceptans: en enkel tvåbanors träning kan förberedas manuellt; import fortsätter
fungera. Kort ADR för den nya skrivvägen/versionssemantiken. Ingen banritare.

**B2. Slut den operativa kedjan för okänd bricka.**
Terra kartlägger och återanvänder lagrad okänd avläsning, direktanmälan/brickkoppling
och explicit omräkning. Lägg en sammanhängande arbetsgång vid mål.
Acceptans: välj lagrad okänd avläsning → välj/skapa deltagare → koppla rätt bricka
→ beräkna resultat, med samma bevarade rådata och utan påhittade stämplingar.
Verifiering: ett PG-flöde med dubbelretry/konflikt och ett browserflöde.

Status 2026-09-19: TASK085/ADR-0107 är slutfört och riktat verifierat. Det
ersätter inte rådatahistoriken eller gör en vanlig omräkning implicit: den nya
skrivvägen väljer alltid exakt `readoutId` och gör deltagare, brickkoppling och
revision atomiskt. Ingen senare avläsning med samma bricknummer kan ersätta den
valda. Isolerat PostgreSQL/PostGIS- och 390 px browserprov täcker konflikt,
retry, exakt val och tappat commitsvar.

**B3. Ge målpersonal och löpare en användbar resultat-/sträcktidsrapport.**
Status 2026-09-19: slutförd genom TASK086–089 med riktad kontrakts-,
PostgreSQL-, 390 px-browser- och produktionsbyggverifiering.

Luna bygger klassfilter/sökning och en kompakt individuell rapport utifrån
befintligt underlag; Terra granskar fältens betydelse. Visa tid, status, tid efter,
kontroller, sträcktider och avvikelse. Erbjud browserutskrift före skrivarspecifika
integrationer. Acceptans: resultat kan hittas och förstås snabbt på mobil och dator.
En UI-/printkontroll räcker om beräkningslogiken är oförändrad.

**B4. Ge administratören vanliga tävlingsrättningar.**
Separata små leveranser: först tydlig omräkning av en berörd grupp; sedan
neutraliserad kontroll/avkortad bana och vid behov start-/måltidsrättning.
Sol används när resultatregler eller transaktionssemantik ändras. Varje regel
behöver en kort egen specifikation/ADR; lagra rättning som beslut/revision och
bevara råstämplingarna. Testa just resultatregeln och historik/retry. Bygg inte
ett generellt skriptspråk eller bulkredigeringsramverk.

Status 2026-09-22: TASK091/ADR-0109 och TASK092/ADR-0110 är slutförda och
riktat verifierade. TASK091 begränsar gruppomräkning till en explicit, hashad
klassgrupp med högst 100 tekniskt READY Entries och en all-or-nothing-revision.
TASK092 neutraliserar exakt en namngiven kontrollförekomst för en klass, utan
auto-omräkning och utan att råstämplingar eller äldre revisioner ändras.
TASK093–096 har därefter levererat och synliggjort en strikt observerad
måltidsrättning och dess återtagande; TASK104–105 gör motsvarande avgränsade
PUNCH-starträttning. TASK097 hindrar att en förkortningsregel felaktigt förs in
som vanlig banrättning efter resultat.

TASK135 har nu en separat, immutable kortklass för en vald
kontrollprefixöverflyttning, inklusive begränsad MP-omvärdering från bevarad
readout. Den är inte
en generell avkortningsmotor och skapar varken bulkredigering eller ändrade
råstämplingar. Dess riktade körning mot uttryckligen vald isolerad
PostgreSQL/PostGIS och det befintliga browserfallet passerade 2026-09-22 med
enbart syntetiskt underlag. Ny resultatlogik kräver fortsatt ett separat,
konkret ADR/task; TASK135 utvidgas inte till en generell avkortningsmotor.

### Parallellt kritiskt spår H: riktig SPORTident

**H1. Lös det konkreta underlagsbehovet.**
Sol inventerar vad ADR-0007 fortfarande saknar och sammanställer en enda lista:
officiell protokollguide/villkor, oberoende testvektor, faktisk station, korttyp
och Androidenhet. Begär användar-/leverantörsunderlag när det behövs; skicka
inte externa meddelanden utan auktorisering. Om underlaget saknas ska spåret
stå stilla medan A/B fortgår, inte konsumera fler rundor syntetisk infrastruktur.

**H2. En station och en korttyp från bytes till resultat.**
Först när grinden är löst: Sol implementerar egen parser/normalisering och
kopplar den till befintlig station/store/resultatmotor. Lås en faktisk
station/kortkombination i uppgiften. Här krävs chunkgränser, CRC, dubletter,
trunkering, borttagen bricka/kabel samt verklig capture och jämförelsefacit.
Acceptans: en fysisk bricka ger korrekt lokalt resultat utan internet och
exakt en varaktig servereffekt efter återanslutning. Först därefter fler korttyper.

H1 är en tidig beroendekontroll; H2 är ett villkor för verklig pilot, inte en
funktion som kan skjutas bakom obegränsat många UI-förbättringar.

### Etapp C: import, återställning och första fältpilot

**C1. Eventor för ett helt individuellt lopp.**
Status 2026-09-22: TASK098/ADR-0114 har redan levererat en syntetiskt
verifierad Testeventor-deltagarimport till ett förberett individuellt lopp,
med explicit klassmappning, atomisk commit, exakt retry och spärr mot att
skriva över lokala rättningar. TASK101/ADR-0116 har dessutom en separat
produktionsprofil för read-only import. Det enda återstående beviset före
produktionsanspråk är ett ägarstyrt liveprov med en ny privat credential;
använd aldrig en tidigare delad nyckel. Eventor-skrivning är fortsatt ett eget
senare snitt.

Terra bygger först Testeventor-anmälningar till befintligt importförslag, sedan
en granskad produktionsläsning. Sol granskar endast hemlighets-/konfliktgränsen.
Acceptans: återimport skapar inte dubbletter eller skriver över lokala rättningar
tyst. Därefter separat explicit start-/resultatuppladdning med förhandsgranskning.
Exportfil är en fungerande mellanväg; skarp uppladdning kräver godkänt mål/intent.
Den tidigare delade riktiga API-nyckeln ska aldrig skrivas in i planen, argv eller UI.

**C2. Enkel drift och bevisad återställning.**
Terra utgår från befintlig Node-/PostgreSQL-miljö. Dokumentera start/stopp,
konfiguration och en samordnad backup av faktiskt använd DB/objektlagring.
Återställ i separat miljö och verifiera en hel tävlingskedja, inklusive journaler
och fryst resultat. Komplett tävlingsarkiv levereras som nästa tydligt avgränsade
del. ADR-0140 väljer en tillfällig, skrivstoppad och versionsbevarande
source-to-empty-target MinIO-resync per backup-id; den är ännu inte implementerad
som writer eller driftsatt. Ingen HA-plattform, Kubernetes eller generell
driftprodukt behövs.

**C3. Fältpilot: 30–100 deltagare, två banor.**
Kräver H2 och C2 samt de operativa A/B-flöden som piloten behöver. Prova blandad
fri/minutstart, direktanmälan, klassbyte, okänd/hyrd bricka, nätavbrott,
startavprickning, återkomst, skogsrapport och slutresultat. Använd riktiga mobiler
och en verifierad SI-station. Jämför resultat med oberoende facit; dokumentera
skillnader, antal förlorade/dubbla poster och kö efter synk. Detta ger större
värde än ytterligare breda syntetiska omkörningar. Använd inte systemet ensamt
på större officiell tävling innan flera relevanta fältfall är verifierade.

### Etapp D: fullare individuell produkt och MeOS-likvärdighet

Efter en stabil kärnkedja prioriteras följande utifrån funktionsmatrisen:

- Operativ administratörstilldelning i webben och smidigare inloggning; återanvänd
  befintlig roll och behåll begränsade start-/mål-/stationsroller.
- Vakanser, startluckor, klubbseparation/seedning och gruppändringar där behovet är
  konkret. Hyrbrickåteranvändning och enkel betald/obetald-status före fakturering.
- PM och kartsläpp som färdiga användarflöden. TASK013:s publiceringsspärr får inte
  döljas; om dess teknik ska förenklas behövs en ADR med ett konkret enklare alternativ.
- Speakerhändelser, radio/mellantider och följning av utvalda löpare.
- Avancerade tävlingsformer i egna domänsnitt: först önskat format, sedan nästa.
  Stafett/gaffling, patrull, poängorientering, flerdagars/jaktstart och kval/final
  är en synlig restlista, inte borttagna mål.
- V2:s egna kartor, GPX och fler-ruttvisning följer sin separata plan. Återanvänd
  tävlings-/resultatidentiteter; inga Livelox-data eller kopierade gränssnitt.

Full MeOS-likvärdighet får inte deklareras förrän matrisens relevanta arbetsflöden
har egen implementation och acceptans. Exakta framtida datum kan inte sättas
trovärdigt innan hårdvaruunderlaget och första piloten är klara.

## Agentupplägg och kostnadskontroll

| Roll | Förstahandsmodell | Uppdrag |
|---|---|---|
| Huvudagent/integratör | `gpt-5.6-terra`, medium | Avgränsa snitt, äg beroenden/kontrakt, integrera och redovisa. |
| Enkel UI-/dokumentdel | `gpt-5.6-luna`, low eller medium | Tydligt specificerad komponent, svensk text, tabell/utskrift, dokumentation. |
| Svår domän-/protokolldel | `gpt-5.6-sol`, medium; high vid konkret behov | SPORTident, konkurrens, offlineförlust och ändrade resultatregler. |

Detta modellval följer briefens agentfördelning. OpenAI beskriver Terra som
allroundval, Luna för tydliga uppgifter och Sol för mer komplex analys; lägre
resonemangsnivå bör användas när den räcker. Se
[officiell modelldokumentation](https://learn.chatgpt.com/docs/models).
Inga nya modellinställningar eller abonnemang har ändrats i genomgången.

- Normalläge: huvudagent + högst en arbetande agent. Två arbetande agenter endast
  när uppgifterna är oberoende, till exempel avgränsad UI-del och hårdvaruunderlag.
- Ingen agent för varje knapp, filterräknare eller dokument. Huvudagenten gör små
  ändringar själv. Samla relaterade förbättringar till ett användbart arbetsflöde.
- Ge agenten mål, tillåtna filer, låst kontrakt, acceptans och ett kort svarformat.
  Skicka inte hela denna långa konversation; använd en kort överlämning.
- En ägare per schema/resultatmotor/gemensam adminkomponent. Ingen parallell
  redigering av samma filer eller skrivning i samma testdatabas.
- Granskning ska svara på en konkret risk. Undvik återkommande allmänna auditvarv.
- Extrahera en panel eller hjälpfunktion när nästa produktändring behöver det.
  Den 2519 rader långa adminfilen motiverar lokal uppdelning, inte en stor
  förhandsrefaktorering eller ett nytt generellt formulär-/permissionsramverk.
- Uppdatera en kort status efter varje leverans med faktiskt resultat och nästa
  steg. Undvik att återberätta hela projektet eller duplicera samma loggar.

## Lagom tester och definition av klart

| Ändring | Normal miniminivå |
|---|---|
| Text/layout/sökning över befintligt underlag | Berörd lint/typecheck och en relevant visuell/browserkontroll. Inga nya serverprov om serverbeteendet är oförändrat. |
| Ny läsprojektion | Kontrakt och ett representativt PG-fall, samt ett browserfall om flödet ändras. |
| Deltagar-/tävlingsmutation | Lyckat flöde, ett relevant konfliktfall och retry/versionsbevarande där de påverkas; ett genomgående browserfall. |
| Resultatregel | Rena domänfall som skiljer de faktiska utfallen, plus en lagrings-/revisionskontroll. |
| Rådata/offline/protokoll | Riktade dataförlust-, retry-, avbrotts- och parserfall samt fysisk verifiering. Här ersätter inga UI-prov kärnkraven. |

Under implementation körs relevanta små tester. Vid överlämning av ett helt
snitt körs lint, typecheck, relevanta tester och build för berörda paket en gång
efter sista ändringen. Full workspace-/bred integration körs vid samlad
releasekandidat eller konkret ändring över flera centrala lager, inte efter
varje liten UI-rättning. Kör inte om redan gröna oförändrade delar av rutin.

Återanvänd befintliga browserflöden men undvik att fortsätta stapla alla nya
uppgifter på en allt längre testkedja. Välj ett relevant arbetsflöde per snitt.
PG-prov kräver uttryckligen isolerad databas. `.next-demo-test` och samma
databaswriters körs sekventiellt. Inga tester på privat demo eller riktig tävling.

Redovisningen ska ange exakt kommando, exitkod och antal körda/passerade tester,
vad som inte körts och varför. En halvfärdig kodändring eller en simulator får
inte beskrivas som färdig funktion respektive verkligt hårdvarustöd.

## Startinstruktion att klistra in i nästa tråd

> Läs AGENTS.md, CODEX_BRIEF.md och de obligatoriska arkitekturdokumenten enligt
> projektinstruktionerna. Läs sedan
> docs/product-goal-roadmap-2026-09-23.md och docs/meos-feature-matrix.md;
> använd denna äldre genomgång enbart för detaljer och historiskt läge.
> Kontrollera först aktuell arbetskopia och eventuellt pågående TASK149 utan
> att kalla det färdigt på tidigare enhetstester. Välj därefter målplanens
> nästa minsta snitt: en ADR och TASK för arrangörskonto, eventägarskap och
> övergången från kortlivade credentials. Implementera bara inloggad arrangör
> → skapa tävling → öppna den från ”Mina tävlingar”; medadministratör,
> deltagarkonto och GPS är senare snitt. Bevara teknikval, rådata, idempotens,
> offlineväg och resultathistorik. Använd isolerad PostgreSQL för varje ny
> serverwriter och riktade tester i proportion till risken; aldrig demo- eller
> privat tävlingsdata som testmål. Hårdvaruspåret kräver underlaget i ADR-0007.

## Kvarvarande osäkerhet

TASK135:s isolerade PostgreSQL- och browseracceptans är körd med syntetiskt
underlag; fysisk
mobil/skrivare/SI-utrustning, långvarig batteri-/offlinefunktion,
produktions-Eventor, produktionsdrift och återställning är inte verifierade här.
Funktionsmatrisen är en första produktinventering, inte en fullständig testning
av varje MeOS-inställning. Dessa skillnader ska behållas synliga i nästa tråd.
