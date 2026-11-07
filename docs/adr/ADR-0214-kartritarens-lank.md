# ADR-0214: Länken till kartritaren och redigering av notiser

Status: beslutad 2026-11-05 (ägarens önskemål samma dag, grenen `kartritare-lank`). Bygger på ADR-0181 beslut 8 (kartfel och
behörigheten Kartritare), ADR-0176 (banhemligheten) och ADR-0188 beslut 6 (inget avslöjar om något finns). Migration 0083.

**Bakgrund.** Ägaren vill skicka kartritaren en länk till kartfelen med trådarna. Kartritaren ska kunna öppna just den sidan
utan konto i O-Tid och utan tillgång till tävlingen, som "alla med länken". Samma dag: den som skrivit en notis eller ett svar
ska kunna redigera texten.

**Beslut.**
1. **Länken** skapas i Kartfel (`/admin/<id>/course-setting/map-errors`) med "Dela med kartritaren" av den som får ändra
   banläggningen (ägare och administratörer har *ändra*). Nyckeln är 32 slumpade byte i base64url (256 bitar, 43 tecken) och
   bara dess sha256 sparas (`course_setting_map_link`), som återställnings- och inbjudningslänkarna. Uppslaget görs på hashen
   med ett unikt index, så ingen jämförelse av själva nyckeln beror på hur mycket som stämmer.
2. **Visas en gång.** Länken visas med "Kopiera länken" bara när den skapas. Behövs den igen skapar banläggaren en ny med
   "Skapa ny länk", som stänger den förra. Ingen krypterad kopia sparas: det kräver en nyckel på servern som inte alltid finns
   (`OTID_EVENTOR_MASTER_KEY` är valfri), och en ny länk är enklare och lika säker.
3. **En länk per tävling** som inte är avstängd (unikt index); en ny länk stänger den förra i samma transaktion. Tiden är
   obegränsad som förval. "Begränsa tiden" ger ett sista datum (tävlingsdagen plus en vecka föreslås, aldrig ett passerat
   datum) och länken gäller till midnatt efter den dagen i tävlingens tidszon. "Stäng av länken" gäller från nästa anrop.
   "Senast öppnad" visar bara tiden; ingen IP-adress eller webbläsare sparas med länken.
4. **Sidan** `/kartfel/<nyckel>` (publika instanser, inte indexerad, `Referrer-Policy: no-referrer`, ingen cache) visar bara
   kartan och kartfelen: läge eller ritning, löpnummer, text, status och tråden. Inga banor, kontroller, sträckor, nummer på
   kontroller, bannamn, tider ur tävlingen, foton (som exporten, ADR-0181 beslut 8), deltagare eller vem som skrev kartfelet
   och när. Tävlingens namn bara med "Visa tävlingens namn" (av som förval). Kartan ritas i webbläsaren ur kartfilen (samma
   Worker som banläggningen); nyckeln ger läsning av tävlingens kartfil bara genom `/api/public/map-link/<nyckel>/map`
   (ETag och `private, no-cache`, filens namn lämnas inte ut). "Min position" som i fältläget när kartfilen är georefererad.
   Kartritaren ser alla kartfel, också de nära en kontroll (som behörigheten Kartritare); delningen säger hur många de är.
5. **Kartritaren svarar** i ett kartfels tråd och trycker "Åtgärdat i kartan" (kartfelet blir klart) eller "Inte åtgärdat"
   (det står öppet så att banläggaren ser det), med en valfri kommentar. Beskedet sparas som ett svar utan konto
   (`course_setting_note_reply.created_by` tom, `map_link_id`, `author_name`, `verdict`) och klart av länken som
   `resolved_map_link_id`. Avsändaren är "Kartritaren" eller ett namn kartritaren skriver en gång (sparas i telefonen och bara
   på svaren). Kartritaren kan inte skapa kartfel, ta bort något eller se något annat; att skapa kartfel med länken är ett
   möjligt senare tillägg.
6. **Direkt hos banläggaren.** Svaren och beskeden går till tävlingens instans (Caddy skickar bara läsningen till de publika),
   som säger till öppna editorer och Kartfel i banläggningens ström (`notes`). Kartfel lyssnar nu också på strömmen.
7. **Säkerhet.** Ogiltig, okänd, avstängd och utgången länk ger samma svar ("Länken gäller inte längre – be banläggaren om en
   ny.", 404). Varje anrop räknas i spärren per IP-adress (300 i timmen, också missar) och per länk (600 i timmen)
   (`account_request_throttle`, nyckeln som HMAC). Skrivningar kräver exakt Origin, JSON och huvudet `x-otid-map-link` (en
   annan sajt kan inte skicka det utan att webbläsaren frågar först) och avvisar `Sec-Fetch-Site: cross-site`; nyckeln i
   adressen binder skrivningen. Journalen får skapad, avstängd, öppnad (högst en gång i timmen), svar och besked med aktören
   `COURSE_SETTING_MAP_LINK` (länkens id). Routes med nyckel står i en egen lista i routetestet (`race-roles.test.ts`).
8. **Kopia och säkerhetskopia** tar med kartritarens svar men inte länken (`course_setting_map_link` står bland tabellerna
   som inte följer med).
9. **Redigera.** Den som skrev en notis eller ett svar (bara den, inte ens den med *ändra*) trycker "Redigera". Redigeringen
   bygger på texten som visas; har någon annan ändrat den blir det 409 och inget skrivs. Notisen eller svaret får
   `edited_at` och visas med "(ändrad …)" för alla, också med länken; den tidigare texten sparas i `course_setting_note_edit`
   och visas inte. Notiserna ligger utanför banläggningens dokument (ADR-0181 beslut 1), så redigeringen går inte genom
   dokumentets ångra; historiken är versionerna. Ägare och administratörer tar fortfarande bort. Kartritarens svar med länken
   kan inte redigeras (det kräver något som binder svaret till webbläsaren; inte gjort).

Ändrat 2026-11-07 (städrundan, grenen `a1-sakerhet`), beslut 4: svar med konto visas på sidan med rollen ("Banläggaren", eller
"Kartritaren" för ett konto med behörigheten Kartritare) utan visningsnamn och utan tid; kartritarens svar med länken har kvar
namnet hen skrev och tiden. "(ändrad …)" visas som förut (beslut 9).

Ändrat 2026-11-07 (städrundan, grenen `d-smafixar`): kartritarens besked med länken ("Åtgärdat i kartan" och "Inte åtgärdat")
ändrar bara ett kartfel som är öppet eller stängdes via länken. Har ett konto stängt det står stängningen kvar med kontot som
den som stängde; beskedet syns ändå som svar i tråden.

**Konsekvenser.** Migration 0083 bara med tillägg och lösare regler: tabellerna `course_setting_map_link` och
`course_setting_note_edit`, kolumnerna ovan, `created_by` på svar får vara tom, svarets text får vara tom i ett besked, en klar
notis kan vara klar av länken, och spärrens och journalens nya värden. Under driftsättningen kan en äldre instans inte läsa
ett svar utan konto; fönstret är kort.

## Risker och öppna frågor

- **Länken i adressen** hamnar i webbläsarens historik och i proxyns loggar. Den går att stänga av, och en ny ersätter den.
- **Spärrens scope** (`account_request_throttle_scope_check`) skrivs om av flera migrationer; en gren som också lägger till ett
  scope måste ta med `MAP_LINK_IP` och `MAP_LINK_TOKEN`.
- **Kartritaren skapar kartfel** med länken och redigerar sina svar: inte byggt.
