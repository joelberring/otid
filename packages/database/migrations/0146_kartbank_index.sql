-- Etapp 3.1: Index för publik kartbank och förhandsvisningsbilder. Byggs utan att låsa skrivningar.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_club_map_uidx ON public_map_listing (club_map_id) WHERE club_map_id IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_map_project_uidx ON public_map_listing (map_project_id) WHERE map_project_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_municipality_gin_idx ON public_map_listing USING gin (municipality_codes);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_county_gin_idx ON public_map_listing USING gin (county_codes);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_bounds_idx ON public_map_listing (min_lon, max_lon, min_lat, max_lat);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_club_idx ON public_map_listing (club_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_owner_idx ON public_map_listing (owner_account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_content_idx ON public_map_listing (content_sha256);
CREATE INDEX CONCURRENTLY IF NOT EXISTS public_map_listing_preview_idx ON public_map_listing (preview_content_sha256);
CREATE INDEX CONCURRENTLY IF NOT EXISTS club_map_version_preview_idx ON club_map_version (preview_content_sha256);
