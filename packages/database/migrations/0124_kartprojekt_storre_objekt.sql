-- Ägaren 2026-11-15: «Kunde inte spara (500)» i ett kartprojekt. En stor yta ur grundkartan (hårdgjord mark med många hål)
-- blev mer än 1 MB som jsonb, och villkoret på objektets läge avvisade ändringen. Webbläsaren försökte sedan om utan slut,
-- och allt efter den ändringen väntade i kön. Synkens begäran får vara 4 MB (MAP_PROJECT_SYNC_MAX_BYTES); gränsen per läge
-- höjs till 8 MB, så att begärans gräns är den som gäller.
--
-- Bara en lättnad (migrations/README.md): villkoren byts mot samma villkor med högre gräns. Äldre kod skriver aldrig större
-- lägen än förut, och alla befintliga rader klarar det nya villkoret. NOT VALID och VALIDATE håller låset kort.
ALTER TABLE map_project_object DROP CONSTRAINT IF EXISTS map_project_object_state_check;
ALTER TABLE map_project_object ADD CONSTRAINT map_project_object_state_check
  CHECK (jsonb_typeof(state) = 'object' AND state->>'kind' IN ('UNCHANGED', 'OBJECT', 'DELETED') AND pg_column_size(state) <= 8388608) NOT VALID;
ALTER TABLE map_project_object VALIDATE CONSTRAINT map_project_object_state_check;

ALTER TABLE map_project_edit DROP CONSTRAINT IF EXISTS map_project_edit_state_check;
ALTER TABLE map_project_edit ADD CONSTRAINT map_project_edit_state_check
  CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 8388608) NOT VALID;
ALTER TABLE map_project_edit VALIDATE CONSTRAINT map_project_edit_state_check;

ALTER TABLE map_project_proposal_edit DROP CONSTRAINT IF EXISTS map_project_proposal_edit_state_check;
ALTER TABLE map_project_proposal_edit ADD CONSTRAINT map_project_proposal_edit_state_check
  CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 8388608) NOT VALID;
ALTER TABLE map_project_proposal_edit VALIDATE CONSTRAINT map_project_proposal_edit_state_check;
