-- Steg 25 (PLAN.md): saknade tävlingsfunktioner.
-- Maxtid per klass. NULL = ingen gräns. Rogaining har egen tidsgräns och får ingen maxtid.
ALTER TABLE class ADD COLUMN max_time_minutes integer;
--> statement-breakpoint
ALTER TABLE class ADD CONSTRAINT class_max_time_check CHECK (
  max_time_minutes IS NULL OR (max_time_minutes BETWEEN 1 AND 1440 AND rogaining_time_limit_seconds IS NULL));
--> statement-breakpoint
-- Banans längd och stigning i meter (banfilens Length/Climb eller banformuläret). Banan är den stabila identiteten.
ALTER TABLE course ADD COLUMN length_meters integer, ADD COLUMN climb_meters integer;
--> statement-breakpoint
ALTER TABLE course ADD CONSTRAINT course_length_climb_check CHECK (
  (length_meters IS NULL OR length_meters BETWEEN 1 AND 1000000) AND (climb_meters IS NULL OR climb_meters BETWEEN 0 AND 100000));
--> statement-breakpoint
-- Eventors id för personen och klubben (för IOF-resultatet). Lagras med källan via entry.external_source.
ALTER TABLE entry ADD COLUMN eventor_person_id text, ADD COLUMN eventor_organisation_id text;
--> statement-breakpoint
ALTER TABLE entry ADD CONSTRAINT entry_eventor_ids_check CHECK (
  (eventor_person_id IS NULL OR eventor_person_id ~ '^[0-9A-Za-z_-]{1,64}$') AND
  (eventor_organisation_id IS NULL OR eventor_organisation_id ~ '^[0-9A-Za-z_-]{1,64}$'));
--> statement-breakpoint
-- Disk med orsak: arrangörens text på disk-revisionen (visas bara i arbetsytan).
ALTER TABLE result_revision ADD COLUMN note text;
--> statement-breakpoint
ALTER TABLE result_revision ADD CONSTRAINT result_revision_note_check CHECK (
  note IS NULL OR (cause::text = 'MANUAL_DISQUALIFICATION' AND char_length(note) BETWEEN 1 AND 500));
--> statement-breakpoint
-- Maxtid överskriden är ett tekniskt utfall och kan återställas av ett återtagande eller en rättad tid.
ALTER TABLE result_revision DROP CONSTRAINT result_revision_cause_check;
--> statement-breakpoint
ALTER TABLE result_revision ADD CONSTRAINT result_revision_cause_check CHECK (
  ((cause::text = 'START_CHECKIN_DID_NOT_START') = (start_checkin_dns_decision_id IS NOT NULL)) AND
  ((cause::text = 'SHORTENED_COURSE_CLASS_TRANSFER') = (shortened_course_class_transfer_id IS NOT NULL)) AND
  (
    (cause::text IN ('CARD_READOUT', 'CLASS_CHANGE_RECALCULATION', 'EXPLICIT_RECALCULATION', 'UNKNOWN_READOUT_RESOLUTION',
      'SHORTENED_COURSE_CLASS_TRANSFER') AND readout_id IS NOT NULL AND (
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
    OR (cause::text IN ('MANUAL_DISQUALIFICATION_WITHDRAWAL', 'MANUAL_RESULT_APPROVAL_WITHDRAWAL',
      'MANUAL_DID_NOT_FINISH_WITHDRAWAL', 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL', 'MANUAL_WITHOUT_TIMING_WITHDRAWAL',
      'MANUAL_FINISH_TIME_CORRECTION', 'MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL',
      'MANUAL_PUNCH_START_TIME_CORRECTION', 'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL')
      AND readout_id IS NULL AND (
      (status = 'OK' AND reason = 'COMPLETE') OR
      (status = 'OVERTIME' AND reason = 'MAX_TIME_EXCEEDED') OR
      (status = 'MP' AND reason IN ('MISSING_START', 'MISSING_FINISH', 'MISSING_CONTROL', 'WRONG_ORDER', 'INVALID_TIME_ORDER'))))
  )
);
--> statement-breakpoint
-- Underlaget per löpare (ADR-0169 beslut 1) får klassens maxtid när den finns. Utan maxtid är hashen densamma som förut.
CREATE OR REPLACE FUNCTION public.otid_result_basis_hash(p_entry_id uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT encode(sha256(convert_to(
    CASE WHEN c.rogaining_time_limit_seconds IS NOT NULL THEN 'v3' WHEN forked.has_variants THEN 'v2' ELSE 'v1' END
    || '|class=' || e.class_id::text
    || '|start=' || c.start_rule::text
    || '|course=' || c.course_version_id::text
    || '|controls=' || coalesce((
      SELECT string_agg(cc.sequence::text || ':' || ctl.code::text, ',' ORDER BY cc.sequence)
      FROM course_control cc
      JOIN control ctl ON ctl.id = cc.control_id
      WHERE cc.course_version_id = c.course_version_id
    ), '')
    || '|neutralized=' || coalesce((
      SELECT string_agg(n.course_control_id::text, ',' ORDER BY n.course_control_id::text)
      FROM class_control_neutralization n
      WHERE n.class_id = e.class_id AND n.course_version_id = c.course_version_id
    ), '')
    || '|fixedStart=' || coalesce(floor(extract(epoch FROM e.fixed_start_time) * 1000)::bigint::text, '')
    || CASE WHEN forked.has_variants THEN
      '|variant=' || coalesce(e.course_variant_code, '')
      || '|variants=' || coalesce((
        SELECT string_agg(v.code || ':' || coalesce((
          SELECT string_agg(vc.sequence::text || ':' || vctl.code::text, ',' ORDER BY vc.sequence)
          FROM course_variant_control vc
          JOIN control vctl ON vctl.id = vc.control_id
          WHERE vc.course_variant_id = v.id
        ), ''), ';' ORDER BY v.sequence)
        FROM course_variant v
        WHERE v.course_version_id = c.course_version_id
      ), '')
    ELSE '' END
    || CASE WHEN c.rogaining_time_limit_seconds IS NOT NULL THEN
      '|rogaining=' || c.rogaining_time_limit_seconds::text || ':' || c.rogaining_penalty_points_per_minute::text
      || '|points=' || coalesce((
        SELECT string_agg(ctl.code::text || ':' || coalesce(ctl.points::text, ''), ',' ORDER BY cc.sequence)
        FROM course_control cc
        JOIN control ctl ON ctl.id = cc.control_id
        WHERE cc.course_version_id = c.course_version_id
      ), '')
    ELSE '' END
    || CASE WHEN c.max_time_minutes IS NOT NULL THEN '|maxTime=' || c.max_time_minutes::text ELSE '' END,
    'UTF8')), 'hex')
  FROM entry e
  JOIN class c ON c.id = e.class_id
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM course_variant v WHERE v.course_version_id = c.course_version_id) AS has_variants
  ) forked
  WHERE e.id = p_entry_id
$$;
--> statement-breakpoint
-- Direktanmälan på avläsningssidan (även offline): journal per begäran (idempotens). Brickan kopplas till en ny
-- deltagare (CREATED) eller fanns redan anmäld (EXISTING); okända avläsningar av brickan bedöms då mot deltagaren.
CREATE TABLE readout_registration (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  card_number text NOT NULL,
  class_id uuid NOT NULL REFERENCES class(id),
  given_name text NOT NULL,
  family_name text NOT NULL,
  organisation_name text,
  outcome text NOT NULL,
  entry_id uuid NOT NULL REFERENCES entry(id),
  actor_account_id uuid NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT readout_registration_outcome_check CHECK (outcome IN ('CREATED', 'EXISTING')),
  CONSTRAINT readout_registration_card_check CHECK (card_number ~ '^[1-9][0-9]{0,31}$')
);
--> statement-breakpoint
CREATE INDEX readout_registration_race_idx ON readout_registration USING btree (race_id, created_at);
--> statement-breakpoint
CREATE TRIGGER readout_registration_immutable BEFORE DELETE OR UPDATE ON readout_registration
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
