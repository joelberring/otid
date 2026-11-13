-- PLAN.md steg L4 (ägaren 2026-11-13, ADR-0224 beslut 5): när ett kartprojekt senast användes. Arkivet för vilande
-- kartinnehåll flyttar det som varit "orört" en viss tid, och det går bara att avgöra om tidpunkten sparas. Kolumnen sätts
-- när någon med behörighet öppnar, läser, ändrar eller exporterar projektet (också genom AI-kopplingen), högst en gång i
-- timmen per projekt. NULL = inte öppnat sedan kolumnen kom till; arkivet ska då räkna från projektets senaste ändring.
--
-- Bara tillägg (migrations/README.md): en kolumn som får vara tom.
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;
