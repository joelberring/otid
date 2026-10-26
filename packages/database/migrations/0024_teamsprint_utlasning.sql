-- Steg 50 (ADR-0174 beslut 9): teamsprint med utläsning efter varje sträcka (som MeOS) eller efter sista sträckan
-- (växlingskontroll, steg 48). NULL = vanlig stafett. Steg 48:s teamsprintklasser (de med växlingskontroll) behåller sitt
-- sätt; mallen "Teamsprint" ger utläsning efter varje sträcka.
ALTER TABLE class ADD COLUMN relay_readout_mode text CHECK (relay_readout_mode IN ('EACH_LEG', 'LAST_LEG'));
--> statement-breakpoint
UPDATE class SET relay_readout_mode = 'LAST_LEG' WHERE relay_changeover_code IS NOT NULL;
--> statement-breakpoint
-- Underlaget per löpare: i en teamsprintklass med utläsning efter varje sträcka ingår sättet, växlingskontrollen (om den finns)
-- och vems bricka sträckan springer med. För alla andra deltagare är texten och hashen oförändrad.
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
    || CASE WHEN e.team_id IS NOT NULL AND c.relay_readout_mode = 'EACH_LEG' AND (e.relay_card_entry_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM entry s WHERE s.relay_card_entry_id = e.id)) THEN
      '|teamsprint=each:' || coalesce(c.relay_changeover_code::text, '') || ':' || coalesce(e.relay_card_entry_id, e.id)::text
    WHEN c.relay_changeover_code IS NOT NULL AND e.team_id IS NOT NULL THEN
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
--> statement-breakpoint
-- En okänd utläsning kan kopplas till en teamsprintsträcka som inte har egen bricka: brickans koppling sitter på löparens
-- första sträcka. Kopplingen i journalen behöver då höra till tävlingen och brickan, inte till den valda sträckan.
CREATE UNIQUE INDEX card_assignment_id_race_card_uidx ON card_assignment (id, race_id, card_number);
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution DROP CONSTRAINT unknown_readout_resolution_assignment_id_race_id_entry_id__fkey;
--> statement-breakpoint
ALTER TABLE unknown_readout_resolution ADD CONSTRAINT unknown_readout_resolution_assignment_card_fkey
  FOREIGN KEY (assignment_id, race_id, card_number) REFERENCES card_assignment (id, race_id, card_number);
