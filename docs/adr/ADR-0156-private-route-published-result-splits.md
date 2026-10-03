# ADR-0156: publicerade resultatsträckor bredvid egen privat rutt

- Status: Accepterad för C3b/TASK163 före implementation
- Datum: 2026-09-23

## Kontext

ADR-0149/0155 ger en kontoskyddad, versionsbunden privat pixelrutt och
relativ GPX-uppspelning. Kontrollringar på kartan är historisk banlayout,
inte bevis för GPS-passage. Den publika resultatprojektionen härleder redan
sträcktider från en effektiv, publicerad resultatrevision; ADR-0133 använder
samma proveniens i en separat publik jämförelse. En deltagare ska kunna läsa
dessa fakta intill sin egen rutt utan att två olika mätkedjor blandas ihop.

## Beslut

Den befintliga skyddade overlay-läsningen får en kompakt,
**oberoende** `resultSplits`-projektion och formatversion 3. Den använder
endast det aktuella effektiva publicerade resultathuvudet för **exakt samma
race och entry** som den valda privata ruttversionen. Den befintliga
kontogrinden, aktiva anmälningskopplingen, race-låset och kravet på samma
historiska banversion gäller oförändrat. Om resultathuvudet saknas, är av
annan kurs, inte är `OK`, saknar totaltid eller saknar sträcktider returneras
`UNAVAILABLE`; inget äldre resultat eller GPX-värde används som reserv.

`AVAILABLE` innehåller resultatrevision, kontrollkod, förekomst,
sträckmillisekunder och ackumulerade millisekunder från den strikt validerade
resultatprojektionen. Ingen råstämpling, start-/måltid, intern entry-/resultat-
UUID, WGS84, lagringsreferens eller ny publik länk ingår. Den aktuella
effektiva revisionen kan ändras efter en explicit resultaträttning; läsningen
är `no-store` och anger därför inte att den är en fryst slutlista.

Vyn märker avsnittet **”Resultatets publicerade sträcktider”** och kan visa
revisionen. Den visar tiderna i en kompakt expanderbar lista, skild från
GPX-reglage och kartmarkör, med text om att publicerade resultat kan vara
preliminära och att GPX-markören inte visar verifierade kontrollpassager.
Inga tider justerar uppspelningen, ingen passage härleds ur koordinater
och ingen `Complete`-/finaliseringsstatus antas.

Detta är ingen ny resultatregel, skrivväg, migration, behörighet, GPS-synk
eller ruttpublicering. Server- och klientkontraktet höjs tillsammans i samma
Next-leverans; äldre format avvisas neutralt av strikt klientvalidering.

## Verifiering och konsekvenser

Riktade kontraktsprov kontrollerar `AVAILABLE`/`UNAVAILABLE`, revision och
att GPS-/internfält inte kan injiceras. Ett isolerat PostgreSQL-prov visar
exakt entry och effektiv revision samt `UNAVAILABLE` för saknade/icke-OK
sträckor; revokerad eller annan ägare förblir nekad. Ett 390px-browserprov
kontrollerar listan, provenienstexten och frånvaro av koppling till
GPX-reglaget. Berörd lint, typecheck och build körs. Detta är syntetisk
verifiering, inte fysisk mobil-, kartprecision-, GNSS- eller fältacceptans.
