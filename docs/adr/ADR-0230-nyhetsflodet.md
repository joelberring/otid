# ADR-0230: Nyhetsflödet «Nytt i O-Tid» och startsidan efter skissen F3

- Status: Beslutad och byggd 2026-11-21 (ägaren godkände uppdraget samma dag). Migration 0134.
- Bygger på: ADR-0172 (publika sidor, superadmin), ADR-0194 och ADR-0209 (klubbytan, klubbens roller och bekräftade medlemmar),
  ADR-0170 beslut 2 (formspråket), ADR-0176 (banhemlighet).

## Kontext

Startsidan ska följa skissen F3 (DatorStart3, projektets riktlinjer för formspråket): en blickpunkt (sökningen), högst två
innehållszoner, linjer i stället för rutor, och en smal spalt «Nytt i O-Tid» med korta nyheter om vad som är nytt. Det fanns
ingen lagring för nyheter, och klubbarna ville kunna nå sina medlemmar på samma ställe.

## Beslut

1. **En tabell `news_item`** (migration 0134, bara tillägg). `club_id` NULL är en allmän nyhet, annars klubbens. Fälten:
   rubrik (1–120 tecken), kort text (högst 400), valfri länk, valfri bild, `published_at` (när den skrevs; ordningen),
   `hidden_at` (dold), vem och när. `created_by`/`updated_by` utan främmande nyckel (som inbjudningarna), så att ett borttaget
   konto inte tar med sig nyheten. Idempotent på `request_id`.
2. **Vem skriver.** Allmänna nyheter: **superadmin** (befintlig systemroll), på `/superadmin`. En klubbs nyheter: klubbens
   **ledare, administratörer och ägare** (befintliga klubbroller `LEADER`, `ADMIN`, `OWNER`; inga nya rolltyper), på klubbytan
   under fliken Nyheter. Medlemmar (`READER`, också bekräftade medlemmar enligt ADR-0209) läser där. Superadmin kan ändra, dölja
   och ta bort alla nyheter (moderering). Klubbens ändringar och superadmins moderering av en klubbnyhet skrivs i
   `club_journal` (`NEWS_CREATED`, `NEWS_UPDATED`, `NEWS_DELETED`, utan innehållet). Superadmins logg (`superadmin_action`)
   tar bara konton, evenemang och tävlingar och används inte här.
3. **Vem ser vad.** Startsidans spalt: allmänna nyheter för alla; en klubbs bara för klubbens inloggade medlemmar
   (`clubMembership`, samma regel som klubbytan), märkta med klubbens namn och blandade med de allmänna i datumordning; aldrig
   dolda. Högst tre rader. Spalten döljs när den senaste synliga nyheten är äldre än 60 dagar. Reglerna är rena funktioner i
   `@o-tid/domain` (`homeNews`, `canWriteClubNews`, `normalizedNewsLink`).
4. **Säkerhet.** Behörigheten prövas på servern i varje anrop med `requireSuperadmin` och `requireClubRole`. Skrivningar har
   samma skydd som kontots andra anrop (exakt Origin, CSRF, privata svar; `mutation` i club-route-handlers). Texten sparas som
   ren text och skrivs ut av React (escapas). Länken: en intern sökväg (`/…`, inte `//…`) eller http(s) utan inloggningsuppgifter;
   databasen har ett villkor till. Bilden skalas ned i webbläsaren (högst 960 px, WebP eller JPEG där WebP inte går att skriva),
   högst 300 kB, typen och måtten prövas mot filens egna bytes (`imageDimensions`, `webpDimensions`) och sparas i raden som
   klubbarkivets småbilder. Den serveras med `nosniff` och `default-src 'none'`; en synlig allmän nyhets bild får sparas i delade
   cacher (länge med versionen `?v=`), en klubbnyhets eller dold nyhets bara privat och bara för den som får se nyheten. Inget om
   nyhetens innehåll loggas.
5. **Inga startnyheter i migrationen**: repot har inget mönster för innehåll i migrationer; ägaren skriver dem själv.
6. **Startsidan (F3).** Överst «Hitta din tävling», ingressen, sökningen (sidans enda mörka knapp; etiketten «Sök tävling»
   eftersom sökningen bara söker på tävlingens och loppets namn) och «Kom igång som arrangör»; «Har du en kod?» bara i appen som
   förut. Till höger veckans målning hel med bildtexten och länken till konstnären. Under: Pågår nu, Kommande och Genomförda
   (de åtta senaste, sedan «Visa fler genomförda»); ett tomt avsnitt visas inte. Raderna har datum (i dag med första start),
   namnet som länk, lopp · arrangörsklubb (`race_organiser`) · typ och små grå följdlänkar (Live, Resultat, Sträcktider,
   Startlista). Den inloggade har «Ditt O-Tid» sist i vänsterspalten. Högerspalten: Nytt i O-Tid, filmerna och demon. Rutorna
   «Mer än tidtagning» togs bort (vad O-Tid gör står på Om O-Tid). Vilka tävlingar och träningar som syns är oförändrat.
7. **Kartutsnitt med bana** under Genomförda byggs inte nu. Den publika kartbilden finns bara i full storlek (vägvalen) och
   banan ritas i webbläsaren; en miniatyr skulle kräva en ny rendering på servern (avkoda kartan, rita banan, skala, cacha) för
   varje rad på startsidan. Banhemligheten (ADR-0176, `coursesArePublic`) och kartornas rättigheter (`no_public_display`) skulle
   behöva prövas där, och klubbarkivets småbilder får inte visas publikt. Det tas upp som en egen fråga.

## Följder

- Nya anrop: `GET/POST /api/superadmin/news`, `PUT/DELETE /api/superadmin/news/{id}`, `GET/POST /api/organizer/clubs/{id}/news`,
  `PUT/DELETE /api/organizer/clubs/{id}/news/{newsId}`, `GET /api/public/news/{id}/image` (redan under `/api/public/*` i Caddy).
- Klubbens nyheter följer inte med i säkerhetskopian av en tävling och gallras inte (de hör inte till en tävling).
- Bilderna ligger i databasen (högst 300 kB, en per nyhet), inte i förrådet för kartinnehåll (ADR-0229): de är få och små.
