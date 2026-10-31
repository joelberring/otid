# Kart- och ruttmodell

Gäller från PLAN.md steg 16 ([ADR-0171](adr/ADR-0171-karta-och-vagval.md)). Den tidigare parkerade
modellen (MinIO-objekt, uppladdningsreservationer, deltagarlänkar, samtycken, publiceringsjournaler,
kontrollgeometri; TASK106–155) är borttagen.

## Data

- `race_map`: en karta per lopp. Bilden (PNG eller JPEG, högst 30 MB) ligger som `bytea` i PostgreSQL
  med filnamn, storlek i pixlar och SHA-256. Georeferensen är tre punkter (pixel + WGS84) och den affina
  transformen pixel → lon/lat som domänen räknar ut (`deriveRasterGeoreference`). En ny bild nollställer
  georeferensen.
- `participant_route`: en rutt per individuell deltagare. Original-GPX (högst 8 MB) sparas som `bytea`,
  de tolkade punkterna som `[tid ms, lat, lon]` i tidsordning (bara punkter med tid). En ny fil ersätter
  den förra.
- `race_map_source` (steg 59, ADR-0179): banläggarens kartfil från OCAD eller Mapper orörd (högst 60 MB) med format och
  version, SHA-256, skala, kartans yta i mm, kartfilens georeferens och `render` (px/mm och kartans punkt i bildens övre
  vänstra hörn). Arrangörens webbläsare läser och ritar filen i en Worker; bilden (PNG) och tre punkter ur filens
  georeferens går till `race_map` i samma transaktion. En ny kartbild tar bort kartfilen; en ny kartfil ersätter båda.
  Originalfilen lämnas bara ut till admin.
- `race_route_choice` (steg 60, ADR-0179 beslut 11–12): vägvalsanalysens inställningar (`RouteChoiceSettings`: klass per
  symbol, farter, ekvidistans, stigningsfaktor, referensfart) och de bästa vägar som arrangören publicerat: per bana eller
  variant och sträcknyckel en förenklad linje i kartfilens mm, plus kartfilens SHA-256 som linjerna räknades på. Själva
  analysen räknas i arrangörens webbläsare ur kartfilen och sparas inte. En kopia av tävlingen får inställningarna, inte
  publiceringen.
- Alla tas med i den nattliga `pg_dump`. Ingen objektlagring behövs.

## Koppling till sträckorna

- En sträcka identifieras av från- och till-punkt: `S-31.1`, `31.1-32.1`, `33.1-F` (kod.förekomst, S = start,
  F = mål), samma nyckel i sträcktidstabellen och i vägvalen (`packages/domain`: `split-table.ts`, `route-legs.ts`).
- Löparens sträckor räknas ur starttid och stämplingstider i det publicerade resultatet. Ruttens del för en
  sträcka är punkterna mellan sträckans två klockslag, med interpolerade ändpunkter.
- En sträcka över en missad kontroll (t.ex. `31.1-33.1`) är en egen sträcka och jämförs aldrig med `32.1-33.1`.

## Kontrollerna på kartfilen

- När bilden är ritad ur kartfilen och kontrollerna har kartlägen (`MapPosition`) placeras de direkt via `render`
  (mm → pixel), i arbetsytans kontrollkarta och på den publika vägvalskartan. Ligger ett kartläge utanför kartans yta
  (plus 10 mm) eller mer än 10 m från banfilens `Position` (via kartfilens georeferens) visas "Banfilen verkar inte vara
  gjord på den här kartan" och lägena räknas via WGS 84 som förut (`layoutControlMap`, `mapFile`).

## Vem ser vad

- Bara admin (OWNER/ADMIN, samma serverkontroll som resten av arbetsytan) laddar upp, georefererar och tar bort.
- Publikt visas kartbilden bara när den är georefererad, och rutterna bara som delar för en sträcka i ett
  publicerat resultat. Tiden före start och efter mål visas aldrig, inte heller den råa GPX-filen.
- Steg 60: vägvalsanalysen och kalibreringens rutter (delarna per sträcka, utan namn) bara för admin. Publikt visas
  "Bästa vägval enligt kartan" på vägvalskartan bara när banorna är publika (ADR-0176), bara för en sträcka som löparen
  har i ett publicerat resultat och bara när kartfilen är densamma som linjen räknades på.
- Ingen GPS-följning, inga deltagarkonton för uppladdning och inga Livelox-data.
