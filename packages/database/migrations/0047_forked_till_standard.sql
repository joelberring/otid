-- ADR-0191 beslut 5: steg två för ADR-0188 beslut 5 ("Tävling med gafflade banor" är en del av Tävling).
--
-- Steg ett (ADR-0188, samma release som migration 0043) gjorde FORKED till ett alias för STANDARD: koden visar och sparar
-- STANDARD och skriver aldrig FORKED. Här skrivs de befintliga raderna om. Värdet står kvar i race_type_check i den här
-- releasen, så att en äldre kodversion under driftsättningen och en kopia från före migreringen fortfarande fungerar; att ta
-- bort det är steg tre i en senare driftsättning. Journalen user_account_event_creation_request skrivs inte om: den sparar
-- begäran som den kom (omsändning jämförs med den). Tabellen race har en rad per tävling, så uppdateringen tar inga långa lås.
UPDATE race SET race_type = 'STANDARD' WHERE race_type = 'FORKED';
