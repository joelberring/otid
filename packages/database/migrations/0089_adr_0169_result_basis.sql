-- ADR-0169 beslut 1: ett resultat är aktuellt så länge underlaget för just den
-- löparens bedömning är oförändrat. Underlaget är klassen, klassens startsätt och
-- banversion med kontroller i ordning, klassens strukna kontroller för den
-- banversionen och löparens fasta starttid. Tävlingsversionen används inte längre
-- för att avgöra om ett resultat är inaktuellt.
--
-- Äldre revisioner behåller NULL och bedöms då som tidigare (mot tävlingsversionen).
ALTER TABLE result_revision ADD COLUMN basis_hash text;

-- Deterministisk hash (sha256, hex) av löparens bedömningsunderlag just nu.
-- Formatet är versionerat (v1) och får inte ändras utan ny version.
CREATE FUNCTION otid_result_basis_hash(p_entry_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT encode(sha256(convert_to(
    'v1'
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
    || '|fixedStart=' || coalesce(floor(extract(epoch FROM e.fixed_start_time) * 1000)::bigint::text, ''),
    'UTF8')), 'hex')
  FROM entry e
  JOIN class c ON c.id = e.class_id
  WHERE e.id = p_entry_id
$$;

-- Varje ny revision får underlaget som gällde när den skapades. Värdet sätts
-- alltid av databasen så att ingen kodväg kan ange ett annat.
CREATE FUNCTION set_result_revision_basis_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.basis_hash := otid_result_basis_hash(NEW.entry_id);
  IF NEW.basis_hash IS NULL THEN
    RAISE EXCEPTION 'result_revision saknar bedömningsunderlag för deltagaren %', NEW.entry_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER result_revision_basis_hash
  BEFORE INSERT ON result_revision
  FOR EACH ROW EXECUTE FUNCTION set_result_revision_basis_hash();
