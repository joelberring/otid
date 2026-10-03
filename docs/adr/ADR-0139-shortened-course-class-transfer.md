# ADR-0139: avkortad bana flyttar valda deltagare till en separat kortklass

- Status: Accepterad för TASK135, implementation pågår
- Datum: 2026-09-22

## Kontext

ADR-0113 och TASK097 spärrar medvetet att förkorta en resultatbärande klass
genom den vanliga banrättningen. En kortare kontrollföljd i samma klass skulle
göra både publik ranking, IOF-export och Complete-finalisering tvetydiga: den
nuvarande rena rankingen avvisar redan olika banversioner inom en klass.

En ny per-entry-banvariant skulle dessutom kräva nya varianter i stationpaket,
resultatmotor, alla publika projektioner och IOF-finalisering. Det är ett större
domänspår än den operativa uppgiften att låta en begränsad grupp löpare avsluta
på en tydligt kortare bana. O-Tid har redan immutable Course/CourseVersion,
race-scopeade klasser, entry-klassbyte och append-only resultatrevisioner.

## Beslut

TASK135 inför en enda `MANAGE_RACE`-skyddad, explicit **avkortad kortklass**:

1. Operatören väljer en aktuell klass och en strikt, icke-tom kontrollprefix av
   dess aktuella bana, plus nya, unika namn för kortbana och kortklass.
2. Commit skapar en ny lokal `Course`, dess immutable version 1 och en ny lokal
   `Class` med samma startregel som källklassen. Källobjekten och deras externa
   identiteter muteras aldrig; den nya kortklassen har ingen Eventor-/IOF-
   importidentitet.
3. En explicit, begränsad mängd Entries flyttas atomiskt från källklassen till
   kortklassen. Aktiv brickkoppling och `FIXED`-starttid bevaras. Den nya
   klassen har ingen platsbegränsning i första snittet och kan inte användas
   för direktanmälan genom denna väg.
4. En vald Entry utan någon resultatrevision flyttas endast. En vald Entry med ett
   aktuellt, publicerat `CARD_READOUT`-orsakat `MP` mot exakt källbana och bevarad
   `readoutId` utvärderas på nytt med samma oförändrade readout mot kortbanan;
   detta skapar en ny append-only `SHORTENED_COURSE_CLASS_TRANSFER`-revision.
   Den nya revisionen publiceras atomiskt och blir därmed det effektiva
   resultatet för den flyttade Entry:n. Resultatet kan bli `OK` eller kvarstå
   som `MP`, men ingen punch, tid eller status fabriceras. `OK`, manuella
   overlays, okänd källa eller stale grund är inte valbara i första snittet.
5. Kort- och långbana är skilda klasser. De rankas, visas, exporteras och
   finaliseras därför aldrig mot varandra. En äldre finalisering är immutable;
   en senare officiell lista kräver vanlig ny racefinalisering.

En Entry som flyttas utan resultat får ingen fabricerad DNS, DNF eller
resultatrevision. Den gör därför, enligt befintlig coverage-regel, en ny
racefinalisering/Complete omöjlig tills den har ett verkligt kvalificerat
resultat eller ett separat, uttryckligt manuellt beslut. Detta är synligt i
preview och kvittens och är inte ett fel som writer får dölja.

Beslutet, varje entry-item, källans versioner/readout/revision, canonical
basis-hash, aktör, request-id, skapade class/course-id:n och eventuella nya
revisioner sparas i en ny immutable header/items-journal. Hela operationen
låser lopp och berörda entries, är all-or-nothing och använder exakt replay
för samma aktör och intent.

## Konsekvenser

- Den befintliga klassrankingen och IOF-adaptern får fortsätta använda en
  historisk klass per revision; de behöver ingen dold rankinggrupp eller
  per-person Course-fallback.
- Ett nytt stationspaket efter commit innehåller de flyttade Entries i deras
  nya klass och använder den etablerade lokala resultatmotorn. Äldre paket och
  rådata skrivs inte om.
- För `FIXED` måste varje flyttad Entry redan ha en giltig, exakt millisekund-
  starttid; den kopieras utan ändring. För `PUNCH` måste fixed-startfältet vara
  null. Ingen slot reserveras, skapas eller byts i denna väg.
- Befintlig explicit startlistepublicering är fortsatt fryst: kortklassen blir
  inte automatiskt publicerad. Arrangören gör en ny medveten publicering om
  den ska visas i en startlista.
- En lokal kortklass har null extern identitet. IOF-projektionen använder dess
  sparade lokala klassnamn utan påhittat klass-id och behandlar den som egen
  ClassResult; en fixture måste visa lång- och kortklass separat. En senare
  Complete-finalisering använder samma redan etablerade class-gräns.
- Kartgeometri, publik rutt, Eventor-synk, direktanmälan till kortklassen,
  återtagande av beslutet, fler prefix eller blandad ranking omfattas inte.
  En felaktig senare administrativ åtgärd måste vara en ny append-only
  operation; denna writer raderar eller skriver aldrig om historik.

## Migrations- och återställningsnot

En eventuell migration ska vara additiv: `SHORTENED_COURSE_CLASS_TRANSFER` i
resultatens enum/kontrakt, nullable proveniensreferens i resultatrevision,
immutable header/items och reciproka foreign keys/constraints som binder race,
source class/course version, source revision/readout, skapade lokala objekt och
eventuell skapad revision. Varje versionerad contract- och
stored-result-proveniensunion som i dag räknar tekniska revisionsorsaker ska
utökas fail-closed och läsprojektioner måste validera journalbeviset innan
publik resultat, IOF, speaker eller finalisering använder revisionen.

Request-id är globalt unikt för journalhuvudet. Exact replay måste jämföra
race, actor, source class/course, prefix, namn, sorterad entrygrund, hash och
alla sparade skapade id:n/revisions-/publiceringsvärden innan samma receipt
returneras. Ny commit låser race, alla valda Entries och deras aktuella
resultathuvuden; den binder snapshot, entryversioner, source revisions-/
readout-id:n och source class/course till basis-hashen. Ingest, omräkning eller
manuellt beslut som vinner före commit gör den nya requesten till konflikt utan
delwrite. Finalisering serialiseras via samma race-lås: vinner den först
förblir dess gamla XML immutable, medan en senare kortklassoperation skapar
nytt aktuellt underlag som kräver en ny finalisering. Rollback är att stänga route/UI och rätta framåt
eller återställa verifierad backup; enumvärde, journal, CourseVersion, Class,
Entry-ändring eller revision tas aldrig bort.

## Återställning

TASK097:s prefixspärr för vanlig banrättning finns kvar. ADR-0139 kan bara
ändras av ett nytt ADR som hanterar återtagande, per-entry-varianter eller
gemensam ranking med egen fullständig export-/finaliseringspolicy.
