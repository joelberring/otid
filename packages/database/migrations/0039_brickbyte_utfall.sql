-- Översynen 2026-11-02: brickbyte och ny deltagare kopplar en avläsning som redan fanns för brickan, och brickbytet
-- kan byta brickor mellan två löpare. Vad som hände sparas i journalen så att samma begäran ger samma kvitto.
-- Bara nya kolumner som får vara tomma (ingen omskrivning av tabellen, inget borttaget).
ALTER TABLE entry_card_change_request ADD COLUMN IF NOT EXISTS outcome jsonb;
ALTER TABLE entry_card_change_request DROP CONSTRAINT IF EXISTS entry_card_change_request_outcome_check;
ALTER TABLE entry_card_change_request ADD CONSTRAINT entry_card_change_request_outcome_check
  CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object') NOT VALID;
ALTER TABLE entry_registration_request ADD COLUMN IF NOT EXISTS outcome jsonb;
ALTER TABLE entry_registration_request DROP CONSTRAINT IF EXISTS entry_registration_request_outcome_check;
ALTER TABLE entry_registration_request ADD CONSTRAINT entry_registration_request_outcome_check
  CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object') NOT VALID;
