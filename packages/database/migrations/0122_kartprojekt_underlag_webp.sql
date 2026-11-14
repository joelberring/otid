-- Ägaren 2026-11-14 («upplever det lite långsamt att läsa in»): laserkörningens bilder att titta på (kartbilden, terrängskuggningen
-- och reliefen) sparas som WebP, som är ungefär fem gånger mindre än PNG. Villkoret på underlagets typ räknade upp PNG och JPEG;
-- det lättas till formen (migrations/README.md: en lista som koden bestämmer skrivs inte i CHECK). Listan står i
-- `MAP_PROJECT_LAYER_MEDIA_TYPES` (@o-tid/contracts) med ett test.
--
-- Bara lättnad: inga rader ändras, och en äldre kodversion skriver fortfarande bara PNG och JPEG.
ALTER TABLE map_project_layer DROP CONSTRAINT IF EXISTS map_project_layer_media_check;
ALTER TABLE map_project_layer ADD CONSTRAINT map_project_layer_media_check CHECK (media_type ~ '^image/[a-z0-9.+-]{1,40}$');
