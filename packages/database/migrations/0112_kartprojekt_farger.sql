-- Ägaren 2026-11-10 («ställa in färger i kartan … färgtabell»): kartprojektets ändrade färger. En lista med färgens
-- ordningstal i grundfilen och dess nya CMYK (0–1); null eller tom lista = filens egna färger. Grundfilen ändras aldrig;
-- färgerna visas i ritläget och skrivs i nya kartversioner. Bara tillägg (migrations/README.md).
-- `colors_changed_at` säger när färgerna senast ändrades, så att en ny kartversion skrivs när bara färgerna är nya.
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS colors jsonb;
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS colors_changed_at timestamptz;
