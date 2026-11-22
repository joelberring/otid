-- Granskningen 2026-11-22 (2.6): index som saknades. Avläsningens sökning på bricka (`scopedEntryIds`) tar med inaktiva kopplingar
-- och kunde inte använda det partiella indexet; deltagarens kopplingar, loppets händelser, kontots geo-körningar (nyckeln mot
-- kontot) och banversionens klasser slås upp utan index. Byggs utan att låsa skrivningar (migratorn kör dem utanför transaktionen).
CREATE INDEX CONCURRENTLY IF NOT EXISTS card_assignment_race_card_idx ON card_assignment (race_id, card_number);
CREATE INDEX CONCURRENTLY IF NOT EXISTS card_assignment_entry_idx ON card_assignment (entry_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_event_race_idx ON audit_event (race_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS map_project_geo_job_account_idx ON map_project_geo_job (account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS class_course_version_idx ON class (course_version_id);
