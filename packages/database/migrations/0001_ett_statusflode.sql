-- Steg 23 (ADR-0173 beslut 1): ett statusflöde. Beslut och återtaganden finns bara som resultatrevisioner med
-- orsak, aktör och begärans-id. Besluts-, återtagande- och tidsrättningsjournalerna och deras kolumner tas bort.
ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'MANUAL_DID_NOT_START_WITHDRAWAL';
--> statement-breakpoint
DROP TABLE did_not_start_withdrawal, did_not_start_decision,
  result_disqualification_withdrawal, result_disqualification_decision,
  result_approval_withdrawal, result_approval_decision,
  did_not_finish_withdrawal, did_not_finish_decision,
  not_competing_withdrawal, not_competing_decision,
  without_timing_withdrawal, without_timing_decision,
  manual_finish_time_correction_withdrawal, manual_finish_time_correction,
  manual_punch_start_time_correction_withdrawal, manual_punch_start_time_correction CASCADE;
--> statement-breakpoint
ALTER TABLE result_revision
  DROP COLUMN did_not_start_decision_id CASCADE,
  DROP COLUMN disqualification_decision_id CASCADE,
  DROP COLUMN disqualification_withdrawal_id CASCADE,
  DROP COLUMN approval_decision_id CASCADE,
  DROP COLUMN approval_withdrawal_id CASCADE,
  DROP COLUMN did_not_finish_decision_id CASCADE,
  DROP COLUMN did_not_finish_withdrawal_id CASCADE,
  DROP COLUMN not_competing_decision_id CASCADE,
  DROP COLUMN not_competing_withdrawal_id CASCADE,
  DROP COLUMN without_timing_decision_id CASCADE,
  DROP COLUMN without_timing_withdrawal_id CASCADE,
  DROP COLUMN manual_finish_time_correction_id CASCADE,
  DROP COLUMN manual_finish_time_correction_withdrawal_id CASCADE,
  DROP COLUMN manual_punch_start_time_correction_id CASCADE,
  DROP COLUMN manual_punch_start_time_correction_withdrawal_id CASCADE,
  ADD COLUMN request_id uuid,
  ADD COLUMN actor_account_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX result_revision_request_uidx ON result_revision USING btree (request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE result_revision ADD CONSTRAINT result_revision_cause_check CHECK (
  ((cause::text = 'START_CHECKIN_DID_NOT_START') = (start_checkin_dns_decision_id IS NOT NULL)) AND
  ((cause::text = 'SHORTENED_COURSE_CLASS_TRANSFER') = (shortened_course_class_transfer_id IS NOT NULL)) AND
  (
    (cause::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION', 'UNKNOWN_READOUT_RESOLUTION',
      'SHORTENED_COURSE_CLASS_TRANSFER') AND readout_id IS NOT NULL AND (
      (status = 'OK' AND reason = 'COMPLETE') OR
      (status = 'MP' AND reason IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
    OR (cause::text IN ('MANUAL_DID_NOT_START', 'START_CHECKIN_DID_NOT_START', 'MANUAL_DID_NOT_START_WITHDRAWAL')
      AND readout_id IS NULL AND status = 'DNS' AND reason = 'DID_NOT_START')
    OR (cause::text = 'MANUAL_DISQUALIFICATION' AND readout_id IS NULL AND status = 'DSQ' AND reason = 'MANUAL_DISQUALIFICATION')
    OR (cause::text = 'MANUAL_RESULT_APPROVAL' AND readout_id IS NULL AND status = 'OK' AND reason = 'MANUAL_APPROVAL')
    OR (cause::text = 'MANUAL_DID_NOT_FINISH' AND readout_id IS NULL AND status = 'DNF' AND reason = 'DID_NOT_FINISH')
    OR (cause::text = 'MANUAL_OUT_OF_COMPETITION' AND readout_id IS NULL AND status = 'OOC' AND reason = 'OUT_OF_COMPETITION')
    OR (cause::text = 'MANUAL_WITHOUT_TIMING' AND readout_id IS NULL AND status = 'NT' AND reason = 'WITHOUT_TIMING')
    OR (cause::text IN ('MANUAL_DISQUALIFICATION_WITHDRAWAL', 'MANUAL_RESULT_APPROVAL_WITHDRAWAL',
      'MANUAL_DID_NOT_FINISH_WITHDRAWAL', 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL', 'MANUAL_WITHOUT_TIMING_WITHDRAWAL',
      'MANUAL_FINISH_TIME_CORRECTION', 'MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL',
      'MANUAL_PUNCH_START_TIME_CORRECTION', 'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL')
      AND readout_id IS NULL AND (
      (status = 'OK' AND reason = 'COMPLETE') OR
      (status = 'MP' AND reason IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
  )
);
