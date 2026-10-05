-- ADR-0170 beslut 5 / PLAN.md steg 15: rogaining. En klass blir rogaining med tidsgräns och straff per
-- påbörjad minut över gränsen; klassens banversion är kontrollmängden. Poängen hör till kontrollkoden i hela
-- tävlingen: NULL betyder förvalet (koden delat med tio, avrundat nedåt), som domänen räknar ut.
ALTER TABLE "control" ADD COLUMN "points" integer;
ALTER TABLE "control" ADD CONSTRAINT "control_points_check" CHECK ("points" IS NULL OR "points" BETWEEN 0 AND 1000);

ALTER TABLE "class" ADD COLUMN "rogaining_time_limit_seconds" integer;
ALTER TABLE "class" ADD COLUMN "rogaining_penalty_points_per_minute" integer;
ALTER TABLE "class" ADD CONSTRAINT "class_rogaining_check" CHECK (
  ("rogaining_time_limit_seconds" IS NULL) = ("rogaining_penalty_points_per_minute" IS NULL) AND
  ("rogaining_time_limit_seconds" IS NULL OR "rogaining_time_limit_seconds" BETWEEN 60 AND 172800) AND
  ("rogaining_penalty_points_per_minute" IS NULL OR "rogaining_penalty_points_per_minute" BETWEEN 0 AND 1000));

-- Idempotent journal: ett omförsök med samma request-id ger samma kvitto.
CREATE TABLE rogaining_change_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  changed_at timestamptz NOT NULL,
  CONSTRAINT rogaining_change_request_scope_uidx UNIQUE(request_id, race_id),
  CONSTRAINT rogaining_change_request_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT rogaining_change_request_role_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT rogaining_change_request_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER rogaining_change_request_immutable
BEFORE UPDATE OR DELETE ON rogaining_change_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Underlaget (ADR-0169 beslut 1) för en rogainingklass tar också med tidsgränsen, straffet och kontrollernas
-- ändrade poäng (v3). Klasser som inte är rogaining får samma hash som förut (v1/v2), så befintliga resultat
-- förblir aktuella.
CREATE OR REPLACE FUNCTION otid_result_basis_hash(p_entry_id uuid)
RETURNS text
LANGUAGE sql
STABLE
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
    ELSE '' END,
    'UTF8')), 'hex')
  FROM entry e
  JOIN class c ON c.id = e.class_id
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM course_variant v WHERE v.course_version_id = c.course_version_id) AS has_variants
  ) forked
  WHERE e.id = p_entry_id
$$;
