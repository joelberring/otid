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

5. **Anonymisera en deltagare** (migration 0045). Deltagarkortet har "Anonymisera" (samma flöde, idempotens och journal som "Ta
   bort" och "Stryk", läget `ANONYMIZE`; också för strukna och sträcklöpare). Namnet blir "Anonym deltagare" (förnamn "Anonym",
   efternamn "deltagare", så att alla befintliga format med krav på efternamn fungerar), klubben, Eventors id och externa id tas
   bort och `entry.anonymized_at` sätts. Resultatrevisionerna, sträcktiderna, avläsningarna och placeringarna är orörda.
   Personuppgifterna tas också bort ur tävlingens journaler och sparade dokument (`anonymization.ts`): i rader som pekar på
   deltagaren (t.ex. `audit_event.entity_id`) efter fältens namn och värden, i listor med många deltagare (den publicerade
   startlistan, fastställandet) bara i deltagarens objekt, i IOF XML (inlästa filer, startlistans och fastställandets XML) i
   personens block, och hela namnet (också tidigare namn) var det än står. Namnändringarnas journal, GPS-rutten och PDF:er som
   nämner deltagaren tas bort. Journalposten för anonymiseringen har bara versionen. Journalerna är oföränderliga; migrationen låter
   dem skrivas över bara när transaktionen har satt `otid.anonymize`, och aldrig råa avläsningar, deras tolkning eller
   radiostämplingar. **Brickans nummer finns kvar** i brickans koppling och avläsningarna (kolumnerna `card_number`): resultatet
   räknas ur dem, de bär främmande nycklar och råa avläsningar ändras aldrig (AGENTS.md). Numret är då inte kopplat till ett namn
   i O-Tid. Ska det bort helt tas tävlingen bort (eller gallras med `delete`). "Ta bort deltagare" anonymiserar journalerna först,
   så att inget namn blir kvar i journalposter som inte följer med borttagningen, och dess journalpost har inte längre namnet.
6. **Gallring, av som förval.** `OTID_RETENTION` = `off` (förval), `anonymize` eller `delete`, och `OTID_RETENTION_MONTHS`
   (förval och förslag **24**: två säsonger, så att förra årets resultat finns kvar till nästa års upplaga av samma tävling, och
   resultaten finns dessutom i Eventor). `anonymize` anonymiserar alla deltagare i tävlingar vars datum är äldre (som beslut 5) och
   festens gäster och tar bort GPS-rutterna; `race.personal_data_removed_at` och en journalpost utan namn sparas. `delete` tar bort
   evenemang där alla lopp är äldre, med allt som hör till, och loggar det som superadmins borttagning ("Automatisk gallring").
   Underhållet i webbens tävlingsinstans (`maintenance-runner.ts`, som radiopollern) kör det fem minuter efter start och sedan en
   gång i timmen, högst fem tävlingar per varv och en per transaktion med radlås. Integritetssidan säger vad servern gör.
7. **Inloggningsspärren per adress och IP-adress.** Fem fel spärrar kombinationen e-postadress och IP-adress i 15 minuter (förut
   adressen oavsett varifrån), och 30 fel från samma IP-adress spärrar den som förut. Den som gissar från en annan adress kan
   alltså inte låsa ute en funktionär. Ett angrepp från många adresser begränsas av spärren per IP-adress och scrypt; en
   gemensam spärr för adressen valdes bort eftersom den åter skulle gå att använda för att låsa ute någon.
8. **Gruppkoderna.** En ny grupp får koden `<kortnamn>-<8 slumpade tecken>` (32 tecken utan förväxlingsbara, 40 bitar);
   kortnamnet kortas till 31 tecken. Befintliga grupper behåller sin kod (utskrivna QR-koder ska fungera). Gruppsidan räknar
   missade koder per IP-adress och svarar "För många försök" efter 30 i timmen, också för en riktig kod (migration 0046,
   spärrens `GROUP_CODE_IP`).
   Ändrat 2026-11-07 (städrundan C5, migration 0087): spärrens scope räknas inte längre upp i ett CHECK som skrevs om för varje
   nytt scope; listan står i koden (`ACCOUNT_REQUEST_THROTTLE_SCOPES`, kontrolleras i `throttleKeyHash`) och databasen kräver bara formen.
9. **Träningsgruppens ledare och medlemmar** avslöjar inte konton (som ADR-0188 beslut 6): de sparas för adressen
   (`training_group_invitation`) och listan visar "väntar på inloggning" tills ett konto med adressen och bekräftad e-post loggar
   in, bekräftar adressen, öppnar Mina tävlingar, en tävling eller gruppens sida. En adress som redan finns i listan ger 409 (den
   syns redan). Registreringen och svarstiden: ADR-0186 beslut 9 täcker registrering, glömt lösenord och inloggning när servern
   har e-post (samma svar, lösenordet hashas alltid, mejlet efter svaret; inloggning mot okänd adress gör en lika lång
   scrypt-kontroll). Utan e-post säger registreringen fortfarande att adressen finns; det står i docs/security-privacy.md.
   Ändrat 2026-11-07 (städrundan C5/K4, migration 0087): inbjudans avsändare (`actor_account_id`) har ingen främmande nyckel, som
   klubbens inbjudan. Ett konto som tas bort tar alltså inte med sig inbjudningar det skickat till andra; de står kvar och en
   annan ledare kan skicka dem igen.

## Följder

- En tillbakagång till versionen före 0044 kan inte läsa kartor som laddats upp eller kopierats efter uppdateringen.
- Utrymmet i databasen frigörs först när PostgreSQL återanvänder det (eller med `VACUUM FULL`, docs/drift.md).
- Spärrarnas räknare för inloggning börjar om (nyckeln har ändrats).
- Brickans nummer i avläsningarna och en gammal grupps korta kod finns kvar; se beslut 5 och 8.
