# ADR-0196: Klubbarkivets kartor syns – äldre OCAD, IOF XML 2.0.3, kontroll, bilder och rättigheter

Status: beslutad 2026-11-03 (grenen `kartarkiv-kartor`, migration 0062, ägarens önskemål samma dag). Bygger på ADR-0194
(klubbarkivet), ADR-0179 (kartfilen läses och ritas i webbläsaren), ADR-0189 (kartinnehållet) och ADR-0182 beslut 4.

## Bakgrund

Efter importen av åtta års träningar (OK Älvsjö-Örby) visade många träningar "Kartan kunde inte ritas här". Av 45 unika
OCAD-filer var 29 äldre än OCAD 12 (version 8: 2, 9: 3, 10: 4, 11: 20) och läsaren tog bara 12 och senare. Två banfiler var
IOF XML 2.0.3 och avvisades, och banfilens kort visade "–" i stället för banorna. Ägaren kunde inte se vilka kartor som
fungerar och hittade inte var kartans rättigheter ändras.

## Beslut

1. **OCAD 8–11 läses.** Symbolernas typdelar (linje, yta, punkt, text, rektangel) har samma inbördes ordning i version 8–2020;
   skillnaderna är symbolhuvudets längd (8: 348, 9–10: 572, 11+: 796 byte), beskrivningens kodning, ytsymbolens ritdata (4 byte
   tidigare i 8–11), objektindexet och objekthuvudet (8: 24/32 byte med 16-bitars nummer, 9–11: 40/40, 12+: 40/56) och
   linjesymbolens flaggor (först i 11). Version 8 har färgerna i ett eget huvud och skalan och georeferensen i
   inställningsposten (utan koordinatsystem). Strängar och texter som inte är giltig UTF-8 läses som Windows-1252. Allt beskrivs
   av `OcdVariant` i `packages/map-file/src/ocd/layout.ts`; egen kod efter OCAD:s formatbeskrivningar och kontrollerad mot
   klubbarkivets filer (som inte committas). Version 6–7 ger "OCAD 7 stöds inte. Öppna kartan och spara den i nyare OCAD
   eller i Mapper." `MAP_READER_VERSION` (2) är läsarens version.
2. **IOF XML 2.0.3 CourseData** (utan namnrymd, `IOFVersion` 2.x) mappas vid adaptergränsen till samma modell som 3.0: banor
   och varianter (`CourseVariation`), kontrollkoder i `Sequence`-ordning, längd och stigning, lägen på kartan, skala och klasser.
   Utan `CourseLength` räknas längden ur lägena på kartan och skalan. 3.0 kräver fortfarande sin namnrymd.
3. **Banfilens sammanfattning beror aldrig på kartan.** En sparad sammanfattning utan banor räknas om ur filen när den visas,
   och "Kontrollera alla kartor igen" sparar de nya (bara sammanfattningen skrivs; journalpost `CLUB_ARCHIVE_RECHECKED`).
4. **Kontrollen och bilderna ritas i webbläsaren.** Servern ritar inga kartor (ADR-0179 beslut 2; utskriftsarbetaren skriver
   vektor-PDF och har ingen rastrering). När en ägare eller administratör har arkivet öppet ritas kartversioner som saknar
   kontroll eller kontrollerades med en äldre läsare, högst sex per besök, i kartfilens Worker (högst 2 400 px): varje version
   ger ett besked ("Fungerar · OCAD 11.2" eller läsarens skäl) med en bild på högst 480 px, och träningarna som gjordes på
   versionen får en bild (360 × 240) med den längsta banan. "Kontrollera alla kartor igen" gör om allt med förlopp och kan
   avbrytas; det som hunnit bli klart är sparat. Läsare ser beskeden och bilderna men ritar inte.
5. **Bilderna lagras i egna tabeller, inte i kartinnehållet** (migration 0062: `club_map_version_check` och
   `club_archive_entry_thumbnail`). De är små (högst 512 kB, servern kontrollerar PNG-huvudet och storleken), unika per version
   eller träning och går alltid att rita om, så ADR-0189:s delning och referensräkning ger inget; de räknas inte i kvoten. Raden
   har läsarens version; en ny läsare ritar om. Träningens bild har kartversionen den ritades på och tas bort när banfilens
   karta byts eller träningen tas bort; listan säger `stale` om källan har ändrats. Bilderna skrivs inte i journalen.
6. **Träningens bild ritas av** första banfilen (i namnordning) som har en karta, annars den nyaste kartan i mappen. Utan
   karta visar listan "Ingen karta"; kunde kartan inte ritas visar den "Kartan kunde inte ritas" och träningens sida skälet.
7. **Kartans rättigheter ändras där de visas**: "Ändra rättigheter" vid kartans kort i Kartor-fliken och vid rättigheterna på
   träningens sida (ägare och administratörer), samma anrop som förut (`PUT /maps/{id}`, journalfört, följer med till
   grupperna). "Namn och rättigheter" blir "Byt namn".

## Följder

- Klubbarkivets OCAD 8–11 ritas; filer från OCAD 6–7 och packade Mapper-filer får ett tydligt skäl.
- Kartor från OCAD 8 och kartor från 9–11 utan koordinatsystemets kod (bara "r1" och x/y) har en georeferens med okänt
  koordinatsystem; banor flyttas då som "kontrollera själv" (ADR-0194 beslut 4).
- Första besöket efter uppdateringen ritar bilderna efter hand (sex kartversioner per besök) eller allt med en knapptryckning.

Ändrat 2026-11-07 (städrundan, grenen `d-smafixar`, ägarens beslut): kartornas kontroll och träningarnas små bilder (PUT `check`
och `thumbnail`) sparas av alla medlemmar som får se dem, inte bara administratörer: bilden av alla som ser träningsarkivet,
kontrollen av alla som ser arkivet eller kartbanken ("Vem ser vad", ADR-0209). Det är medlemmarnas webbläsare som ritar dem
(den som ser arkivet och får hämta kartfilerna); servern prövar innehållet som förut (PNG, storlek, att versionen och träningen
hör till klubben). "Kontrollera alla kartor igen" är kvar hos administratörerna.
