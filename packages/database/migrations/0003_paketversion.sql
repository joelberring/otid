-- Steg 23 (ADR-0173 beslut 3): adminåtgärder kontrolleras inte mot tävlingens version. race.snapshot_version är
-- avläsningspaketets version och höjs bara när paketets innehåll ändras. Journalernas förväntade version tas bort.
ALTER TABLE result_recalculation_request DROP COLUMN expected_snapshot_version;
--> statement-breakpoint
ALTER TABLE class_result_recalculation DROP COLUMN expected_snapshot_version;
--> statement-breakpoint
ALTER TABLE class_control_neutralization DROP COLUMN expected_snapshot_version;
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution DROP COLUMN expected_snapshot_version;
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution ADD CONSTRAINT unknown_readout_resolution_snapshot_check CHECK (snapshot_version_after > 1);
