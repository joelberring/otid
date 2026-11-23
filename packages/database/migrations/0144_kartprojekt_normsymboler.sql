-- Ägaren 2026-11-23 («husen blev helt svarta … många andra symboler som inte följer sprintnorm»): kartprojektets rättningar av
-- symbolerna efter ISSprOM 2019-2. `{"replace": [nummer …], "add": [nummer …]}`: symbolerna med numren byts mot normens (O-Tids
-- sprintmall, `symbol-norm.ts`) och normens saknade symboler läggs till; null = filens egna. Grundfilen ändras aldrig;
-- symbolerna visas i ritläget och skrivs i nya kartversioner (bara Mapper-kartor). Bara tillägg (migrations/README.md).
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS norm_symbols jsonb;
