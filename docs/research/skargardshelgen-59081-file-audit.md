# Skärgårdshelgen, lång – lokal filgranskning

Granskat 2026-09-05. Användaren angav Eventor-id 59081 och två lokala XML-filer.
Endast läsningar utfördes. Inga personrader eller originalfiler kopierades till
repositoryt, inga API-nycklar användes och ingen databasimport genomfördes.
Tävlingssidan kunde inte läsas med webbläsverktyget; identiteten nedan kommer
från filernas Event-element, inte från en verifierad API-läsning.

## Underlag och reproducerbarhet

Filerna anger Event/Id 59081, namnet Skärgårdshelgen, lång och datum
2026-08-23. Båda deklarerar IOF XML 3.0.

| Fil | SHA-256 | Innehåll |
| --- | --- | --- |
| L_Resultat.xml | 2fa733af5e7d0a7b74772aaa26f9aa3134ac600d25955247bb0ea00022df4942 | ResultList, 37 klasser, 228 personposter |
| startlista lång 260820 | 2de57d2ad026bdd6f21fcf3fa877f1cd4e1ce2f06ecf546e5fe5af7f10b98cf3 | StartList, 38 klasser, 221 personposter |

`xmllint --nonet --noout --schema` gav exit 0 för båda originalen mot samma
lokala IOF-XSD-kopia som tidigare användes i TASK 006T. Kopians SHA-256 är
9d00abaea14ba4bedfae910d68a01506c097a57c29b0492c49abb19034ae90a1.
Tidigare källpinning finns i iof-data-standard-3.md; ingen ny nedladdning eller
hashjämförelse mot upstream gjordes i denna granskning.

## Faktisk kompatibilitet med nuvarande O-Tid

- StartList har 221 PersonStart, samtliga med Person/Id men ingen med EntryId.
  Endast 70 har Start/StartTime; 151 saknar angiven tid. Ingen klass är tom.
- Nuvarande `parseIofXml` avvisar startlistan med 523 valideringspunkter:
  221 för EntryId och 302 för StartTime (två kontroller för varje saknad tid).
  XSD-giltighet betyder alltså inte stöd av O-Tids snävare importkontrakt.
- ResultList avvisas av importören eftersom ResultList-import inte ingår i
  dess stödda rottyper. Resultatexport är en annan funktion.
- Resultatfilens statusfördelning: OK 184, DidNotStart 22, MissingPunch 17,
  DidNotFinish 4, Cancelled 1. Sex av 228 personposter saknar Person/Id;
  ingen har EntryId. Filen är märkt Complete, men täckning mot en auktoritativ
  slutlig anmälningslista har inte bevisats av denna granskning.
- Skillnaden i antal klasser/personposter mellan filerna är observerad, inte
  förklarad. Ingen namnbaserad matchning eller automatisk identitetskonvertering
  utfördes. Person/Id är inte automatiskt samma identitet som en anmälans EntryId.

Första parserförsöket via tsx-CLI stoppades av sandboxens IPC-listen-begränsning
(exit 1). Samma läsning via `node --import tsx --input-type=module` slutfördes
(exit 0) och gav de redovisade kontrollerade importavvisningarna.

## Nästa underlag, inte nytt stöd genom gissning

### Användarförtydligande: fria starttider

Användaren har efter granskningen förtydligat att fria starttider förekommer.
De 151 posterna utan StartTime ska därför inte beskrivas som felaktigt
tävlingsunderlag. Avvisningen ovan är en begränsning i O-Tids importkontrakt
för fasta starttider (ADR-0025), inte ett XSD-fel.

Den befintliga resultatmotorn skiljer redan mellan `FIXED` och `PUNCH`:
`packages/domain/src/evaluate-card-readout.ts` väljer `readout.startPunchedAt`
för PUNCH och `entry.fixedStartTime` för FIXED. Det är dock inte belägg för
att varje saknad XML-tid automatiskt ska ändra klassregeln till PUNCH.
Förtydligandet specificerar inte klassvis vilka regler som gäller eller vad
de 70 angivna tiderna betyder. Detta behöver säkerställas före import som
ändrar startregler; ingen tid fylls i och ingen regel ändras i granskningen.
Avsaknaden av EntryId är en separat identitetsfråga och påverkas inte av fri start.

Uppföljande lokal aggregatkontroll (Node/fast-xml-parser, exit 0) visar att
12 klasser har tider för samtliga sina deltagare och 26 klasser saknar tider
för samtliga; ingen klass blandar poster med och utan tid. Class innehåller
bara Id och Name, ingen uttrycklig startmetod. StartName är `Start 1` för 37
klasser och saknas för en; etiketten skiljer inte startmetoderna åt.
Detta preciserar vilka uppgifter filen innehåller, men bevisar inte att
angivna tider ska användas som fasta resultatstarter. Inga personrader skrevs ut.

EntryList och CourseData för samma tävling behövs för att pröva befintlig
tävlingsimport och säkra identitets-/bankopplingar. Resultatfilen kan användas
som jämförelseunderlag; den får inte omvandlas till fabricerade råavläsningar.
Eventuell utvidgning av StartList-mappning behöver en uttrycklig identitetspolicy
och ADR före implementation. Det autentiserade Testeventorprovet i TASK 006V
är fortsatt en separat, ej verifierad acceptanspunkt.

## Kompletterande ban- och tävlingsfiler

Användaren tillhandahöll senare `langen.Courses (1).xml`, `lång 260819.meosxml`
och `helgen.omap`, samt bekräftade att fri start och minutstart kan blandas
i samma tävling. Ingen klassvis startregel har därmed automatiskt importerats.

- CourseData: 13 banor, 45 kontrollobjekt och 47 klass-/bankopplingar.
  Event har namn men saknar Id. Samma lokala XSD-kontroll ger exit 0.
  Nuvarande importör ger 13 fel, samtliga för saknat Course/Id. Filen använder
  CourseName för klasskopplingarna. Detta är en importbegränsning, inte XSD-fel.
- MeOS-datafil: 48 klasser, 13 banor och 221 deltagare; inga team eller kortposter.
  Filen är inte en IOF EntryList. Endast exporterad data granskades, ingen
  MeOS-källkod. Kontakt-/persondata kopierades inte till repositoryt.
- OMAP: XML-kartfil identifierad. Ingen rendering, publicering, extern
  referenshämtning eller kartimport genomfördes.

### Exakt namnkontroll, inte beslutad identitetsmappning

Node-kontrollen jämförde exakta strängar utan fuzzy matching och gav exit 0:

- Alla 13 bannamn överensstämmer mellan CourseData och MeOS-filen.
- Inga dubbla bannamn i CourseData, dubbla klassnamn i MeOS eller dubbla
  klassnamn bland CourseData-kopplingarna observerades.
- Alla 47 CourseData-kopplingar refererar en befintlig bana.
- Alla 38 startlisteklasser finns med samma namn i MeOS-filen.
- Samtliga MeOS-deltagare refererar en befintlig MeOS-klass.
- **Blå 3,0**, med 10 deltagare, saknar klass-/bankoppling i CourseData,
  Course i MeOS-klassen och Course i StartList. Övriga startlisteklasser
  har klassnamn som förekommer i CourseData-kopplingarna.

Likadana namn är kandidater för en granskad koppling, inte stabila externa
identiteter. Ingen intern UUID eller extern person-/anmälningsidentitet har
skapats eller härletts här. Innehållslikhet mellan banornas kontrollföljder
har inte verifierats av namnkontrollen.

Första kombinerade parserförsöket kördes från application-workspacet och
gav exit 1 eftersom fast-xml-parser inte är ett direkt beroende där.
Omkörning från iof-xml-workspacet gav exit 0 och den kontrollerade
importavvisningen ovan. Inga beroenden installerades eller ändrades.

### Avgränsad fortsatt importplan, ännu inte ett accepterat ADR-beslut

1. Klarlägg om Blå 3,0 ska ha en bana och vilken. Importen får inte tyst
   välja närmast liknande bana eller hoppa över dess tio deltagare.
2. Dokumentera i en ADR hur namnrefererade banor binds till stabila,
   race-avgränsade externa referenser och interna UUID:n. Första import,
   exakt retry, namnbyte och kolliderande namn måste ha uttrycklig policy.
3. Anpassa CourseData-import som ett separat vertikalt snitt: granskad
   klass-/bankoppling, atomisk lagring, idempotens och avslag vid tvetydighet.
   Tester behöver täcka saknat Id, dubbla namn, okänd bana, namnbyte,
   retry och rollback i PostgreSQL. Befintliga ID-baserade importer ska bestå.

MeOS-import, anmälningsidentitet och blandade startmetoder är separata
beslut, inte en automatisk utvidgning av denna banimport. ADR-0025:s befintliga
StartList-policy ändras inte av denna plan. Resultat, råavläsningar, kartor,
stafett, GPS och hårdvarufunktioner ligger utanför snittet.

## Tillstånd för privat testtävling och senare uppgift om Blå 3,0

Användaren har uttryckligen tillåtit tävlandes riktiga namn i en testtävling.
Detta avser privat testdata, inte publicering eller incheckade personfixtures.
Ingen testimport har ännu genomförts.

Uppföljande läsning av ResultList (Node, exit 0) visar att Blå 3,0 där har
13 personposter och Course med Id `14`, Name `Blå 3,0`. Den tidigare slutsatsen
om saknad bankoppling gäller alltså förhandsfilerna, inte resultatfilen.
Resultatfilens bankoppling ersätter dock inte en fullständig banbeskrivning:
den motsvarande banan finns inte bland de 13 CourseData-banorna. Resultatets
kontroll-/sträcktidsrader får inte automatiskt bli en auktoritativ CourseData
eller fabricerade råavläsningar. Kompletterande CourseData för denna bana
behövs för en komplett testtävling utan gissad kontrollföljd. Skillnaden
10/13 personposter mellan tidpunkterna är inte utredd.

## Genomförd privat testkopia utan Blå 3,0

Användaren bad därefter att Blå utelämnas. ADR-0047 dokumenterades före
preparering och databaswrite. Tidigare blockerande behov av dess bana gäller
därför inte denna uttryckligen avgränsade testkopia.

Privat arbetskatalog: `/private/tmp/otid-59081-private.w7b1DU` (0700).
Härledda XML, manifest och kvittenser har 0600. Preparering och import ligger
i lokala `prepare.mjs` respektive `import.mjs`, inte i produktionskod eller
publika fixtures. Källfilhashar och härledda filhashar finns i manifestet.

Prepareringen gav exit 0: 211 deltagare, 37 klasser, 13 banor, 209 brickor,
12 tidsatta klasser/70 tider, 25 PUNCH-klasser/141 deltagare. Namnfält och
ordnade bankontrollkoder jämfördes med källan. Alla tre härledda IOF-dokument
godkändes av befintlig parser och lokal XSD. Båda scripts klarar `node --check`.

Ny isolerad PostgreSQL-databas: `otid_59081_private`, loopback port 55432.
Befintliga migrationer kördes med exit 0. Autentiserat manuellt skapande
och tre autentiserade importer gav exit 0. Ingen Eventoranslutning användes.

- Event: `c7c98512-0c52-497e-8376-220dafed67fd`.
- Race: `36adbd07-9b72-4e2e-a358-6f5920ffd9b9`.
- Verifierade lagrade antal: 211 entries, 37 klasser, 13 banor,
  209 brickkopplingar, tre importfiler och 70 fasta starttider.
- Exakt skapanderetry och samtliga tre importretry verifierades utan nya
  objekt eller snapshotökning. Lagrade namn/klubb/tider jämfördes med importen.
- Noll råmeddelanden, kortavläsningar, resultatrevisioner och startpubliceringar.
  Publik startlista/XML gav `not-found`; publik resultatprojektion var tom.
- PostgreSQL stoppades efter kontrollen; data behålls på disk. Ingen webbserver
  startades och inga credentials skrevs ut eller sparades i rapporten.

Ny kompletterande karta `Nåttarö_justerad karta260713.omap` identifierades som
XML; SHA-256 `0779a5042675e61e821e4de8aca7ec3892323418707ba694f73841d3c13375cb`.
Den har inte importerats, renderats eller publicerats och inga externa
kartreferenser har hämtats. Originalfilerna är oförändrade.
