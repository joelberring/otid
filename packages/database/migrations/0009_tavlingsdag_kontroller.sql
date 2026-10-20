-- Steg 31 (PLAN.md): tävlingsdagens nödlägen. Rättningar för hela tävlingen: tidsjustering för en station (start, mål
-- eller en kontrollkod) och kontroll ur funktion. Råa avläsningar ändras aldrig; rättningen läggs på brickans tider
-- (eller gör kontrollen frivillig) innan bedömningen, och alla avlästa räknas om i samma transaktion. En rättning tas
-- bort genom att markeras borttagen (vem och när); raden står kvar som historik och kan aldrig ändras annars.
CREATE TABLE race_station_correction (
  id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  kind text NOT NULL,
  station text NOT NULL,
  control_code integer,
  offset_ms integer,
  reason text NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  removed_at timestamp with time zone,
  removed_by_account_id uuid,
  CONSTRAINT race_station_correction_kind_check CHECK (kind IN ('TIME_ADJUSTMENT', 'CONTROL_OUT_OF_ORDER')),
  CONSTRAINT race_station_correction_station_check CHECK (station IN ('START', 'FINISH', 'CONTROL')),
  CONSTRAINT race_station_correction_code_check CHECK (
    (station = 'CONTROL') = (control_code IS NOT NULL) AND (control_code IS NULL OR control_code BETWEEN 1 AND 9999)),
  CONSTRAINT race_station_correction_offset_check CHECK (
    (kind = 'TIME_ADJUSTMENT' AND offset_ms IS NOT NULL AND offset_ms <> 0 AND offset_ms BETWEEN -86400000 AND 86400000)
    OR (kind = 'CONTROL_OUT_OF_ORDER' AND offset_ms IS NULL AND station = 'CONTROL')),
  CONSTRAINT race_station_correction_reason_check CHECK (char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT race_station_correction_removed_check CHECK ((removed_at IS NULL) = (removed_by_account_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX race_station_correction_active_uidx ON race_station_correction (race_id, kind, station, coalesce(control_code, 0))
  WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE INDEX race_station_correction_race_idx ON race_station_correction (race_id, created_at);
--> statement-breakpoint
-- Bara borttagningen får skrivas, en gång; annars som övriga journaler (radering bara vid purge).
CREATE FUNCTION public.protect_race_station_correction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'race_station_correction is append-only';
  END IF;
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND
     (to_jsonb(NEW) - 'removed_at' - 'removed_by_account_id') = (to_jsonb(OLD) - 'removed_at' - 'removed_by_account_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'race_station_correction is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER race_station_correction_protected BEFORE DELETE OR UPDATE ON race_station_correction
  FOR EACH ROW EXECUTE FUNCTION public.protect_race_station_correction();
--> statement-breakpoint
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
    -- Den gamla strykningen per klass är borttagen (steg 31); segmentet står kvar tomt så att hashen är oförändrad.
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
    || CASE WHEN c.max_time_minutes IS NOT NULL THEN '|maxTime=' || c.max_time_minutes::text ELSE '' END
    -- Steg 31: tävlingens aktiva rättningar per station. Utan rättningar är hashen densamma som förut.
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
    SELECT EXISTS (SELECT 1 FROM course_variant v WHERE v.course_version_id = c.course_version_id) AS has_variants
  ) forked
  WHERE e.id = p_entry_id
$$;
--> statement-breakpoint
-- Kontroll ur funktion för hela tävlingen ersätter strykningen per klass och banversion, som aldrig fick något
-- gränssnitt: ett sätt att göra en kontroll frivillig. Funktionen ovan läser inte längre tabellen.
ALTER TABLE result_revision DROP COLUMN control_neutralization_id;
--> statement-breakpoint
DROP TABLE class_control_neutralization;
--> statement-breakpoint
-- Oröjd bricka (steg 31): brickans check- och clearstämpling behövs i bedömningen. De fanns bara i den råa nyttolasten;
-- kolumnerna fylls i från den för redan lagrade avläsningar. Den råa nyttolasten ändras inte.
ALTER TABLE card_readout ADD COLUMN IF NOT EXISTS check_punched_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS clear_punched_at timestamp with time zone;
--> statement-breakpoint
UPDATE card_readout r SET
  check_punched_at = CASE WHEN m.raw_payload->>'checkPunchedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (m.raw_payload->>'checkPunchedAt')::timestamptz END,
  clear_punched_at = CASE WHEN m.raw_payload->>'clearPunchedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (m.raw_payload->>'clearPunchedAt')::timestamptz END
FROM raw_device_message m WHERE m.id = r.raw_message_id;
