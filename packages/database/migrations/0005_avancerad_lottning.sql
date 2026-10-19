-- Steg 26 (PLAN.md): avancerad lottning.
-- Seedning per löpare: 1 = bäst. Seedade lottas sist i klassen (bäst sist) eller jämnt utspridda. NULL = inte seedad.
ALTER TABLE entry ADD COLUMN seed_rank integer;
--> statement-breakpoint
ALTER TABLE entry ADD CONSTRAINT entry_seed_rank_check CHECK (seed_rank IS NULL OR seed_rank BETWEEN 1 AND 10000);
--> statement-breakpoint
-- Lottningens inställningar under "Avancerat" (startgrupp, tak per minut, sista start, seedning, startordning och senare
-- start per klass), sparade med den senaste lottningen så att de finns kvar nästa gång. NULL = standard.
ALTER TABLE race ADD COLUMN start_draw_settings jsonb;
--> statement-breakpoint
ALTER TABLE race ADD CONSTRAINT race_start_draw_settings_check CHECK (
  start_draw_settings IS NULL OR (jsonb_typeof(start_draw_settings) = 'object' AND pg_column_size(start_draw_settings) <= 262144));
