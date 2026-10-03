# ADR-0113: avkortad bana är en separat resultatform, inte en banrättning

- Status: Accepterad för TASK097
- Datum: 2026-09-19

## Kontext

En arrangör kan behöva låta deltagare springa en kortare banvariant, till
exempel vid omstart eller när ett banparti tas ur bruk. Den officiella
MeOS-dokumentationen beskriver avkortade banor som separata banvarianter och
att kortvarianten placeras efter långvarianten; den används här endast som
användarbehov, inte som kod- eller modellkälla.

O-Tid har redan en immutable omlänkning av en manuell klass till en ny
`CourseVersion` (TASK084) och en explicit omräkning (TASK091). Det är däremot
inte en avkortningsmodell. Resultatmotorn tillåter extra stämplingar för ett
kortare förväntat kontrollprefix, och rankar `OK`-resultat med samma
`courseVersionId` tillsammans. En omräkning av både full- och kortbanerunners
till samma prefixversion skulle därför kunna skapa en falsk gemensam ranking.
Flera banversioner är i dag i stället medvetet orankbara.

## Beslut

Avkortad bana ska inte uttryckas som en vanlig TASK084-omlänkning med en
kortare kontrollföljd när klassen har resultathistorik. TASK097 spärrar den
osäkra **strikta prefixomlänkningen**: en föreslagen kontrollföljd som är ett
icke-tomt, kortare exakt prefix av klassens aktuella kontrollföljd. Befintlig
banrättning för andra explicita rättningar ändras inte.

En framtida avkortningsfunktion måste vara ett separat resultatsnitt. Den ska
minst ha immutable variantbeslut, tydlig entry-/resultatkoppling, en uttrycklig
rankingpolicy mellan lång och kort variant, och en fryst export/finaliserings-
policy. Den får aldrig gissa variant från saknade stämplingar eller ersätta
rådata. Fram tills dessa villkor är bevisade ska publicerade blandade
banvarianter förbli orankbara och officiell Complete-export faila stängt.

## Konsekvenser

- Ingen datamodell, migrations- eller resultatrevision ändras i TASK097.
- API:t försvarar spärren och administratörsytan förklarar att avkortning
  kräver ett separat flöde. Det är inte ett nytt stöd för avkortade banor.
- Kontrollneutralisering (TASK092), manuell banrättning (TASK084), explicit
  omräkning (TASK091), tidsrättning, GPS, karta/rutt, stafett och USB ändras
  inte.

## Återställning

Spärren kan stängas av endast genom ett nytt ADR med en implementerad och
verifierad avkortningsmodell. Äldre CourseVersion-, journal- och
resultathistorik ändras eller raderas aldrig.
