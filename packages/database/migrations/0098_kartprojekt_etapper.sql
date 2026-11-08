-- ADR-0219 tillägget om etapperna (ägaren 2026-11-08): kartor görs ofta i etapper. Varje delområde får ett revideringsdatum, och
-- lagret Etapper (bara på skärmen, aldrig i utskrift) visar vilken del som är reviderad när.
--
-- Bara tillägg (migrations/README.md): en ny nullbar kolumn.
ALTER TABLE map_project_area ADD COLUMN IF NOT EXISTS revised_on date;
