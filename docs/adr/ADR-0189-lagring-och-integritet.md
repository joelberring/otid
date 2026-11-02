# ADR-0189: Kartornas lagring, stora uppladdningar, anonymisering och gallring, små säkerhetsfynd

Status: beslutad 2026-11-02 (grenen `lagring-integritet`, migration 0044–0046). Ändrar ADR-0182 beslut 4 (kartbiblioteket
kopierar filerna) och ADR-0179 beslut 1 (kartfilen i `race_map_source.file`).

## Bakgrund

En granskning 2026-11-02 fann att kartfiler (upp till 60 MB) och kartbilder (upp till 30 MB) kopierades till varje tävling,
kopia och träningstillfälle: 30 tillfällen kunde bli cirka 2,7 GB, och det fanns ingen kvot. Uppladdningen av kartfilen
buffrades i minnet (upp till 91 MB i en webbinstans med 1 GB). En arrangör kunde inte ta bort eller anonymisera en enskild
löpare, och inget gallrades. Inloggningsspärren per adress gick att använda för att låsa ute en funktionär, gruppkoderna gick
att gissa, och träningsgruppens medlemslista avslöjade om en adress hade ett konto.

## Beslut

1. **Kartinnehållet lagras en gång.** Kartbilder och kartfiler ligger i `map_content` (sha256 som nyckel, storlek, kontot som
   laddade upp det) och `map_content_part` (delar om högst 1 MiB). `race_map`, `race_map_source`, `training_group_map` och
   `training_group_map_source` pekar på innehållet med `content_sha256`. En kopia, ett träningstillfälle, gruppens bibliotek
   och en återställd tävling kopierar bara referensen. En utlösare tar bort innehållet när den sista referensen tas bort eller
   byts, också när en tävling tas bort med purge; en rad som en annan transaktion just sparar en referens till hoppas över och
   underhållet tar den senare. Säkerhetskopian (ADR-0187) har innehållet som fil precis som förut (formatVersion 2 oförändrad);
   återställningen lägger det i lagret igen. Utskriftsrollen `otid_print` läser de två nya tabellerna (migrationen ger dem
   rättigheten, och `deploy/db-roles.sh` ger och kontrollerar den).
2. **Uppladdningen strömmas till databasen.** Next 16.4 ger route handlers bodyn som en ström (`request.body`); `proxy.ts`
   gäller inte `/api/`, så Next buffrar den inte (`proxyClientMaxBodySize` gäller bara när proxyn körs). Kartfilen och bilden
   läses ur multipart-strömmen och skrivs del för del till `map_content_part` medan sha256 räknas; webben håller högst en del
   och filens början (256 kB, för kontrollen av format och bildens mått) i minnet. Gränserna kontrolleras medan strömmen läses
   (60 MB fil, 30 MB bild, 91 MB totalt) och delarna tas bort om något avvisas. Först när filen är godkänd sparas innehållet i
   samma transaktion som tävlingens referens. Delar som aldrig blev innehåll (avbrutna uppladdningar) tas bort efter ett dygn.
3. **Kvot.** Nytt innehåll räknas mot kontot som laddade upp det (`OTID_MAP_QUOTA_ACCOUNT_MB`, förval 2048) och mot hela
   installationen (`OTID_MAP_QUOTA_TOTAL_MB`, förval 20480, gamla rader räknas med); `0` stänger av en gräns. Samma innehåll
   som redan finns kostar ingenting. Över gränsen svarar servern 422 `STORAGE_QUOTA_EXCEEDED` med gräns, använt och behov i MB,
   och arrangören får ett besked som säger vad som går att göra. Återställningen prövar samma kvot.
4. **Övergången i två steg** (AGENTS.md, ADR-0185): migration 0044 lägger bara till (nya tabeller, nullbara referenser,
   `image`/`file` får vara tomma, ett villkor att exakt en av dem är satt). Den nya koden läser båda och skriver bara
   referenser; en kopia av en gammal rad lägger dess innehåll i lagret utan att ändra den. Steg två är kommandot
   `node superadmin.mjs map-content move`, som serverägaren kör när den nya versionen fungerar: det flyttar de gamla raderna en
   i taget och slår ihop dubbletterna. Kolumnerna tas bort i en senare migration när inga rader finns kvar.

## Följder

- En tillbakagång till versionen före 0044 kan inte läsa kartor som laddats upp eller kopierats efter uppdateringen.
- Utrymmet i databasen frigörs först när PostgreSQL återanvänder det (eller med `VACUUM FULL`, docs/drift.md).
