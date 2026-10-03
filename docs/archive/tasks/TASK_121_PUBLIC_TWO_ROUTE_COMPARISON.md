# TASK121: publik jämförelse av två exakta deltagarrutter

Status: implementerad och riktat verifierad enligt ADR-0131.

## Användarvärde

Efter tävlingen kan besökaren välja två deltagare och se deras redan godkända
rutter ovanpå samma historiskt korrekta bana och karta.

## Avgränsning

- Exakt två olika publika resultat i samma lopp.
- Samma historiska course-version, samma map-manifest och samma georeferens.
- Läsbart svenskt 390px-läge med två färgskilda pixelbanor och gemensamma
  kontrollmarkörer.
- Ingen migration, writer, ny publication eller samtyckesväg.

## Acceptans

1. Två kompletta, samtyckta och släppta rutter med samma historiska underlag
   visar två banor och gemensamma kontrollmarkörer utan intern-/WGS84-data.
2. Samma id två gånger, borttaget samtycke/release, olika karta, georeferens
   eller historisk bana samt saknad geometri avvisas fail-closed.
3. Resultatlistans lokala val navigerar till den publika jämförelsen utan att
   skriva serverdata. GPS-live, passagetider, uppspelning, tempo, analys,
   OMAP och fler än två rutter ingår inte.

## Genomförande

- Application-lagret återanvänder TASK120:s effektiva publicerade
  resultathuvud, samtycke, release, karta, georeferens och kontrollgeometri i
  en låst lästransaktion för båda sidor. Det jämför därefter exakt historisk
  course-version, map-manifest och georeferens; minsta avvikelse ger
  `not-found`.
- Det publika kontraktet kräver två olika opaque resultatidentiteter och
  lämnar endast två pixelbanor, härledd metadata och gemensamma
  kontrollmarkörer. Ingen intern identitet, hash eller WGS84 serialiseras.
- Resultatlistan håller som mest två val endast i browserns komponentstate och
  länkar sedan till den skrivfria jämförelsevyn. Vyn ritar röd och blå rutt
  med kontrollmarkörer i ett 390px-anpassat SVG-läge.
