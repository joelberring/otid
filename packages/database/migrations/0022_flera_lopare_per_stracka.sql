-- Steg 48 (ADR-0174 beslut 6–7): flera löpare per sträcka (parallella sträckor) och teamsprint.
-- Ordning inom sträckan (IOF LegOrder); NULL = 1, så att befintliga sträcklöpare och anmälningar fortsätter som förut.
ALTER TABLE entry ADD COLUMN relay_leg_order integer;
--> statement-breakpoint
ALTER TABLE entry ADD CONSTRAINT entry_relay_leg_order_check
  CHECK (relay_leg_order IS NULL OR (team_id IS NOT NULL AND relay_leg_order BETWEEN 1 AND 4));
--> statement-breakpoint
DROP INDEX entry_team_leg_uidx;
--> statement-breakpoint
CREATE UNIQUE INDEX entry_team_leg_uidx ON entry (team_id, relay_leg, (coalesce(relay_leg_order, 1))) WHERE team_id IS NOT NULL;
--> statement-breakpoint
-- Teamsprint: sträcklöparen springer med brickan som hör till löparens första sträcka (en bricka per person).
ALTER TABLE entry ADD COLUMN relay_card_entry_id uuid REFERENCES entry(id);
--> statement-breakpoint
ALTER TABLE entry ADD CONSTRAINT entry_relay_card_entry_check CHECK (relay_card_entry_id IS NULL OR (team_id IS NOT NULL AND relay_card_entry_id <> id));
--> statement-breakpoint
ALTER TABLE relay_leg ADD COLUMN runners integer NOT NULL DEFAULT 1 CHECK (runners BETWEEN 1 AND 4);
--> statement-breakpoint
ALTER TABLE relay_leg ADD COLUMN changeover_rule text NOT NULL DEFAULT 'FIRST' CHECK (changeover_rule IN ('FIRST', 'LAST'));
--> statement-breakpoint
ALTER TABLE relay_leg ADD COLUMN approval_rule text NOT NULL DEFAULT 'ALL' CHECK (approval_rule IN ('ALL', 'ANY'));
--> statement-breakpoint
-- Teamsprint: växlingskontrollens kod. NULL = vanlig stafett.
ALTER TABLE class ADD COLUMN relay_changeover_code integer CHECK (relay_changeover_code IS NULL OR relay_changeover_code BETWEEN 1 AND 999);
--> statement-breakpoint
-- Underlaget per löpare: i en teamsprintklass ingår växlingskontrollen och vems bricka sträckan springer med. För alla andra
-- deltagare är texten och hashen oförändrad.
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
    ), '')
    || CASE WHEN c.relay_changeover_code IS NOT NULL AND e.team_id IS NOT NULL THEN
      '|teamsprint=' || c.relay_changeover_code::text || ':' || coalesce(e.relay_card_entry_id, e.id)::text
    ELSE '' END,
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
