-- Etapp P5A: Prestanda- och hygienindex. Byggs utan att låsa skrivningar (migratorn kör dem utanför transaktionen).
-- Obs: entry (team_id, relay_leg) WHERE team_id IS NOT NULL täcks redan av entry_team_leg_uidx (migration 0022).
CREATE INDEX CONCURRENTLY IF NOT EXISTS entry_relay_card_entry_idx ON entry (relay_card_entry_id) WHERE relay_card_entry_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS result_revision_race_published_created_idx ON result_revision (race_id, created_at DESC) WHERE published;
CREATE INDEX CONCURRENTLY IF NOT EXISTS event_administration_grant_event_idx ON event_administration_grant (event_id, granted_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS club_archive_course_file_club_idx ON club_archive_course_file (club_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS race_public_date_idx ON race (race_date DESC) WHERE published_at IS NOT NULL AND NOT hidden_by_superadmin;
CREATE INDEX CONCURRENTLY IF NOT EXISTS map_project_job_race_idx ON map_project_job (race_id) WHERE race_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS start_draw_slot_entry_idx ON start_draw_slot (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS training_group_series_group_idx ON training_group_series (group_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS club_plan_session_map_idx ON club_plan_session (club_map_id) WHERE club_map_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS club_plan_session_group_idx ON club_plan_session (training_group_id) WHERE training_group_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS club_plan_session_responsible_idx ON club_plan_session (responsible_account_id) WHERE responsible_account_id IS NOT NULL;
