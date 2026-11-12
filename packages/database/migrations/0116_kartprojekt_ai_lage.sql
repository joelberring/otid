-- Ägaren 2026-11-12 («om användaren kan ställa in … om AI:n får jobba självständigt eller bara ändra via förslag»):
-- vad AI-kopplingen får göra i kartprojektet. READ = bara läsa, PROPOSE = lämna förslag som en ägare godkänner (som förut),
-- AUTONOMOUS = AI:ns förslag godkänns direkt och läggs i kartans historik. Bara tillägg (migrations/README.md).
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'PROPOSE';
ALTER TABLE map_project DROP CONSTRAINT IF EXISTS map_project_ai_mode_check;
ALTER TABLE map_project ADD CONSTRAINT map_project_ai_mode_check CHECK (ai_mode IN ('READ', 'PROPOSE', 'AUTONOMOUS'));
