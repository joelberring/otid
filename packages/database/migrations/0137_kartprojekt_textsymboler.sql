-- K8b V6 (ägaren 2026-11-22): kartprojektets ändrade och nya textsymboler. En lista med symbolens id i grundfilen (eller en
-- kopias nya id, nummer och namn), typsnitt, storlek i mm, färgens id, fet/kursiv, justering och kontur; null eller tom lista =
-- filens egna. Grundfilen ändras aldrig; symbolerna visas i ritläget och skrivs i nya kartversioner (bara Mapper-kartor).
-- Bara tillägg (migrations/README.md). `colors_changed_at` (0112) uppdateras också av en ändring här.
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS text_symbols jsonb;
