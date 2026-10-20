-- Steg 36 (läs om avläsningar från rådata): en avläsning som avkodats på nytt från sina sparade råramar sparas som ett
-- nytt råmeddelande (transport `sportident-reread`, enheten = originalets råmeddelande, nyttolasten pekar på originalet)
-- och en ny avläsning; originalet ändras aldrig. Resultatet får orsaken READOUT_REREAD, som bedömer en avläsning precis
-- som CARD_READOUT.
ALTER TYPE revision_cause ADD VALUE IF NOT EXISTS 'READOUT_REREAD';
--> statement-breakpoint
ALTER TABLE result_revision DROP CONSTRAINT result_revision_cause_check;
--> statement-breakpoint
ALTER TABLE result_revision ADD CONSTRAINT result_revision_cause_check CHECK (
  ((cause::text = 'START_CHECKIN_DID_NOT_START') = (start_checkin_dns_decision_id IS NOT NULL)) AND
  ((cause::text = 'SHORTENED_COURSE_CLASS_TRANSFER') = (shortened_course_class_transfer_id IS NOT NULL)) AND
  (
    (cause::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION', 'UNKNOWN_READOUT_RESOLUTION',
      'SHORTENED_COURSE_CLASS_TRANSFER', 'READOUT_REREAD') AND readout_id IS NOT NULL AND (
      (status = 'OK' AND reason = 'COMPLETE') OR
      (status = 'OVERTIME' AND reason = 'MAX_TIME_EXCEEDED') OR
      (status = 'MP' AND reason IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
    OR (cause::text IN ('MANUAL_DID_NOT_START', 'START_CHECKIN_DID_NOT_START', 'MANUAL_DID_NOT_START_WITHDRAWAL')
      AND readout_id IS NULL AND status = 'DNS' AND reason = 'DID_NOT_START')
    OR (cause::text = 'MANUAL_DISQUALIFICATION' AND readout_id IS NULL AND status = 'DSQ' AND reason = 'MANUAL_DISQUALIFICATION')
    OR (cause::text = 'MANUAL_RESULT_APPROVAL' AND readout_id IS NULL AND status = 'OK' AND reason = 'MANUAL_APPROVAL')
    OR (cause::text = 'MANUAL_DID_NOT_FINISH' AND readout_id IS NULL AND status = 'DNF' AND reason = 'DID_NOT_FINISH')
    OR (cause::text = 'MANUAL_OUT_OF_COMPETITION' AND readout_id IS NULL AND status = 'OOC' AND reason = 'OUT_OF_COMPETITION')
    OR (cause::text = 'MANUAL_WITHOUT_TIMING' AND readout_id IS NULL AND status = 'NT' AND reason = 'WITHOUT_TIMING')
    OR (cause::text = 'MANUAL_RESULT_REMOVED' AND readout_id IS NULL AND status = 'MP' AND reason = 'MISSING_START')
    OR (cause::text = 'MANUAL_CONTROL_APPROVAL' AND readout_id IS NULL AND (
      (status = 'OK' AND reason = 'MANUAL_APPROVAL') OR (status = 'MP' AND reason IN ('MISSING_CONTROL', 'WRONG_ORDER'))))
    OR (cause::text IN ('MANUAL_DISQUALIFICATION_WITHDRAWAL', 'MANUAL_RESULT_APPROVAL_WITHDRAWAL',
      'MANUAL_DID_NOT_FINISH_WITHDRAWAL', 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL', 'MANUAL_WITHOUT_TIMING_WITHDRAWAL',
      'MANUAL_FINISH_TIME_CORRECTION', 'MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL',
      'MANUAL_PUNCH_START_TIME_CORRECTION', 'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL',
      'MANUAL_TIME', 'MANUAL_TIME_WITHDRAWAL', 'MANUAL_CONTROL_APPROVAL_WITHDRAWAL')
      AND readout_id IS NULL AND (
      (status = 'OK' AND reason = 'COMPLETE') OR
      (status = 'OVERTIME' AND reason = 'MAX_TIME_EXCEEDED') OR
      (status = 'MP' AND reason IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
  )
);
