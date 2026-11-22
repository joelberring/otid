-- PLAN.md steg M4 (ADR-0229 tillägg M4, ägaren 2026-11-21): recept för återskapbart underlag och borttagning ur förrådet.
--
-- map_content får två kolumner:
--   recipe      hur innehållet skapas igen (källa, ruta eller område, datum, parametrar; `StoredRecipe` i contracts). NULL = eget
--               innehåll eller innehåll från före M4.
--   evicted_at  när innehållet togs bort ur förrådet för att kontot passerat sin gräns för återskapbart eller varit orört för länge.
-- stored_in får värdet 'GONE': raden (och referenserna, receptet) står kvar men innehållet finns varken här eller i förrådet;
--   det skapas igen med receptet. Ett index på kontots återskapbara innehåll för gränsen.
--
-- Bara tillägg (migrations/README.md): nya nullbara kolumner, ett villkor som lättas och ett nytt villkor på en ny kolumn.
ALTER TABLE map_content ADD COLUMN IF NOT EXISTS recipe jsonb;
ALTER TABLE map_content ADD COLUMN IF NOT EXISTS evicted_at timestamptz;
ALTER TABLE map_content DROP CONSTRAINT IF EXISTS map_content_stored_in_check;
ALTER TABLE map_content ADD CONSTRAINT map_content_stored_in_check CHECK (stored_in IN ('DB', 'STORE', 'GONE'));
ALTER TABLE map_content DROP CONSTRAINT IF EXISTS map_content_recipe_check;
ALTER TABLE map_content ADD CONSTRAINT map_content_recipe_check CHECK (recipe IS NULL OR pg_column_size(recipe) <= 4096);

CREATE INDEX CONCURRENTLY IF NOT EXISTS map_content_regenerable_idx ON map_content (uploaded_by) WHERE regenerable;
