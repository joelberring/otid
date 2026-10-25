-- Steg 47 (ADR-0174): stafett på riktigt. Bana per sträcka, flygande omstart, upp till 30 sträckor (25-manna),
-- placering av lag i omstart, utjämnad gaffling eller fulgaffling, strukna lag och nya stafettåtgärder i journalen.
ALTER TABLE relay_leg ADD COLUMN course_version_id uuid REFERENCES course_version(id);
--> statement-breakpoint
ALTER TABLE relay_leg ADD COLUMN restart_after_minutes integer;
--> statement-breakpoint
ALTER TABLE relay_leg DROP CONSTRAINT relay_leg_method_check;
--> statement-breakpoint
ALTER TABLE relay_leg ADD CONSTRAINT relay_leg_method_check
  CHECK (start_method IN ('MASS_START', 'CHANGEOVER', 'RESTART', 'FLYING_RESTART'));
--> statement-breakpoint
ALTER TABLE relay_leg DROP CONSTRAINT relay_leg_time_check;
--> statement-breakpoint
ALTER TABLE relay_leg ADD CONSTRAINT relay_leg_time_check
  CHECK ((start_method IN ('CHANGEOVER', 'FLYING_RESTART')) = (start_time IS NULL));
--> statement-breakpoint
ALTER TABLE relay_leg ADD CONSTRAINT relay_leg_restart_after_check
  CHECK ((start_method = 'FLYING_RESTART') = (restart_after_minutes IS NOT NULL)
    AND (restart_after_minutes IS NULL OR restart_after_minutes BETWEEN 1 AND 720));
--> statement-breakpoint
ALTER TABLE relay_leg DROP CONSTRAINT relay_leg_number_check;
--> statement-breakpoint
ALTER TABLE relay_leg ADD CONSTRAINT relay_leg_number_check CHECK (leg BETWEEN 1 AND 30);
--> statement-breakpoint
ALTER TABLE entry DROP CONSTRAINT entry_relay_leg_check;
--> statement-breakpoint
ALTER TABLE entry ADD CONSTRAINT entry_relay_leg_check
  CHECK (((team_id IS NULL) = (relay_leg IS NULL)) AND (relay_leg IS NULL OR relay_leg BETWEEN 1 AND 30));
--> statement-breakpoint
CREATE INDEX relay_leg_course_version_idx ON relay_leg (course_version_id) WHERE course_version_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE class ADD COLUMN relay_restart_ranking text
  CHECK (relay_restart_ranking IS NULL OR relay_restart_ranking IN ('AFTER_NORMAL', 'BY_TIME'));
--> statement-breakpoint
ALTER TABLE class ADD COLUMN relay_forking text CHECK (relay_forking IS NULL OR relay_forking IN ('EVEN', 'UNEVEN'));
--> statement-breakpoint
ALTER TABLE team ADD COLUMN struck_at timestamptz;
--> statement-breakpoint
ALTER TABLE relay_request DROP CONSTRAINT relay_request_kind_check;
--> statement-breakpoint
ALTER TABLE relay_request ADD CONSTRAINT relay_request_kind_check CHECK (
  (kind IN ('CLASS', 'START_TIMES', 'CLASS_EDIT') AND team_id IS NULL)
  OR (kind IN ('TEAM', 'LEG_RUNNER', 'TEAM_EDIT', 'TEAM_STRIKE', 'TEAM_DID_NOT_START', 'LEG_VARIANT') AND team_id IS NOT NULL));
--> statement-breakpoint
-- Underlaget per löpare (ADR-0169 beslut 1): banan är stafettsträckans egen bana när den har en, annars klassens.
-- För alla andra deltagare blir texten och därmed hashen exakt densamma som förut.
CREATE OR REPLACE FUNCTION public.otid_result_basis_hash(p_entry_id uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT encode(sha256(convert_to(
    CASE WHEN c.rogaining_time_limit_seconds IS NOT NULL THEN 'v3' WHEN forked.has_variants THEN 'v2' ELSE 'v1' END
    || '|class=' || e.class_id::text
    || '|start=' || c.start_rule::text
    || '|course=' || cv.id::text
    || '|controls=' || coalesce((
      SELECT string_agg(cc.sequence::text || ':' || ctl.code::text, ',' ORDER BY cc.sequence)
      FROM course_control cc
      JOIN control ctl ON ctl.id = cc.control_id
      WHERE cc.course_version_id = cv.id
    ), '')
    || '|neutralized='
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
        WHERE v.course_version_id = cv.id
      ), '')
    ELSE '' END
    || CASE WHEN c.rogaining_time_limit_seconds IS NOT NULL THEN
      '|rogaining=' || c.rogaining_time_limit_seconds::text || ':' || c.rogaining_penalty_points_per_minute::text
      || '|points=' || coalesce((
        SELECT string_agg(ctl.code::text || ':' || coalesce(ctl.points::text, ''), ',' ORDER BY cc.sequence)
        FROM course_control cc
        JOIN control ctl ON ctl.id = cc.control_id
        WHERE cc.course_version_id = cv.id
      ), '')
    ELSE '' END
    || CASE WHEN c.max_time_minutes IS NOT NULL THEN '|maxTime=' || c.max_time_minutes::text ELSE '' END
    || coalesce((
      SELECT '|stations=' || string_agg(r.kind || ':' || r.station || ':' || coalesce(r.control_code::text, '') || ':'
        || coalesce(r.offset_ms::text, ''), ',' ORDER BY r.kind, r.station, r.control_code, r.offset_ms)
      FROM race_station_correction r
      WHERE r.race_id = e.race_id AND r.removed_at IS NULL
    ), ''),
    'UTF8')), 'hex')
  FROM entry e
  JOIN class c ON c.id = e.class_id
  CROSS JOIN LATERAL (
    SELECT coalesce((SELECT rl.course_version_id FROM relay_leg rl WHERE rl.class_id = e.class_id AND rl.leg = e.relay_leg),
      c.course_version_id) AS id
  ) cv
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM course_variant v WHERE v.course_version_id = cv.id) AS has_variants
  ) forked
  WHERE e.id = p_entry_id
$$;
