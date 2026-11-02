-- ADR-0189 beslut 1–2: kartbilder och kartfiler lagras en gång, adresserade med sha256, i delar om högst 1 MiB.
--
-- Steg ett av två (AGENTS.md, migrationsregeln): bara tillägg. `race_map`, `race_map_source`, `training_group_map` och
-- `training_group_map_source` får kolumnen `content_sha256` som pekar på innehållet i `map_content`. En rad har antingen
-- sitt innehåll i den gamla kolumnen (image/file, som förut) eller en referens, aldrig båda. Den nya koden skriver bara
-- referenser och läser båda. Gamla rader flyttas i steg två med kommandot `node superadmin.mjs map-content move` (en rad per
-- transaktion, efter att den nya versionen fungerar); kolumnerna image/file tas bort i en senare driftsättning.
--
-- Delarna skrivs innan innehållets rad finns (uppladdningen strömmas till databasen, ADR-0189 beslut 2), så delarna har ingen
-- främmande nyckel; delar utan innehåll äldre än ett dygn tas bort av underhållet. Innehållet tas bort när den sista
-- referensen försvinner (utlösaren nedan), också när en tävling tas bort med purge.

CREATE TABLE IF NOT EXISTS map_content (
  sha256 text PRIMARY KEY,
  content_id uuid NOT NULL,
  byte_length integer NOT NULL,
  -- Kontot vars kvot innehållet räknas mot (den som först laddade upp det). Ingen nyckel: kontot kan tas bort utan att
  -- kartorna i andras tävlingar påverkas. NULL för innehåll som flyttats ur gamla rader.
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT map_content_hash_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT map_content_size_check CHECK (byte_length BETWEEN 1 AND 62914560),
  CONSTRAINT map_content_content_id_key UNIQUE (content_id)
);
CREATE INDEX IF NOT EXISTS map_content_uploaded_by_idx ON map_content (uploaded_by) WHERE uploaded_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS map_content_part (
  content_id uuid NOT NULL,
  part integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT map_content_part_pkey PRIMARY KEY (content_id, part),
  CONSTRAINT map_content_part_part_check CHECK (part BETWEEN 0 AND 100),
  CONSTRAINT map_content_part_size_check CHECK (octet_length(data) BETWEEN 1 AND 1048576)
);
CREATE INDEX IF NOT EXISTS map_content_part_created_idx ON map_content_part (created_at);

-- Referenserna. Tabellerna är små (en rad per tävling eller biblioteksbild); de nya kolumnerna är tomma, så nycklarna och
-- villkoren kontrolleras snabbt. Den gamla storlekskontrollen (byte_length = octet_length(...)) gäller fortfarande för gamla rader.
ALTER TABLE race_map ADD COLUMN IF NOT EXISTS content_sha256 text REFERENCES map_content (sha256);
ALTER TABLE race_map ALTER COLUMN image DROP NOT NULL;
ALTER TABLE race_map ADD CONSTRAINT race_map_content_check CHECK ((image IS NULL) <> (content_sha256 IS NULL));
CREATE INDEX IF NOT EXISTS race_map_content_idx ON race_map (content_sha256);

ALTER TABLE race_map_source ADD COLUMN IF NOT EXISTS content_sha256 text REFERENCES map_content (sha256);
ALTER TABLE race_map_source ALTER COLUMN file DROP NOT NULL;
ALTER TABLE race_map_source ADD CONSTRAINT race_map_source_content_check CHECK ((file IS NULL) <> (content_sha256 IS NULL));
CREATE INDEX IF NOT EXISTS race_map_source_content_idx ON race_map_source (content_sha256);

ALTER TABLE training_group_map ADD COLUMN IF NOT EXISTS content_sha256 text REFERENCES map_content (sha256);
ALTER TABLE training_group_map ALTER COLUMN image DROP NOT NULL;
ALTER TABLE training_group_map ADD CONSTRAINT training_group_map_content_check CHECK ((image IS NULL) <> (content_sha256 IS NULL));
CREATE INDEX IF NOT EXISTS training_group_map_content_idx ON training_group_map (content_sha256);

ALTER TABLE training_group_map_source ADD COLUMN IF NOT EXISTS content_sha256 text REFERENCES map_content (sha256);
ALTER TABLE training_group_map_source ALTER COLUMN file DROP NOT NULL;
ALTER TABLE training_group_map_source ADD CONSTRAINT training_group_map_source_content_check
  CHECK ((file IS NULL) <> (content_sha256 IS NULL));
CREATE INDEX IF NOT EXISTS training_group_map_source_content_idx ON training_group_map_source (content_sha256);

-- Innehållet ur en gammal rad (eller en återställd kopia) till lagret: samma innehåll lagras en gång. Ger sha256.
-- `ON CONFLICT DO UPDATE` låser raden, så att underhållet inte tar bort den innan referensen är sparad.
CREATE OR REPLACE FUNCTION otid_map_content_store(p_content bytea, p_uploaded_by uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_sha text;
  v_id uuid;
  v_inserted boolean;
  v_length integer;
BEGIN
  IF p_content IS NULL THEN RETURN NULL; END IF;
  v_sha := encode(sha256(p_content), 'hex');
  v_length := octet_length(p_content);
  INSERT INTO map_content (sha256, content_id, byte_length, uploaded_by, created_at)
    VALUES (v_sha, gen_random_uuid(), v_length, p_uploaded_by, now())
    ON CONFLICT (sha256) DO UPDATE SET byte_length = map_content.byte_length
    RETURNING content_id, (xmax = 0) INTO v_id, v_inserted;
  IF v_inserted THEN
    INSERT INTO map_content_part (content_id, part, data, created_at)
      SELECT v_id, n, substring(p_content FROM n * 1048576 + 1 FOR 1048576), now()
      FROM generate_series(0, (v_length - 1) / 1048576) AS n;
  END IF;
  RETURN v_sha;
END;
$$;

-- Hela innehållet (för säkerhetskopian och utskriften, som behöver filen i ett stycke).
CREATE OR REPLACE FUNCTION otid_map_content_bytes(p_sha text) RETURNS bytea
    LANGUAGE sql STABLE
    AS $$
  SELECT string_agg(p.data, ''::bytea ORDER BY p.part)
  FROM map_content c JOIN map_content_part p ON p.content_id = c.content_id
  WHERE c.sha256 = p_sha
$$;

-- Tar bort innehållet när ingen rad pekar på det. En rad som en annan transaktion håller (den sparar just en referens)
-- hoppas över; underhållet tar den senare om referensen aldrig sparades.
CREATE OR REPLACE FUNCTION otid_map_content_release(p_sha text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sha IS NULL THEN RETURN; END IF;
  SELECT content_id INTO v_id FROM map_content WHERE sha256 = p_sha FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM race_map WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM race_map_source WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM training_group_map WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM training_group_map_source WHERE content_sha256 = p_sha) THEN
    RETURN;
  END IF;
  DELETE FROM map_content WHERE sha256 = p_sha;
  DELETE FROM map_content_part WHERE content_id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION otid_map_content_reference_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.content_sha256 IS NOT DISTINCT FROM OLD.content_sha256 THEN RETURN NULL; END IF;
  PERFORM otid_map_content_release(OLD.content_sha256);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS race_map_content_release ON race_map;
CREATE TRIGGER race_map_content_release AFTER DELETE OR UPDATE OF content_sha256 ON race_map
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();
DROP TRIGGER IF EXISTS race_map_source_content_release ON race_map_source;
CREATE TRIGGER race_map_source_content_release AFTER DELETE OR UPDATE OF content_sha256 ON race_map_source
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();
DROP TRIGGER IF EXISTS training_group_map_content_release ON training_group_map;
CREATE TRIGGER training_group_map_content_release AFTER DELETE OR UPDATE OF content_sha256 ON training_group_map
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();
DROP TRIGGER IF EXISTS training_group_map_source_content_release ON training_group_map_source;
CREATE TRIGGER training_group_map_source_content_release AFTER DELETE OR UPDATE OF content_sha256 ON training_group_map_source
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();

-- Rollerna (ADR-0186): de som läser kartfilen i dag (utskriftsarbetaren otid_print och webbens otid_app) får läsa innehållet.
-- Webbens rättigheter på nya tabeller kommer också från ägarens förvalda rättigheter. Utan rollerna (en superuser) görs inget.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ro.rolname
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles ro ON ro.oid = a.grantee
    WHERE c.oid = 'race_map_source'::regclass AND a.privilege_type = 'SELECT' AND a.grantee <> c.relowner AND NOT ro.rolsuper
  LOOP
    EXECUTE format('GRANT SELECT ON map_content, map_content_part TO %I', r.rolname);
  END LOOP;
END;
$$;
