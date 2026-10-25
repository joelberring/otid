# ADR-0175: Gafflingar som struktur och bild

Status: beslutad 2026-10-25 (PLAN.md steg 49, ägarens önskemål samma dag). Kompletterar ADR-0169 beslut 2 (gafflingar kan nu
byggas i appen, inte bara komma från IOF XML) och ADR-0171.

## Bakgrund

Gafflingar fanns bara som varianter med hel kontrollföljd från en banfil (ADR-0169 beslut 2). Det gick inte att skapa
en gafflad bana i appen, inte att se hur varianterna hänger ihop och inte att ändra mer än en variant i taget. Ägaren
vill se och redigera gafflingarna visuellt, se dem i resultatlistorna och kunna köra både utjämnade gafflingar och
fulgaffling ("alla sträckor var inte likvärdiga men nästan").

## Beslut

1. **Struktur med Purple Pens begrepp.** En gafflad bana är en grundföljd med gafflingspunkter i följd: enkel gaffling
   (Purple Pen "Fork": 2–4 alternativ mellan två kontroller) och fjäril/slinga (Purple Pen "Loop": 2–4 slingor från en
   central kontroll, tillbaka till den efter varje slinga, i alla ordningar). Ingen gaffling inuti en annan. Domänen
   (`packages/domain/src/course-forking.ts`) genererar varianterna; högst 100 varianter och 26 bokstäver.
2. **Koder i OCAD/Purple Pen-stil.** Bokstäverna delas ut i följd över gafflingspunkterna (A, B; C, D …). En enkel
   gaffling bidrar med det valda alternativets bokstav, en fjäril med slingornas bokstäver i springordning utom den sista.
   Det ger samma koder som banfilerna från OCAD/Purple Pen ("AC", "BD").
3. **Strukturen sparas med banversionen** (`course_version.forking`, migration 0023) och redigeras genom "Redigera bana":
   besked i klartext när resultat ändras och omräkning i samma transaktion. En löpare vars kontrollföljd finns kvar får
   den under den nya koden; en löpare vars kontrollföljd försvinner får en ny variant genom fördelningen (en avläst den
   som stämplingarna passar), med antalet i beskedet. En ändrad enskild variant tar bort strukturen (varianterna
   redigeras då var för sig). En struktur utan gafflingspunkter blir en vanlig bana.
4. **Banor från banfil utan struktur** får en struktur härledd ur varianterna (lika början blir kontroller; en
   återkommande föregående kontroll med samma slingor i alla varianter blir en fjäril; annars en enkel gaffling till
   första gemensamma kontroll). Varje variant är alltid en väg i den härledda strukturen, så bilden fungerar.
   "Gör om till struktur" erbjuds när strukturen klarar reglerna; beskedet säger hur många varianter som tillkommer.
5. **Gafflingssätt per bana** (`course.forking_mode`): Utjämnad (standard; varning när varianterna inte ger samma
   sträckor) eller Fulgaffling (sträckor i enkla gafflingars alternativ är bara en upplysning; fjärilar varnar fortfarande).
   Rättvisekontrollen stoppar aldrig att banan sparas eller används. Längd per variant (`course_variant.length_meters`,
   från banfilens Length) visas med skillnaden mot den kortaste.
6. **Bilden** är egen SVG utan bibliotek (`apps/web/src/lib/forking-diagram.ts` + `components/forking`), från start
   till mål: grenar för enkla gafflingar, kronblad för fjärilar, anmälda och avlästa per gren. Bara färgtoken, så den
   följer sidans tema. Publikt: "Visa gafflingar" i resultatlistan och på deltagarsidan för en gafflad klass, med
   löparens väg markerad och slingornas ordning. Inga interna id i bilden eller svaren.
7. **Sträcktidsanalys per sträcka** (ändrar ADR-0171 beslut 6): en gafflad klass jämförs som standard per kontrollpar
   mellan alla som sprungit det, oavsett variant; per variant är ett val. Vägvalslänkarna finns i vyn per variant.
8. **Kontrollernas lägen** ur IOF XML (`Control/Position`, WGS 84) sparas på kontrollen och startens och målets lägen
   på banan (migration 0023). En variant utan Length i filen får längden ur lägena (storcirkel genom start, kontroller
   och mål; annars `MapPosition` med kartans skala). På vägvalskartan (ADR-0171) ritas den valda löparens bana
   (variant) med sträckans ändpunkter markerade när kartan är georefererad och lägena finns.
9. **Generellt för stafetten.** Struktur, generering, härledning, graf, rättvisa och bild tar varianter och val, inte
   klasser eller löpare, så att stafetten (ADR-0174) kan använda dem.

## Konsekvenser

- Kartlägen (`MapPosition`) sparas inte; de används bara för längden vid inläsningen. Banan ritas bara på vägvalskartan,
  inte på en egen karta i arbetsytan.
- En gaffling inuti en fjäril (eller tvärtom) kan inte byggas i appen; en sådan banfil visas med härledd struktur och
  redigeras per variant.
