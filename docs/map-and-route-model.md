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
- Båda tas med i den nattliga `pg_dump`. Ingen objektlagring behövs.

## Koppling till sträckorna

- En sträcka identifieras av från- och till-punkt: `S-31.1`, `31.1-32.1`, `33.1-F` (kod.förekomst, S = start,
  F = mål), samma nyckel i sträcktidstabellen och i vägvalen (`packages/domain`: `split-table.ts`, `route-legs.ts`).
- Löparens sträckor räknas ur starttid och stämplingstider i det publicerade resultatet. Ruttens del för en
  sträcka är punkterna mellan sträckans två klockslag, med interpolerade ändpunkter.
- En sträcka över en missad kontroll (t.ex. `31.1-33.1`) är en egen sträcka och jämförs aldrig med `32.1-33.1`.

## Vem ser vad

- Bara admin (OWNER/ADMIN, samma serverkontroll som resten av arbetsytan) laddar upp, georefererar och tar bort.
- Publikt visas kartbilden bara när den är georefererad, och rutterna bara som delar för en sträcka i ett
  publicerat resultat. Tiden före start och efter mål visas aldrig, inte heller den råa GPX-filen.
- Ingen GPS-följning, inga deltagarkonton för uppladdning och inga Livelox-data.
