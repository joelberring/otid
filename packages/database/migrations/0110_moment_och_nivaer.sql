-- ADR-0222: träningens moment (fasta koder, t.ex. KURVBILD) och nivåer (Svensk Orienterings färger, GRON–SVART) i klubbarkivet
-- och i terminsplaneringen, så att arkivet kan sökas på dem. Egna ord är som förut taggar (`tags`); den planerade träningen får
-- också taggar. Planens moment, nivåer och taggar följer med när träningen läggs i klubbarkivet.
-- Bara tillägg (migrations/README.md): nya kolumner med tomma listor som förval.
ALTER TABLE club_archive_entry ADD COLUMN IF NOT EXISTS moments text[] NOT NULL DEFAULT '{}';
ALTER TABLE club_archive_entry ADD COLUMN IF NOT EXISTS levels text[] NOT NULL DEFAULT '{}';
ALTER TABLE club_plan_session ADD COLUMN IF NOT EXISTS moments text[] NOT NULL DEFAULT '{}';
ALTER TABLE club_plan_session ADD COLUMN IF NOT EXISTS levels text[] NOT NULL DEFAULT '{}';
ALTER TABLE club_plan_session ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
