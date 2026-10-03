# ADR-0143: publik jämförelse av två eller tre historiskt lika rutter

- Status: Accepterad och implementerad i TASK146
- Datum: 2026-09-22

## Kontext

TASK121–124 och TASK132 ger en nyttig, men avsiktligt strikt, eftertävlingsvy
för exakt två publicerade deltagarrutter. Båda måste ha samma historiska karta,
kalibrering, bana och kontrollgeometri. TASK145 beskriver nu neutralt när två
val inte passerar den grinden.

För ett normalt eftertävlingssamtal räcker det ofta att ställa den egna rutten
mot två andra jämförbara vägval. Att göra den befintliga vyn obegränsad skulle
göra den svår att läsa på mobil, öka antalet samtidiga punktmängder utan en
tydlig gräns och riskera att skapa en generell analysprodukt utan egen regel.

## Beslut

TASK146 får utöka den skrivfria publika jämförelsen från exakt två till **två
eller tre** olika `publicResultId` inom ett lopp.

1. `first` och `second` är obligatoriska; `third` är valfri. Alla identiteter
   ska vara olika. När tredje identiteten saknas ska två-ruttsbeteendet vara
   sakligt oförändrat.
2. Varje vald rutt passerar hela befintliga TASK120-/TASK121-grinden. Samtliga
   ska ha exakt samma `mapManifestId`, georeferens, historiska courseVersion,
   bildmått och kompletta kontrollgeometri. En avvikelse, dubblett eller
   saknat underlag ger fortfarande samma generella 404 utan detaljer.
3. En befintlig två-ruttslänk fortsätter att få DTO-formatversion 2. En
   jämförelse med tredje identitet får formatversion 3 och lämnar en ordnad
   lista om tre redan pixelprojicerade rutter. Det innehåller fortsatt bara visningsnamn,
   pixelpunkter, härledd metadata, relativa GPX-tider och befintliga officiella
   resultatsplits. Inga interna identiteter, hashar, WGS84, objektuppgifter,
   samtyckesuppgifter eller absoluta GPX-tider exponeras.
4. Resultatlistan låter besökaren välja två eller tre rutter och länkar med
   den valda ordningen. Vyn använder textliga etiketter `Röd`, `Blå` och
   `Grön` tillsammans med färg; färg är aldrig ensam identifikation.
5. När tre rutter visas blir deras metadata en kompakt, responsiv lista.
   Officiella splits visas bara när **alla** valda rutter har samma verifierade
   kontrollordning. På smal skärm presenteras varje kontroll som en kompakt
   grupp med textetikett per rutt, inte som en horisontellt skrollande tabell.
6. Den relativa uppspelaren visas endast när varje vald GPX-rutt har komplett
   monoton tidsföljd. Alla börjar vid sin egen relativa nollpunkt; reglaget
   använder längsta varaktighet och en enskild avslutad/gapad rutt döljer sin
   markör. Det är fortsatt inte tävlingstid, GPS-live, kontrollpassage eller
   fartanalys.

## Konsekvenser

- Besökaren får ett naturligt, begränsat tredje jämförelsealternativ utan en
  ny databasmodell, writer, lagring eller extern tjänst.
- Åtkomst, historisk jämförbarhet och fail-closed-integritet blir lika strikta
  för den tredje rutten som för de två första.
- Den befintliga två-ruttslänken fortsätter fungera och har fortsatt samma
  begränsade information och uppspelning.

## Utanför beslutet

Fler än tre rutter, egna urval/listor, vägvals- eller tempoanalys,
kontrollpassager från GPX, gemensam start, GPS-live, mobilinspelning,
FIT/TCX, OMAP, kartaimport, stafett, SPORTident och USB ingår inte.

## Avvisade alternativ

- Obegränsat antal rutter: saknar mobil- och resursgräns och blir en annan
  produkt än en läsbar liten jämförelse.
- Tre rutter med en vanlig sju-kolumners split-tabell på mobil: skulle skapa
  horisontell scroll eller oläsbara tider.
- Att göra tredje rutten frivillig efter en partiell serverläsning: skulle
  dölja att den valda jämförelsen inte är historiskt sann.
