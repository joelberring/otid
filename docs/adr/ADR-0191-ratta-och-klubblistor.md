# ADR-0191: Rättelser på ett ställe, klubblistor och städning efter ADR-0188

Status: beslutad 2026-11-02 (grenen `ratta-listor`). Ändrar ADR-0169 beslut 4 (deltagarkortet), PLAN.md steg 31 (var
rättningarna finns), steg 13 (listorna) och fullföljer ADR-0188 beslut 5 (steg två för `FORKED`).

## Bakgrund

Rättelser för en löpare fanns på tre ställen med överlappande val: deltagarkortet (Ändra status, Ange tid manuellt, Godkänn
saknade kontroller, Läs om, variant och fyra knappar för anmälan), Avläsning (fyra tidsrättningar med eget löparval, plus
journal, konfliktgranskning, startläge, återkomst, rättningar för hela tävlingen, omläsning och otolkade avläsningar, ett
tiotal verktyg) och Resultat (felstämplade, beslut att se över, omräkning). Arrangören fick leta. Klubbarna saknade en
lista med bara sina löpare i alla klasser och en sammanställning per klubb. Importen av anmälda länkades från både
Inställningar och Anmälda.

## Inventering av rättelsevägarna (före)

| Rättelse | Deltagarkortet | Avläsning | Resultat |
|---|---|---|---|
| Ej start, brutit, disk, utom tävlan, deltog utan tid, godkänn, bekräfta felstämplad | Ändra status | – (startläge i kvar i skogen) | Markera kvar i skogen som ej start |
| Manuell tid | Ange tid manuellt | Rätta observerad mål-/starttid och återta (fyra verktyg med eget löparval) | – |
| Bortse från stämpling (lägg till en saknad) | Godkänn saknade kontroller | Kontroll ur funktion (alla) | – |
| Byt bana eller variant | Byt klass, variantväljaren, Godkänn på … | – | – |
| Byt bricka, flytta avläsning | Bricka (Byt bricka med …) | Okända brickor → koppla till anmäld | – |
| Läs om från rådata | Läs om | Läs om avläsningar från rådata (alla) | – |
| Räkna om | Räkna om från avläsningen | – | Räkna om flera, Räkna om hela tävlingen |

"Lägg till stämpling" finns inte som eget verktyg: en saknad kontroll godkänns (Godkänn saknade kontroller), och det är det
O-Tid gör i stället för att skriva in en stämpling (rådata ändras aldrig).

## Beslut

1. **Rätta i deltagarkortet.** Allt som ändrar en löpares resultat finns under rubriken "Rätta" i deltagarkortet: Status
   (Ändra status), Tid och kontroller (Ange tid manuellt, Godkänn saknade kontroller, Läs om), Bana och bricka (Byt bricka,
   Byt klass, variant) och under "Mer" de fyra sällsynta tidsrättningarna av en stämplad mål- eller starttid. Verktygen är
   desamma som förut och går genom samma statusflöde med förhandsbesked, bekräftelse, journal och historik; tidsrättningarna
   gäller nu den löpare som kortet visar i stället för att ha ett eget löparval. Avläsning och Resultat har "Rätta en löpare"
   (löparval och "Öppna Rätta") och alla "Öppna" (kvar i skogen, felstämplade, beslut att se över, Resultaten är klara)
   öppnar kortet vid Rätta. Avläsningens verktyg för hela tävlingen (rättningar för alla, omläsning, otolkade avläsningar)
   ligger under "Mer: verktyg för hela tävlingen". Kvar i skogen (startläge, återkomst) och okända brickor står kvar i
   Avläsning eftersom de gäller avläsningens kö, inte ett resultat.
2. **Klubblistor.** Start- och resultatlistorna (arbetsytan och de publika sidorna) får ett klubbfilter: en klubb visar
   klubbens löpare i alla klasser i alla vyer, och utskriften får klubbens namn i rubriken. Resultatlistan får vyn
   "Klubbar", en sammanställning per klubb som i MeOS: startande, fullföljda (godkända), ettor, tvåor, treor och totalt, med
   utskrift och CSV. Filtret och vyn bygger på samma publika data som förut, så reglerna för vad som är publikt gäller
   oförändrade: bricknummer bara när tävlingen visar dem, varianter före start dolda och sidorna noindex.
3. **Import på ett ställe.** Importen av anmälda och startlistor (IOF XML) hör till Anmälda, som alltid visar länken
   (inte bara när listan är tom). Inställningar visar bara en hänvisning till Anmälda. Eventor ligger kvar under
   Inställningar (nyckel och koppling) och hänvisas från Anmälda.
4. **Kod som bara tester anropade** är borttagen eller ersatt av testhjälpare som går via produktionsvägen.
5. **`FORKED`, steg två (ADR-0185).** Migration 0047 skriver om `race.race_type = 'FORKED'` till `STANDARD`. Koden har sedan
   ADR-0188 klarat båda och skriver aldrig `FORKED`; återställning från en äldre säkerhetskopia skriver nu också `STANDARD`.
   Värdet tas inte bort ur `race_type_check` i samma release: en kopia av databasen från före migreringen eller en äldre
   kodversion som körs under driftsättningen ska fortfarande fungera. Steg tre i en senare driftsättning: ta bort `FORKED`
   ur `race_type_check` och ur kontraktets `raceTypes`. Journalen `user_account_event_creation_request` skrivs inte om
   (den sparar begäran som den kom, för omsändning) och behåller värdet i sin kontroll.

## Konsekvenser

- Specarna öppnar "Mer: verktyg för hela tävlingen" innan de använder rättningarna för hela tävlingen och omläsningen.
- Hjälpen beskriver Rätta och var verktygen för hela tävlingen finns.
