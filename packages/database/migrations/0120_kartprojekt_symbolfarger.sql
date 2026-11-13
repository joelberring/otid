-- Ägaren 2026-11-13 («byggnader är fortfarande gråa … justera färgen»): kartprojektets symbolfärger. En lista med symbolens
-- nummer i filen (t.ex. "521"), färgen symbolen har i grundfilen (`from`) och kartfärgen den ritas med (`to`), båda som
-- färgernas id (Mappers prioritet); null eller tom lista = symbolernas egna färger. Grundfilen ändras aldrig; färgerna visas
-- i ritläget och skrivs i nya kartversioner. Bara tillägg (migrations/README.md). `colors_changed_at` (0112) uppdateras också
-- av en ändring här, så att en ny kartversion skrivs när bara färgerna är nya.
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS symbol_colors jsonb;
