-- ADR-0169 beslut 2 / PLAN.md steg 10: gafflingar. En banversion kan ha flera
-- varianter med var sin hel kontrollföljd. Klassen pekar på banan; löparen bär
-- sin variants kod. Koden följer med till nästa banversion (Redigera bana skapar
-- en ny banversion med alla varianter). En stafettsträcka kan senare bära en kod
-- på samma sätt. Utan varianter fungerar allt som tidigare.
CREATE TABLE "course_variant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_version_id" uuid NOT NULL REFERENCES "course_version"("id"),
  "code" text NOT NULL,
  "sequence" integer NOT NULL,
  CONSTRAINT "course_variant_code_uidx" UNIQUE ("course_version_id", "code"),
  CONSTRAINT "course_variant_sequence_uidx" UNIQUE ("course_version_id", "sequence"),
  CONSTRAINT "course_variant_id_version_uidx" UNIQUE ("id", "course_version_id"),
  CONSTRAINT "course_variant_code_check" CHECK (char_length("code") BETWEEN 1 AND 32 AND "code" = btrim("code")),
  CONSTRAINT "course_variant_sequence_check" CHECK ("sequence" > 0)
);

CREATE TABLE "course_variant_control" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_variant_id" uuid NOT NULL REFERENCES "course_variant"("id"),
  "control_id" uuid NOT NULL REFERENCES "control"("id"),
  "sequence" integer NOT NULL,
  CONSTRAINT "course_variant_control_sequence_uidx" UNIQUE ("course_variant_id", "sequence"),
  CONSTRAINT "course_variant_control_sequence_check" CHECK ("sequence" > 0)
);
CREATE INDEX "course_variant_control_variant_idx" ON "course_variant_control"("course_variant_id");

-- Som banversionen och dess kontroller ändras varianterna aldrig; en ändring är en ny banversion.
CREATE TRIGGER course_variant_immutable BEFORE UPDATE OR DELETE ON "course_variant"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER course_variant_control_immutable BEFORE UPDATE OR DELETE ON "course_variant_control"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Löparens variant (NULL = ingen tilldelad variant; en gafflad bana bedöms då mot den variant som stämplingarna passar).
ALTER TABLE "entry" ADD COLUMN "course_variant_code" text;
ALTER TABLE "entry" ADD CONSTRAINT "entry_course_variant_code_check"
  CHECK ("course_variant_code" IS NULL OR (char_length("course_variant_code") BETWEEN 1 AND 32 AND "course_variant_code" = btrim("course_variant_code")));

-- Journal för ändrad variant på en löpare (ENTRY) och "Fördela gafflingar" i en klass (CLASS).
-- Samma request-id ger samma kvitto. Fröet för fördelningen sparas för revision och visas aldrig.
CREATE TABLE "course_variant_assignment_request" (
  "request_id" uuid PRIMARY KEY,
  "race_id" uuid NOT NULL REFERENCES "race"("id"),
  "kind" text NOT NULL,
  "class_id" uuid NOT NULL,
  "entry_id" uuid,
  "seed" bigint,
  "actor_credential_id" uuid NOT NULL,
  "capability" pairing_admin_capability NOT NULL,
  "request" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "assigned_at" timestamptz NOT NULL,
  CONSTRAINT "course_variant_assignment_request_scope_uidx" UNIQUE ("request_id", "race_id"),
  CONSTRAINT "course_variant_assignment_request_class_fk" FOREIGN KEY ("class_id", "race_id") REFERENCES "class"("id", "race_id"),
  CONSTRAINT "course_variant_assignment_request_entry_fk" FOREIGN KEY ("entry_id", "race_id") REFERENCES "entry"("id", "race_id"),
  CONSTRAINT "course_variant_assignment_request_actor_scope_fk" FOREIGN KEY ("actor_credential_id", "race_id", "capability")
    REFERENCES "pairing_admin_access_credential"("id", "race_id", "capability"),
  CONSTRAINT "course_variant_assignment_request_role_check" CHECK ("capability" = 'MANAGE_RACE'),
  CONSTRAINT "course_variant_assignment_request_kind_check" CHECK (
    ("kind" = 'ENTRY' AND "entry_id" IS NOT NULL AND "seed" IS NULL) OR
    ("kind" = 'CLASS' AND "entry_id" IS NULL AND "seed" BETWEEN 1 AND 4294967295)),
  CONSTRAINT "course_variant_assignment_request_json_check" CHECK (jsonb_typeof("request") = 'object' AND jsonb_typeof("response") = 'object')
);
CREATE TRIGGER course_variant_assignment_request_immutable BEFORE UPDATE OR DELETE ON "course_variant_assignment_request"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Underlagshashen (migration 0089) omfattar nu löparens variant och banans varianter.
-- Banor utan varianter får exakt samma värde som förut (v1), så befintliga resultat
-- förblir aktuella. Gafflade banor använder formatet v2.
CREATE OR REPLACE FUNCTION otid_result_basis_hash(p_entry_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT encode(sha256(convert_to(
    CASE WHEN forked.has_variants THEN 'v2' ELSE 'v1' END
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
    ELSE '' END,
    'UTF8')), 'hex')
  FROM entry e
  JOIN class c ON c.id = e.class_id
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM course_variant v WHERE v.course_version_id = c.course_version_id) AS has_variants
  ) forked
  WHERE e.id = p_entry_id
$$;
