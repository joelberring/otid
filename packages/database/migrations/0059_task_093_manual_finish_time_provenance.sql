-- Completes TASK093's forward-compatible result provenance constraint.
-- Keep every earlier source variant verbatim and add only the new exclusive one.
DO $$
DECLARE definition text;
DECLARE updated_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'result_revision'::regclass AND conname = 'result_revision_source_provenance_check';
  IF definition IS NULL THEN RAISE EXCEPTION 'result revision provenance constraint missing'; END IF;
  ALTER TABLE result_revision DROP CONSTRAINT result_revision_source_provenance_check;
  updated_definition := 'CHECK (((cause)::text = ''MANUAL_FINISH_TIME_CORRECTION'' AND readout_id IS NULL '
    || 'AND manual_finish_time_correction_id IS NOT NULL AND num_nonnulls('
    || 'did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, '
    || 'approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, '
    || 'not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, '
    || 'without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0 '
    || 'AND ((status = ''OK'' AND reason = ''COMPLETE'') OR '
    || '(status = ''MP'' AND reason IN (''MISSING_CONTROL'', ''WRONG_ORDER'')))) OR ('
    || substring(definition from 8 for length(definition) - 8) || '))';
  IF substring(definition from 1 for 7) <> 'CHECK (' THEN RAISE EXCEPTION 'result revision provenance check is not canonical'; END IF;
  EXECUTE 'ALTER TABLE result_revision ADD CONSTRAINT result_revision_source_provenance_check ' || updated_definition;
END $$;

-- Rollback: disable the TASK093 writer/UI. Preserve journal and revisions;
-- repair forward or restore a verified PostgreSQL backup rather than dropping history.
