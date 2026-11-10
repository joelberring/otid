# ADR-0221: Terminsplanering i klubbytan

Status: beslutad 2026-11-09 (ägaren: "lägga in en träningsplanering där träningar samlas per dag/vecka … koppla ansvarig …
dela läsrättigheter till andra som ska skriva ut, sätta ut kontroller", "typ samla per termin"). Valen i beslut 1–4 är
ägarens. Lägger till en behörighet för den som har en uppgift; inga nya roller i klubben eller på tävlingen.

**Bakgrund.** Träningsgrupperna (ADR-0182) har tillfällen som redan är tävlingar, och klubbytan (ADR-0194, ADR-0209) har
arkiv, kartor och roller. Ledarna saknar ett ställe att planera en hel termin innan träningarna finns, att säga vem som
ansvarar för vilken träning och att lämna ut uppgifter (skriva ut kartor, sätta ut och ta in kontroller, tidtagning) till
andra i klubben, som då bara ska se det de har fått.

**Beslut.**
1. **Fliken "Planering" i klubbytan**, för ledare, administratörer och ägare. Klubben har **terminer** (namn, första och
   sista dag, t.ex. "VT 2027"). En termin visas vecka för vecka (ISO-veckor), med de planerade träningarna per dag och de
   tomma veckorna synliga. En planerad träning har datum, valfri tid, rubrik (övning), plats, valfri karta ur klubbens
   kartbank, valfri träningsgrupp, ansvarig (en ledare, administratör eller ägare i klubben) och en anteckning. "Varje vecka
   till terminens slut" lägger samma träning på samma veckodag resten av terminen. Medlemmar utan ledarroll ser inte planen.
2. **Planen blir en riktig träning med en knapp.** Först är den bara en rad i planen. "Skapa träningen" (en ledare, admin
   eller ägare i klubben; översynen 2026-11-10 B4: alla som får ändra planen) skapar en träning med namn, datum och tid, i träningsgruppen om en är vald (gruppens ledare blir då
   administratörer, ADR-0182) och annars som en egen tävling. Den ansvarige blir administratör på den. Planen länkar sedan
   till träningen, och träningen ändras aldrig av planen efter det. Kartan väljs i banläggningen ("Välj karta från
   klubbarkivet", förvald med planens karta när det går).
3. **Uppgifter.** En planerad träning har uppgifter med en rubrik ("Skriva ut kartor", "Sätta ut kontroller" …) och en
   person. Personen ser under "Mina uppgifter" bara sina uppgifter med träningens datum, tid, plats, rubrik, ansvarig och
   de andra uppgifterna på samma träning (rubrik och klart, inga namn eller adresser), och kan markera sin uppgift klar.
   När träningen finns får personen läsrätt i banläggningen (`course_setting_grant` med `COMMENT`, steg 66): banorna,
   kontrollkartan, kontrollbeskrivningarna, notiser och "kollad" per kontroll. Behörigheten tas bort när uppgiften tas
   bort, om personen inte har en annan uppgift på samma träning eller en behörighet som någon gav för hand.
4. **Vem som kan få en uppgift:** en bekräftad medlem i klubben (listan som "Från klubben", ADR-0209), eller en
   e-postadress. Uppgiften gäller kontot med den bekräftade adressen när hen loggar in (som inbjudningarna, ADR-0206), och
   med e-post på servern får personen ett kort mejl med uppgiften och en länk. Adressen visas bara för ledarna, aldrig för
   de andra med uppgifter.
5. Inget i planen är publikt eller indexeras. Planen och uppgifterna tas bort med klubbytan.

**Följder.** Migration 0109 (`club_term`, `club_plan_session`, `club_plan_task`). PDF:erna för tryck (steg 65) är fortfarande bara för administratörer; den med läsrätt ser banorna och kontrollkartan i
banläggningen. Ska hen ta fram tryckfilerna ger den ansvarige hen administratörsrollen på träningen.
