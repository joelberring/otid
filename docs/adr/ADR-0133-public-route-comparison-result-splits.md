# ADR-0133: publicerade sträcktider i exakt ruttjämförelse

- Status: Accepterad, implementerad i TASK124
- Datum: 2026-09-21

## Kontext

TASK121–123 visar två historiskt kompatibla GPS-rutter, kontrollmarkörer,
namn och GPX-metadata. Den befintliga publika resultatvyn kan redan visa
kontrollkod, förekomst, sträcktid och ackumulerad tid från samma effektiva
resultatrevision, men jämförelsevyn saknar den kopplingen.

## Beslut

TASK124 får lägga en skrivfri, kompakt resultatsplit-projektion i varje sida
av en redan godkänd TASK121-jämförelse. Den ska alltid härledas från exakt
samma effektiva publicerade resultathuvud som ruttens deltagaridentitet och
historiska course-version kommer från, i samma låsta snapshot.

Endast en `OK`-revision med komplett befintlig publik `elapsedMs` och splits
får exponera `AVAILABLE` med kontrollkod, förekomst, sträcktid och ackumulerad
tid. MP, DNS, DNF, DSQ, OOC, NT, saknad totaltid eller saknade splits ger
`UNAVAILABLE`; inga nollor, uppskattningar, kontrollpassager eller
GPS-interpolerade tider får fabriceras. Kontrollkoder är redan publika i
resultatvyn och måste inte användas som intern identitet.

Svaret får inte växa med position, tid efter, klass, organisation, starttid,
resultatstatus, intern id, hash, WGS84 eller råstämpling. Den visuella texten
måste säga att detta är resultatets sträcktider, inte GPS-verifierade
passagetider.

## Konsekvenser

Besökaren kan jämföra de två rutternas redan publicerade officiella
sträcktider vid kontrollerna utan att systemet påstår att GPX-spåret visar
exakta passagepunkter. Tidsuppspelning, masstart, manuell tidslinjering,
partiella MP-splits, sträcktempo och vägvalsanalys kräver egna beslut.
