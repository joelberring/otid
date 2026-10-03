# TASK119: privat grund för versionsbunden kontrollgeometri

Status: implementerad och riktat verifierad enligt ADR-0129.

## Användarvärde

Arrangören kan lagra och kontrollera de faktiska kontrollpositionerna för en
exakt banversion och en exakt rasterkarta, så att framtida banpåtryck aldrig
behöver gissa från rutt eller kontrollkod.

## Avgränsning

- Additiv immutable geometrijournal för kontrollförekomster på exakt
  course-version och exakt map-manifest.
- Privat `MANAGE_RACE`-administration för att spara och läsa ett explicit
  geometriunderlag.
- Pixelpositioner kan anges manuellt mot samma exakta rasterbild; inga
  koordinater härleds ur GPS-rutt eller OMAP.

## Acceptans

1. Geometri kan bara knytas till kontrollförekomster som faktiskt tillhör den
   valda course-versionen och till en karta i samma lopp.
2. Nytt eller ändrat underlag skapar en ny immutable revision; retry med samma
   request återger samma revision och ändrat intent ger konflikt.
3. Fel race, fel course-control, dubblett ordning, saknad position eller
   ändrad expected revision avvisas utan delskrivning.
4. Privat vy är kompakt vid 390 px och innehåller inga GPX-rutter, objektlager-
   eller hemliga uppgifter. Ingen publik bana eller ruttöverläggning införs.

## Genomförande

- Migration0072 skapar immutable geometrihuvuden och punktposter, med
  sammansatt FK till exakt kontrollförekomst och banversion.
- Den privata `MANAGE_RACE`-routen resolverar kontroller från servern och
  sparar bara en komplett, atomisk positionsuppsättning.
- Kartsidans svenska panel använder inga publika map-/routevägar och lämnar
  ingen geometri till publikresultatet.
