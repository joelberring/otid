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

## Tillägg 2026-11-10: planen som gemensam arbetsyta

Ägaren: terminsplanen ska vara både planeringen och klubbens gemensamma arbetsyta.

1. **Koppla en träning.** En banläggning som redan finns knyts till veckan (`PUT .../sessions/[id]/race`, `linkPlannedRace`),
   eller skapas ur arkivet med Använd igen → Till terminsplanen. Bara den som är ägare eller administratör för träningen
   kopplar den. `raceId: null` tar bort kopplingen; träningen ändras inte.
2. **Alla ledare är administratörer.** En träning som är kopplad till en vecka i en klubbs plan har klubbens ledare,
   administratörer och ägare som administratörer, utan egen rad på evenemanget (`planLeaderGrant`, frågas av
   `activeEventAdministrationGrant` efter gruppens ledare). Rätten följer klubbrollen och kopplingen.
3. **Sparade utskrifter** (migration 0111, `race_print_file`). PDF:er som ligger kvar i träningen: ett klart tryckjobb
   sparat, eller en egen uppladdad PDF (högst 40 MB, 30 per träning). Läses av alla som ser banläggningen (COMMENT, också
   uppgifternas personer); sparas och tas bort av den som ändrar (EDIT). Syns i banläggningens utskrift, på veckan i planen
   och under Mina uppgifter. Följer med i säkerhetskopian.

## Tillägg 2026-11-12: användartestet av ledarflödet

Ingen migration. (1) En träning som skapas ur klubbens arkiv (Använd igen), ur planen eller i en grupp som hör till klubben
(gruppen står i klubbens plan, eller är gruppens `club_id` satt) får klubbens organisation i Eventor som arrangörsklubb; Använd
igen för över banorna till tidtagningen med Överför till tävlingens förhandsvisning och godkännande, och en Träning utan klasser
får en klass per bana. (2) Beslut 4: medlemmar och den ansvarige får också mejlet (inte den som ger sig själv uppgiften), genom
samma spärr; veckorna till terminens slut blir ett mejl; mejlet till en adress utan konto säger att kontot ska skapas och länkar
till Skapa konto. Uppgifter kan ändras (rubrik och person; läsrätten flyttar med). (3) Koppla en träning visar inga fester och
först veckan ± två veckor. Ägarens beslut samma dag om automatisk arkivering och om personerna vid kopiering kräver nya
kolumner och är specificerade i `docs/plan-ledarflode-2026-11-12.md`, liksom att välja en väntande inbjuden som ansvarig.

## Tillägg 2026-11-12 (kväll): personerna vid kopiering, Hämta ur arkivet och Kopiera upplägg från termin

Ägarens beslut, migration 0114 (`docs/plan-ledarflode-2026-11-12.md`). (1) När en träning läggs i klubbarkivet sparas planens
ansvarige och uppgifter (`club_archive_entry_person`: rubrik och konto, aldrig adresser; tas bort med arkivposten). (2)
Personregeln vid kopiering (`club-plan-people`): den som när kopian görs är ledare, administratör eller ägare i klubbytan följer
med som ansvarig och på sina uppgifter; övriga uppgifter kopieras med rubriken men utan person. Inga mejl. (3) Hämta ur arkivet i
veckan (POST `planning/terms/[termId]/archive`): arkivträningen blir en planerad rad (rubrik, plats, anteckning, karta, och om
valt moment, nivåer, egna ord och ledarna); banorna och kartan läggs sedan på med Använd igen, som skapar träningen och kopplar
den till raden. Det är två steg (Använd igen ritar kartan i webbläsaren), så raden står kvar om Använd igen avbryts. (4) Använd
igen → Till terminsplanen kopierar arkivträningens personer till raden före kopplingen (POST `planning/sessions/[sessionId]/people`;
den ansvarige bara om raden saknar en, en uppgift med samma rubrik inte två gånger). (5) Kopiera upplägg från termin (POST
`planning/terms/[termId]/copy`) till en tom termin: samma veckodag i motsvarande vecka räknat från terminernas första veckor,
rader utanför terminen räknas; gruppen följer med bara när den som kopierar är ledare i den (som när en rad skapas); ingen
träning skapas. Alla tre vägarna kräver ledare eller mer i klubbytan, som resten av planen.
